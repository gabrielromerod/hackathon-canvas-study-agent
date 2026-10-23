import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { htmlToMarkdown } from '../src/markdown.js';
const Parser = new JSDOM('').window.DOMParser;
const base = 'https://msjc.instructure.com/courses/50427/pages/lecture';
const convert = (html) => htmlToMarkdown(html, base, Parser);

test('preserves headings, emphasis, nested lists, quotes, and relative links as Markdown', () => {
  const { markdown } = convert(
    '<h2>Functions</h2><p>Read <strong>carefully</strong> and <em>practice</em> <a href="../files/12">notes</a>.</p><ol start="3"><li>Linear<ul><li>y = mx + b</li></ul></li><li>Quadratic</li></ol><blockquote><p>Keep units.</p></blockquote>',
  );
  assert.match(markdown, /^## Functions/);
  assert.match(markdown, /\*\*carefully\*\*/);
  assert.match(markdown, /\*practice\*/);
  assert.match(markdown, /\[notes\]\(https:\/\/msjc.instructure.com\/courses\/50427\/files\/12\)/);
  assert.match(markdown, /3\.\s+Linear/);
  assert.match(markdown, /4\.\s+Quadratic/);
  assert.match(markdown, /\n\s+-\s+y = mx \+ b/);
  assert.match(markdown, /> Keep units\./);
});

test('keeps all lecture objectives and media URLs without embedding HTML or player attributes', () => {
  const { markdown } = convert(
    '<h2>Basic Classes of Functions</h2><ul><li>Recognize polynomials.</li><li>Identify rational functions.</li></ul><h3>Video Lecture</h3><iframe title="Slope of a Line" src="https://www.youtube.com/embed/MeU-KzdCBps" allow="autoplay"></iframe><iframe src="https://phet.colorado.edu/sims/graphing.html"></iframe><video controls poster="/poster.png"><source src="/lecture.mp4"></video><audio src="/lecture.mp3"></audio><p><img src="/graph.png" alt="Parabola with vertex (0,0)"></p>',
  );
  for (const text of [
    'Recognize polynomials.',
    'Identify rational functions.',
    'https://www.youtube.com/embed/MeU-KzdCBps',
    'https://phet.colorado.edu/sims/graphing.html',
    'https://msjc.instructure.com/lecture.mp4',
    'https://msjc.instructure.com/lecture.mp3',
    'https://msjc.instructure.com/poster.png',
  ])
    assert.ok(markdown.includes(text), text);
  assert.match(
    markdown,
    /!\[Parabola with vertex \(0,0\)\]\(https:\/\/msjc.instructure.com\/graph.png\)/,
  );
  assert.doesNotMatch(markdown, /<iframe|<video|<audio|autoplay/);
});

test('preserves code whitespace and every cell of tables with or without headings', () => {
  const { markdown } = convert(
    '<pre><code class="language-python">if x &lt; 2:\n    print(x)\n</code></pre><table><tr><td>x</td><td>f(x)</td></tr><tr><td>1</td><td>2 | 3</td></tr></table>',
  );
  assert.match(markdown, /```python\nif x < 2:\n    print\(x\)/);
  assert.match(markdown, /\| x \| f\(x\) \|/);
  assert.match(markdown, /2 \\\| 3/);
  assert.doesNotMatch(markdown, /<table|<td/);
});

test('retains Canvas equation source, MathML LaTeX, and sub/superscript meaning', () => {
  const { markdown } = convert(
    '<p><img class="equation_image" data-equation-content="x^2 + y^2 = 1" src="/equation.svg" alt="equation"> H<sub>2</sub>O and x<sup>3</sup></p><math display="block"><semantics><mi>x</mi><annotation encoding="application/x-tex">\\frac{1}{x}</annotation></semantics></math>',
  );
  assert.match(markdown, /\$x\^2 \+ y\^2 = 1\$/);
  assert.match(markdown, /H_\{2\}O/);
  assert.match(markdown, /x\^\{3\}/);
  assert.match(markdown, /\$\$\n\\frac\{1\}\{x\}\n\$\$/);
});

test('removes executable markup and unsafe URLs while retaining link text and long content', () => {
  const longText = 'Useful lesson content. '.repeat(2000);
  const { markdown } = convert(
    `<style>bad css</style><script>alert(1)</script><p><a href="javascript:alert(1)">Reference</a><img src="javascript:alert(2)" alt="Diagram"></p><p>${longText}</p>`,
  );
  assert.doesNotMatch(markdown, /alert\(|bad css|javascript:/);
  assert.ok(markdown.includes('Reference'));
  assert.ok(markdown.includes('Diagram'));
  assert.equal((markdown.match(/Useful lesson content\./g) || []).length, 2000);
});

test('retains SVG graphics and warns when math has no unambiguous source representation', () => {
  const { markdown, warnings } = convert(
    '<svg xmlns="http://www.w3.org/2000/svg" aria-label="Triangle"><path d="M0 0L10 0L0 10Z"/></svg><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>',
  );
  assert.match(markdown, /!\[Triangle\]\(data:image\/svg\+xml/);
  assert.match(warnings.join(' '), /MathML/);
  assert.ok(markdown.includes('a'));
  assert.ok(markdown.includes('b'));
});

test('retains table captions and aligns rows beneath merged cells', () => {
  const { markdown } = convert(
    '<table><caption>Measurements (seconds and meters)</caption><tr><th>Experiment</th><th>Time</th><th>Value</th></tr><tr><td rowspan="2">A</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>',
  );
  assert.match(markdown, /Measurements \(seconds and meters\)/);
  assert.match(markdown, /\| A \(continued\) \| 3 \| 4 \|/);
  assert.doesNotMatch(markdown, /\| 3 \| 4 \|  \|/);
});
