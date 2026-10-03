# Warudo editor interactions analysis

The user requests direct dragging, resizing and context menus. The user then requests Warudo's UI structure as closely as possible. The user authorizes OBS URL clipboard tests. This removes the prior clipboard approval blocker.

Warudo uses a separate runtime window and asset/property editor. Its editor has a narrow navigation rail, an asset list and a large property panel. The scene uses W/E/R transform gizmos. OpenSekai currently has a combined viewport/hierarchy/inspector layout and width sliders. The current command protocol supports transforms and visibility, but does not support asset creation, deletion, grouping or naming.

Build the interaction slice around these existing commands. Preserve one scene worker. Keep production OBS output free from editor gizmos. Keep optimistic revisions and cancellation. Direct interaction must not submit one command per pointer move. Test math and command failure states, then test real desktop gestures and compare OBS captures.

References: https://docs.warudo.app/docs/assets/overview and https://docs.warudo.app/docs/tutorials/getting-started. Official screenshots were inspected in Chrome. A layout question was offered; absent an answer, use Warudo's separate scene/editor layout. A later answer can change window placement without changing the interaction core.
