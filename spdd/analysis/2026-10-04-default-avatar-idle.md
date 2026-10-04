# Default avatar idle analysis

User request: imported avatars get a default idle animation, such as a Mixamo idle. Start with a built-in loop. Imported animation clips remain a later slice.

The session owns simulation. Preview and OBS consume its evaluated pose. Existing tracking supports normalized MediaPipe and absolute raw VMC rotations, with a 500ms hold and 250ms fade. Fading raw tracking to the original T-pose would cause a jump when idle resumes. The renderer must blend from the evaluated idle baseline instead.

New imports enable idle. Existing scenes without the new optional setting keep their current behavior. An avatar property can enable or disable idle. Keep the smoke fixture unchanged. Evaluate the loop from session elapsed time, independent of packet timestamps and render clocks.
