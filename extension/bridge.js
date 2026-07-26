/* 97 Sender — page bridge.
 * Injected on the 97 LIVE app page. Relays messages between the web page
 * (window.postMessage) and the extension background (chrome.runtime).
 * It is passive: it only ever reacts to messages whose source is "x97-wa-app",
 * so it does nothing on ordinary sites.
 */
(function () {
  var VERSION = "1.0.0";

  function announce() {
    window.postMessage({ source: "x97-wa-ext", type: "ready", version: VERSION }, "*");
  }

  // Tell the page the sender is available (covers both load orders).
  announce();

  // Page -> extension
  window.addEventListener("message", function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.source !== "x97-wa-app") return;

    if (d.type === "hello") { announce(); return; }

    if (d.type === "enqueue") {
      chrome.runtime.sendMessage({ type: "enqueue", jobs: d.jobs || [], safety: d.safety || {} }, function () { void chrome.runtime.lastError; });
      return;
    }
    if (d.type === "control") {
      chrome.runtime.sendMessage({ type: "control", action: d.action }, function () { void chrome.runtime.lastError; });
      return;
    }
  });

  // Extension -> page
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.channel !== "x97-progress") return;
    window.postMessage({ source: "x97-wa-ext", type: msg.type, id: msg.id, status: msg.status, detail: msg.detail }, "*");
  });
})();
