# Local AI for v0.6.0

Implementation snapshot checked on 2026-10-23. The minimum release combines local E2B chat, current-tab context, saved course conversations, source inspection, and JSON export. The course reader remains usable independently of the model. Source behavior, native observations, and remaining practical limits are recorded separately below; local dictation and 12B QAT are not validated demo features.

## Runtime and pinned model

| Setting | Current source |
| --- | --- |
| JavaScript package | `@litert-lm/core` 0.18.0 |
| Backend | Explicit `Backend.GPU_ARTISAN` |
| Execution | Classic dedicated worker hosted by an extension offscreen document |
| Model ID | `gemma-4-e2b-web` |
| Repository | `litert-community/gemma-4-E2B-it-litert-lm` |
| Revision | `a790a852d433991c0c0a41c1154cf9b3850300fa` |
| File | `gemma-4-E2B-it-web.litertlm` |
| Size | 2,008,432,640 bytes; approximately 2.01 GB / 1.87 GiB |
| SHA-256 | `3a08e8d94e23b814ae5414469c370c503813949acb8ceaa17e4ebf8a35af35b5` |
| Engine token setting | `maxNumTokens: 8192` |
| Ordinary prompt/output limits | 6,144 input tokens / 1,024 output tokens |

These values come from `src/ai/models.js`, `src/ai/worker.js`, and `src/chat/grounding.js`. The warm-up requests at most 128 output tokens. Token limits are application settings; they are not a claim that this build supports the model family's advertised maximum context.

Google's [current LiteRT-LM Web API guide](https://developers.google.com/edge/litert-lm/js), checked on 2026-10-23, lists `*-gpu.litertlm` artifacts for E2B, E4B, 12B, 26B A4B, and 31B. This checkout deliberately retains its separately pinned E2B `*-web.litertlm` artifact. The installed 0.18.0 API defaults to `GPU_ARTISAN`, and the application selects that backend explicitly. A filename change or URL substitution alone is not a runtime migration or a compatibility test.

