use opensekai_contracts::*;
use std::collections::BTreeMap;
const MAX_OSC_MESSAGES: usize = 256;
#[derive(Default, Clone)]
pub struct Decoder {
    pub bones: BTreeMap<String, TrackingBone>,
    pub expressions: BTreeMap<String, f64>,
    pub root: Option<TrackingRoot>,
    staged: BTreeMap<String, f64>,
}

#[derive(Debug)]
#[allow(dead_code)]
enum Arg {
    String(String),
    Float(f64),
    Int(i32),
    Long(i64),
    Double(f64),
    Blob(Vec<u8>),
    Time(u64),
    Bool(bool),
    Nil,
    Impulse,
}
fn number(arg: &Arg) -> Result<f64, AppError> {
    let n = match arg {
        Arg::Float(n) | Arg::Double(n) => *n,
        Arg::Int(n) => *n as f64,
        _ => return Err(invalid("Invalid OSC number")),
    };
    if n.is_finite() {
        Ok(n)
    } else {
        Err(invalid("Invalid OSC number"))
    }
}
fn word<const N: usize>(bytes: &[u8], offset: &mut usize) -> Result<[u8; N], AppError> {
    let word = bytes
        .get(*offset..*offset + N)
        .ok_or_else(|| invalid("Truncated OSC number"))?
        .try_into()
        .unwrap();
    *offset += N;
    Ok(word)
}
fn blob(bytes: &[u8], offset: &mut usize) -> Result<Vec<u8>, AppError> {
    let size = usize::try_from(i32::from_be_bytes(word(bytes, offset)?))
        .map_err(|_| invalid("Invalid OSC blob"))?;
    let start = *offset;
    let end = start
        .checked_add(size)
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| invalid("Truncated OSC blob"))?;
    *offset = (end + 3) & !3;
    if *offset > bytes.len() || bytes[end..*offset].iter().any(|b| *b != 0) {
        return Err(invalid("Invalid OSC padding"));
    }
    Ok(bytes[start..end].to_vec())
}
fn finite(n: f64) -> Result<f64, AppError> {
    if n.is_finite() {
        Ok(n)
    } else {
        Err(invalid("Nonfinite OSC number"))
    }
}
fn text(arg: &Arg) -> Result<&str, AppError> {
    if let Arg::String(s) = arg {
        Ok(s)
    } else {
        Err(invalid("Invalid OSC string"))
    }
}
fn string<'a>(bytes: &'a [u8], offset: &mut usize) -> Result<&'a str, AppError> {
    let start = *offset;
    let end = bytes
        .get(start..)
        .and_then(|b| b.iter().position(|c| *c == 0))
        .map(|n| start + n)
        .ok_or_else(|| invalid("Truncated OSC string"))?;
    *offset = (end + 4) & !3;
    if *offset > bytes.len() || bytes[end..*offset].iter().any(|b| *b != 0) {
        return Err(invalid("Invalid OSC padding"));
    }
    std::str::from_utf8(&bytes[start..end]).map_err(|_| invalid("Invalid OSC text"))
}
fn messages(bytes: &[u8], depth: usize, out: &mut Vec<(String, Vec<Arg>)>) -> Result<(), AppError> {
    if depth > 4 || bytes.len() > 8192 {
        return Err(invalid("OSC budget exceeded"));
    }
    if bytes.starts_with(b"#bundle\0") {
        if bytes.len() < 16 {
            return Err(invalid("Truncated OSC bundle"));
        }
        let mut i = 16;
        while i < bytes.len() {
            let size = u32::from_be_bytes(
                bytes
                    .get(i..i + 4)
                    .ok_or_else(|| invalid("Truncated OSC bundle"))?
                    .try_into()
                    .unwrap(),
            ) as usize;
            i += 4;
            if size == 0 {
                return Err(invalid("Empty OSC element"));
            }
            let end = i.checked_add(size).ok_or_else(|| invalid("OSC overflow"))?;
            messages(
                bytes
                    .get(i..end)
                    .ok_or_else(|| invalid("Truncated OSC element"))?,
                depth + 1,
                out,
            )?;
            i = end;
        }
        return Ok(());
    }
    if out.len() >= MAX_OSC_MESSAGES {
        return Err(invalid("Too many OSC messages"));
    }
    let mut i = 0;
    let address = string(bytes, &mut i)?.to_owned();
    if !address.starts_with('/') {
        return Err(invalid("Invalid OSC address"));
    }
    let tags = string(bytes, &mut i)?
        .strip_prefix(',')
        .ok_or_else(|| invalid("Invalid OSC types"))?
        .to_owned();
    let mut args = vec![];
    for tag in tags.chars() {
        args.push(match tag {
            's' => Arg::String(string(bytes, &mut i)?.to_owned()),
            'f' => Arg::Float(finite(f32::from_be_bytes(word(bytes, &mut i)?) as f64)?),
            'i' => Arg::Int(i32::from_be_bytes(word(bytes, &mut i)?)),
            'd' => Arg::Double(finite(f64::from_be_bytes(word(bytes, &mut i)?))?),
            'h' => Arg::Long(i64::from_be_bytes(word(bytes, &mut i)?)),
            't' => Arg::Time(u64::from_be_bytes(word(bytes, &mut i)?)),
            'b' => Arg::Blob(blob(bytes, &mut i)?),
            'T' => Arg::Bool(true),
            'F' => Arg::Bool(false),
            'N' => Arg::Nil,
            'I' => Arg::Impulse,
            _ => return Err(invalid("Unsupported OSC type")),
        });
    }
    if i != bytes.len() {
        return Err(invalid("Trailing OSC bytes"));
    }
    out.push((address, args));
    Ok(())
}
fn normalized(q: Quat) -> Result<Quat, AppError> {
    let norm = q.iter().map(|n| n * n).sum::<f64>().sqrt();
    if !norm.is_finite() || norm < 1e-8 {
        return Err(invalid("Invalid quaternion"));
    }
    Ok(q.map(|n| n / norm))
}
fn unity_pose(args: &[Arg]) -> Result<TrackingRoot, AppError> {
    if args.len() != 8 && args.len() != 14 {
        return Err(invalid("Invalid VMC transform"));
    }
    text(&args[0])?;
    let mut values = Vec::new();
    for a in &args[1..] {
        values.push(number(a)?);
    }
    Ok(TrackingRoot {
        position: [values[0], values[1], -values[2]],
        rotation: normalized([-values[3], -values[4], values[5], values[6]])?,
    })
}
fn euler(degrees: &[f64]) -> Quat {
    let x = degrees[0].to_radians() / 2.;
    let y = degrees[1].to_radians() / 2.;
    let z = degrees[2].to_radians() / 2.;
    let (sx, cx) = x.sin_cos();
    let (sy, cy) = y.sin_cos();
    let (sz, cz) = z.sin_cos();
    [
        -(sx * cy * cz + cx * sy * sz),
        -(cx * sy * cz - sx * cy * sz),
        cx * cy * sz - sx * sy * cz,
        cx * cy * cz + sx * sy * sz,
    ]
}
impl Decoder {
    pub fn vmc(&mut self, bytes: &[u8]) -> Result<bool, AppError> {
        let mut list = vec![];
        messages(bytes, 0, &mut list)?;
        let mut next = self.clone();
        let mut recognized = false;
        for (address, args) in list {
            match address.as_str() {
                "/VMC/Ext/Bone/Pos" => {
                    if args.len() != 8 {
                        return Err(invalid("Invalid VMC bone"));
                    }
                    let name = text(&args[0])?;
                    let mut chars = name.chars();
                    let name = chars
                        .next()
                        .map(|c| c.to_ascii_lowercase().to_string() + chars.as_str())
                        .unwrap_or_default();
                    let name = match name.as_str() {
                        "leftThumbProximal" => "leftThumbMetacarpal".into(),
                        "rightThumbProximal" => "rightThumbMetacarpal".into(),
                        "leftThumbIntermediate" => "leftThumbProximal".into(),
                        "rightThumbIntermediate" => "rightThumbProximal".into(),
                        _ => name,
                    };
                    let pose = unity_pose(&args)?;
                    if !humanoid_bone(&name) {
                        continue;
                    }
                    next.bones.insert(
                        name,
                        TrackingBone {
                            rotation: pose.rotation,
                            space: BoneSpace::Raw,
                            position: Some(pose.position),
                            weight: None,
                        },
                    );
                    recognized = true;
                }
                "/VMC/Ext/Root/Pos" => {
                    next.root = Some(unity_pose(&args)?);
                    recognized = true;
                }
                "/VMC/Ext/Blend/Val" => {
                    if args.len() != 2 {
                        return Err(invalid("Invalid VMC expression"));
                    }
                    let name = text(&args[0])?;
                    if name.is_empty() || name.encode_utf16().count() > 128 {
                        return Err(invalid("Invalid expression name"));
                    }
                    next.staged
                        .insert(name.into(), number(&args[1])?.clamp(0., 1.));
                    if next.staged.len() > 64 {
                        return Err(invalid("Too many expressions"));
                    }
                }
                "/VMC/Ext/Blend/Apply" => {
                    if !args.is_empty() {
                        return Err(invalid("Invalid blend Apply"));
                    }
                    next.expressions = std::mem::take(&mut next.staged);
                    recognized = true;
                }
                "/VMC/Ext/OK" => {
                    if args.is_empty()
                        || args.len() > 4
                        || !args.iter().all(|a| matches!(a,Arg::Int(n) if *n>=0))
                    {
                        return Err(invalid("Invalid VMC OK"));
                    }
                }
                "/VMC/Ext/T" => {
                    if args.len() != 1 {
                        return Err(invalid("Invalid VMC time"));
                    }
                    number(&args[0])?;
                }
                _ => {}
            }
        }
        if next.bones.len() > 64 {
            return Err(invalid("Too many bones"));
        }
        *self = next;
        Ok(recognized)
    }
    pub fn ifacial(&mut self, bytes: &[u8]) -> Result<bool, AppError> {
        if bytes.len() > 8192 {
            return Err(invalid("IFacial budget exceeded"));
        }
        let text = std::str::from_utf8(bytes).map_err(|_| invalid("Invalid IFacial text"))?;
        let mut next = Self::default();
        let mut count = 0;
        for part in text.split('|').filter(|p| !p.trim().is_empty()) {
            count += 1;
            if count > 64 {
                return Err(invalid("Too many IFacial channels"));
            }
            let part = part.trim();
            if let Some((name, values)) = part.split_once('#') {
                let name = name.trim_start_matches('=').trim();
                let values = values
                    .split(',')
                    .map(|n| {
                        n.trim()
                            .parse::<f64>()
                            .map_err(|_| invalid("Invalid IFacial angle"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if values.iter().any(|n| !n.is_finite()) {
                    return Err(invalid("Invalid IFacial transform"));
                }
                if !["head", "leftEye", "rightEye"].contains(&name) {
                    continue;
                }
                if values.len() != if name == "head" { 6 } else { 3 } {
                    return Err(invalid("Invalid IFacial transform"));
                }
                next.bones.insert(
                    name.into(),
                    TrackingBone {
                        rotation: euler(&values),
                        space: BoneSpace::Normalized,
                        position: None,
                        weight: None,
                    },
                );
            } else {
                let (name, value) = part
                    .split_once('&')
                    .or_else(|| part.split_once('-'))
                    .ok_or_else(|| invalid("Invalid IFacial expression"))?;
                let name = name.trim();
                let value = value
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| invalid("Invalid IFacial weight"))?;
                if name.is_empty() || name.encode_utf16().count() > 128 || !value.is_finite() {
                    return Err(invalid("Invalid IFacial expression"));
                }
                next.expressions
                    .insert(name.into(), (value / 100.).clamp(0., 1.));
            }
        }
        if count == 0 {
            return Err(invalid("Empty IFacial packet"));
        }
        *self = next;
        Ok(true)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn osc(address: &str, tags: &str, values: &[&[u8]]) -> Vec<u8> {
        fn string(b: &mut Vec<u8>, s: &str) {
            b.extend(s.as_bytes());
            b.push(0);
            while !b.len().is_multiple_of(4) {
                b.push(0);
            }
        }
        let mut b = vec![];
        string(&mut b, address);
        string(&mut b, tags);
        for v in values {
            b.extend(*v);
        }
        b
    }
    fn float(v: f32) -> [u8; 4] {
        v.to_be_bytes()
    }
    #[test]
    fn bundle_message_cap_is_inclusive() {
        let bundle = |count: usize| {
            let message = osc("/VMC/Ext/OK", ",i", &[&1i32.to_be_bytes()]);
            let mut b = b"#bundle\0".to_vec();
            b.extend([0; 8]);
            for _ in 0..count {
                b.extend((message.len() as u32).to_be_bytes());
                b.extend(&message);
            }
            b
        };
        let mut d = Decoder::default();
        assert!(d.vmc(&bundle(MAX_OSC_MESSAGES)).is_ok());
        let error = d.vmc(&bundle(MAX_OSC_MESSAGES + 1)).unwrap_err();
        assert!(format!("{error:?}").contains("Too many OSC messages"));
    }
    #[test]
    fn vmc_preserves_apply_and_converts_raw_bone() {
        let mut d = Decoder::default();
        let value = osc("/VMC/Ext/Blend/Val", ",sf", &[b"Joy\0", &float(0.5)]);
        assert!(!d.vmc(&value).unwrap());
        assert!(d.expressions.is_empty());
        d.vmc(&osc("/VMC/Ext/Blend/Apply", ",", &[])).unwrap();
        assert_eq!(d.expressions["Joy"], 0.5);
        d.vmc(&osc(
            "/VMC/Ext/Bone/Pos",
            ",sfffffff",
            &[
                b"Head\0\0\0\0",
                &float(1.),
                &float(2.),
                &float(3.),
                &float(0.),
                &float(0.),
                &float(0.),
                &float(1.),
            ],
        ))
        .unwrap();
        assert_eq!(d.bones["head"].position, Some([1., 2., -3.]));
        assert_eq!(d.bones["head"].space, BoneSpace::Raw);
    }
    #[test]
    fn unity_thumb_names_map_to_canonical_vrm1() {
        let mut d = Decoder::default();
        for (input, expected) in [
            (b"LeftThumbProximal\0\0\0".as_slice(), "leftThumbMetacarpal"),
            (
                b"LeftThumbIntermediate\0\0\0".as_slice(),
                "leftThumbProximal",
            ),
        ] {
            d.vmc(&osc(
                "/VMC/Ext/Bone/Pos",
                ",sfffffff",
                &[
                    input,
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(1.),
                ],
            ))
            .unwrap();
            assert!(d.bones.contains_key(expected));
        }
    }
    #[test]
    fn ifacial_v2_legacy_degree_and_bounds() {
        let mut d = Decoder::default();
        d.ifacial(b"jawOpen&150|eyeBlink_L&-4|=head#0,90,0,1,2,3|leftEye#0,0,0|")
            .unwrap();
        assert_eq!(d.expressions["jawOpen"], 1.);
        assert_eq!(d.expressions["eyeBlink_L"], 0.);
        assert!((d.bones["head"].rotation[1] + std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-8);
        d.ifacial(b"jawOpen-50|").unwrap();
        assert_eq!(d.expressions["jawOpen"], 0.5);
        assert!(d.ifacial(b"jawOpen&NaN|").is_err());
    }
    #[test]
    fn parser_rejects_truncation_unknown_bones_and_nonfinite() {
        let mut d = Decoder::default();
        assert!(d.vmc(b"/VMC").is_err());
        assert!(d
            .vmc(&osc(
                "/VMC/Ext/Blend/Val",
                ",sf",
                &[b"Joy\0", &float(f32::NAN)]
            ))
            .is_err());
    }
}
#[cfg(test)]
mod freshness_tests {
    use super::*;
    #[test]
    fn heartbeat_does_not_refresh_held_pose() {
        let mut d = Decoder::default();
        let mut b = b"/VMC/Ext/T\0\0".to_vec();
        b.extend(b",f\0\0");
        b.extend(1f32.to_be_bytes());
        assert!(!d.vmc(&b).unwrap());
    }
}
#[cfg(test)]
mod bundle_tests {
    use super::*;
    fn bundle(message: &[u8]) -> Vec<u8> {
        let mut b = b"#bundle\0".to_vec();
        b.extend([0; 8]);
        b.extend((message.len() as u32).to_be_bytes());
        b.extend(message);
        b
    }
    #[test]
    fn rejects_excess_depth_count_and_oversized_datagram() {
        let mut d = Decoder::default();
        let mut pulse = b"/VMC/Ext/T\0\0,f\0\0".to_vec();
        pulse.extend(1f32.to_be_bytes());
        let mut deep = pulse.clone();
        for _ in 0..5 {
            deep = bundle(&deep);
        }
        assert!(d.vmc(&deep).is_err());
        let mut many = b"#bundle\0".to_vec();
        many.extend([0; 8]);
        for _ in 0..=MAX_OSC_MESSAGES {
            many.extend((pulse.len() as u32).to_be_bytes());
            many.extend(&pulse);
        }
        assert!(d.vmc(&many).is_err());
        assert!(d.vmc(&[0; 8193]).is_err());
    }
    #[test]
    fn malformed_packet_does_not_commit_partial_channels() {
        let mut d = Decoder::default();
        let bytes = b"/VMC/Ext/Blend/Val\0\0\0,sf\0Joy\0\x3f\x00\x00\x00";
        let mut b = bundle(bytes);
        b.extend(3u32.to_be_bytes());
        b.extend(b"bad");
        assert!(d.vmc(&b).is_err());
        assert!(d.staged.is_empty());
    }
}
#[cfg(test)]
mod tolerance_tests {
    use super::*;
    fn pad(b: &mut Vec<u8>) {
        while !b.len().is_multiple_of(4) {
            b.push(0);
        }
    }
    fn string(b: &mut Vec<u8>, s: &str) {
        b.extend(s.as_bytes());
        b.push(0);
        pad(b);
    }
    fn message(address: &str, tags: &str, payload: &[u8]) -> Vec<u8> {
        let mut b = vec![];
        string(&mut b, address);
        string(&mut b, tags);
        b.extend(payload);
        b
    }
    fn bundle(messages: &[Vec<u8>]) -> Vec<u8> {
        let mut b = b"#bundle\0".to_vec();
        b.extend([0; 8]);
        for m in messages {
            b.extend((m.len() as u32).to_be_bytes());
            b.extend(m);
        }
        b
    }
    fn pose(name: &str, values: [f32; 7]) -> Vec<u8> {
        let mut payload = vec![];
        string(&mut payload, name);
        for v in values {
            payload.extend(v.to_be_bytes());
        }
        message("/VMC/Ext/Bone/Pos", ",sfffffff", &payload)
    }
    fn bone(name: &str) -> Vec<u8> {
        pose(name, [0., 0., 0., 0., 0., 0., 1.])
    }
    // Ignored address with every extended tag, in tag order h d t s b T F N I.
    fn extended(blob: &[u8]) -> Vec<u8> {
        let mut payload = vec![];
        payload.extend((-2i64).to_be_bytes());
        payload.extend(1.5f64.to_be_bytes());
        payload.extend(7u64.to_be_bytes());
        string(&mut payload, "x");
        payload.extend(blob);
        message("/VMC/Ext/Hmd/Pos", ",hdtsbTFNI", &payload)
    }
    fn blob(len: i32, data: &[u8]) -> Vec<u8> {
        let mut b = len.to_be_bytes().to_vec();
        b.extend(data);
        b
    }
    #[test]
    fn extended_type_tags_read_with_osc_sizes() {
        let mut d = Decoder::default();
        assert!(!d.vmc(&extended(&blob(3, b"abc\0"))).unwrap());
        assert!(!d.vmc(&extended(&blob(4, b"abcd"))).unwrap());
        assert!(!d.vmc(&extended(&blob(0, b""))).unwrap());
        // Bad blob padding, negative length, length past the end.
        assert!(d.vmc(&extended(&blob(3, b"abc\x01"))).is_err());
        assert!(d.vmc(&extended(&blob(-1, b""))).is_err());
        assert!(d.vmc(&extended(&blob(8, b"abcd"))).is_err());
        // Truncated 8-byte word and trailing bytes.
        assert!(d.vmc(&message("/VMC/Ext/X", ",h", &[0, 0, 0, 0])).is_err());
        assert!(d.vmc(&message("/VMC/Ext/X", ",T", &[0, 0, 0, 0])).is_err());
        // Non-finite double.
        assert!(d
            .vmc(&message("/VMC/Ext/X", ",d", &f64::NAN.to_be_bytes()))
            .is_err());
    }
    #[test]
    fn ignored_address_with_known_tags_never_rejects_handled_data() {
        let mut d = Decoder::default();
        let mut payload = vec![];
        payload.extend(2.0f64.to_be_bytes());
        payload.extend(blob(2, b"hi\0\0"));
        let extra = message("/VMC/Ext/Con", ",Tdb", &payload);
        assert!(d.vmc(&bundle(&[extra, bone("Head")])).unwrap());
        assert!(d.bones.contains_key("head"));
    }
    #[test]
    fn unknown_tag_rejects_also_in_ignored_address() {
        let mut d = Decoder::default();
        for tags in [",c", ",r", ",m", ",S", ",[]"] {
            let extra = message("/VMC/Ext/Other", tags, &[0, 0, 0, 65]);
            assert!(d.vmc(&bundle(&[bone("Head"), extra])).is_err(), "{tags}");
        }
        assert!(d.bones.is_empty());
    }
    #[test]
    fn handled_numbers_accept_double_and_int() {
        let mut d = Decoder::default();
        let mut payload = vec![];
        string(&mut payload, "Head");
        payload.extend(1.0f64.to_be_bytes());
        payload.extend(2i32.to_be_bytes());
        payload.extend(3.0f32.to_be_bytes());
        for v in [0.0f64, 0., 0., 1.] {
            payload.extend(v.to_be_bytes());
        }
        assert!(d
            .vmc(&message("/VMC/Ext/Bone/Pos", ",sdifdddd", &payload))
            .unwrap());
        assert_eq!(d.bones["head"].position, Some([1., 2., -3.]));
        let mut blend = vec![];
        string(&mut blend, "Joy");
        blend.extend(0.25f64.to_be_bytes());
        d.vmc(&bundle(&[
            message("/VMC/Ext/Blend/Val", ",sd", &blend),
            message("/VMC/Ext/Blend/Apply", ",", &[]),
        ]))
        .unwrap();
        assert_eq!(d.expressions["Joy"], 0.25);
    }
    #[test]
    fn unknown_bone_between_known_bones_is_skipped() {
        let mut d = Decoder::default();
        let packet = bundle(&[bone("Head"), bone("Tail"), bone("Neck")]);
        assert!(d.vmc(&packet).unwrap());
        assert_eq!(d.bones.keys().collect::<Vec<_>>(), vec!["head", "neck"]);
    }
    #[test]
    fn malformed_unknown_bone_rejects() {
        let mut d = Decoder::default();
        let zero = pose("Tail", [0.; 7]);
        let short = message("/VMC/Ext/Bone/Pos", ",sf", b"Tail\0\0\0\0\0\0\0\0");
        let nan = pose("Tail", [f32::NAN, 0., 0., 0., 0., 0., 1.]);
        for bad in [zero, short, nan] {
            assert!(d.vmc(&bundle(&[bone("Head"), bad])).is_err());
        }
        assert!(d.bones.is_empty());
    }
    const BONES: [&str; 55] = [
        "Hips",
        "Spine",
        "Chest",
        "UpperChest",
        "Neck",
        "Head",
        "LeftEye",
        "RightEye",
        "Jaw",
        "LeftUpperLeg",
        "LeftLowerLeg",
        "LeftFoot",
        "LeftToes",
        "RightUpperLeg",
        "RightLowerLeg",
        "RightFoot",
        "RightToes",
        "LeftShoulder",
        "LeftUpperArm",
        "LeftLowerArm",
        "LeftHand",
        "RightShoulder",
        "RightUpperArm",
        "RightLowerArm",
        "RightHand",
        "LeftThumbProximal",
        "LeftThumbIntermediate",
        "LeftThumbDistal",
        "LeftIndexProximal",
        "LeftIndexIntermediate",
        "LeftIndexDistal",
        "LeftMiddleProximal",
        "LeftMiddleIntermediate",
        "LeftMiddleDistal",
        "LeftRingProximal",
        "LeftRingIntermediate",
        "LeftRingDistal",
        "LeftLittleProximal",
        "LeftLittleIntermediate",
        "LeftLittleDistal",
        "RightThumbProximal",
        "RightThumbIntermediate",
        "RightThumbDistal",
        "RightIndexProximal",
        "RightIndexIntermediate",
        "RightIndexDistal",
        "RightMiddleProximal",
        "RightMiddleIntermediate",
        "RightMiddleDistal",
        "RightRingProximal",
        "RightRingIntermediate",
        "RightRingDistal",
        "RightLittleProximal",
        "RightLittleIntermediate",
        "RightLittleDistal",
    ];
    #[test]
    fn skipped_bones_do_not_count_toward_bone_limit() {
        let mut d = Decoder::default();
        let mut all: Vec<_> = BONES.iter().map(|n| bone(n)).collect();
        all.extend((0..9).map(|n| bone(&format!("Extra{n}"))));
        assert!(d.vmc(&bundle(&all)).unwrap());
        assert_eq!(d.bones.len(), 55);
        let unknown: Vec<_> = (0..64).map(|n| bone(&format!("Tail{n}"))).collect();
        assert!(!d.vmc(&bundle(&unknown)).unwrap());
        assert_eq!(d.bones.len(), 55);
    }
    #[test]
    fn only_unknown_bones_is_not_recognized() {
        let mut d = Decoder::default();
        assert!(!d.vmc(&bundle(&[bone("Tail"), bone("Wing")])).unwrap());
        assert!(d.bones.is_empty());
    }
    #[test]
    fn bundle_applies_root_bone_and_expressions() {
        let mut d = Decoder::default();
        let mut root = vec![];
        string(&mut root, "root");
        for v in [1.0f32, 0., 2., 0., 0., 0., 1.] {
            root.extend(v.to_be_bytes());
        }
        let mut blend = vec![];
        string(&mut blend, "Joy");
        blend.extend(0.5f32.to_be_bytes());
        let packet = bundle(&[
            message("/VMC/Ext/Root/Pos", ",sfffffff", &root),
            bone("Head"),
            message("/VMC/Ext/Blend/Val", ",sf", &blend),
            message("/VMC/Ext/Blend/Apply", ",", &[]),
        ]);
        assert!(d.vmc(&packet).unwrap());
        assert_eq!(d.root.as_ref().unwrap().position, [1., 0., -2.]);
        assert!(d.bones.contains_key("head"));
        assert_eq!(d.expressions["Joy"], 0.5);
    }
    #[test]
    fn ifacial_unknown_bone_key_is_skipped_after_format_check() {
        let mut d = Decoder::default();
        assert!(d
            .ifacial(b"jawOpen&50|=head#0,10,0,0,0,0|hips#1,2,3|leftEye#0,0,0|")
            .unwrap());
        assert_eq!(d.expressions["jawOpen"], 0.5);
        assert_eq!(d.bones.keys().collect::<Vec<_>>(), vec!["head", "leftEye"]);
        assert!(d.ifacial(b"jawOpen&50|hips#1,NaN,3|").is_err());
        assert!(d.ifacial(b"jawOpen&50|hips#1,x,3|").is_err());
    }
}
