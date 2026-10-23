# Agent guidance

This is the canonical repository guidance for coding agents, using the [AGENTS.md open format](https://agents.md/). It complements README.md. More specific nested AGENTS.md files apply within their directories; explicit user instructions take precedence.

## Project and development

Canvas Study Agent is a Chrome Manifest V3 sidebar for the single MSJC Canvas origin. It discovers module-linked course material, persists course-isolated conversations, and runs a pinned Gemma 4 E2B model locally through LiteRT-LM/WebGPU.

- Use a current Node.js LTS release; development was verified with Node.js 24.
- Install exactly the lockfile dependencies with `npm ci`.
- Build with `npm run build`; it creates `extension/` from `src/` and `public/`.
- Run all tests with `npm test`, and source/build-entrypoint checks with `npm run check` after building.
- Check formatting with `npm run format:check`; use `npm run format` when formatting source changes.
- Package with `npm run package` only when a fresh generated extension is wanted.
- Run `PORT=8766 npm run preview` for the development layout demo on a separate port. It uses mock data, not model inference.

Do not edit generated `extension/` output. The build verifies/fetches pinned tokenizer assets into ignored `vendor/gemma-e2b/`; it does not download the 2 GB weight artifact. Do not bundle weights into source control or a ZIP. Do not reload or rebuild the live extension while another explicitly identified model run depends on its files.

## Code organization and style

- JavaScript ES modules, single quotes, semicolons, and the checked-in Prettier configuration/scripts.
- `src/canvas/`: serializable injected readers and the browser adapter.
- `src/course/`: reading, progress, cancellation, and schema-3 JSON export.
- `src/storage/`: atomic IndexedDB persistence through `idb`.
- `src/background/`: per-window context, ownership, and centralized mutation commands.
- `src/ai/`: offscreen host, dedicated model worker, OPFS cache, and turn coordination.
- `src/chat/`: scope, matching tokenizer, grounding, memory, and safe reply rendering.
- `src/panel/`: sidebar controls, transport, sources, model setup, and local dictation.
- `public/`: source manifest/HTML/CSS and third-party notices.

Prefer small domain modules and explicit dependencies. Keep injected browser functions self-contained. Add a failing behavioral test before changing domain behavior, then run the relevant tests and the complete suite. Do not replace native inference evidence with a fake response in acceptance reports.

## Contracts to preserve

- Course exports remain schema version 3. Chat/model state is not silently added to course exports.
- The service worker is the central writer; repository transactions must also remain safe across two connections.
- Course imports use generation fencing. Model turns use an explicit thread ID, turn ID, attempt, assistant ID, and increasing sequence; stale writes must not replace a newer result.
- Persist full message/source content. Prompt budgeting may omit excerpts with a visible warning; it must not silently truncate stored data or discard prior attempts.
- Treat old messages without a role as user messages. Preserve drafts, historical scope, reference provenance, and failed/cancelled partial answers.
- Keep source evidence separate from prior-chat memory. Memory must remain within the same course and compatible scope.
- Keep runtime/model/tokenizer/template revisions and hashes aligned. A newer `*-gpu.litertlm` file is not a drop-in replacement for the pinned `GPU_ARTISAN` web artifact.
- Cache identity must not depend on extension version. An ordinary update should reuse the completed pinned model under the same extension identity/profile.

## Privacy and verification

Use existing authenticated Canvas GET access only for the allowed course origin. Do not broaden host permissions, introduce prompt uploads/telemetry, or add an online inference/dictation fallback as an incidental implementation choice. Treat course text and model Markdown as untrusted data; keep sanitization and validated same-course citation links.

Do not commit real course exports, authentication/session data, browser-profile files, model weights, or private native screenshots. Use synthetic fixtures for public demonstrations and automated tests. Preserve third-party license texts and generated legal notices; the project MIT license applies to original project code, not third-party components.

Before claiming a release is ready, distinguish unit/UI tests, mock layout previews, and actual native results. Report the command, observed result, and any remaining failures or limitations. In particular, a model can run offline yet answer incorrectly because retrieval omitted a source; validate factual course requirements against the original evidence. The 12B QAT path and current Chrome local speech-pack failure must not be described as working without new native evidence.
