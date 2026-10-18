# Tracking receive and two performers analysis

Date: 2026-10-18. Scope: bundle B5 (#18 TRK-01 first subset, #19 TRK-02 first subset, #16 CHR-10 first subset for two performers). Contract: [tracking receive and two performers](../prompt/2026-10-18-tracking-receive-two-performers.md).

## Sources

- [Warudo VMC](https://docs.warudo.app/docs/mocap/vmc), read 2026-10-18. It gives: tracking comes from an external application through the VMC protocol; the default port is 39539, and Warudo's VMC receiver uses it; calibration happens in the external application; VirtualMotionCapture (supporter version, VR trackers) and VSeeFace ("Send data with VMC protocol") are the named senders; weird poses come from a model that differs between the two applications or from bones that are not normalized. It does not give receiver settings other than the port.
- [Warudo iFacialMocap](https://docs.warudo.app/docs/mocap/ifacialmocap), read 2026-10-18. It gives: the user enters the computer IP address in the phone app (**Destination IP address**); the **iFacialMocap Receiver** asset shows the computer IP addresses ("If several IPs are listed, try each one"); FaceMotion3D works through **Compatible with iFacialMocap**; the received data is 52 ARKit blendshapes, head rotation, and head translation; calibration is **Calibrate iFacialMocap**. It gives no port number. Troubleshooting names the input port, the input IP, the same Wi-Fi, a private network, and the firewall.
- [Warudo Motion capture overview](https://docs.warudo.app/docs/mocap/overview), read 2026-10-18. Receivers only receive data; tracking Blueprints connect it to a character. **Setup Motion Capture** on a character adds face and pose tracking for that character. Some receivers have a **Port** that must match the sender. iFacialMocap can add body movement (**Body Movement Intensity**). The page says nothing about two characters.
- [Warudo Character](https://docs.warudo.app/docs/assets/character), read 2026-10-18. A scene can have more characters through **Add Asset**. Motion capture is set up for each character. The page says nothing about which character a tracker drives.
- [Architecture design](../../docs/superpowers/specs/2026-10-02-opensekai-architecture-design.md), Tracking: "For each performer, assign body and face sources independently. … Prevent one source from applying to both performers by accident."
- [Minimum live VTubing contract](../prompt/2026-10-03-minimum-live-vtubing.md): the existing receive rules (addresses, conversion, limits, default endpoints, handshake, hold and fade).
- [Benchmark contract](../../docs/evaluation/benchmark-contract.md): "Two representative VRM performers; repeat with one."

## Current state

- **VMC receive.** `apps/desktop/src-tauri/src/tracking/parser.rs` decodes OSC messages and bundles (depth 4, 64 messages, 8 KiB). It handles `Root/Pos`, `Bone/Pos`, `Blend/Val`, `Blend/Apply`, `OK`, and `T`, and it ignores other addresses. It accepts only the `s`, `f`, and `i` type tags. Any other tag rejects the whole datagram, also in an address that it ignores. A bone name that is not a humanoid bone rejects the whole datagram. Unit tests cover bones, thumbs, Apply, heartbeats, limits, and partial commits. No test sends VMC bytes over UDP to the credited clock, and no test covers `Root/Pos` or a bundle that holds bones.
- **iFacialMocap receive.** The decoder reads the v2 text form and the legacy `-` form. It accepts the bone keys `head`, `leftEye`, and `rightEye`. Another bone key rejects the packet. It discards the head translation. When the phone address is set, the host sends the v2 handshake one time after bind, to phone port 49983. It does not send it again. No test covers the handshake. LIVE-08 records a physical phone check by the user, with no automated handshake capture.
- **Endpoints.** Each VMC and iFacialMocap source binds its own UDP socket. A second source on the same address and port gets "Cannot bind receiver endpoint". The iFacialMocap app has no destination port setting in the Warudo steps, so two phones send to the same port.
- **Sources and assignment.** A scene holds at most 4 tracking sources and 2 avatars. Each avatar has `tracking: { bodySourceId, faceSourceId }`. The session evaluates each avatar on its own. Nothing stops one source from driving both avatars. Duplicate clears the assignment of a copied character. Add Character puts each new character at the world origin, so a second character stands inside the first.
- **Editor.** The Inspector shows the bind address, port, sender or phone address, Start/Stop, state, error, and diagnostics. It does not show the computer IP address that the phone app needs.
- **MCP.** Tracking goes through `scene_patch` and `app_status`. The `scene_patch` description does not name the tracking operations. No MCP test covers tracking.

## Decisions

These decisions are reversible. The owner can change each one in review of this contract before code exists.

1. **VMC decode is tolerant of extra data.** The decoder reads the OSC 1.0 type tags `i`, `f`, `s`, and `b` and the common extra tags `h`, `d`, `t`, `T`, `F`, `N`, and `I`. An address that the receiver ignores never rejects a datagram when its tags are known; an unknown tag still rejects, because the reader cannot know its size. A number argument of a handled address can be `f`, `d`, or `i`. A well-formed `Bone/Pos` with a name that is not a humanoid bone is skipped; the other messages in the datagram still apply. A malformed datagram (bad padding, truncation, a non-finite number, an unknown type tag) is still rejected as one unit. Alternative: keep the strict rules and reject the datagram.
2. **iFacialMocap bone keys.** An unknown bone key is skipped, not rejected. Alternative: keep the rejection.
3. **Handshake retry.** When a phone address is set, the host sends the handshake after bind, and again at least 2 s later while no packet came in the last 500 ms. A send error does not stop the retry, because a network can be down for a short time. Thus a phone app that starts after the receiver connects without a manual step. Alternative: one send, plus a Reconnect action.
4. **Computer address in the Inspector.** The iFacialMocap receiver Inspector shows the IPv4 addresses of this computer, as Warudo shows them on the receiver. The host lists the non-loopback, non-link-local IPv4 interface addresses (at most 8) in `AppStatus.localAddresses`. The Rust standard library cannot list interfaces, so the host uses the `if-addrs` crate, a new direct dependency; the owner approves it by merging the contract. Alternative: no new dependency, and one address from a UDP connect probe (no interface list).
5. **Shared endpoint.** Two sources of the same kind can use one port (with equal bind addresses, or one of them `0.0.0.0`) when each has a different sender address (VMC) or phone address (iFacialMocap). The host binds one socket for the endpoint and gives each datagram to the source whose address matches the sender IP. Thus two phones that both send to port 49983 can drive two performers. A source without an address on a shared endpoint, or two sources with the same address, gets an endpoint conflict error. The source that already holds the endpoint wins, so a running performer is not cut off. A datagram from an unknown IP counts in a new `unmatchedPackets` status field. A source in error tries again when the endpoint plan changes, which also fixes a failed bind that today never retries. The show format does not change. Alternative: one port for each source, which the iFacialMocap app cannot use.
6. **One source for one performer.** A `scenePatch` is rejected when its end state has a source that two avatars use and its start state did not. This covers `setAvatarTracking`, `createEntity`, and a swap in one patch, and it keeps an existing share valid. One avatar can use the same source for body and face. Scene load and `sceneReplace` still accept an old show that shares a source, so no show stops loading. The editor source selects disable a source that the other character uses. Alternative: a schema rule for each scene, which can stop an old show from loading.
7. **Second character place.** Add Character puts a new character 1 m along world +X from the last character, so two performers do not stand inside each other. Duplicate does the same. Alternative: the world origin, as today.
8. **Calibration and head movement wait for B6.** Head translation, **Body Movement Intensity**, and **Calibrate iFacialMocap** belong to TRK-04 and TRK-05 (bundle B6). This slice does not change the sample shape.
9. **No new MCP tools.** The `scene_patch` description names the tracking operations. `app_status` returns `localAddresses`.

## Effects

- An operator can connect a VMC application that sends extra addresses or type tags, and can connect an iFacialMocap phone that starts before or after OpenSekai.
- An operator can run two performers: two characters, each with its own body and face sources, also with two phones on one port.
- The show format and the sample shape do not change. `AppStatus` and `TrackingStatus` each get one optional field. `apps/desktop/src-tauri` gets the `if-addrs` dependency. The host gets a shared endpoint data path, which `ARCHITECTURE.md` records.

## Risks

- The Warudo pages do not document the iFacialMocap port or a phone port setting. Decision 5 assumes that each phone sends to one fixed port (49983, or the source port of the handshake). The owner confirms the port with a physical phone.
- A tolerant decoder can accept a sender that sends a pose in another convention. The convention stays the one in the minimum live contract. Only a real sender on macOS shows the result.
- Some VMC senders send `Bone/Pos` for bones that the avatar does not have. Skipping them keeps the rest of the pose; the bone mapping does not change.
- The handshake retry sends a small datagram each 2 s to a phone that does not answer. It pauses while the source receives data and stops when the source stops.
- The real UDP test of a shared endpoint needs a second loopback address. Linux has it; macOS does not by default. On macOS only the pure routing tests and the owner check cover it.
- The cloud has no phone, no VMC application, and no OBS. Two-performer cost at 60 fps is unknown until the owner measures it.

## Out of scope

FaceMotion3D (TRK-03), calibration and source offsets (TRK-04, TRK-05), head translation, Body Movement Intensity, iFacialMocap TCP modes, VMC sending (MED-09), VMC tracker, HMD, controller, camera, and light addresses, more than 2 characters, more than 4 sources, and tracking Blueprints.
