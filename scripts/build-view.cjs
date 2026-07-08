const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

const CALLOUT_TYPES = {
  insight: { type: 'insight', icon: '💡', label: 'Insight' },
  why: { type: 'insight', icon: '💡', label: 'Insight' },
  note: { type: 'insight', icon: '💡', label: 'Insight' },
  gotcha: { type: 'gotcha', icon: '⚠️', label: 'Gotcha' },
  warning: { type: 'gotcha', icon: '⚠️', label: 'Gotcha' },
  'watch out': { type: 'gotcha', icon: '⚠️', label: 'Gotcha' },
  'where to look': { type: 'where', icon: '📍', label: 'Where to look' },
  where: { type: 'where', icon: '📍', label: 'Where to look' },
  files: { type: 'where', icon: '📍', label: 'Where to look' },
  'try this': { type: 'try', icon: '✅', label: 'Try this' },
  try: { type: 'try', icon: '✅', label: 'Try this' },
  exercise: { type: 'try', icon: '✅', label: 'Try this' },
};

// Matches a blockquote whose first inline is a bold label, e.g. "<p><strong>Gotcha:</strong> …".
const CALLOUT_LABEL_RE = /^\s*<p>\s*<strong>\s*([^<:]+?)\s*(?::\s*<\/strong>|<\/strong>\s*:)\s*/i;

// Turn a recognized labeled blockquote into a typed callout; return null to fall back.
function renderCallout(quote) {
  const m = CALLOUT_LABEL_RE.exec(quote);
  if (!m) return null;
  const t = CALLOUT_TYPES[m[1].trim().toLowerCase()];
  if (!t) return null;
  const body = quote.replace(CALLOUT_LABEL_RE, '<p>').trim();
  return (
    `<div class="call call-${t.type}">` +
    `<span class="ic" aria-hidden="true">${t.icon}</span>` +
    `<div><div class="lab">${t.label}</div><div class="bd">${body}</div></div>` +
    `</div>`
  );
}

// Trust model: the map is author-written and lands via the team's normal PR review,
// so we intentionally let marked pass raw HTML through (headings, prose, callouts,
// TL;DR). Plain text we interpolate ourselves (titles, repo name) is escaped via
// escapeHtml. This is not a defense against hostile map content.
marked.use({
  renderer: {
    blockquote(quote) {
      const callout = renderCallout(quote);
      return callout === null ? false : callout; // false → marked's default blockquote
    },
  },
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Token-safe replace (avoids $-substitution from String.replace).
function inject(tpl, token, val) {
  return tpl.split(token).join(val);
}

function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: md.slice(m[0].length).replace(/^\n+/, '') };
}

function parseSections(body) {
  // Find `## ` headings, but ignore any that fall inside a fenced code block
  // (``` or ~~~) — maps routinely contain code snippets.
  const lines = body.split('\n');
  const heads = [];
  let fence = null; // the fence char (` or ~) currently open, or null
  let offset = 0;
  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
    } else if (!fence) {
      const hm = /^##\s+(.*)$/.exec(line);
      if (hm) heads.push({ offset, lineLen: line.length, headingText: hm[1].trim() });
    }
    offset += line.length + 1; // +1 for the '\n' split removed
  }
  const sections = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].offset + heads[i].lineLen; // position of the '\n' after the heading
    const end = i + 1 < heads.length ? heads[i + 1].offset : body.length;
    const content = body.slice(start, end).trim();
    const numMatch = /^(\d+)\s*[·.\-:]\s*(.*)$/.exec(heads[i].headingText);
    if (numMatch) {
      sections.push({
        index: Number(numMatch[1]),
        title: numMatch[2].trim(),
        content,
        isCheckpoint: true,
      });
    } else {
      sections.push({ index: null, title: heads[i].headingText, content, isCheckpoint: false });
    }
  }
  return sections;
}

function extractMermaid(content) {
  const m = /```mermaid\n([\s\S]*?)```/.exec(content);
  return m ? m[1].trim() : null;
}

