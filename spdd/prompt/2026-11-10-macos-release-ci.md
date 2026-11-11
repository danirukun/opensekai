# REASONS: macOS release on each merge to main

Date: 2026-11-10. Scope: the first release slice (CI and distribution). Analysis: [macOS release CI](../analysis/2026-11-10-macos-release-ci.md). Out of scope: the client updater (the next release slice), Developer ID signing and notarization (a later slice), Windows builds, and a pull request check workflow.

## R — Requirements

R1. Each push to `main` starts one release run. A manual run (`workflow_dispatch`) on `main` with `publish: true` also releases. Runs share the concurrency group `release` and do not cancel a run in progress.
R2. A pull request that changes `.github/workflows/release.yml`, `scripts/release.ts`, or `scripts/cloud-setup.sh` starts a dry run. A manual run without `publish: true`, or on another branch, is also a dry run. A pull request from a fork does not run.
R3. The version comes from the committer time of the built commit in UTC: `YYYY.MDD.HHMM`, each part an integer with no leading zero (10 November 2026 23:18 is `2026.1110.2318`; 5 January 2027 09:04 is `2027.105.904`). The tag is `v<version>`. The release title is `YYYY-MM-DD HH:MM UTC`. `CFBundleVersion` is `YYYYMMDDHHMM`.
R4. A release run stops before it publishes when the version is not higher than the version of the latest release, or when the tag exists.
R5. The build runs on `macos-15` (arm64) with the toolchain of `.node-version` and `rust-toolchain.toml`. It clones the UI kit with `OSHI_UI_TOKEN` through `scripts/cloud-setup.sh`. With `OPENSEKAI_RELEASE_BUILD=1` that script skips Playwright, `pnpm build`, the fixtures, and the GPU probe.
R6. Tauri builds the `app` bundle with these overrides only: `version`, `bundle.macOS.bundleVersion`, `bundle.macOS.signingIdentity: "-"`, and `bundle.createUpdaterArtifacts: true`. The updater key comes from `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. No version change is committed.
R7. `apps/desktop/src-tauri/tauri.conf.json` has `plugins.updater.pubkey` (key ID `4DEF778BB1ECFDFF`) and `plugins.updater.endpoints` with `https://github.com/danirukun/opensekai/releases/latest/download/latest.json`.
R8. Signature gate: `minisign` checks the `.app.tar.gz` with the `.sig` and the public key of R7. A failed check stops the run before it publishes.
R9. Release assets: `OpenSekai-<version>-macos-arm64.zip` (the `.app`, made with `ditto`), `OpenSekai-<version>-macos-arm64.app.tar.gz`, its `.sig`, and `latest.json`.
R10. `latest.json` has the Tauri static format: `version`, `notes`, `pub_date` (the commit time, RFC 3339), and `platforms["darwin-aarch64"] = { signature, url }`. `signature` is the text of the `.sig` file. `url` is the release download URL of the `.app.tar.gz`.
R11. The notes come from the GitHub `generate-notes` API for the tag and the commit. The release body, `latest.json`, and the Discord message use the same notes. The release is marked as latest.
R12. After a published release, the workflow posts one message to channel `1540662723095035934` (guild `1463985737174093844`) with `DISCORD_BOT_TOKEN`. The message has one embed: the title `OpenSekai <version>`, the release URL, the notes as the description (at most 4096 characters; a longer text ends with `…`), a field with the zip URL, and the commit time. The message mentions nobody.
R13. A dry run does R3 to R10 without the publish checks of R4. It uploads the zip and the updater files as a workflow artifact, prints the Discord message, and reads the channel with the bot token to check the token. It does not create a tag, a release, or a message.

## E — Entities

- `ReleaseVersion`: `{ version, tag, title, bundleVersion }`.
- `UpdaterManifest`: `{ version, notes, pub_date, platforms: { 'darwin-aarch64': { signature, url } } }`.
- `DiscordMessage`: `{ allowed_mentions: { parse: [] }, embeds: [{ title, url, description, color, fields, timestamp }] }`.

## A — Approach

Write the pure functions and their tests first. Then the setup flag, the config block, and the workflow. Check the workflow with `actionlint`. The dry run on this pull request is the first check on macOS. The first merge is the first published release.

## S — Structure

- `.github/workflows/release.yml` (new).
- `scripts/release.ts`, `scripts/release.test.ts` (new).
- `scripts/cloud-setup.sh` (`OPENSEKAI_RELEASE_BUILD`).
- `apps/desktop/src-tauri/tauri.conf.json` (`plugins.updater`).
- `docs/development-workflow.md`, `ARCHITECTURE.md`.

## O — Operations

1. `scripts/release.ts`: `releaseVersion(date)`, `compareVersions(a, b)`, `updaterManifest(input)`, `discordMessage(input)`, and a command line (`version`, `manifest`, `discord`) for the workflow.
2. Tests: the version of R3 for two digit and one digit months, days, hours, and minutes, and midnight; the order of versions; the manifest shape; the Discord truncation and the empty notes.
3. `scripts/cloud-setup.sh`: the skip path of R5.
4. `tauri.conf.json`: R7.
5. Workflow: the `build` job (R1 to R11, R13) and the `notify` job (R12, R13).
6. Documents.

## N — Norms

- Pin each action by its commit SHA.
- The workflow token has `contents: write` only.
- Secrets go only to the steps that use them. No step prints a secret.
- Integration tests for `scripts/release.ts` (the project of `scripts/*.test.ts`). No mock of the unit under test.

## S — Safeguards

- Do not change app behavior. Do not register the updater plugin in this slice.
- Do not publish from a pull request, a fork, or a branch other than `main`.
- Do not publish a release whose signature fails the gate of R8.
- Do not commit a private key, a token, or `.local/`.
- Do not claim a macOS result that no run has shown.
