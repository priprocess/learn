const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');

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

const ICON = { done: '✓', current: '→', upcoming: '○' };

function renderCheckpointList(states) {
  return states
    .map(
      (c) =>
        `<li class="cp cp-${c.state}" data-target="section-${c.index}">` +
        `<span class="cp-icon">${ICON[c.state]}</span> ${c.index}. ${escapeHtml(c.title)}</li>`
    )
    .join('\n');
}

function renderSections(sections) {
  return sections
    .map((s) => {
      const id = s.isCheckpoint ? `section-${s.index}` : 'section-faq';
      const heading = s.isCheckpoint ? `${s.index} · ${s.title}` : s.title;
      const mer = extractMermaid(s.content);
      let bodyMd = s.content;
      let diagram = '';
      if (mer) {
        bodyMd = s.content.replace(/```mermaid\n[\s\S]*?```/, '').trim();
        diagram = `<div class="mermaid">${escapeHtml(mer)}</div>`;
      }
      return (
        `<section id="${id}" class="doc-section">` +
        `<h2>${escapeHtml(heading)}</h2>` +
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

module.exports = {
  escapeHtml, inject, parseFrontmatter, parseSections,
  extractMermaid, readProgress, computeCheckpointStates,
  renderCheckpointList, renderSections, renderView,
};
