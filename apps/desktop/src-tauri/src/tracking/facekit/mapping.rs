//! Pure FaceKit output mapping (TRK-24 B33): shape checks, ARKit names, and the head rotation.
use super::adapter::FaceFrame;
use opensekai_contracts::{BoneSpace, Quat, TrackingBone};
use std::collections::BTreeMap;

/// The blend shape names that `CopySemantics` returns, in the delivered order.
pub const FACEKIT_NAMES: [&str; 51] = [
    "eyeBlink_L",
    "eyeBlink_R",
    "eyeSquint_L",
    "eyeSquint_R",
    "eyeLookDown_L",
    "eyeLookDown_R",
    "eyeLookIn_L",
    "eyeLookIn_R",
    "eyeWide_L",
    "eyeWide_R",
    "eyeLookOut_L",
    "eyeLookOut_R",
    "eyeLookUp_L",
    "eyeLookUp_R",
    "browDown_L",
    "browDown_R",
    "browInnerUp",
    "browOuterUp_L",
    "browOuterUp_R",
    "jawOpen",
    "mouthClose",
    "jawLeft",
    "jawRight",
    "jawForward",
    "mouthUpperUp_L",
    "mouthUpperUp_R",
    "mouthLowerDown_L",
    "mouthLowerDown_R",
    "mouthRollUpper",
    "mouthRollLower",
    "mouthSmile_L",
    "mouthSmile_R",
    "mouthDimple_L",
    "mouthDimple_R",
    "mouthStretch_L",
    "mouthStretch_R",
    "mouthFrown_L",
    "mouthFrown_R",
    "mouthPress_L",
    "mouthPress_R",
    "mouthPucker",
    "mouthFunnel",
    "mouthLeft",
    "mouthRight",
    "mouthShrugLower",
    "mouthShrugUpper",
    "noseSneer_L",
    "noseSneer_R",
    "cheekPuff",
    "cheekSquint_L",
    "cheekSquint_R",
];

/// A face entry whose rotation or blend shape data does not have the expected shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BadShape;

pub fn names_match(names: &[String]) -> bool {
    names.iter().map(String::as_str).eq(FACEKIT_NAMES)
}

pub fn arkit_name(name: &str) -> String {
    name.strip_suffix("_L")
        .map(|base| format!("{base}Left"))
        .or_else(|| name.strip_suffix("_R").map(|base| format!("{base}Right")))
        .unwrap_or_else(|| name.into())
}

fn row(values: &[f64]) -> Result<[f32; 3], BadShape> {
    match values {
        [a, b, c] => Ok([*a as f32, *b as f32, *c as f32]),
        _ => Err(BadShape),
    }
}

/// `Ok(None)` is a face entry with neither pose nor blend shapes (a lost face). Only one of them is `BadShape`.
pub fn face_frame(
    rotation: Option<&[Vec<f64>]>,
    blendshapes: Option<&[u8]>,
    tongue_out: Option<f64>,
) -> Result<Option<FaceFrame>, BadShape> {
    let (rotation, data) = match (rotation, blendshapes) {
        (None, None) => return Ok(None),
        (Some(rotation), Some(data)) => (rotation, data),
        _ => return Err(BadShape),
    };
    let rotation = match rotation {
        [a, b, c] => [row(a)?, row(b)?, row(c)?],
        _ => return Err(BadShape),
    };
    if data.len() != 51 * 4 {
        return Err(BadShape);
    }
    let mut blendshapes = [0f32; 51];
    for (value, bytes) in blendshapes.iter_mut().zip(data.chunks_exact(4)) {
        *value = f32::from_ne_bytes(bytes.try_into().map_err(|_| BadShape)?);
    }
    Ok(Some(FaceFrame {
        blendshapes,
        tongue_out: tongue_out.map(|v| v as f32),
        rotation,
    }))
}

