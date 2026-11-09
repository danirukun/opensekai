# OpenSekai Chat — design

Status: approved 2026-11-07. Owner: Daniils Petrovs. Source with diagrams: [OpenSekai Chat — design](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).

## Intent

Chat lets an operator describe a scene, a shot, or a Blueprint in words. OpenSekai then makes a proposal that the operator reviews and accepts. A small model runs on the operator's computer. It does not use a cloud service.

Today an operator sets up lights, characters, cameras, and camera moves by hand in the Inspector and the Blueprint editor. Chat replaces many of these steps with one sentence, for example: "Arc around Bonnie and slowly push in on her face."

Chat uses the same validated command API as the editor and the MCP server. It adds no new edit path. Each accepted proposal is an ordinary `scenePatch` or `blueprintEdit` batch.

## Goals and limits

The local model must match the frontier teacher model on our scenarios, on the hardware tier of the operator.

**Goals**

- Set up a scene from words: lights, characters, environment, props, sky, and cameras.
- Make camera moves from words, for example an orbit with a push-in.
- Make and change Blueprints from words.
- Show each proposal before it applies. Apply nothing until the operator selects Accept.
- Undo an accepted proposal in one step.

**Limits**

- **Never stuck.** Chat always makes a proposal or asks a question. It never replies "I cannot do that." When no direct tool exists, chat builds an approximation from the tools that exist and says so in the summary.
- **Question budget.** A simple request gets 1 or 2 questions at most. A complex scene or workflow gets 5 to 10 questions at most. After the budget, chat uses defaults and marks them in the proposal.
- **Latency.** Target: a first response token in 10 s or less on a 4 GB GPU, and in 5 s or less on Apple Silicon and larger GPUs. The proposal streams after that token. The baseline eval measures each tier against this limit.
- **Hardware.** 8 GB RAM or more. Usually a dedicated GPU with 4 GB VRAM or more. Apple Silicon is the first platform. Windows is next. Linux follows.
- **Renderer first.** Inference must not starve the renderer. The OBS output must keep its frame limit while chat generates a proposal.
- **Local only.** The shipped model does not use the network at run time. It picks assets only from the operator's asset library.

**Non-goals for this work**

- Designer mode: select an object in the scene and change it by reference. The input already carries the selection as a reference, so this can grow later.
- More than one model, for example a second model for spatial reasoning. The inference adapter keeps a model ID on each request, so a router can come later.
- Direct Poly Pizza and Sketchfab import. These have their own tickets.
- Full scene undo. That is OSE-09.

**Anti-goals** (a failure even when the feature works)

- A refusal for a request that the existing tools can approximate.
- A frame drop in the OBS output during generation.
- A change that reaches OBS before the operator accepts it.

## User flow

