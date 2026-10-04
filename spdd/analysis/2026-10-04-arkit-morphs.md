# ARKit morph mapping analysis

Native iFacial decoding and session routing preserve expression names. The renderer previously resolved only registered VRM expressions and a small alias table. The supplied model contains all 52 named ARKit morphs, but most are not registered VRM expressions.

Bind known ARKit morph targets directly. Resolve registered expressions first, direct targets second and preset aliases last. Preserve legacy models with preset fallback. Bind once, keep state per avatar, and clear previous direct targets before VRM expression updates. Apply current direct targets afterward to prevent expression-manager reset from discarding them.

Generated tests cover every channel. Actual OBS checks cover selected expressions; do not infer authored morph quality from a channel name alone. No new packet format or persistent schema is needed.
