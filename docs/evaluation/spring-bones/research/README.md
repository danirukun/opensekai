# Spring bone research

These scripts supply the measurements in the [spring bones design](../../../superpowers/specs/2026-11-18-spring-bones-design.md). They are research tools, not product code. [results.txt](results.txt) has the raw output.

## Setup

- Machine: Apple M3 Pro, macOS 27.2.1.
- Engines: Node v26.13.0 (V8) and the macOS `jsc` shell (JavaScriptCore).
- Libraries: three 0.187.0 and @pixiv/three-vrm 3.5.5 with the project patch. esbuild 0.28.2 bundles the JavaScriptCore run. All three are in the repository `node_modules`.
- Date: 2026-11-18.
- Models: the VRM files in the owner's asset library. The files are not redistributable, so this folder keeps no model data. Nina, Xiulang Long, and Nemimi Yane are the 3 heavy models.

The scripts load only the node tree and the VRM extensions of each file (`skeleton-json.mjs`). Meshes and textures do not change the spring solver.

## Scripts

| Script | Measurement |
| --- | --- |
| `springcount.py` | Joints, colliders, and collision checks for each step, from the file data |
| `bench-threevrm.mjs` | Time of `springBoneManager.update` for each model, then for the 3 heavy models together in the same process |
| `bench-flat.mjs` | A flat typed-array solver against three-vrm. `EXACT=1` makes three-vrm use the exact bone length |
| `jsc-entry.mjs`, `jsc-main.mjs`, `node-main.mjs` | Time of one solver for the 3 heavy models, in a new process for each run, in JavaScriptCore and in V8 |
| `chaos.mjs` | Two three-vrm instances with a 1e-9 m start difference |
| `converge.mjs` | Time until a solver with moved tails agrees with the reference. Motion has a 0.5 m jump every 2 s |
| `fixedstep.mjs` | A solver that gets fewer frames, motion with jumps |
| `fixedstep2.mjs` | A solver that gets fewer frames, smooth motion. Modes: `naive` (one step of N/60 s), `hold` (N fixed steps on the newest pose), `interp` (N fixed steps on interpolated poses) |
| `run.sh` | Runs all of the above in sequence |

## Notes on the results

- `bench-threevrm.mjs` runs 7 models in one V8 process before it runs the 3 heavy models together. That number (1.74 ms) is higher than the number from a new process (0.45 to 0.50 ms). Use the `jsc-entry.mjs` rows for cost.
- The first `chaos.mjs` run got the wrong input. The rerun at the end of `results.txt` has the correct output.
- The skipped-frame rows of `converge.mjs` include the 0.5 m jumps. For the effect of the frame rate alone, use the `fixedstep2.mjs` `naive` rows.
- three-vrm reads 50 colliders for Xiulang Long. The file has 52.
