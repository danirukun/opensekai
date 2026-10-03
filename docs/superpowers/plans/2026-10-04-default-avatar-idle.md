# Default avatar idle plan

Contract: spdd/prompt/2026-10-04-default-avatar-idle.md. Integrator owns contracts and final native/OBS checks. Independent workers use separate worktrees.

- [x] Add optional idle/base pose contracts and validated avatar operation, with backward compatibility tests.
- [x] Add authoritative idle loop and tracking composition tests.
- [x] Add renderer baseline blending for normalized and raw tracking, with focused tests.
- [x] Add import default and avatar Idle switch with pure/model tests.
- [x] Merge, run required checks, build macOS and restore saved scene.
- [x] Verify idle, switch, tracking takeover/fade and OBS continuity. Record evidence, update parity and commit checkpoint.

- [ ] Verify live MediaPipe takeover over idle with a detected person.

 Current camera inference starts and keeps idle while waiting; generated normalized rig takeover/fade tests pass. No new user input is needed for the implemented default idle.
