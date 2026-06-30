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
  const re = /^##\s+(.*)$/gm;
  const matches = [...body.matchAll(re)];
  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const headingText = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const content = body.slice(start, end).trim();
    const numMatch = /^(\d+)\s*[·.\-:]\s*(.*)$/.exec(headingText);
    if (numMatch) {
      sections.push({
        index: Number(numMatch[1]),
        title: numMatch[2].trim(),
        content,
        isCheckpoint: true,
      });
    } else {
      sections.push({ index: null, title: headingText, content, isCheckpoint: false });
    }
  }
  return sections;
}

function extractMermaid(content) {
  const m = /```mermaid\n([\s\S]*?)```/.exec(content);
  return m ? m[1].trim() : null;
}

function readProgress(progressPath) {
  try {
    const p = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    return {
      completed: Array.isArray(p.completed) ? p.completed : [],
      current: typeof p.current === 'number' ? p.current : 1,
      map_version: p.map_version ?? null,
    };
  } catch {
    return { completed: [], current: 1, map_version: null };
  }
}

function computeCheckpointStates(sections, progress) {
  return sections
    .filter((s) => s.isCheckpoint)
    .map((s) => {
      let state = 'upcoming';
      if (progress.completed.includes(s.index)) state = 'done';
      if (s.index === progress.current) state = 'current';
      return { index: s.index, title: s.title, state };
    });
}

function renderCheckpointList(states) {
  return states
    .map((c) => {
      const pin = c.state === 'done' ? '✓' : String(c.index);
      return (
        `<li class="cp cp-${c.state}" data-target="section-${c.index}" role="button" tabindex="0">` +
        `<span class="cp-pin" aria-hidden="true">${pin}</span>` +
        `<span class="cp-text">${escapeHtml(c.title)}</span>` +
        `</li>`
      );
    })
    .join('\n');
}

// A leading blockquote line "> **TL;DR:** text" — lifted out and shown at the top.
const TLDR_RE = /^>\s*\*\*\s*TL;?DR\s*:?\s*\*\*\s*(.+)$/im;

function renderSections(sections) {
  const total = sections.filter((s) => s.isCheckpoint).length;
  return sections
    .map((s) => {
      const id = s.isCheckpoint ? `section-${s.index}` : 'section-faq';
      const heading = s.isCheckpoint ? `${s.index} · ${s.title}` : s.title;
      const kicker = s.isCheckpoint ? `<div class="kicker">Stop ${s.index} of ${total}</div>` : '';
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

function renderView({ meta, sections, progress, repoName, template, mermaidLib }) {
  const states = computeCheckpointStates(sections, progress);
  let html = template;
  html = inject(html, '{{REPO_NAME}}', escapeHtml(repoName || 'this repo'));
  html = inject(html, '{{MAP_VERSION}}', escapeHtml(String(meta.version ?? '1')));
  html = inject(html, '{{CHECKPOINTS}}', renderCheckpointList(states));
  html = inject(html, '{{SECTIONS}}', renderSections(sections));
  html = inject(html, '{{MERMAID_LIB}}', mermaidLib);
  return html;
}

function buildView({ mapPath, progressPath, outPath, templatePath, mermaidPath, repoName }) {
  const md = fs.readFileSync(mapPath, 'utf8');
  const { meta, body } = parseFrontmatter(md);
  const sections = parseSections(body);
  const progress = readProgress(progressPath);
  const template = fs.readFileSync(templatePath, 'utf8');
  const mermaidLib = fs.readFileSync(mermaidPath, 'utf8');
  const html = renderView({ meta, sections, progress, repoName, template, mermaidLib });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
  return outPath;
}

module.exports = {
  escapeHtml, inject, parseFrontmatter, parseSections,
  extractMermaid, readProgress, computeCheckpointStates,
  renderCheckpointList, renderSections, renderView, buildView,
};

if (require.main === module) {
  const [, , mapPath, progressPath, outPath, repoName] = process.argv;
  if (!mapPath || !outPath) {
    console.error('usage: build-view.cjs <mapPath> <progressPath> <outPath> [repoName]');
    process.exit(1);
  }
  const root = path.resolve(__dirname, '..');
  const out = buildView({
    mapPath,
    progressPath: progressPath || '',
    outPath,
    templatePath: path.join(root, 'templates', 'view.html'),
    mermaidPath: path.join(root, 'vendor', 'mermaid.min.js'),
    repoName: repoName || path.basename(process.cwd()),
  });
  console.log('Built ' + out);
}
