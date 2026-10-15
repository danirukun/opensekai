use opensekai_desktop_lib::service::{start_service, AssetHook, AssetStep, ServiceConfig, ServiceHandle};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::Duration;
// Real managed library, import task, and authenticated HTTP boundaries (#151): a request held in a long
// asset step must not stop other asset requests. The hook holds the step until the test releases it.

fn glb(fill: u8, bin_bytes: usize) -> Vec<u8> {
    let mut json = serde_json::to_vec(&serde_json::json!({
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": bin_bytes}],
        "bufferViews": [{"buffer": 0, "byteLength": bin_bytes}]
    }))
    .unwrap();
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let total = 20 + json.len() + 8 + bin_bytes;
    let mut bytes = Vec::with_capacity(total);
    bytes.extend(b"glTF");
    bytes.extend(2u32.to_le_bytes());
    bytes.extend((total as u32).to_le_bytes());
    bytes.extend((json.len() as u32).to_le_bytes());
    bytes.extend(0x4e4f534au32.to_le_bytes());
    bytes.extend(json);
    bytes.extend((bin_bytes as u32).to_le_bytes());
    bytes.extend(0x004e4942u32.to_le_bytes());
    bytes.resize(total, fill);
    bytes
}

struct Gate {
    entered: mpsc::Receiver<AssetStep>,
    release: mpsc::Sender<()>,
}
// Holds the first step that `select` accepts until the test sends on `release`. Other steps pass.
fn hold(service: &ServiceHandle, select: impl Fn(&AssetStep) -> bool + Send + Sync + 'static) -> Gate {
    let (entered_tx, entered) = mpsc::channel();
    let (release, release_rx) = mpsc::channel::<()>();
    let entered_tx = Mutex::new(entered_tx);
    let release_rx = Mutex::new(release_rx);
    let held = AtomicBool::new(false);
    let hook: AssetHook = Arc::new(move |step: AssetStep| {
        if select(&step) && !held.swap(true, Ordering::SeqCst) {
            entered_tx.lock().unwrap().send(step).unwrap();
            // A deadline keeps a failing test from hanging the run.
            let _ = release_rx.lock().unwrap().recv_timeout(Duration::from_secs(10));
        }
    });
    service.set_asset_hook(Some(hook));
    Gate { entered, release }
}
async fn wait_entered(gate: &Gate) -> AssetStep {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(step) = gate.entered.try_recv() {
            return step;
        }
        assert!(std::time::Instant::now() < deadline, "the held asset step was not reached");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}
async fn get(service: &ServiceHandle, id: &str) -> reqwest::Response {
    let descriptor = service.operator_descriptor();
    reqwest::Client::new()
        .get(format!("{}/assets/{id}", descriptor.http_origin))
        .bearer_auth(descriptor.token)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .expect("asset request did not complete while another asset step was held")
}
fn config(dir: &std::path::Path) -> ServiceConfig {
    ServiceConfig {
        output_root: dir.into(),
        asset_manifest: Default::default(),
        evidence_root: dir.join("evidence"),
        evaluation_enabled: false,
    }
}

#[tokio::test]
async fn small_asset_is_served_while_a_large_import_is_in_its_store_step() {
    let dir = tempfile::tempdir().unwrap();
    let small = dir.path().join("small.glb");
    let large = dir.path().join("large.glb");
    std::fs::write(&small, glb(1, 64)).unwrap();
    std::fs::write(&large, glb(2, 32 << 20)).unwrap();
    let service = start_service(config(dir.path())).await.unwrap();
    let small = service.import_scene(small).await.unwrap().record;
    let gate = hold(&service, |step| *step == AssetStep::Store);
    let importer = {
        let ports = service.ports();
        let large = large.clone();
        tokio::spawn(async move { ports.import_scene(large).await })
    };
    assert_eq!(wait_entered(&gate).await, AssetStep::Store);
    let response = get(&service, &small.id).await;
    assert_eq!(response.status(), 200);
    assert_eq!(response.bytes().await.unwrap().len() as u64, small.bytes);
    assert_eq!(service.asset_records().len(), 1, "the held import is not committed yet");
    gate.release.send(()).unwrap();
    let imported = importer.await.unwrap().unwrap().record;
    assert_eq!(service.asset_records().len(), 2);
    // Deduplication (environment import R14) still holds after the split: the same file returns the same record.
    let again = service.import_scene(large.clone()).await.unwrap().record;
    assert_eq!(again, imported);
    assert_eq!(service.asset_records().len(), 2);
    // The repair rule still holds: a missing library file is written again.
    let library = dir.path().join("assets/library");
    std::fs::remove_file(library.join(format!("{}.glb", imported.id))).unwrap();
    assert_eq!(get(&service, &imported.id).await.status(), 404);
    assert_eq!(service.import_scene(large).await.unwrap().record, imported);
    assert_eq!(get(&service, &imported.id).await.status(), 200);
    let leftovers: Vec<_> = std::fs::read_dir(&library)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .filter(|name| !name.starts_with("scene_"))
        .collect();
    assert!(leftovers.is_empty(), "temporary files remain: {leftovers:?}");
    service.shutdown().await.unwrap();
}

