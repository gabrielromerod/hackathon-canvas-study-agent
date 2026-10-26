# Product demo and media

[Watch the 72-second demo](media/demo.mp4) · [Narration script](demo-script.md) · [Project overview](../README.md)

## What is being shown

The footage is a recording of the actual extension interface, prompt retrieval, tokenizer, persistence, and **Gemma 4 E2B inference**. Original synthetic Calculus I lessons replace enrolled course content in a clearly labeled, opt-in recording workspace. The lesson pane represents Canvas; the right-hand pane runs the application's existing panel code. This protects private course material while making the answers and source references inspectable.

No answer was replaced with a scripted or mocked response. The sequence is edited for pacing and is not a response-time benchmark. The production MSJC Canvas integration remains unchanged; the recording workspace adds no host permissions and is excluded from ordinary builds.

The recording shows context selection, a real explanation of an excluded rational-function input, rendered equations, source inspection, schema-3 JSON export, saved conversations, prior-chat continuity, and cached model readiness. The demo model host reported **zero weight-download requests**; the existing verified download was reused. PDF-body extraction, OCR, 12B inference, and microphone capture are not demonstrated or claimed.

## Reproduce the recording

1. Install/build the extension and complete its regular model setup on a compatible device.
2. Stop any active generation, then run `npm run demo:build` and reload the existing unpacked extension under the same identity/profile.
3. Open `chrome-extension://<your-extension-id>/demo.html`. The workspace uses an isolated demo database and forces cached-only model setup.
4. Use **Record demo** and select only that Chrome tab. No microphone or system audio is captured. Show the desired interactions and choose **Stop recording** to download a WebM.
5. Use the source capture and narration script for your own edit. An ordinary `npm run build` excludes the recording workspace.

See [the workspace notes](../demo/README.md) for boundaries and implementation details. The public PNGs are still frames from this same recording, not generated product mockups.

## Audio and editing provenance

- **Voiceover:** English, prebuilt Kore voice, generated with Gemini 3.8 Flash TTS from the public script with the author's authorization. Google received that script, not private Canvas material or chat histories. This is an editing-production dependency, not an extension inference dependency.
- **Music:** original locally synthesized instrumental background, with no third-party recording or copyrighted sample. Separate voice/music stems are retained in the local edit project.
- **Edit:** local Tesseract 0.4.0; the portable editable project is retained locally with its packaged resources. The published MP4 is the presentation export.
- **Images:** repository hero/social artwork is original SVG. Product screenshots are actual frames of synthetic-course footage.

Project artwork, the authored demo material, and the procedural music are original project contributions under the repository's MIT license. Third-party model/software licenses remain unchanged. Gemini-generated narration is identified here rather than represented as a human recording.

The social-sharing artwork is available as [SVG](media/social-preview.svg) and [PNG](media/social-preview.png).
