# Browser checks

`audit.cjs` drives the real app in Chromium. It needs two packages that the app
itself does not use, so they are installed outside the repo:

```
npm install --prefix /tmp/97-audit playwright axe-core
npx --prefix /tmp/97-audit playwright install chromium
NODE_PATH=/tmp/97-audit/node_modules node tests/browser/audit.cjs
NODE_PATH=/tmp/97-audit/node_modules node tests/browser/motion.cjs
```

Add `--shots` to also save a screenshot of every screen and panel to
`tests/browser/out/` (ignored by git). Set `CHROMIUM=/path/to/chrome` to use a
browser that is already installed.

The audit checks the app with *Reduce motion* on, so every screen is in its
final state. `motion.cjs` checks the same app with animation on: that figures
count up to exactly what the still version shows (even when the screen redraws
mid-count), that entrances, scroll reveals, the intro, route changes and theme
changes all come to rest, and that a still screen does no work on every frame.

Both use the synthetic workspace in `tests/fixtures/workspace.json` and a fixed
date, with every network request blocked, so they are repeatable and never
touch real data.
