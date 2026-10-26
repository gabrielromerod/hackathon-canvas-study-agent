# Canvas Study Agent — portfolio demo

A 60–80 second English product demo for the hackathon winner of **Best Open Source AI Project**. The course shown is synthetic. Chat footage must show actual local Gemma 4 E2B inference; do not replace an answer with a scripted response.

## Narration and edit beats

The durations below are editorial targets. The delivered audio timing manifest records measured segment lengths and final placement.

| Beat | Target | Picture | Exact narration |
| --- | ---: | --- | --- |
| 1 · Reveal | 6.5 s | Product title and award; sidebar beside a synthetic Canvas lesson | Canvas Study Agent won Best Open Source AI Project. Here's the study companion I built for Canvas. |
| 2 · Context | 9 s | Current lesson and scope choices: this tab, module, course | Open a lesson, and the sidebar follows your browser context. Choose this tab, a module, or the whole course. |
| 3 · Ask | 16 s | Ask a short question; show a real streamed answer and rendered math | Ask a question in plain English. Gemma four E two B runs locally with Web GPU, streams an explanation, and shows readable math. These are real model responses using a synthetic demo course. |
| 4 · Evidence | 11 s | Click citations; show Markdown source, available file link, and structured export | Check the evidence with clickable citations and original source links. Browse course pages as Markdown, open available file links, and export structured course data. |
| 5 · Continuity | 8 s | New chat and saved conversation; indicate course separation | Start a fresh chat without losing the thread. Saved conversations and memory stay separated by course. |
| 6 · Local | 10 s | Cached model status and local inference; no new weight download | Download the pinned model once. Its verified cache survives ordinary updates, while your questions and course context stay on this device during inference. |
| 7 · Close | 8 s | Clean product view, award, MIT and repository call to action | Open source. M I T licensed. Built to make course material easier to understand, with the sources one click away. |

## Production and claim boundaries

- Label the footage **“Synthetic demo course · Real local inference.”** A shortened model wait may be edited for pacing if the edit identifies it; do not imply a recorded response time is a benchmark.
- The supported Canvas integration is the MSJC Canvas origin. Avoid graphics suggesting universal LMS compatibility.
- File links expose available originals; this demo does not claim PDF-body understanding, OCR, or working microphone capture.
- Product inference runs locally. Narration is a separate production asset generated from this public script using Google's Gemini speech API, with the user's explicit authorization; no private Canvas content is sent for narration.
- Ordinary cache reuse assumes the same extension identity and browser profile. Third-party model and dependency licenses remain separate from the project's MIT-licensed code.

## Audio direction and provenance

Voice: Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`), prebuilt **Kore**, clear warm American English, measured conversational delivery. This is an original synthetic narration using a studio voice, not a clone of an identifiable person. Delivery controls use `speech_metadata.style`, separate from the verbatim transcript, following the [official Gemini speech-generation guide](https://ai.google.dev/gemini-api/docs/speech-generation).

Music: original locally synthesized instrumental bed, with soft chord pads and restrained plucks. No third-party music recording or copyrighted sample is used. Keep the bed well below the narration and retain separate stems for editing.

Local audio, generation responses, synthesis recipe, and measured timing metadata are kept under the ignored `artifacts/portfolio/audio/` directory. The credential is excluded from all requests saved to disk, production documentation, and deliverables.

## Delivered audio timing

Measured delivery: **72.00 seconds**, with 66.40 seconds of generated speech. Original segment WAVs are 24 kHz, mono, 16-bit PCM. The combined narration is 48 kHz, mono, 24-bit PCM; the original music stem is 48 kHz, stereo, 16-bit PCM; the ready-to-edit mix is 48 kHz, stereo, 24-bit PCM.

| Beat | Voice begins | Voice ends |
| --- | ---: | ---: |
| Reveal | 00:00.70 | 00:08.02 |
| Context | 00:08.57 | 00:16.37 |
| Ask | 00:16.92 | 00:31.60 |
| Evidence | 00:32.15 | 00:43.15 |
| Continuity | 00:43.70 | 00:50.66 |
| Local | 00:51.21 | 01:01.53 |
| Close | 01:02.08 | 01:10.40 |

FFmpeg measurements: narration −17.0 LUFS integrated; original music −35.7 LUFS; combined mix −16.0 LUFS, with measured true peak −3.5 dBTP. Narration and mix use measured two-pass loudness normalization. The bed uses an original deterministic 88 BPM additive-synthesis score, gentle head/tail fades, and a lower level around the spoken segments. Detailed format, synthesis, normalization, and segment timing records are in `artifacts/portfolio/audio/timing.json`.

These are technical measurements, not a listening approval. Audition the narration and review speech clarity against the completed video; remeasure the encoded final export after muxing.
