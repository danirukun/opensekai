use opensekai_contracts::{validate_call, validate_result};
use serde_json::{json, Value};

fn reply(data: Value) -> Value {
    json!({"ok": true, "data": data})
}
fn probe() -> Value {
    json!({"sourceId":"face","generation":2,"state":"receiving","values":{"jawOpen":0.4},"peaks":{"jawOpen":0.7},"presentChannels":["jawOpen"],"eyeBones":false})
}
#[test]
fn params_need_a_source_id() {
    assert!(validate_call("trackingProbe", &json!({"sourceId":"face"})).is_ok());
    assert!(validate_call(
        "trackingProbe",
        &json!({"sourceId":"face","resetPeaks":true})
    )
    .is_ok());
    assert!(validate_call("trackingProbe", &json!({"sourceId":""})).is_err());
    assert!(validate_call("trackingProbe", &json!({})).is_err());
    assert!(validate_call("trackingProbe", &json!({"sourceId":"face","extra":1})).is_err());
}
#[test]
fn result_is_checked() {
    assert!(validate_result("trackingProbe", &reply(probe())).is_ok());
    let mut over = probe();
    over["values"]["jawOpen"] = json!(1.1);
    assert!(validate_result("trackingProbe", &reply(over)).is_err());
    let mut name = probe();
    name["peaks"] = json!({"notAChannel": 0.1});
    assert!(validate_result("trackingProbe", &reply(name)).is_err());
    let mut twice = probe();
    twice["presentChannels"] = json!(["jawOpen", "jawOpen"]);
    assert!(validate_result("trackingProbe", &reply(twice)).is_err());
    let mut unknown = probe();
    unknown["extra"] = json!(1);
    assert!(validate_result("trackingProbe", &reply(unknown)).is_err());
}
