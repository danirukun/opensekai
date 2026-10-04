use opensekai_contracts::parse_wire;
use serde_json::{json, Value};
fn packet() -> Value {
    json!({"kind":"diagnostics","diagnostics":{"sessionId":"session_smoke","outputId":"output_main","rendererEpoch":"epoch_1","sequence":1,"revision":0,"backend":"webgl2","geometries":3,"textures":4,"liveMaterials":2,"assetCacheEntries":2,"activeRenderJob":false,"queuedFrames":0,"queuedCaptures":0}})
}
#[test]
fn strict_bounded_diagnostics_wire_contract() {
    let p = packet();
    assert!(parse_wire(p.to_string().as_bytes()).is_ok());
    for (field, value) in [
        ("geometries", json!(-1)),
        ("textures", json!(1.5)),
        ("liveMaterials", json!(1000001)),
        ("activeRenderJob", json!(1)),
        ("rendererEpoch", json!("")),
        ("extra", json!(1)),
    ] {
        let mut bad = p.clone();
        bad["diagnostics"][field] = value;
        assert!(parse_wire(bad.to_string().as_bytes()).is_err());
    }
    assert!(parse_wire(format!("{}{}", p, " ".repeat(2048)).as_bytes()).is_err());
}
