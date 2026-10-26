import { marked } from 'marked';
import { demoSnapshot } from './fixture.js';
const snapshot = demoSnapshot();
const panel = document.querySelector('#agent');
function select(itemId) {
  const module = snapshot.modules.find((module) => module.items.some((item) => item.id === itemId));
  const item = module?.items.find((item) => item.id === itemId);
  if (!item) return;
  document.querySelector('#week').textContent = module.title;
  document.querySelector('#lesson-content').innerHTML = marked.parse(
    item.content.markdown
      .split('This is original synthetic')[0]
      .split('Original synthetic example')[0],
  );
  document
    .querySelectorAll('[data-item]')
    .forEach((button) => button.classList.toggle('active', button.dataset.item === itemId));
  panel.contentWindow.postMessage({ type: 'demo-lesson', itemId }, location.origin);
}
document
  .querySelectorAll('[data-item]')
  .forEach((button) => button.addEventListener('click', () => select(button.dataset.item)));
window.addEventListener('message', ({ origin, data }) => {
  if (origin === location.origin && data?.type === 'demo-source') select(data.itemId);
});
select('1001');
let recorder, stream;
const record = document.querySelector('#record'),
  stop = document.querySelector('#stop');
record.addEventListener('click', async () => {
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
      preferCurrentTab: true,
    });
    const chunks = [];
    recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 6000000,
    });
    recorder.ondataavailable = ({ data }) => {
      if (data.size) chunks.push(data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      link.download = 'canvas-study-agent-demo-capture.webm';
      link.click();
      record.hidden = false;
      stop.hidden = true;
      document.body.classList.remove('recording');
    };
    stream.getVideoTracks()[0].onended = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.start(500);
    record.hidden = true;
    stop.hidden = false;
    document.body.classList.add('recording');
  } catch (error) {
    record.textContent = error.message;
  }
});
stop.addEventListener('click', () => recorder?.stop());
