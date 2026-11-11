# Analysis: macOS release on each merge to main

Date: 2026-11-10. Scope: the first release slice. It adds CI and distribution. It does not change the app. Related: [development workflow, release preparation](../../docs/development-workflow.md#release-preparation), [macOS feasibility plan](../../docs/superpowers/plans/2026-10-02-opensekai-macos-feasibility.md) (`pnpm build:mac`).

## Problem

1. The repository has no CI. A tester must build the app from source on a Mac.
2. The owner wants a macOS build and a GitHub release for each merge to `main`, and a Discord message with the release notes in guild `1463985737174093844`, channel `1540662723095035934`.
3. The owner wants the Tauri v2 updater soon. Each release must therefore already have the files that the updater reads: a signed `.app.tar.gz` and a `latest.json` manifest. Otherwise the releases before the updater slice are useless to it.
4. The updater installs a release only when its version is higher than the installed version. A version from the date alone (`YYYY.M.D`) gives two merges on one day the same version. Semver does not allow leading zeros, so `2026.01.05` is not valid.
5. The UI kit is a local `file:` dependency. CI must clone `oshi-connect/oshi-connect-ui` with a token and build it, as `scripts/cloud-setup.sh` does in the cloud.

## Decision

- **Version `YYYY.MDD.HHMM`** from the committer time of the built commit, in UTC, each part as an integer: `2026.1110.2318`, `2027.105.904`. It increases with time and is valid semver. Tag `v<version>`, title `YYYY-MM-DD HH:MM UTC`, `CFBundleVersion` `YYYYMMDDHHMM`. The commit time, not the run time, makes a rerun give the same version. Alternative: the run time. Rejected: a rerun of an old run would publish old code with a newer version, and the updater would install it.
- **One GitHub Actions workflow** (`.github/workflows/release.yml`) on `macos-15` (Apple Silicon). Alternative: `tauri-apps/tauri-action`. Rejected: the build needs the UI kit and tracking model steps first, and the release format (version, manifest, notes) is ours.
- **Pure release logic in `scripts/release.ts`** (version, version order, manifest, Discord message), with tests. The workflow calls it with Node. Alternative: `jq` in the workflow. Rejected: the logic then has no test.
- **Updater files now, client updater later.** CI builds with `bundle.createUpdaterArtifacts` and the updater private key. The public key and the endpoint go into `tauri.conf.json` under `plugins.updater` now. Tauri does not read that block while the plugin is not registered, so the app does not change.
- **Signature gate.** CI checks the `.sig` against the committed public key with `minisign` before it publishes. A key mismatch stops the release, because no shipped client could install it.
- **Ad-hoc code signature** (`signingIdentity: "-"`), no Developer ID, no notarization. Notarization is a later slice.
- **Release notes from GitHub** (`generate-notes`: merged pull requests since the previous release). The same text goes into the release, `latest.json`, and Discord.
- **Discord bot token and REST API.** The guild and channel IDs identify the target. A webhook does not need them.
- **Dry run on pull requests** that change the release files, and on a manual run without `publish`. It builds, signs, checks the signature, and checks the Discord token with a read of the channel. It does not publish and does not post.

## Risks

- An ad-hoc signature changes with each build. macOS can ask for the camera permission again after each update. The updater slice must check this.
- macOS 15 removed the Control-click Open path for an app without Developer ID. A tester opens the first download from System Settings › Privacy & Security › Open Anyway.
- Two merges in the same UTC minute give the same version. The second release stops with a clear error, and the next merge releases both changes.
- The concurrency group keeps one pending run. When merges come faster than builds, the pending run of an older merge is cancelled, and the newest merge releases its changes.
- If the updater private key is lost, shipped clients cannot accept a new release.
- `OSHI_UI_TOKEN` is a personal token. It stops when it expires or when the owner loses access to the UI kit.