The application does not configure a 12B model, download URL, checksum, model selector, memory guarantee, or successful 12B benchmark. A requested 12B QAT build needs its own identified artifact, matching runtime/backend, resource checks, and native load/generation measurements. The existence of a newer 12B GPU download does not establish those results. See the [model repositories linked by Google's guide](https://developers.google.com/edge/litert-lm/js#supported-models).

## Setup and failure handling

The Local AI view can query readiness without downloading weights. Its current preflight requires WebGPU, an accessible adapter, and `shader-f16`. It reports available browser storage and, when exposed, approximate device RAM. It does not discover free GPU memory. Passing preflight means a real load can be attempted; it does not mean the GPU has enough working memory.

The explicit setup action checks for a completed cache first. If absent, it requires reported storage headroom of at least 1.1 times the weight-file size when a storage estimate is available, requests persistent storage where supported, and downloads without credentials. Storage estimates and `unlimitedStorage` are not a guarantee of physical disk space or immunity from user deletion.

The downloader hashes every received byte while batching writes into roughly 4 MiB blocks. Only an exact size and SHA-256 match is committed with a completion marker. A cancelled, oversized, truncated, or corrupt response is not an accepted cache entry. The current implementation deletes a failed partial binary and does not support byte-range resume. Setup then loads the cached `File` into the engine and requests a short streamed warm-up.

Unload releases the engine; remove releases it and deletes the currently pinned binary and completion marker. Neither operation clears IndexedDB conversations or course data. The offscreen host unloads the resident worker after five minutes with no panels, including cancelled/failed readiness states. Lifecycle regression tests cover this; a full timed native idle test was deferred for the hackathon minimum release.

## Storage and updates

| Data | Location | Behavior |
| --- | --- | --- |
| Course snapshots, reader selection | IndexedDB, `courses` | Course-isolated; import generations reject stale writes |
| Conversations, drafts, message scope and turn state | IndexedDB, `chats` | Course-isolated; streamed checkpoints persist partial text |
| Last course per Chrome window | IndexedDB, `preferences` | Browser-window IDs are session-specific |
| E2B binary and completion metadata | OPFS directory `canvas-study-agent-models` | Model ID + revision + SHA-256 identify the entry |
| Tokenizer, configuration, chat template, JS and WASM | Installed extension files | Bundled build assets, separate from downloaded weights |

The model cache identity excludes extension version. Reloads and updates under the same extension ID/profile are intended to reuse a complete entry for the same pinned artifact. Native reload, update to v0.6.0 under the same extension ID, and full Chrome restart retained the completed model. A subsequent cached offline load generated text with zero model-weight requests. A different model revision/checksum uses another key; this implementation does not automatically delete older artifacts. Removing/reinstalling the extension, changing its identity/profile, clearing its browser data, or device storage loss can require another download. Keep the existing unpacked extension path when updating, and verify the extension ID.

On cache lookup, the source checks completion metadata and binary size; it does not rehash the entire file on every open. SHA-256 verification happens during the download before the completion marker is written. Course JSON export excludes chats, model weights, and model caches. There is currently no portable conversation backup/export flow.

## Grounding and conversation memory

The grounding module selects cached sources within the conversation's course/module/section/page scope, ranks excerpts by relevance, and counts the full formatted prompt with the pinned tokenizer/template. It includes a bounded recent history and related completed discussions from the same course, with compatibility checks for narrower scopes. It labels course citations separately from prior-chat memory and warns when source excerpts do not fit. Prompt budgeting does not delete or truncate the stored course/conversation records.

Accessible Canvas Page Markdown can be evidence. Locked bodies, unparsed attachments, assignments, quizzes, discussions, and external-tool bodies cannot be invented from their metadata. Prior-chat memory is earlier discussion, not authoritative course evidence. Generated statements should be checked against the linked course sources.

Turn persistence atomically creates a user message and assistant placeholder, freezes scope and reference metadata, and saves cumulative streamed text in increasing sequence order. Attempt tokens reject delayed writes after cancellation/retry. Partial failed or cancelled answers remain stored; retry creates another assistant attempt without duplicating the user question. Worker-restart recovery is explicitly available to the coordinator and must run only when no live turn owns the affected course.

## Privacy and network boundaries

The intended inference path is entirely local: bundled JS/WASM executes the pinned model in a worker. The inspected application source has no remote inference endpoint, prompt upload, analytics, or conversation synchronization. This describes the source boundary; the offscreen host was tested with DevTools networking set to Offline; cached model load and generation succeeded with zero model-weight requests.

Network activity remains necessary for authenticated Canvas reading, chosen file downloads, and the initial model acquisition from Hugging Face and its redirected download infrastructure. The model fetch uses `credentials: 'omit'`; it does not forward Canvas session credentials. Hosts still receive normal download connection metadata. A local prompt may contain private course excerpts and same-course chat memory, which remain in the browser profile under this design. Local storage is not encrypted by the application.

The English dictation helper requests `processLocally: true` and `en-US`, checks the static local availability API, and requires a local-capable recognition instance. Pack installation is a separate explicit action. Unsupported/denied states retain typing and do not fall back to an online recognition service. Stopping/disposal fences late transcripts, including startup races. Language-pack installation itself can require a browser-managed download. Native Chrome reported the English pack as downloadable, but its installation failed on the tested machine. No live transcript is claimed; typing remains available and there is no online fallback.

## Licenses and exact asset provenance

The bundled tokenizer vocabulary/configuration come from `google/gemma-4-E2B-it` revision `3e22461f65e89153144f8adb70e3b8c2cc9845a7`; the chat template comes from the same converted-model revision as the weight artifact above. `scripts/model-assets.mjs` checks each asset's SHA-256. They are model data assets, separate from the tokenizer/Jinja implementation libraries.

Both pinned source model cards declare Apache-2.0. Google's [Gemma 4 license page](https://ai.google.dev/gemma/apache_2) supplies Apache License 2.0; the [older Gemma Terms page](https://ai.google.dev/gemma/terms) directs Gemma 4 readers to that separate license. Exact revisions, hashes, authors, dependency versions, and accompanying license files are recorded in [the distribution NOTICE](../public/licenses/NOTICE.txt).

## Verification and practical limits

Tested on 2026-10-23: Apple M5 Pro, 24 GB unified system memory, macOS 27.0.1, Chrome 155, unpacked extension ID `hnhhnokchlifpimlgebjfefepcbjeajo`. Chrome reports a coarse 16 GiB device-memory estimate; this is not available GPU memory. Runtime and artifact pins above were unchanged.

| Acceptance check | Observed result |
| --- | --- |
| Download and validation | Completed; exact pinned size and SHA-256 accepted before cache commit |
| Native E2B inference | Real streamed readiness and course replies; GPU_ARTISAN confirmed in native runtime logs |
| Example response timing | Observed first text 0.4–2.6 seconds, full short replies 0.5–6.3 seconds; samples, not controlled benchmarks or guarantees |
| Both courses and memory | Math and English replies with source links; a new English chat recalled the authors from its preceding same-course chat with an M-reference |
| Same-ID update and restart | v0.6.0 installed under the original ID; Chrome fully exited and restarted; model and chats survived |
| Offline cache load | Offscreen DevTools networking set to Offline; unloaded GPU worker, loaded cached weights, generated readiness text; zero model-weight requests |
| Current-tab minimum smoke | Native Math sidebar followed the Basic Classes of Functions Page; its response cited that Page. Existing chat scopes remained intact |
| Settings | Native gear view contains model and microphone setup, hides course/scope/composer; local startup automatically loads cached weights only |
| Reader/export, races, failure handling | Automated regressions cover schema-3 exports, source loading, persistence, cancellation, retries, current scope, citations, and dictation errors |
| English microphone pack | Browser reported downloadable; installation failed. No native transcript or working microphone claim |
| Remaining broad native QA | Full timed idle, two-window stress, microphone transcript, and 360/440/600 final layout matrix deferred at the user's request to ship the minimum urgently |
| Gemma 4 12B QAT | Disabled; no download or separate runtime validation |

An earlier whole-course retrieval test omitted a later road-map paragraph and answered incorrectly. Source-level grouping, lexical normalization, neighboring excerpts and historical-citation handling were corrected and regression tested with the real tokenizer. Answers remain model output: verify important course requirements using the linked original. No app reads external homework iframe bodies or claims to have read file bodies.

The minimum release retains `100svh`, a fixed chat composer and constrained widths. Model and microphone configuration live in Settings. New chats default to **This tab**; navigation resolves a fresh bounded course source for each turn. Missing sources fail explicitly instead of widening to the entire course. Existing chats keep their scope. The saved model loads automatically when the sidebar opens; automatic startup uses `cachedOnly` and cannot initiate a weight download.
