use opensekai_contracts::*;
use serde_json::{json, Value};

fn set() -> Value {
    let f: Value = serde_json::from_str(include_str!(
        "../../../fixtures/protocol/blueprint-set.json"
    ))
    .unwrap();
    f["blueprints"].clone()
}
fn edit(ops: Value) -> Value {
    json!({"clientId":"c","batchId":"b","ops":ops})
}

#[test]
fn blueprint_edit_validates_operation_structure_only() {
    assert!(validate_call(
        "blueprintEdit",
        &edit(json!([{"kind":"replaceAll","graphs":set()}]))
    )
    .is_ok());
    assert!(validate_call("blueprintEdit", &edit(json!([]))).is_err());
    assert!(validate_call(
        "blueprintEdit",
        &edit(json!(vec![json!({"kind":"removeGraph","graphId":"g"}); 65]))
    )
    .is_err());
    assert!(validate_call(
        "blueprintEdit",
        &edit(json!([{"kind":"teleport","graphId":"g"}]))
    )
    .is_err());
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"addNode","graphId":"g","node":{"id":"n","version":1,"type":"prop.throw","settings":{},"position":{"x":0,"y":0}}}]))).is_ok());
    assert!(validate_call("blueprintEdit", &edit(json!([{"kind":"addNode","graphId":"g","node":{"id":"n","version":1,"type":"Bad Type!","settings":{},"position":{"x":0,"y":0}}}]))).is_err());
    assert!(validate_call(
        "blueprintEdit",
        &edit(json!([{"kind":"moveNode","graphId":"g","nodeId":"n","position":{"x":0,"y":0}}]))
    )
    .is_ok());
    let upd = |extra: Value| {
        let mut o = json!({"kind":"updateGraph","graphId":"g"});
        o.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        edit(json!([o]))
    };
    assert!(validate_call("blueprintEdit", &upd(json!({"enabled":false}))).is_ok());
    assert!(validate_call("blueprintEdit", &upd(json!({"name":123}))).is_err());
    assert!(validate_call("blueprintEdit", &upd(json!({"name":""}))).is_err());
    assert!(validate_call("blueprintEdit", &upd(json!({"name":"   "}))).is_err());
    assert!(validate_call("blueprintEdit", &upd(json!({"name":"x".repeat(129)}))).is_err());
    assert!(validate_call("blueprintEdit", &upd(json!({"enabled":"x"}))).is_err());
    let mut nine = vec![];
    for i in 0..9 {
        let mut g = set()[0].clone();
        g["id"] = json!(format!("g{i}"));
        nine.push(g);
    }
    assert!(validate_call(
        "blueprintEdit",
        &edit(json!([{"kind":"replaceAll","graphs":nine}]))
    )
    .is_err());
}

#[test]
fn blueprint_inspect_run_and_results_validate() {
    assert!(validate_call("blueprintInspect", &json!({})).is_ok());
    assert!(validate_call("blueprintInspect", &json!({"sinceRevision":3})).is_ok());
    assert!(validate_call("blueprintInspect", &json!({"sinceRevision":-1})).is_err());
    assert!(validate_call("blueprintInspect", &json!({"extra":1})).is_err());
    assert!(validate_call("blueprintRun", &json!({"graphId":"g","triggerNodeId":"n"})).is_ok());
    assert!(validate_call("blueprintRun", &json!({"graph":{},"triggerNodeId":"n"})).is_err());
    assert!(validate_result(
        "blueprintEdit",
        &json!({"ok":true,"data":{"revision":1,"keystrokes":["Control+Alt+KeyH"]}})
    )
    .is_ok());
    assert!(validate_result(
        "blueprintEdit",
        &json!({"ok":true,"data":{"revision":1,"keystrokes":vec!["Control+KeyA"; 65]}})
    )
    .is_err());
    assert!(validate_result(
        "blueprintInspect",
        &json!({"ok":true,"data":{"kind":"snapshot","revision":1,"blueprints":set(),"errors":[]}})
    )
    .is_ok());
    assert!(validate_result(
        "blueprintInspect",
        &json!({"ok":true,"data":{"kind":"snapshot","revision":1,"blueprints":set(),"errors":[],"keystrokes":["Control+Alt+KeyH"]}})
    )
    .is_ok());
    assert!(validate_result(
        "blueprintInspect",
        &json!({"ok":true,"data":{"kind":"snapshot","revision":1,"blueprints":set(),"errors":[],"keystrokes":[""]}})
    )
    .is_err());
    let too_many: Vec<String> = (0..65).map(|i| format!("Control+Alt+F{i}")).collect();
    assert!(validate_result(
        "blueprintInspect",
        &json!({"ok":true,"data":{"kind":"snapshot","revision":1,"blueprints":set(),"errors":[],"keystrokes":too_many}})
    )
    .is_err());
    assert!(validate_result("blueprintInspect", &json!({"ok":true,"data":{"kind":"delta","revision":2,"batches":[{"revision":2,"clientId":"c","batchId":"b","ops":[{"kind":"removeGraph","graphId":"g"}]}],"errors":[]}})).is_ok());
    let delta = |op: Value| json!({"ok":true,"data":{"kind":"delta","revision":2,"batches":[{"revision":2,"clientId":"c","batchId":"b","ops":[op]}],"errors":[]}});
    assert!(validate_result(
        "blueprintInspect",
        &delta(json!({"kind":"replaceAll","graphs":set()}))
    )
    .is_err());
    assert!(validate_result(
        "blueprintInspect",
        &delta(json!({"kind":"createGraph","graph":set()[0]}))
    )
    .is_err());
}

