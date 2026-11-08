# OpenSekai Chat — dependency plan

**Spec:** [OpenSekai Chat design](../specs/2026-11-07-opensekai-chat-design.md) (approved 2026-11-07). The diagrams are in the [design doc](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).

The design has six slices across separate subsystems: contracts and session, a pure TypeScript compiler, an evaluation harness, a native inference process, Svelte UI, and Windows and Linux runtimes. One plan for all six is too large to review and too early to write, because later slices depend on facts that earlier slices measure (latency per tier, the base model score, the waypoint step). So each slice gets its own SPDD contract and its own implementation plan. We write each plan when its inputs are known.

## Slices

| # | Slice | Contract and plan | Needs | Gives to later slices |
| --- | --- | --- | --- | --- |
| 1 | Thin tools | `spdd/{analysis,prompt}/2026-11-08-chat-thin-tools.md`, [plan](2026-11-08-opensekai-chat-slice-1-thin-tools.md) | — | `proposalApply`, `@opensekai/assist` (intents, words, refs, summary, compiler), MCP thin tools, asset catalog fields, `TOOL_CONTRACT_VERSION` |
| 2 | Scenarios and eval | written after slice 1 merges | 1 | Scenario files, fixture libraries in `opensekai-fixtures`, the Fable 5.1 teacher harness over MCP, the MLflow baseline, the scene diff metric, the first demo |
| 3 | Local inference (macOS) | written after slice 1 merges | 1 | `opensekai-assist` child process, MLX with llguidance, the inference adapter, readings and `chat_status`, the signed manifest and the R2 download, Delete model files, latency and OBS evidence per tier |
| 4 | Chat UI | written after slice 3 has a working adapter | 1, 3 | Chat panel, proposal, overlays, Accept, Discard, scoped Undo, threads and compaction, Settings › Chat and Chat diagnostics |
| 5 | Fine-tuning | written after slices 2 and 3 have a baseline | 2, 3 | LoRA adapters through the manifest, or the record that the base model is enough |
| 6 | Windows and Linux | written after slice 3 | 3 (4 for the UI part of the smoke check) | llama.cpp CPU and Vulkan backends, the tier picker, the VRAM budget, Windows GPU readings, the VMPal Windows VM smoke check |

Outside dependency: the sky (ENV-02, #148). `sky_set` and the forest, lakeside, beach, and Moon scenarios wait for it. No slice in this plan blocks on it.

## Order and parallel work

```
1 ──┬── 2 ──────────┐
    ├── 3 ──┬── 4   ├── 5
    │       └── 6   │
    └───────────────┘ (3 also feeds 5)
```

- Slice 1 is sequential and goes first. Its first task changes a shared contract (`proposalApply`, TypeScript and the Rust mirror), so the integrator owns it. The rest of slice 1 is a new package and new MCP tools.
- Slices 2 and 3 can run in parallel worktrees after slice 1 merges. They share no files: slice 2 owns `tools/chat-eval/` and `fixtures/chat/`; slice 3 owns the assist process crate, the host spawn code, and the manifest client.
- Slice 4 starts after slice 3 has an inference adapter with a stub implementation. The UI can build against the stub while the MLX path is measured.
- Slice 6 can start after slice 3 freezes the adapter interface.
- Slice 5 starts only if the slice 2 and 3 baseline misses the bar.

## Shared contracts and owners

The integrator owns these, and changes them one at a time:

- `proposalApply` and `fingerprint` (`packages/contracts`, `crates/contracts`, the validation vectors). Slice 1.
- `TOOL_CONTRACT_VERSION` and the intent schemas (`packages/assist/src/intents.ts`). Slice 1 sets version 1. A change to an intent schema increments it, because adapters are trained against it (design: Model delivery, Compatibility).
- The assist process socket protocol and `chat_status`. Slice 3.
- The manifest format and its signing key. Slice 3.
- `chat.json` settings shape. Slice 4.

## Rules for every slice

- Write the slice contract (`spdd/analysis`, `spdd/prompt`) before code. Record a behavior change in the spec before coding it.
- Each slice ends with its parity line in `docs/warudo-parity.md` (verified behavior only), its evidence, and an `ARCHITECTURE.md` update when it adds a package, process, data path, or trust check.
- An unavailable measurement is unknown, never zero. Keep app timing and OBS timing separate.
- Do not push or open a PR until the slice is complete.
