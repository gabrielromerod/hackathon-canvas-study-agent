# Canvas Study Agent

A native Chrome sidebar that reads your MSJC Canvas course and runs **Gemma 4 E2B on your device**. Ask about the course beside the lesson, inspect the supplied sources, and keep conversations and course material in your browser profile. **v0.6.0** uses an open-weight model with locally bundled inference code; there is no remote chat API or model API key.

Native E2B answers have been observed in two courses, including source citations and memory from an earlier conversation in the same course. The pinned download passed size/checksum verification. Cache reuse survived the v0.6.0 update and a complete Chrome exit/restart under the same extension identity. A cached cold load and warm-up also ran with the model host offline and **zero HTTP weight requests**. These are development-machine observations, not a compatibility guarantee for every device.

**Minimum release scope:** local E2B chat, “This tab” context, persistent same-course conversations, source inspection, and JSON export. The previously missed Week One requirement now passes a native regression: the same question returned the correct minimum of three peer posts, with `[S8]` linking the original paragraph, which was checked independently. Native Math tutoring also explained rational functions, domain restrictions, a worked example, and a practice question with lecture/OpenStax links. Answers can still be wrong; verify important requirements against their sources. Local English dictation is unavailable on the tested Chrome setup, and 12B QAT stays disabled. See [architecture](docs/architecture.md), [submission notes](docs/submission.md), and [local AI technical details](docs/local-ai.md).

## Install or update

Build the unpacked extension from source with a current Node.js LTS release (Node.js 24 was used during development):

```sh
git clone https://github.com/gabrielromerod/hackathon-canvas-study-agent.git
cd hackathon-canvas-study-agent
npm ci
npm run build
```

1. Open `chrome://extensions`, enable Developer mode, then **Load unpacked** → the project's `extension` folder. If already installed, choose **Reload** on Canvas Study Agent.
2. Chrome 141 or later is required. Site access covers `https://msjc.instructure.com/*` for course reading and Hugging Face download hosts for the optional model. The extension also uses `sidePanel`, `scripting`, `offscreen`, and `unlimitedStorage` permissions.
3. Open any page inside an MSJC Canvas course and click **Open Study Agent** in the extension toolbar. The native sidebar opens beside Canvas.

The existing unpacked installation path stays the same. `extension/` is generated: edit the source files, run the build, and reload the extension to update it.

## Read your course

The sidebar follows the active Canvas course in its Chrome window. On the first connection it discovers modules through your existing Canvas login, reads module-linked Canvas Pages as Markdown, and checks access to linked files. It does not navigate away from the current lesson.

Choose **Sources** to browse modules, expand Markdown previews, and download original files. **View files** filters the same course sources to attachments, including PDF and DOCX files.

- **Refresh** rediscovers the course and rereads its content.
- **Read content** resumes pending reads and retries failures without repeating successful reads.
- **Export JSON** waits for the reader and downloads the existing schema-3 course export.

Previously read content is saved on this device, with a last-read timestamp. A cached course is not refreshed automatically on every navigation; choose Refresh to retrieve changes. Closing the panel stops scheduling further reads. Completed checkpoints remain saved and unfinished work resumes when you reconnect. Outside Canvas, the last course's saved content remains available with a disconnected indicator.

“Entire course” means materials linked in the course's modules, across all weeks. Assignments, quizzes, discussions, and external tools keep their links; their bodies are not extracted. Unlinked Pages and Files are not discovered. Locked or inaccessible content stays explicit rather than being bypassed.

## Local conversations

Type a message and press Enter or the arrow button. When E2B is ready, the assistant streams a local reply; before setup, messages are saved as local notes. Shift+Enter inserts a new line. Messages, drafts, and conversations stay in this browser profile on this device. Stop cancels generation, and failed or stopped answers can be retried without duplicating the question. Earlier partial attempts remain available.

Use **New chat** to start another conversation and **History** to reopen saved conversations for the current course. New chats default to **This tab**, following the fresh active Canvas URL to its loaded Page or current module-item metadata. The scope dropdown also lets you choose the whole course, a module, a section, or a module-linked Page. Manual choices persist for that conversation; existing chats keep their saved scope. Switching courses restores that course's own conversations, while browsing Sources does not override a manual scope. Each saved message records the scope used when it was sent. Empty conversations are hidden from History.

## Experimental local AI

Open the **Settings gear** for model setup, cache controls, and the local speech-pack control. Settings hides the chat composer and avoids repeating the course status inside that view. **Download & test E2B** explicitly downloads the pinned model, verifies its size and SHA-256, attempts to load it into WebGPU, and requests a short local warm-up answer. The download is **2,008,432,640 bytes**, about 2.01 GB; allow additional space and memory for the runtime. A compatible GPU with `shader-f16` is required by the current preflight. Browser storage and approximate device RAM are separate from GPU memory and cannot prove that loading will succeed.

The model weights live in the extension's origin-private filesystem (OPFS), separately from IndexedDB course data and chats. Opening the sidebar automatically loads a completed cache when the local runtime is idle using a **cached-only** request; it does not start a model download. **Load & test cached E2B** can also retry loading. **Unload** releases the model engine without deleting its weight file; **Remove** deletes the pinned model's cache. A failed or cancelled transfer is not accepted as a complete model and the current downloader starts again rather than resuming partial bytes. The cache key uses model ID, revision, and checksum rather than extension version. Keep the same extension identity/profile to retain the cache across updates. Uninstalling, clearing extension data, changing profiles, or changing the artifact can require another download. Model and speech-pack downloads remain separate explicit actions.

