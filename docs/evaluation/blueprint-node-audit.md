# Blueprint node audit (BP-13, first part)

Date: 2026-10-17. Base commit: `7783f94`. Platform: Linux cloud (Ubuntu, x86_64). Renderer backend: not applicable; this audit reads the node catalog and the evidence pages only. Scope: [#93](https://github.com/danirukun/opensekai/issues/93) first part.

## Sources

- **OpenSekai runtime inventory.** `blueprintNodeCatalog()` in `packages/contracts`: 56 node types in 9 categories (52 in 8 at the base commit; the character expressions slice added Set Expression and Toggle Expression, and bundle B5 added Get Bone Rotation and Offset Bone Rotation).
- **Warudo palette.** The Warudo 0.15.1 UI audit recorded 33 palette categories and 519 nodes ([follow-up plan](../superpowers/plans/2026-10-17-warudo-ui-audit-follow-up.md), BP-13 line in the [parity checklist](../warudo-parity.md)). The audit recorded category counts only. It did not record the node names.
- **Warudo handbook.** The handbook has no node reference page ([catalog design](../superpowers/specs/2026-10-09-blueprint-catalog-design.md)). The cloud container cannot open `docs.warudo.app` (the proxy refuses the host). The Warudo names in the data file come from the earlier specs, which took them from handbook tutorials. Each name is a candidate. Nobody compared it with the live Warudo palette.

## Data and check

[`blueprint-node-audit.json`](blueprint-node-audit.json) has one row for each OpenSekai node type: the Warudo palette category, a Warudo name candidate or `null`, the evidence level, and an optional note. Evidence `macOS` means that a macOS evaluation page records a live run of the node. Evidence `tests` means unit or session integration tests only.

`tools/evaluation/test/node-audit.test.ts` compares the file with the live catalog. A new node type, a removed node type, a duplicate row, or an unknown Warudo category fails `pnpm test:unit`. Thus a slice that adds a node must also audit it.

## Coverage by Warudo palette category

The OpenSekai count is the number of rows that map to the category. It is not a count of matched Warudo nodes, because the Warudo node names are not recorded. Do not read it as a parity percentage.

| Warudo category | Warudo nodes | OpenSekai rows |
| --- | --- | --- |
| Animation | 5 | 0 |
| Arithmetic | 183 | 90 |
| Asset | 25 | 5 |
| Audio | 3 | 0 |
| Bilibili | 21 | 0 |
| BlendShapes | 14 | 1 |
| Blueprints | 3 | 4 |
| Characters | 48 | 5 |
| Cinematography | 16 | 1 |
| Data | 6 | 10 |
| Debug | 6 | 4 |
| Douyin | 4 | 0 |
| Events | 7 | 7 |
| External Integration | 2 | 0 |
| Flow Control | 20 | 12 |
| Input | 10 | 9 |
| Interactions | 13 | 0 |
| Lattices | 2 | 0 |
| Lights | 4 | 0 |
| Literals | 31 | 5 |
| MIDI | 5 | 3 |
| MikuMikuDance | 1 | 0 |
| Miscellaneous | 3 | 0 |
| Motion Capture | 15 | 0 |
| Procedural Animations | 3 | 0 |
| Props | 7 | 0 |
| Scene | 1 | 0 |
| Stream Deck | 3 | 0 |
| Switches | 6 | 3 |
| Timer | 4 | 4 |
| Twitch | 11 | 0 |
| Variables | 29 | 11 |
| YouTube | 8 | 0 |

## Findings

1. 23 of 33 Warudo categories have no OpenSekai row: Animation, Audio, Bilibili, BlendShapes, Blueprints, Data, Debug, Douyin, External Integration, Interactions, Lattices, Lights, MIDI, MikuMikuDance, Miscellaneous, Motion Capture, Procedural Animations, Props, Scene, Stream Deck, Timer, Twitch, and YouTube. Most of them belong to open parity items, for example CHR (characters), TRK (motion capture), BP-06 (MIDI), BP-07 (streaming platforms), BP-08 (props), CHR-12 (MikuMikuDance), and EXT-11 (Stream Deck).
2. Arithmetic has 183 Warudo nodes. OpenSekai has 23 rows there. The difference is mainly type coverage: Warudo variables have Boolean, Integer, Float, String, Vector3, and list types. OpenSekai ports are `number`, `boolean`, and `vector3` only.
3. Variables has 29 Warudo nodes and 6 OpenSekai rows, for the same type reason.
4. 19 of 56 OpenSekai node types have a live macOS run on record. 37 have unit or integration tests only.
5. Each Warudo name and category in the data file is a candidate. `Delay` can be in Timer, not Flow Control. Compare, logic, and Vector3 nodes can be in a category other than Arithmetic.

## B13 update (2026-10-18)

Bundle B13 (branch `opensekai/blueprint-depth`) adds 118 node types. The catalog now has 174 node types, and the table above counts the rows at that point. The findings above describe the base commit. After B13:

1. 17 of 33 Warudo categories have no OpenSekai row: Animation, Audio, Bilibili, Douyin, External Integration, Interactions, Lattices, Lights, MikuMikuDance, Miscellaneous, Motion Capture, Procedural Animations, Props, Scene, Stream Deck, Twitch, and YouTube.
2. Ports and variables now have the Warudo data types: Boolean, Integer, Float (`number`), String, Vector3, and a list of each. Most new rows close the type gap that findings 2 and 3 name.
3. 19 of 174 node types have a live macOS run on record. Each B13 row has `tests` evidence until the integrated macOS run records it.
4. Each Warudo name in the B13 rows is a candidate or `null`, as before.

## What remains for BP-13

- Record the Warudo node names for each palette category from the live palette, on a host with a supported GPU. Then replace each candidate with the recorded name, or with `null` and a reason.
- Compare the behavior of each matched pair, node by node. Record Same, Approximate, or Different.
- Open the handbook pages again when the host can reach them, and record the date.

BP-13 stays unchecked.
