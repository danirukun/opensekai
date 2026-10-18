---
name: local-qa-e2e
description: Local end-to-end QA of an OpenSekai pull request on this Mac. Syncs the branch (current branch, a branch name, or a PR number/URL), runs pnpm i, launches the desktop app, verifies every item in the PR's acceptance checklist with the OpenSekai MCP server, computer use, and the local OBS WebSocket, then records a sped-up, web-compressed demo with the cap CLI and posts results plus the video to the PR with gh. Use this whenever the user asks to QA, smoke-test, acceptance-test, "local acceptance", verify, or demo a PR or branch in OpenSekai, or says things like "check #201 locally", "run the local checklist", "record a demo for the PR", even if they don't name the skill.
---

# Local QA end to end

This skill takes one OpenSekai pull request from "code on GitHub" to "verified on the owner's Mac, with evidence on the PR". The PR body is the source of truth for what to check; the running app (not tests, not scratch pages) is the source of truth for whether it works.

The flow: resolve target → sync checkout → install → launch app → extract checklist → verify each item → record demo → post to PR → clean up.

Helpers live in `scripts/` next to this file. Call them with absolute paths; below, `$SKILL` means this skill's directory.

## 1. Resolve the target

The argument decides what to check out:

| Argument | Meaning |
| --- | --- |
| none | The current branch. Pull its latest remote changes. |
| a number (`201`, `#201`) or a PR URL | `gh pr checkout <n>` |
| anything else | A branch name. `git fetch origin`, then `git switch <branch>`, then pull. |

Then find the PR: `gh pr view [<n>|<branch>] --json number,title,url,headRefName,body,state`. With no argument on `main`, or a branch without a PR, there is no checklist to verify. Stop and ask the user which PR to check (show `gh pr list --limit 10`).

## 2. Sync the checkout safely

The repository rules matter here (see `AGENTS.md`): verify `pwd` before Git commands, do not use `git -C` or `cd … && …` chains, and never reset, stash, or delete user changes.

1. `pwd` must be the OpenSekai root (or the worktree you chose below).
2. `git status --porcelain`. Untracked files that are clearly local tooling (`.grok/`, `skills-lock.json`, other skill folders) are fine. Modified tracked files are not: stop and ask the user, because switching or pulling could mix their work into the QA run.
3. If `git switch` fails because the branch is checked out in a worktree under `.worktrees/`, use that worktree: run `cd <worktree>` as its own command, check `pwd`, and pass `--repo <worktree>` to the helpers.
4. `git pull --ff-only`. If it cannot fast-forward, stop and report; do not merge or rebase.
5. Note the commit: `git rev-parse --short HEAD`. Every result you report belongs to this commit.

## 3. Install and prepare

1. `pnpm i`. Afterwards, `git status --porcelain pnpm-lock.yaml` must be empty. A changed lockfile means the branch's lockfile is stale. Report it as a finding, and do not commit it.
2. One-time setup can be missing in a fresh worktree. Check and fix only what is missing (commands are in `README.md` "Getting started"): the UI kit snapshot (`scripts/bootstrap-ui.ts`, needs `OPENSEKAI_UI_SOURCE`) and the tracking models (`pnpm exec tsx scripts/prepare-tracking.ts --download`).

## 4. Launch the app

Only one OpenSekai instance should run, because every instance writes its connection descriptors to the same place: `~/Library/Application Support/com.oshi-connect.opensekai/{operator.json,renderer-output_main.json}`. A second or stale instance makes the helpers talk to the wrong build.

1. `pgrep -fl -i opensekai`. If an instance runs, check its path. If it is from another worktree or a release bundle, tell the user and quit it (`osascript -e 'quit app "OpenSekai"'`, or kill the dev process).
2. Start the dev app in the background (Bash `run_in_background`):
   `OPENSEKAI_EVALUATION=1 pnpm dev:desktop`
   `OPENSEKAI_EVALUATION=1` grants the capture and benchmark capabilities that the MCP evidence tools and `pnpm evaluate:smoke` need. The first run builds the frontend and Rust code and can take several minutes.
3. Wait until `operator.json` is newer than the launch time (use Monitor with an until-loop on its mtime, not sleep polling). Then confirm with `node $SKILL/scripts/mcp-call.mjs app_status '{}'`.
4. If the build fails, that is a finding. Report the error output and stop.

The dev build inherits the terminal's macOS permissions (Input Monitoring, Camera, and so on). A checklist item about a permission prompt or a warning path only shows with a release bundle: `pnpm build:mac`, then `open <path>/OpenSekai.app` by explicit path. Launch Services can start a stale `OpenSekai.app` from another worktree, so check `pgrep -fl OpenSekai.app` after launch.

