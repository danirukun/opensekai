# Tracking receive and two performers check (B5)

Date: 2026-10-18. Contract: [tracking receive and two performers](../../spdd/prompt/2026-10-18-tracking-receive-two-performers.md). Issues: #18 (TRK-01 first subset), #19 (TRK-02 first subset), #16 (CHR-10 first subset), #91 (BP-11 Upper Body Rotation), #85 (BP-05 bone rotation part).

## Setup

- **Platform.** Linux cloud container (Ubuntu, x86_64), no GPU, no macOS, no OBS, no phone, no VMC application. Node 26.10.0, pnpm 12.8.1, rustc 1.93.1.
- **Commit.** The head of `claude/b5-tracking-receive-impl` named in the pull request.
- **Fixtures.** `fixture_vrm_1`, `fixture_vrm0_arkit`, and `fixture_glb_stage` were ready (`fixtures:` line of setup).
- **Browser.** Playwright Chromium 1194 from `/opt/pw-browsers`, headless. The editor checks mounted the real editor components on a real session in a temporary Vite page. The page was not committed.
- **Packets.** All tracking packets are mock packets that the tests make. They prove decoding and routing. They do not prove a physical phone or a VMC application.

## Results

| Check | Requirement | Result |
| --- | --- | --- |
| OSC type tags `h d t s b T F N I`, unknown tag rejects, ignored address never rejects, `d` and `i` numbers, unknown bone skipped, only unknown bones not recognized, bundle with Root, Bone, Blend, Apply | R1–R4 | PASS. `tracking::parser::tolerance_tests` (10 tests). 7 of them fail on the old parser. |
| iFacialMocap unknown bone key skipped after the format check | R5 | PASS. `ifacial_unknown_bone_key_is_skipped_after_format_check`. |
| Handshake retry rule (2000 ms gap, 500 ms quiet) | R6 | PASS. Pure rule with injected instants; real UDP test `ifacial_handshake_retries_from_endpoint_socket` measured a gap of at least 2000 ms, no send while packets arrive, and no send after Stop. Real time, not paused time. |
| Computer address filter | R7 | PASS. `local_addresses_keep_up_ipv4_non_loopback_non_link_local_in_numeric_order`. |
| Endpoint plan | R8–R11 | PASS. `tracking::endpoints::tests` (9 tests). |
| VMC bundle reaches the credited clock as one sample (real UDP) | O3a | PASS. `vmc_bundle_reaches_credited_clock_as_one_sample`. |
| Two phones on one port, routed by sender IP (real UDP, senders on 127.0.0.1, 127.0.0.2, 127.0.0.3) | O3c | PASS on Linux only. macOS has the pure routing tests and the owner check. |
| Join and leave keep the first source state; a failed bind binds on the next revision; a conflict names the winner | O3d, O3e, R9 | PASS. `tracking_integration` (6 tests). |
| `scenePatch` rejects a new shared source; one avatar can use one source for body and face; an old show with a share loads | R12 | PASS. `packages/session/test/two-performers.test.ts`; MCP `two-performers.integration.test.ts` returns `INVALID_INPUT` with both avatar IDs. |
| Two avatars, four sources, one stale or stopped: two independent poses | R15 | PASS. Session tests. |
| Two `fixture_vrm_1` instances with two head poses; an expression on one only; an ARKit `jawOpen` morph on one `fixture_vrm0_arkit` instance only | R15, O7 | PASS. `packages/renderer/test/two-vrm.integration.test.ts`. Textures are not decoded in Node. |
| Editor: a second character stands at +1 m; the other character's sources are disabled; the iFacialMocap receiver shows the computer addresses; diagnostics show unmatched packets | R7, R8, R13, R14 | PASS (headless). The `appStatus` values were injected, because the Rust host does not run in the browser check. [Second character](tracking-receive-two-performers/second-character.png), [first character](tracking-receive-two-performers/first-character.png), [receiver](tracking-receive-two-performers/ifacialmocap-receiver.png). |
| Upper Body Rotation: head yaw 20° gives chest 12°, spine 8°, hips 6° (within 0.01°); no offsets one tick after disable; revision unchanged; two avatars follow their own heads | R18–R22 | PASS. `packages/session/test/upper-body-rotation.test.ts`, `bone-offsets.test.ts`, renderer `avatar-pose.test.ts`. |
| Templates → Upper Body Rotation adds an enabled graph for the selected character | R21 | PASS (headless). [Menu](tracking-receive-two-performers/templates-menu.png), [graph added](tracking-receive-two-performers/template-added.png), [node fields](tracking-receive-two-performers/node-fields.png). |

## Gaps

- Get Bone Rotation reads 0 for a raw (VMC) head, because the session does not know the rest rotation. With a VMC face source, the template does nothing.
- The template reads the head of the previous tick, so the body follows one tick late.
- A shared endpoint keeps the bind address of its first source after that source leaves (contract implementation notes). A remaining `0.0.0.0` source then stays on a loopback socket until its config changes.
- Not checked (owner on macOS): a real VMC sender on port 39539; an iPhone with iFacialMocap that starts after OpenSekai; the port the phone sends to; two iPhones on one port; the editor source selects in the app; the two-performer frame cost at 60 fps in OBS with alpha; continued motion of both characters with the editor minimized; the look of the template in the preview and in OBS. These measurements are unknown.
