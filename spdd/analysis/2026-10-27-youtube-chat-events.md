# YouTube chat events analysis

Issues: [#197](https://github.com/danirukun/opensekai/issues/197) (YouTube slice of BP-07) and [#87](https://github.com/danirukun/opensekai/issues/87) (BP-07). Queue bundle B25. Mode: contract-first. Contract: [YouTube chat events](../prompt/2026-10-27-youtube-chat-events.md).

## Problem

An operator wants a Blueprint to react to the chat of their YouTube livestream. Examples: a Super Chat starts a dance, a new member starts a thank-you animation, a chat command toggles a prop. The operator pastes the stream link and does not sign in to Google or make an API key. Today OpenSekai has no streaming platform integration. Blueprint events come only from the editor, keystrokes, devices, tracking, timers, and other graphs.

## Sources

- Issue #197, read 2026-10-27. It gives the behavior, the research for three options, the recommendation (the InnerTube live chat endpoint), the selection gate, the seven event nodes, and the acceptance criteria. It also has three open questions.
- [Warudo Dance Dance Dance tutorial](https://docs.warudo.app/docs/blueprints/tutorials/dance), read 2026-10-27. Warudo connects to Twitch, YouTube, or Bilibili with its onboarding assistant (with a sign-in), and a Blueprint uses event nodes such as **On YouTube Super Chat Received** and **On Twitch Channel Points Redeemed**.
- [Warudo Getting Started](https://docs.warudo.app/docs/tutorials/getting-started), read 2026-10-27. The onboarding assistant asks for a streaming platform and sets up the integration. The Warudo handbook has no page for the YouTube nodes (sitemap read 2026-10-27), so the node field names come from the issue.
- Prior art named in the issue: pytchat, chat-downloader, masterchat, and youtube-chat. They read chat from `POST /youtubei/v1/live_chat/get_live_chat` without a sign-in.
- [YouTube Terms of Service](https://www.youtube.com/t/terms): access "by any automated means" other than public search engines needs permission.
- Code read on `origin/main` at `488e5e6`: `ARCHITECTURE.md`, `packages/contracts/src/schema.ts` (`ClockEnvelopeSchema`, `InputUpdateSchema`, `clockByteLimit`, `AppStatusSchema`, `MethodSchema`, `requiredCapability`), `packages/contracts/src/devices.ts`, `packages/contracts/src/blueprint-nodes/devices.ts` and `events.ts`, `packages/contracts/src/blueprint-values.ts`, `packages/session/src/session.ts` (`advance`), `packages/session/src/blueprint-runtime.ts`, `packages/session/src/blueprint-eval/devices.ts`, `apps/desktop/src/EditorApp.svelte` (the editor rail), and `Cargo.toml`.

## Existing material

- **Input to the session.** The host sends keystrokes, held keys, and device input to the session in the credited `clock` envelope (`input.events`, `input.held`, `input.devices`). `advance` turns them into `BlueprintEvent` values and runs one Blueprint step. A clock with tracking or device input may use 64 KiB (`clockByteLimit`, mirrored in Rust); any other clock 2 KiB.
- **Trigger data.** A device trigger node gives its data from `RunEnv.trigger` (the MIDI note and velocity). The same pattern fits event data such as a chat message.
- **Value model.** Blueprint strings have at most 1,024 characters (`MAX_BLUEPRINT_STRING_LENGTH`). The data types are number, integer, boolean, string, vector3, and their lists.
- **Node catalog and audit.** Each node type has one definition in `blueprint-nodes/`. The node audit (`tools/evaluation`) fails for a new node type until `docs/evaluation/blueprint-node-audit.json` has a row for it.
- **Host-answered calls.** The host answers `appStatus` and `assetList` itself. Each other call goes to the publisher. The host has no user settings store yet. The editor keeps per-user UI state in `localStorage`.
- **HTTP.** `reqwest` 0.13.5 is a workspace dependency with the `json` feature. Only tests use it now. The host has no outbound HTTP code.
- **Editor rail.** The rail has Assets, Output, Blueprints, and Resources. There is no Settings panel.
- **Network.** The cloud container reaches `https://www.youtube.com/` (HTTP 200, 2026-10-27). Thus the implementation run can record fixtures and can try the live gate in the cloud.

## Findings

1. Only option (a), the InnerTube endpoint, meets "paste a link, never sign in, no key". Options (b) and (c) need a Google Cloud API key from each user, because the default quota (10,000 units each day) cannot serve a shared key.
2. Option (a) is not a public API. The JSON shape and the bootstrap page change a few times each year. A parser in one Rust module with recorded fixtures keeps each fix small.
3. The ToS risk is a product decision. The issue recommends (a) as the default with help text, and asks the owner to confirm. The contract follows the recommendation, and the owner confirms or rejects it when they merge or change this contract.
4. The host must own the network client. The WebView must not hold network state, and guest code must not get an HTTP client. The host already sends input to the session through the clock, so chat events can use the same path and the same Blueprint step as devices.
5. The link is a user setting, not show data (issue). The host has no settings store, so this slice adds a small one: one JSON file in the app local data folder.
6. A chat event has strings: a message (YouTube allows 200 characters), a name, a channel ID, and image URLs. 16 events with these strings fit in 64 KiB, not in 2 KiB.
7. The bootstrap page holds recent chat from before the connection. If those messages start Blueprints, an old message can start an effect when the app connects. After a reconnect, the same page can hold messages that came during the gap; those must start their nodes once.
8. Super Chat amounts come as display text (for example `$5.00` or `¥500`), not as micros with an ISO code. The value and the currency need a parser with a symbol table, as masterchat has.
9. The membership texts ("Member for 6 months", "Welcome to …!") depend on the interface language. A fixed request language (`hl: en`) makes them stable.
10. The poll interval rule in the issue has a conflict: "clamp to 1–10 s" and "never below the server `timeoutMs`". A clamp at 10 s goes below a server value above 10 s.
11. In some regions, a request to `www.youtube.com` without cookies redirects to `consent.youtube.com`. The clients in the prior art send a consent cookie.
12. One gift purchase can give 50 redemption announcements, one for each receiver. A node for each redemption can flood the Blueprint queue (64 events each step).

## Questions resolved without the owner (reversible)

The owner reviews these in the contract pull request before code exists.

- **Default option and ToS.** Option (a) is the default, as the issue recommends. The Settings section has one short line that says this reads the public chat page and is not an official API, and the docs say the same with the ToS link. **The owner confirms this when they merge.** Alternative: wait, or ship (b) with a user key as the default.
- **Fallback (b).** Not in this slice. It is a known gap with a follow-up. Alternative: an Advanced "Use my YouTube API key" field now.
- **Replay of a finished stream.** Not in scope, as the issue proposes.
- **Settings place.** A new **Settings** rail panel in the Editor window with one **YouTube** section: the Stream link field, the status line, and the help line. The value commits on Enter or blur; an empty field disconnects. Alternative: a Settings window, or an Integrations panel in Output.
- **Settings store.** The host keeps `<app local data>/settings/integrations.json` (`{youtube: {link}}`) with an atomic write. A new host-answered call `integrationsSet {youtube: {link: string | null}}` (Edit capability) sets it. `appStatus` returns `youtube: {link, state, error, videoId}`. MCP uses the same call through one new tool. Alternative: editor `localStorage` (rejected: the host owns the client), or the show (rejected by the issue).
- **Link parsing.** Rust only. The host accepts `https`, `http`, or no scheme, the hosts `youtube.com`, `www.youtube.com`, `m.youtube.com`, and `youtu.be`, and an 11-character video ID (`[A-Za-z0-9_-]`). Channel forms are `/@handle`, `/channel/UC…`, and `/c/name`. Any other text gets `INVALID_INPUT` with a reason, and the old link stays. Alternative: a TypeScript mirror in the editor.
- **Backlog.** On the first connection to a link, the host marks the chat items of the bootstrap page as seen and does not send them. After a reconnect, it sends the unseen items of the bootstrap page whose timestamp is not before the first connection. Alternative: send the backlog, or drop each bootstrap item.
- **De-duplication.** The host keeps the last 4,096 item IDs of the current link. A new link clears the set.
- **Poll interval.** The wait is the server `timeoutMs` clamped to 1 s to 60 s. Thus the poll never goes below the server value for a value from 1 s to 60 s (the gate rule wins over the 10 s clamp). Alternative: the 10 s clamp of the issue.
- **Backoff.** Full jitter: the delay is `min(60 s, 1 s × 2^attempt)` multiplied by a random factor from 0.5 to 1, and at least 1 s. A successful poll resets the attempt count.
- **Stream end.** When the chat ends (no next continuation, or the end action), the status is `ended` (`Chat ended`). A video link stays there. A channel link goes back to `waiting` after 60 s and checks `/live` every 60 s.
- **Video link before the stream.** A video without an open live chat is `waiting`, and the host checks again every 60 s.
- **Gift redemptions.** Parsed and counted, but they do not start a node in this slice (finding 12). **On YouTube Gift Memberships** starts once for each purchase. Alternative: a node for each redemption.
- **Amounts.** The host parses the display text into `amountMicros` (an integer) and an ISO 4217 `currency` with a symbol table that includes the masterchat symbols. An unknown symbol gives `currency` equal to the symbol text and `amountMicros` 0, and the display string stays.
- **Message text.** The host joins the text runs. A standard emoji gives its character. A custom emoji gives its first shortcut (`:name:`).
- **Tier Color.** `#RRGGBB` from the ARGB body color of the Super Chat.
- **Language.** The host sends `hl: en` and `gl: US` in the InnerTube context (finding 9).
- **Consent page.** The host sends the consent cookie that the prior art uses (`SOCS=CAI`). A response from `consent.youtube.com` is an error with the text `Consent page`.
- **Recent-event list.** Not in this slice. The editor shows the status line only (constitution principle 1). Alternative: the list that the issue names in "Which side runs it".
- **Gate.** The gate of the issue is the first operation of the implementation. Its live part runs in the cloud when the network allows it, else on the owner computer. If two of three streams fail, the run stops before the editor and node work and asks the owner.

## Risks

- YouTube can change the endpoint, the page, or the JSON at any time. The status shows `Error: <reason>` and the parser has fixtures, but a fix needs a release.
- The ToS risk (finding 3). This contract does not decide it for the owner.
- Bot detection can block a request (HTTP 429 or a captcha page). The host uses the backoff and never polls faster than the server asks.
- Recorded fixtures hold names and channel IDs of real people. The implementation replaces them with synthetic values before commit.
- The live 30-minute gate in the cloud uses public streams that the owner does not own. The rate is the same as one open chat popout.
- The cloud cannot prove the macOS app path, the latency to a Blueprint on macOS, or the Settings panel in the Tauri WebView. These need an owner check (`accept:local`).
