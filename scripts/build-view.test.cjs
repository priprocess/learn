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