- **Flow:** [OpenSekai Flows → Chat](https://www.figma.com/board/9cW3tyqSn8CDBIsSlMiPcb/OpenSekai-Flows?node-id=10-364)
- **Screens:** [OpenSekai → Chat page](https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai?node-id=17-2) (scene proposal, Blueprint proposal, applied with Undo, first-run download)

1. The creator opens Chat from the show toolbar. The Chat panel takes the place of the Inspector. A fresh chat shows 2–3 example prompts, one for each capability: a scene, a camera move, and a Blueprint (for example "Concert stage with purple light and haze", "Orbit Bonnie and slowly push in on her face", "When a Super Chat comes in, play a heart expression"). Selecting one puts it in the composer, where the creator can change it before sending.
2. On first use, the model downloads. The panel shows the size and the progress, and Cancel stops it. The composer is disabled until the model is ready.
3. The creator describes a change. To point at a thing, the creator clicks it in the scene, and a reference token goes into the composer.
4. If the request is not clear, the model asks a question with choices. The budget is 1–2 questions for a simple request and 5–10 for a complex scene or workflow.
5. The model gives a proposal: one sentence and a list of changes. The viewport shows the draft as overlays (light cones, the camera path, and the end framing), and the Blueprint editor shows ghost nodes. The draft is never in the output.
6. The creator can Play the draft, type a follow-up to change it, Discard it, or Accept it.
7. Accept applies all changes as one batch. If the scene changed after the proposal, Chat makes the proposal again from the new scene.
8. The thread shows the number of applied changes with Undo. Undo restores only what the proposal changed.

## System architecture

*Diagram (system architecture · 9 parts, one write path): see the [design doc](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).*

The model writes only tool calls. Code turns them into scene and Blueprint edits, and nothing reaches the session or OBS before Accept. If the assist process stops, the editor and the output continue.

## Request lifecycle

*Diagram (request lifecycle · prompt to Undo): see the [design doc](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).*

The proposal stays a draft in the viewport until Accept. Accept sends all changes as one batch with `expectedRevision`. If an entity or a Blueprint that the proposal touches changed after the proposal, the session rejects the batch. Chat then makes the proposal again from the new scene and shows it again. It never applies a proposal that the creator did not see. Discard drops the draft and sends nothing. Undo sends the inverse ops as an ordinary scene patch.

**Apply rules** (Claude's calls after the builder check)

- **One atomic apply.** Today `scenePatch` (at most 32 ops, with `expectedRevision`), `blueprintEdit` (no revision check), and `cameraSelect` are three calls. Chat needs all three in one change, for example a new camera, a Blueprint that uses it, and the output switch. Slice 1 adds one session command (`proposalApply`) that carries scene ops, Blueprint ops, and the output camera, and applies all or nothing. The compiler assigns the IDs of new entities and Blueprints before apply, so the command needs no placeholder references (changed 2026-11-08, slice 1 analysis). The integrator owns this contract (TypeScript and the Rust mirror) as a sequential step. ARCHITECTURE.md changes in the same commit.
- **Scoped conflict check.** The scene revision goes up all the time (viewport navigation, gizmo drags, tween ends). So Accept fails only when an entity or a Blueprint that the proposal touches changed after the proposal. Other changes do not block Accept.
- **No unreviewed apply.** When Accept fails, Chat makes the proposal again and shows it. It never applies a proposal that the creator did not see.
- **Undo after later edits.** If the creator or a Blueprint changed a touched entity after Accept, Undo restores the other entities and lists the ones it skipped.
- **Eval answers.** Each scenario file holds a scripted answer for each expected question. The Fable teacher runs in the same harness, with the same `ask` tool, so its runs give reference questions too.
- **Windows app.** Slice 6 includes a smoke check in a Windows VM in VMPal (owner, 2026-11-07): the app starts, the assist process starts, llama.cpp loads the smallest tier on the CPU or Vulkan path, and one scenario gives a valid proposal that applies. The VM has no real GPU, so it does not verify the tier picker, the latency limits, or the OBS frame limit. A full test on a real Windows machine is a separate step, outside this plan.

**Scope decisions for v1** (owner, 2026-11-07)

- **Viewport before Accept.** The viewport shows overlays only: light cones, the camera path, and the end framing. It does not render proposed entities. Ghost entities in the viewport are a later candidate, because they need a new preview-only renderer layer.
- **Blueprint edit scope.** Chat builds new Blueprints and edits only the Blueprints that Chat made. Edits to any Blueprint come in a later slice.
- **Camera move playback.** An accepted camera move plays one time on Accept. It stays in the Blueprint, so the creator can trigger it again or bind it to a hotkey. It loops only when the creator asks for a loop.
- **Languages.** Chat supports English and Japanese from the start. The eval set and the training data include Japanese prompts for each scenario, and the smallest model tier must pass in both languages.
- **Latency.** The first response token arrives in 10 s or less on a 4 GB GPU, and in 5 s or less on Apple Silicon and larger GPUs.

## Thin tools and scene context

The model fills small intent tools. Fixed code compiles each intent into existing `scenePatch` operations and `blueprintEdit` operations. The model never writes raw transforms, node wiring, or entity IDs that it did not get from the scene context.

The current MCP surface is large for a small model. `scene_patch` has 30 operation kinds and a long description. `blueprint_edit` has about 20 graph operations over 77 node types. A 2B to 9B model does better with a few tools that each have a short, strict schema.

**First tool set** (candidates; slice 1 sets the final list)

| Tool | Intent fields | Compiles to |
| --- | --- | --- |
| `light_setup` | role (key, fill, rim, ambient), target, direction words, color temperature, intensity level, shadow | `createEntity` light + `setLight` + `setTransform` |
| `camera_add` | name, target, framing (wide, medium, close-up), height, side | `createEntity` camera + `setCameraLens` + `setTransform` |
| `camera_move` | camera, target, kind (orbit, dolly, push-in, crane), angle, duration, easing, end field of view | a Blueprint (see Camera moves) |
| `environment_set` | asset reference, reflections level | `setEnvironmentModel` + `setEnvironmentReflections` |
| `sky_set` | kind (color, image, HDR), asset reference, color | the ENV-02 sky operations (blocked on #148) |
| `prop_place` | asset reference, near entity, relation words, count | `createEntity` mesh + `setTransform` |
| `haze_set` | density level, color | `createEntity` haze + `setHaze` |
| `output_camera` | camera | `cameraSelect` |
| `blueprint_build` | trigger, actions, targets | `blueprintEdit` batch from node templates |
| `ask` | question, choices from scene names | a question in the chat panel |

Words such as "left", "warm", "close-up", and "slowly" map to numbers in code. The model picks a word from an enum. The compiler owns the coordinates, the color values, and the timing curves. This is the main lever for accuracy.

**Scene context: references, not dumps.** The context stays light. A request never carries the full `SceneView` or a Blueprint graph. It carries short references that the compiler resolves to real IDs:

- **Entities:** reference, name, and kind for each entity (for example `@e3 Key light · light`), plus the selection and the output camera. No transforms and no light values.
- **Blueprints:** reference and name only. The graph stays out.
- **Assets:** reference, name, and tags for the few assets that best match the prompt. Code picks them from the descriptions and tags; the full library stays out.
- **Detail on demand:** a thin read tool, `look_up`, returns a short description of one reference (for example a light's color and position, or the nodes of one Blueprint). The model calls it only when the change needs it.

The model writes references, never raw IDs. The compiler rejects a reference that is not in the scene. The context has a token budget per hardware tier.

**Threads and compaction.** The panel shows one continuous chat, but under the hood each task is its own thread. When a prompt starts a new task, Chat starts a new thread. It keeps a short summary of what was applied before and drops the rest, so old turns do not degrade new answers. A prompt is a new task when it shares no references with the current thread and the model marks it as new in its structured output. Undo for earlier proposals still works, because the inverse ops live in the app, not in the model context. The eval set gets long sessions (for example ten mixed prompts in a row) to measure this.

**Same tools in MCP.** The thin tools are also MCP tools. The teacher model and agents use them through MCP. The local model uses them in the app. Both paths call the same compiler and the same validated command API.

## Camera moves on Blueprints

*Diagram (camera moves · one intent to a Blueprint chain): see the [design doc](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).*

A camera move is a Blueprint, not a new camera feature. The model fills one `camera_move` intent: camera, target, kind (orbit, dolly, push-in, crane), angle, duration, easing, and end FOV. The compiler turns it into a chain of Set Asset Property nodes with `transitionSeconds` and easing, linked by On Transition End. The creator can then open the Blueprint and change it like any other.

- **Waypoints.** An orbit is a curve, and one tween moves in a straight line. So the compiler splits the arc into steps (for example every 15°). If the chain looks stepped in an OBS recording, a single orbit node replaces it (see Candidates).
- **Viewport draft.** The viewport draws the path and the end framing from the intent, not from the Blueprint. The draft is never in the output.
- **Play.** Play runs the move in the viewport before Accept. This needs the session to run a draft graph without a commit, so it is a candidate with a gate.
- **Related work.** The Camera Sway template (BP-09) uses the same nodes. A "Camera Orbit Character" template is still open in BP-09; this work can supply it.

## Local inference

One inference adapter has two implementations: MLX on Apple Silicon, and llama.cpp on Windows and Linux. Both use llguidance for constrained decoding, so a tool call is always valid JSON for its schema.

**Process.** The host starts an assist process (`opensekai-assist`) as a child process. The model runs there, not in the host. If the assist process stops or runs out of memory, the session, the editor, and the OBS output continue. The host talks to it over a local socket with the same envelope rules as other host connections.

**Runtimes**

| Platform | Runtime | GPU path | Reason |
| --- | --- | --- | --- |
| macOS, Apple Silicon | MLX | Metal; Neural Accelerators on M5 | 1.4× to 1.8× llama.cpp decode in recent benchmarks ([yage.ai](https://yage.ai/share/mlx-apple-silicon-en-20260331.html), [apple-silicon-llm-bench](https://github.com/john-rocky/apple-silicon-llm-bench)) |
| Windows, Linux, NVIDIA | llama.cpp | CUDA | Mature, one GGUF file for all vendors |
| Windows, Linux, AMD or Intel | llama.cpp | Vulkan | Most portable GPU path ([Lemonade docs](https://lemonade-server.ai/docs/guide/configuration/llamacpp/), [#19988](https://github.com/ggerganov/llama.cpp/pull/19988)) |
| No usable GPU | llama.cpp | CPU | Last fallback, smallest tier only |

**Structured output.** llguidance turns each tool's JSON schema into a token mask. llama.cpp supports it. The Rust MLX port `mlxrs` uses the same crate ([docs.rs](https://docs.rs/crate/mlxrs/latest/source/src/lm/structured.rs)). XGrammar is the fallback candidate ([paper](https://arxiv.org/pdf/2411.15100)).

**Model.** One family for all tiers: Qwen3.5 (0.8B, 2B, 4B, 9B; March 2026; tool calling) ([Ollama coverage](https://summarizemeeting.com/en/news/ollama-qwen-3-5-local-tool-calling-multimodal), [Baseten](https://docs.baseten.co/examples/models/llm/qwen3.5.md)). One family gives one prompt format and one fine-tune dataset. Gemma 4 E4B is the challenger ([release coverage](https://doolpa.com/news/google-gemma-4-release-april-2026)). The sources are mostly secondary, so the eval decides.

**Tiers** (4-bit weights; sizes are approximate until measured)

| Hardware | Model budget | Model |
| --- | --- | --- |
| Apple Silicon, 16 GB or more | about 6 GB | Qwen3.5 9B |
| Apple Silicon, 8 GB | about 3 GB | Qwen3.5 4B |
| GPU, budget 6 GB or more | about 6 GB | Qwen3.5 9B |
| GPU, budget 3 to 6 GB | about 3 GB | Qwen3.5 4B |
| GPU budget under 3 GB, integrated GPU, or CPU | about 1.5 GB | Qwen3.5 2B |

**GPU budget.** Budget = total VRAM − measured renderer use − a margin. On Apple Silicon, the budget comes from unified memory with the same rule. The tier picker reads the budget at start and when the output format changes.

**Renderer protection**

- The model generates only while it makes a proposal. It unloads after an idle time.
- The context is short: the scene summary, the tools, and the conversation so far.
- Generation yields to the renderer. The acceptance check measures the OBS frame rate during generation in OBS, not in the app. The app timing and the OBS timing stay separate.

## Preferences and diagnostics

The existing Settings panel gets a **Chat** section and a **Chat diagnostics** section. The host keeps the Chat settings in `<app local data>/settings/chat.json`, with the same write rule as `integrations.json` (a temporary file and a rename). Chat settings are never in a show. Model files are in `<app local data>/models/`.

Screen: [OpenSekai → Chat / 5 · Settings, Chat and diagnostics](https://www.figma.com/design/WSkWz6AUxzNxbweU4Tjmkz/OpenSekai?node-id=37-2)

**Chat** (operator controls)

| Control | Values | Default |
| --- | --- | --- |
| Chat | On, Off. Off stops the assist process and frees its memory. | On |
| Model | Auto, or one tier that fits the GPU budget. A tier that does not fit is disabled. | Auto (the tier picker) |
| GPU memory limit | Auto, or a limit in GB. The limit can only make the budget smaller. | Auto (the GPU budget rule) |
| Unload when idle | Off, or a time. | A time from the slice 3 measurement |
| Run on | GPU, CPU | GPU |

A change takes effect on the next request. A model change downloads the new tier only after the operator confirms the size.

**Chat diagnostics** (read-only, plus actions)

- **Runtime.** MLX or llama.cpp, the backend (Metal, CUDA, Vulkan, or CPU), and the runtime version.
- **Model.** Model name, tier, quantization, adapter version, size on disk, and state (not downloaded, downloading, loaded, unloaded).
- **GPU.** GPU name, total VRAM or unified memory, the renderer use, the Chat use, and the budget.
- **Last request.** Time to first token, tokens per second, context size in tokens, and the number of thread compactions.
- **Actions.** Check for update, Unload now, Copy diagnostics (plain text for a bug report), and Delete model files. Delete asks one time with the size, because the download is large. The next request downloads the model again.

A value that the host cannot measure shows as unknown, never as zero. The same readings are an MCP read (`chat_status`), so evaluation runs record the backend, tier, and memory with each result.

Slice 3 adds the readings, the MCP read, and Delete model files, because the latency and OBS evidence needs them. Slice 4 adds the Settings UI. Slice 6 adds the Windows GPU readings and the VM smoke check of this section.

## Model delivery

Goal (owner, 2026-11-07): keep the app bundle as small as possible, and improve Chat without a new app release. So the installer has no model weights and no adapter. The app gets them from Cloudflare R2.

- **What ships in the app.** The assist process and the small backends only: MLX and Metal on macOS, CPU and Vulkan in llama.cpp on Windows and Linux. The CUDA backend is large (the CUDA libraries are hundreds of MB). It is a candidate: a separate signed download on NVIDIA GPUs only, with a gate (it is faster than Vulkan on the eval set by a clear margin).
- **What R2 holds.** The base model file for each tier and each trained adapter, in the public assets bucket under `opensekai/chat/`. Each file has a content-addressed, immutable key (`sha256/<hash>`). Unreleased adapters and training data stay in a private bucket.
- **Manifest.** One small JSON file at a fixed URL is the only file that changes. For each tier it lists the base model and the current adapter: key, SHA-256, size, adapter version, the tool contract version that the adapter was trained for, the lowest app version, and the MLflow run that passed the gate. The manifest is signed. The app has the public key and rejects a manifest with a bad signature.
- **Update.** The app reads the manifest when Chat starts and from Check for update in Chat diagnostics. It never reads it during a request. It downloads a new adapter in the background, checks the SHA-256, and uses it at the next model load. It keeps the previous adapter, so a manifest change can roll back without a download.
- **Compatibility.** The thin tools are app code, so an adapter applies only when its tool contract version matches the app. Otherwise the app keeps the last adapter that matches, or uses the base model with no adapter.
- **Release gate.** An adapter goes into the manifest only after its MLflow eval passes the gate in Training and eval. Publishing uses the object storage adapter (`put`, `get`, `delete`, `presign`), so another S3 API provider can replace R2.
- **Offline.** With no network, Chat uses the files on disk. Download requests carry no scene data and no prompt text.

Slice 3 adds the manifest, the download with checks, and the base model in R2. Slice 5 publishes adapters through the manifest.

## Training and eval

*Diagram (training and eval · teacher to shipped adapter): see the [design doc](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).*

Fable 5.1 (`claude-fable-5-1`) is the teacher. It runs each scenario prompt on the real app through the same MCP thin tools that the local model uses, so each expected output is a real scene state, not a guess. NeMo DataDesigner then makes variations: other wording, other languages, vague prompts, and prompts that need a question. MLflow records every run, the dataset version, and the adapter version.

First, the base model runs on the eval set with prompts only (slice 3). A LoRA adapter is trained only if the base model misses the bar (slice 5).

**Metrics** (per tier)

| Metric | How it is measured | Bar |
| --- | --- | --- |
| Same result | Diff of the final scene and Blueprints against the teacher run, not the tool-call text | Agreed margin to Fable |
| Never stuck | Share of prompts that end without a proposal or a question | 0 |
| Ask budget | Questions per prompt | 1–2 simple, 5–10 complex |
| Valid structure | Tool calls that pass schema validation | 100% |
| Latency | Time to first token (10 s or less on 4 GB, 5 s or less on larger tiers) and time to full proposal | Set per tier in slice 3 |
| Renderer impact | OBS frame rate during generation, measured in OBS | Frame limit holds |

An unavailable measurement is recorded as unknown, never as zero.

## Scenarios and asset fixtures

A scenario is a set of prompts for one kind of scene, a start scene, and a fixture library. Each scenario has simple prompts (one or two changes) and complex prompts (a full scene or a full workflow).

| Scenario | Example prompt | Needs sky (ENV-02) |
| --- | --- | --- |
| Basic concert | "Concert stage, purple key light, haze, a camera that orbits Bonnie and pushes in on her face" | No |
| Studio | "Clean studio, soft three-point light, two cameras for the interview" | No |
| Forest | "Evening forest, warm light through the trees" | Yes |
| Lakeside | "Sunset at a lake, slow crane up from the water" | Yes |
| Beach | "Midday beach, bright sun, wide camera" | Yes |
| Surface of the Moon | "Moon surface, Earth in the sky, hard white light" | Yes |

More scenarios come later. Concert and studio do not need the sky, so they come first.

**Fixture assets.** The shipped model does not search the web. It picks from the user's library. To build the fixture libraries now, agents:

1. Search the web for CC0 or CC-BY `.glb` files (and other supported formats), or
2. Make the asset in Blender through Blender MCP and export a `.glb`.
3. Import the file through the normal import path, so the same trust checks apply.
4. Write credits into `asset.extras`.
5. Store the files in the private R2 bucket `opensekai-fixtures`.

When a scenario needs a Sketchfab asset that is not CC0 or CC-BY, that scenario waits for the Sketchfab import ticket. Direct Poly Pizza and Sketchfab integrations are separate tickets.

**Asset descriptions.** Today an asset record has a name, a kind, and credits. The model needs more to pick the right prop. Each fixture gets a short description and tags (for example "palm tree, beach, tropical"), written by hand or by Fable. Where these fields live is a slice 1 decision (see Candidates).

## Slices and dependencies

*Diagram (slices · 6 slices, 1 outside dependency): see the [design doc](https://claude.ai/artifact/MXEWPWaLmKVxQ2PrL1mQCr).*

Each slice gets its own slice contract in `spdd/` before code. Each slice ends with its parity changes and its evidence.

| Slice | Done when |
| --- | --- |
| 1 · Thin tools | Each intent tool compiles to `scenePatch` or `blueprintEdit` with unit tests; the tools and the scene summary are in MCP |
| 2 · Scenarios and eval | Fable builds the concert and studio scenes through MCP on the real app; MLflow holds the baseline. This is the first visible demo |
| 3 · Local inference | The base model on MLX gives valid proposals on macOS; the OBS frame limit holds during generation, measured in OBS |
| 4 · Chat UI | Prompt, question, proposal, draft, Accept, Discard, and Undo work in the running app |
| 5 · Fine-tuning | An adapter passes the gate per tier, or the record shows that the base model is enough |
| 6 · Windows and Linux | Smoke check passes in a Windows VM in VMPal: the smallest tier loads and one scenario applies. The tier picker, latency, and OBS checks wait for the separate real-machine test |

The sky is not part of this work. Concert, studio, and the camera demo do not need it.

## Candidates, calls, and what is left

**Candidates with a selection gate**

| Candidate | Gate |
| --- | --- |
| Qwen3.5 4B or Gemma 4 E4B for the middle tier | Higher "same outcome" score on the eval set at equal or lower latency |
| One orbit node, or a chain of Set Asset Property waypoints | The chain looks stepped in an OBS recording at 15° steps |
| Play in preview without reaching OBS | The session can run a draft graph without a commit, with an integration test that shows no OBS change |
| LoRA adapter, or the base model with prompts only | The base model misses the teacher by more than the agreed margin |
| XGrammar in place of llguidance | llguidance fails a schema or adds more than 10% to latency |
| Where asset descriptions and tags live | JSONB on the asset record, or a sidecar index; decide in slice 1 |

**Claude's calls** (not yet confirmed by the owner)

- MLX on Apple Silicon and llama.cpp elsewhere, behind one adapter.
- The Qwen3.5 family and the tier table.
- The model runs in a separate child process.
- Thin intent tools that compile in code; words map to numbers in code, not in the model.
- A compact scene summary, not the full scene view.
- Scoped Undo by inverse ops, not a full scene undo.
- Changes apply as one batch at Accept, never one by one.
- The model downloads on first use, not with the installer.
- An example prompt fills the composer; it does not send at once.
- The model writes `@` references and gets detail through `look_up`, not through a scene dump.
- A new task = no shared references with the thread + the model marks it new. A new task starts a new thread with a short summary of the old one.

**Left to the builder**

- The exact numbers behind each word (for example how warm "warm" is, and how slow "slowly" is).
- The waypoint step size for camera moves.
- The idle time before the model unloads.
- The VRAM margin.
- The scene summary format and its token budget.
- Prompt templates and the system prompt.
