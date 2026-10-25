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
/// One OpenSeeFace face record in bytes (B20 R4). See the analysis for the layout.
pub const OSF_RECORD_BYTES: usize = 1785;
pub const OSF_MAX_RECORDS: usize = 4;
const OSF_FEATURES: usize = 14;
#[derive(Debug, Clone, PartialEq)]
pub struct OsfRecord {
    pub id: i32,
    pub success: bool,
    /// Right, then left, as the tracker sends them.
    pub eye_open: [f64; 2],
    pub quaternion: Quat,
    pub features: [f64; OSF_FEATURES],
}
fn osf_f32(record: &[u8], offset: usize) -> Result<f64, AppError> {
    let bytes: [u8; 4] = record
        .get(offset..offset + 4)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(|| invalid("Truncated OpenSeeFace record"))?;
    let n = f32::from_le_bytes(bytes) as f64;
    if n.is_finite() {
        Ok(n)
    } else {
        Err(invalid("Nonfinite OpenSeeFace value"))
    }
}
fn osf_record(record: &[u8]) -> Result<OsfRecord, AppError> {
    let id = record
        .get(8..12)
        .and_then(|b| b.try_into().ok())
        .map(i32::from_le_bytes)
        .ok_or_else(|| invalid("Truncated OpenSeeFace record"))?;
    let success = record.get(28).is_some_and(|b| *b != 0);
    let mut quaternion = [0.; 4];
    for (i, q) in quaternion.iter_mut().enumerate() {
        *q = osf_f32(record, 33 + i * 4)?;
    }
    let mut features = [0.; OSF_FEATURES];
    for (i, f) in features.iter_mut().enumerate() {
        *f = osf_f32(record, 1729 + i * 4)?;
    }
    Ok(OsfRecord {
        id,
        success,
        eye_open: [osf_f32(record, 20)?, osf_f32(record, 24)?],
        quaternion,
        features,
    })
}
/// Converts the tracker quaternion to the normalized head frame (B20 R6).
/// The tracker quaternion is the transpose of the OpenCV solvePnP rotation, solved on (row, column)
/// landmarks against a face model with +X at the performer's right, +Y up, and +Z out of the face.
/// The normalized frame has +X at the avatar's left, +Y up, and +Z forward. The analysis records
/// the derivation and the solvePnP cross-check.
pub fn osf_head(q: Quat) -> Quat {
    let [x, y, z, w] = q;
    let s = std::f64::consts::FRAC_1_SQRT_2;
    [s * (w + z), s * (w - z), s * (x + y), s * (x - y)]
}
/// Maps the eye values and the features to ARKit names (B20 analysis, "Feature to ARKit map").
pub fn osf_expressions(record: &OsfRecord) -> BTreeMap<String, f64> {
    let [right_open, left_open] = record.eye_open;
    let f = &record.features;
    let (brow_left, brow_right) = (f[3], f[6]);
    let (corner_left, corner_right) = (f[8], f[10]);
    let (open, wide) = (f[12], f[13]);
    [
        ("eyeBlinkLeft", 1. - left_open),
        ("eyeBlinkRight", 1. - right_open),
        ("jawOpen", open),
        ("mouthSmileLeft", corner_left),
        ("mouthFrownLeft", -corner_left),
        ("mouthSmileRight", corner_right),
        ("mouthFrownRight", -corner_right),
        ("mouthStretchLeft", wide),
        ("mouthStretchRight", wide),
        ("mouthFunnel", -wide),
        ("browOuterUpLeft", brow_left),
        ("browDownLeft", -brow_left),
        ("browOuterUpRight", brow_right),
        ("browDownRight", -brow_right),
        ("browInnerUp", (brow_left.max(0.) + brow_right.max(0.)) / 2.),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value.clamp(0., 1.)))
    .collect()
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
    /// Decodes one OpenSeeFace datagram (B20 R4–R6). `Ok(false)` means a valid datagram with no
    /// usable face, so the sample does not change.
    pub fn openseeface(&mut self, bytes: &[u8]) -> Result<bool, AppError> {
        let count = bytes.len() / OSF_RECORD_BYTES;
        if bytes.is_empty()
            || !bytes.len().is_multiple_of(OSF_RECORD_BYTES)
            || count > OSF_MAX_RECORDS
        {
            return Err(invalid("Invalid OpenSeeFace length"));
        }
        let mut chosen: Option<OsfRecord> = None;
        for chunk in bytes.chunks_exact(OSF_RECORD_BYTES) {
            let record = osf_record(chunk)?;
            if !record.success {
                continue;
            }
            // An unsuccessful fit sends a zero quaternion, so only a usable record has this check.
            let norm = record.quaternion.iter().map(|n| n * n).sum::<f64>().sqrt();
            if !(0.5..=2.).contains(&norm) {
                return Err(invalid("Invalid OpenSeeFace quaternion"));
            }
            if chosen.as_ref().is_none_or(|c| record.id < c.id) {
                chosen = Some(record);
            }
        }
        let Some(record) = chosen else {
            return Ok(false);
        };
        let mut next = Self::default();
        next.bones.insert(
            "head".into(),
            TrackingBone {
                rotation: osf_head(normalized(record.quaternion)?),
                space: BoneSpace::Normalized,
                position: None,
                weight: None,
            },
        );
        next.expressions = osf_expressions(&record);
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
#[cfg(test)]
mod openseeface_tests {
    use super::*;
    /// A hand-built record with the B20 layout. Each other field is zero.
    pub(crate) fn record(
        id: i32,
        success: bool,
        quaternion: [f32; 4],
        eyes: [f32; 2],
        features: [f32; 14],
    ) -> Vec<u8> {
        let mut b = vec![0u8; OSF_RECORD_BYTES];
        b[8..12].copy_from_slice(&id.to_le_bytes());
        for (i, v) in [640f32, 480., eyes[0], eyes[1]].iter().enumerate() {
            b[12 + i * 4..16 + i * 4].copy_from_slice(&v.to_le_bytes());
        }
        b[28] = u8::from(success);
        for (i, v) in quaternion.iter().enumerate() {
            b[33 + i * 4..37 + i * 4].copy_from_slice(&v.to_le_bytes());
        }
        for (i, v) in features.iter().enumerate() {
            b[1729 + i * 4..1733 + i * 4].copy_from_slice(&v.to_le_bytes());
        }
        b
    }
    type M = [[f64; 3]; 3];
    fn mul(a: M, b: M) -> M {
        let mut m = [[0.; 3]; 3];
        for (i, row) in m.iter_mut().enumerate() {
            for (j, v) in row.iter_mut().enumerate() {
                *v = (0..3).map(|k| a[i][k] * b[k][j]).sum();
            }
        }
        m
    }
    fn axis(axis: usize, degrees: f64) -> M {
        let (s, c) = degrees.to_radians().sin_cos();
        match axis {
            0 => [[1., 0., 0.], [0., c, -s], [0., s, c]],
            1 => [[c, 0., s], [0., 1., 0.], [-s, 0., c]],
            _ => [[c, -s, 0.], [s, c, 0.], [0., 0., 1.]],
        }
    }
    /// A port of `matrix_to_quaternion` in OpenSeeFace `tracker.py`.
    fn tracker_quaternion(m: M) -> [f32; 4] {
        let (t, q) = if m[2][2] < 0. {
            if m[0][0] > m[1][1] {
                let t = 1. + m[0][0] - m[1][1] - m[2][2];
                (
                    t,
                    [t, m[0][1] + m[1][0], m[2][0] + m[0][2], m[1][2] - m[2][1]],
                )
            } else {
                let t = 1. - m[0][0] + m[1][1] - m[2][2];
                (
                    t,
                    [m[0][1] + m[1][0], t, m[1][2] + m[2][1], m[2][0] - m[0][2]],
                )
            }
        } else if m[0][0] < -m[1][1] {
            let t = 1. - m[0][0] - m[1][1] + m[2][2];
            (
                t,
                [m[2][0] + m[0][2], m[1][2] + m[2][1], t, m[0][1] - m[1][0]],
            )
        } else {
            let t = 1. + m[0][0] + m[1][1] + m[2][2];
            (
                t,
                [m[1][2] - m[2][1], m[2][0] - m[0][2], m[0][1] - m[1][0], t],
            )
        };
        q.map(|v| (v * 0.5 / t.sqrt()) as f32)
    }
    /// The solvePnP rotation for a head pose in the normalized frame, by the matrix path:
    /// the image row and column swap, the face model reflection, and the camera axes.
    fn pose_quaternion(avatar: M) -> [f32; 4] {
        let swap_reflect = [[0., -1., 0.], [-1., 0., 0.], [0., 0., -1.]];
        let camera = [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]];
        tracker_quaternion(mul(swap_reflect, mul(camera, mul(avatar, camera))))
    }
    /// The direction of the avatar face (+Z) after the head rotation.
    fn forward(q: Quat) -> [f64; 3] {
        let [x, y, z, w] = q;
        [
            2. * (x * z + y * w),
            2. * (y * z - x * w),
            1. - 2. * (x * x + y * y),
        ]
    }
    fn up(q: Quat) -> [f64; 3] {
        let [x, y, z, w] = q;
        [
            2. * (x * y - z * w),
            1. - 2. * (x * x + z * z),
            2. * (y * z + x * w),
        ]
    }
    fn head(packet: &[u8]) -> Quat {
        let mut d = Decoder::default();
        assert!(d.openseeface(packet).unwrap());
        d.bones["head"].rotation
    }
    const OPEN: [f32; 2] = [1., 1.];
    #[test]
    fn length_must_be_one_to_four_records() {
        let one = record(0, true, pose_quaternion(axis(1, 0.)), OPEN, [0.; 14]);
        for n in 1..=4 {
            assert!(Decoder::default().openseeface(&one.repeat(n)).unwrap());
        }
        for len in [0, 1784, 1786, 8925] {
            let bytes = vec![0u8; len];
            assert!(Decoder::default().openseeface(&bytes).is_err(), "{len}");
        }
    }
    #[test]
    fn facing_the_camera_is_identity() {
        let q = head(&record(
            0,
            true,
            pose_quaternion(axis(1, 0.)),
            OPEN,
            [0.; 14],
        ));
        assert!((q[3].abs() - 1.).abs() < 1e-6, "{q:?}");
    }
    #[test]
    fn axis_signs_follow_the_performer() {
        // A turn to the performer's left moves the face toward +X (the avatar's left).
        let yaw = forward(head(&record(
            0,
            true,
            pose_quaternion(axis(1, 30.)),
            OPEN,
            [0.; 14],
        )));
        assert!(yaw[0] > 0.49 && yaw[0] < 0.51 && yaw[2] > 0.86, "{yaw:?}");
        // A pitch up moves the face toward +Y.
        let pitch = forward(head(&record(
            0,
            true,
            pose_quaternion(axis(0, -20.)),
            OPEN,
            [0.; 14],
        )));
        assert!(
            pitch[1] > 0.33 && pitch[1] < 0.35 && pitch[0].abs() < 1e-6,
            "{pitch:?}"
        );
        // A tilt to the left moves the top of the head toward +X.
        let roll = up(head(&record(
            0,
            true,
            pose_quaternion(axis(2, -15.)),
            OPEN,
            [0.; 14],
        )));
        assert!(
            roll[0] > 0.25 && roll[0] < 0.26 && roll[2].abs() < 1e-6,
            "{roll:?}"
        );
    }
    #[test]
    fn closed_form_matches_the_matrix_path() {
        let pose = mul(axis(1, 25.), mul(axis(0, -10.), axis(2, 12.)));
        let q = head(&record(0, true, pose_quaternion(pose), OPEN, [0.; 14]));
        let [x, y, z, w] = q;
        let m = [
            [
                1. - 2. * (y * y + z * z),
                2. * (x * y - z * w),
                2. * (x * z + y * w),
            ],
            [
                2. * (x * y + z * w),
                1. - 2. * (x * x + z * z),
                2. * (y * z - x * w),
            ],
            [
                2. * (x * z - y * w),
                2. * (y * z + x * w),
                1. - 2. * (x * x + y * y),
            ],
        ];
        for i in 0..3 {
            for j in 0..3 {
                assert!((m[i][j] - pose[i][j]).abs() < 1e-5, "{m:?} {pose:?}");
            }
        }
    }
    #[test]
    fn unusable_record_keeps_the_sample() {
        let mut d = Decoder::default();
        let mut features = [0.; 14];
        features[12] = 0.6;
        assert!(d
            .openseeface(&record(
                0,
                true,
                pose_quaternion(axis(1, 0.)),
                OPEN,
                features
            ))
            .unwrap());
        // A failed fit sends a zero quaternion; the datagram is valid and changes nothing.
        assert!(!d
            .openseeface(&record(0, false, [0.; 4], OPEN, [0.; 14]))
            .unwrap());
        assert!((d.expressions["jawOpen"] - 0.6).abs() < 1e-6);
    }
    #[test]
    fn rejects_nonfinite_values_and_bad_quaternions() {
        let q = pose_quaternion(axis(1, 0.));
        let mut features = [0.; 14];
        features[5] = f32::NAN;
        assert!(Decoder::default()
            .openseeface(&record(0, true, q, OPEN, features))
            .is_err());
        assert!(Decoder::default()
            .openseeface(&record(0, false, q, [f32::INFINITY, 1.], [0.; 14]))
            .is_err());
        assert!(Decoder::default()
            .openseeface(&record(0, true, [f32::NAN, 0., 0., 1.], OPEN, [0.; 14]))
            .is_err());
        for scale in [0.4f32, 2.1] {
            let bad = q.map(|v| v * scale);
            assert!(Decoder::default()
                .openseeface(&record(0, true, bad, OPEN, [0.; 14]))
                .is_err());
        }
        // A quaternion inside 0.5..2 is normalized.
        let head = head(&record(0, true, q.map(|v| v * 1.5), OPEN, [0.; 14]));
        assert!((head.iter().map(|v| v * v).sum::<f64>() - 1.).abs() < 1e-9);
    }
    #[test]
    fn lowest_usable_face_id_wins() {
        let q = pose_quaternion(axis(1, 0.));
        let features = |open: f32| {
            let mut f = [0.; 14];
            f[12] = open;
            f
        };
        let packet = [
            record(5, true, q, OPEN, features(0.5)),
            record(1, false, [0.; 4], OPEN, features(0.1)),
            record(2, true, q, OPEN, features(0.2)),
            record(9, true, q, OPEN, features(0.9)),
        ]
        .concat();
        let mut d = Decoder::default();
        assert!(d.openseeface(&packet).unwrap());
        assert!((d.expressions["jawOpen"] - 0.2).abs() < 1e-6);
    }
    #[test]
    fn features_map_to_clamped_arkit_names() {
        let mut f = [0.; 14];
        f[3] = 0.4; // EyebrowUpDownLeft
        f[6] = -0.3; // EyebrowUpDownRight
        f[8] = 0.7; // MouthCornerUpDownLeft
        f[10] = -0.5; // MouthCornerUpDownRight
        f[12] = 1.4; // MouthOpen
        f[13] = -0.25; // MouthWide
        f[2] = 0.9; // EyebrowSteepnessLeft is not mapped
        let mut d = Decoder::default();
        d.openseeface(&record(
            0,
            true,
            pose_quaternion(axis(1, 0.)),
            [0.8, 0.1],
            f,
        ))
        .unwrap();
        let e = &d.expressions;
        let expected = [
            ("eyeBlinkRight", 0.2),
            ("eyeBlinkLeft", 0.9),
            ("jawOpen", 1.),
            ("mouthSmileLeft", 0.7),
            ("mouthFrownLeft", 0.),
            ("mouthSmileRight", 0.),
            ("mouthFrownRight", 0.5),
            ("mouthStretchLeft", 0.),
            ("mouthStretchRight", 0.),
            ("mouthFunnel", 0.25),
            ("browOuterUpLeft", 0.4),
            ("browDownLeft", 0.),
            ("browOuterUpRight", 0.),
            ("browDownRight", 0.3),
            ("browInnerUp", 0.2),
        ];
        assert_eq!(e.len(), expected.len());
        for (name, value) in expected {
            assert!(ARKIT_NAMES.contains(&name), "{name}");
            assert!((e[name] - value).abs() < 1e-6, "{name} {}", e[name]);
        }
        assert!(
            !d.bones.contains_key("leftEye")
                && !d.bones.contains_key("rightEye")
                && d.root.is_none()
        );
    }
    #[test]
    fn checked_in_fixture_decodes() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/protocol/openseeface-one-face.bin");
        let bytes = std::fs::read(path).unwrap();
        let mut d = Decoder::default();
        assert!(d.openseeface(&bytes).unwrap());
        let q = d.bones["head"].rotation;
        assert!((q[3].abs() - 1.).abs() < 1e-6, "{q:?}");
        assert!((d.expressions["jawOpen"] - 0.5).abs() < 1e-6);
    }
}
