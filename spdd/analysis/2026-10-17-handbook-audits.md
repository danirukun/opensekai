# Handbook audits analysis

Date: 2026-10-17. Issues: [#93](https://github.com/danirukun/opensekai/issues/93) (BP-13) and [#107](https://github.com/danirukun/opensekai/issues/107) (EXT-14). Queue bundle B11.

## Problem

1. BP-13 asks for a node-by-node audit of the Warudo handbook and the runtime node inventory before a full Blueprint parity claim. OpenSekai has 52 node types. No document maps them to the Warudo palette, and nothing stops a new node type from skipping the audit.
2. EXT-14 asks for an audit of the Warudo scripting API behavior before an extension parity claim. The extension sandbox slice (B10) put this audit out of scope.

## Existing material

- The Warudo 0.15.1 UI audit recorded 33 palette categories and 519 nodes. It recorded counts only, not node names.
- The handbook has no node reference page. Earlier specs took Warudo node names from handbook tutorials and marked them as not verified against the live UI.
- `blueprintNodeCatalog()` in `packages/contracts` lists each node type with its category and ports.
- `packages/extensions` holds API version 1: manifest, capabilities, guest data nodes, and asset type declarations.

## Constraints in this run

- The cloud proxy refuses `docs.warudo.app`. The handbook pages cannot be opened. Web search returns short summaries of the scripting pages only.
- Warudo does not run in the cloud. A live palette check needs a Windows host with a supported GPU.

## Decisions for this slice

- Deliver the first part of each audit. Both issues stay open (`Refs`, not `Closes`), and both checklist items stay unchecked.
- BP-13: keep the audit as data (`docs/evaluation/blueprint-node-audit.json`): one row for each OpenSekai node type with a Warudo palette category, a Warudo name candidate or `null`, and the evidence level. A unit test compares the file with the live catalog, so a new node type must be audited in the same change. Show coverage by Warudo category, not a parity percentage.
- EXT-14: keep the audit as a table in `docs/evaluation/scripting-api-audit.md`, one row for each documented Warudo behavior, with a status (Same, Partial, Different, Missing, Unknown) and the parity item that owns the gap. Mark each Warudo cell as a search summary until the owner opens the page.
- Do not change product code, the wire API, the show file, or the UI.

## Risks

- A wrong Warudo category or name candidate. Each one is marked as a candidate, and the owner check replaces it.
- A search summary that is wrong or old. The page lists each source page for the owner to open.
- The open B4 pull request adds node types. After it merges, the audit test fails until those types have rows. This is the intended guard.
