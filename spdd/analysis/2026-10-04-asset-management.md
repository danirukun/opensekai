# Asset management analysis

Creation and type groups work. SCN-01 still lacks rename, duplicate and remove. Warudo lists these as asset actions: https://docs.warudo.app/docs/assets/overview (reviewed 2026-10-04).

Use the existing right-click menu and inline name input. This keeps the sidebar compact. A separate dialog for every action adds steps. A new toolbar would duplicate existing controls.

The session must own rename and remove. Duplication can use the validated create operation with a pure preparation function. Source removal must clear avatar assignments in the same transaction. A referenced output camera must be retained until the user selects another camera. The live sample history must be released by existing lifecycle reconciliation. Prepared files remain available after entity removal.

Copies need stable new IDs, independent settings and a unique name. Tracker copies start disabled. Avatar copies start with no body or face assignment. Existing scene budgets remain enforced. Save/load and undo are separate slices.

Actual macOS acceptance found a resource failure. The Scene WebView uses about 3.4 GB for the supplied avatar. Independent reloading of its textures for a copy increased memory to about 6.6 GB. WebKit killed the inactive process above its 4 GB limit and the restarted worker seeded an empty scene. This is measured native log evidence, not a clipboard failure. Resource sharing must pass before avatar duplication is accepted. Owner persistence/recovery remains a separate required slice.
