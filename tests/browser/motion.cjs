// Run with: node tests/browser/motion.cjs           (needs playwright;
//           see tests/browser/README.md for the one-line setup)
//
// The app with motion ON, at phone and desktop width. Reduced motion is the
// reference (no animation, final values at once), and this fails when:
//   · a figure that counted up does not end on the value reduced motion shows,
//     including when the screen redraws mid-count (Incoming patches in place)
//   · anything the entrance animated is left faded, moved or blurred, or a
//     count-up leaves inline styles behind
//   · content revealed on scroll is still hidden once scrolled to
//   · the intro does not hand over by itself, or a tap does not skip it
//   · after a route change the tab highlight is not on the current tab
//   · a theme change or route change leaves its view-transition state behind
//   · a settled screen still does work on every frame (the moving light must
//     run on the compositor, so a still screen costs no battery)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/workspace.json'), 'utf8'));
const ROUTES = ['home', 'incoming', 'credit', 'expenses', 'settings'];
const COUNTS = '.hero-value, .hero-fig b, .forecast-text b, .stat-value.x97-money, .trio b, .budget-left b.x97-money, .ic-hero-value-main, .ic-hero-usd, .facility-avail b, .loan-figures b, .pipe-amt b, .x97-fx-value';
const fails = [];
let checks = 0;
function expect(ok, msg) { checks++; if (!ok) fails.push(msg); }

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  async function open(w, h, route, { reduced = false, intro = false, theme = 'light' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push(`${w}px #/${route}: script error ${e.message}`));
    await page.clock.setFixedTime(new Date('2026-09-23T10:00:00'));
    await page.route(/^(?!file:).*/, (r) => r.abort());
    await page.addInitScript(({ doc, intro, theme }) => {
      localStorage.setItem('ns97-finance-v1', JSON.stringify(doc));
      localStorage.setItem('ns97.v2.theme', theme);
      if (!intro) sessionStorage.setItem('ns97.v3.intro', '1');
      // No network here, so the sign-in screen would cover the app.
      setInterval(() => { const g = document.getElementById('s97-cloud-gate'); if (g) g.remove(); }, 50);
    }, { doc: DOC, intro, theme });
    await page.goto('file://' + ROOT + '/index.html#/' + route, { waitUntil: 'commit' });
    return { ctx, page };
  }
  const figures = (page) => page.evaluate((sel) => [...document.querySelectorAll('#main :is(' + sel + ')')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()), COUNTS);
  // Everything the entrance touched, on screen, must be back at rest.
  const atRest = (page) => page.evaluate((sel) => {
    const bad = [];
    document.querySelectorAll('#main [data-m]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || !r.width) return;
      const cs = getComputedStyle(el);
      const still = cs.transform === 'none' || cs.transform === 'matrix(1, 0, 0, 1, 0, 0)';
      if (Number(cs.opacity) < 0.99 || !still || cs.filter !== 'none') bad.push(`${el.getAttribute('data-m')} ${el.className} opacity=${cs.opacity} transform=${cs.transform} filter=${cs.filter}`);
    });
    document.querySelectorAll('#main :is(' + sel + ')').forEach((el) => {
      if (el.style.minWidth || el.style.display) bad.push(`count-up left style="${el.getAttribute('style')}" on ${el.className}`);
    });
    if (/vt-/.test(document.documentElement.className)) bad.push('view-transition class left on <html>: ' + document.documentElement.className);
    return bad;
  }, COUNTS);
  // Wait until every finite animation, count-up and view transition is done.
  async function settle(page, label, max = 12000) {
    const t0 = Date.now();
    for (;;) {
      const busy = await page.evaluate((sel) => {
        const running = document.getAnimations().filter((a) => a.playState === 'running' && a.timeline === document.timeline && a.effect.getComputedTiming().iterations !== Infinity && a.animationName !== 'brand-shine').length;
        const counting = [...document.querySelectorAll('#main :is(' + sel + ')')].filter((el) => el.style.minWidth).length;
        const vt = /vt-/.test(document.documentElement.className);
        const screen = !!document.querySelector('#main > .page, #main > .ic-shell');
        return !screen || running || counting || vt ? { running, counting, vt, screen } : null;
      }, COUNTS);
      if (!busy) return;
      if (Date.now() - t0 > max) { expect(false, `${label}: still moving after ${max}ms ${JSON.stringify(busy)}`); return; }
      await page.waitForTimeout(150);
    }
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const base = {};
    for (const route of ROUTES) {
      const { ctx, page } = await open(w, h, route, { reduced: true });
      await page.waitForSelector('#main > .page, #main > .ic-shell');
      await page.waitForTimeout(900);
      base[route] = await figures(page);
      await ctx.close();
    }

    for (const route of ROUTES) {
      const { ctx, page } = await open(w, h, route);
      // Redraw twice while the figures are still counting.
      await page.waitForTimeout(520);
      await page.evaluate(() => window.__x97v2 && window.__x97v2.render(0));
      await page.waitForTimeout(260);
      await page.evaluate(() => window.__x97v2 && window.__x97v2.render(0));
      await settle(page, `${w}px #/${route}`);
      const got = await figures(page);
      expect(same(got, base[route]), `${w}px #/${route}: figures ended on\n    ${JSON.stringify(got)}\n  not\n    ${JSON.stringify(base[route])}`);
      const bad = await atRest(page);
      expect(!bad.length, `${w}px #/${route}: not at rest after the entrance:\n    ${bad.join('\n    ')}`);
      if (await page.evaluate(() => document.querySelector('#main [data-m="scroll"]'))) {
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(700);
        const hidden = await page.evaluate(() => [...document.querySelectorAll('#main [data-m="scroll"]')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && r.top < innerHeight && Number(getComputedStyle(el).opacity) < 0.99;
        }).map((el) => el.className));
        expect(!hidden.length, `${w}px #/${route}: still hidden after scrolling to it: ${hidden.join(', ')}`);
      }
      // Still screen: nothing may restyle every frame (the logo shimmer runs a
      // few times after launch and is finished here to measure the rest).
      if (w === 390 && (route === 'home' || route === 'incoming')) {
        await page.evaluate(() => { scrollTo(0, 0); document.getAnimations().forEach((a) => { if (a.animationName === 'brand-shine') a.finish(); }); });
        await page.waitForTimeout(400);
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Performance.enable');
        const count = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'RecalcStyleCount').value;
        const before = await count();
        await page.waitForTimeout(3000);
        // An animation off the compositor restyles every frame (~180 in 3s);
        // the odd status update (sync retrying offline here) is a handful.
        const restyles = (await count()) - before;
        expect(restyles < 45, `${w}px #/${route}: a still screen restyled ${restyles} times in 3s — an always-on animation is not compositor-only`);
      }
      await ctx.close();
    }

    {
      const { ctx, page } = await open(w, h, 'home', { intro: true });
      await page.waitForSelector('#intro');
      await page.waitForTimeout(350);
      await page.mouse.click(w / 2, h / 2);
      const skipped = await page.waitForFunction(() => document.documentElement.getAttribute('data-intro') === 'done' && !document.getElementById('intro'), null, { timeout: 2000 }).then(() => true, () => false);
      expect(skipped, `${w}px: a tap did not skip the intro`);
      await ctx.close();
    }

    {
      const { ctx, page } = await open(w, h, 'home', { intro: true });
      await page.waitForTimeout(1500);
      await settle(page, `${w}px intro`);
      const intro = await page.evaluate(() => ({ state: document.documentElement.getAttribute('data-intro'), left: !!document.getElementById('intro') }));
      expect(intro.state === 'done' && !intro.left, `${w}px: the intro did not hand over (${JSON.stringify(intro)})`);
      expect(same(await figures(page), base.home), `${w}px Home after the intro: figures differ`);
      const bad = await atRest(page);
      expect(!bad.length, `${w}px Home after the intro: not at rest:\n    ${bad.join('\n    ')}`);

      for (const route of ['credit', 'incoming', 'home']) {
        await page.click(`.tab[data-route="${route}"]`);
        await page.waitForTimeout(200);
        await settle(page, `${w}px → #/${route}`);
        const got = await figures(page);
        expect(same(got, base[route]), `${w}px → #/${route}: figures ended on ${JSON.stringify(got)}, not ${JSON.stringify(base[route])}`);
        const b2 = await atRest(page);
        expect(!b2.length, `${w}px → #/${route}: not at rest:\n    ${b2.join('\n    ')}`);
        const off = await page.evaluate(() => {
          const g = document.querySelector('.tab-glider').getBoundingClientRect(), a = document.querySelector('.tab[aria-current="page"]').getBoundingClientRect();
          return Math.abs(g.left - a.left) + Math.abs(g.top - a.top) + Math.abs(g.width - a.width);
        });
        expect(off < 2, `${w}px → #/${route}: the tab highlight is ${off.toFixed(1)}px off the current tab`);
      }

      // Two tabs tapped in quick succession: the second transition cuts the
      // first short and everything still lands on the second screen.
      await page.click('.tab[data-route="credit"]');
      await page.waitForTimeout(40);
      await page.click('.tab[data-route="expenses"]');
      await page.waitForTimeout(200);
      await settle(page, `${w}px double tap`);
      const landed = await page.evaluate(() => ({ screen: document.body.getAttribute('data-screen'), tab: document.querySelector('.tab[aria-current="page"]').dataset.route }));
      expect(landed.screen === 'expenses' && landed.tab === 'expenses', `${w}px double tap landed on ${JSON.stringify(landed)}`);
      expect(same(await figures(page), base.expenses), `${w}px double tap: Expenses figures differ`);
      const b4 = await atRest(page);
      expect(!b4.length, `${w}px double tap: not at rest:\n    ${b4.join('\n    ')}`);

      const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.click('[data-x97-action="toggle-theme"]');
      await page.waitForTimeout(200);
      await settle(page, `${w}px theme change`);
      const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(before !== after, `${w}px: the theme button did not change the theme`);
      const b3 = await atRest(page);
      expect(!b3.length, `${w}px after a theme change: not at rest:\n    ${b3.join('\n    ')}`);
      await ctx.close();
    }
  }
  await browser.close();
  if (fails.length) { console.log(fails.join('\n')); console.log(`\n${fails.length} of ${checks} check(s) failed`); process.exit(1); }
  console.log(`PASS ${checks} motion checks: figures, entrances, scroll reveals, intro, route and theme transitions, idle cost`);
})().catch((e) => { console.error(e); process.exit(2); });