## 5. Extract the checklist

Read the PR body. Acceptance items in this repo are usually a numbered list under **Local acceptance**. Also take items from `- [ ]` task lists and sections named "Test plan", "Acceptance", or "QA". Each item often bundles several checks ("check X, Y, and that Z"). Split them so each check gets its own verdict.

Write the checklist to a scratch file (for example `<scratchpad>/qa-<pr>/checklist.md`) with columns: item, how you will check it (MCP, computer use, OBS, command), verdict, evidence. Keep this file updated as you go. It becomes the PR comment.

If the PR has no acceptance items at all, derive a short list from the PR summary and the changed files (`gh pr diff --name-only`), tell the user you did so, and label those items as derived in the report.

## 6. Verify each item

Use the real running app. Do not build scratch harness pages or rely on unit tests as evidence for UI behavior. The user wants proof that the shipped flow works on their machine.

Choose the most direct tool for each check:

**OpenSekai MCP** to drive and read state. If `mcp__opensekai__*` tools are present in this session, use them. Otherwise use the helper, which runs `apps/mcp/src/cli.ts` over stdio with the operator descriptor:

```sh
node $SKILL/scripts/mcp-call.mjs --list                       # tool names
node $SKILL/scripts/mcp-call.mjs --schema scene_patch          # one tool's input schema
node $SKILL/scripts/mcp-call.mjs --read opensekai://status
node $SKILL/scripts/mcp-call.mjs scene_inspect '{}'
node $SKILL/scripts/mcp-call.mjs capture_frame '{...}' --out <scratch>/qa-<pr>/evidence
```

Tools include `app_status`, `scene_inspect`, `scene_patch`, `camera_select`, `camera_screenshot`, `blueprint_edit`, `blueprint_run`, `capture_frame`, `expression_set`, `benchmark_*`, and `evidence_read`. Read the schema with `--schema` before calling a tool you have not used in this run. Inputs are strict, and edits need the current `expectedRevision` from `app_status` or `scene_inspect`. The text content of each result is JSON with `ok` and `data` or `error`.

**Computer use** for anything a user sees or does: clicks, drags, keyboard shortcuts, menus, Inspector fields, the viewport. Load the `anthropic-skills:computer-use` skill first. Take a screenshot after each meaningful step and keep the ones that prove a verdict. Prefer MCP to set up state (it is fast and exact), and computer use to check what the user experiences.

**OBS** for output, alpha, camera cuts, and "OBS follows" items. The local endpoint is `ws://127.0.0.1:4455` without auth. The user authorized local control for evaluation. Use only isolated QA sources, keep their existing scenes and settings, and never start a stream. The helper does all of this:

```sh
node $SKILL/scripts/obs.mjs status
node $SKILL/scripts/obs.mjs setup --state <scratch>/qa-<pr>/obs.json --program
node $SKILL/scripts/obs.mjs screenshot --state <scratch>/qa-<pr>/obs.json --out <scratch>/qa-<pr>/evidence/obs-1.png
node $SKILL/scripts/obs.mjs stats
node $SKILL/scripts/obs.mjs teardown --state <scratch>/qa-<pr>/obs.json
```

After `setup`, wait until `app_status` shows `output_main` with `connected: true` and a `lastFrame` before you take a screenshot. The output is transparent where nothing is drawn, so an empty scene gives a PNG that looks blank white in an image viewer. Check alpha by compositing on a checker (`ffmpeg -f lavfi -i color=gray:s=1920x1080 -i obs.png -filter_complex overlay -frames:v 1 check.png`), not by eye on the raw PNG. `--program` switches the program scene to the QA scene so the OBS window shows it, which is useful for computer-use checks and the demo. Teardown restores the prior scene. Always run teardown, also after a failure. For the full alpha and timing smoke check, `pnpm evaluate:smoke --profile webgpu_smoke_v1` with `OPENSEKAI_CONNECTION_FILE`, `OPENSEKAI_RENDERER_CONNECTION_FILE`, and `OPENSEKAI_EVIDENCE_DIR` set does it end to end.

**Commands** for items that name a command (`pnpm check`, `cargo test …`). Keep the raw output with counts.

Give each check exactly one verdict:

- **Pass**: you saw it work, and you have a screenshot, MCP output, OBS capture, or command output that shows it.
- **Fail**: it did not work. Record the steps, what you expected, and what happened.
- **Needs owner**: you cannot judge it honestly. Examples: subjective feel ("the feel is good"), hardware you do not have (iPhone tracking, a webcam, a MIDI device), or a real-GPU timing on another machine. Write what you observed, so the owner only has to make the judgment.

