# Analysis: Material parameter control from graphs (B38)

Date: 2026-11-16. Bundle B38, [#80](https://github.com/danirukun/opensekai/issues/80) (MAT-08). It also changes CHR-07 ([#13](https://github.com/danirukun/opensekai/issues/13)) and ENV-03 ([#41](https://github.com/danirukun/opensekai/issues/41)). Base: `main` at `06dce38`. Contract: [Material parameter control](../prompt/2026-11-16-material-parameter-control.md).

[V] = verified in the code at `06dce38`, in the UI kit at `25d5144`, or in the Warudo VM readout of 2026-11-13. [I] = inferred. [U] = unknown.

## 1. Problem

A user cannot change a material of a character or a prop. Warudo has Set Character Material Property and Set Prop Material Property nodes, and Default Material Properties on characters and props. OpenSekai has no material state in the scene, no material list on asset records, and no color data type in Blueprints.

## 2. Owner decisions

Round 1 (2026-11-13):
1. Material values are saved with the show. Reset returns a parameter to the model's own value.
2. Targets: characters and props. Environments stay out.
3. Eight parameters with readable labels: Base Color, Opacity, Emission Color, Emission Strength, Shade Color, Rim Color, Outline Color, Outline Width.
4. Opacity applies only to materials that already blend.
5. Nodes: Set and Reset Material Property, for Character and for Prop. No Get node. The material picker is a plain select in file order.
6. A Color data type in the Blueprint value model (TypeScript and Rust), with a good color picker.
7. A Set on a material that does not exist gives the graph error `Material not found`. The run does nothing.
8. A graph value wins over an expression color bind.

Round 2 (2026-11-16):
1. An Inspector Materials section with full editing of the parameters that apply, with reset marks.
2. A new `ColorPicker` in the kit repository, then a snapshot update in OpenSekai.
3. The picker replaces `ColorField` everywhere: lights, FPS counter, grading Tint, and the B37 Vignetting and Night Vision colors. B37 keeps its separate Alpha slider.
4. The Color type is RGB only (`#rrggbb`).
5. Color nodes: Color value, Make Color, Break Color.
6. Saved values for a material that the new model does not have stay. The Inspector lists them as missing.
7. Four PRs. The planner decides whether PR 3 and PR 4 merge (section 8).

## 3. Reference behavior (Warudo)

- [V] The palette search "material" gives four nodes: Get and Set Character Material Property (category Characters), and Get and Set Prop Material Property (category Props).
- [V] The Set inputs, in order: Character (or Prop), Material, Property, Transition Time (0–3, default 0), Transition Easing (default OutCubic). The outputs: Exit and On Transition End. The value input follows the property type: Color (RGBA), Vector4, Float, Int, or Override Texture.
- [V] Material and Property are autocomplete fields that take free text. They list Unity material names and shader property names.
- [U] Whether a Warudo Set is saved, how it mixes with expressions, and whether a Reset exists.

Accepted differences: readable labels, a plain select, a saved result, a Reset node, RGB only, eight parameters.

## 4. Current state

### 4.1 UI kit and ColorField

- [V] The kit (`oshi-connect-ui` at `25d5144`, and the snapshot in `.local/ui`) exports Avatar, Badge, Button, Card, Combobox, DateTimeField, Dropdown, Input, Modal, Select, SelectMenu, Spinner, Textarea, ThemeToggle, ToastRegion, and Tooltip. There is no color control. `Input` accepts the types text, email, password, number, and datetime-local only.
- [V] There is no general popover. `Dropdown` puts its menu in an `absolute` box under its root (`Dropdown.svelte:111`). It closes on a document click and on Escape.
- [V] The kit rules (`AGENTS.md`):
  - Svelte 5 with `@sveltejs/package`, and Tailwind v4 tokens in `src/lib/theme.css`.
  - Vitest with Testing Library and happy-dom, and a playground app.
  - `docs/design-system.pen` is the visual source. It is edited only through the Pencil MCP.
  - No `cd … &&` and no `git -C`.
  - To verify: `pnpm install`, `pnpm build`, `pnpm test`.
- [V] Kit release: `ci.yml` builds, tests, and runs a publish dry run on each pull request. A push to `main` publishes to GitHub Packages. The version is `0.1.0`. [I] A second publish of `0.1.0` fails, so a change needs a new version.
- [V] Kit specs are in `spdd/analysis/<slug>.md` and `spdd/prompt/<slug>.md` (REASONS form). The branch prefixes are `feat/` and `bugfix/`.
- [V] The kit has no `license` field and no license file. `docs/dependencies.md` requires both. This is outside B38 (issue 1).
- [V] OpenSekai uses a generated snapshot of the kit: `"@oshi-connect/ui": "file:../../.local/ui"` (`apps/desktop/package.json:19`).
  - `docs/dependencies.md:29` names the expected kit commit (`25d5144d2ffaeed84d596c482a0e5424c1d9ea9e`).
  - `scripts/cloud-setup.sh:95-170` checks out that commit, builds the kit, and runs `scripts/bootstrap-ui.ts`.
  - The release workflow clones the kit (`release.yml:88-96`).
  - `.local/` is not in Git.
- [V] `ColorField.svelte` is a kit `Input` for the hex text plus a native `<input type="color">` that opens the system color panel. Its props: `label`, `value` (`#rrggbb`), `disabled`, `onlive`, `onend`, `oncommit`. It has no alpha.
- [V] ColorField is used in `LightFields.svelte:49`, `FpsCounterFields.svelte:19`, and `CameraGradingFields.svelte:27`. The approved B37 plan adds two uses in `CameraEffectsFields.svelte` (L5, L10), with a separate Alpha slider (D11). B37 reads `ColorField.svelte` but does not change it (B37 plan, lines 36 and 234).
- [V] Each saved scene color is lowercase `#rrggbb`: `LightColorSchema` (`schema.ts:127`) and `light_color_ok` (`lib.rs:236`).

### 4.2 Blueprint value model

- [V] TypeScript, `blueprint-values.ts`: `SCALAR_TYPES = ['number','integer','boolean','string','vector3']`. Each type has a list form, a label, a schema, a default, a fast check, and a problem check. `canConnect` accepts equal types, or an integer into a number. There is no other conversion.
- [V] Rust, `lib.rs:1590-1637`: `BLUEPRINT_SCALAR_TYPES: [&str; 5]`, `blueprint_scalar_ok`, `blueprint_value_ok`, and `inline_value_ok`. `inline_value_ok` checks the shape only (a number, a boolean, a string of at most 1024 characters, or three numbers). The session checks the value against the port type.
- [V] These parts get a new type with no change: variables (`blueprint.ts:8`), typed variables, typed and payload settings (`typed.ts`), list item types (`lists.ts`), Format String arguments (`text.ts`), debug types (`blueprint-debug.ts:44`), and the Rete sockets (`rete-editor.ts:24`).
- [V] These parts need a branch for each type:
  - `stringForm` and `sameValue` (`data-helpers.ts:5,40`)
  - `scalarText` (`blueprint-debug.ts:33`)
  - `parseScalar` (`fields.ts:20`)
  - the inline editors (`BlueprintNodeView.svelte:65-75`)
  - the field kinds (`define.ts:12-32`, `BlueprintNodeFields.svelte`)
  - the variable default editor (`BlueprintVariables.svelte:52`)
  - the socket CSS (`app.css:81-85`, `:90`)
- [V] `sameValue` compares arrays by three items. A hex string uses `===` and needs no change.
- [V] The extension manifest has its own port types (`manifest.ts:23`).
- [V] The Blueprint file has `formatVersion: 1`. A higher version gives `Blueprint file needs a newer OpenSekai` (`blueprint-file.ts:73-76`).
- [V] The categories (`define.ts:9`) include no Props category. The Vector3 nodes are in Math, and the prop operations are in Scene.

### 4.3 Graph writes and saved state

- [V] `OverrideLayer = Map<entityId, Map<PropertyKey, OverrideEntry>>` (`overrides.ts:7-8`). `takeIdle` commits an entry 250 ms after its last write when no transition holds it. It makes one patch op for each group (lines 79-108). `touchedProperties` and `dropOverrides` remove an override when a patch changes its field.
- [V] The frame scene is the evaluated scene: `applyOverrides(persistent, overrides)` (`session.ts:508`).
- [V] Tweens are keyed by entity and `PropertyKey`, with the kinds number, vector3, and rotation (`tweens.ts:30-32,50`). `MAX_TWEENS = 64`.
- [V] Transition settings: `transitionSeconds` 0–600 and `easing`, both optional. `DEFAULT_EASING = 'Linear'` (`transition.ts`, `easing.ts:13`). The easing names are the DOTween names that Warudo shows.
- [V] B33 R4 (approved, not merged): a `blueprintRun` call commits the overrides of its step before it replies. R4 lists Set Asset Property without a transition (or on a boolean), Move Entity, and Camera Orbit Character without a transition. The contract file will be `spdd/prompt/2026-11-13-editor-mcp-fixes.md`.
- [V] B26 is the pattern for a saved per-model field:
  - `hiddenMeshes` on the avatar (`schema.ts:211`)
  - the `setHiddenMeshes` operation (`schema.ts:315`, `scene-ops.ts:92`)
  - the Rust mirror (`lib.rs:484`, `:809`, `:2713`)
  - names as keys, and `meshList` with `unknown` names (`meshes.ts:55-59`)
- [V] `setAvatarModel` and `setMeshModel` change only the asset reference (`scene-ops.ts:72-74`).
- [V] A prop is `kind: 'mesh'` with a box or asset `source` (`schema.ts:194`). The Rust `SceneEntity::Mesh` has no optional field (`lib.rs:455-461`).

### 4.4 Materials at run time

- [V] An avatar loads its own VRM through the uncached `loadAsset` (`renderer.ts:136-147`). Two characters from one asset do not share materials.
- [V] A prop is a `clone` of the cached asset scene (`renderer.ts:148-157`). `environmentLight.apply` copies only the lit materials of each instance (`environment-light.ts:62-89`). Unlit materials are shared.
- [V] MToon loads as `MToonNodeMaterial` (`assets.ts:128`). `materialReport` runs at load only for the warning (`assets.ts:139`). The report name is cut to 64 units and is not unique (`materials.ts`).
- [V] The renderer applies hidden meshes and MToon UV each frame (`renderer.ts:369-370`, `:387-388`). The expression `update()` is at `avatar-pose.ts:119-120`. three-vrm restores bound colors in `update()` and then applies the weights, so a material write must come after it.
- [V] three-vrm v0compat 3.5.5:
  - It applies `pow(v, 2.2)` to the VRM 0 colors `_Color`, `_ShadeColor`, `_RimColor`, `_OutlineColor`, and `_EmissionColor`.
  - It multiplies `_OutlineWidth` by 0.01.
  - A material blends when it has `_ALPHABLEND_ON`, or the shader `VRM/UnlitTransparent`, or the ZWrite form.
- [I] three-vrm makes the outline clone only when the outline mode is not `none` and the width is above 0 at load. The PR 3 executor confirms this in the source.

### 4.5 Asset records

- [V] The `glb` format is used for props and environments (ID prefix `scene_`). `prepare_scene` writes `meshes: None` (`registry.rs:600-640`). The VRM import writes `meshes`, and two load paths backfill it (`registry.rs:108-152`, `:294-300`). Rust `vrm_meshes` and TypeScript `meshEntries` share `fixtures/protocol/mesh-names.json`.
- [V] The window has the asset records. The Inspector reads `meshes` from them (`Inspector.svelte:60`).
- [V] Cloud fixtures (`fixtures/cloud/manifest.json`): `fixture_vrm_1` (VRM 1), `fixture_vrm0_arkit` (VRM 0), `fixture_glb_stage`, and `fixture_test_stage`. `two-vrm.integration.test.ts` loads fixture files with the production loader.

### 4.6 Inspector

- [V] `sectionsFor` (`inspector-sections.ts`) gives an avatar Transform, Model, Expressions, Meshes, and Tracking, and gives a prop Transform and Prop.
- [V] `ResetMark.svelte` is the reset control, and `SliderField.svelte` is the live slider with a number field. A field select shows `Missing` for a value that is not in its list (`BlueprintNodeFields.svelte:99-103`).

### 4.7 Parity

- [V] CHR-07 (`warudo-parity.md:79`): "material control … and Default Material Properties remain."
- [V] ENV-03 (`:127`): "… material properties … remain."
- [V] MAT-08 (`:213`): Later.

## 5. Choices

| Question | Choice | Reason |
| --- | --- | --- |
| New registry keys or new nodes | New nodes | The registry is a closed list of fixed scene fields. Material addresses depend on the model. |
| Color value form | Lowercase `#rrggbb` string | It is the form of every saved scene color, so a commit does not round again. Equality and string form need no change. Rust `inline_value_ok` already accepts it. |
| Key of a saved value | Material name | A name survives a re-export that changes the order (as in B26 and Warudo). |
| Where values live | One JSON group, `materials`, on the entity | Constitution rule 7. |
| Write path | The existing override layer with a material key | The 250 ms commit, the B33 commit, `dropOverrides`, and transitions apply with no second mechanism. |
| Model values | On the asset record, read at import | The session needs them to start a transition from an unsaved value, for a Reset with a transition, and for the Inspector. The simulation is authoritative, so the renderer cannot be the source. |
| Prop materials | Each prop instance copies every material | A value on one prop must not change another prop of the same asset. |
| Picker panel | Top-layer popover | It must show above the Blueprint canvas transform and the Inspector scroll box. |
| ColorField | Keep the file and its props, with the kit picker inside | All users, B37 included, get the picker and their call sites do not change. |
| Transition range | 0–3 s, default easing OutCubic | These are the Warudo values. The owner saw them as settled in round 1. |

## 6. Risks

- [I] The Rust model values must match three-vrm. If they do not, a Reset or a transition ends with a jump. A fixture integration test compares the two.
- [I] WKWebView supports the popover API (Safari 17 and later). It is not known whether happy-dom supports `showPopover`.
- [I] More copies of prop materials can add GPU pipelines and memory.
- [I] A saved value masks an expression color bind on that parameter at all times.
- [I] Opacity in OBS depends on the MAT-01 alpha behavior, which is not verified.
- [V] Long VRoid material names make a plain select wide (issue 6).

## 7. Overlap

- B33 (merges first): `overrides.ts`, `session.ts`, the continuous Blueprints contract. PR 4 adds the material writes to the R4 list.
- B34 and B37: `schema.ts`, `types.ts`, `lib.rs`, `validation-vectors.json`, `renderer.ts`, `Inspector.svelte`. They change different regions.
- B37: two ColorField uses. PR 2 runs after B37 merges.
- B39: `BlueprintPanel.svelte`, in a different region.
- B40: the new labels of this bundle.

## 8. PR split

1. PR 1 (kit repository): `ColorPicker`.
2. PR 2: the kit pin, the Color type and nodes, the editors, and ColorField on the kit picker.
3. PR 3: the material list with model values on VRM and GLB records, import, backfill, and `materialList`.
4. PR 4: saved values, the four nodes, the write path, the renderer, and the Materials section.

PR 3 and PR 4 stay separate:
- PR 3 is Rust import and record work with its own vectors and its own fixture test.
- PR 3 needs neither the Color type nor B33, so it can run at the same time as PR 2.
- PR 4 is already the largest change. One merged PR would be too large to review.
