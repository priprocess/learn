---
name: learn
description: Onboard onto an unfamiliar repository. Generates a committed onboarding map via parallel exploration, then runs a visual, resumable guided tour (a static HTML viewer for reading + terminal conversation for asking and advancing). Questions asked enrich the map for the next person. Use when someone wants to learn, get oriented in, or be walked through a new or unfamiliar codebase.
---

# Learn — Guided Repo Onboarding

You help a newcomer learn an unfamiliar repository. The experience is **visual-first
but server-less**: you render a static HTML viewer they read in a browser, while all
conversation happens here in the terminal. There is no running server.

## Paths and artifacts

Relative to the user's current repo (the "target repo"):

- **Map (committed, shared):** `docs/learn/map.md` by default. On the very first
  generation, ASK the user where to put it (offer `docs/learn/map.md`, repo root, or
  `.learn/`). Remember their answer by reading the file that exists on later runs.
- **Progress (local, per-person):** `.claude/learn-progress.json`
- **Viewer (local, disposable):** `.claude/learn-view.html`

The plugin's own files are under `${CLAUDE_PLUGIN_ROOT}` — notably the generator
`${CLAUDE_PLUGIN_ROOT}/scripts/build-view.cjs`.

Always ensure the two generated files are git-ignored in the target repo. If
`.gitignore` does not already contain them, append:

```
.claude/learn-progress.json
.claude/learn-view.html
```

## On invocation

1. Locate the map (check `docs/learn/map.md`, then `./map.md`, then `.learn/map.md`).
2. If in a git repo and a map exists, compute staleness:
   ```bash
   git -C "<target repo>" rev-list --count "<generated_at>..HEAD" 2>/dev/null
   ```
   Read `<generated_at>` from the map's frontmatter. If it is `unknown` or the
   command errors, skip the staleness hint.
3. Present the menu (below). With no map, only offer "Generate".

## The menu

Show this as terminal text:

```
📍 Learn · <repo name> · map @ <generated_at or "none">
   ⚠ N commits behind HEAD — architecture may have shifted   (only when stale)

  1) 🗺️  Generate / refresh the map
  2) 🧭  Take the guided tour
  3) 💬  Ask a question about this repo
```

The staleness line is advisory only — never auto-regenerate.

## Mode 1 — Generate / refresh

Goal: produce/update `map.md` with these sections (headings are exact; numbered ones
become tour checkpoints):

```
## 1 · The big picture
## 2 · Setup & dev loop
## 3 · Entry points & data flow
## 4 · Conventions & gotchas
## 5 · Good first tasks
## FAQ
```

Steps:

1. **Confirm scope:** the target path (repo root or a subpackage) and the map
   location (first run only).
2. **Seed cheaply (inline):** read `README*`, manifest/build files (`package.json`,
   `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, etc.), the top-level
   directory tree, and recent churn (`git log --oneline -20`, most-changed paths).
   Use this to list the major subsystems / top-level areas.
3. **Fan out exploration:** dispatch one subagent per major area using the Task tool
   (see superpowers:dispatching-parallel-agents). Cap concurrency to a reasonable
   number; if there are more areas than the cap, run in batches and **log any areas
   you did not cover** — never silently drop them. Each subagent returns structured
   findings:
   - area name, purpose, key files (with paths), entry points, important
     dependencies, and gotchas a newcomer would trip on.
4. **Synthesize** the findings into the six sections. In `## 1 · The big picture`,
   include a Mermaid diagram of how the major areas relate, as a fenced ```mermaid
   block. Keep `file:line`/`file` references concrete.
5. **Write the map** with frontmatter:
   ```
   ---
   generated_at: <current HEAD SHA, or "unknown" if not a git repo>
   version: <1 for first gen; previous version + 1 on refresh>
   target: <path mapped>
   ---
   ```
   On **refresh**, preserve the existing `## FAQ` section verbatim — never discard
   enrichment.
6. **Build and open the viewer** (see "Rendering the viewer"). Then offer the tour.

## Mode 2 — Guided tour

The browser shows the prepared material; you narrate and converse in the terminal.

1. Read the map and `.claude/learn-progress.json` (treat missing/`map_version`
   mismatch per "Edge cases").
2. **Render and open the viewer.**
3. Tell the user the viewer is open and which checkpoint they are on. First-timers
   start at section 1; returning users resume at `current`.
4. **Narrate the active section** in the terminal, pointing at the real files it
   references. Invite questions at any time (answer them live — see Mode 3).
5. When the user says "next"/"done", update progress (add to `completed`, advance
   `current`), then re-render the viewer so its checkpoint states refresh.
6. After the last **numbered** section, offer the **good first task**: pick a real
   starter change from `## 5 · Good first tasks` and coach them through it. This is
   optional — they may decline and finish.

## Mode 3 — Ask (and enrichment)

1. Answer the question **live, in the terminal**, grounded in the code and the map.
   Never defer questions to the end.
2. Judge whether the answer is **broadly useful** to future newcomers (not a
   one-off / personal question).
3. If broadly useful, ask: `Add this to the onboarding FAQ for the next person? [y/n]`
4. On **yes**, append to the map's `## FAQ` section a dated, attributed entry:
   ```
   **Q: <question>** — <date>, asked during onboarding
   <answer>
   ```
   Then print a one-line pointer, e.g. `→ added to FAQ in docs/learn/map.md`.
5. Do not commit. The edit rides the team's normal PR review (that review is the
   quality gate).

## Rendering the viewer

Build the self-contained HTML, then open it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-view.cjs" \
  "<map path>" ".claude/learn-progress.json" ".claude/learn-view.html" "<repo name>"
( command -v open >/dev/null && open ".claude/learn-view.html" ) \
  || ( command -v xdg-open >/dev/null && xdg-open ".claude/learn-view.html" ) \
  || echo "Open .claude/learn-view.html in your browser."
```

The generator reads progress (defaulting to section 1 if the file is missing) and
bakes the checkpoint states into the page. Re-run it whenever progress changes.

## Updating progress

Write `.claude/learn-progress.json` as the user advances:

```json
{ "completed": [1, 2], "current": 3, "map_version": 1 }
```

## Terminal fallback

If you cannot open a browser (headless), if `open`/`xdg-open` are absent, or if the
user prefers text: do everything in the terminal. The menu is a numbered list, the
checkpoint map is a text list with ✓/→/○, the diagram degrades to the prose in
`## 1 · The big picture`, and the enrichment prompt is a `[y/n]`. State is identical
(same map + progress file), so the user can switch surfaces anytime without losing
progress.

## Edge cases

- **Not a git repo:** skip staleness; write `generated_at: unknown`.
- **No map yet:** offer only Generate.
- **No progress file:** treat as a fresh learner (start at section 1).
- **`map_version` mismatch** (map refreshed since last visit): tell the user the map
  changed, keep completed sections that still exist, and otherwise reset progress
  cleanly. Update `map_version` in the progress file.
- **Monorepo / very large repo:** ask which package/path to map; cap subagents and
  log uncovered areas.
- **Map missing/garbled sections:** render whatever sections exist and suggest a
  refresh.
