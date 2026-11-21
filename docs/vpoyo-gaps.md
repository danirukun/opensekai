# VPoyo gap analysis

Requested by Daniils Petrovs. Reviewed on 2026-11-15 against VPoyo test build v0.21.57.

VPoyo ("VRMぽよぽよ動くやつ", "Something that makes VRM models wiggle and jiggle") is a face-tracking VTubing app by LUCAS (@lucas_VTuber). It has not been released yet; it goes on sale (paid) after the tester round, Windows first, with a Mac version "probably" later. It is aimed at casual streamers who send the output straight to OBS. All facts below come from the developer's and testers' posts on X (see Sources); there is no store page or official site yet.

## Biggest gaps first

1. **Spring bones (hair and cloth physics), #14.** VPoyo's look depends on bouncy hair and cloth. Partial since 2026-11-18: OpenSekai runs the VRM-authored spring bones in the editor and OBS ([check](evaluation/spring-bones.md)). Controls, collisions with other objects, and `VRMC_springBone_limit` remain.
2. **Bouncy Live2D-style motion, #294.** VPoyo exaggerates vertical bounce from head pitch and the jaw. In progress since 2026-11-21: the code is in the Face-Only Body Motion template, off by default (`Bouncy Motion`). The OBS check is not done, so nothing is verified yet ([check](evaluation/bouncy-live2d-motion.md)).
3. **Pose presets for face-only tracking, #296,** and manual posing and IK, #12.
4. **Items attached to the body, #297,** which needs bone attachment points, #13.
5. **Hold Screen pose template, #293** (held image, video or capture, with the upper body following head tracking).
6. **Eye jiggle, #295.**
7. **Lighting effect presets including a window-shadow light, #298.**
8. **Casual setup mode, #299.**

## What VPoyo v0.21.57 ships

App tabs: Avatar, Input, Motion, Pose, Item, Expression, Camera, Light, Background, Save, and a help button.

| VPoyo feature | OpenSekai status | Issue |
|---|---|---|
| Face-only webcam tracking, no hand tracking needed | Has (MediaPipe, macOS FaceKit #292, iFacialMocap, VMC) | #24 (closed), #260 |
| VRM 1.0 and 0.x only, perfect sync supported | Has | #7, #9 (closed) |
| Bouncy hair and cloth | Partial: VRM-authored spring bones; no controls | #14 |
| Exaggerated Live2D-like vertical bounce (sink when the chin drops, bounce when it rises) | In progress: code landed, OBS evidence pending | #294 |
| Eye jiggle toggle, works on models without it | Missing | #295 (related #92) |
| Poses that fix the hands in place (selfie, wave) | Missing | #296, #12 |
| Items attached to the body: condenser, handheld and stand mics, headphones, controller in colors, beer mug | Partial: props exist, no bone attachment | #297, #13, #41 |
| Hold an image (add, previous and next, size, hold height, tilt, left or right side, both hands, flip transition) | Missing; Screens exist but cannot be held | #293 |
| Expression tab | Has | #9 (closed) |
| Camera follows the head (amount, smoothness) | Partial: Orbit and Focus Character | #168, #49 (closed) |
| Handheld camera shake (size, speed) | Missing | #169 |
| Camera work presets ("cut plus slow small movement") | Partial: Camera Sway template (#239) | #89 |
| Separate field-of-view sliders for the whole screen and the face | Missing; exact behavior not confirmed | none yet |
| Lighting effect presets, window-shadow / diagonal light (light and shadow color, strength, rotation, position) | Partial: lights and grading exist | #298, #45 (closed), #54 |
| Background import (image; video from its vlog origin) | Partial: image and video Screens exist; no sky or background slice | #148, #59 and #60 (closed) |
| Green screen and transparent background | Transparency has it; green background partial | #52 (closed), #148 |
| Save | Has | #5 |
| Simple tabbed UI that testers rate highly | Partial | #299, #115, #181, #182, #183, #184 |
| No tracking data sent to other apps, straight to OBS | Not needed; OpenSekai also has a VMC sender | #67 (closed) |
| Windows first, Mac later | OpenSekai is macOS first; Windows not verified | #108 |

## Sources

- Developer posts (LUCAS, @lucas_VTuber):
  - https://x.com/lucas_VTuber/status/2118924924924661801 (announcement and 31 s demo: face only, Live2D-like bounce, eye jiggle, panels)
  - https://x.com/lucas_VTuber/status/2118926582857527564 (no external sending, for OBS)
  - https://x.com/lucas_VTuber/status/2118986270332592244 (chin down sinks, chin up bounces)
  - https://x.com/lucas_VTuber/status/2113446759355863532 (vlog origin: background video, selfie poses)
  - https://x.com/lucas_VTuber/status/2120400836853662109 and https://x.com/lucas_VTuber/status/2120411582102659212 (held image panel, flip before switching)
  - https://x.com/lucas_VTuber/status/2121144948628337001 (release after testing; VPoyo logo)
  - https://x.com/lucas_VTuber/status/2121572631275286970 (VPOYO-Desktop-v0.21.57)
  - https://x.com/lucas_VTuber/status/2121572236201259301 (eye jiggle button)
  - https://x.com/lucas_VTuber/status/2121614634491031593 (VRM 1.0/0.x, perfect sync)
  - https://x.com/lucas_VTuber/status/2121805899597758894 and https://marshmallow-qa.com/messages/39a87538-3c4c-4e01-ba55-220fbf7870d0 (green screen and transparency)
  - https://x.com/lucas_VTuber/status/2121925243350733130 (no Mac at release)
  - https://x.com/lucas_VTuber/status/2121611492521103551 (paid pricing)
  - https://x.com/lucas_VTuber/status/2121548686480273854 and https://x.com/lucas_VTuber/status/2121571977383256408 (UI and beginners)
- Testers:
  - https://x.com/nz7_sia/status/2121441237807083878 (lighting, poyo motion, background, items stick in place)
  - https://x.com/nz7_sia/status/2121848282423123989 (held fan art panel)
  - https://x.com/HoshikageLapis/status/2121874193545622004 (hold an image, headset and mic items)
  - https://x.com/00A5AC/status/2121588803114832144 and https://x.com/00A5AC/status/2121711527942369363
  - https://x.com/Hitoyo_Vtuber/status/2121535024583635096 (texture and lighting)
