# Development workflow and checkpoints

Date: 2026-10-02. This document defines work rules. The detailed implementation plan follows review of the written design.

## Repository ownership

OpenSekai is a separate sibling Git repository. It owns product code, architecture, SPDD files, parity status, and evaluation summaries. ai-native remains the agent workspace and the source of shared ecosystem guidance.

Do not use the parent directory as a Git root. Set the command working directory explicitly and verify pwd. No remote is configured yet. Local checkpoint commits do not publish the project.

## Spec and plan sequence

1. Review the architecture and the first-slice boundaries.
2. Write a macOS feasibility analysis and a small REASONS slice contract.
3. Write the implementation plan with acceptance criteria, dependency edges, file ownership, and checks.
4. Implement the shared contracts sequentially.
5. Run independent implementation lanes in separate worktrees.
6. Integrate, verify the full path, update parity, and make a checkpoint.
7. Revise the relevant spec before a behavior or architecture change.

The foundation contract is a reference for later slices. It must not become a single task to build all Warudo parity.

## Proposed package boundaries

These are logical boundaries, not an existing scaffold.

| Area | Owns | Depends on |
| --- | --- | --- |
| contracts | IDs, commands, state streams, capabilities, errors | Versioned schemas |
| session | ECS, animation, physics, operation scheduler | contracts |
| renderer | Three.js assets, material adapters, cameras, GPU resources | contracts and prepared asset manifests |
| editor | Svelte tools, selection, inspector, layouts | contracts; renderer preview adapter |
| native host | Tauri, sockets, local service, files, platform services | contracts |
| tracking | Packet parsers and normalized samples | contracts; native socket adapter |
| mcp | stdio adapter, tool schemas, evidence resources | contracts; local app API |
| evaluation | Replay, metrics, captures, OBS adapter, summaries | contracts; renderer and MCP diagnostics |
| extensions | Manifest, guest VM, capability mediation | contracts; bounded host operations |

Avoid platform-specific imports in shared contracts, session logic, and renderer core. Use thin adapters. Keep rendering objects out of public schemas.

## Concurrent implementation

The user wants multiple agents at lower reasoning effort. Use that mode for bounded implementation after the plan and interfaces are stable. Do not lower effort by giving one agent an ambiguous engine-wide task.

Assign a separate worktree and branch to each agent. Start from a shared contract checkpoint. Proposed independent lanes:

- Renderer/output: asset loading, small VRM scene, backend probe, OBS client, alpha evidence.
- Native/tracking: socket adapters, packet fixtures, normalized sample delivery.
- Editor: hierarchy, selected properties, camera/output controls through fixed APIs.
- MCP/evaluation: stdio tool round trip, evidence labeling, OBS read/control adapter.

The integrator owns contracts, root workspace manifests, dependency pins, lockfiles, merge order, and whole-path verification. Workers request contract changes; they do not each edit the same contract or regenerate the lockfile.

Each task includes scope, allowed files, immutable interfaces, fixtures, expected errors, focused checks, and a clear done condition. A worker returns the commit, checks run, limitations, and evidence paths. If blocked, it reports the exact missing dependency. It must not silently expand scope.

Use frontier or higher-effort review for architecture choices, integration failures, sandbox boundaries, and evidence interpretation. Model-guided review does not replace deterministic checks.

## Checkpoint policy

Commit after a coherent unit passes its checks. Also checkpoint before an architectural experiment or a worktree handoff when the current tree is coherent. Aim for a checkpoint within 30–60 minutes of active implementation, but do not make an unverified checkpoint just to meet a timer.

Keep commits small enough to review. Each feature checkpoint includes related spec changes and parity status. Cite visual/performance evidence for relevant changes. Record failed experiments as evidence without claiming their feature complete.

The integrator merges or cherry-picks one completed lane at a time, runs the relevant boundary checks, then runs the whole-path gate when all dependencies are present. Do not commit concurrently in the same worktree. Do not combine another worker's unfinished files into a checkpoint.

## Verification scale

Pure logic receives unit tests. Real network/process/file boundaries receive focused integration tests with a stated reason. Critical workflows receive end-to-end checks. UI changes receive a running interaction check. Rendering/output changes receive actual OBS evidence.

Use the smallest checks that prove the changed behavior. Repeat wider tests when changes, failures, or unresolved risks justify them. Do not claim a minimum-hardware result from a faster host.

The first runtime checkpoint must show a current scene revision reaching OBS through the production path and a useful MCP round trip. The concert acceptance checkpoint must meet the frozen [benchmark contract](evaluation/benchmark-contract.md).

## Release preparation

Keep macOS work moving first. Add Windows build and smoke verification early enough to catch portable-core leaks. Full Windows output acceptance requires a Windows host. Mobile stays an explicit later investigation.

Choose a license before public distribution. Create a remote only when requested. Keep asset redistribution rights separate from source licensing. Production app packaging, notarization, update delivery, and mobile permissions need dedicated release slice contracts.
