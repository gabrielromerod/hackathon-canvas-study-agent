# Hacktoberfest submission preparation

Prepared for [Hacktoberfest Hack Day Menifee × MSJC CSC Club](https://mlh.com/events/hacktoberfest-hack-day-menifee-x-msjc-csc-club). This is reviewable submission text, not evidence that a form was submitted or that a prize/eligibility decision has been made.

## Project fields

- **Project name:** Canvas Study Agent
- **Short description:** A Canvas sidebar that keeps course sources, conversations, and a local AI study assistant beside your lesson.
- **Repository:** https://github.com/gabrielromerod/hackathon-canvas-study-agent
- **Demo URL:** Add a real recording or public demonstration link if available; do not use a mock preview as inference evidence.
- **Technologies:** JavaScript, Chrome Manifest V3, Chrome Side Panel API, WebGPU, LiteRT-LM 0.18.0, Gemma 4 E2B, IndexedDB, OPFS, Hugging Face Tokenizers/Jinja, esbuild, Turndown, Marked, DOMPurify, Node.js tests.

## Description*

I built Canvas Study Agent to keep course material and study conversations beside the lesson a student is reading. The native Chrome sidebar reads module-linked MSJC Canvas Pages into Markdown and makes sources inspectable and exportable as JSON. New chats follow “This tab”; students can also choose a course, module, section, or page, and that manual choice stays with the conversation. The assistant adds relevant cached excerpts and bounded memory from the same course, then streams replies with source references. Stop and retry preserve partial answers. Attachment bodies are not parsed in this version.

Gemma 4 E2B runs locally through LiteRT-LM and WebGPU. A one-time, explicit 2.01 GB download is verified and kept in the browser's origin-private filesystem; opening the sidebar can load that cache without starting another download. Conversations and drafts stay in IndexedDB. I verified real answers in two courses, citations, new-chat memory, cache reuse after an update and a full Chrome restart, and an offline cached cold load/warm-up with zero HTTP weight requests. Model and language-pack controls live in Settings.

The original application is MIT licensed, with separate licenses for Gemma and dependencies. Codex and GPT-6.1 Sol assisted with implementation, tests, debugging, and documentation; runtime study answers use Gemma, with no OpenAI chat API. The minimum demo focuses on cached local chat, current-tab context, sources, and export. After a retrieval fix, the same English requirement question returned the correct minimum of three peer posts with a citation checked against the original. Math tutoring explained a concept, restrictions, a worked example, and a practice question with lecture/OpenStax links. Answers still need source checks. Local English speech-pack installation failed on the current Chrome setup, and 12B QAT remains disabled.

## AI assistance and original work

The development-tool disclosure above is supplied by the author. [Codex](https://learn.chatgpt.com/docs) and [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) are named as development assistance, not as a claim about undisclosed session metadata or the extension's inference backend. The runtime model is the pinned, open-weight Gemma 4 E2B release identified in the README and NOTICE. No model training or fine-tuning is claimed.

The original work is the application integration: native sidebar/context tracking; authenticated course extraction; local source conversion and inspection; scoped prompt construction and same-course memory; verified persistent model caching; shared runtime ownership; transactional streamed-turn persistence; and safe source-linked reply rendering. Existing models, tokenizers, runtimes, libraries, and icons are credited rather than represented as trained or written from scratch.

## Verified demo evidence and release limits

Development-machine observations supplied by the native test run:

- Exact pinned E2B artifact accepted by byte count and SHA-256.
- Real native English answers and course citations in two courses.
- New-conversation recall from an earlier saved discussion in the same course.
- Cache retained across the v0.6.0 update under the same extension ID, `hnhhnokchlifpimlgebjfefepcbjeajo`, and after a complete Chrome exit/restart.
- Cached cold load/warm-up with the model host offline and zero HTTP weight requests.
- The original whole-course Week One question was repeated after the retrieval fix. The native reply correctly identified the minimum of three other people's posts, cited `[S8]`, and linked the right Week One source; the source paragraph was independently checked.
- Native Math tutoring described a rational function as a quotient of polynomials, explained restrictions, worked through `(x+1)/(x-2)`, and offered a practice question with the live lecture and actual OpenStax links.

The earlier retrieval omission now has unit, pinned-tokenizer, and native regression evidence, including the independently checked Week One answer above. This is a specific corrected case, not a guarantee that every requirement will be retrieved or every model answer will be correct. Local speech-pack installation failed in the tested Chrome setup, and 12B QAT remains disabled. Automated regressions cover source loading, scope, memory, storage, generation races, cancellation, cache reuse, rendering, and dictation failures; the final test-run result is recorded separately. Layout-preview mock content is not a model response. No additional model or speech-pack download is needed for the cached-model demonstration.

## Official submission guidance checked

MLH's [Open Source AI challenge page](https://www.mlh.com/opensource-ai) asks for meaningful open-source/open-weight AI use, a public GitHub repository with an open-source license, a README covering setup/model/dependencies, and an understandable working demo. It lists the event's OrganizerHQ submission flow and leaves deadlines/demo arrangements to the host. Agent Skills compliance applies to skill entries; this repository is an application and its AGENTS.md is coding guidance, not a claim to be an Agent Skill entry.

The public Menifee event page was not retrievable during this documentation pass (HTTP 403); no authenticated form was opened or changed. Confirm the event-specific rules, build window, challenge selections, and deadline from the user's existing form/host instructions. The user-reported deadline is October 23, 2026 at 2:00 PM PDT. The general page does not establish an extra AI-tool-disclosure requirement; the explicit development disclosure above is included for transparency and any applicable event field. No win, automatic eligibility, sponsor endorsement, or prize entitlement is asserted.

Before the final submission, publish the prepared source alongside the existing MIT license, confirm that another person can open the repository and follow the build instructions, and use a real demonstration link if one is provided. Final publication and form submission are separate actions.
