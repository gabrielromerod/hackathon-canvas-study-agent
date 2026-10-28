# Demo film: shot list

The 60-second film has no voiceover. Captions carry the story so it works muted on GitHub and social feeds. Footage is the synthetic demo course with real local Gemma 4 E2B output; the timeline lives in [`scripts/demo-video/stage.html`](../scripts/demo-video/stage.html).

| Time      | Chapter       | Picture                                                     | On-screen text                                                      | Raw take                           |
| --------- | ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| 0:00–0:04 | Title         | Logo, award                                                 | Canvas Study Agent · Local AI for everyone.                         | –                                  |
| 0:04–0:10 | Problem       | Four setup steps struck through, then the answer card       | Running AI locally usually means setup. / Add one Chrome extension. | –                                  |
| 0:10–0:16 | Reveal        | Full workspace, then a zoom into the sidebar                | A study sidebar, right beside your lesson.                          | 0:01–0:07, real time               |
| 0:16–0:22 | 01 · Context  | Scope menu: entire course, this tab, a module               | Choose what it reads.                                               | 0:07–0:19, 2×                      |
| 0:22–0:32 | 02 · Ask      | Question sent, answer streams with math, `[S1]` highlighted | Ask your course. Get sources back.                                  | 0:19–0:26 and 1:21–1:24, real time |
| 0:32–0:38 | 03 · Evidence | Course sources and a Markdown preview                       | Check the evidence.                                                 | 1:29–1:43, 2.3×                    |
| 0:38–0:44 | 04 · Memory   | New chat asks what was just discussed                       | It remembers.                                                       | 1:45–1:57, 2×                      |
| 0:44–0:50 | 05 · Local    | Settings: 2.01 GB download once, 0 weight requests          | Download once. Then it is all local.                                | 2:09–2:13, real time               |
| 0:50–0:54 | Architecture  | The diagram from `docs/media/architecture.svg`              | Everything runs inside your browser.                                | –                                  |
| 0:54–1:00 | Close         | Award, repository URL, Gemma 4 E2B · WebGPU · MIT           | –                                                                   | –                                  |

## Claim boundaries

- Label the footage "Synthetic demo course · real Gemma output", and label every sped-up segment.
- The supported Canvas integration is the MSJC Canvas origin; avoid suggesting universal LMS support.
- File links expose available originals; the film does not claim PDF-body understanding, OCR or working microphone capture.
- Ordinary cache reuse assumes the same extension identity and browser profile.
