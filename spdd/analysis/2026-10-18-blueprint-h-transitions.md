# Blueprint transitions analysis

Date: 2026-10-18. Scope: slice H of bundle B13 "Blueprint depth" (#85, BP-05). Transition time and easing for Blueprint writes, Set BlendShape, and Look At. Plan: [Blueprint depth](../../docs/superpowers/plans/2026-10-18-blueprint-depth.md).

## Problem

A Blueprint write in OpenSekai snaps. Set Asset Property moves a camera, changes its Field of View, or turns a prop in one tick. Set Expression fades only with the fixed Fade time of the expression, and the fade is always linear.

Warudo actions commonly have two inputs: **Transition Time** (seconds) and **Transition Easing** (a DOTween ease name). With them, a camera pushes in, a prop slides, or a face changes over time, with an ease curve. Operators use this for camera moves, expression changes, and blend shape animation in a show.

Three Warudo operations have no OpenSekai node:

- **Set BlendShape.** Warudo sets one blend shape of a character by name to a weight, with a transition. OpenSekai can only trigger VRM expressions.
- **Look At.** Warudo characters can look at a target (a camera or another asset) with a weight. OpenSekai has no look-at.
- **Easing.** OpenSekai has no easing function.

## Facts from the code

- The session owns the clock (`advance(elapsedMs)`). The Scene window worker runs it. The editor window does not drive it. So motion that the session computes continues when the editor is minimized.
- Set Asset Property writes the runtime override layer (`overrides.ts`). An override with no write for 250 ms commits to the persistent scene in one patch (continuous Blueprints R10 and R11).
- Expressions are runtime state (`expressions.ts`): `{ target, weight }` per name, with a linear fade by `fadeSeconds`.
- The bone offset layer (`bone-offsets.ts`) is empty at the start of each tick. Offsets are rotations in the parent frame of a bone. The renderer applies them after the pose.
- The renderer applies `AvatarPose.expressions` by name: VRM expression names, the ARKit names (directly to morph targets when the model has them), and some aliases. It has no path for an arbitrary mesh morph target name.
- An asset record lists only the triggerable expression names of a model. Import drops the names that tracking drives. The session does not know the morph targets of a model.
- The session does not know bone positions. It knows the entity transform of each character.

## Decisions

- **One interpolation module.** Easing functions and the transition sample (`from`, `startMs`, `seconds`, `easing`) are pure functions. The property tween layer, the expression fade, the blend shape layer, and the look-at layer use the same sample. Each layer keeps its own state in the session, not in the Blueprint run state.
- **Settings, not a new property node.** Set Asset Property, Set Expression, and Toggle Expression get two optional settings: `transitionSeconds` and `easing`. A saved graph without them loads and runs as before. A second node ("Transition Asset Property") would repeat the property picker and the typed `value` port. Warudo puts the transition inputs on the action node.
- **Settings, not data ports.** A new required data input would make old graphs fail to compile ("Blueprint input is not connected"). Slice W0 adds inline values for data inputs. A later slice can move the transition to ports when inline values exist.
- **DOTween names.** The easing values are the DOTween `Ease` names that Warudo shows: `Linear` and `In`, `Out`, `InOut` for Sine, Quad, Cubic, Quart, Quint, Expo, Circ, Elastic, Back, and Bounce (31 values). The default is `Linear`, because the current expression fade is linear.
- **Tweens use the override layer.** A property tween writes an override on each tick. So the evaluated scene, the preview, the OBS output, and Get Asset Property see the intermediate value, and the scene revision does not change. While a tween is active, its override does not commit. After the last write, the override commits once by the 250 ms rule.
- **Rotation uses slerp.** A rotation tween interpolates quaternions on the shortest path. Euler interpolation would go the long way round and pass through gimbal lock.
- **Replacement.** A new transition on the same entity and property replaces the old one. It starts from the current evaluated value. An immediate write (Set Asset Property without a transition, Move Entity) and an editor or MCP patch of the property stop the tween.
- **Blend shape names.** Set BlendShape lists the names that the renderer can drive: the triggerable expressions of the record, the VRM preset names that tracking drives, and the 52 ARKit names. The renderer ignores a name that the model does not have. Arbitrary mesh morph targets are a gap.
- **Blend shape merge.** A Set BlendShape weight merges with tracking and expressions by `max`, like an expression. A weight of 0 releases the blend shape. It cannot hold a tracked blend shape at 0.
- **Look At turns the head only.** The session computes the direction from an estimated head point to the target and writes a yaw and pitch rotation to the `head` bone offset. The head point is the character position plus 1.4 m up in the character frame. The yaw is limited to 70 degrees and the pitch to 45 degrees. The offset adds to the tracked head rotation. Warudo uses an IK solver for the head and eyes, so this is Approximate.

## Rejected approaches

- A tween state per node in the Blueprint run state: a tween must continue after the run ends, and an edit that resets the run state must not stop motion that is already visible.
- Renderer-side tweens: the renderers must consume evaluated state, and the OBS output must equal the preview.
- Euler lerp for rotation: wrong path for large turns.
- A new commit for each tween step: the scene revision would change on each tick, and editor edits would conflict.
- Eye look-at with the eye bones or the `look*` expressions: the VRM look-at type differs by model (bone or expression). The session cannot tell which. Later.

## Effects

- An eased camera Field of View push, camera move, or prop turn shows in the preview and in OBS at the frame rate. The scene revision increases by one when the transition is done.
- The Inspector shows the committed value. During a transition it shows the value from before the transition.
- An expression with a transition fades with the given time and easing. The fade time of the expression applies when the node has no transition.
- Blueprint files and shows keep their shape. The new settings are optional.

## Risks

- An older OpenSekai build rejects a graph that has the new settings, because node settings are strict objects. This is the same rule as for each new setting.
- A Back or Elastic ease goes past the target. A number property is clamped to its registry range, and a scale component stays above zero, so the write stays valid.
- The head point estimate is wrong for a very tall or very small model. The look direction is then a few degrees off.

## Out of scope

Transition inputs as data ports, eye look-at, IK, mesh morph target names, animation playback, camera cuts with a blend, and a transition for Set Visibility.
