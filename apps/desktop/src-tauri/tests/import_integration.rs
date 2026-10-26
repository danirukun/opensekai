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
