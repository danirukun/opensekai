# Blueprint catalog check

Checked 2026-10-10 on macOS from branch `opensekai/blueprint-catalog`. The live check started at commit `aeb8548`. The fixes that the check found are in commit `58cd3d1`, and the fixed behavior was checked again in the same session. The app ran with `pnpm --filter @opensekai/desktop tauri dev` (debug build, WKWebView). The Rust build gave no warnings. The renderer backend was not measured. No quality profile and no fixture mode were used. The show was a new show with two cameras (Camera and Camera 2) and no avatar.

The operator asked the agent to run the check. The agent drove the app with synthetic macOS input events (pointer clicks, drags, scroll, and keys) and captured only the editor window. OBS was not connected, so the camera cut was read from the editor Output panel, not from the OBS picture.

## Automated checks

At commit `58cd3d1`: `pnpm check` passed with 0 errors and 0 warnings. `pnpm test:unit`: 550 tests in 83 files passed. `pnpm test:integration`: 9 tests in 4 files passed. `cargo test --workspace`: 142 tests passed, 1 was ignored, 0 failed.

## Result of each step

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Canvas right-click: one menu, search field with focus, Select all; type `cool`, Enter | PASS. A Throttle node appeared at the click point, and the canvas got the focus back | [canvas menu](blueprint-catalog-canvas-menu.png) |
| 2. Node right-click: Delete, Duplicate, Copy, Disconnect all; wire right-click: Delete | PASS. Duplicate made a copy 24 px down and right. Wire Delete removed the wire, and ⌘Z restored it | — |
| 2a. Select all (⌘A), right-click one node, Delete, ⌘Z | PASS. The selection stayed through the right-click, all four nodes were deleted, and one ⌘Z restored them with their wire | [selection menu](blueprint-catalog-selection-menu.png) |
| 3. Drag a wire from a Throttle output to empty canvas | PASS. The search showed only nodes with a flow input. Gate was added at the drop point and wired to `enter`. One ⌘Z removed the node and the wire | [wire release](blueprint-catalog-wire-release.png) |
| 4. ⌘-click two wired nodes, ⌘C, ⌘V at the pointer, ⌘D, Backspace, ⌘Z three times, ⇧⌘Z | PASS. Paste kept the inner wire. Each undo step removed one action. Redo restored the paste | — |
| 5. Backspace in the Inspector number field | PASS. The text changed and no node was deleted | — |
| 6. Variable `Count`: ⌃⌥H → Add To Number Variable → Switch On Number (`1, 2`) → Switch Camera; press ⌃⌥H three times from Finder | PASS. The output camera went Camera 2, then Camera, then stayed on Camera | [graph](blueprint-catalog-counter-graph.png) |
| 7. Copy a node in graph 2, paste in graph 1; switch to Assets and back; ⌘Z | PASS. The paste landed in the other graph, and undo worked after the panel switch | — |
| 8. Save the show, open it again, press ⌃⌥H | PASS. The saved file has the variable and both graphs. After Open, the variable and all nodes and wires were back, and one press cut to Camera 2 (the count started again at 0) | [reopened](blueprint-catalog-reopened.png) |
| 9. Menu Delete, then ⌘Z; wire-release add, then ⌘Z | PASS. Undo worked without a click on the canvas first | — |
| 10. Esc in the menu, then Backspace on the selected node | PASS | — |
| 11. Add three nodes from the Nodes drawer | PASS after the fix below. They went to free places in view, and the search field cleared after each pick | — |

## Findings fixed during the check

- Search put Switch On Number before Number for the query `number`, because results were in category order. Now an exact or prefix label match comes first.
- Nodes added from the Nodes drawer went to the right, behind the Inspector. Now a new node goes to the nearest free place around the view center.
- Wires were drawn on top of nodes and covered port labels. Now wires are behind nodes.
- Switch On Number ports showed `case 0` and `case 1`. Now they show the case values (`= 1`, `= 2`).
- A right-click selected text in the node title in WebKit. Now node text cannot be selected. The selection-menu screenshot shows the text selection from before this fix.

## Limits

- The input events were synthetic. A synthetic ⌘-click selected more than one node only when the agent also sent a real Command key event, because Rete reads the Command key from key events. A physical ⌘-click was not tested.
- OBS was not connected. The output camera change was read from the editor, not from OBS frames. OBS timing was not measured.
- The run executed On Keystroke Pressed, Add To Number Variable, Get Number Variable, Number, Switch On Number, and Switch Camera live. Gate, Throttle, and Flip Flop were placed and wired but not executed. On Enable, Multi Gate, For Loop, the math, compare, and logic nodes, Random Number, and the boolean variable nodes are covered by unit tests and session integration tests only.
- Animations were not checked frame by frame; the agent saw only still images.
- No Windows run. No live Warudo comparison.
