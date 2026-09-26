// Run with: node tests/browser/audit.cjs            (needs playwright and axe-core;
//           see tests/browser/README.md for the one-line setup)
//
// Opens every screen of the app at phone, tablet and desktop widths in both
// themes, with a fixed date and a synthetic workspace (tests/fixtures), and
// fails on:
//   · axe-core accessibility violations (contrast, names, roles, landmarks…)
//   · a page that scrolls sideways
//   · text cut off by its own box (money figures especially)
//   · text pushed off screen
//   · fixed or floating controls sitting on top of readable text
//   · touch targets smaller than 32×32 at phone width (WCAG 2.2 asks for 24)
//   · a bottom tab bar the end of the page can't scroll clear of
// Screens are also written to tests/browser/out/ for a human look.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const OUT = path.join(__dirname, 'out');
const DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/workspace.json'), 'utf8'));
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const ROUTES = ['home', 'incoming', 'credit', 'expenses', 'settings'];
// Sheets and panels, opened the way their buttons open them.
const DIALOGS = ['record-payment', 'add-upcoming', 'edit-upcoming:f1', 'mark-paid:f1', 'add-expense', 'edit-budgets', 'open-forecast', 'edit-balances', 'add-facility', 'borrow:c2', 'repay:' + (DOC.creditLoans[0] || {}).id, 'open-converter', 'open-earnings', 'open-exports', 'open-incoming-filters', 'open-templates', 'open-safety', 'open-numbers', 'open-messaging', 'open-reminders', 'open-campaigns', 'erase-data', 'cloud-panel', 'sign-in'];
const VIEWPORTS = [[390, 844], [820, 1180], [1280, 800]];
const SHOTS = process.argv.includes('--shots');

