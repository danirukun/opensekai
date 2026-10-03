use opensekai_contracts::*;
use std::collections::BTreeMap;
#[derive(Default, Clone)]
pub struct Decoder {
    pub bones: BTreeMap<String, TrackingBone>,
    pub expressions: BTreeMap<String, f64>,
    pub root: Option<TrackingRoot>,
    staged: BTreeMap<String, f64>,
}

#[derive(Debug)]
enum Arg {
    String(String),
    Float(f64),
    Int(i32),
}
fn number(arg: &Arg) -> Result<f64, AppError> {
    if let Arg::Float(n) = arg {
        if n.is_finite() {
            return Ok(*n);
        }
    }
    Err(invalid("Invalid OSC float"))
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
    if out.len() >= 64 {
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
            'f' | 'i' => {
                let word = bytes
                    .get(i..i + 4)
                    .ok_or_else(|| invalid("Truncated OSC number"))?;
                i += 4;
                let word = word.try_into().unwrap();
                if tag == 'f' {
                    let n = f32::from_be_bytes(word) as f64;
                    if !n.is_finite() {
                        return Err(invalid("Nonfinite OSC number"));
                    }
                    Arg::Float(n)
                } else {
                    Arg::Int(i32::from_be_bytes(word))
                }
            }
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
                    if !humanoid_bone(&name) {
                        return Err(invalid("Unknown VMC bone"));
                    }
                    let pose = unity_pose(&args)?;
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
                if !["head", "leftEye", "rightEye"].contains(&name) {
                    return Err(invalid("Unknown IFacial bone"));
                }
                let values = values
                    .split(',')
                    .map(|n| {
                        n.trim()
                            .parse::<f64>()
                            .map_err(|_| invalid("Invalid IFacial angle"))
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                if values.iter().any(|n| !n.is_finite())
                    || values.len() != if name == "head" { 6 } else { 3 }
                {
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
                "/VMC/Ext/Bone/Pos",
                ",sfffffff",
                &[
                    b"Bad\0",
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(0.),
                    &float(1.)
                ]
            ))
            .is_err());
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
        for _ in 0..65 {
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
