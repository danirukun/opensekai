# MCP round trip

Date: 2026-10-03. Debug source: 99aabef. Release confirmation pending.

The official MCP client connected through real stdio to the CLI and called all nine tools. Scene patch advanced the revision once. A stale patch returned CONFLICT. Camera selection advanced the revision once. The client waited for the matching OBS renderer ACK before requesting capture. A first immediate capture correctly returned CONFLICT while the new revision had not reached the renderer. It was not replayed.

The successful PNG capture was from output_main at 1920 by 1080, revision 4, tick 4374, sequence 3959, camera_close, WebGPU. Capture ID: 68f95685-74c3-46df-a859-d6b72413f0ef. Bytes: 173124. SHA-256: 6c723fbf0188c625607e635be02b75feaade9c0bd806ac49e1d4f27ac6f9bd49. Its resource bytes and manifest size/hash matched. The manifest source revision was 99aabefc0aabb7f7e88fdb5a089a60c72af98916.

Benchmark bfb4640b-e8f5-45cd-9915-f143e4228e58 started warming, returned status, and reached cancelled state after cancellation. Its 471-byte registered JSON summary matched the manifest hash and run ID. This check proves lifecycle and resource retrieval. It is not timing acceptance.

Status, scene, capture, and benchmark resources were listed. Closing the official client closed the CLI process with no stderr. Real native boundary tests separately verify default read-only rejection, role and Origin scope, eviction, rate limits, timeout, stale frame, and export rollback.

Connection descriptors and bearer URLs are not included. Large images remain local.
