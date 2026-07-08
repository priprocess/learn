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
const { extractMermaid } = require('./build-view.cjs');

describe('extractMermaid', () => {
  it('pulls the mermaid source out of a fenced block', () => {
    const content = 'intro\n```mermaid\ngraph TD; A-->B;\n```\nmore';
    assert.strictEqual(extractMermaid(content), 'graph TD; A-->B;');
  });
  it('returns null when there is no mermaid block', () => {
    assert.strictEqual(extractMermaid('no diagram here'), null);
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

  it('renders checkpoints as plain numbered nav items (no progress state)', () => {
    assert.ok(/<li class="cp" data-target="section-1" role="button" tabindex="0"><span class="cp-pin" aria-hidden="true">1<\/span>/.test(html));
    assert.ok(html.includes('data-target="section-2"'));
    assert.ok(!/cp-(done|current|upcoming)/.test(html)); // no progress states
    assert.ok(!html.includes('✓'));
    assert.ok(!html.includes('you are here'));
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
    assert.ok(html.includes('data-target="section-1"'));
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
      outPath,
      'cli-demo',
    ]);
    const html = fs.readFileSync(outPath, 'utf8');
    assert.ok(html.includes('cli-demo'));
    assert.ok(html.includes('id="section-1"'));
  });
});

const CALLOUT_SECTIONS = [
  { index: 1, title: 'Data flow', isCheckpoint: true, content:
    'Intro prose paragraph.\n\n' +
    '> **Insight:** Decoupling keeps checkout fast.\n\n' +
    '> **Gotcha:** Vendor calls must be idempotent.\n\n' +
    '> **Where to look:** `apps/api/create.ts`\n\n' +
    '> **Try this:** Trace one event end to end.\n\n' +
    '> **Watch out:** alias for gotcha.\n\n' +
    '> **Heads up:** not a known label.' },
];

