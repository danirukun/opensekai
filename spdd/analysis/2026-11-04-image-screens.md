# Image screens analysis

Date: 2026-11-04. Scope: MED-01 slice 1 (image screens and transparency). Contract: [image screens](../prompt/2026-11-04-image-screens.md). Issue: [GitHub #59](https://github.com/danirukun/opensekai/issues/59).

## Problem

An operator cannot show a picture in the scene. A stream scene often has a logo, a poster, a frame, or a sign near the character. Today the only way is to make a GLB with a textured quad in another tool and import it as a prop.

Warudo Screen (handbook, rechecked 2026-11-04): **Content Type** selects Image, Video, Browser, Display, Window, NDI, or Spout. For Image, **Image Source** accepts JPG, PNG, GIF, and WEBP, and transparent images are supported. The Appearance section has Bend (on by default), Bend Radius, Thickness, Crop, Corner Radius, Tint (alpha below 1 makes the screen semi-transparent), and Chroma Key. The page gives no size rule and no defaults for the other fields.

The parity checklist splits this work. MED-01 is image screens and transparency. MED-02 is video (B29), MED-03 is web pages (B30), MED-04 is desktop and window capture (B31), and MED-05 is curvature, crop, corners, tint, and chroma key. MED-06 and MED-07 are Spout and NDI.

## Code facts

- Each asset record is one GLB or VRM file (`AssetRecord.format` is `glb` or `vrm`). The ID is a kind prefix (`avatar_`, `scene_`) plus the SHA-256 of the stored bytes. `AssetSummary.of` finds the kind from the prefix.
- The trust rule in `ARCHITECTURE.md` says that a stored asset is one self-contained GLB container, and that the importers, `validate_glb` in the asset service, and `inspectContainer` in the renderer enforce it together.
- `GET /assets/{id}` always answers `content-type: model/gltf-binary`.
- The renderer reads bytes with `readAsset` and runs `inspectContainer`, then `GLTFLoader`. `createImageResizePolicy` already scales a texture down to the `maxTextureSize` of the quality profile with `createImageBitmap`.
- The host has the `png` crate. It has no JPEG, WebP, or GIF crate.
- The scene has no entity kind that shows a flat image. Props (`mesh`) take only GLB records.
- The OBS page draws with alpha. A transparent pixel in the scene must keep alpha 0 in the output.

## Decisions

- A screen is a new entity kind, `screen`, with a `content` union. Slice 1 has one content kind, `image`. B29 to B31 add video, web page, and capture kinds to the same union, so a screen keeps its ID, transform, and Blueprint targets when its content type changes.
- An image is a new asset kind with its own record format, not a GLB. The record keeps the raster file as the operator gave it (PNG, JPEG, WebP, or GIF). The trust rule changes to name two container types: a self-contained GLB, and one raster image whose signature and header the host and the renderer check. A raster image of these four types has no external reference, so the rule keeps its intent.
- The host reads only the signature and the header (width, height, frame count for GIF). It does not decode pixels. The renderer decodes with `createImageBitmap`. This needs no new Rust crate.
- A screen is unlit, as in Warudo. Lights, haze, and shadows do not change it, and it casts no shadow.
- The quad is 1 m high. Its width is 1 m times the aspect of the decoded image. Transform scale sets the size.
- A GIF shows its first frame. Animation is a later slice, with video (B29), because both need a clock-driven texture.
- Bend, Thickness, Crop, Corner Radius, Tint, and Chroma Key are MED-05. This slice adds none of them.

## Effects

- Old shows open without change. A show with a screen does not open in an older build.
- The asset library gets image records next to the model records. `assetList` gets the summary kind `image`.
- A new asset kind changes the asset service response type for those records.

## Risks

- WebKit, Chromium (OBS uses CEF), and the headless cloud browser must all decode the four types with `createImageBitmap`. WebP and GIF decode in current WebKit and Chromium. The cloud check proves Chromium only. The owner checks the Editor window (WebKit) and OBS on macOS.
- Wrong alpha handling gives dark fringes or a gray halo in OBS. The contract fixes one rule (straight alpha in the texture, normal blending) and a pixel check on the headless output.
- A large image uses GPU memory. The header limit (8192 × 8192) and the profile texture limit bound it.

## Out of scope

GIF animation, video, web pages, capture, Spout, NDI, MED-05 appearance fields, drag and drop, MCP import, and image import from a Warudo scene file.
