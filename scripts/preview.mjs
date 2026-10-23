import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const result = await build({
  entryPoints: ['tests/fixtures/panel-preview.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});
const bundle = result.outputFiles[0].contents;
const html = (await readFile('public/sidepanel.html', 'utf8')).replace(
  'src="panel.js"',
  'src="preview.js"',
);
const course = await readFile('tests/fixtures/preview-course.json');
const gallery = `<!doctype html><html><head><title>Study Agent · Layout demo</title><style>body{margin:24px;background:#f3f4f7;font:13px system-ui;color:#6b7280}.grid{display:flex;align-items:start;gap:24px;flex-wrap:wrap}section{margin-bottom:24px}h2{font-size:13px;font-weight:500}output{display:block;font-size:11px;margin-top:6px;max-width:600px;overflow-wrap:anywhere}iframe{display:block;border:1px solid #dfe2e9;border-radius:14px;background:white;box-sizing:content-box;height:600px}p{margin-bottom:24px}</style></head><body><p><strong>LAYOUT DEMO — mock assistant content; no model inference.</strong> Synthetic course fixture, current source HTML/CSS. Each iframe has a 600px viewport height.</p>${['empty', 'assistant'].map((mode) => `<h1>${mode === 'empty' ? 'Empty conversation' : 'Populated mock assistant: code, table, citations'}</h1><div class="grid">${[360, 440, 600].map((width) => `<section><h2>${width}px sidebar · ${mode}</h2><iframe title="${width}px ${mode} sidebar" style="width:${width}px" src="/panel?width=${width}&mode=${mode}"></iframe><output data-key="${width}-${mode}"></output></section>`).join('')}</div>`).join('')}<script>window.addEventListener('message',event=>{const data=event.data;if(data?.type==='study-agent-layout'){const output=document.querySelector('output[data-key="'+data.width+'-'+data.mode+'"]');if(output)output.textContent=JSON.stringify(data);}});</script></body></html>`;
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    let data,
      type = 'text/html; charset=utf-8';
    if (path === '/' || path === '/gallery') data = gallery;
    else if (path === '/panel') data = html;
    else if (path === '/preview.js') {
      data = bundle;
      type = 'text/javascript';
    } else if (path === '/course.json') {
      data = course;
      type = 'application/json';
    } else if (path === '/panel.css') {
      data = await readFile('public/panel.css');
      type = 'text/css';
    } else if (/^\/icons\/[a-z-]+\.svg$/.test(path)) {
      data = await readFile(
        `node_modules/@phosphor-icons/core/assets/regular/${path.slice('/icons/'.length)}`,
      );
      type = 'image/svg+xml';
    } else {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(data);
  } catch {
    response.writeHead(500);
    response.end(
      'Preview unavailable. Install the development dependencies and retain the synthetic course fixture.',
    );
  }
});
const port = Number(process.env.PORT || 8765);
server.listen(port, '127.0.0.1', () =>
  console.log(`Interface review listening on 127.0.0.1:${port} (local only; mock layout demo).`),
);
