# Warudo face tracking reference

Source: Warudo 0.15.1 in the VMPal QA VM, 2026-11-18. Scene "RORO Compare", tracker iFacialMocap. Read through the editor REST API (`GET /api/openedScene`, WarudoMCP `warudo_rest`) and checked against a UI pass.

- `face-tracking-dump.txt`: the Character, the iFacialMocap Receiver, and the "Face Tracking - iFacialMocap" blueprint. Each field shows its value. `*CHANGED*` marks a value that is not the class default, and gives the default.
- `pendulum-presets.txt`: the four pendulum physics presets of the receiver. Pendulum physics is off in this scene (the class default is on).

The Warudo documentation defines Body Rotation Type Inverted: the body turns in the same direction as the head on X and Y, and in the opposite direction on Z. It is the default ([face tracking](https://docs.warudo.app/docs/mocap/face-tracking)). Warudo replaced its Upper Body Rotation blueprint with this built-in feature in 0.12.0, and its Arm Sway blueprint with default pendulum physics in 0.12.3.

The design that uses these values: [face-only body motion](../../superpowers/specs/2026-11-18-face-only-body-motion-design.md).
