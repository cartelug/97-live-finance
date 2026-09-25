# Browser checks

`audit.cjs` drives the real app in Chromium. It needs two packages that the app
itself does not use, so they are installed outside the repo:

```
npm install --prefix /tmp/97-audit playwright axe-core
npx --prefix /tmp/97-audit playwright install chromium
NODE_PATH=/tmp/97-audit/node_modules node tests/browser/audit.cjs
```

Add `--shots` to also save a screenshot of every screen and panel to
`tests/browser/out/` (ignored by git). Set `CHROMIUM=/path/to/chrome` to use a
browser that is already installed.

It uses the synthetic workspace in `tests/fixtures/workspace.json` and a fixed
date, with every network request blocked, so it is repeatable and never touches
real data.
