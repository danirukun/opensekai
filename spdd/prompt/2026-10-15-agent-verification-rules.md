# REASONS: Agent verification rules

## R — Requirements

Give agents one place that says which evidence a change and a parity item need before they are done (#144). Record the Linux cloud baseline of the four check commands (#154). Make the Rust disconnect test independent of scheduler timing (#158). Do not change product behavior. Do not add a CI job.

## E — Entities

- Evidence question: a question a change must answer, with the type of evidence that answers it (command output, test, screenshot, OBS capture, log).
- Acceptance criteria record: expected behavior, how to verify it, the test that covers it, and the evidence link, for one parity item.
- Blocked parity item: an unchecked item with the label `Blocked:` and the exact open question and the issue link.
- Linux baseline: date, commit, command, pass, fail, and skip counts, and the reason for each skip or known failure.

## A — Approach

Model `docs/qa.md` and `docs/testing.md` on the Paseo documents. Link to the constitution and `AGENTS.md` for rules that they already state. Add a template section and a `Blocked` status row to the parity checklist, and apply the template to LIVE-10. In the Rust test, poll `ServicePorts::current_output` every 5 ms until it returns `Unavailable`, with a 3 s deadline. Panic with the output ID and the last result when the deadline expires.

## S — Structure

- `docs/qa.md`: evidence questions and evidence rules.
- `docs/testing.md`: test levels, real-interface rule, regression rule, wait rule, Linux baseline.
- `docs/warudo-parity.md`: template, `Blocked` status, LIVE-10 worked example.
- `AGENTS.md` and `CLAUDE.md`: links to the two new documents.
- `.github/pull_request_template.md`: macOS row says it is required for app, OBS, GPU, and hardware changes.
- `apps/desktop/src-tauri/tests/evaluation_integration.rs`: bounded wait helper.

## O — Operations

1. Run cloud setup and record the baseline on `main`, including the #158 failure.
2. Write the analysis and this contract.
3. Write `docs/qa.md`, `docs/testing.md`, the parity template, and the links.
4. Replace the fixed sleep. Run `cargo test --workspace` again on Linux.
5. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, and `cargo fmt --check`.
6. Ask a reviewer on a different model for defects against the acceptance criteria.

## N — Norms

Write prose in ASD-STE100 Simplified Technical English. Keep each document short. Link instead of copying. An unavailable measurement is unknown, never zero. Do not claim a macOS result from the Linux container.

## S — Safeguards

- The bounded wait must still fail when the disconnect is never processed. The deadline is 3 s, which is more than 100 times the old sleep.
- Do not change the service code for #158 unless the bounded wait also fails. If it fails, report a product bug on #158.
- Do not check a parity box. The worked example changes only the text format of an item that is already checked.
- `CLAUDE.md` must be identical to `AGENTS.md`.
