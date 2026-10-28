# Product demo and media

[Watch the 60-second demo](media/demo.mp4) · [Shot list](demo-script.md) · [Project overview](../README.md)

## What is being shown

The footage is a recording of the actual extension interface, prompt retrieval, tokenizer, persistence and **Gemma 4 E2B inference**. Original synthetic Calculus I lessons replace enrolled course content in a clearly labeled, opt-in recording workspace. The lesson pane represents Canvas; the right-hand pane runs the application's existing panel code. This protects private course material while keeping the answers and source references inspectable.

No answer was replaced with a scripted or mocked response. The question in the "Ask" chapter plays in **real time**; other chapters are sped up and say so on screen (2× or 2.3×), and cuts are not a response-time benchmark. The production MSJC Canvas integration is unchanged; the recording workspace adds no host permissions and is excluded from ordinary builds.

The film shows context selection, a streamed explanation with rendered math and a source citation, source inspection as Markdown, a new chat recalling the previous one, and the cached model status with zero weight requests. PDF-body extraction, OCR, 12B inference and microphone capture are not demonstrated or claimed.

## Record a raw take

1. Install/build the extension and complete its regular model setup on a compatible device.
2. Stop any active generation, then run `npm run demo:build` and reload the existing unpacked extension under the same identity/profile.
3. Open `chrome-extension://<your-extension-id>/demo.html`. The workspace uses an isolated demo database and forces cached-only model setup.
4. Use **Record demo** and select only that Chrome tab. No microphone or system audio is captured. Show the interactions and choose **Stop recording** to download a WebM.

See [the workspace notes](../demo/README.md) for boundaries and implementation details.

## Edit

The film is rendered from code in [`scripts/demo-video/`](../scripts/demo-video/README.md): an HTML timeline captured frame by frame with Playwright, then encoded with ffmpeg. The README loop (`media/demo-loop.gif`) is the Ask, Evidence and Memory chapters of the same render. Product screenshots in the README are frames of the same raw take, not mockups.

## Audio and image provenance

- **Music:** an original score synthesized by [`scripts/demo-video/music.py`](../scripts/demo-video/music.py), with no samples or third-party recordings. There is no voiceover; on-screen captions carry the story so the video works muted.
- **Images:** the hero, feature tiles, architecture diagram and social preview are original artwork built around real frames from the recording.
- **Production:** the showcase media were produced with AI-assisted tools; the earlier narrated cut used Gemini TTS and is no longer published.

Project artwork, the authored demo material and the score are original project contributions under the repository's MIT license. Third-party model and software licenses remain unchanged.

The social-sharing image is [media/social-preview.png](media/social-preview.png) (1280 × 640).
