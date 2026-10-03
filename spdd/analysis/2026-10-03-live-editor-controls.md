# Live editor controls analysis

The minimum live VTubing path is accepted. The next editor slice follows the user's four requests: direct sidebar visibility, automatic asset-type groups, direct output camera selection and live position/rotation/scale edits.

The current hierarchy is flat. Visibility and camera actions exist only in properties/context menus. Transform input submits on Apply. The model rejects commands while another command is pending. Numeric scrubbing changes a local draft but the separate editor does not forward it to the renderer. Reusing Apply for each pointer event would lose updates through BUSY and cancel gestures on each revision.

Use existing validated scene operations and shared UI controls. Add pure grouping logic and a bounded live-edit coordinator. Renderers must still consume authoritative evaluated transforms, including OBS. Do not add a second scene simulation or transfer rendered images through IPC. Keep the user's current scene private and restore it after the release rebuild.
