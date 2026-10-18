use opensekai_contracts::*;
use serde_json::{json, Value};

fn edit(ops: Value) -> Value {
    json!({"clientId":"c","batchId":"b","ops":ops})
}
fn ok(op: Value) -> bool {
    validate_call("blueprintEdit", &edit(json!([op]))).is_ok()
}
fn comment(extra: Value) -> Value {
    let mut c = json!({"id":"c1","text":"Setup","position":{"x":-20,"y":40},"size":{"width":400,"height":260}});
    for (k, v) in extra.as_object().unwrap() {
        c[k] = v.clone();
    }
    c
}
fn graph(comments: Option<Value>) -> Value {
    let mut g =
        json!({"schemaVersion":1,"id":"g","name":"G","nodes":[],"connections":[],"variables":[]});
    if let Some(c) = comments {
        g["comments"] = c;
    }
    g
}

#[test]
fn graph_comments_are_optional_and_bounded() {
    assert!(validate_blueprint_graph(&graph(None)).is_ok());
    assert!(validate_blueprint_graph(&graph(Some(json!([comment(json!({}))])))).is_ok());
    assert!(validate_blueprint_graph(&graph(Some(json!([comment(json!({"text":""}))])))).is_ok());
    assert!(validate_blueprint_graph(&graph(Some(json!([comment(
        json!({"text":"x".repeat(513)})
    )]))))
    .is_err());
    assert!(validate_blueprint_graph(&graph(Some(json!([comment(
        json!({"size":{"width":63,"height":100}})
    )]))))
    .is_err());
    assert!(validate_blueprint_graph(&graph(Some(json!([comment(
        json!({"size":{"width":100,"height":8193}})
    )]))))
    .is_err());
    assert!(
        validate_blueprint_graph(&graph(Some(json!([comment(json!({"color":"red"}))])))).is_err()
    );
    assert!(validate_blueprint_graph(&graph(Some(json!([
        comment(json!({})),
        comment(json!({}))
    ]))))
    .is_err());
    let many: Vec<Value> = (0..33)
        .map(|i| comment(json!({"id":format!("c{i}")})))
        .collect();
    assert!(validate_blueprint_graph(&graph(Some(json!(many)))).is_err());
    assert!(validate_blueprint_graph(&graph(Some(json!({})))).is_err());
    assert!(ok(
        json!({"kind":"createGraph","graph":graph(Some(json!([comment(json!({}))])))})
    ));
}

#[test]
fn comment_and_duplicate_operations_validate_structure() {
    assert!(ok(
        json!({"kind":"addComment","graphId":"g","comment":comment(json!({}))})
    ));
    assert!(!ok(
        json!({"kind":"addComment","graphId":"g","comment":comment(json!({"size":{"width":10,"height":10}}))})
    ));
    assert!(ok(
        json!({"kind":"updateComment","graphId":"g","commentId":"c1"})
    ));
    assert!(ok(
        json!({"kind":"updateComment","graphId":"g","commentId":"c1","text":"","position":{"x":1,"y":2},"size":{"width":64,"height":8192}})
    ));
    assert!(!ok(
        json!({"kind":"updateComment","graphId":"g","commentId":"c1","text":"x".repeat(513)})
    ));
    assert!(!ok(
        json!({"kind":"updateComment","graphId":"g","commentId":"c1","extra":1})
    ));
    assert!(ok(
        json!({"kind":"removeComment","graphId":"g","commentId":"c1"})
    ));
    assert!(!ok(json!({"kind":"removeComment","graphId":"g"})));
    assert!(ok(
        json!({"kind":"duplicateGraph","graphId":"g","newGraphId":"h"})
    ));
    assert!(ok(
        json!({"kind":"duplicateGraph","graphId":"g","newGraphId":"h","name":"Copy"})
    ));
    assert!(!ok(
        json!({"kind":"duplicateGraph","graphId":"g","newGraphId":"h","name":"  "})
    ));
    assert!(!ok(json!({"kind":"duplicateGraph","graphId":"g"})));
}