function inPage([phone, scope]) {
  const vw = document.documentElement.clientWidth;
  const out = { hscroll: document.documentElement.scrollWidth > vw + 1, clipped: [], offscreen: [], small: [], covered: [] };
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const shown = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  for (const el of document.querySelectorAll(scope)) {
    if (!shown(el)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    // An ellipsis on a long name is a choice; a cut-off amount is a bug.
    if (ownText(el) && el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX) && /\d/.test(el.textContent) && !/ellipsis/.test(cs.textOverflow)) out.clipped.push(name(el) + ' «' + el.textContent.trim().slice(0, 40) + '»');
    if (ownText(el) && (r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed' && !el.closest('.ic-hero-chips,.ic-month-row,.chips')) out.offscreen.push(name(el) + ' «' + el.textContent.trim().slice(0, 30) + '»');
    const interactive = el.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button]');
    // A control inside a <label> is hit anywhere on the label.
    if (phone && interactive && (r.width < 32 || r.height < 32) && !el.closest('label, .x97-ws-emoji')) out.small.push(name(el) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  // The bottom tab bar sits over content by design; what matters is that the
  // page can always scroll its last line clear of it.
  const tabs = document.querySelector('.tabs');
  if (scope.startsWith('#main') && tabs && getComputedStyle(tabs).position === 'fixed') {
    const last = [...document.querySelectorAll('#main *')].filter(shown).reduce((m, el) => Math.max(m, el.getBoundingClientRect().bottom + scrollY), 0);
    const room = document.documentElement.scrollHeight - last;
    if (room < tabs.getBoundingClientRect().height) out.covered.push('tab bar leaves only ' + Math.round(room) + 'px below the last line');
  }
  // Fixed layers painted behind the page (the ambient light) cover nothing.
  const floating = [...document.querySelectorAll('body *')].filter((el) => shown(el) && getComputedStyle(el).position === 'fixed' && !(parseInt(getComputedStyle(el).zIndex, 10) < 0) && !el.matches('.side,.tabs,.x97-back,.x97-remind-overlay,.s97-cloud-back,.s97-cloud-gate,.toasts'));
  if (scope.startsWith('#main')) for (const f of floating) {
    const fr = f.getBoundingClientRect();
    for (const el of document.querySelectorAll('#main *')) {
      if (f.contains(el) || !shown(el) || !ownText(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= innerHeight) continue;
      const ix = Math.max(0, Math.min(fr.right, r.right) - Math.max(fr.left, r.left)), iy = Math.max(0, Math.min(fr.bottom, r.bottom) - Math.max(fr.top, r.top));
      if (ix * iy > 40) out.covered.push(name(f) + ' covers ' + name(el));
    }
  }
  for (const k of ['clipped', 'offscreen', 'small', 'covered']) out[k] = [...new Set(out[k])];
  return out;
}

(async () => {
  if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const problems = [];
  for (const [w, h] of VIEWPORTS) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-09-23T10:00:00'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(/^(?!file:).*/, (r) => r.abort());
    await page.addInitScript(({ doc, theme }) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('ns97-finance-v1', JSON.stringify(doc));
      localStorage.setItem('ns97.v2.theme', theme);
    }, { doc: DOC, theme });
    for (const route of ROUTES) {
      await page.goto('file://' + ROOT + '/index.html#/' + route, { waitUntil: 'load' });
      await page.waitForTimeout(400);
      // No network here, so the sign-in screen would cover the app; the app is what is being checked.
      await page.evaluate(() => { const g = document.getElementById('s97-cloud-gate'); if (g) g.remove(); });
      const where = `${w}px ${theme} #/${route}`;
      const layout = await page.evaluate(inPage, [w < 700, '#main *, .side *']);
      if (layout.hscroll) problems.push(`${where}: page scrolls sideways`);
      for (const k of ['clipped', 'offscreen', 'small', 'covered']) for (const x of layout[k]) problems.push(`${where}: ${k} ${x}`);
      await page.evaluate(AXE);
      const axe = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ') + (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio ? ' (' + n.any[0].data.contrastRatio + ':1)' : '')) })));
      for (const v of axe) problems.push(`${where}: axe ${v.id} ×${v.nodes.length} — ${v.nodes.slice(0, 3).join(' | ')}`);
      if (SHOTS) await page.screenshot({ path: path.join(OUT, `${w}-${theme}-${route}.png`), fullPage: true });
    }
    for (const d of DIALOGS) {
      const [action, id] = d.split(':');
      await page.goto('file://' + ROOT + '/index.html#/' + (/budgets|expense/.test(action) ? 'expenses' : 'home'), { waitUntil: 'load' });
      await page.waitForTimeout(250);
      await page.evaluate(() => { const g = document.getElementById('s97-cloud-gate'); if (g) g.remove(); });
      await page.evaluate(([action, id]) => {
        document.querySelectorAll('#x97-sheet, .x97-remind-overlay, #s97-cloud-modal').forEach((el) => el.remove());
        if (action === 'cloud-panel') { document.getElementById('s97-cloud-status').click(); return; }
        if (action === 'sign-in') { location.hash = '#/home'; return; }
        const b = document.createElement('button'); b.dataset.x97Action = action; if (id) b.dataset.id = id; document.body.appendChild(b); b.click(); b.remove();
      }, [action, id]);
      if (action === 'sign-in') await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(400);
      const scope = await page.evaluate(() => ['#s97-cloud-gate', '#x97-sheet', '#x97-camp', '#x97-remind', '#x97-msg', '#s97-cloud-modal'].find((s) => document.querySelector(s)) || '');
      const where = `${w}px ${theme} ${d}`;
      if (!scope) { problems.push(`${where}: nothing opened`); continue; }
      const layout = await page.evaluate(inPage, [w < 700, scope + ' *']);
      for (const k of ['clipped', 'offscreen', 'small']) for (const x of layout[k]) problems.push(`${where}: ${k} ${x}`);
      await page.evaluate(AXE);
      const axe = await page.evaluate(async (scope) => (await window.axe.run(document.querySelector(scope), { resultTypes: ['violations'] })).violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(' ') + (n.any[0] && n.any[0].data && n.any[0].data.contrastRatio ? ' (' + n.any[0].data.contrastRatio + ':1)' : '')) })), scope);
      for (const v of axe) problems.push(`${where}: axe ${v.id} ×${v.nodes.length} — ${v.nodes.slice(0, 3).join(' | ')}`);
      if (SHOTS) await page.screenshot({ path: path.join(OUT, `${w}-${theme}-${action}.png`) });
    }
    for (const e of errors) problems.push(`${w}px ${theme}: script error ${e}`);
    await page.close();
  }
  await browser.close();
  if (problems.length) { console.log(problems.join('\n')); console.log(`\n${problems.length} problem(s)`); process.exit(1); }
  console.log(`PASS ${ROUTES.length} screens and ${DIALOGS.length} sheets/panels × ${VIEWPORTS.length} widths × 2 themes: no accessibility or layout problems`);
})().catch((e) => { console.error(e); process.exit(2); });
