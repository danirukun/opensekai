# REASONS: Handbook audits

## R — Requirements

Start the BP-13 node audit (#93) and the EXT-14 scripting API audit (#107). Map each OpenSekai node type to the Warudo palette and keep that map current. Compare each documented Warudo scripting behavior with the OpenSekai extension API. Claim nothing that was not checked. Do not change product behavior.

## E — Entities

- Node audit row: OpenSekai node `type`, `warudoCategory` (one of the 33 palette categories, or `null`), `warudoCandidate` (a name or `null`), `evidence` (`macOS` or `tests`), and an optional `note`.
- Node audit file: the Warudo source, the palette counts (sum 519), and the rows.
- Audit problems: catalog types without a row, rows without a catalog type, duplicate rows, and rows with an unknown category.
- Category coverage: Warudo category, Warudo node count, and the number of OpenSekai rows in it.
- Scripting audit row: Warudo behavior, OpenSekai behavior, status (Same, Partial, Different, Missing, Unknown), and the owning parity item.

## A — Approach

Read the catalog through `blueprintNodeCatalog()`. Put the audit rows in a JSON file next to the evidence pages. Add two pure functions in `tools/evaluation`: `checkNodeAudit(catalog, audit)` and `categoryCoverage(audit)`. A unit test runs `checkNodeAudit` on the live catalog and the checked-in file. Take the evidence level from the evaluation pages and the parity text. Write the scripting table from the `packages/extensions` source and from search summaries of the Warudo pages.

## S — Structure

- `docs/evaluation/blueprint-node-audit.json` and `docs/evaluation/blueprint-node-audit.md`.
- `docs/evaluation/scripting-api-audit.md`.
- `tools/evaluation/src/node-audit.ts` and `tools/evaluation/test/node-audit.test.ts`.
- `docs/warudo-parity.md`: one detail line under BP-13 and one under EXT-14.
- `ARCHITECTURE.md`: the `tools/evaluation` row names the node audit check.

## O — Operations

1. Write this analysis and contract.
2. Write the audit data and the two functions with their unit tests.
3. Write the two audit pages.
4. Add the parity detail lines. Keep both items unchecked.
5. Run `pnpm check`, `pnpm test:unit`, `pnpm test:integration`, `cargo fmt --check`, `cargo clippy`, and `cargo test --workspace`.
6. Ask a reviewer on a different model for defects against the acceptance criteria.

## N — Norms

Write prose in ASD-STE100 Simplified Technical English. Use plain data and pure functions. An unavailable source is unknown, never a match. Do not give a parity percentage.

## S — Safeguards

- Each Warudo name and category is a candidate until the owner compares it with the live palette.
- Each Warudo scripting cell is a search summary until the owner opens the page.
- The audit test must fail when a node type is added without a row, and when a row names a type that no longer exists.
- Do not check BP-13 or EXT-14.
