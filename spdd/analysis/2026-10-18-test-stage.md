# Test stage analysis

Date: 2026-10-18. Scope: a project-made environment fixture for visual checks (ENV-01, ENV-07, CAM-07, CAM-13, and MED-05 test targets). Contract: [test stage](../prompt/2026-10-18-test-stage.md).

## Sources

- Owner request, 2026-10-18:
  - a test environment map of about 10 × 10 m;
  - at least 2 walls and a floor, to check shadows from lights;
  - markings to check resolution and focus with different cameras and effects;
  - at least one green screen, for live chroma key;
  - built with the Blender MCP and its skills, checked in Blender, exported as GLB, and loaded into OpenSekai.
- Owner decisions, 2026-10-18:
  - Commit the build script and keep the GLB in the R2 fixture bucket.
  - The green screen is a cyclorama cove.
- [Environment import](../prompt/2026-10-13-environment-import.md) sets the GLB rules:
  - one self-contained GLB;
  - PNG, JPEG, or WebP images;
  - no Draco, meshopt, or KTX2;
  - file lights are removed;
  - credits come from `asset.extras`;
  - lit materials get the room map (R17).
- [Stage lights](../prompt/2026-10-18-stage-lights.md): at most 8 lights and 2 shadow lights. The directional shadow box is 20 m. An ambient entity scales the room map (R4a).
- [Quality controls](../prompt/2026-10-16-quality-controls.md): the texture cap is 2048 px on `production_v1` and 1024 px on `preview_v1`.
- The ColorChecker Classic sRGB values (BabelColor averages, D65).
- PolyHaven [Concrete Floor 02](https://polyhaven.com/a/concrete_floor_02) by Rob Tuytel, CC0.

## Current state

- `fixture_glb_stage` (TV01) is the only environment fixture. It is a decorative stage. It has no known dimensions, no test charts, and no green screen.
- The renderer has no chroma key and no depth of field. CAM-07, CAM-13, and MED-05 are "Later". A test target for them can exist before the effect.

## Decisions

1. **A build script is the source.** `scripts/test-stage/build_test_stage.py` builds the stage in Blender, and `pnpm build:test-stage` runs it headless.
   - The script runs unchanged in a live Blender through the Blender Lab MCP. The live run builds its own scene and removes only the data blocks that it tagged.
   - Blender exports are not byte-identical between runs, so the manifest pins the uploaded file. A rebuilt file is a new fixture revision.
2. **Charts are textures that Blender renders.**
   - An orthographic Workbench camera with flat object colours and the Standard view transform renders vector shapes and text at the exact pixel size. A patch of the colour checker reads back its sRGB value within 1 code value.
   - The zone plate comes from numpy.
   - Alternative: geometry for each line. That gives many thin triangles and no exact pixel scale.
3. **The resolution chart is unlit** (`KHR_materials_unlit`), so its contrast does not depend on the lights. The other charts are lit, so they also show the light.
4. **The green screen is lit**, with roughness 1 and specular 0. A real cove shows light falloff and shadows, and a keyer must handle them. Chroma green is sRGB (0, 177, 64).
5. **No lights and no cameras in the file.** The importer removes file lights, and each test adds its own light and camera entities.
6. **The PBR swatch is the PolyHaven skill input.** In authoring, the `polyhaven-texture-apply` skill gives the swatch. In the build, the maps are a pinned download checked by SHA-256, so the build does not depend on a skill.

## Effects

- A scene can put the stage, the fixture avatar, lights, and cameras in known places. The floor grid, the camera marks, and the height ruler give positions and scale in a screenshot.
- A screenshot of the resolution chart that fills the frame height gives a limiting resolution in LW/PH for each quality profile and camera.
- The cove gives a key target now. The keyer itself is later work.

## Risks

- **Texture cap.** At `preview_v1`, the 2048 px charts are scaled to 1024 px, so the chart limit is lower than at `production_v1`. The evidence records each profile.
- **Room map.** Without an ambient entity, the room map lights the green and the charts a little brighter (stage lights R4a). The evidence records the ambient setting.
- **Size.** The GLB is about 15 MB. The zone plate PNG is the largest part.