#[test]
fn clock_carries_at_most_sixteen_keystrokes_within_the_plain_clock_limit() {
    let long = format!("Control+Alt+Shift+Super+{}", "K".repeat(40));
    let event = json!({"kind":"keystroke","accelerator":long});
    let ok = json!({"kind":"clock","sessionId":"s","elapsedMs":1,"input":{"events": vec![event.clone(); 16]}});
    assert!(parse_wire(ok.to_string().as_bytes()).is_ok());
    let over =
        json!({"kind":"clock","sessionId":"s","elapsedMs":1,"input":{"events": vec![event; 17]}});
    assert!(parse_wire(over.to_string().as_bytes()).is_err());
}

fn variables() -> Value {
    serde_json::from_str(include_str!(
        "../../../fixtures/protocol/blueprint-variables.json"
    ))
    .unwrap()
}

#[test]
fn blueprint_graph_checks_variable_structure() {
    let v = variables();
    assert!(validate_blueprint_graph(&v["valid"]).is_ok());
    let mut legacy = v["valid"].clone();
    legacy.as_object_mut().unwrap().remove("variables");
    assert!(validate_blueprint_graph(&legacy).is_ok());
    for case in v["invalid"].as_array().unwrap() {
        let mut g = v["valid"].clone();
        g["variables"] = case["variables"].clone();
        assert!(validate_blueprint_graph(&g).is_err(), "{}", case["name"]);
    }
    let mut many = v["valid"].clone();
    many["variables"] = json!((0..33).map(|i| json!({"id": format!("v{i}"), "name": format!("V{i}"), "type": "number", "default": 0})).collect::<Vec<_>>());
    assert!(validate_blueprint_graph(&many).is_err());
}

#[test]
fn blueprint_edit_accepts_variable_operations() {
    let ok = |op: Value| validate_call("blueprintEdit", &edit(json!([op]))).is_ok();
    assert!(ok(
        json!({"kind":"addVariable","graphId":"g","variable":{"id":"v","name":"V","type":"number","default":1.5}})
    ));
    assert!(!ok(
        json!({"kind":"addVariable","graphId":"g","variable":{"id":"v","name":"V","type":"number","default":false}})
    ));
    assert!(ok(
        json!({"kind":"updateVariable","graphId":"g","variableId":"v","name":"W","type":"boolean","default":true})
    ));
    assert!(ok(
        json!({"kind":"updateVariable","graphId":"g","variableId":"v"})
    ));
    assert!(ok(
        json!({"kind":"updateVariable","graphId":"g","variableId":"v","type":"string[]","default":["a"]})
    ));
    assert!(!ok(
        json!({"kind":"updateVariable","graphId":"g","variableId":"v","type":"color"})
    ));
    assert!(!ok(
        json!({"kind":"updateVariable","graphId":"g","variableId":"v","name":" "})
    ));
    assert!(ok(
        json!({"kind":"removeVariable","graphId":"g","variableId":"v"})
    ));
    assert!(!ok(json!({"kind":"removeVariable","graphId":"g"})));
}

#[test]
fn blueprint_graph_accepts_each_data_type_and_inline_inputs() {
    let v = variables();
    assert!(validate_blueprint_graph(&v["typed"]).is_ok());
    let node = |inputs: Value| json!({"id":"n","version":1,"type":"math.add","settings":{},"position":{"x":0,"y":0},"inputs":inputs});
    assert!(validate_blueprint_node(&node(json!({"a":1.5,"b":true,"c":"x","d":[0,1,2]}))).is_ok());
    assert!(validate_blueprint_node(&node(json!({}))).is_ok());
    assert!(validate_blueprint_node(&node(json!([1]))).is_err());
    assert!(validate_blueprint_node(&node(json!({"a":{"x":1}}))).is_err());
    assert!(validate_blueprint_node(&node(json!({"a":[1,2]}))).is_err());
    assert!(validate_blueprint_node(&node(json!({"a":"x".repeat(1025)}))).is_err());
    let many: serde_json::Map<String, Value> =
        (0..17).map(|i| (format!("p{i}"), json!(1))).collect();
    assert!(validate_blueprint_node(&node(Value::Object(many))).is_err());
}

#[test]
fn blueprint_edit_accepts_set_node_input() {
    let ok = |op: Value| validate_call("blueprintEdit", &edit(json!([op]))).is_ok();
    assert!(ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"a","value":2})
    ));
    assert!(ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"a","value":[0,1,0]})
    ));
    assert!(ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"a","value":null})
    ));
    assert!(!ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"a"})
    ));
    assert!(!ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"","value":1})
    ));
    assert!(!ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"a","value":[1]})
    ));
    assert!(!ok(
        json!({"kind":"setNodeInput","graphId":"g","nodeId":"n","port":"a","value":1,"extra":true})
    ));
}
