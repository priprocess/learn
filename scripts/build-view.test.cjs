const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  parseFrontmatter,
  parseSections,
} = require('./build-view.cjs');

const SAMPLE = `---
generated_at: abc123
version: 2
target: .
---

## 1 · The big picture
Overview text.

## 2 · Setup & dev loop
Run npm install.

## FAQ
Q: why? A: because.
`;

describe('parseFrontmatter', () => {
  it('extracts meta and strips the frontmatter block', () => {
    const { meta, body } = parseFrontmatter(SAMPLE);
    assert.strictEqual(meta.generated_at, 'abc123');
    assert.strictEqual(meta.version, '2');
    assert.strictEqual(meta.target, '.');
    assert.ok(body.startsWith('## 1 · The big picture'));
  });

  it('returns body unchanged when there is no frontmatter', () => {
    const { meta, body } = parseFrontmatter('## A\nx');
    assert.deepStrictEqual(meta, {});
    assert.strictEqual(body, '## A\nx');
  });
});

describe('parseSections', () => {
  it('splits on ## headings and flags numbered ones as checkpoints', () => {
    const { body } = parseFrontmatter(SAMPLE);
    const s = parseSections(body);
    assert.strictEqual(s.length, 3);
    assert.strictEqual(s[0].index, 1);
    assert.strictEqual(s[0].title, 'The big picture');
    assert.strictEqual(s[0].isCheckpoint, true);
    assert.ok(s[0].content.includes('Overview text.'));
    assert.strictEqual(s[1].index, 2);
    assert.strictEqual(s[2].index, null);
    assert.strictEqual(s[2].isCheckpoint, false);
    assert.strictEqual(s[2].title, 'FAQ');
  });
});

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractMermaid,
  readProgress,
  computeCheckpointStates,
} = require('./build-view.cjs');

describe('extractMermaid', () => {
  it('pulls the mermaid source out of a fenced block', () => {
    const content = 'intro\n```mermaid\ngraph TD; A-->B;\n```\nmore';
    assert.strictEqual(extractMermaid(content), 'graph TD; A-->B;');
  });
  it('returns null when there is no mermaid block', () => {
    assert.strictEqual(extractMermaid('no diagram here'), null);
  });
});

describe('readProgress', () => {
  it('defaults gracefully when the file is missing', () => {
    const p = readProgress(path.join(os.tmpdir(), 'definitely-missing-xyz.json'));
    assert.deepStrictEqual(p, { completed: [], current: 1, map_version: null });
  });
  it('reads a valid progress file', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lp-')), 'p.json');
    fs.writeFileSync(f, JSON.stringify({ completed: [1, 2], current: 3, map_version: 4 }));
    assert.deepStrictEqual(readProgress(f), { completed: [1, 2], current: 3, map_version: 4 });
  });
});

describe('computeCheckpointStates', () => {
  it('marks done / current / upcoming and ignores non-checkpoints', () => {
    const sections = [
      { index: 1, title: 'A', isCheckpoint: true },
      { index: 2, title: 'B', isCheckpoint: true },
      { index: 3, title: 'C', isCheckpoint: true },
      { index: null, title: 'FAQ', isCheckpoint: false },
    ];
    const states = computeCheckpointStates(sections, { completed: [1], current: 2, map_version: 1 });
    assert.deepStrictEqual(states, [
      { index: 1, title: 'A', state: 'done' },
      { index: 2, title: 'B', state: 'current' },
      { index: 3, title: 'C', state: 'upcoming' },
    ]);
  });
});

const { renderView } = require('./build-view.cjs');

const FAKE_TEMPLATE = [
  '<title>{{REPO_NAME}} v{{MAP_VERSION}}</title>',
  '<ul>{{CHECKPOINTS}}</ul>',
  '<main>{{SECTIONS}}</main>',
  '<script>{{MERMAID_LIB}}</script>',
].join('\n');

const RENDER_SECTIONS = [
  { index: 1, title: 'The big picture', isCheckpoint: true,
    content: 'Intro paragraph.\n```mermaid\ngraph TD; A-->B;\n```' },
  { index: 2, title: 'Setup', isCheckpoint: true, content: '- run `npm i`' },
  { index: null, title: 'FAQ', isCheckpoint: false, content: 'Q and A.' },
];

describe('renderView', () => {
  const html = renderView({
    meta: { version: '7' },
    sections: RENDER_SECTIONS,
    progress: { completed: [1], current: 2, map_version: 7 },
    repoName: 'acme',
    template: FAKE_TEMPLATE,
    mermaidLib: '/*MERMAIDLIB*/',
  });

  it('injects repo name, version and mermaid lib', () => {
    assert.ok(html.includes('acme v7'));
    assert.ok(html.includes('/*MERMAIDLIB*/'));
  });

  it('renders one section per heading with rendered markdown', () => {
    assert.ok(html.includes('id="section-1"'));
    assert.ok(html.includes('id="section-2"'));
    assert.ok(html.includes('id="section-faq"'));
    assert.ok(html.includes('<p>Intro paragraph.</p>'));
    assert.ok(html.includes('<li>')); // the bullet list in Setup
  });

  it('bakes in checkpoint states with the right icons', () => {
    assert.ok(/cp-done[^>]*>\s*<span class="cp-icon">✓/.test(html));
    assert.ok(/cp-current[^>]*>\s*<span class="cp-icon">→/.test(html));
  });

  it('moves the mermaid block into a .mermaid div (not a code fence)', () => {
    assert.ok(html.includes('<div class="mermaid">graph TD; A--&gt;B;</div>'));
    assert.ok(!html.includes('```mermaid'));
  });

  it('leaves no unreplaced template tokens', () => {
    assert.ok(!html.includes('{{'));
  });
});
