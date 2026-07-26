/* 97 Sender — background orchestrator (MV3 service worker).
 *
 * Drives a queue of reminder jobs through an open WhatsApp Web tab, one at a
 * time, at a human pace with the safety rules chosen in the app. State lives in
 * chrome.storage.session and pacing uses chrome.alarms, so the run survives the
 * service worker being suspended between messages.
 */

const S = chrome.storage.session;

function today() { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
function rand(min, max) { return Math.floor(min + Math.random() * (max - min)); }

async function getState() { const o = await S.get("run"); return o.run || null; }
async function setState(run) { await S.set({ run }); }
async function clearState() { await S.remove("run"); }

async function appTabSend(appTabId, payload) {
  if (appTabId == null) return;
  try { await chrome.tabs.sendMessage(appTabId, Object.assign({ channel: "x97-progress" }, payload)); }
  catch (_) { /* app tab may have closed */ }
}

async function progress(run, id, status, detail) {
  await appTabSend(run.appTabId, { type: "progress", id, status, detail });
}

async function findWaTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  return tabs && tabs.length ? tabs[0] : null;
}

function withinQuietHours(safety) {
  // quiet hours are a "do not send" window, e.g. 21:00 -> 08:00
  if (!safety || !safety.quietStart || !safety.quietEnd) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = safety.quietStart.split(":").map(Number);
  const [eh, em] = safety.quietEnd.split(":").map(Number);
  const start = sh * 60 + sm, end = eh * 60 + em;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;          // same-day window
  return cur >= start || cur < end;                            // overnight window
}

async function dailyCount() { const o = await chrome.storage.local.get("sent"); const s = o.sent || {}; return s[today()] || 0; }
async function bumpDaily() { const o = await chrome.storage.local.get("sent"); const s = o.sent || {}; s[today()] = (s[today()] || 0) + 1; await chrome.storage.local.set({ sent: s }); }

function effectiveDelay(run) {
  let min = Math.max(5, run.safety.minDelay || 45);
  let max = Math.max(min + 5, run.safety.maxDelay || 120);
  if (run.safety.warmup) {                    // warm-up: slower for the first several sends of the day
    if (run.dailyBefore + run.done < 12) { min = Math.round(min * 1.6); max = Math.round(max * 1.6); }
  }
  return rand(min * 1000, max * 1000);
}

async function scheduleNext(ms) { await chrome.alarms.create("x97-next", { when: Date.now() + Math.max(1000, ms) }); }

async function startRun(jobs, safety, appTabId) {
  const wa = await findWaTab();
  const run = {
    jobs, safety, appTabId,
    waTabId: wa ? wa.id : null,
    idx: 0, done: 0, batchCount: 0, paused: false,
    dailyBefore: await dailyCount(),
    startedAt: Date.now()
  };
  await setState(run);

  if (!wa) {
    for (const j of jobs) await progress(run, j.id, "error", "no-wa-tab");
    await appTabSend(appTabId, { type: "done" });
    notify("WhatsApp Web is not open", "Open web.whatsapp.com in a tab and scan the QR, then send again.");
    await clearState();
    return;
  }
  await dispatch();
}

async function dispatch() {
  const run = await getState();
  if (!run || run.paused) return;

  if (run.idx >= run.jobs.length) { await finish(run); return; }

  // Daily cap
  const cap = run.safety.dailyCap || 40;
  if ((await dailyCount()) >= cap) {
    for (let i = run.idx; i < run.jobs.length; i++) await progress(run, run.jobs[i].id, "skipped", "daily-cap");
    notify("Daily cap reached", "Stopped to keep your number safe. The rest can go tomorrow.");
    await finish(run);
    return;
  }

  // Quiet hours — hold and re-check in 5 min
  if (withinQuietHours(run.safety)) {
    await appTabSend(run.appTabId, { type: "paused", detail: "quiet-hours" });
    await scheduleNext(5 * 60 * 1000);
    return;
  }

  // Batch break
  const batchSize = run.safety.batchSize || 8;
  if (run.batchCount >= batchSize) {
    run.batchCount = 0;
    await setState(run);
    const breakMs = Math.max(0, (run.safety.batchBreak || 10)) * 60 * 1000;
    if (breakMs > 0) { await scheduleNext(breakMs + rand(0, 20000)); return; }
  }

  const job = run.jobs[run.idx];
  const wa = await chrome.tabs.get(run.waTabId).catch(() => null);
  if (!wa) {
    const fresh = await findWaTab();
    if (!fresh) { await progress(run, job.id, "error", "no-wa-tab"); run.idx++; await setState(run); await scheduleNext(2000); return; }
    run.waTabId = fresh.id; await setState(run);
  }

  await progress(run, job.id, "sending");
  await S.set({ currentJob: { id: job.id, phone: job.phone, message: job.message, name: job.name, at: Date.now() } });

  const url = "https://web.whatsapp.com/send?phone=" + encodeURIComponent(job.phone) + "&text=" + encodeURIComponent(job.message);
  try { await chrome.tabs.update(run.waTabId, { url }); }
  catch (_) { await progress(run, job.id, "error", "tab-update-failed"); run.idx++; await setState(run); await scheduleNext(3000); return; }

  // Safety net: if the content script never reports back, move on after 90s.
  await chrome.alarms.create("x97-timeout", { when: Date.now() + 90000 });
}

async function onJobResult(id, status, detail) {
  await chrome.alarms.clear("x97-timeout");
  const run = await getState();
  if (!run) return;
  const job = run.jobs[run.idx];
  if (!job || String(job.id) !== String(id)) return;   // stale result

  await progress(run, id, status, detail);
  if (status === "sent") { await bumpDaily(); run.done++; run.batchCount++; }

  run.idx++;
  await setState(run);
  await S.remove("currentJob");

  if (run.idx >= run.jobs.length) { await finish(run); return; }
  await scheduleNext(effectiveDelay(run));
}

async function finish(run) {
  await appTabSend(run.appTabId, { type: "done", detail: { done: run.done, total: run.jobs.length } });
  notify("Reminders finished", run.done + " of " + run.jobs.length + " sent.");
  await S.remove("currentJob");
  await clearState();
  await chrome.alarms.clear("x97-next");
  await chrome.alarms.clear("x97-timeout");
}

function notify(title, message) {
  try { chrome.notifications.create({ type: "basic", iconUrl: "icons/icon-128.png", title, message }); }
  catch (_) { /* icon optional */ }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "x97-next") await dispatch();
  else if (alarm.name === "x97-timeout") await onJobResult((await S.get("currentJob")).currentJob?.id, "error", "timeout");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg) return;
    if (msg.type === "enqueue") {
      await startRun(msg.jobs || [], msg.safety || {}, sender.tab ? sender.tab.id : null);
      sendResponse({ ok: true });
    } else if (msg.type === "job-result") {
      await onJobResult(msg.id, msg.status, msg.detail);
      sendResponse({ ok: true });
    } else if (msg.type === "get-current-job") {
      const o = await S.get("currentJob");
      sendResponse({ currentJob: o.currentJob || null });
    } else if (msg.type === "control") {
      const run = await getState();
      if (run) {
        if (msg.action === "pause") { run.paused = true; await setState(run); await chrome.alarms.clear("x97-next"); }
        else if (msg.action === "resume") { run.paused = false; await setState(run); await dispatch(); }
        else if (msg.action === "stop") { await finish(run); }
      }
      sendResponse({ ok: true });
    } else if (msg.type === "status") {
      const run = await getState();
      sendResponse({ run, daily: await dailyCount() });
    }
  })();
  return true; // async response
});
