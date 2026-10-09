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