function renderCheckpointList(checkpoints) {
  return checkpoints
    .map((c) => (
      `<li class="cp" data-target="section-${c.index}" role="button" tabindex="0">` +
      `<span class="cp-pin" aria-hidden="true">${c.index}</span>` +
      `<span class="cp-text">${escapeHtml(c.title)}</span>` +
      `</li>`
    ))
    .join('\n');
}

// A leading blockquote line "> **TL;DR:** text" — lifted out and shown at the top.
const TLDR_RE = /^>\s*\*\*\s*TL;?DR\s*:?\s*\*\*\s*(.+)$/im;

function renderSections(sections) {
  const total = sections.filter((s) => s.isCheckpoint).length;
  let stop = 0; // 1-based position among checkpoints (robust to non-contiguous numbering)
  return sections
    .map((s) => {
      const id = s.isCheckpoint ? `section-${s.index}` : 'section-faq';
      const heading = s.isCheckpoint ? `${s.index} · ${s.title}` : s.title;
      const kicker = s.isCheckpoint ? `<div class="kicker">Stop ${++stop} of ${total}</div>` : '';
      const mer = extractMermaid(s.content);
      let bodyMd = s.content;
      let diagram = '';
      if (mer) {
        bodyMd = s.content.replace(/```mermaid\n[\s\S]*?```/, '').trim();
        diagram =
          `<div class="diagram">` +
          `<button class="diagram-zoom" type="button" aria-label="Zoom diagram">⤢</button>` +
          `<div class="mermaid">${escapeHtml(mer)}</div>` +
          `</div>`;
      }
      let tldr = '';
      if (s.isCheckpoint) {
        const tm = TLDR_RE.exec(bodyMd);
        if (tm) {
          tldr =
            `<div class="tldr"><span class="lab">TL;DR</span>` +
            `<div class="bd">${marked.parseInline(tm[1].trim())}</div></div>`;
          bodyMd = bodyMd.replace(tm[0], '').replace(/^\n+/, '').trim();
        }
      }
      return (
        `<section id="${id}" class="doc-section">` +
        kicker +
        `<h2>${escapeHtml(heading)}</h2>` +
        tldr +
        diagram +
        marked.parse(bodyMd) +
        `</section>`
      );
    })
    .join('\n');
}

function renderView({ meta, sections, repoName, template, mermaidLib }) {
  const checkpoints = sections.filter((s) => s.isCheckpoint);
  let html = template;
  html = inject(html, '{{REPO_NAME}}', escapeHtml(repoName || 'this repo'));
  html = inject(html, '{{MAP_VERSION}}', escapeHtml(String(meta.version ?? '1')));
  html = inject(html, '{{CHECKPOINTS}}', renderCheckpointList(checkpoints));
  html = inject(html, '{{SECTIONS}}', renderSections(sections));
  html = inject(html, '{{MERMAID_LIB}}', mermaidLib);
  return html;
}

function buildView({ mapPath, outPath, templatePath, mermaidPath, repoName }) {
  // Normalize CRLF → LF so Windows-authored maps parse (frontmatter, sections, diagrams
  // all assume '\n'). The map is committed/shared, so it may be edited on any platform.
  const md = fs.readFileSync(mapPath, 'utf8').replace(/\r\n/g, '\n');
  const { meta, body } = parseFrontmatter(md);
  const sections = parseSections(body);
  const template = fs.readFileSync(templatePath, 'utf8');
  const mermaidLib = fs.readFileSync(mermaidPath, 'utf8');
  const html = renderView({ meta, sections, repoName, template, mermaidLib });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return outPath;
}

module.exports = {
  escapeHtml, inject, parseFrontmatter, parseSections,
  extractMermaid, renderCheckpointList, renderSections, renderView, buildView,
};

if (require.main === module) {
  const [, , mapPath, outPath, repoName] = process.argv;
  if (!mapPath || !outPath) {
    console.error('usage: build-view.cjs <mapPath> <outPath> [repoName]');
    process.exit(1);
  }
  const root = path.resolve(__dirname, '..');
  const out = buildView({
    mapPath,
    outPath,
    templatePath: path.join(root, 'templates', 'view.html'),
    mermaidPath: path.join(root, 'vendor', 'mermaid.min.js'),
    repoName: repoName || path.basename(process.cwd()),
  });
  console.log('Built ' + out);
}