Replies explain concepts with worked examples, render mathematical notation locally with KaTeX, and expose validated course/textbook links. The source includes scope-aware course evidence, recent messages, and related prior conversations from the same course, with separate source and memory references. File bodies remain unavailable: PDF/DOCX links and metadata are not parsed into evidence. Prompt assembly uses the bundled Gemma tokenizer and template, with a 6,144-token input budget and a 1,024-token output limit for ordinary generation. Material omitted to fit the prompt is reported; the stored course and conversation content is retained. Local answers can be wrong, and earlier chat content is not proof of course requirements.

Only E2B is configured. The official Web API documentation now lists newer `*-gpu.litertlm` artifacts, including 12B, but that does not validate a 12B QAT artifact against this project's pinned runtime. The build currently uses `@litert-lm/core` **0.18.0**, `GPU_ARTISAN`, and the pinned E2B `*-web.litertlm` file. Details and current official references are in [local AI documentation](docs/local-ai.md).

The microphone control requests on-device English dictation and an explicitly installed `en-US` pack. Final transcripts append to the editable draft, and there is no online speech-recognition fallback. **The local speech-pack path failed on the current Chrome test setup**, so dictation is not presented as a validated working demo feature. Typing remains available.

## Export and file access

The course export remains schema version 3:

```text
course
  modules[]
    sections[]
    lessons[]
      content
```

Page content contains `status`, `format: "markdown"`, `markdown`, and source metadata. Files contain `status: "available"`, `format: "file"`, and file metadata with a stable authenticated Canvas `downloadUrl`. Section headings, original order, source URLs, due dates, points, and locks are retained. API-derived due dates use Canvas's ISO timestamps; the interface formats them for reading. DOM fallback dates retain Canvas's display text.

An available file record means Canvas returned accessible metadata. The binary is downloaded through the link when you choose it; it is not embedded in JSON or converted. Links require your Canvas login and current permissions. Expiring signed storage URLs are not exported. OCR and PDF parsing remain outside this stage.

Conversations and drafts are separate from course JSON and are never added to its export. IndexedDB stores course data and chats locally. Clearing the extension's browser data or uninstalling it removes those local records; export course data when you need a portable copy.

Course API requests use your existing Canvas session. The model download contacts Hugging Face and its download infrastructure with Canvas credentials omitted. Inference is designed to run in a bundled local worker; the current source has no remote chat API, prompt upload, analytics, or cloud conversation sync. Course reading and original file downloads still require network access and Canvas permissions. The extension does not add application-level encryption to its local records. See [privacy and network boundaries](docs/local-ai.md#privacy-and-network-boundaries).

## Develop

```sh
npm ci
npm run build
npm test
npm run check
npm run package
```

- `src/canvas`: authenticated discovery, self-contained injected readers, and browser adapter.
- `src/course`: reading/progress/cancellation and schema-3 export.
- `src/background`: per-window course tracking, import ownership, and centralized persistence commands.
- `src/storage`: IndexedDB repository using `idb`.
- `src/ai`: offscreen model host, dedicated inference worker, verified OPFS model cache, and turn coordination.
- `src/panel` and `src/chat`: sidebar presentation and local conversation views.
- `src/markdown.js`: HTML-to-Markdown conversion using Turndown.
- `public`: manifest, HTML, styles, and license notices.
- `extension`: generated installation output; never edit directly.
- `tests`: domain, persistence, worker, and UI regression tests. The original popup scenarios now run against the actual sidebar through a shared native-panel harness.

`npm run package` builds, checks, and creates `canvas-study-agent-extension.zip`. Executable JavaScript, WebAssembly, icons, and tokenizer/template assets are bundled locally; the optional 2 GB weight file is downloaded separately after setup. The build verifies pinned tokenizer assets and fetches them if absent or changed, so an initial build can require network access. It does not fetch the weight file. The tokenizer assets add roughly 32 MB to an unpacked build. Generated `.LEGAL.txt` files and [third-party notices](public/licenses/NOTICE.txt) accompany bundled dependencies and Gemma data assets.

For a browser UI preview, run `npm run preview`. The local-only server provides the sidebar at 360, 440, and 600 pixel widths using saved example data. This exercises the real interface with a development adapter; it does not verify native side-panel integration or live course access. Generated packages and private local exports/screenshots are ignored by Git.

## License and AI assistance

Original project code is available under the [MIT License](LICENSE), copyright 2026 Gabriel Romero. Gemma 4 E2B and its tokenizer/template assets retain their [Apache 2.0 model license](https://ai.google.dev/gemma/apache_2); dependencies retain their own licenses. The project MIT license does not relicense those components or private Canvas course material. Full attribution and pinned asset provenance are in [third-party notices](public/licenses/NOTICE.txt).

Development disclosure from the author: **Codex and GPT-6.1 Sol** assisted with implementation, tests, debugging, and documentation. These are development tools, separate from the **Gemma 4 E2B** model used by the installed application. The extension does not call an OpenAI API at runtime. See [submission disclosure](docs/submission.md#ai-assistance-and-original-work) for the distinction and remaining limitations.

Coding agents should read the canonical [AGENTS.md](AGENTS.md).
