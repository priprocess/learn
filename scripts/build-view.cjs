const fs = require('node:fs');
const path = require('node:path');

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

module.exports = {
  escapeHtml, inject, parseFrontmatter, parseSections,
  extractMermaid, readProgress, computeCheckpointStates,
};
