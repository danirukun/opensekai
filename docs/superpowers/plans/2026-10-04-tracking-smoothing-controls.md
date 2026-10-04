# Tracking smoothing controls plan

Goal: responsive default tracking and user tuning without receiver restart.
Spec: spdd/prompt/2026-10-04-tracking-smoothing-controls.md.

- [x] Add TypeScript type, optional field, schema and patch. Test missing/default/bounds/unknown fields.
- [x] Add matching Rust contracts and tests; keep config constructors unchanged.
- [x] Add session patch and raw history. Test lighter response, bypass and immediate tuning without receipt, source isolation, unchanged generation/config and invalid operations.
- [x] Add shared-kit inspector controls and validated editor model/parser. Test functional validation and operation routing.
- [x] Run unit/integration/native/type checks, format and Clippy; build macOS.
- [x] Verify actual tuning/bypass/reset on all three asset kinds, active mock motion and OBS; restore scene, document limits, update parity and commit.

Parallel owners after shared TypeScript interface checkpoint: native lane owns crates; UI lane owns editor/components. Integrator owns session, schemas, checks and runtime evidence. Separate worktrees for all agents.

Verified source `171997a`; see docs/evaluation/tracking-smoothing-controls.md for scope and limits.
