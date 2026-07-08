# learn

A Claude Code plugin that helps you onboard onto an unfamiliar repository.

Run `/learn` to:

1. **Generate** a committed onboarding map (`docs/learn/map.md`) by exploring the
   repo in parallel — architecture, setup, entry points, conventions, first tasks.
2. **Tour** the repo: a self-contained HTML viewer (diagram + a clickable table of
   contents) opens in your browser while Claude narrates and answers questions in
   the terminal.
3. **Ask** anything about the repo. Broadly useful answers can be folded back into
   the map's FAQ for the next person (gated by your normal PR review).

The map is committed, shared documentation. The generated viewer
(`.claude/learn-view.html`) is local and git-ignored.

## Install

This repo is its own Claude Code plugin marketplace. In Claude Code:

```
/plugin marketplace add priprocess/learn
/plugin install learn@learn
```

Then run `/learn` in any repository you want to get oriented in.

To update later: `/plugin marketplace update learn`. If you previously installed
a local copy of this plugin, uninstall it first (via the `/plugin` menu) so the
marketplace version doesn't collide with it.

## How it works

- `skills/learn/SKILL.md` — the experience (menu + generate/tour/ask flows).
- `scripts/build-view.cjs` — turns `map.md` into one self-contained
  `learn-view.html` (Mermaid inlined; no server, no external requests).
- `templates/view.html` — the viewer shell.

## Development

```bash
npm install
npm test
```

## Requirements

Node.js ≥ 18.
