# NiloToon research findings

Date: 2026-10-17. Status: **parked**. This record is not an implementation contract. It applies to parity items MAT-04, MAT-05, and MAT-06 ([#76](https://github.com/danirukun/opensekai/issues/76), [#77](https://github.com/danirukun/opensekai/issues/77), [#78](https://github.com/danirukun/opensekai/issues/78)).

Question: What must OpenSekai do to support NiloToon? Which license and royalty terms apply? Can we get the source code from the developer and port it to three.js?

## Summary

1. [UnityURPToonLitShaderExample](https://github.com/ColinLeung-NiloCat/UnityURPToonLitShaderExample) is not NiloToon. It is a small MIT tutorial shader by the same author. OpenSekai can port it with attribution.
2. NiloToonURP is a closed-source, paid Unity package. The license is perpetual and royalty-free. The price is not published.
3. The license lets a buyer embed NiloToon in a product only if "the receiver/user can't access NiloToon's source file". A three.js port sends WGSL or GLSL text to the client. Thus a port does not satisfy this condition without special permission from NiloCat. This is true for an open-source plugin and for a closed one.
4. Warudo does not port NiloToon. Warudo Pro runs the compiled Unity shaders from a `.warudo` character that the author builds in Unity with a pinned NiloToon version.
5. NiloToon depends on URP render passes, not only on a material. A port is a new implementation of each feature in TSL, not a translation.
6. Decision: park the work. Do not start a port, a plugin, or a clean-room NiloToon profile now. The resume conditions are in [Resume gate](#resume-gate).

## Sources and checks

| Source | What it gives | Check |
| --- | --- | --- |
| [Example repository README](https://github.com/ColinLeung-NiloCat/UnityURPToonLitShaderExample) and [LICENSE](https://github.com/ColinLeung-NiloCat/UnityURPToonLitShaderExample/blob/master/LICENSE) | Example scope, MIT license, NiloToonURP purchase terms | Read directly on 2026-10-17 |
| NiloToon manual, version 0.17.16 (2026-10-05), a public Google Doc linked from the README | License tiers, Warudo integration, features, roadmap | Read directly on 2026-10-17. Not stored in this repository. |
| [Warudo Pro](https://docs.warudo.app/docs/pro), [NiloToon Volume](https://docs.warudo.app/docs/assets/nilotoon-volume), [NiloToon Character Controller](https://docs.warudo.app/docs/assets/nilotoon-character-controller) | Warudo features | Read by a research agent |
| [three-vrm](https://github.com/pixiv/three-vrm), [three-liltoon](https://github.com/mochiya-labs/three-liltoon) | Web toon material bases | Read by a research agent |

The NiloToon price and a formal EULA text are unknown. The manual has no clause about a port to a different engine or about use in software that is not Unity.

## The public example

The README says: "This repository does NOT contain the full version of NiloToonURP." The example is "intended for shader coding tutorial purposes" and "may be removed in the future". It is MIT, copyright 2020 ColinLeung-NiloCat.

It has cel shading with a midpoint and a softness, indirect and additional lights, received URP shadows with a tint, emission, occlusion, alpha clip, and an inverted-hull outline with a view-space Z offset. It has the passes ForwardLit, Outline, ShadowCaster, DepthOnly, and DepthNormalsOnly.

Most of this is already in VRM MToon. The example alone does not give the NiloToon appearance. The concert images in its README come from the full product.

## NiloToonURP license

The README terms for a buyer: the full source with comments ("NOT Obfuscated code, NOT .dll"), a "perpetual royalty-free commercial license", future updates, and support. The contact address is nilotoon@gmail.com. The buyer gets access to a Google Drive folder.

The manual section "Who can access NiloToon files?" has three tiers:

| Tier | Who can access the files |
| --- | --- |
| Personal | The buyer only |
| Single-Entity | Employees and internal interns of one company |
| Multi-Entity | The above, plus affiliates, subsidiaries, contractors, and external interns, for the buyer's projects |

For clients and end users, the manual says: "Embedding NiloToon in the final product is fine, if the receiver/user can't access NiloToon's source file." A client who needs the files must buy a license: "Clients must purchase their own NiloToon licenses if they need to access NiloToon." For that row, the table also says "Contact us if you need special permission".

There are no royalties. The limit is on who can access the source.

## Warudo and NiloToon

- NiloToon support is only in Warudo Pro. The manual says it "isn't available in the free Warudo version".
- An author builds a `.warudo` character in Unity 2021.3.45f2 with NiloToon 0.16.12 to 0.16.12p6. Warudo renders it with the compiled Unity shaders in the bundle.
- Warudo adds two assets. The NiloToon Volume has an anime gradient, separate character and environment bloom, a character rendering override, and a shadow override. The NiloToon Character Controller reads and changes the NiloToon settings of a character, for example color and dissolve. Blueprints can drive it.
- The agreement between HakuyaLabs and NiloCat is unknown. The avatar author must have NiloToon to build the character.

## NiloToon features and URP dependencies

From the manual:

- **Outlines.** An inverted hull with a Z offset and smoothed normals baked into UV8. An extra-thick outline pass. A screen-space outline that needs a renderer feature and a volume.
- **Face and hair.** A face shadow from an SDF gradient map. Kajiya-Kay hair specular. Hair shadow on the face.
- **Lighting.** Rim light and shadow from the camera depth texture. MatCap. lilToon-style HSV controls.
- **Shadows.** A self-shadow map for each character that fits a bounding sphere around the hip bone. URP shadow settings do not change it. An average-shadow pass.
- **Effects.** Dissolve, dither fade, perspective removal.
- **Control.** `NiloToonPerCharacterRenderController` sets bones, the bounding sphere, and character overrides. Volumes control bloom, tonemapping (which can skip the character area), character rendering, shadows, anime post-processing, motion blur, and a cinematic rim light.
- **URP internals.** `NiloToonAllInOneRendererFeature` adds the self-shadow map, the prepass buffer (the character mask `_NiloToonPrepassBufferTex`), the average shadow, and the extra-thick outline passes. It uses RenderGraph and the camera depth texture. It requires Depth Priming off.

OpenSekai uses three.js `WebGPURenderer` with TSL and `MToonNodeMaterial` from three-vrm (`packages/renderer/src/assets.ts`). Each item above needs a TSL material node, a new render pass, or a post-processing step. The renderer has no API for extra passes now.

## Web shader constraint

WebGPU takes WGSL as text in `createShaderModule`, and WebGL takes GLSL as text. There is no binary shader format. Minification and symbol renaming change the text, but tools such as WebGPU Inspector or Spector.js capture the exact shader text from the Scene window or from the OBS Browser Source. A Unity build ships compiled shader bytecode, which gives more protection. NiloCat must decide if obfuscated WGSL satisfies "can't access NiloToon's source file". OpenSekai must not make that decision.

## Options considered

| Option | Summary | Result |
| --- | --- | --- |
| Port the source into the open renderer | Buy NiloToon, translate it to TSL, ship it in OpenSekai | Rejected. It gives the source to every user. |
| A. Clean-room NiloToon-style profile | Own TSL toon material on MToon with similar features, built without NiloToon source | Possible without a license. Parked. |
| B. A, plus import of NiloToon settings | Map material values from NiloToon avatars to the profile with an exporter that the user runs in a licensed Unity project | Needs a rights review of the parameter schema. Parked behind A. |
| C. Licensed closed renderer plugin | A compiled and obfuscated NiloToon plugin in a private repository, loaded by OpenSekai | Preferred if NiloCat gives written permission. Parked. |
| D. Record and park | This document | Selected. |

### Requirements for option C

1. **Written permission.** NiloCat confirms in writing that a web runtime is permitted when it sends obfuscated shader text to the client GPU, in an application that is open source.
2. **License tier.** At least Single-Entity for the company that builds the plugin. Multi-Entity if contractors work on it. Open-source contributors cannot read the source, so the plugin is in a private repository.
3. **Clean-room wall.** A person who has read NiloToon source does not write open toon material code in OpenSekai. This keeps option A clean if both options exist.
4. **Trusted renderer plugin tier.** The QuickJS extension sandbox does not give guest code GPU access, and the architecture design defers arbitrary GPU programs. A NiloToon plugin runs in `packages/renderer` and adds passes. This is a new trusted, signed plugin class. It needs an architecture decision and an ARCHITECTURE.md change. The OBS page at `/renderer/` must load the same plugin.
5. **Avatar data path.** A VRM file has no NiloToon data. The plugin needs a glTF extension that a Unity exporter writes from the user's licensed project, or editor controls in OpenSekai, or both.
6. **Version policy.** Warudo pins one NiloToon version. The plugin also pins one version and states it.
7. **Evidence.** OBS output for alpha, outlines, shadows, and character-mask post-processing on WebGPU and WebGL 2, as [quality assurance](../../qa.md) requires.

## Rules while parked

- Do not open, download, or use NiloToon files from an unofficial source. A third-party Git host appears to carry NiloToon package files. Use of them taints a clean-room implementation.
- Do not claim NiloToon support or compatibility in the product, the parity checklist, or release notes.
- The UnityURPToonLitShaderExample code may be ported under MIT with its copyright notice.

## Resume gate

Resume option C only when NiloCat gives the written permission in requirement 1 and the company has a price for the license. Resume option A only when MAT-01 (VRM MToon and glTF PBR) is checked, and the renderer has a design for extra render passes.

Questions for NiloCat, if the team makes contact:

1. Does a license permit a NiloToon reimplementation for a web renderer (WGSL and GLSL) in a non-Unity application?
2. Is obfuscated shader text that the client GPU receives acceptable under "can't access NiloToon's source file"?
3. Is the plugin permitted in an application that is open source, if the plugin itself is closed?
4. Which tier and price apply? Is there a separate license for third-party applications, as for Warudo and MELIGO Creator?
5. May an exporter read NiloToon material values in a user's licensed Unity project and write them to a glTF extension?

## Open items

- OpenSekai has no project license yet (README). Select one before contact with NiloCat, because questions 1 and 3 depend on it.
- The NiloToon price, the EULA text, and the HakuyaLabs agreement are unknown.