Do not round a partial result up to Pass. A measurement you could not take is "unknown", never zero. App timing and OBS timing stay separate. If something fails, look once for an obvious environmental cause (stale instance, wrong descriptor, OBS scene not shown) and retry once. Do not start fixing product code. The job is to report.

## 7. Record the demo

Record only when every check is Pass or Needs owner. A demo of a broken flow misleads reviewers. With a Fail, skip to step 8.

1. Plan a short script (under about 90 s raw) that shows the main user-visible change from the PR summary, using the flows you already verified. Set up state with MCP first so the recording shows only the interesting part.
2. Tile both app windows. The demo always shows the Editor and the Scene window together, because most changes have a cause in one window and an effect in the other:
   ```sh
   osascript -l JavaScript $SKILL/scripts/arrange-windows.js            # dev build; pass "OpenSekai" for a release bundle
   ```
   It puts `OpenSekai Editor` on the left and `OpenSekai — Scene` on the right, fills the main screen's visible area (below the menu bar, beside the Dock), raises both on top, and prints JSON with a `crop` filter for that area. Keep the `crop` value. The script needs Accessibility permission for the terminal. If macOS refuses, tell the user where to grant it (System Settings › Privacy & Security › Accessibility) and wait.
3. Check capture with `cap doctor --json`. If it reports `captureReady: false`, tell the user (it is usually the Screen Recording permission) and continue without a video. Get the main screen ID from `cap targets --json` (`screens[]`, `primary: true`).
4. Record the screen. A screen recording keeps both windows in one video. The crop removes the menu bar and the Dock later:
   ```sh
   cap record start --screen <id> --fps 30 --detach --json --path <scratch>/qa-<pr>/demo.cap
   # ... perform the demo with computer use and MCP ...
   cap record stop --path <scratch>/qa-<pr>/demo.cap --json
   ```
   During the demo, work only in the two OpenSekai windows. If another app comes to the front (a dialog, Finder, OBS), run `arrange-windows.js` again before you continue. Do not resize or move the windows, or the crop no longer fits.
5. Export, then crop, speed up, and compress:
   ```sh
   cap export <scratch>/qa-<pr>/demo.cap <scratch>/qa-<pr>/demo-raw.mp4 --quality web --optimize-filesize --fps 30 --json
   CROP='<crop from step 2>' $SKILL/scripts/compress-demo.sh <scratch>/qa-<pr>/demo-raw.mp4 <scratch>/qa-<pr>/demo-pr<pr>.mp4
   ```
   The script picks a speed of 1.25×–2× from the length (pass a third argument to override, never above 2×), scales to at most 1280 px wide, drops audio, and raises compression until the file is under 9.5 MB (the GitHub video limit is 10 MB). Look at one frame (`ffmpeg -ss 3 -i demo-pr<pr>.mp4 -frames:v 1 frame.png`) to confirm that both windows show side by side and nothing else covers them.

## 8. Post the result to the PR

Write the comment body to `<scratch>/qa-<pr>/comment.md`. Write it in short, plain sentences (the repo uses ASD-STE100 Simplified Technical English for PR text). Use this structure:

```markdown
## Local QA on macOS

Commit `<sha>` · <macOS version> · OBS <version> · renderer <webgpu|webgl2> · `pnpm dev:desktop` with `OPENSEKAI_EVALUATION=1`

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Free Look: right drag turns the camera | Pass | MCP `scene_inspect` yaw −20° → −42°; screenshot |
| 2 | Free Look feel | Needs owner | Movement is smooth at 60 Hz; the speed feels fast at sensitivity 1.0 |

**Not verified:** <each gap, or "none">

**Demo** (<speed>× speed): <one sentence on what it shows>
```

Then post it, with the demo when there is one. `gh` appends an attachment that the body does not reference, and a video renders as a player:

```sh
gh pr comment <n> --body-file <scratch>/qa-<pr>/comment.md --attach <scratch>/qa-<pr>/demo-pr<pr>.mp4
```

Attach up to three key screenshots too (`--attach <png>#<alt text>`) when they prove something the table cannot say in words, such as an OBS alpha capture.

When any check failed, show the user the report first and ask whether to post it. A failure comment is useful, but the user may want to fix the problem before reviewers see it. Do not edit the PR body or tick its boxes. The checklist stays the author's.

## 9. Clean up and report

1. `obs.mjs teardown` if a QA scene still exists. Check that OBS is back on the prior program scene.
2. Stop the dev app process that you started. Leave instances that you did not start.
3. Leave the checkout on the PR branch, and say so. Do not switch back on your own.
4. Report to the user in the terminal: the PR, the commit, the count of Pass, Fail, and Needs owner, each failure in one line, the comment URL, and the local evidence folder.
