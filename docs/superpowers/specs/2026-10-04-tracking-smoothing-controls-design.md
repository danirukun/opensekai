# Tracking smoothing controls design

The requested change uses per-source settings, lighter defaults and bypass. Increasing minimum cutoff allows more slow motion through. Increasing beta reduces lag during faster changes. Initial defaults are 5 Hz and beta0.5; derivative cutoff stays1 Hz. These are starting values, not calibrated presets.

Store smoothing on the tracking asset and update it through setTrackingSmoothing. Keep connection and camera configuration separate. Existing assets without explicit settings use the new defaults. Reset restores those defaults. A disabled filter preserves raw samples and normal stale blending.

The authoritative session retains the latest raw sample and resets its source-local filter when settings change. Tuning applies immediately and does not change receiver generation. The inspector uses a compact form matching existing tracking controls. Checkbox commits immediately; numeric fields commit through Apply; Reset commits immediately. Tooltips explain the three parameters without extra persistent helper text.

Contract: spdd/prompt/2026-10-04-tracking-smoothing-controls.md. Validation includes response comparison, bypass, retuning without new samples, source isolation, revision conflict, native wire matching and actual UI/OBS checks.
