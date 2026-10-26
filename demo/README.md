# Public recording workspace

The production extension is scoped to an authenticated MSJC Canvas course. To make public demonstrations without exposing a student's course, this optional workspace uses **original synthetic lessons**, the actual panel/grounding/repository code, and the installed extension's **real cached Gemma worker**.

```sh
npm ci
npm run demo:build
```

Close other Study Agent panels, then reload the existing unpacked extension **after any live generation has completed**, preserving its identity/profile and cached model. Open `chrome-extension://<your-extension-id>/demo.html` in Chrome. No extra host permissions are added.

- The recording workspace requires the existing E2B cache. It forces `cachedOnly: true` for every setup request and disables model removal. It does not download weights.
- The fixture has a reserved demo course ID (`900001`) and its own IndexedDB database (`canvas-study-agent-public-demo-v1`). It does not modify saved real courses/chats or contact Canvas.
- The visible lesson pane stands in for Canvas with authored sample content. The right-hand pane runs the real extension interface; it is not a prerecorded/mock assistant response.
- Selecting a sample lesson exercises context changes. Source citations open the corresponding synthetic lesson. External textbook links are genuine source links; synthetic Canvas URLs are not real enrolled courses.
- **Record demo** uses Chrome's screen-capture picker. Select only this demo tab; the browser may also offer other capture surfaces. With the demo-tab selection, capture excludes other tabs and browser chrome. Microphone and system audio are disabled. **Stop recording** downloads a WebM; no capture is uploaded.
- The production build (`npm run build`) does not include this optional workspace. It preserves the original native sidebar behavior.

The published video is edited for pacing. Its narration was produced separately using Gemini 3.8 TTS from the public script; this is not an inference or speech dependency of the application. Music is original procedural audio. See [the public script and provenance](../docs/demo-script.md).
