# Quality assurance

This document tells you which evidence a change needs before you say it is done. It adds to [AGENTS.md](../AGENTS.md) and the [constitution](constitution.md). For test levels, see [testing](testing.md).

## Questions each change must answer

Answer each question that applies. Put the answer in the pull request under **Evidence**.

| Question | Evidence that answers it |
| --- | --- |
| Does the code compile and pass type checks? | Raw output of `pnpm check`, and `cargo clippy` for Rust changes |
| Does the changed logic do what the contract says? | The new or changed test, and the raw test output with counts |
| Does a bug fix stop the bug? | A test that fails on the old code and passes on the new code. Show both results. |
| Does the changed flow work for the user? | A browser or app run of the flow, with a screenshot or a recorded step list |
| Does the output stay correct in OBS? | An OBS capture for alpha, camera, material, and visual performance changes |
| Did performance change? | Measurements under the [benchmark contract](evaluation/benchmark-contract.md), with app timing and OBS timing kept separate |
| Which platform did you check? | The platform table: macOS, Linux cloud, Windows |
| What is not verified? | A list of each gap. Use "unknown" for an unavailable measurement, never zero. |

## Evidence rules

- Attach raw output, not a summary. Include the command, the pass, fail, and skip counts, and each failure message.
- Record the commit, the renderer backend, the quality profile, and the fixture revision when they apply.
- Put screenshots, captures, and JSON evidence in `docs/evaluation/` and link to them.
- A running editor preview is not evidence for OBS output.
- A check on one platform is not evidence for another platform. The Linux cloud container cannot prove a macOS, OBS, GPU, or hardware result (see [cloud agent intake](agent-intake.md)).
- A known failure is evidence only when you name it, link its issue, and show that it is the same failure.

## Parity items

Each parity item in the [parity checklist](warudo-parity.md) uses the acceptance-criteria template in that file. Check a box only when each criterion has a test or evidence link. Keep partial work unchecked and write what remains.

## When a person must decide

Do not degrade the user experience to finish an item. Stop when a change needs a decision that you cannot make:

- a UX choice or a visual judgment,
- a product direction that changes the data model or the file format,
- a check that needs macOS, OBS, or hardware that you do not have.

Then:

1. Write the exact question, the options, and your recommended default on the issue.
2. Mark the parity item `Blocked:` with the question and the issue link (see the parity checklist).
3. Do not guess and do not ship a fallback for the blocked part. Continue with work that does not depend on the answer.

A check that only needs the owner's macOS host is not a blocked decision. Finish the other work and list the local steps under **Local acceptance** in the pull request.