/// Rows 2 and 3 negated, then the row-major matrix as a unit quaternion (x, y, z, w).
pub fn head_rotation(rotation: &[[f32; 3]; 3]) -> Quat {
    let m = |i: usize, j: usize| f64::from(rotation[i][j]) * if i == 0 { 1. } else { -1. };
    let (xx, yy, zz) = (m(0, 0), m(1, 1), m(2, 2));
    // Shepperd: divide by the largest of 4w, 4x, 4y, 4z so that a half-turn stays exact.
    let q = if xx + yy + zz > 0. {
        let s = (1. + xx + yy + zz).sqrt() * 2.;
        [
            (m(2, 1) - m(1, 2)) / s,
            (m(0, 2) - m(2, 0)) / s,
            (m(1, 0) - m(0, 1)) / s,
            s / 4.,
        ]
    } else if xx > yy && xx > zz {
        let s = (1. + xx - yy - zz).sqrt() * 2.;
        [
            s / 4.,
            (m(0, 1) + m(1, 0)) / s,
            (m(0, 2) + m(2, 0)) / s,
            (m(2, 1) - m(1, 2)) / s,
        ]
    } else if yy > zz {
        let s = (1. + yy - xx - zz).sqrt() * 2.;
        [
            (m(0, 1) + m(1, 0)) / s,
            s / 4.,
            (m(1, 2) + m(2, 1)) / s,
            (m(0, 2) - m(2, 0)) / s,
        ]
    } else {
        let s = (1. + zz - xx - yy).sqrt() * 2.;
        [
            (m(0, 2) + m(2, 0)) / s,
            (m(1, 2) + m(2, 1)) / s,
            s / 4.,
            (m(1, 0) - m(0, 1)) / s,
        ]
    };
    let norm = q.iter().map(|v| v * v).sum::<f64>().sqrt();
    q.map(|v| v / norm)
}

/// The run ends with "Unexpected FaceKit output" after this many non-zero `Process` results in sequence.
pub const PROCESS_FAILURE_LIMIT: u32 = 30;

/// Counts non-zero `Process` results in sequence. A zero result resets the count.
#[derive(Debug, Default)]
pub struct ProcessFailures(u32);
impl ProcessFailures {
    /// Records one `Process` result. True only at the result that reaches the limit.
    pub fn record(&mut self, status: i32) -> bool {
        self.0 = if status == 0 {
            0
        } else {
            self.0.saturating_add(1)
        };
        self.0 == PROCESS_FAILURE_LIMIT
    }
}

/// The normalized head bone and the ARKit expressions, clamped to 0..1. `None` when a value is not finite.
pub fn sample_parts(frame: &FaceFrame) -> Option<(TrackingBone, BTreeMap<String, f64>)> {
    let rotation = head_rotation(&frame.rotation);
    let finite = frame
        .blendshapes
        .iter()
        .chain(&frame.tongue_out)
        .chain(frame.rotation.iter().flatten())
        .all(|v| v.is_finite())
        && rotation.iter().all(|v| v.is_finite());
    if !finite {
        return None;
    }
    let expressions = FACEKIT_NAMES
        .iter()
        .map(|name| arkit_name(name))
        .zip(frame.blendshapes)
        .chain(frame.tongue_out.map(|v| ("tongueOut".to_string(), v)))
        .map(|(name, v)| (name, f64::from(v.clamp(0., 1.))))
        .collect();
    let bone = TrackingBone {
        rotation,
        space: BoneSpace::Normalized,
        position: None,
        weight: None,
    };
    Some((bone, expressions))
}

#[cfg(test)]
mod tests {
    use super::*;
    use opensekai_contracts::{BoneSpace, ARKIT_NAMES};
    use std::collections::BTreeSet;