#[tokio::test]
async fn small_asset_is_served_while_an_avatar_import_is_in_its_store_step() {
    let dir = tempfile::tempdir().unwrap();
    let small = dir.path().join("small.glb");
    std::fs::write(&small, glb(1, 64)).unwrap();
    let mut json = include_bytes!("fixtures/minimal-vrm1.json").to_vec();
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let mut avatar = b"glTF".to_vec();
    avatar.extend(2u32.to_le_bytes());
    avatar.extend((20 + json.len() as u32).to_le_bytes());
    avatar.extend((json.len() as u32).to_le_bytes());
    avatar.extend(0x4e4f534au32.to_le_bytes());
    avatar.extend(json);
    let avatar_path = dir.path().join("avatar.vrm");
    std::fs::write(&avatar_path, &avatar).unwrap();
    let service = start_service(config(dir.path())).await.unwrap();
    let small = service.import_scene(small).await.unwrap().record;
    let gate = hold(&service, |step| *step == AssetStep::Store);
    let importer = {
        let ports = service.ports();
        tokio::spawn(async move { ports.import_avatar(avatar_path).await })
    };
    wait_entered(&gate).await;
    assert_eq!(get(&service, &small.id).await.status(), 200);
    gate.release.send(()).unwrap();
    let avatar_record = importer.await.unwrap().unwrap().record;
    assert_eq!(get(&service, &avatar_record.id).await.bytes().await.unwrap().as_ref(), avatar);
    service.shutdown().await.unwrap();
}

#[tokio::test]
async fn concurrent_asset_reads_do_not_wait_for_each_other() {
    let dir = tempfile::tempdir().unwrap();
    let large = dir.path().join("large.glb");
    std::fs::write(&large, glb(3, 16 << 20)).unwrap();
    let service = start_service(config(dir.path())).await.unwrap();
    let large = service.import_scene(large).await.unwrap().record;
    let id = large.id.clone();
    let gate = hold(&service, move |step| *step == AssetStep::Read(id.clone()));
    let first = {
        let descriptor = service.operator_descriptor();
        let id = large.id.clone();
        tokio::spawn(async move {
            reqwest::Client::new()
                .get(format!("{}/assets/{id}", descriptor.http_origin))
                .bearer_auth(descriptor.token)
                .send()
                .await
                .unwrap()
        })
    };
    assert_eq!(wait_entered(&gate).await, AssetStep::Read(large.id.clone()));
    let second = get(&service, &large.id).await;
    assert_eq!(second.status(), 200);
    assert_eq!(second.bytes().await.unwrap().len() as u64, large.bytes);
    assert!(!first.is_finished(), "the first read is still held");
    gate.release.send(()).unwrap();
    assert_eq!(first.await.unwrap().status(), 200);
    service.shutdown().await.unwrap();
}

// Real WebSocket operator boundary (#155): the host answers `assetList` from the registry with no publisher connected.
#[tokio::test]
async fn operator_lists_assets_in_pages_without_a_publisher() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    let dir = tempfile::tempdir().unwrap();
    let service = start_service(config(dir.path())).await.unwrap();
    let mut ids = Vec::new();
    for fill in 0..70u8 {
        let path = dir.path().join(format!("room {fill}.glb"));
        std::fs::write(&path, glb(fill, 4)).unwrap();
        ids.push(service.import_scene(path).await.unwrap().record.id);
    }
    ids.sort();
    let descriptor = service.operator_descriptor();
    let (mut socket, _) = connect_async(&descriptor.ws_url).await.unwrap();
    socket
        .send(Message::Text(serde_json::json!({"kind":"auth","role":descriptor.role,"token":descriptor.token,"schemaVersion":1,"outputId":null}).to_string().into()))
        .await
        .unwrap();
    async fn next(socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>) -> serde_json::Value {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let message = socket.next().await.unwrap().unwrap();
                let text = message.clone().into_text().unwrap();
                let value: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|_| panic!("not JSON: {message:?}"));
                if value["kind"] != "clock" {
                    return value;
                }
            }
        })
        .await
        .unwrap()
    }
    assert_eq!(next(&mut socket).await["kind"], "authReply");
    let mut listed = Vec::new();
    let mut after = serde_json::Value::Null;
    for page in 0.. {
        let params = if after.is_null() { serde_json::json!({}) } else { serde_json::json!({"after": after}) };
        socket
            .send(Message::Text(serde_json::json!({"kind":"call","requestId":format!("list{page}"),"method":"assetList","params":params}).to_string().into()))
            .await
            .unwrap();
        let reply = next(&mut socket).await;
        assert_eq!(reply["result"]["ok"], true, "{reply}");
        let data = &reply["result"]["data"];
        let assets = data["assets"].as_array().unwrap();
        assert!(assets.len() <= 64);
        assert_eq!(assets[0]["kind"], "scene");
        assert_eq!(assets[0].as_object().unwrap().len(), 3, "a summary without credits has id, kind, and name only");
        listed.extend(assets.iter().map(|a| a["id"].as_str().unwrap().to_string()));
        after = data["next"].clone();
        if after.is_null() {
            assert_eq!(page, 1);
            break;
        }
    }
    assert_eq!(listed, ids);
    socket
        .send(Message::Text(serde_json::json!({"kind":"call","requestId":"bad","method":"assetList","params":{"after":""}}).to_string().into()))
        .await
        .unwrap();
    // An invalid call closes the connection, as for every other method.
    let closed = tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) if text.contains("\"clock\"") => continue,
                other => return other,
            }
        }
    })
    .await
    .unwrap();
    assert!(matches!(closed, None | Some(Err(_)) | Some(Ok(Message::Close(_)))), "{closed:?}");
    service.shutdown().await.unwrap();
}
