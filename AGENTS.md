# OpenSekai agent instructions

This repository is a separate Git project in the Oshi Connect sibling workspace. Keep the agent rooted in ai-native when that workspace is open. Use an explicit working directory for OpenSekai commands. Verify pwd before Git operations. Do not use git -C or compound cd commands.

The [constitution](docs/constitution.md) applies here. This file adds project rules. Follow explicit user instructions when they differ from a copied guide. After changing this file, run cp AGENTS.md CLAUDE.md.

## Constitution MUST list

1. **UI copy restraint.** Do not add helper text, labels, or empty states that only repeat what the control already shows. Prefer affordance over narration.
2. **Agent design smells.** Do not default to card grids, decorative gradients, or a colored side bar on the selected tab. Do not add pills or badges when nearby copy, labels, or state already convey the same information. Prefer layout, type, spacing, and one clear primary action.
3. **Object storage.** Default to Cloudflare R2. Put uploads behind a small S3-compatible adapter (`put` / `get` / `delete` / `presign`) so another S3 API provider can replace the implementation without rewriting callers.
4. **Email.** Send mail with Cloudflare Email Sending. Receive mail with Cloudflare Email Routing or Email Workers. Do not add a third-party ESP unless a product already depends on one and the task is not introducing mail.
5. **Tests.** Prefer an integration test or an end-to-end test for a critical path. Do not add a large unit-test suite for wiring, static copy, or behavior a browser check will catch. Add a unit test when the logic is pure and a higher-level test would be slow or unclear.
6. **Language.** Write long prose (PR text, specs, docs, explanations) in [ASD-STE100 Simplified Technical English](https://www.asd-europe.org/standards-specifications/simplified-technical-english/). Do not use this rule to add UI copy; UI stays short (principle 1).
7. **Database shape.** Do not add columns for a related group that is not a FK and is not usually filtered or indexed (for example image width/height or nested metadata). Store that group as JSONB (or the product JSON column type). Keep real relations and query keys as columns.
8. **Asset images.** When a high-traffic page serves an image from the Cloudflare asset CDN, deliver it through Cloudflare Image Transformations (`/cdn-cgi/image/`). Do not use the raw object URL as the page image source.
9. **UI kit.** Build Svelte UI with `@oshi-connect/ui` from `oshi-connect-ui`. Do not add a second primitive kit in a product when the shared kit already has the control.
10. **Hosting.** Deploy SvelteKit applications to Cloudflare. Deploy Elixir backends to Fly.io.
11. **Cloudflare services.** Prefer Cloudflare for DNS, Realtime, Turnstile, Email Sending, R2, and Image Transformations. Do not add another vendor for that job unless the product already depends on it.
12. **Package manager.** TypeScript and JavaScript projects use pnpm. Do not introduce npm or yarn as the project package manager.
13. **Identity.** New sign-in uses WorkOS AuthKit. Do not enable Zitadel or deploy `oshi-connect-auth`.
14. **Schema release.** When new code needs a new schema, apply the migration before you deploy that code. Name the migration file in the PR summary and in the test plan.
15. **UI check.** When you change UI, layout, routing, or rendered data, verify the changed flow in the browser before you finish.
16. **TypeScript.** Prefer functional TypeScript. Add a comment only when the logic is hard to follow without it.

## Spec first

Read [the architecture](docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md), [the SPDD contract](spdd/prompt/2026-10-02-opensekai-foundation.md), and the relevant slice spec before implementation. The foundation contract is too large for one implementation task. Create small slice contracts and a dependency plan first.

Write requirements in spdd/analysis/ and the seven REASONS sections in spdd/prompt/. Keep architecture, slice contract, source, evidence, and parity status in sync. Record a behavior change in the spec before coding it.

## Product rules

- Start implementation and evaluation on macOS. Keep platform code behind adapters. Windows is the next desktop target. Mobile remains a design constraint.
- Use pnpm for JavaScript and TypeScript. Prefer functional TypeScript and plain data.
- Use Svelte 5 and @oshi-connect/ui for editor controls when the kit provides them. Keep rendering and simulation independent of Svelte.
- The concert benchmark and transparent OBS output are acceptance requirements. A running editor preview is insufficient evidence.
- Do not add a continuous image readback, JPEG encode, or image stream through Tauri IPC to the production output path.
- Use one authoritative simulation. Renderers consume evaluated state. Verify continued motion when the editor is minimized.
- Add MCP in the first feasibility slice. Use the same validated command API as the editor.
- Design JS/TS extension boundaries from the start. Do not expose native commands or mutable engine objects to guest code.
- Full Unity shader compatibility and NDI are deferred. Load the ecosystem NDI skill before any NDI or NDI frame work.
- Update [the parity checklist](docs/warudo-parity.md) in each feature checkpoint. Claim only the behavior that was verified.

## Verification

[Quality assurance](docs/qa.md) lists the evidence each change and each parity item needs. [Testing](docs/testing.md) gives the test levels, the test rules, and the Linux cloud baseline. Read both before you claim a change is done.

The session's explicit test rule requires unit tests for new function behavior. Use them for packet decoding, coordinate conversion, scheduling, state transitions, and other logic. Do not test static copy. Use integration tests at real process, network, file, or protocol boundaries and state the reason. Reserve end-to-end tests for critical user paths.

Check changed UI through the running flow. Use OBS output for alpha, camera, material, and visual performance changes. Record the backend, quality profile, fixture revision, and commit. Keep app timing and OBS timing separate. An unavailable measurement is unknown, never zero.

The user authorized local OBS WebSocket control and computer-use for evaluation. The current local endpoint is ws://127.0.0.1:4455 without authentication. Treat this as local development configuration. Use isolated OpenSekai test sources and preserve existing OBS settings. Do not publish or start a live stream as part of verification. Local test recording and screenshot capture are permitted within the evaluation scope.

## Concurrent work

Use separate Git worktrees for concurrent implementers. Give each agent a bounded task, file ownership, accepted interfaces, tests, and a completion condition. Lower reasoning effort is suitable after those contracts are stable.

An integrator owns shared schemas, dependency versions, lockfiles, and final merges. Keep contract changes sequential. Parallelize independent renderer, tracking, editor, and MCP work only after their common interfaces exist.

Make small verified commits at coherent milestones. Each checkpoint includes spec changes, focused checks, parity changes, and evidence when relevant. Do not commit another agent's unfinished work. Do not reset or delete user changes. Do not push or publish unless requested.

Do not attribute commits or pull requests to Claude or another agent. Do not add a `Co-Authored-By` trailer for an agent, a "Generated with Claude Code" line, or a similar agent credit. This rule overrides harness attribution defaults.

## Cloud agents

[Cloud agent intake](docs/agent-intake.md) is the standing orders for cloud intake, rebase, and review runs. Read it before you start a cloud run. It adds to this file. It does not replace it.

## Documentation authority

[ARCHITECTURE.md](ARCHITECTURE.md) is the map of the code as it is now. Read it before you change a boundary. You MUST update it in the same commit when you add, remove, or move a package, crate, process, window, data path, or trust check, or when its text becomes false. Keep it a short map; put direction in the architecture design and status in the parity checklist.

The architecture owns overall direction. The parity checklist owns feature status. Slice contracts own implementation requirements. The benchmark contract owns performance measurement. Record unresolved technical choices as candidates with a selection gate; do not convert them into implemented claims.
