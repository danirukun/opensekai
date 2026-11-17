# Guided setup sources check (B42)

Date: 2026-11-17. Bundle B42: [#167](https://github.com/danirukun/opensekai/issues/167). Contract: [Guided setup sources](../../spdd/prompt/2026-11-16-guided-setup-sources.md). Base: `main` at 435dc3f. Code commit: 6d57464 (branch `claude/b42-guided-mocap-setup`). The pull request names all branch commits.

Platform: macOS host (Darwin 27.2.0, arm64). Node 26.13.0, pnpm 12.8.1, Rust 1.93.1. No app run. This file has no macOS app, WKWebView, camera, phone, or OBS result.

## What changed

- Step 1 of the guide has a Face select and a Body select in place of the app tiles. Face: Webcam, FaceKit (macOS only), iFacialMocap, SelfReflect, Other VMC app, OpenSeeFace, None. Body: Same as face, Webcam, SelfReflect, Other VMC app, None. FaceKit off macOS, a disabled option, or an option that is not in the list stops Next. Hands shows when the body is Webcam. The default for a character with no source is Webcam, Same as face, Hands on.
- `planSetup` gives one patch for all parts of the run (at most two sources). It reuses a source of the same kind that only this character binds (a source of the part's own preset first, then the part's own slots, then any slot that a part fills), then a free source of the same kind, then creates a source. It never changes a source that another character also binds. When a part moves to another port, it skips the port of each enabled VMC sender that sends to this computer. It changes only the slots that the chosen parts fill (owner decision, 2026-11-17): Face None, Body None, and Hands off keep the slot, and a separate hand source keeps the fingers slot. It stops a source only when that source fills no slot of this character after the run and no other character binds it. It gives `blocked: 'sourceLimit'` when the scene would have more than 4 tracking sources.
- Cancel removes the created sources and puts back the bindings, the face mapping, and the config and smoothing of each changed source.
- The Connect step shows one block for each part, face first, with an alert for each failed part and Open Settings for `permissionNeeded`.
- The inspector shows a tip on a tracking source that no character uses.
- `pnpm evaluate:tracking-feed` sends a fake VMC or iFacialMocap face stream.

## Checks

Commands on 6d57464. Raw output was kept outside the repository.

| Command | Result |
| --- | --- |
| `pnpm check` | Pass. `svelte-check`: 5871 files, 0 errors, 0 warnings |
| `pnpm test:unit` | Pass. 252 files; 2242 tests pass, 1 skipped |
| `pnpm test:integration` | 4 failures, the same as on the base: `scripts/prepare-tracking.test.ts` (4 tests). 41 files pass, 1 fails, 2 skipped; 99 tests pass, 4 fail, 4 skipped |

On the base (435dc3f), `pnpm test:integration` gave 39 files pass, 1 fails, 2 skipped; 93 tests pass, 4 fail, 4 skipped. The `prepare-tracking` failures do not come from this change. On the base, `pnpm test:unit` once failed in `apps/desktop/test/hidden-cameras.test.ts` (timing); the file passes alone (11 tests) and in the run above.

The full list with the Rust checks is in the pull request, on the last commit.

### B42 tests

| File | Level | Tests | Covers |
| --- | --- | --- | --- |
| `packages/contracts/test/tracking-presets.test.ts` | unit | 12 | The Webcam, OpenSeeFace, and FaceKit presets; `calibrate`; each config passes the schema |
| `apps/desktop/test/tracking-guide-setup.test.ts` | unit | 14 | Face and Body options, FaceKit on macOS only and one FaceKit for each host, Same as face rules, Hands, initial choice, Next refuses a disabled option, parts |
| `apps/desktop/test/tracking-guide-plan.test.ts` | unit | 41 | Reuse order, a source of the own preset first, no reuse of a source that another character also binds, one source for each part, two parts in one patch, ports, local VMC sender ports, unused slots that stay, a separate hand source that stays, released sources, the limit, cancel |
| `apps/desktop/test/tracking-guide-setup.integration.test.ts` | integration | 3 | Patches applied to a real session: two parts, the limit, a reuse run, cancel, a second character on port 39540 |
| `apps/desktop/test/tracking-guide.test.ts` | unit | 23 | The reducer with two parts: connect waits for each part, calibrate for each part, a body-only run has no expression steps |
| `apps/desktop/test/tracking-guide-view.test.ts` | unit | 6 | The Relax heading |
| `apps/desktop/test/live-fields.test.ts` | unit | 11 | `sourceUsers` for the tip |
| `apps/desktop/test/body-tracking-fields.test.ts` | unit | 6 | Cancel keeps the body group |
| `tools/evaluation/test/tracking-feed.test.ts` | unit | 9 | Schedule, iFacialMocap text, VMC bundle, arguments |
| `tools/evaluation/test/tracking-feed.integration.test.ts` | integration | 3 | The CLI sends real UDP datagrams on loopback for each kind; a bad kind exits with code 2 |

Review fixes (after 6d57464): `pnpm check` pass (5871 files, 0 errors, 0 warnings); `pnpm test:unit` 252 files, 2248 tests pass, 1 skipped.

Keep unused slots (owner decision, 2026-11-17): `pnpm check` pass (5871 files, 0 errors, 0 warnings); the focused guide files (7) 104 tests pass; `pnpm test:unit` 252 files, 2253 tests pass, 1 skipped.

## Fake sender

`pnpm evaluate:tracking-feed --kind vmc|ifacialmocap [--host 127.0.0.1] [--port N] [--neutral-seconds 3] [--seconds N]`

- The default port is the preset port: 39539 for VMC, 49983 for iFacialMocap.
- First a neutral phase: all expressions 0, a small head sway.
- Then the steps Blink, Mouth wide, Brows up, Smile, Frown, Pucker, Look around, 2 s each, each target at 1.0. Look around moves the eyes up, down, in, and out (`eyeLook*` channels, and eye bones for iFacialMocap). The sequence repeats.
- It never sends `cheekPuff` or `tongueOut`, so the guide must show Puff your cheeks and Stick out your tongue as not sent.
- It prints each phase change with the time.

Commands for the orchestrator (a live run on the macOS app):

1. VMC: select Face Other VMC app, Body Same as face, Next. Then run `pnpm evaluate:tracking-feed --kind vmc --neutral-seconds 5`. Keep it running until Review.
2. iFacialMocap: select Face iFacialMocap, Body None, Next. Type `127.0.0.1` as the phone address and Connect. Then run `pnpm evaluate:tracking-feed --kind ifacialmocap --neutral-seconds 5`.

On loopback the app sends its iFacialMocap handshake to its own socket. The source counts it as one invalid packet. This is expected for a sender on the same host.

## Platform

| Platform | Result |
| --- | --- |
| macOS unit and integration | Pass (above) |
| VMC and iFacialMocap live with the fake sender | Orchestrator |
| Webcam and FaceKit at the camera | `accept:local` |
| Linux cloud | Not checked |
| Windows | Not checked |

## Unknown

- The guide in the running app: Step 1 selects, the Connect blocks, the camera selects, the failure alerts, and Open Settings.
- Two sources in one live run, and a released source that stops in the running host.
- OBS output and timing for this change.
