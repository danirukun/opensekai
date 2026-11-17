# REASONS: Material parameter control (B38)

Date: 2026-11-16. Bundle B38: [#80](https://github.com/danirukun/opensekai/issues/80) (MAT-08), part of CHR-07 and ENV-03. Analysis: [Material parameter control](../analysis/2026-11-16-material-parameter-control.md). This contract adds:
- a color picker to the UI kit;
- a Color type to the Blueprint value model;
- a material list with model values to VRM and GLB asset records;
- saved material values on characters and props, with four Blueprint nodes and an Inspector section.

It changes B33 R4 (the list of writes that commit before the reply). The tag [PRn] names the PR that does the requirement.

## R — Requirements

### Color picker (kit)

R1 [PR1]. The kit exports `ColorPicker`.
- Props: `value` (bindable, lowercase `#rrggbb`), `label` (string or snippet, optional), `id`, `disabled`, `class`, `open` (bindable), `oninput(value)`, `onchange(value)`.
- No alpha.
- An invalid `value` shows `#000000` and does not call a callback.

R2 [PR1]. The closed control shows two parts.
- A swatch button. Its accessible name is the label. It has `aria-haspopup="dialog"` and `aria-expanded`.
- A hex text field (the kit `Input`).
- A typed value commits on Enter or blur only when it is `#rgb` or `#rrggbb` (the `#` is optional, and case does not matter). It is stored as lowercase `#rrggbb` and calls `onchange`.
- Invalid text goes back to the current value on blur.

R3 [PR1]. The swatch opens a panel with two controls.
- A saturation and brightness area: pointer drag, and arrow keys (1 % a step, 10 % with Shift). It has `role="slider"` with `aria-valuetext` (the hex).
- A hue slider (`input type="range"`, 0–360).
- Each change during a drag or a key repeat calls `oninput`. The end of a gesture (pointer up, or key up) calls `onchange` one time.
- The panel keeps hue and saturation while it is open, so black and gray do not lose the hue.

R4 [PR1]. The panel is a top-layer popover (`popover="auto"`, with `showPopover()`). It goes below the swatch, from `getBoundingClientRect`. It flips above when it does not fit, and it stays in the viewport. It closes on Escape, on a pointer down outside it, and on a second swatch click. Focus goes to the area on open and back to the swatch on close. Without `showPopover`, the panel uses `absolute` placement under the root.

R5 [PR1]. The control uses only the tokens in `theme.css` and the `ds-` classes. No new token. No text in the panel.

R6 [PR1]. The kit version goes to `0.2.0`. Unit tests and a playground section cover R1–R4.

### Color type and editors

R7 [PR2]. `docs/dependencies.md` names the kit merge commit that has `ColorPicker`. The snapshot comes from that commit.

R8 [PR2]. A new scalar type `color`:
- value: a lowercase `#rrggbb` string; label `Color`; default `#ffffff`; list type `color[]`;
- TypeScript and Rust check `/^#[0-9a-f]{6}$/`;
- `canConnect` does not change: a color connects only to a color;
- the string form, the Format String argument, and the debug text are the hex;
- an inline value is checked against the port type, as now.

R9 [PR2]. New nodes:
- `value.color`, label `Color`, category Values: a setting `value` (field kind `color`), output `value: color`.
- `color.make`, label `Make Color`, category Math: inputs `r`, `g`, `b` (number). Each input is clamped to 0–1 and rounded to the nearest of 255 steps. A non-finite input reads 0. Output `value: color`.
- `color.break`, label `Break Color`, category Math: input `value: color`; outputs `r`, `g`, `b` = byte / 255.

R10 [PR2]. The Editor:
- a socket color for `data-kind=color`;
- an inline `ColorPicker` for an unconnected color input on a node;
- the field kind `color` in Node properties;
- a `ColorPicker` for a Color variable default.
In the Blueprint canvas, the panel shows above the canvas at each zoom.

R11 [PR2]. `ColorField.svelte` keeps its props and uses the kit `ColorPicker`. The mapping:
- `oninput` → `onlive`;
- the end of a gesture → `onend`;
- a committed hex → `oncommit`.
Lights, the FPS counter, grading Tint, and the B37 Vignetting and Night Vision colors use it with no call-site change. The native `<input type="color">` is removed.

R12 [PR2]. No migration. Existing shows and Blueprint files stay valid with `formatVersion: 1`. The extension port types do not change.

### Material list on asset records

R13 [PR3]. VRM and GLB records get `materials?: AssetMaterial[]` (at most 256, in glTF material order). An `AssetMaterial` is:
`{ index, name, profile: 'mtoon'|'pbr'|'unlit', blend, outline, model }`
- `index`: the glTF material index.
- `name`: unique, 1–64 UTF-16 units. The rule is the `meshEntries` rule with 64 units: trim, `Material <index>` when empty, cut, then ` (2)`, ` (3)` in file order.
- `profile`: the `materialReport` rule.
- `blend`: glTF `alphaMode == "BLEND"`. For VRM 0: `_ALPHABLEND_ON`, the shader `VRM/UnlitTransparent`, or `VRM/UnlitTransparentZWrite`.
- `outline`: `profile == 'mtoon'`, the outline mode is not `none`, and the width is above 0 (the three-vrm rule; R17 confirms it).
- `model`: the model's own value of each parameter that applies (R14), and only those.

R14 [PR3]. The parameters (the shared registry `material-parameters.ts`):

| Key | Label | Type | Range | Applies to | three.js field |
| --- | --- | --- | --- | --- | --- |
| `baseColor` | Base Color | color | — | all | `color` |
| `opacity` | Opacity | number | 0–1 | `blend` | `opacity` |
| `emissionColor` | Emission Color | color | — | mtoon, pbr | `emissive` |
| `emissionStrength` | Emission Strength | number | 0–100 | mtoon, pbr | `emissiveIntensity` |
| `shadeColor` | Shade Color | color | — | mtoon | `shadeColorFactor` |
| `rimColor` | Rim Color | color | — | mtoon | `parametricRimColorFactor` |
| `outlineColor` | Outline Color | color | — | `outline` | `outlineColorFactor` |
| `outlineWidth` | Outline Width | number | 0–0.05 | `outline` | `outlineWidthFactor` |

R15 [PR3]. Model values:
- A glTF or VRM 1 color factor is linear. It becomes hex through the sRGB transfer of three.js `ColorManagement`, rounded to the nearest byte.
- A VRM 0 color first gets `pow(v, 2.2)`.
- `opacity` is the alpha of the base color.
- `emissionStrength` is `KHR_materials_emissive_strength.emissiveStrength`, or for MToon `VRMC_materials_hdr_emissiveMultiplier.emissiveMultiplier`, else 1.
- A VRM 0 outline width is multiplied by 0.01.
- Each number is clamped to its range.
- A missing factor takes the default of three-vrm or glTF.

R16 [PR3]. The VRM import and `prepare_scene` write `materials`. The two load paths backfill a library record without `materials` from the stored file, with its own written flag. Fixture records get it in memory only (the B26 R3 pattern). A file that cannot be read gives no list and no failure.

R17 [PR3]. TypeScript `materialEntries(json)` and Rust `model_materials(json)` give the same output. `fixtures/protocol/material-names.json` pins both. It has VRM 1, VRM 0, glTF PBR, unlit, blend, outline, duplicate-name, and long-name cases. A renderer integration test loads `fixture_vrm_1`, `fixture_vrm0_arkit`, and `fixture_glb_stage` with the production loader. It checks that each record model value is within 1/255 for each channel (1e-6 for numbers) of the loaded three.js value. It also checks the `outline` rule against the loaded outline clones.

R18 [PR3]. A new call `materialList { entityId }` for an avatar or a prop with an asset source. It returns `{ materials: [{ name, profile, parameters: [{ parameter, model }] }] }` in record order. Errors: `NOT_FOUND` for an unknown entity; `INVALID_INPUT` "Entity has no materials" for another kind or for no model. The MCP tool `material_list` gives it, as `mesh_list` does.

### Saved values

R19 [PR4]. The avatar and prop (`mesh`) entities get `materials?: Record<string, MaterialValues>`.
- A key is a material name (1–64 units). There are at most 256 keys.
- `MaterialValues` is a strict object with at least one of the eight keys of R14. Colors are `#rrggbb`. Numbers are in the R14 ranges.
- An empty group is removed.
- The Rust scene mirror has the same rules.

R20 [PR4]. A new patch op `setMaterialValues { entityId, materials }` replaces the group. `{}` removes it. Another entity kind gives `INVALID_INPUT` "Entity has no materials". The Rust `PatchOp` mirror has the same validation. A show save and open keeps the group.

R21 [PR4]. `setAvatarModel` and `setMeshModel` keep `materials`. A name that the new model does not have does nothing in the renderer, and stays in the show.

### Nodes

R22 [PR4]. Four nodes:

| Type | Label | Category |
| --- | --- | --- |
| `character.setMaterialProperty` | Set Character Material Property | Character |
| `character.resetMaterialProperty` | Reset Character Material Property | Character |
| `prop.setMaterialProperty` | Set Prop Material Property | Scene |
| `prop.resetMaterialProperty` | Reset Prop Material Property | Scene |

- Settings: `entityId`, `material` (a name), `parameter` (a key of R14), `transitionSeconds` (0–3, optional), `easing` (optional; the node default is `OutCubic`).
- Ports: input `flow`; outputs `exit` and `transitionEnd` (as `property.set`).
- Set also has an input `value`, with type `color` or `number` by the parameter (dynamic ports).
- An unconnected `value` reads the inline value. Without one, it reads the parameter default: Base Color `#ffffff`, Opacity 1, Emission Color `#000000`, Emission Strength 1, Shade Color `#ffffff`, Rim Color `#000000`, Outline Color `#000000`, Outline Width 0.

R23 [PR4]. Node properties fields, in order: Character (or Prop), Material, Property, Transition (s), Easing.
- The Material select lists the record materials of the chosen entity in file order. A name that is not in the list shows `Missing`.
- The Property select lists only the parameters that apply to that material, in R14 order. A material change sets the first parameter that applies when the current one does not apply.

R24 [PR4]. A run of Set or Reset gives a graph runtime error, writes nothing, and runs no output in these cases:
- The entity has no model record, or the record has no such material: `Material not found`.
- The parameter does not apply: `Material property does not apply`.
A Set clamps a number to the range of the parameter.

### Write path

R25 [PR4]. A Set or a Reset writes an override with a material key (the parameter and the name). With no transition, the override commits as `setMaterialValues` by the current rules:
- 250 ms after the last write for a clock step;
- before the reply for a `blueprintRun` call. This adds both nodes to the list in B33 R4.
A Reset commit removes the parameter. A write with no change of the evaluated value makes no commit.

R26 [PR4]. With `transitionSeconds > 0`, a tween goes from the evaluated value to the target. The evaluated value is the saved value, or else the record model value. The target of a Reset is the model value.
- A color tween mixes in linear light and gives the nearest hex at each step.
- The value commits when the tween ends, and then `transitionEnd` runs.
- A new write on the same key replaces the tween, as for asset properties.

R27 [PR4]. A material override or tween of an entity is dropped by `setMaterialValues`, `setAvatarModel`, `setMeshModel`, and `removeEntity` on that entity. The override and tween limits apply as now.

### Renderer

R28 [PR4]. The renderer reads `materials` from the evaluated frame entity.
- It applies each value after the expression update, so the graph value wins over an expression bind.
- It writes all three.js materials of the name: the GLTFLoader clones and the MToon outline clone (outline parameters to the outline clone only).
- It records each model value at load. It restores that value when a parameter leaves the group.
- Each prop instance has its own copy of every material.

### Inspector

R29 [PR4]. A Materials section.
- Placement: after Meshes for a character, after Prop for a prop. It shows when the record has materials or the entity has saved values.
- Controls: a Material select with the record materials in file order, then the saved names that the record does not have, each as `<name> (Missing)`. After it come the parameters that apply, in R14 order: colors with `ColorField`, numbers with `SliderField`.
- Each field shows the saved value, or else the model value.
- A saved parameter shows a `ResetMark` that removes it.
- A field edit sends `setMaterialValues` with live wiring, as the light fields do.
- A missing material shows its saved parameters as read-only values, each with a `ResetMark`.
- The section has no other text.

### MCP and documents

R30 [PR4].
- `materialList` adds `value` to each parameter (when it is saved) and `unknown` (the saved names that the record does not have).
- The `scene_patch` text names `setMaterialValues`.
- `opensekai://blueprint-nodes` lists the parameters with label, type, range, and profiles.

R31 [PR2–PR4]. Each PR updates `ARCHITECTURE.md` where a data path changes, and `docs/warudo-parity.md` with only the verified behavior.
- PR 2: the Color type in BP-01.
- PR 4: CHR-07, ENV-03, MAT-08, and the B33 R4 text.

## E — Entities

- `ColorPicker` (kit), and `ColorField` (OpenSekai adapter, props unchanged).
- `ScalarType` gets `'color'`. `ScalarValue` does not change, because `string` covers it.
- `MaterialParameter = 'baseColor' | … | 'outlineWidth'`, and `MATERIAL_PARAMETERS` with label, type, range, and `applies(material)`.
- `AssetMaterial { index: number; name: string; profile; blend: boolean; outline: boolean; model: Partial<Record<MaterialParameter, string | number>> }`.
- `MaterialValues = Partial<Record<MaterialParameter, string | number>>`, non-empty.
- Avatar and mesh entity field `materials?: Record<string, MaterialValues>`, and the patch op `setMaterialValues`.
- `MaterialKey`: an override key for one parameter of one named material, apart from `PropertyKey`.
- `MaterialList { materials: { name; profile; parameters: { parameter; model; value? }[] }[]; unknown?: string[] }`.
- Rust mirrors: `AssetMaterial`, `SceneEntity` fields, `PatchOp::SetMaterialValues`, `MaterialList`, and the value checks.

## A — Approach

- The kit first, then OpenSekai. Test first in each task.
- A new type reuses the string value form, so the value model and the Rust inline check change little.
- The material list follows B26: one rule in two languages, shared vectors, import plus backfill.
- Saved values follow `hiddenMeshes`: one group on the entity, one patch op, names as keys.
- Graph writes use the existing override layer, commit rules, and tweens with a wider key. No second commit path.
- The renderer follows hidden meshes: per-frame application from the evaluated scene, after the pose.

## S — Structure

- Kit: `src/lib/components/ColorPicker.svelte`, `src/lib/components/color.ts` (pure HSV and hex functions), `src/lib/index.ts`, tests, playground, `spdd/`, `package.json`.
- Contracts:
  - TypeScript: `blueprint-values.ts`, `blueprint-debug.ts`, `blueprint-nodes/{define,literals,color,character,prop,index}.ts`, `material-parameters.ts` (new), `materials.ts`, `schema.ts`, `types.ts`.
  - Rust: `crates/contracts/src/lib.rs`, `crates/contracts/tests/{blueprint,character_model,prop}.rs`.
  - Fixtures: `fixtures/protocol/{validation-vectors,blueprint-variables,material-names}.json`.
- Session: `overrides.ts`, `tweens.ts`, `session.ts`, `scene-ops.ts`, `session-api.ts`, `blueprint.ts`, `blueprint-eval/{data-helpers,literals,color,character,scene}.ts`.
- Renderer: `assets.ts`, `renderer.ts`, `environment-light.ts`, `material-values.ts` (new).
- Desktop:
  - Svelte: `ColorField.svelte`, `BlueprintNodeView.svelte`, `BlueprintNodeFields.svelte`, `BlueprintVariables.svelte`, `Inspector.svelte`, `MaterialFields.svelte` (new).
  - Editor code: `blueprints/fields.ts`, `editor/inspector-sections.ts`, `editor/model.ts`, `app.css`.
- Host: `assets/registry.rs`, `assets/vrm.rs`, `assets/materials.rs` (new), `service/router.rs`.
- MCP: `tools.ts`, `server.ts`, `resources.ts`.
- Docs: this contract and its analysis, `ARCHITECTURE.md`, `docs/warudo-parity.md`, `docs/dependencies.md`, `spdd/prompt/2026-11-13-editor-mcp-fixes.md`, and the evidence pages.

## O — Operations

Order: B33 merges. PR 1 (kit) can run at any time. PR 3 can start after B33. B34, then B37, merge. PR 2 runs after B37 and PR 1. PR 4 runs after PR 2 and PR 3.

1. PR 1, kit branch `feat/color-picker`: spec, `color.ts`, `ColorPicker`, tests, playground, version, merge.
2. PR 2, `claude/b38-color-type`: spec commit, kit pin, Color type (TypeScript and Rust), nodes, editors, ColorField, headless check.
3. PR 3, `claude/b38-material-list`: spec commit, registry and rule (TypeScript and Rust), vectors, import, backfill, fixture test, `materialList`.
4. PR 4, `claude/b38-material-values`: spec commit, entity field and op, write path, nodes, renderer, Inspector, MCP, docs, local check.

## N — Norms

- Unit tests for each pure rule: hex and HSV, value checks, Make and Break Color, the name rule, model values, the op, the override commit, the color tween.
- Integration tests at real boundaries only: the production loader with fixture files (PR 3), a real session for commit and save (PR 3, PR 4), and MCP over its transport (PR 3, PR 4). State the boundary in a comment.
- Headless Editor checks in Chromium for the picker in the canvas and in the Inspector. A local WKWebView and OBS check for the look and alpha (`accept:local`).
- UI copy only as the requirements state. Prose in Simplified Technical English.
- Each cargo command runs through `direnv exec .`.

## S — Safeguards

- Do not add a second primitive kit or a third-party picker.
- Do not add alpha to the Color type or to the picker.
- Do not change `PropertyKey`, `PROPERTY_REGISTRY`, or Set Asset Property.
- Do not add a commit path beside the override layer.
- Do not store a value by material index.
- Do not remove saved values on a model change.
- Do not change the transparency mode of a material at run time.
- Do not add a Get node, texture values, environments, or extension port types.
- Do not bump the Blueprint file format version.
- Do not claim the look in WKWebView or OBS before the local check.
