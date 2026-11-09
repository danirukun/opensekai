use opensekai_desktop_lib::service::{start_service, ServiceConfig};
// Real managed-file and authenticated HTTP boundaries prove import bytes stay native.
#[tokio::test]
async fn imported_avatar_is_served_by_opaque_id_and_survives_service_restart() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("private-source.vrm");
    let mut json = include_bytes!("fixtures/minimal-vrm1.json").to_vec();
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let mut bytes = b"glTF".to_vec();
    bytes.extend(2u32.to_le_bytes());
    bytes.extend((20 + json.len() as u32).to_le_bytes());
    bytes.extend((json.len() as u32).to_le_bytes());
    bytes.extend(0x4e4f534au32.to_le_bytes());
    bytes.extend(json);
    std::fs::write(&source, &bytes).unwrap();
    let config = || ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: Default::default(),
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: false,
    };
    let service = start_service(config()).await.unwrap();
    let imported = service.import_avatar(source.clone()).await.unwrap();
    let descriptor = service.operator_descriptor();
    assert_eq!(imported.name, "Test avatar");
    assert_eq!(imported.record.name, "Test avatar");
    assert!(!serde_json::to_string(&imported)
        .unwrap()
        .contains("private-source"));
    assert_eq!(service.asset_records(), vec![imported.record.clone()]);
    let client = reqwest::Client::new();
    let url = format!("{}/assets/{}", descriptor.http_origin, imported.record.id);
    assert_eq!(client.get(&url).send().await.unwrap().status(), 401);
    assert_eq!(
        client
            .get(&url)
            .bearer_auth(descriptor.token)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        bytes
    );
    std::fs::remove_file(&source).unwrap();
    service.shutdown().await.unwrap();
    let restarted = start_service(config()).await.unwrap();
    assert_eq!(restarted.asset_records(), vec![imported.record]);
    restarted.shutdown().await.unwrap();
}
fn glb_json(bytes: &[u8]) -> serde_json::Value {
    let size = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    serde_json::from_slice(&bytes[20..20 + size]).unwrap()
}
// Real folder, packer, managed library, and authenticated HTTP boundaries: the served scene has no external URI.
#[tokio::test]
async fn imported_scene_folder_is_packed_served_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let room = dir.path().join("room");
    std::fs::create_dir_all(room.join("textures")).unwrap();
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[200, 120, 80, 255])
            .unwrap();
    }
    std::fs::write(room.join("textures/base color.png"), &png_bytes).unwrap();
    std::fs::write(room.join("scene.bin"), [0u8; 12]).unwrap();
    std::fs::write(room.join("scene.gltf"), serde_json::to_vec(&serde_json::json!({
        "asset": {"version": "2.0", "extras": {"title": "Test room", "license": "CC0"}},
        "buffers": [{"uri": "scene.bin", "byteLength": 12}],
        "bufferViews": [{"buffer": 0, "byteLength": 12}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3", "min": [0, 0, 0], "max": [0, 0, 0]}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "images": [{"uri": "textures/base%20color.png"}],
        "textures": [{"source": 0}],
        "nodes": [{"mesh": 0}],
        "scenes": [{"nodes": [0]}],
        "scene": 0
    })).unwrap()).unwrap();
    let config = || ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: Default::default(),
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: false,
    };
    let source_files = || {
        ["scene.gltf", "scene.bin", "textures/base color.png"]
            .map(|name| std::fs::read(room.join(name)).unwrap())
    };
    let before = source_files();
    let service = start_service(config()).await.unwrap();
    let imported = service.import_scene(room.join("scene.gltf")).await.unwrap();
    assert_eq!(source_files(), before);
    assert!(imported.record.id.starts_with("scene_"));
    assert_eq!(imported.record.name, "Test room");
    let descriptor = service.operator_descriptor();
    let url = format!("{}/assets/{}", descriptor.http_origin, imported.record.id);
    let served = reqwest::Client::new()
        .get(&url)
        .bearer_auth(descriptor.token)
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    let json = glb_json(&served);
    assert!(!serde_json::to_string(&json).unwrap().contains("\"uri\""));
    assert_eq!(json["images"][0]["mimeType"], "image/png");
    assert!(json["images"][0]["bufferView"].is_u64());
    // packages/renderer/test/scene-import.test.ts loads this file with inspectContainer and GLTFLoader.
    let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/scene-import/packed-room.glb");
    if std::env::var_os("OPENSEKAI_UPDATE_FIXTURES").is_some() {
        std::fs::create_dir_all(fixture.parent().unwrap()).unwrap();
        std::fs::write(&fixture, &served).unwrap();
    }
    assert_eq!(
        std::fs::read(&fixture).expect("run with OPENSEKAI_UPDATE_FIXTURES=1 to write the fixture"),
        served.as_ref(),
        "the packed GLB changed; run with OPENSEKAI_UPDATE_FIXTURES=1 and check the renderer test"
    );
    service.shutdown().await.unwrap();
    let restarted = start_service(config()).await.unwrap();
    assert!(restarted.asset_records().contains(&imported.record));
    restarted.shutdown().await.unwrap();
}
// Real file, managed library, and authenticated HTTP boundaries: an image is served with its own type (B28 R5, R6).
#[tokio::test]
async fn imported_image_is_served_with_its_content_type_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, 2, 1);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .unwrap()
            .write_image_data(&[255, 0, 0, 255, 0, 0, 0, 0])
            .unwrap();
    }
    let source = dir.path().join("Sign.png");
    std::fs::write(&source, &png_bytes).unwrap();
    let config = || ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: Default::default(),
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: false,
    };
    let service = start_service(config()).await.unwrap();
    let imported = service.import_image(source.clone()).await.unwrap();
    assert!(imported.record.id.starts_with("image_"));
    assert_eq!(imported.record.name, "Sign");
    let image = imported.record.image.clone().unwrap();
    assert_eq!((image.width, image.height, image.frames), (2, 1, 1));
    let again = service.import_image(source.clone()).await.unwrap();
    assert_eq!(again.record, imported.record);
    let descriptor = service.operator_descriptor();
    let url = format!("{}/assets/{}", descriptor.http_origin, imported.record.id);
    let response = reqwest::Client::new()
        .get(&url)
        .bearer_auth(&descriptor.token)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.headers()["content-type"], "image/png");
    assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    assert_eq!(response.bytes().await.unwrap().as_ref(), png_bytes);
    service.shutdown().await.unwrap();
    let restarted = start_service(config()).await.unwrap();
    assert_eq!(restarted.asset_records(), vec![imported.record]);
    restarted.shutdown().await.unwrap();
}
// Real file, managed library, and authenticated HTTP boundaries: a video is served whole with its own type (B29 R5, R6).
#[tokio::test]
async fn imported_video_is_served_with_its_content_type_and_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/video");
    let config = || ServiceConfig {
        output_root: dir.path().into(),
        asset_manifest: Default::default(),
        evidence_root: dir.path().join("evidence"),
        evaluation_enabled: false,
    };
    let service = start_service(config()).await.unwrap();
    let descriptor = service.operator_descriptor();
    let mut records = Vec::new();
    for (file, stem, content_type) in [
        ("h264-aac.mp4", "Intro", "video/mp4"),
        ("vp9-opus.webm", "Loop", "video/webm"),
    ] {
        let bytes = std::fs::read(fixtures.join(file)).unwrap();
        let source = dir
            .path()
            .join(format!("{stem}.{}", file.rsplit('.').next().unwrap()));
        std::fs::write(&source, &bytes).unwrap();
        let imported = service.import_video(source.clone()).await.unwrap();
        assert!(imported.record.id.starts_with("video_"));
        assert_eq!(imported.record.name, stem);
        assert!(imported.record.video.is_some());
        let again = service.import_video(source).await.unwrap();
        assert_eq!(again.record, imported.record);
        let url = format!("{}/assets/{}", descriptor.http_origin, imported.record.id);
        let response = reqwest::Client::new()
            .get(&url)
            .bearer_auth(&descriptor.token)
            .header("range", "bytes=0-99")
            .send()
            .await
            .unwrap();
        // No Range support in this slice: the full file with status 200.
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["content-type"], content_type);
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
        assert!(response.headers().get("accept-ranges").is_none());
        assert!(response.headers().get("content-range").is_none());
        assert_eq!(response.bytes().await.unwrap().as_ref(), bytes);
        records.push(imported.record);
    }
    // A file that is not a video is rejected and adds no record.
    let text = dir.path().join("notes.mp4");
    std::fs::write(&text, b"not a video").unwrap();
    assert!(service.import_video(text).await.is_err());
    service.shutdown().await.unwrap();
    let restarted = start_service(config()).await.unwrap();
    let mut reloaded = restarted.asset_records();
    reloaded.sort_by(|a, b| a.id.cmp(&b.id));
    records.sort_by(|a, b| a.id.cmp(&b.id));
    assert_eq!(reloaded, records);
    restarted.shutdown().await.unwrap();
}
