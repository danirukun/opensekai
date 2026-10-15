# Agent verification rules analysis

Issues: [#144](https://github.com/danirukun/opensekai/issues/144), [#154](https://github.com/danirukun/opensekai/issues/154), [#158](https://github.com/danirukun/opensekai/issues/158). Queue bundle B1.

## Problem

Agents now implement parity items in cloud containers and on macOS. The rules for evidence are in `AGENTS.md`, the constitution, the development workflow, and the parity checklist. No single document tells an agent which evidence a checklist item needs before it is done. The parity checklist has no acceptance-criteria template and no state for an item that waits for a human answer.

The cloud setup script exists on `main` (`scripts/cloud-setup.sh`), and `README.md` names it. The Linux baseline of the four check commands is not recorded. An agent cannot tell a known Linux failure from a new failure.

One Rust test, `service_ports_retain_all_native_ack_times_and_reject_disconnected_output`, sleeps a fixed 20 ms after it closes the renderer socket and then expects the output to be unavailable. The host processes the close in a separate task. On a slow or busy Linux container, 20 ms is not always sufficient. The test fails, but the service behavior can be correct.

## Existing material

- `AGENTS.md` "Verification" and constitution principle V give the test-level rules.
- `docs/development-workflow.md` "Verification scale" repeats them in short form.
- `docs/warudo-parity.md` "Status and evidence rules" says that a checked box needs an evidence row.
- `.github/pull_request_template.md` already has Evidence and Platform sections from the intake work (#157).
- The Paseo `qa.md`, `testing.md`, and `coding-standards.md` are the model the issue names. The useful ideas are: a list of questions each change must answer, raw output as evidence, tests through the real interface, and a regression test that fails on the old code.

## Decisions for this slice

- Put the evidence questions in `docs/qa.md` and the test-level rules in `docs/testing.md`. Do not copy the constitution; link to it.
- Add no separate coding-standards file. The constitution and `AGENTS.md` cover package manager, functional TypeScript, comments, UI copy, and tests. Add only the few rules that they do not cover (Rust test waits, no fixed sleeps for a cross-task effect) to `docs/testing.md`.
- Add the acceptance-criteria template and a `Blocked` status to `docs/warudo-parity.md`. Use LIVE-10 (One Euro filter) as the worked example, because it has unit tests, session tests, and an evidence page.
- Fix #158 in the test only. Replace the fixed sleep with a bounded poll of `current_output`. The other sleeps in the same file do not wait for a disconnect.

## Risks

- A long rules document that agents do not read. Keep each file short and link from `AGENTS.md`.
- A baseline that becomes old. Record the commit and the date with the counts.
- A bounded wait that hides a product bug. Use a deadline of a few seconds and a clear failure message, so a disconnect that never arrives still fails.
