# Shared contract verification

Observed: 2026-10-03. Source commits: 0a2bcf3, 692f5a0, e7002b9, d629c2f, fb904ba. The combined task review approved the corrected interface and validation behavior.

Root ran 36 TypeScript schema/client tests and eight Rust tests after integrating the review fixes. The same 20 shared vectors exercise accepted and rejected values. They cover field/version strictness, scene references, transforms, operation limits, method pairing, URL and UTC validation, duplicate capability grants, capture dimensions, marker bounds, encoded byte limits, and integral decimal/exponent counters. The later disconnected-client correction passed 11 covering client tests and its TypeScript check.

Review corrected four defects: mismatched URL/date validation, Rust vectors that tested the wrong envelope shape, duplicate authentication grants, and normalized resource origins. It also corrected old callback cleanup after reconnect, numeric representation parity, and disconnected error classification. Method-specific replies are checked before resolving callers. Initial rejected authentication closes the socket and clears timers.

The full Cargo workspace passed before the last review correction. The final focused Rust run passed after the fixes. Full desktop/OBS protocol integration remains the next gate. Mock transports prove client logic only; they do not prove native networking, GPU rendering, OBS output, or minimized simulation.

The next three workers use this frozen interface in separate worktrees. Public TypeScript schemas/types and Rust validators are committed. Local assets and credentials remain outside Git. No production parity box is checked by these contract tests.
