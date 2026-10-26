//! The VMC encoder (B21 R12, R15): the exact inverse of the decoder in `parser.rs`.
use opensekai_contracts::*;
/// The most bytes of one datagram, with the bundle header and the size field of each element.
pub const MAX_DATAGRAM_BYTES: usize = 1200;
pub const MAX_DATAGRAM_MESSAGES: usize = 32;
const BUNDLE_HEADER: usize = 16;
fn string(out: &mut Vec<u8>, s: &str) {
    out.extend(s.as_bytes());
    out.push(0);
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}
enum OscArg<'a> {
    Int(i32),
    Float(f32),
    Text(&'a str),
}
fn message(address: &str, args: &[OscArg]) -> Vec<u8> {
    let mut out = Vec::with_capacity(64);
    string(&mut out, address);
    let tags: String = std::iter::once(',')
        .chain(args.iter().map(|a| match a {
            OscArg::Int(_) => 'i',
            OscArg::Float(_) => 'f',
            OscArg::Text(_) => 's',
        }))
        .collect();
    string(&mut out, &tags);
    for arg in args {
        match arg {
            OscArg::Int(n) => out.extend(n.to_be_bytes()),
            OscArg::Float(n) => out.extend(n.to_be_bytes()),
            OscArg::Text(s) => string(&mut out, s),
        }
    }
    out
}
/// The Unity values of an OpenSekai (three.js) transform: the inverse of `unity_pose` in the decoder.
pub fn unity_transform(position: Vec3, rotation: Quat) -> [f32; 7] {
    [
        position[0] as f32,
        position[1] as f32,
        -position[2] as f32,
        -rotation[0] as f32,
        -rotation[1] as f32,
        rotation[2] as f32,
        rotation[3] as f32,
    ]
}
/// The VMC (Unity) bone name: the decoder thumb mapping reversed, with the first letter in upper case.
pub fn unity_bone_name(name: &str) -> String {
    let name = match name {
        "leftThumbMetacarpal" => "leftThumbProximal",
        "rightThumbMetacarpal" => "rightThumbProximal",
        "leftThumbProximal" => "leftThumbIntermediate",
        "rightThumbProximal" => "rightThumbIntermediate",
        other => other,
    };
    let mut chars = name.chars();
    chars
        .next()
        .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
        .unwrap_or_default()
}
fn transform_message(address: &str, name: &str, t: &VmcTransform) -> Vec<u8> {
    let v = unity_transform(t.position, t.rotation);
    let mut args = vec![OscArg::Text(name)];
    args.extend(v.iter().map(|n| OscArg::Float(*n)));
    message(address, &args)
}
/// The messages of one pose in send order: OK, T, the root, the bones in `HUMANOID_BONES` order,
/// the blends in name order, then Apply. A blend name that cannot go into an OSC string is left out.
pub fn vmc_messages(pose: &VmcSendPose, seconds: f32) -> Vec<Vec<u8>> {
    let mut out = vec![
        message("/VMC/Ext/OK", &[OscArg::Int(1)]),
        message("/VMC/Ext/T", &[OscArg::Float(seconds)]),
        transform_message("/VMC/Ext/Root/Pos", "root", &pose.root),
    ];
    for name in HUMANOID_BONES {
        if let Some(bone) = pose.bones.get(name) {
            out.push(transform_message(
                "/VMC/Ext/Bone/Pos",
                &unity_bone_name(name),
                bone,
            ));
        }
    }
    for (name, weight) in &pose.blends {
        if vmc_blend_name_ok(name) {
            out.push(message(
                "/VMC/Ext/Blend/Val",
                &[OscArg::Text(name), OscArg::Float(*weight as f32)],
            ));
        }
    }
    out.push(message("/VMC/Ext/Blend/Apply", &[]));
    out
}
/// Packs the messages in order into OSC bundles (time tag 1) of at most `MAX_DATAGRAM_BYTES`
/// bytes and `MAX_DATAGRAM_MESSAGES` messages each.
pub fn bundles(messages: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let header = || {
        let mut b = Vec::with_capacity(MAX_DATAGRAM_BYTES);
        b.extend(b"#bundle\0");
        b.extend(1u64.to_be_bytes());
        b
    };
    let mut out = vec![];
    let mut current = header();
    let mut count = 0;
    for m in messages {
        if count > 0
            && (count == MAX_DATAGRAM_MESSAGES || current.len() + 4 + m.len() > MAX_DATAGRAM_BYTES)
        {
            out.push(std::mem::replace(&mut current, header()));
            count = 0;
        }
        current.extend((m.len() as u32).to_be_bytes());
        current.extend(m);
        count += 1;
    }
    if current.len() > BUNDLE_HEADER {
        out.push(current);
    }
    out
}
pub fn encode_vmc_pose(pose: &VmcSendPose, seconds: f32) -> Vec<Vec<u8>> {
    bundles(vmc_messages(pose, seconds))
}
#[cfg(test)]
mod tests {
    use super::super::parser::Decoder;
    use super::*;
    use std::collections::BTreeMap;
    fn unit(q: [f64; 4]) -> Quat {
        let n = q.iter().map(|v| v * v).sum::<f64>().sqrt();
        q.map(|v| v / n)
    }
    fn transform(seed: f64) -> VmcTransform {
        VmcTransform {
            position: [seed * 0.1, 1. + seed * 0.01, -seed * 0.2],
            rotation: unit([0.1 * seed, -0.2, 0.3 + seed * 0.01, 0.9]),
        }
    }
    fn pose(bones: usize, blends: usize) -> VmcSendPose {
        VmcSendPose {
            sender_id: "vmc_sender".into(),
            root: transform(0.5),
            bones: HUMANOID_BONES
                .iter()
                .take(bones)
                .enumerate()
                .map(|(i, name)| (name.to_string(), transform(i as f64)))
                .collect(),
            blends: (0..blends)
                .map(|i| (format!("Blend{i:02}"), i as f64 / 64.))
                .collect(),
        }
    }
    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() <= 1e-6 * a.abs().max(1.)
    }
    fn decode(datagrams: &[Vec<u8>]) -> Decoder {
        let mut decoder = Decoder::default();
        for d in datagrams {
            decoder.vmc(d).unwrap();
        }
        decoder
    }
    fn assert_round_trip(pose: &VmcSendPose) {
        let datagrams = encode_vmc_pose(pose, 1.5);
        let decoder = decode(&datagrams);
        let root = decoder.root.as_ref().unwrap();
        for i in 0..3 {
            assert!(close(root.position[i], pose.root.position[i]));
        }
        for i in 0..4 {
            assert!(close(root.rotation[i], pose.root.rotation[i]));
        }
        assert_eq!(decoder.bones.len(), pose.bones.len());
        for (name, sent) in &pose.bones {
            let got = &decoder.bones[name];
            assert_eq!(got.space, BoneSpace::Raw);
            let position = got.position.unwrap();
            let same = |a: &[f64], b: &[f64]| a.iter().zip(b).all(|(x, y)| close(*x, *y));
            assert!(same(&position, &sent.position), "{name} position");
            assert!(same(&got.rotation, &sent.rotation), "{name} rotation");
        }
        let blends: BTreeMap<String, f64> = pose.blends.clone();
        assert_eq!(decoder.expressions.len(), blends.len());
        for (name, weight) in blends {
            assert!(close(decoder.expressions[&name], weight), "{name}");
        }
    }
    #[test]
    fn inverse_conversion_matches_the_decoder() {
        assert_eq!(
            unity_transform([1., 2., 3.], [0.1, 0.2, 0.3, 0.927]),
            [1., 2., -3., -0.1, -0.2, 0.3, 0.927]
        );
        assert_round_trip(&pose(1, 0));
    }
    #[test]
    fn thumb_names_reverse_the_decoder_mapping() {
        assert_eq!(unity_bone_name("leftThumbMetacarpal"), "LeftThumbProximal");
        assert_eq!(
            unity_bone_name("leftThumbProximal"),
            "LeftThumbIntermediate"
        );
        assert_eq!(
            unity_bone_name("rightThumbMetacarpal"),
            "RightThumbProximal"
        );
        assert_eq!(
            unity_bone_name("rightThumbProximal"),
            "RightThumbIntermediate"
        );
        assert_eq!(unity_bone_name("leftThumbDistal"), "LeftThumbDistal");
        assert_eq!(unity_bone_name("upperChest"), "UpperChest");
        let mut thumbs = pose(0, 0);
        for name in [
            "leftThumbMetacarpal",
            "leftThumbProximal",
            "leftThumbDistal",
            "rightThumbMetacarpal",
            "rightThumbProximal",
        ] {
            thumbs.bones.insert(name.into(), transform(2.));
        }
        assert_round_trip(&thumbs);
    }
    #[test]
    fn full_pose_splits_and_round_trips() {
        let full = pose(55, 64);
        let datagrams = encode_vmc_pose(&full, 0.);
        assert!(datagrams.len() > 1);
        for d in &datagrams {
            assert!(d.len() <= MAX_DATAGRAM_BYTES, "{}", d.len());
            assert!(d.len() <= 8192);
            assert!(d.starts_with(b"#bundle\0"));
            assert_eq!(&d[8..16], &1u64.to_be_bytes());
            // Each element is one message; count them through the size fields.
            let (mut i, mut count) = (16, 0);
            while i < d.len() {
                let size = u32::from_be_bytes(d[i..i + 4].try_into().unwrap()) as usize;
                i += 4 + size;
                count += 1;
            }
            assert_eq!(i, d.len());
            // At most 32, inside the decoder limit of 64.
            assert!(count <= MAX_DATAGRAM_MESSAGES);
        }
        assert_round_trip(&full);
    }
    #[test]
    fn order_is_ok_time_root_bones_blends_apply() {
        let p = pose(3, 2);
        let messages = vmc_messages(&p, 2.);
        let address = |m: &Vec<u8>| {
            let end = m.iter().position(|b| *b == 0).unwrap();
            String::from_utf8(m[..end].to_vec()).unwrap()
        };
        let list: Vec<String> = messages.iter().map(address).collect();
        assert_eq!(
            list,
            [
                "/VMC/Ext/OK",
                "/VMC/Ext/T",
                "/VMC/Ext/Root/Pos",
                "/VMC/Ext/Bone/Pos",
                "/VMC/Ext/Bone/Pos",
                "/VMC/Ext/Bone/Pos",
                "/VMC/Ext/Blend/Val",
                "/VMC/Ext/Blend/Val",
                "/VMC/Ext/Blend/Apply"
            ]
        );
        assert!(messages[0].ends_with(&1i32.to_be_bytes()));
        assert!(messages[1].ends_with(&2f32.to_be_bytes()));
        let datagrams = bundles(messages);
        assert_eq!(datagrams.len(), 1);
        let first = &datagrams[0];
        assert_eq!(&first[20..32], b"/VMC/Ext/OK\0");
        assert!(first.ends_with(b"/VMC/Ext/Blend/Apply\0\0\0\0,\0\0\0"));
    }
    #[test]
    fn split_keeps_the_message_limit() {
        let small: Vec<Vec<u8>> = (0..70).map(|_| message("/a", &[])).collect();
        let datagrams = bundles(small);
        assert_eq!(datagrams.len(), 3);
        let counts: Vec<usize> = datagrams
            .iter()
            .map(|d| (d.len() - BUNDLE_HEADER) / (4 + 8))
            .collect();
        assert_eq!(counts, [32, 32, 6]);
    }
    #[test]
    fn invalid_blend_names_are_left_out() {
        let mut p = pose(0, 0);
        p.blends.insert("a\0b".into(), 0.5);
        p.blends.insert("x".repeat(129), 0.5);
        p.blends.insert("Joy".into(), 0.25);
        let decoder = decode(&encode_vmc_pose(&p, 0.));
        assert_eq!(decoder.expressions.len(), 1);
        assert_eq!(decoder.expressions["Joy"], 0.25);
    }
}
