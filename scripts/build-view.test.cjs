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

  it('bakes in checkpoint states as trail pins', () => {
    // done pin shows a check; current/upcoming pins show their number.
    // "you are here" + aria-current are applied at runtime by the viewer JS (to the
    // viewed section), not baked into the generator output.
    assert.ok(/cp-done[^>]*>\s*<span class="cp-pin" aria-hidden="true">✓/.test(html));
    assert.ok(/cp-current[^>]*>\s*<span class="cp-pin" aria-hidden="true">2/.test(html));
    assert.ok(html.includes('data-target="section-1"'));  // navigation hook preserved
    assert.ok(!html.includes('you are here'));            // not static anymore
  });

  it('moves the mermaid block into a .mermaid div (not a code fence)', () => {
    assert.ok(html.includes('<div class="mermaid">graph TD; A--&gt;B;</div>'));
    assert.ok(!html.includes('```mermaid'));
  });

  it('leaves no unreplaced template tokens', () => {
    assert.ok(!html.includes('{{'));
  });

  it('adds a "Stop N of M" kicker to checkpoint sections only', () => {
    // RENDER_SECTIONS has 2 checkpoints (1, 2) + a FAQ, so M = 2
    assert.ok(html.includes('<div class="kicker">Stop 1 of 2</div>'));
    assert.ok(html.includes('<div class="kicker">Stop 2 of 2</div>'));
    const faq = html.slice(html.indexOf('id="section-faq"'));
    assert.ok(!faq.includes('class="kicker"')); // FAQ has no kicker
  });

  it('wraps the mermaid diagram in a .diagram block with a zoom button', () => {
    assert.ok(html.includes('<div class="diagram">'));
    assert.ok(html.includes('class="diagram-zoom"'));
    // the .mermaid div (with escaped source) still exists inside the wrapper
    assert.ok(html.includes('<div class="mermaid">graph TD; A--&gt;B;</div>'));
  });
});

const { buildView } = require('./build-view.cjs');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lbv-'));
}

const MAP_FIXTURE = `---
generated_at: deadbee
version: 3
target: .
---

## 1 · The big picture
Hello world.

## FAQ
Nothing yet.
`;

describe('buildView', () => {
  it('writes a self-contained html file from a map (no progress file)', () => {
    const dir = tmpdir();
    const mapPath = path.join(dir, 'map.md');
    const tplPath = path.join(dir, 'view.html');
    const merPath = path.join(dir, 'mermaid.js');
    const outPath = path.join(dir, 'out', 'learn-view.html');
    fs.writeFileSync(mapPath, MAP_FIXTURE);
    fs.writeFileSync(tplPath, '<h1>{{REPO_NAME}}</h1><ul>{{CHECKPOINTS}}</ul>' +
      '<main>{{SECTIONS}}</main><script>{{MERMAID_LIB}}</script>' +
      '<span>v{{MAP_VERSION}}</span>');
    fs.writeFileSync(merPath, '/*MER*/');

    const result = buildView({
      mapPath,
      progressPath: path.join(dir, 'missing.json'),
      outPath,
      templatePath: tplPath,
      mermaidPath: merPath,
      repoName: 'demo',
    });

    assert.strictEqual(result, outPath);
    const html = fs.readFileSync(outPath, 'utf8');
    assert.ok(html.includes('demo'));
    assert.ok(html.includes('id="section-1"'));
    assert.ok(html.includes('/*MER*/'));
    // default progress -> section 1 is current
    assert.ok(/cp-current[^>]*data-target="section-1"/.test(html));
  });
});

const { execFileSync } = require('node:child_process');

describe('CLI', () => {
  it('builds via the script entry using the real template + vendored mermaid', () => {
    const dir = tmpdir();
    const mapPath = path.join(dir, 'map.md');
    const outPath = path.join(dir, 'learn-view.html');
    fs.writeFileSync(mapPath, MAP_FIXTURE);
    execFileSync('node', [
      path.join(__dirname, 'build-view.cjs'),
      mapPath,
      path.join(dir, 'no-progress.json'),
      outPath,
      'cli-demo',
    ]);
    const html = fs.readFileSync(outPath, 'utf8');
    assert.ok(html.includes('cli-demo'));
    assert.ok(html.includes('id="section-1"'));
  });
});

describe('real template integration', () => {
  it('builds with the real template + vendored mermaid: self-contained, no leftover tokens', () => {
    const dir = tmpdir();
    const mapPath = path.join(dir, 'map.md');
    const outPath = path.join(dir, 'learn-view.html');
    fs.writeFileSync(
      mapPath,
      `---\ngenerated_at: x\nversion: 1\ntarget: .\n---\n\n` +
        '## 1 · The big picture\nIntro.\n```mermaid\ngraph TD; A-->B;\n```\n\n' +
        '## 2 · Setup\n- step one\n\n## FAQ\nnone\n'
    );
    buildView({
      mapPath,
      progressPath: path.join(dir, 'none.json'),
      outPath,
      templatePath: path.join(__dirname, '..', 'templates', 'view.html'),
      mermaidPath: path.join(__dirname, '..', 'vendor', 'mermaid.min.js'),
      repoName: 'realtpl',
    });
    const html = fs.readFileSync(outPath, 'utf8');
    // No unreplaced template tokens. (Check the specific tokens, not a blanket
    // "{{" — the inlined mermaid lib legitimately contains "{{" in its own code.)
    for (const tok of ['{{REPO_NAME}}', '{{MAP_VERSION}}', '{{CHECKPOINTS}}', '{{SECTIONS}}', '{{MERMAID_LIB}}']) {
      assert.ok(!html.includes(tok), 'no leftover token ' + tok);
    }
    // self-contained: no external resource loads
    assert.ok(!/src\s*=\s*["']https?:/i.test(html), 'no external script src');
    assert.ok(!/href\s*=\s*["']https?:/i.test(html), 'no external href');
    assert.ok(!/<link\b/i.test(html), 'no <link> tags');
    assert.ok(html.includes('realtpl'));
    assert.ok(html.includes('class="mermaid"'));
  });
});