    fn rotvec_deg(q: Quat) -> [f64; 3] {
        let [x, y, z, w] = if q[3] < 0. { q.map(|v| -v) } else { q };
        let s = (x * x + y * y + z * z).sqrt();
        if s < 1e-12 {
            return [0.; 3];
        }
        let angle = 2. * s.atan2(w).to_degrees();
        [x / s * angle, y / s * angle, z / s * angle]
    }
    fn bytes(values: &[f32]) -> Vec<u8> {
        values.iter().flat_map(|v| v.to_ne_bytes()).collect()
    }
    fn rows(m: [[f64; 3]; 3]) -> Vec<Vec<f64>> {
        m.iter().map(|r| r.to_vec()).collect()
    }
    const NEUTRAL: [[f64; 3]; 3] = [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]];
    fn frame(blendshapes: [f32; 51], tongue_out: Option<f32>) -> FaceFrame {
        FaceFrame {
            blendshapes,
            tongue_out,
            rotation: [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]],
        }
    }

    #[test]
    fn names_match_only_the_exact_list() {
        let names: Vec<String> = FACEKIT_NAMES.iter().map(|n| n.to_string()).collect();
        assert!(names_match(&names));
        let mut swapped = names.clone();
        swapped.swap(0, 1);
        assert!(!names_match(&swapped));
        assert!(!names_match(&names[..50]));
        let mut more = names.clone();
        more.push("tongueOut".into());
        assert!(!names_match(&more));
    }

    #[test]
    fn arkit_names_cover_the_contract_list() {
        assert_eq!(arkit_name("eyeBlink_L"), "eyeBlinkLeft");
        assert_eq!(arkit_name("mouthSmile_R"), "mouthSmileRight");
        assert_eq!(arkit_name("jawOpen"), "jawOpen");
        let mut converted: BTreeSet<String> = FACEKIT_NAMES.iter().map(|n| arkit_name(n)).collect();
        converted.insert("tongueOut".into());
        let contract: BTreeSet<String> = ARKIT_NAMES.iter().map(|n| n.to_string()).collect();
        assert_eq!(converted, contract);
    }

    #[test]
    fn face_frame_checks_the_shape() {
        assert_eq!(face_frame(None, None, None), Ok(None));
        let mut values = [0f32; 51];
        values[19] = 0.5;
        let good = bytes(&values);
        let rotation = rows(NEUTRAL);
        let face = face_frame(Some(&rotation), Some(&good), None)
            .unwrap()
            .unwrap();
        assert_eq!(face.blendshapes[19], 0.5);
        assert_eq!(face.rotation, [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]]);
        let short = vec![0u8; 200];
        let long = vec![0u8; 208];
        assert_eq!(
            face_frame(Some(&rotation), Some(&short), None),
            Err(BadShape)
        );
        assert_eq!(
            face_frame(Some(&rotation), Some(&long), None),
            Err(BadShape)
        );
        assert_eq!(
            face_frame(Some(&rotation[..2]), Some(&good), None),
            Err(BadShape)
        );
        let mut wide = rotation.clone();
        wide[1].push(0.);
        assert_eq!(face_frame(Some(&wide), Some(&good), None), Err(BadShape));
        assert_eq!(face_frame(Some(&rotation), None, None), Err(BadShape));
        assert_eq!(face_frame(None, Some(&good), None), Err(BadShape));
    }

    #[test]
    fn head_rotation_matches_the_measured_rows() {
        let cases: [([[f32; 3]; 3], [f64; 3]); 5] = [
            (
                [
                    [0.8462, -0.0219, 0.5323],
                    [-0.0012, -0.9992, -0.0391],
                    [0.5328, 0.0325, -0.8456],
                ],
                [-2.2, 32.2, 0.7],
            ),
            (
                [
                    [0.7688, -0.051, -0.6375],
                    [-0.0596, -0.9982, 0.008],
                    [-0.6368, 0.0318, -0.7704],
                ],
                [-0.7, -39.6, 3.4],
            ),
            (
                [
                    [0.9991, -0.0333, -0.0268],
                    [-0.0255, -0.9676, 0.2512],
                    [-0.0343, -0.2503, -0.9676],
                ],
                [14.5, -1.8, 1.7],
            ),
            (
                [
                    [0.886, -0.3471, -0.3074],
                    [-0.3749, -0.9265, -0.0343],
                    [-0.2729, 0.1456, -0.9509],
                ],
                [-5.4, -17.3, 21.5],
            ),
            (
                [
                    [0.9308, 0.3381, 0.139],
                    [0.3535, -0.9293, -0.1073],
                    [0.0929, 0.149, -0.9845],
                ],
                [-7.5, 6.8, -20.3],
            ),
        ];
        for (matrix, expected) in cases {
            let got = rotvec_deg(head_rotation(&matrix));
            for axis in 0..3 {
                assert!(
                    (got[axis] - expected[axis]).abs() <= 0.3,
                    "{got:?} is not {expected:?}"
                );
            }
        }
    }

    #[test]
    fn process_failures_end_the_run_at_the_limit() {
        let mut failures = ProcessFailures::default();
        assert!((1..PROCESS_FAILURE_LIMIT).all(|_| !failures.record(-1)));
        assert!(failures.record(-1));
        let mut failures = ProcessFailures::default();
        assert!((1..PROCESS_FAILURE_LIMIT).all(|_| !failures.record(7)));
        assert!(!failures.record(0));
        assert!((1..PROCESS_FAILURE_LIMIT).all(|_| !failures.record(7)));
        assert!(failures.record(7));
    }

    // A trace of -1 or 0 takes the X, Y, or Z branch of the conversion, not the W branch.
    #[test]
    fn half_turns_use_the_axis_branches() {
        // As delivered: the converted matrix with rows 2 and 3 negated again.
        let delivered = |m: [[f32; 3]; 3]| [m[0], m[1].map(|v| -v), m[2].map(|v| -v)];
        let h = std::f64::consts::FRAC_1_SQRT_2;
        let cases: [([[f32; 3]; 3], Quat); 5] = [
            (
                [[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]],
                [1., 0., 0., 0.],
            ),
            (
                [[-1., 0., 0.], [0., 1., 0.], [0., 0., -1.]],
                [0., 1., 0., 0.],
            ),
            (
                [[-1., 0., 0.], [0., -1., 0.], [0., 0., 1.]],
                [0., 0., 1., 0.],
            ),
            // 180° about (1, 1, 0) / √2: the off-diagonal terms of the Y branch.
            ([[0., 1., 0.], [1., 0., 0.], [0., 0., -1.]], [h, h, 0., 0.]),
            // 120° about (1, 1, 1) / √3: trace 0, the Z branch with each term.
            (
                [[0., 0., 1.], [1., 0., 0.], [0., 1., 0.]],
                [0.5, 0.5, 0.5, 0.5],
            ),
        ];
        for (matrix, want) in cases {
            let q = head_rotation(&delivered(matrix));
            let dot: f64 = q.iter().zip(want).map(|(a, b)| a * b).sum();
            assert!((dot.abs() - 1.).abs() < 1e-6, "{matrix:?} gave {q:?}");
        }
    }

    #[test]
    fn camera_neutral_is_identity() {
        let q = head_rotation(&[[1., 0., 0.], [0., -1., 0.], [0., 0., -1.]]);
        for (got, want) in q.iter().zip([0., 0., 0., 1.]) {
            assert!((got - want).abs() < 1e-6, "{q:?}");
        }
    }

    #[test]
    fn sample_parts_clamps_and_rejects() {
        let mut values = [0f32; 51];
        values[0] = -0.2;
        values[1] = 1.4;
        let (bone, expressions) = sample_parts(&frame(values, Some(0.87))).unwrap();
        assert_eq!(expressions["eyeBlinkLeft"], 0.);
        assert_eq!(expressions["eyeBlinkRight"], 1.);
        assert!((expressions["tongueOut"] - 0.87).abs() < 1e-6);
        assert_eq!(expressions.len(), 52);
        assert_eq!(bone.space, BoneSpace::Normalized);
        assert_eq!(bone.position, None);
        assert_eq!(bone.weight, None);
        let (_, expressions) = sample_parts(&frame(values, None)).unwrap();
        assert_eq!(expressions.len(), 51);
        assert!(!expressions.contains_key("tongueOut"));
        let mut nan = values;
        nan[7] = f32::NAN;
        assert_eq!(sample_parts(&frame(nan, None)), None);
        assert_eq!(sample_parts(&frame(values, Some(f32::NAN))), None);
        let mut infinite = frame(values, None);
        infinite.rotation[2][1] = f32::INFINITY;
        assert_eq!(sample_parts(&infinite), None);
    }

    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FixtureFrame {
        phase: String,
        rotation: Vec<Vec<f64>>,
        blendshapes: Vec<f32>,
        tongue_out: Option<f64>,
    }
    #[derive(serde::Deserialize)]
    struct Fixture {
        frames: Vec<FixtureFrame>,
    }

    #[test]
    fn fixture_frames_move_the_right_way() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/tracking/facekit-frames.json");
        let fixture: Fixture =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let parts: BTreeMap<String, ([f64; 3], BTreeMap<String, f64>)> = fixture
            .frames
            .iter()
            .map(|f| {
                let face = face_frame(
                    Some(&f.rotation),
                    Some(&bytes(&f.blendshapes)),
                    f.tongue_out,
                )
                .unwrap()
                .unwrap();
                let (bone, expressions) = sample_parts(&face).unwrap();
                (f.phase.clone(), (rotvec_deg(bone.rotation), expressions))
            })
            .collect();
        assert_eq!(parts.len(), 10);
        let (neutral, neutral_shapes) = &parts["neutral"];
        let (head_down, _) = &parts["head_down"];
        let (tilt_right, _) = &parts["tilt_right"];
        let (_, smile) = &parts["smile"];
        let (_, tongue) = &parts["tongue"];
        let (_, blink) = &parts["blink_left"];
        assert!(
            head_down[0] - neutral[0] > 8.,
            "head_down X {head_down:?} vs {neutral:?}"
        );
        assert!(
            tilt_right[2] - neutral[2] > 10.,
            "tilt_right Z {tilt_right:?} vs {neutral:?}"
        );
        assert!(smile["mouthSmileLeft"] - neutral_shapes["mouthSmileLeft"] > 0.3);
        assert!(tongue["tongueOut"] > 0.5);
        assert!(blink["eyeBlinkLeft"] > blink["eyeBlinkRight"]);
    }
}
