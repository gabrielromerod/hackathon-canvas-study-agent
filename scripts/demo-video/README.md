# Demo film pipeline

The 60-second demo in the README is edited with code, so a caption, zoom or timing change is a one-line edit and a re-render.

| File         | Role                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `stage.html` | The whole film as one HTML page: every scene, caption, zoom and highlight is a function of time.                               |
| `render.mjs` | Opens the page in Chromium with Playwright and saves one screenshot per frame (1800 frames, 30 fps).                           |
| `music.py`   | Synthesizes the original score (120 BPM, bars aligned with the scene cuts). No samples are used.                               |
| `make.sh`    | Runs everything: extracts raw frames, renders, mixes, and writes `docs/media/demo.mp4`, `demo-loop.gif` and `demo-poster.png`. |

## Rebuild

1. Record a raw take in the public demo workspace (see [docs/demo.md](../../docs/demo.md)) and save it as `artifacts/portfolio/demo-capture.mp4`. The timeline in `stage.html` (`MAP`) points at second ranges of that take, so a new take needs those ranges updated.
2. Install the tools: ffmpeg, Python 3 with `numpy` and `scipy`, and Playwright with Chromium (`npm i --no-save playwright && npx playwright install chromium`).
3. Run `scripts/demo-video/make.sh`.

Working files go to the ignored `artifacts/demo-video/` folder. The film uses the Inter typeface; install it locally for an exact match.
