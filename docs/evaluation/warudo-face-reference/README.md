# Warudo face tracking reference

Source: Warudo 0.15.1 in the VMPal QA VM, 2026-11-18. Scene "RORO Compare", tracker iFacialMocap. Read through the editor REST API (`GET /api/openedScene`, WarudoMCP `warudo_rest`) and checked against a UI pass.

- `face-tracking-dump.txt`: the Character, the iFacialMocap Receiver, and the "Face Tracking - iFacialMocap" blueprint. Each field shows its value. `*CHANGED*` marks a value that is not the class default, and gives the default.
- `pendulum-presets.txt`: the four pendulum physics presets of the receiver. Pendulum physics is off in this scene (the class default is on).

The Warudo documentation defines Body Rotation Type Inverted: the body turns in the same direction as the head on X and Y, and in the opposite direction on Z. It is the default ([face tracking](https://docs.warudo.app/docs/mocap/face-tracking)). Warudo replaced its Upper Body Rotation blueprint with this built-in feature in 0.12.0, and its Arm Sway blueprint with default pendulum physics in 0.12.3.

The design that uses these values: [face-only body motion](../../superpowers/specs/2026-11-18-face-only-body-motion-design.md).

## Pendulum input measurement (2026-11-19)

Warudo 0.15.1, scene "RORO Compare", iFacialMocap Receiver on UDP 49983. Receiver settings: Head Movement Intensity 2, Maximal Head Translation 0.5, Mirrored Tracking off. A script in the VM sent iFacialMocap packets (`=head#rx,ry,rz,tx,ty,tz|`) with fixed values to 127.0.0.1:49983. After each value was held for 3 s, the script read the input headers (`33% Head Rotation Y a → b`) through `GET /api/openedScene`. `a` is the input reading and `b` is the weighted result. In this session, the receiver already had pendulum physics on, so the script did not change a setting. The scene was not saved.

| Packet | Input | a | b |
|---|---|---|---|
| ry 10° | Arm Movements, Head Rotation Y (0.33, ×20, absolute) | −0.06 | 0.37 |
| ry 20° | same | −0.11 | 0.73 |
| ry 30° | same | −0.17 | 1.10 |
| ry −20° | same | 0.11 | 0.73 |
| rx 10° | Arm Movements, Head Rotation X (0.33, ×20) | 0.06 | 0.37 |
| rx 20° | same | 0.11 | 0.73 |
| rz 10°, 20° | no preset reads Head Rotation Z | — | — |
| tz 0.01 | Arm Movements, Head Position Z (0.5, ×20) | 0.02 | 0.20 |
| tz 0.05 | same | 0.10 | 1.00 |
| tz 0.1 | same | 0.20 | 2.00 |
| tz 0.2 | same | 0.40 | 4.00 |
| tz −0.1 | same | −0.20 | −2.00 |
| tz 1, 2, 5 | same | 0.50 | 5.00 |
| tz 0.01 | Body Lean, Head Position Z (1.0, ×5, clamp 0..1.5) | 0.02 | 0.10 |
| tz 0.2 | same | 0.40 | 1.50 |
| tz −0.1 | same | −0.20 | 0.00 |
| tx 1, ty 1 | no preset reads Head Position X or Y | — | — |

Results:

- A head rotation input is the head angle in degrees ÷ 180. Pitch keeps the iFacialMocap sign. Yaw has the opposite sign. OpenSekai keeps `PENDULUM_ROTATION_UNIT = 1/180`.
- A head position input is the iFacialMocap translation × Head Movement Intensity, clamped to ±Maximal Head Translation. Warudo does not convert the unit. The unit that iFacialMocap sends is not known; the macOS check with a phone measures it.
- `b = weight × clamp(abs?(a × scale))`. The clamp applies only when Clamp Override is on. At ry 30°, Arm Movements gives 1.10, not the 0.33 that a −1..1 clamp would give. Body Lean (Clamp Override on, 0..1.5) gives 1.50 at tz 0.2 and 0.00 at tz −0.1.
