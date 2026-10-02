# OpenSekai

OpenSekai is the working name for an open-source 3D VTubing and live production app.

Start on macOS. Keep the core portable to Windows and leave a path to mobile. Use web technology for rendering, a Tauri v2 desktop host, and external tracking apps. The main performance target is a 3D concert hall with one or two performers at 1920 × 1080 and 60 FPS.

**Status:** design recorded on 2026-10-02. No app code exists yet. The written design awaits review. Detailed implementation planning comes next.

- [Architecture and scope](docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md)
- [Warudo feature parity checklist](docs/warudo-parity.md)
- [Performance contract](docs/evaluation/benchmark-contract.md)
- [MCP and model evaluation](docs/evaluation/mcp-evaluation-design.md)
- [Development and checkpoints](docs/development-workflow.md)
- [SPDD analysis](spdd/analysis/2026-10-02-opensekai-foundation.md)
- [SPDD foundation contract](spdd/prompt/2026-10-02-opensekai-foundation.md)

This repository owns OpenSekai code, specs, and evidence. The Oshi Connect ai-native checkout can remain the agent workspace. Each checkout has its own Git history.

Open-source release is the intent. Select a project license before distribution. Asset and dependency licenses remain separate. No Git remote or public release is configured.
