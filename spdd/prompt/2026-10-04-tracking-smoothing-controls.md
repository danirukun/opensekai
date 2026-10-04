# REASONS: Tracking smoothing controls

## R — Requirements

Reduce default smoothing for VMC, iFacialMocap and MediaPipe. Expose per-source enabled, minCutoff, beta and derivativeCutoff plus Reset in the tracking inspector. Values update through the existing scene API and are preserved in scene state. Do not restart receivers or camera for tuning.

## E — Entities

TrackingSmoothing = {enabled:boolean,minCutoff:number,beta:number,derivativeCutoff:number}. Optional tracking entity field smoothing. Dedicated patch {kind:'setTrackingSmoothing',entityId,smoothing}. Defaults enabled=true, minCutoff=5 Hz, beta=0.5, derivativeCutoff=1 Hz. Bounds cutoff/derivative 0.01–120 Hz, beta0–100. Core generic filter defaults remain unchanged; actual tracking uses these new settings.

## A — Approach

Validate in TypeScript and Rust. Patch tracking assets only, increment revision atomically, leave source generation and config intact. Source-local settings changes reset filter history and reevaluate the latest raw sample immediately. Bypass passes raw channels with existing routing/fade behavior. Retain at most one raw sample per source; reset both raw and filtered history on normal source lifecycle changes.

## S — Structure

contracts/tracking defines type/schema/default. types/schema and native lib carry asset and operation. Session composer owns effective settings and raw sample state. Editor model exposes setTrackingSmoothing. TrackingSmoothingFields uses shared Input/Button and existing checkbox style; Inspector and EditorApp bind it independently of tracking config activation.

## O — Operations

1. Write contract. 2. Add failing schema/session/tuning tests and implementations. 3. Add matching native validation and regression tests. 4. Add inspector controls and parser/model tests. 5. Run full checks, build macOS, use actual controls with mock tracking and OBS, preserve user settings, update parity and checkpoint.

## N — Norms

Functional TypeScript, pnpm, shared Svelte UI and native checkbox only where the shared kit lacks one. No redundant UI narration. Use a short parameter tooltip to explain its effect. Test new function behavior; no static-copy tests. Maintain protocol, API and scene validation parity.

## S — Safeguards

Reject invalid, blank, nonfinite or out-of-range tuning without applying it. Honor expected revision; wrong entity kind cannot partially mutate scene. Do not let bypass stop native receipt or alter tracking enabled. No restart, camera activation, source generation change or counter reset for tuning. When tuning changes, reseed from the retained current raw sample, including when the next sample has not arrived. Missing settings remain valid. Preserve the original scene and OBS setup. Keep actual MediaPipe person checks distinct from deterministic tests.
