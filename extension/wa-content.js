/* 97 Sender — WhatsApp Web content script.
 *
 * Runs on every web.whatsapp.com load. When the background has queued a job and
 * navigated this tab to .../send?phone=…&text=…, this script waits for the chat
 * to open with the message prefilled, pauses a human moment, clicks Send, and
 * reports the result back to the background.
 *
 * WhatsApp Web's DOM is undocumented and changes over time. The selectors below
 * use several fallbacks and the most stable signals available (aria-labels,
 * data-icon, contenteditable composer). If WhatsApp ships a big redesign, the
 * SELECTORS block is the one place to adjust.
 */
(function () {
  if (window.__x97SenderRan) return;
  window.__x97SenderRan = true;

  var SELECTORS = {
    composer: [
      'div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"][data-tab]',
      'div[contenteditable="true"][data-testid="conversation-compose-box-input"]',
      'footer div[contenteditable="true"]'
    ],
    sendIcon: ['span[data-icon="send"]', 'span[data-icon="wds-ic-send-filled"]', 'button[aria-label="Send"]', 'button[data-testid="send"]'],
    invalidText: "phone number shared via url is invalid"
  };

  function q(list) { for (var i = 0; i < list.length; i++) { var el = document.querySelector(list[i]); if (el) return el; } return null; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(a, b) { return Math.floor(a + Math.random() * (b - a)); }

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 25000; interval = interval || 400;
    return new Promise(function (resolve) {
      var start = Date.now();
      (function loop() {
        var v; try { v = fn(); } catch (_) { v = null; }
        if (v) return resolve(v);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(loop, interval);
      })();
    });
  }

  function invalidNumberShown() {
    var nodes = document.querySelectorAll('[role="dialog"], [data-animate-modal-body], div');
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || "").toLowerCase();
      if (t.length < 200 && t.indexOf(SELECTORS.invalidText) >= 0) return true;
    }
    return false;
  }

  function composerText() {
    var c = q(SELECTORS.composer);
    return c ? (c.innerText || c.textContent || "").trim() : null;
  }

  function findSendButton() {
    for (var i = 0; i < SELECTORS.sendIcon.length; i++) {
      var el = document.querySelector(SELECTORS.sendIcon[i]);
      if (el) return el.closest("button") || el;
    }
    return null;
  }

  function report(id, status, detail) {
    try { chrome.runtime.sendMessage({ type: "job-result", id: id, status: status, detail: detail }, function () { void chrome.runtime.lastError; }); }
    catch (_) {}
  }

  function urlPhone() {
    try { return new URLSearchParams(location.search).get("phone") || ""; } catch (_) { return ""; }
  }

  async function run() {
    var resp = await new Promise(function (resolve) {
      try { chrome.runtime.sendMessage({ type: "get-current-job" }, function (r) { void chrome.runtime.lastError; resolve(r || {}); }); }
      catch (_) { resolve({}); }
    });
    var job = resp && resp.currentJob;
    if (!job) return;                                   // nothing queued — normal browsing

    // Only act if this navigation is the one for the queued job.
    var here = location.pathname.indexOf("/send") >= 0 || location.href.indexOf("/send") >= 0;
    if (!here) return;
    if (urlPhone() && job.phone && urlPhone().replace(/\D/g, "") !== String(job.phone).replace(/\D/g, "")) return;

    // Wait for either the chat to be ready (composer has our text) or an error.
    var ready = await waitFor(function () {
      if (invalidNumberShown()) return "invalid";
      var txt = composerText();
      if (txt && txt.length > 0) return "ready";
      // Some versions open the chat with an empty composer if the text failed to inject.
      var c = q(SELECTORS.composer);
      if (c && findSendButton()) return "ready-empty";
      return null;
    }, 30000, 500);

    if (ready === "invalid") { report(job.id, "skipped", "invalid-number"); return; }
    if (!ready) { report(job.id, "error", "chat-not-ready"); return; }

    // Human pause before sending.
    await sleep(rand(900, 2600));

    // Nudge the composer so the Send control is enabled, then find it.
    var composer = q(SELECTORS.composer);
    if (composer) {
      composer.focus();
      try { composer.dispatchEvent(new InputEvent("input", { bubbles: true })); } catch (_) {}
      await sleep(rand(250, 700));
    }

    var btn = await waitFor(findSendButton, 6000, 300);
    if (btn) {
      btn.click();
    } else if (composer) {
      // Fallback: press Enter in the composer.
      ["keydown", "keypress", "keyup"].forEach(function (type) {
        composer.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      });
    } else {
      report(job.id, "error", "no-send-button");
      return;
    }

    // Confirm: composer clears once the message is sent.
    var sent = await waitFor(function () { var t = composerText(); return (t !== null && t.length === 0) ? true : null; }, 9000, 400);
    report(job.id, sent ? "sent" : "error", sent ? "" : "unconfirmed");
  }

  // Give the SPA a moment to mount, then run.
  setTimeout(function () { run(); }, 1200);
})();