describe('typed callouts', () => {
  const html = renderView({
    meta: { version: '1' }, sections: CALLOUT_SECTIONS,
    repoName: 'acme', template: '{{CHECKPOINTS}}|{{SECTIONS}}|{{REPO_NAME}}|{{MAP_VERSION}}|{{MERMAID_LIB}}',
    mermaidLib: '/*M*/',
  });

  it('renders each recognized type with the right class, icon and label', () => {
    assert.ok(/call-insight"><span class="ic" aria-hidden="true">💡<\/span>/.test(html));
    assert.ok(html.includes('<div class="lab">Insight</div>'));
    assert.ok(/call-gotcha"><span class="ic" aria-hidden="true">⚠️<\/span>/.test(html));
    assert.ok(html.includes('<div class="lab">Gotcha</div>'));
    assert.ok(/call-where"><span class="ic" aria-hidden="true">📍<\/span>/.test(html));
    assert.ok(html.includes('<div class="lab">Where to look</div>'));
    assert.ok(/call-try"><span class="ic" aria-hidden="true">✅<\/span>/.test(html));
    assert.ok(html.includes('<div class="lab">Try this</div>'));
    assert.ok(html.includes('Vendor calls must be idempotent.'));
  });

  it('maps an alias to its canonical type ("Watch out" -> gotcha)', () => {
    assert.ok(html.includes('alias for gotcha.'));
    assert.ok((html.match(/call-gotcha/g) || []).length >= 2); // Gotcha + Watch out
  });

  it('keeps inline code inside a callout body', () => {
    assert.ok(html.includes('<div class="call call-where">'));
    assert.ok(html.includes('<code>apps/api/create.ts</code>'));
  });

  it('leaves an unrecognized bold-label blockquote as a normal blockquote', () => {
    assert.ok(/<blockquote>[\s\S]*Heads up[\s\S]*<\/blockquote>/.test(html));
    assert.ok(!/<div class="call[^"]*">(?:(?!<\/div>)[\s\S])*Heads up/.test(html));
  });
});

describe('callout label colon handling', () => {
  const html = renderView({
    meta: { version: '1' },
    sections: [{ index: 1, title: 'X', isCheckpoint: true, content:
      '> **Gotcha**: colon outside the bold.\n\n> **Important** no colon at all.' }],
    repoName: 'a', template: '{{CHECKPOINTS}}|{{SECTIONS}}|{{REPO_NAME}}|{{MAP_VERSION}}|{{MERMAID_LIB}}',
    mermaidLib: '/*M*/',
  });
  it('accepts a colon placed after the bold label', () => {
    assert.ok(html.includes('<div class="call call-gotcha">'));
    assert.ok(html.includes('colon outside the bold.'));
  });
  it('ignores a bold lead-in with no colon (renders a normal blockquote)', () => {
    assert.ok(!/<div class="call[^"]*">(?:(?!<\/div>)[\s\S])*no colon at all/.test(html));
    assert.ok(/<blockquote>[\s\S]*no colon at all[\s\S]*<\/blockquote>/.test(html));
  });
});

const TLDR_SECTIONS = [
  { index: 1, title: 'Data flow', isCheckpoint: true, content:
    '> **TL;DR:** Orders write sync, fulfill async.\n\n' +
    'Body prose here.\n\n```mermaid\ngraph TD; A-->B;\n```' },
  { index: null, title: 'FAQ', isCheckpoint: false, content:
    '> **TL;DR:** should stay inline on the FAQ.' },
];

describe('TL;DR blurb', () => {
  const html = renderView({
    meta: { version: '1' }, sections: TLDR_SECTIONS,
    repoName: 'acme', template: '{{CHECKPOINTS}}|{{SECTIONS}}|{{REPO_NAME}}|{{MAP_VERSION}}|{{MERMAID_LIB}}',
    mermaidLib: '/*M*/',
  });

  it('lifts a checkpoint TL;DR into a .tldr block before the diagram', () => {
    assert.ok(html.includes('<div class="tldr">'));
    assert.ok(html.includes('Orders write sync, fulfill async.'));
    const tldrPos = html.indexOf('class="tldr"');
    const diagPos = html.indexOf('class="diagram"');
    const h2Pos = html.indexOf('</h2>');
    assert.ok(h2Pos < tldrPos && tldrPos < diagPos); // after title, before diagram
  });

  it('does not duplicate the TL;DR text as a blockquote in the body', () => {
    assert.ok(!/<blockquote>[\s\S]*Orders write sync[\s\S]*<\/blockquote>/.test(html));
  });

  it('does not lift TL;DR on a non-checkpoint (FAQ) section', () => {
    const faq = html.slice(html.indexOf('id="section-faq"'));
    assert.ok(!faq.includes('class="tldr"'));
    assert.ok(faq.includes('should stay inline on the FAQ.'));
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

describe('CRLF robustness', () => {
  it('parses a Windows (CRLF) map: frontmatter honored and mermaid extracted', () => {
    const dir = tmpdir();
    const mapPath = path.join(dir, 'map.md');
    const outPath = path.join(dir, 'learn-view.html');
    const crlf = [
      '---', 'generated_at: x', 'version: 9', 'target: .', '---', '',
      '## 1 · The big picture', 'Intro.', '```mermaid', 'graph TD; A-->B;', '```', '',
      '## FAQ', 'none', '',
    ].join('\r\n');
    fs.writeFileSync(mapPath, crlf);
    buildView({
      mapPath, outPath,
      templatePath: path.join(__dirname, '..', 'templates', 'view.html'),
      mermaidPath: path.join(__dirname, '..', 'vendor', 'mermaid.min.js'),
      repoName: 'crlf-demo',
    });
    const html = fs.readFileSync(outPath, 'utf8');
    assert.ok(html.includes('map v9'), 'frontmatter version parsed (not defaulted/leaked)');
    assert.ok(html.includes('id="section-1"'));
    assert.ok(html.includes('<div class="mermaid">graph TD; A--&gt;B;</div>'), 'mermaid extracted despite CRLF');
  });
});

describe('parseSections fenced-code safety', () => {
  it('does not treat a "## " line inside a code fence as a section', () => {
    const body = [
      '## 1 · Real', 'intro',
      '```bash', '## not a heading', 'echo hi', '```',
      'more text',
      '## 2 · Also real', 'stuff',
    ].join('\n');
    const s = parseSections(body);
    assert.strictEqual(s.length, 2);
    assert.strictEqual(s[0].index, 1);
    assert.strictEqual(s[1].index, 2);
    assert.ok(s[0].content.includes('## not a heading')); // stays inside section 1's content
  });
});

describe('CLI usage error', () => {
  it('exits non-zero with a usage message when args are missing', () => {
    let err = null;
    try {
      execFileSync('node', [path.join(__dirname, 'build-view.cjs')], { stdio: 'pipe' });
    } catch (e) { err = e; }
    assert.ok(err, 'expected a non-zero exit');
    assert.ok(String(err.stderr).includes('usage: build-view.cjs'));
  });
});
