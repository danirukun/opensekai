# ARKit morph targets

## Requirements
Use all 52 ARKit channels when the avatar supplies their morph targets. Preserve standard VRM expression fallback.
## Entities
Canonical ARKit names, registered VRM expressions, mesh morph slots, and per-avatar bindings.
## Approach
Resolve exact or canonical registered expressions first, direct named morphs second, and legacy preset aliases last. Accept iFacial left/right suffixes.
## Structure
Renderer-only reusable ARKit binding module; avatar pose adapter remains the integration point.
## Operations
Build bindings once. Clear prior direct slots before the expression manager updates. Apply current direct weights after that update. This preserves manager writes on shared slots and avoids jawOpen/aa duplication.
## Norms
Functional TypeScript, no asset contents or paths in committed evidence.
## Safeguards
Test all channels, aliases, multiple meshes, sparse reset, unrelated slots, expression precedence, and shared-slot manager ordering. Models without matching shapes retain preset fallback.
