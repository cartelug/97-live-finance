/* 97 LIVE — Experience V2
   Additive UI upgrade for Dashboard, Upcoming and Credit.
   Uses the existing ns97-finance-v1 document so Supabase sync, backups and old records remain compatible.
*/
(function () {
  "use strict";

  if (window.__S97_EXPERIENCE_V2__) return;
  window.__S97_EXPERIENCE_V2__ = true;

  var VERSION = "experience-v2.1";
  var DATA_KEY = "ns97-finance-v1";
  var PREF_KEY = "ns97.v2.upcoming.filters";
  var REFRESH_KEY = "ns97.v2.react-refresh";
  var RESUME_KEY = "ns97.v2.resume-tab";
  var MANAGED = { dashboard: true, upcoming: true, credit: true };
  var root = null;
  var wrap = null;
  var hiddenChildren = [];
  var currentScreen = null;
  var lastRaw = "";
  var lastCloudStatus = "";
  var renderTimer = null;
  var searchTimer = null;
  var unavailableOpen = false;
  var needsReactRefresh = false;
  var modeActive = false;
  var remindExt = { ready: false, version: "", sending: false };
  var remindState = { open: false, mode: "onetap", tone: "auto", useAI: false, selected: {}, drafts: {}, showAll: false, progress: {} };
  var campaignState = { open: false, view: "home", mode: "onetap", editId: null, audience: { type: "list", id: "" }, message: "", previewIdx: 0, progress: {}, sending: false, runId: null, oneTapIdx: 0, antiblock: "balanced", showDetail: false, showVars: false, showEmoji: false, showPreview: false, showTemplates: false, dupRemoval: true, timestamp: false, countryCode: "", manualNumbers: "" };
  var ANTIBLOCK = {
    conservative: { label: "Conservative", min: 60, max: 180, batch: 5, brk: 15, note: "Safest · 60–180s between sends" },
    balanced: { label: "Balanced", min: 30, max: 90, batch: 8, brk: 10, note: "Recommended · 30–90s between sends" },
    fast: { label: "Fast", min: 8, max: 25, batch: 15, brk: 5, note: "Quick · 8–25s between sends" }
  };
  var EMOJIS = ["😀","😁","😅","😂","🙂","😉","😍","😘","😎","🤩","🥳","🙏","👍","👌","👏","🙌","💪","🔥","✨","🎉","💯","✅","❗","❓","⚠️","💰","💸","🧾","📅","⏰","📌","📞","📱","💬","➡️","👉","❤️","🧡","💚","💙","🙏🏾","😊","😄","🤝","🎬","🎥","📸","🌟"];

  var state = {
    upcoming: {
      view: "list",
      quick: "all",
      month: "all",
      search: "",
      statuses: [],
      currencies: [],
      categories: [],
      from: "",
      to: "",
      minAmount: "",
      maxAmount: "",
      sort: "urgency"
    },
    creditView: "available"
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function attr(value) { return esc(value).replace(/`/g, "&#96;"); }

  function num(value) {
    if (typeof value === "number") return isFinite(value) ? value : 0;
    var parsed = parseFloat(String(value == null ? "" : value).replace(/,/g, ""));
    return isFinite(parsed) ? parsed : 0;
  }

  function roundMoney(value) { return Math.round(num(value)); }

  function money(value, currency, compact) {
    var amount = num(value);
    var abs = Math.abs(amount);
    var text;
    if (compact && abs >= 1000000000) text = (amount / 1000000000).toFixed(abs >= 10000000000 ? 1 : 2).replace(/\.0+$/, "") + "B";
    else if (compact && abs >= 1000000) text = (amount / 1000000).toFixed(abs >= 10000000 ? 1 : 2).replace(/\.0+$/, "") + "M";
    else if (compact && abs >= 1000) text = (amount / 1000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0+$/, "") + "K";
    else text = Math.round(amount).toLocaleString();
    return (currency ? currency + " " : "") + text;
  }

  function pct(value) {
    var v = num(value);
    return (v * 100).toFixed(v * 100 % 1 ? 1 : 0) + "%";
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function uid(prefix) {
    if (window.crypto && crypto.randomUUID) return (prefix || "id") + "-" + crypto.randomUUID();
    return (prefix || "id") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  function parseLocalDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
    var p = String(value).split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2], 12, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  function dateISO(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function todayDate() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  }

  function todayISO() { return dateISO(todayDate()); }

  function addDays(value, days) {
    var d = value instanceof Date ? new Date(value) : parseLocalDate(value);
    if (!d) d = todayDate();
    d.setDate(d.getDate() + Number(days || 0));
    return d;
  }

  function daysBetween(from, to) {
    var a = from instanceof Date ? from : parseLocalDate(from);
    var b = to instanceof Date ? to : parseLocalDate(to);
    if (!a || !b) return null;
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function monthKey(value) {
    var d = value instanceof Date ? value : parseLocalDate(value);
    if (!d) return "";
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function monthDate(key) {
    if (!/^\d{4}-\d{2}$/.test(String(key))) return null;
    var p = String(key).split("-").map(Number);
    return new Date(p[0], p[1] - 1, 1, 12, 0, 0, 0);
  }

  function monthLabel(key, short) {
    var d = monthDate(key);
    if (!d) return key === "unscheduled" ? "Unscheduled" : "All months";
    return d.toLocaleDateString(undefined, { month: short ? "short" : "long", year: "numeric" });
  }

  function formatDate(value, short) {
    var d = parseLocalDate(value);
    if (!d) return "No date";
    return d.toLocaleDateString(undefined, short ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  }

  function relDay(value) {
    var d = parseLocalDate(value);
    if (!d) return "";
    var t = todayDate();
    t.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    var diff = Math.round((d - t) / 86400000);
    return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff < 0 ? -diff + "d ago" : "in " + diff + "d";
  }

  function startOfMonth(date) {
    var d = date instanceof Date ? date : todayDate();
    return new Date(d.getFullYear(), d.getMonth(), 1, 12, 0, 0, 0);
  }

  function endOfMonth(date) {
    var d = date instanceof Date ? date : todayDate();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0, 0);
  }

  function normalizeStatus(status) { return String(status || "Pending").trim(); }
  function isPaid(status) { return /^(paid|received|repaid)$/i.test(normalizeStatus(status)); }
  function isCancelled(status) { return /cancel/i.test(normalizeStatus(status)); }
  function isOpenFollowup(item) { return !isPaid(item.status) && !isCancelled(item.status); }

  function readDoc() {
    var raw = "";
    try { raw = localStorage.getItem(DATA_KEY) || ""; } catch (_) {}
    var doc;
    try { doc = JSON.parse(raw); } catch (_) { doc = null; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
    if (!doc.meta || typeof doc.meta !== "object") doc.meta = { appName: "97 LIVE", usdRate: 0 };
    if (!Array.isArray(doc.followups)) doc.followups = [];
    if (!Array.isArray(doc.balances)) doc.balances = [];
    if (!Array.isArray(doc.credit)) doc.credit = [];
    if (!doc.expenses || typeof doc.expenses !== "object") doc.expenses = { entries: [], personalBudget: 0, businessBudget: 0, personalCeiling: 0, businessCeiling: 0, monthStart: dateISO(startOfMonth(todayDate())) };
    if (!Array.isArray(doc.expenses.entries)) doc.expenses.entries = [];
    if (!doc.settings || typeof doc.settings !== "object") doc.settings = {};
    if (!Array.isArray(doc.creditLoans)) doc.creditLoans = [];
    return doc;
  }

  function writeDoc(doc, reason) {
    if (!doc) return;
    var value = JSON.stringify(doc);
    try { localStorage.setItem(DATA_KEY, value); } catch (err) { toast("Could not save on this device", "error"); return; }
    lastRaw = value;
    needsReactRefresh = true;
    try { sessionStorage.setItem(REFRESH_KEY, "1"); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("s97:v2-data-change", { detail: { reason: reason || "update" } })); } catch (_) {}
    scheduleRender(0);
    toast("Saved · syncing to cloud", "success");
  }

  function updateDoc(mutator, reason) {
    var doc = readDoc();
    if (!doc) { toast("Finance data is not ready yet", "error"); return false; }
    mutator(doc);
    writeDoc(doc, reason);
    return true;
  }

  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
      if (saved && typeof saved === "object") {
        Object.keys(state.upcoming).forEach(function (key) {
          if (saved[key] !== undefined) state.upcoming[key] = saved[key];
        });
      }
    } catch (_) {}
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(state.upcoming)); } catch (_) {}
  }

  function icon(name, size) {
    size = size || 18;
    var paths = {
      search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.6-3.6"></path>',
      filter: '<path d="M4 6h16M7 12h10M10 18h4"></path>',
      plus: '<path d="M12 5v14M5 12h14"></path>',
      chevron: '<path d="m9 18 6-6-6-6"></path>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path>',
      clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
      alert: '<path d="M10.3 3.6 2.5 17a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"></path><path d="M12 9v4M12 17h.01"></path>',
      wallet: '<path d="M4 6a2 2 0 0 1 2-2h13v16H6a2 2 0 0 1-2-2V6Z"></path><path d="M4 8h15M15 12h4"></path>',
      credit: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18M7 15h3"></path>',
      check: '<path d="m5 12 4 4L19 6"></path>',
      edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path>',
      trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5"></path>',
      close: '<path d="m6 6 12 12M18 6 6 18"></path>',
      arrow: '<path d="M5 12h14M13 6l6 6-6 6"></path>',
      bank: '<path d="m3 10 9-6 9 6"></path><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"></path>',
      user: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
      more: '<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>',
      trend: '<path d="m3 17 6-6 4 4 8-9"></path><path d="M15 6h6v6"></path>',
      list: '<path d="M8 6h13M8 12h13M8 18h13"></path><circle cx="4" cy="6" r="1"></circle><circle cx="4" cy="12" r="1"></circle><circle cx="4" cy="18" r="1"></circle>',
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
      message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12Z"></path>',
      phone: '<path d="M6.6 3H10l2 5-2.5 1.5a11 11 0 0 0 5 5L16 11l5 2v3.4a2 2 0 0 1-2.2 2A16 16 0 0 1 4.6 5.2 2 2 0 0 1 6.6 3Z"></path>',
      shield: '<path d="M12 3l7 3v6c0 5-3.5 7.6-7 9-3.5-1.4-7-4-7-9V6l7-3Z"></path>',
      bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"></path>',
      send: '<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7Z"></path>'
    };
    return '<svg aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.more) + '</svg>';
  }

  function brandMark(size, cls) {
    return '<img src="icons/mark-97.png" width="' + (size || 18) + '" height="' + (size || 18) + '" alt="" class="x97-brand-mark' + (cls ? " " + cls : "") + '">';
  }

  function brandFor(name) {
    var n = String(name || "").toLowerCase();
    if (n.indexOf("airtel") >= 0) return { key: "airtel", label: "Airtel" };
    if (n.indexOf("mtn") >= 0 || n.indexOf("momo") >= 0) return { key: "mtn", label: "MTN" };
    if (n.indexOf("equity") >= 0) return { key: "equity", label: "Equity" };
    return null;
  }
  function accountIconBox(name) {
    var b = brandFor(name);
    if (b) return '<div class="x97-row-icon x97-brand ' + b.key + '" role="img" aria-label="' + attr(b.label) + '"></div>';
    return '<div class="x97-row-icon good">' + icon("bank") + '</div>';
  }

  function injectCSS() {
    if (document.getElementById("x97-v2-css")) return;
    var style = document.createElement("style");
    style.id = "x97-v2-css";
    style.textContent = `
      body.x97-v2-mode{overflow-x:hidden}
      body.x97-v2-mode .wrap{max-width:1040px!important;background:var(--bg)!important}
      body.x97-v2-mode .navin{max-width:1040px!important}
      #x97-v2-root{display:none;min-height:100vh;color:var(--tx);font-family:var(--fu);padding:18px 16px calc(132px + env(safe-area-inset-bottom));position:relative;z-index:10;background:radial-gradient(80% 45% at 50% -8%,rgba(14,117,72,.06),transparent 66%),var(--bg)}
      #x97-v2-root.on{display:block}
      .x97-page{max-width:1000px;margin:0 auto;animation:x97-in .32s cubic-bezier(.22,1,.36,1) both}
      @keyframes x97-in{from{opacity:.3;transform:translateY(8px)}to{opacity:1;transform:none}}
      .x97-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:6px 0 20px}
      .x97-eyebrow{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;line-height:1;text-transform:uppercase;letter-spacing:.16em;font-weight:800;color:var(--pos);margin-bottom:8px}
      .x97-eyebrow::before{content:"";width:15px;height:2px;border-radius:99px;background:linear-gradient(90deg,var(--pos),rgba(14,117,72,.15))}
      .x97-title{margin:0;color:var(--tx);font-size:30px;line-height:1.04;font-weight:800;letter-spacing:-.045em;font-family:var(--fu)}
      .x97-sub{margin:7px 0 0;color:var(--tx2);font-size:13px;line-height:1.5}
      .x97-cloud{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 10px;font-size:11px;font-weight:700;color:var(--tx2);box-shadow:var(--elev-1)}
      .x97-cloud i{width:8px;height:8px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px var(--warndim)}
      .x97-cloud.online i{background:var(--pos);box-shadow:0 0 0 3px var(--posdim)}
      .x97-cloud.error i,.x97-cloud.offline i{background:var(--neg);box-shadow:0 0 0 3px var(--negdim)}
      .x97-card{background:linear-gradient(180deg,var(--card) 0%,var(--bg2) 135%);border:1px solid var(--line);border-radius:22px;box-shadow:var(--toplit),var(--elev-1);transition:border-color .2s ease,box-shadow .24s ease,transform .24s cubic-bezier(.22,1,.36,1)}
      @media(hover:hover){button.x97-card:hover,.x97-card.x97-item:hover{border-color:var(--line2);box-shadow:var(--toplit),var(--elev-2);transform:translateY(-2px)}}
      .x97-pad{padding:18px}
      .x97-section{margin-top:20px}
      .x97-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 11px}
      .x97-section-title{display:inline-flex;align-items:center;gap:9px;font-size:12px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:var(--tx)}
      .x97-section-title::before{content:"";width:5px;height:15px;border-radius:99px;background:linear-gradient(180deg,#17A468,var(--pos2));box-shadow:0 1px 6px rgba(14,117,72,.35)}
      .x97-link{border:1px solid var(--line);background:var(--card);color:var(--pos);font-size:11.5px;font-weight:800;padding:8px 13px;border-radius:999px;display:inline-flex;align-items:center;gap:5px;box-shadow:var(--toplit),var(--elev-1);transition:transform .16s ease,border-color .16s ease,box-shadow .2s ease;cursor:pointer}
      @media(hover:hover){.x97-link:hover{border-color:rgba(14,117,72,.35);box-shadow:var(--toplit),var(--elev-2);transform:translateY(-1px)}}
      .x97-link:active{transform:scale(.95)}
      .x97-money{font-family:var(--fnum)!important;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"tnum";letter-spacing:-.02em;font-weight:700}
      .x97-hero{padding:24px 22px 22px;background:linear-gradient(150deg,#FFFFFF 18%,#F4FAF6 62%,#ECF6F0 100%);position:relative;overflow:hidden}
      .x97-hero::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--pos),#17A468 45%,rgba(23,164,104,0) 90%);opacity:.9}
      .x97-hero:after{content:"";position:absolute;width:270px;height:270px;border-radius:50%;right:-120px;top:-145px;background:radial-gradient(circle,rgba(14,117,72,.14),transparent 65%)}
      .x97-hero-label{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:var(--pos);background:var(--posdim);padding:6px 11px;border-radius:999px;position:relative;z-index:1}
      .x97-hero-label::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--pos);animation:x97-pulse 2.4s ease-in-out infinite}
      @keyframes x97-pulse{0%,100%{box-shadow:0 0 0 3px rgba(14,117,72,.18)}50%{box-shadow:0 0 0 6px rgba(14,117,72,.06)}}
      @media(prefers-reduced-motion:reduce){.x97-hero-label::before{animation:none}}
      .x97-hero-value{font-size:clamp(36px,8vw,52px);line-height:1;margin:14px 0 18px;color:var(--tx);position:relative;z-index:1;font-weight:700;letter-spacing:-.035em}
      .x97-hero-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;position:relative;z-index:1}
      .x97-stat{background:rgba(255,255,255,.74);backdrop-filter:blur(4px);border:1px solid var(--line);border-radius:15px;padding:12px 13px;box-shadow:var(--toplit)}
      .x97-stat span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx3);font-weight:800;margin-bottom:6px}
      .x97-stat b{font-size:15px;color:var(--tx);font-weight:700;font-variant-numeric:tabular-nums;font-feature-settings:"tnum";letter-spacing:-.02em}
      .x97-grid{display:grid;gap:14px}
      .x97-grid-2{grid-template-columns:1fr}
      .x97-pipeline{grid-template-columns:1fr;gap:11px}
      .x97-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .x97-summary{padding:15px 14px;min-height:96px;position:relative;overflow:hidden}
      .x97-summary::after{content:"";position:absolute;right:-26px;top:-26px;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle,rgba(14,117,72,.07),transparent 70%)}
      .x97-summary .k{font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;font-weight:800;color:var(--tx3)}
      .x97-summary .v{font-size:24px;line-height:1.05;margin-top:10px;color:var(--tx);letter-spacing:-.02em}
      .x97-summary .s{font-size:10.5px;color:var(--tx3);margin-top:7px;font-weight:600}
      .x97-teal{color:var(--usd)!important}.x97-green{color:var(--pos)!important}.x97-red{color:var(--neg)!important}.x97-amber{color:var(--warn)!important}
      .x97-row{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}
      .x97-row:last-child{border-bottom:0}
      .x97-row-icon{width:40px;height:40px;border-radius:13px;background:var(--card2);display:grid;place-items:center;color:var(--tx2);flex:0 0 auto;box-shadow:inset 0 1px 0 rgba(255,255,255,.5)}
      .x97-row-icon.good{background:var(--posdim);color:var(--pos)}.x97-row-icon.warn{background:var(--warndim);color:var(--warn)}.x97-row-icon.bad{background:var(--negdim);color:var(--neg)}.x97-row-icon.usd{background:var(--usddim);color:var(--usd)}
      .x97-row-main{min-width:0;flex:1}.x97-row-title{font-size:13.5px;font-weight:750;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x97-row-sub{font-size:11.5px;color:var(--tx3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x97-row-value{text-align:right;font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
      .x97-empty{padding:30px 18px;text-align:center;color:var(--tx3)}.x97-empty strong{display:block;color:var(--tx);font-size:15px;margin:8px 0 5px}.x97-empty p{font-size:12px;line-height:1.5;margin:0}
      .x97-segment{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:4px;gap:3px;margin-bottom:13px}
      .x97-segment button{border:0;border-radius:10px;background:transparent;color:var(--tx3);font-size:12px;font-weight:800;min-height:38px;display:flex;align-items:center;justify-content:center;gap:6px}
      .x97-segment button.on{background:var(--card);color:var(--pos);box-shadow:var(--toplit),0 3px 10px rgba(23,27,18,.1)}
      .x97-tools{display:flex;gap:8px;align-items:center;margin-bottom:10px}
      .x97-search{flex:1;min-width:0;position:relative}.x97-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--tx3)}.x97-search input{width:100%;height:44px;border:1px solid var(--line2);background:var(--card);border-radius:13px;padding:0 12px 0 39px;color:var(--tx);outline:0;font-size:13px}.x97-search input:focus{border-color:var(--pos);box-shadow:var(--ring)}
      .x97-icon-btn{height:44px;min-width:44px;padding:0 12px;border-radius:13px;border:1px solid var(--line2);background:var(--card);color:var(--tx2);display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:12px;font-weight:750;position:relative}
      .x97-badge-count{position:absolute;right:-4px;top:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--pos);color:#fff;font-size:10px;display:grid;place-items:center;border:2px solid var(--bg)}
      .x97-chips{display:flex;gap:7px;overflow-x:auto;padding:2px 1px 9px;scrollbar-width:none}.x97-chips::-webkit-scrollbar{display:none}
      .x97-chip{white-space:nowrap;height:34px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--tx2);padding:0 12px;font-size:11.5px;font-weight:750;display:inline-flex;align-items:center;gap:6px}.x97-chip.on{background:var(--posdim);border-color:rgba(14,117,72,.25);color:var(--pos)}.x97-chip.alert.on{background:var(--negdim);border-color:rgba(181,53,46,.22);color:var(--neg)}
      .x97-contact-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.x97-contact-chips:empty{margin-top:0}.x97-contact-chip{height:auto;padding:6px 10px;border-style:dashed}.x97-contact-chip.on{border-style:solid}
      .x97-contact-chips.scroll{max-height:220px;overflow-y:auto;padding-right:2px;align-content:flex-start}
      .x97-more{margin-top:6px;border-top:1px dashed var(--line2);padding-top:12px}
      .x97-more-summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:var(--pos);user-select:none}
      .x97-more-summary::-webkit-details-marker{display:none}.x97-more-summary::marker{content:""}
      .x97-more-summary svg{transition:transform .15s}
      .x97-more[open] .x97-more-summary svg{transform:rotate(90deg)}
      .x97-more-body{margin-top:12px}
      .x97-more:not([open]) .x97-more-body{display:none}
      .x97-active-filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.x97-filter-tag{border:0;background:var(--card2);color:var(--tx2);border-radius:999px;padding:6px 9px;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;gap:4px}
      .x97-count{font-size:11px;color:var(--tx3);margin:5px 2px 10px}
      .x97-group{margin:18px 0 9px;display:flex;justify-content:space-between;align-items:center}.x97-group b{display:inline-flex;align-items:center;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--tx)}.x97-group b::before{content:"";width:4px;height:12px;border-radius:99px;background:linear-gradient(180deg,#17A468,var(--pos2))}.x97-group span{font-size:10.5px;color:var(--tx3)}
      .x97-item{padding:15px 16px;margin-bottom:9px;cursor:pointer;transition:transform .12s,border-color .15s}.x97-item:active{transform:scale(.985)}
      .x97-item-top{display:flex;gap:10px;align-items:flex-start}.x97-item-main{flex:1;min-width:0}.x97-item-title{font-size:14px;line-height:1.3;font-weight:800;color:var(--tx);overflow:hidden;text-overflow:ellipsis}.x97-item-category{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:750;margin-bottom:4px}.x97-item-amount{text-align:right;font-size:17px;white-space:nowrap}.x97-item-foot{margin-top:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.x97-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:6px 8px;font-size:10.5px;font-weight:750;background:var(--card2);color:var(--tx2)}.x97-pill.good{background:var(--posdim);color:var(--pos)}.x97-pill.warn{background:var(--warndim);color:var(--warn)}.x97-pill.bad{background:var(--negdim);color:var(--neg)}.x97-pill.usd{background:var(--usddim);color:var(--usd)}
      .x97-item-actions{margin-left:auto;display:flex;gap:5px}.x97-mini{border:1px solid var(--line);background:var(--card);color:var(--tx2);border-radius:9px;height:30px;padding:0 9px;font-size:10.5px;font-weight:750}
      .x97-month-card{padding:17px;margin-bottom:10px;cursor:pointer}.x97-month-head{display:flex;justify-content:space-between;align-items:start;gap:10px}.x97-month-title{font-size:15px;font-weight:850;color:var(--tx)}.x97-month-count{font-size:10.5px;color:var(--tx3);margin-top:4px}.x97-month-money{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.x97-month-money div{background:var(--card2);border-radius:12px;padding:10px}.x97-month-money span{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:800}.x97-month-money b{display:block;margin-top:5px;font-size:16px;font-variant-numeric:tabular-nums}
      .x97-progress{height:7px;background:var(--card3);border-radius:99px;overflow:hidden;margin-top:12px}.x97-progress i{display:block;height:100%;background:var(--pos);border-radius:inherit}
      .x97-btn{border:1px solid var(--line2);background:linear-gradient(180deg,var(--card),var(--bg2));color:var(--tx);border-radius:13px;min-height:42px;padding:0 15px;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;gap:7px;box-shadow:var(--toplit),0 1px 2px rgba(23,27,18,.05);transition:transform .14s ease,box-shadow .18s ease,border-color .18s ease;cursor:pointer}
      @media(hover:hover){.x97-btn:hover{box-shadow:var(--toplit),var(--elev-2)}}
      .x97-btn.primary{border:0;background:linear-gradient(180deg,#128A56 0%,var(--pos2) 100%);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),0 10px 22px -10px rgba(11,103,64,.65)}.x97-btn.danger{color:var(--neg);border-color:rgba(181,53,46,.3);background:var(--negdim)}.x97-btn.teal{color:var(--usd);border-color:rgba(11,114,133,.25);background:var(--usddim)}.x97-btn:active{transform:scale(.97)}
      .x97-fab{position:fixed;right:max(16px,calc(50% - 488px));bottom:calc(78px + env(safe-area-inset-bottom));z-index:54;width:56px;height:56px;border:0;border-radius:50%;background:linear-gradient(180deg,#0F8552,var(--pos2));color:white;display:grid;place-items:center;box-shadow:0 14px 30px -9px rgba(11,103,64,.65)}
      .x97-network{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:900;font-size:11px;color:#fff;flex:0 0 auto}.x97-network.airtel{background:#D72B2B}.x97-network.mtn{background:#F7C900;color:#171B12}.x97-network.other{background:var(--usd)}
      .x97-facility{padding:15px;margin-bottom:9px}.x97-facility-head{display:flex;gap:11px;align-items:start}.x97-facility-main{min-width:0;flex:1}.x97-facility-title{font-size:14px;font-weight:850}.x97-facility-sub{font-size:11px;color:var(--tx3);margin-top:3px}.x97-facility-limit{text-align:right}.x97-facility-limit b{display:block;font-size:16px}.x97-facility-limit span{font-size:9.5px;color:var(--tx3);text-transform:uppercase;font-weight:800}.x97-facility-actions{display:flex;gap:7px;margin-top:13px}.x97-facility-actions .x97-btn{flex:1}
      .x97-loan{padding:16px;margin-bottom:10px;border-left:4px solid var(--warn)}.x97-loan.overdue{border-left-color:var(--neg)}.x97-loan-head{display:flex;justify-content:space-between;gap:12px}.x97-loan h3{font-size:14px;margin:0}.x97-loan .due{font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.06em;color:var(--warn)}.x97-loan.overdue .due{color:var(--neg)}.x97-loan-amount{font-size:26px;margin:12px 0 3px}.x97-loan-meta{font-size:11px;color:var(--tx3);line-height:1.6}
      .x97-back{position:fixed;inset:0;z-index:1200;background:rgba(23,27,18,.42);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;padding:0}.x97-sheet{width:100%;max-width:560px;max-height:94vh;background:var(--bg2);border:1px solid var(--line);border-radius:26px 26px 0 0;box-shadow:0 -28px 70px rgba(23,27,18,.24);display:flex;flex-direction:column;animation:x97-sheet .28s cubic-bezier(.22,1,.36,1)}@keyframes x97-sheet{from{transform:translateY(24px);opacity:.5}to{transform:none;opacity:1}}
      .x97-sheet-head{padding:10px 17px 13px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}.x97-handle{position:absolute;left:50%;transform:translateX(-50%);top:7px;width:38px;height:4px;background:var(--line2);border-radius:99px}.x97-sheet-head h2{font-size:18px;letter-spacing:-.02em;margin:9px 0 0;flex:1}.x97-close{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card2);display:grid;place-items:center;margin-top:7px}.x97-sheet-body{padding:17px;overflow:auto}.x97-sheet-foot{padding:12px 17px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--line);display:flex;gap:9px;background:rgba(251,251,248,.96)}.x97-sheet-foot .x97-btn{flex:1}
      .x97-field{margin-bottom:14px}.x97-field label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx2);font-weight:800;margin:0 0 6px}.x97-input,.x97-select,.x97-textarea{width:100%;min-height:44px;border:1px solid var(--line2);border-radius:12px;background:var(--card);color:var(--tx);padding:10px 12px;font-size:13px;outline:0}.x97-textarea{min-height:82px;resize:vertical}.x97-input:focus,.x97-select:focus,.x97-textarea:focus{border-color:var(--pos);box-shadow:var(--ring)}.x97-fields-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.x97-help{font-size:10.5px;color:var(--tx3);line-height:1.5;margin-top:5px}.x97-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.x97-check{display:flex;gap:8px;align-items:center;padding:10px;background:var(--card);border:1px solid var(--line);border-radius:11px;font-size:12px;font-weight:700}.x97-check input{accent-color:var(--pos)}
      .x97-preview{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:13px;margin-top:8px}.x97-preview-row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:12px}.x97-preview-row span{color:var(--tx3)}.x97-preview-row b{font-variant-numeric:tabular-nums}.x97-preview-row.total{border-top:1px solid var(--line);margin-top:6px;padding-top:10px;font-size:14px}
      .x97-toast-wrap{position:fixed;z-index:2000;left:50%;bottom:calc(142px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(430px,calc(100% - 28px));pointer-events:none}.x97-toast{background:#171B12;color:#fff;border-radius:13px;padding:11px 13px;font-size:12px;font-weight:700;box-shadow:0 15px 35px rgba(23,27,18,.28);animation:x97-toast .25s ease both}.x97-toast.success{background:#0B6740}.x97-toast.error{background:#9E2D27}@keyframes x97-toast{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media(min-width:760px){#x97-v2-root{padding:26px 24px 110px}.x97-grid-2{grid-template-columns:1fr 1fr}.x97-summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.x97-dashboard-main>section:not(.x97-dashboard-wide) .x97-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.x97-pipeline{grid-template-columns:repeat(3,minmax(0,1fr))}.x97-dashboard-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:18px;align-items:start}.x97-dashboard-wide{grid-column:1/-1}.x97-sheet{border-radius:26px;margin:20px}.x97-back{align-items:center;padding:16px}.x97-fab{right:max(24px,calc(50% - 488px))}.x97-hero{padding:28px 26px 24px}.x97-hero-meta{max-width:520px}}
      @media(min-width:1040px){#x97-v2-root{padding:34px 28px 120px}.x97-title{font-size:34px}.x97-hero-value{font-size:56px}.x97-section{margin-top:24px}.x97-dashboard-main{gap:20px}.x97-pad{padding:20px}}
      @media(max-width:560px){.x97-top{align-items:center;margin:4px 0 16px}.x97-title{font-size:25px}.x97-cloud{padding:7px 9px}.x97-cloud span{display:none}.x97-hero{padding:20px 18px}.x97-hero-value{font-size:clamp(34px,10.5vw,42px);margin:12px 0 16px}.x97-fields-2{grid-template-columns:1fr}.x97-checks{grid-template-columns:1fr 1fr}.x97-fab{right:16px}.x97-item-actions{width:100%;margin-left:0}.x97-item-actions .x97-mini{flex:1}.x97-summary{min-height:88px;padding:13px 12px}.x97-summary .v{font-size:21px}.x97-section{margin-top:17px}}

      /* ===== Provider brand logos (MTN / Airtel / Equity) ===== */
      .x97-network.airtel,.x97-network.mtn,.x97-network.equity,.x97-row-icon.x97-brand{background-color:#fff;background-repeat:no-repeat;background-position:center;color:transparent;font-size:0;border:1px solid var(--line);box-shadow:inset 0 1px 2px rgba(23,27,18,.06);overflow:hidden}
      .x97-network.airtel,.x97-row-icon.x97-brand.airtel{background-image:url(./icons/brand/airtel.png);background-size:82%}
      .x97-network.mtn,.x97-row-icon.x97-brand.mtn{background-image:url(./icons/brand/mtn.jpg);background-size:cover}
      .x97-network.equity,.x97-row-icon.x97-brand.equity{background-image:url(./icons/brand/equity.png);background-size:80%}

      /* ===== Home "Next 7 days" timeline ===== */
      .x97-timeline{display:flex;flex-direction:column;margin-top:4px}
      .x97-tl-row{display:flex;align-items:center;gap:13px;width:100%;padding:10px 6px;border:0;border-bottom:1px solid var(--line);background:transparent;text-align:left;border-radius:12px;transition:background .15s ease;cursor:pointer}
      .x97-tl-row:last-child{border-bottom:0}
      @media(hover:hover){.x97-tl-row:hover{background:var(--card2)}}
      .x97-tl-row:active{background:var(--card2)}
      .x97-tl-date{flex:0 0 auto;width:48px;height:54px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--card2);border:1px solid var(--line)}
      .x97-tl-day{font-size:21px;line-height:1;color:var(--tx)}
      .x97-tl-mon{font-size:9px;font-weight:800;letter-spacing:.12em;color:var(--tx3);margin-top:3px}
      .x97-tl-row.in .x97-tl-date{background:var(--posdim);border-color:transparent}
      .x97-tl-row.in .x97-tl-day{color:var(--pos)}
      .x97-tl-row.usd .x97-tl-date{background:var(--usddim);border-color:transparent}
      .x97-tl-row.usd .x97-tl-day{color:var(--usd)}
      .x97-tl-row.out .x97-tl-date{background:var(--negdim);border-color:transparent}
      .x97-tl-row.out .x97-tl-day{color:var(--neg)}
      .x97-tl-body{flex:1;min-width:0}
      .x97-tl-title{font-size:13.5px;font-weight:650;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .x97-tl-sub{font-size:11px;color:var(--tx3);margin-top:4px;display:flex;align-items:center;gap:7px}
      .x97-tl-dir{font-weight:800;font-size:9px;letter-spacing:.07em;padding:2px 7px;border-radius:99px}
      .x97-tl-row.in .x97-tl-dir{color:var(--pos);background:var(--posdim)}
      .x97-tl-row.usd .x97-tl-dir{color:var(--usd);background:var(--usddim)}
      .x97-tl-row.out .x97-tl-dir{color:var(--neg);background:var(--negdim)}
      .x97-tl-amt{flex:0 0 auto;font-size:14.5px;white-space:nowrap}
      .x97-tl-row.in .x97-tl-amt{color:var(--pos)}
      .x97-tl-row.usd .x97-tl-amt{color:var(--usd)}
      .x97-tl-row.out .x97-tl-amt{color:var(--neg)}
    `;
    document.head.appendChild(style);
  }

  function toast(message, kind) {
    var holder = document.querySelector(".x97-toast-wrap");
    if (!holder) {
      holder = document.createElement("div");
      holder.className = "x97-toast-wrap";
      document.body.appendChild(holder);
    }
    holder.innerHTML = '<div class="x97-toast ' + esc(kind || "") + '">' + esc(message) + '</div>';
    clearTimeout(holder._timer);
    holder._timer = setTimeout(function () { if (holder) holder.innerHTML = ""; }, 2600);
  }

  function cloudState() {
    try { return typeof window.__s97cloud === "function" ? window.__s97cloud() : null; } catch (_) { return null; }
  }

  function cloudPill() {
    var c = cloudState();
    var status = c && c.status ? c.status : "loading";
    var text = status === "online" ? "Saved" : status === "saving" ? "Saving" : status === "offline" ? "Offline" : status === "error" ? "Attention" : "Connecting";
    return '<div id="x97-cloud-pill" class="x97-cloud ' + esc(status) + '"><i></i><span>' + esc(text) + '</span></div>';
  }

  function updateCloudPill() {
    var el = document.getElementById("x97-cloud-pill");
    if (!el) return;
    var c = cloudState();
    var status = c && c.status ? c.status : "loading";
    var key = status + "|" + (c && c.version || "");
    if (key === lastCloudStatus) return;
    lastCloudStatus = key;
    var text = status === "online" ? "Saved" : status === "saving" ? "Saving" : status === "offline" ? "Offline" : status === "error" ? "Attention" : "Connecting";
    el.className = "x97-cloud " + status;
    var span = el.querySelector("span"); if (span) span.textContent = text;
  }

  function pageHeader(kicker, title, subtitle, actionHTML) {
    return '<header class="x97-top"><div><div class="x97-eyebrow">' + esc(kicker) + '</div><h1 class="x97-title">' + esc(title) + '</h1>' + (subtitle ? '<p class="x97-sub">' + esc(subtitle) + '</p>' : '') + '</div><div style="display:flex;gap:8px;align-items:center">' + (actionHTML || '') + cloudPill() + '</div></header>';
  }

  function sectionHead(title, actionText, action) {
    return '<div class="x97-section-head"><div class="x97-section-title">' + esc(title) + '</div>' + (actionText ? '<button class="x97-link" data-x97-action="' + attr(action) + '">' + esc(actionText) + icon("chevron", 14) + '</button>' : '') + '</div>';
  }

  function activeScreen() {
    var active = document.querySelector(".navitem.on") || document.querySelector(".navitem[aria-current='page']");
    if (!active) return null;
    var text = (active.textContent || "").trim().toLowerCase();
    if (/dashboard|home/.test(text)) return "dashboard";
    if (/follow|incoming|upcoming|receivable/.test(text)) return "upcoming";
    if (/credit|loan/.test(text)) return "credit";
    return null;
  }

  function findNavItem(screenOrText) {
    var items = Array.prototype.slice.call(document.querySelectorAll(".navitem"));
    return items.find(function (item) {
      var text = (item.textContent || "").trim().toLowerCase();
      if (screenOrText === "dashboard") return /dashboard|home/.test(text);
      if (screenOrText === "upcoming") return /follow|incoming|upcoming|receivable/.test(text);
      if (screenOrText === "credit") return /credit|loan/.test(text);
      return text.indexOf(String(screenOrText || "").toLowerCase()) >= 0;
    });
  }

  function ensureRoot() {
    wrap = document.querySelector(".wrap");
    if (!wrap) return false;
    root = document.getElementById("x97-v2-root");
    if (!root) {
      root = document.createElement("main");
      root.id = "x97-v2-root";
      wrap.insertBefore(root, wrap.firstChild);
    }
    return true;
  }

  function directChildFor(node, ancestor) {
    if (!node || !ancestor || !ancestor.contains(node)) return null;
    var current = node;
    while (current.parentElement && current.parentElement !== ancestor) current = current.parentElement;
    return current.parentElement === ancestor ? current : null;
  }

  function hideOriginalChildren() {
    var nav = document.querySelector(".nav");
    var keepNav = directChildFor(nav, wrap);
    Array.prototype.slice.call(wrap.children).forEach(function (child) {
      if (child === root || child === keepNav) return;
      var known = hiddenChildren.some(function (entry) { return entry.node === child; });
      if (!known) hiddenChildren.push({ node: child, display: child.style.display });
      child.style.display = "none";
    });
  }

  function enterManagedMode() {
    if (!ensureRoot()) return;
    modeActive = true;
    document.body.classList.add("x97-v2-mode");
    root.classList.add("on");
    hideOriginalChildren();
  }

  function exitManagedMode() {
    if (!modeActive) { currentScreen = null; return; }
    modeActive = false;
    document.body.classList.remove("x97-v2-mode");
    if (root) root.classList.remove("on");
    hiddenChildren.forEach(function (entry) { if (entry.node) entry.node.style.display = entry.display || ""; });
    hiddenChildren = [];
    currentScreen = null;
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay == null ? 40 : delay);
  }

  function syncMode() {
    var screen = activeScreen();
    if (screen && MANAGED[screen]) {
      enterManagedMode();
      if (screen !== currentScreen) { currentScreen = screen; window.scrollTo(0, 0); }
      scheduleRender(0);
    } else exitManagedMode();
  }

  function timing(item) {
    if (isPaid(item.status)) return { key: "paid", label: "Paid", cls: "good", days: null };
    if (isCancelled(item.status)) return { key: "cancelled", label: "Cancelled", cls: "", days: null };
    if (!item.expectedBy) return { key: "unscheduled", label: "Unscheduled", cls: "warn", days: null };
    var days = daysBetween(todayDate(), parseLocalDate(item.expectedBy));
    if (days < 0) return { key: "overdue", label: Math.abs(days) + (Math.abs(days) === 1 ? " day overdue" : " days overdue"), cls: "bad", days: days };
    if (days === 0) return { key: "today", label: "Due today", cls: "bad", days: 0 };
    if (days <= 4) return { key: "very-soon", label: "Due in " + days + " days", cls: "warn", days: days };
    if (days <= 11) return { key: "soon", label: "Due in " + days + " days", cls: "warn", days: days };
    return { key: "later", label: "Due in " + days + " days", cls: "", days: days };
  }

  function expenseStats(doc) {
    var e = doc.expenses || {};
    var current = monthKey(todayDate());
    var entries = (e.entries || []).filter(function (x) { return !x.date || monthKey(x.date) === current; });
    function sum(type, kind) {
      return entries.filter(function (x) { return String(x.type).toLowerCase() === type.toLowerCase() && String(x.kind).toLowerCase() === kind.toLowerCase(); }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    }
    var pp = sum("Personal", "Planned"), pa = sum("Personal", "Actual");
    var bp = sum("Business", "Planned"), ba = sum("Business", "Actual");
    return {
      personalPlanned: pp, personalActual: pa, businessPlanned: bp, businessActual: ba,
      personalSafe: num(e.personalBudget) - pp - pa,
      businessSafe: num(e.businessBudget) - bp - ba,
      personalBudget: num(e.personalBudget), businessBudget: num(e.businessBudget)
    };
  }

  function facilityById(doc, id) { return (doc.credit || []).find(function (f) { return String(f.id) === String(id); }); }

  function isFacilityLive(facility) {
    var status = String(facility && facility.status || "").trim().toLowerCase();
    return status === "live" || status === "available" || status === "active";
  }

  function dueDateForLoan(loan) {
    if (loan.dueDate) return loan.dueDate;
    return dateISO(addDays(loan.borrowDate || todayISO(), num(loan.termDaysSnapshot || loan.termDays || 30)));
  }

  function estimateLoan(loan, asOf) {
    var principal = num(loan.principal != null ? loan.principal : loan.borrowed);
    var model = String(loan.feeModelSnapshot || loan.feeModel || "Fixed fee").toLowerCase();
    var base = num(loan.baseFeeSnapshot != null ? loan.baseFeeSnapshot : loan.baseFee);
    var daily = num(loan.dailyRateSnapshot != null ? loan.dailyRateSnapshot : loan.dailyRate);
    var term = Math.max(0, num(loan.termDaysSnapshot || loan.termDays || 30));
    var manual = num(loan.manualDue);
    if (model.indexOf("manual") >= 0 && manual > 0) return manual;
    if (model.indexOf("daily") >= 0) {
      var borrow = parseLocalDate(loan.borrowDate) || todayDate();
      var target = asOf ? (parseLocalDate(asOf) || todayDate()) : addDays(borrow, term);
      var days = Math.max(0, daysBetween(borrow, target));
      return roundMoney(principal * (1 + base + daily * days));
    }
    return roundMoney(principal * (1 + base));
  }

  function virtualLegacyLoans(doc) {
    var loans = Array.isArray(doc.creditLoans) ? doc.creditLoans.slice() : [];
    var facilities = doc.credit || [];
    facilities.forEach(function (f) {
      if (num(f.borrowed) <= 0 || !f.borrowDate) return;
      var exists = loans.some(function (l) { return String(l.facilityId) === String(f.id) && !/repaid|cancel/i.test(String(l.status)); });
      if (exists) return;
      loans.push({
        id: "legacy-" + f.id,
        facilityId: f.id,
        principal: num(f.borrowed),
        borrowDate: f.borrowDate,
        dueDate: dateISO(addDays(f.borrowDate, num(f.termDays || 30))),
        feeModelSnapshot: f.feeModel,
        baseFeeSnapshot: num(f.baseFee),
        dailyRateSnapshot: num(f.dailyRate),
        termDaysSnapshot: num(f.termDays || 30),
        manualDue: num(f.manualDue),
        status: "Active",
        legacy: true,
        notes: f.notes || ""
      });
    });
    return loans;
  }

  function isActiveLoan(loan) { return !/repaid|cancel/i.test(String(loan.status || "Active")); }

  function analytics(doc) {
    var balances = doc.balances || [];
    var cash = balances.reduce(function (a, b) { return a + num(b.balance); }, 0);
    var loans = virtualLegacyLoans(doc);
    var activeLoans = loans.filter(isActiveLoan);
    var debt = activeLoans.reduce(function (a, loan) { return a + estimateLoan(loan, todayISO()); }, 0);
    var open = (doc.followups || []).filter(isOpenFollowup);
    var overdue = open.filter(function (x) { var t = timing(x); return t.key === "overdue"; });
    var next7 = open.filter(function (x) { var t = timing(x); return t.days != null && t.days >= 0 && t.days <= 7; });
    var currentMonth = monthKey(todayDate());
    var thisMonth = open.filter(function (x) { return monthKey(x.expectedBy) === currentMonth; });
    var ugxMonth = thisMonth.filter(function (x) { return String(x.currency).toUpperCase() !== "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var usdMonth = thisMonth.filter(function (x) { return String(x.currency).toUpperCase() === "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var creditAvailable = (doc.credit || []).filter(isFacilityLive).reduce(function (a, f) {
      var borrowed = activeLoans.filter(function (l) { return String(l.facilityId) === String(f.id); }).reduce(function (s, l) { return s + num(l.principal); }, 0);
      return a + Math.max(0, num(f.limitOffer) - borrowed);
    }, 0);
    return { cash: cash, loans: loans, activeLoans: activeLoans, debt: debt, open: open, overdue: overdue, next7: next7, ugxMonth: ugxMonth, usdMonth: usdMonth, creditAvailable: creditAvailable, expenses: expenseStats(doc) };
  }

  function dashboardAttention(doc, a) {
    var items = [];
    if (a.overdue.length) items.push({ type: "bad", title: a.overdue.length + " overdue incoming payment" + (a.overdue.length === 1 ? "" : "s"), sub: "Open Upcoming to follow up", nav: "upcoming" });
    var overdueLoans = a.activeLoans.filter(function (l) { return daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))) < 0; });
    if (overdueLoans.length) items.push({ type: "bad", title: overdueLoans.length + " overdue credit repayment" + (overdueLoans.length === 1 ? "" : "s"), sub: "Review active borrowing", nav: "credit" });
    var soonLoans = a.activeLoans.filter(function (l) { var d = daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))); return d >= 0 && d <= 4; });
    if (soonLoans.length) items.push({ type: "warn", title: soonLoans.length + " repayment" + (soonLoans.length === 1 ? "" : "s") + " due soon", sub: "Due within four days", nav: "credit" });
    if (a.next7.length) items.push({ type: "warn", title: a.next7.length + " incoming payment" + (a.next7.length === 1 ? "" : "s") + " due in 7 days", sub: "Review dates and clients", nav: "upcoming" });
    if (a.expenses.personalSafe < 0) items.push({ type: "bad", title: "Personal budget is overcommitted", sub: money(Math.abs(a.expenses.personalSafe), "UGX") + " above the safe amount", nav: "expenses" });
    if (a.expenses.businessSafe < 0) items.push({ type: "bad", title: "Business budget is overcommitted", sub: money(Math.abs(a.expenses.businessSafe), "UGX") + " above the safe amount", nav: "expenses" });
    var unscheduled = a.open.filter(function (x) { return !x.expectedBy; }).length;
    if (unscheduled) items.push({ type: "warn", title: unscheduled + " incoming item" + (unscheduled === 1 ? " needs" : "s need") + " a date", sub: "Set an expected payment date", nav: "upcoming" });
    return items.slice(0, 4);
  }

  function timeline(doc, a) {
    var out = [];
    a.open.forEach(function (x) {
      var t = timing(x);
      if (t.days != null && t.days >= 0 && t.days <= 7) out.push({ date: x.expectedBy, title: x.client || "Incoming payment", amount: num(x.amount), currency: x.currency || "UGX", direction: "in", source: "upcoming", id: x.id });
    });
    (doc.expenses.entries || []).forEach(function (x) {
      if (String(x.kind).toLowerCase() !== "planned") return;
      var days = daysBetween(todayDate(), parseLocalDate(x.date));
      if (days != null && days >= 0 && days <= 7) out.push({ date: x.date, title: x.item || "Planned expense", amount: num(x.amount), currency: "UGX", direction: "out", source: "expenses", id: x.id });
    });
    a.activeLoans.forEach(function (loan) {
      var due = dueDateForLoan(loan), days = daysBetween(todayDate(), parseLocalDate(due));
      var f = facilityById(doc, loan.facilityId);
      if (days != null && days >= 0 && days <= 7) out.push({ date: due, title: (f ? f.service : "Credit") + " repayment", amount: estimateLoan(loan, due), currency: "UGX", direction: "out", source: "credit", id: loan.id });
    });
    return out.sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); });
  }

  function monthSummary(doc, key) {
    var records = (doc.followups || []).filter(function (x) { return key === "unscheduled" ? !x.expectedBy : monthKey(x.expectedBy) === key; });
    var pending = records.filter(isOpenFollowup);
    var paid = records.filter(function (x) { return isPaid(x.status); });
    var ugx = pending.filter(function (x) { return String(x.currency).toUpperCase() !== "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var usd = pending.filter(function (x) { return String(x.currency).toUpperCase() === "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var paidAmount = paid.reduce(function (a, x) { return a + num(x.amount); }, 0);
    var attention = pending.filter(function (x) { var t = timing(x); return t.key === "overdue" || t.key === "today" || t.key === "very-soon" || !x.expectedBy || num(x.amount) <= 0; }).length;
    return { key: key, records: records, pending: pending, paid: paid, ugx: ugx, usd: usd, paidAmount: paidAmount, attention: attention };
  }

  function renderDashboard(doc) {
    var a = analytics(doc);
    var attention = dashboardAttention(doc, a);
    var events = timeline(doc, a);
    var in7 = events.filter(function (x) { return x.direction === "in" && String(x.currency).toUpperCase() !== "USD"; }).reduce(function (s, x) { return s + x.amount; }, 0);
    var out7 = events.filter(function (x) { return x.direction === "out"; }).reduce(function (s, x) { return s + x.amount; }, 0);
    var months = [0, 1, 2].map(function (offset) { var d = startOfMonth(todayDate()); d.setMonth(d.getMonth() + offset); return monthKey(d); });
    var accountRows = (doc.balances || []).map(function (b) {
      return '<button class="x97-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:transparent;text-align:left" data-x97-action="edit-account" data-id="' + attr(b.id) + '">' + accountIconBox(b.account) + '<div class="x97-row-main"><div class="x97-row-title">' + esc(b.account || "Account") + '</div><div class="x97-row-sub">' + esc(b.line || b.notes || "Tap to update balance") + '</div></div><div class="x97-row-value">' + money(b.balance, "UGX") + '</div></button>';
    }).join("");
    var attentionRows = attention.length ? attention.map(function (x) {
      return '<button class="x97-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:transparent;text-align:left" data-x97-nav="' + attr(x.nav) + '"><div class="x97-row-icon ' + esc(x.type) + '">' + icon("alert") + '</div><div class="x97-row-main"><div class="x97-row-title">' + esc(x.title) + '</div><div class="x97-row-sub">' + esc(x.sub) + '</div></div>' + icon("chevron") + '</button>';
    }).join("") : '<div class="x97-empty">' + icon("check", 25) + '<strong>Nothing urgent</strong><p>Your upcoming money, credit and budgets have no critical alerts.</p></div>';
    var timelineRows = events.length ? '<div class="x97-timeline">' + events.slice(0, 6).map(function (x) {
      var din = x.direction === "in";
      var usd = String(x.currency).toUpperCase() === "USD";
      var tone = din ? (usd ? "usd" : "in") : "out";
      var dd = parseLocalDate(x.date);
      var day = dd ? dd.getDate() : "";
      var mon = dd ? dd.toLocaleDateString(undefined, { month: "short" }).toUpperCase() : "";
      return '<button class="x97-tl-row ' + tone + '" data-x97-nav="' + attr(x.source === "upcoming" ? "upcoming" : x.source) + '">'
        + '<div class="x97-tl-date"><span class="x97-tl-day x97-money">' + day + '</span><span class="x97-tl-mon">' + esc(mon) + '</span></div>'
        + '<div class="x97-tl-body"><div class="x97-tl-title">' + esc(x.title) + '</div><div class="x97-tl-sub"><span class="x97-tl-dir">' + (din ? "IN" : "OUT") + '</span>' + esc(relDay(x.date)) + '</div></div>'
        + '<div class="x97-tl-amt x97-money">' + (din ? "+" : "−") + money(x.amount, x.currency) + '</div>'
        + '</button>';
    }).join("") + '</div>' : '<div class="x97-empty">' + icon("calendar", 25) + '<strong>No movement in the next 7 days</strong><p>Add dates to Upcoming or planned expenses to build this timeline.</p></div>';
    var pipeline = months.map(function (key) {
      var m = monthSummary(doc, key);
      return '<button class="x97-month-card x97-card" style="text-align:left;width:100%;margin:0" data-x97-action="open-month" data-month="' + attr(key) + '"><div class="x97-month-title">' + esc(monthLabel(key, true)) + '</div><div class="x97-month-count">' + m.pending.length + ' pending · ' + m.attention + ' need attention</div><div style="margin-top:12px"><div class="x97-money" style="font-size:20px">' + money(m.ugx, "UGX", true) + '</div><div class="x97-row-sub x97-teal" style="margin-top:5px">' + money(m.usd, "USD", true) + '</div></div></button>';
    }).join("");

    root.innerHTML = '<div class="x97-page">' +
      pageHeader("Financial command", "Dashboard", new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })) +
      '<div class="x97-dashboard-main">' +
        '<section class="x97-card x97-hero"><div class="x97-hero-label">Available now</div><div class="x97-hero-value x97-money">' + money(a.cash, "UGX") + '</div><div class="x97-hero-meta"><div class="x97-stat"><span>Net position</span><b>' + money(a.cash - a.debt, "UGX") + '</b></div><div class="x97-stat"><span>Active debt</span><b class="' + (a.debt ? "x97-red" : "x97-green") + '">' + money(a.debt, "UGX") + '</b></div></div></section>' +
        '<section><div class="x97-summary-grid"><div class="x97-card x97-summary"><div class="k">This month UGX</div><div class="v x97-money x97-green">' + money(a.ugxMonth, "", true) + '</div><div class="s">Expected incoming</div></div><div class="x97-card x97-summary"><div class="k">This month USD</div><div class="v x97-money x97-teal">' + money(a.usdMonth, "", true) + '</div><div class="s">Expected incoming</div></div><div class="x97-card x97-summary"><div class="k">Safe personal</div><div class="v x97-money ' + (a.expenses.personalSafe < 0 ? "x97-red" : "") + '">' + money(a.expenses.personalSafe, "", true) + '</div><div class="s">After plans</div></div><div class="x97-card x97-summary"><div class="k">Safe business</div><div class="v x97-money ' + (a.expenses.businessSafe < 0 ? "x97-red" : "") + '">' + money(a.expenses.businessSafe, "", true) + '</div><div class="s">After plans</div></div></div></section>' +
        '<section class="x97-section">' + sectionHead("Needs attention", "View Upcoming", "go-upcoming") + '<div class="x97-card x97-pad">' + attentionRows + '</div></section>' +
        (function(){var s=messagingSummary(doc);var pillOd=s.overdue?'<span class="x97-pill bad">'+s.overdue+' overdue</span>':(s.dueSoon?'<span class="x97-pill warn">'+s.dueSoon+' due soon</span>':'<span class="x97-pill good">'+icon("check",11)+'All clear</span>');return '<section class="x97-section">' + sectionHead("Messaging", "Open", "open-messaging") + '<button class="x97-msg-card" data-x97-action="open-messaging"><div class="x97-msg-icon">' + icon("send") + '</div><div class="x97-msg-body"><div class="x97-msg-title">WhatsApp reminders &amp; campaigns</div><div class="x97-msg-sub">' + s.contacts + ' contacts · ' + s.campaigns + ' campaigns' + (remindExt.ready?' · sender connected':'') + '</div><div class="x97-msg-pills">' + pillOd + '</div></div>' + icon("chevron") + '</button></section>';})() +
        '<section class="x97-section">' + sectionHead("Next 7 days") + '<div class="x97-card x97-pad"><div class="x97-hero-meta" style="margin-bottom:4px"><div class="x97-stat"><span>Expected in</span><b class="x97-green">' + money(in7, "UGX") + '</b></div><div class="x97-stat"><span>Expected out</span><b class="x97-red">' + money(out7, "UGX") + '</b></div></div>' + timelineRows + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Accounts", "Add account", "add-account") + '<div class="x97-card x97-pad">' + (accountRows || '<div class="x97-empty"><strong>No accounts yet</strong><p>Add your bank, mobile money or cash balance.</p></div>') + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Incoming pipeline", "View all months", "go-upcoming-months") + '<div class="x97-grid x97-pipeline">' + pipeline + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Credit position", "Open Credit", "go-credit") + '<div class="x97-card x97-pad"><div class="x97-summary-grid"><div class="x97-summary" style="padding:4px"><div class="k">Available credit</div><div class="v x97-money x97-teal">' + money(a.creditAvailable, "", true) + '</div><div class="s">Not included in cash</div></div><div class="x97-summary" style="padding:4px"><div class="k">Borrowed</div><div class="v x97-money x97-red">' + money(a.activeLoans.reduce(function (s,l){return s+num(l.principal);},0), "", true) + '</div><div class="s">' + a.activeLoans.length + ' active</div></div><div class="x97-summary" style="padding:4px"><div class="k">Amount due</div><div class="v x97-money x97-red">' + money(a.debt, "", true) + '</div><div class="s">Estimated today</div></div><div class="x97-summary" style="padding:4px"><div class="k">Next repayment</div><div class="v x97-money" style="font-size:17px">' + esc(nextLoanDue(a.activeLoans)) + '</div><div class="s">Earliest active loan</div></div></div></div></section>' +
      '</div></div>';
  }

  function nextLoanDue(loans) {
    if (!loans.length) return "None";
    var sorted = loans.slice().sort(function (a,b) { return String(dueDateForLoan(a)).localeCompare(String(dueDateForLoan(b))); });
    return formatDate(dueDateForLoan(sorted[0]), true);
  }

  function availableMonths(doc) {
    var seen = {};
    (doc.followups || []).forEach(function (x) { var k = monthKey(x.expectedBy); if (k) seen[k] = true; });
    var base = startOfMonth(todayDate());
    for (var i = -2; i <= 11; i++) { var d = new Date(base); d.setMonth(d.getMonth() + i); seen[monthKey(d)] = true; }
    return Object.keys(seen).sort();
  }

  function activeFilterCount() {
    var f = state.upcoming, count = 0;
    if (f.statuses.length) count++;
    if (f.currencies.length) count++;
    if (f.categories.length) count++;
    if (f.from || f.to) count++;
    if (f.minAmount || f.maxAmount) count++;
    if (f.sort !== "urgency") count++;
    return count;
  }

  function followupMatches(item) {
    var f = state.upcoming;
    var q = String(f.search || "").trim().toLowerCase();
    if (q && [item.client, item.category, item.note, item.currency, item.status].join(" ").toLowerCase().indexOf(q) < 0) return false;
    if (f.month === "unscheduled" && item.expectedBy) return false;
    if (f.month !== "all" && f.month !== "unscheduled" && monthKey(item.expectedBy) !== f.month) return false;
    if (f.statuses.length && f.statuses.indexOf(normalizeStatus(item.status)) < 0) return false;
    if (f.currencies.length && f.currencies.indexOf(String(item.currency || "UGX").toUpperCase()) < 0) return false;
    if (f.categories.length && f.categories.indexOf(String(item.category || "")) < 0) return false;
    if (f.from && (!item.expectedBy || item.expectedBy < f.from)) return false;
    if (f.to && (!item.expectedBy || item.expectedBy > f.to)) return false;
    if (f.minAmount !== "" && num(item.amount) < num(f.minAmount)) return false;
    if (f.maxAmount !== "" && num(item.amount) > num(f.maxAmount)) return false;
    var t = timing(item), today = todayDate(), nowMonth = monthKey(today), next = new Date(startOfMonth(today)); next.setMonth(next.getMonth() + 1);
    if (f.quick === "attention" && !(isOpenFollowup(item) && (t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7) || !item.expectedBy || num(item.amount) <= 0))) return false;
    if (f.quick === "overdue" && t.key !== "overdue") return false;
    if (f.quick === "today" && t.key !== "today") return false;
    if (f.quick === "next7" && !(isOpenFollowup(item) && t.days != null && t.days >= 0 && t.days <= 7)) return false;
    if (f.quick === "next30" && !(isOpenFollowup(item) && t.days != null && t.days >= 0 && t.days <= 30)) return false;
    if (f.quick === "thisMonth" && monthKey(item.expectedBy) !== nowMonth) return false;
    if (f.quick === "nextMonth" && monthKey(item.expectedBy) !== monthKey(next)) return false;
    if (f.quick === "unscheduled" && item.expectedBy) return false;
    if (f.quick === "paid" && !isPaid(item.status)) return false;
    return true;
  }

  function sortFollowups(items) {
    var mode = state.upcoming.sort;
    return items.sort(function (a, b) {
      if (mode === "dateAsc") return String(a.expectedBy || "9999-12-31").localeCompare(String(b.expectedBy || "9999-12-31"));
      if (mode === "dateDesc") return String(b.expectedBy || "0000-00-00").localeCompare(String(a.expectedBy || "0000-00-00"));
      if (mode === "amountDesc") return num(b.amount) - num(a.amount);
      if (mode === "amountAsc") return num(a.amount) - num(b.amount);
      if (mode === "client") return String(a.client || "").localeCompare(String(b.client || ""));
      function rank(x) { var t = timing(x); if (t.key === "overdue") return 0; if (t.key === "today") return 1; if (t.days != null && t.days <= 7) return 2; if (!x.expectedBy) return 3; if (isPaid(x.status)) return 5; return 4; }
      var r = rank(a) - rank(b);
      return r || String(a.expectedBy || "9999-12-31").localeCompare(String(b.expectedBy || "9999-12-31"));
    });
  }

  function filterTagHTML() {
    var f = state.upcoming, tags = [];
    if (f.month !== "all") tags.push({ label: monthLabel(f.month, true), key: "month" });
    if (f.statuses.length) tags.push({ label: f.statuses.join(", "), key: "statuses" });
    if (f.currencies.length) tags.push({ label: f.currencies.join(" + "), key: "currencies" });
    if (f.categories.length) tags.push({ label: f.categories.length + " categories", key: "categories" });
    if (f.from || f.to) tags.push({ label: (f.from ? formatDate(f.from, true) : "Any") + " – " + (f.to ? formatDate(f.to, true) : "Any"), key: "dates" });
    if (f.minAmount || f.maxAmount) tags.push({ label: "Amount " + (f.minAmount || "0") + "–" + (f.maxAmount || "∞"), key: "amount" });
    if (f.sort !== "urgency") tags.push({ label: "Sorted: " + f.sort, key: "sort" });
    if (!tags.length) return "";
    return '<div class="x97-active-filters">' + tags.map(function (t) { return '<button class="x97-filter-tag" data-x97-action="clear-filter" data-filter="' + attr(t.key) + '">' + esc(t.label) + ' ' + icon("close", 11) + '</button>'; }).join("") + '<button class="x97-filter-tag" data-x97-action="clear-all-filters" style="color:var(--neg)">Clear all</button></div>';
  }

  function quickChip(key, label, alert) {
    return '<button class="x97-chip ' + (alert ? "alert " : "") + (state.upcoming.quick === key ? "on" : "") + '" data-x97-action="quick-filter" data-value="' + attr(key) + '">' + esc(label) + '</button>';
  }

  function upcomingCard(item) {
    var t = timing(item), currency = String(item.currency || "UGX").toUpperCase();
    return '<article class="x97-item x97-card" data-x97-action="edit-upcoming" data-id="' + attr(item.id) + '"><div class="x97-item-top"><div class="x97-item-main"><div class="x97-item-category">' + esc(item.category || "Uncategorised") + '</div><div class="x97-item-title">' + esc(item.client || "Untitled upcoming payment") + '</div></div><div class="x97-item-amount x97-money ' + (currency === "USD" ? "x97-teal" : isPaid(item.status) ? "x97-green" : "") + '">' + (num(item.amount) ? money(item.amount, currency) : "Amount not set") + '</div></div><div class="x97-item-foot"><span class="x97-pill ' + esc(t.cls) + '">' + icon("clock", 12) + esc(t.label) + '</span>' + (item.expectedBy ? '<span class="x97-pill">' + icon("calendar", 12) + esc(formatDate(item.expectedBy, false)) + '</span>' : '') + '<span class="x97-pill ' + (isPaid(item.status) ? "good" : "") + '">' + esc(normalizeStatus(item.status)) + '</span><div class="x97-item-actions">' + (!isPaid(item.status) && !isCancelled(item.status) ? '<button class="x97-mini" data-x97-action="mark-paid" data-id="' + attr(item.id) + '">' + icon("check", 12) + ' Paid</button>' : '') + '<button class="x97-mini" data-x97-action="edit-upcoming" data-id="' + attr(item.id) + '">' + icon("edit", 12) + ' Edit</button></div></div></article>';
  }

  function groupFollowups(items) {
    var groups = { overdue: [], today: [], soon: [], later: [], unscheduled: [], paid: [], cancelled: [] };
    items.forEach(function (item) {
      var t = timing(item);
      if (t.key === "overdue") groups.overdue.push(item);
      else if (t.key === "today") groups.today.push(item);
      else if (t.key === "very-soon" || t.key === "soon") groups.soon.push(item);
      else if (t.key === "unscheduled") groups.unscheduled.push(item);
      else if (t.key === "paid") groups.paid.push(item);
      else if (t.key === "cancelled") groups.cancelled.push(item);
      else groups.later.push(item);
    });
    return groups;
  }

  function renderUpcoming(doc) {
    var f = state.upcoming;
    var all = doc.followups || [];
    var filtered = sortFollowups(all.filter(followupMatches));
    var pending = filtered.filter(isOpenFollowup);
    var ugx = pending.filter(function (x) { return String(x.currency).toUpperCase() !== "USD"; }).reduce(function (s,x){return s+num(x.amount);},0);
    var usd = pending.filter(function (x) { return String(x.currency).toUpperCase() === "USD"; }).reduce(function (s,x){return s+num(x.amount);},0);
    var attention = pending.filter(function (x) { var t=timing(x); return t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7) || !x.expectedBy || num(x.amount)<=0; }).length;
    var months = availableMonths(doc);
    var monthChips = '<button class="x97-chip ' + (f.month === "all" ? "on" : "") + '" data-x97-action="month-filter" data-value="all">All months</button>' + months.map(function (key) { return '<button class="x97-chip ' + (f.month === key ? "on" : "") + '" data-x97-action="month-filter" data-value="' + attr(key) + '">' + esc(monthLabel(key, true)) + '</button>'; }).join("") + '<button class="x97-chip ' + (f.month === "unscheduled" ? "on" : "") + '" data-x97-action="month-filter" data-value="unscheduled">Unscheduled</button>';
    var content;
    if (f.view === "months") {
      var cards = months.map(function (key) {
        var m = monthSummary(doc, key);
        if (!m.records.length && key < monthKey(todayDate())) return "";
        var ratio = m.records.length ? Math.round(m.paid.length / m.records.length * 100) : 0;
        return '<button class="x97-month-card x97-card" style="text-align:left;width:100%" data-x97-action="open-month" data-month="' + attr(key) + '"><div class="x97-month-head"><div><div class="x97-month-title">' + esc(monthLabel(key)) + '</div><div class="x97-month-count">' + m.pending.length + ' pending · ' + m.paid.length + ' paid · ' + m.attention + ' need attention</div></div>' + icon("chevron") + '</div><div class="x97-month-money"><div><span>UGX pending</span><b class="x97-green">' + money(m.ugx, "UGX", true) + '</b></div><div><span>USD pending</span><b class="x97-teal">' + money(m.usd, "USD", true) + '</b></div></div><div class="x97-progress"><i style="width:' + ratio + '%"></i></div></button>';
      }).join("");
      var uns = monthSummary(doc, "unscheduled");
      if (uns.records.length) cards += '<button class="x97-month-card x97-card" style="text-align:left;width:100%" data-x97-action="open-month" data-month="unscheduled"><div class="x97-month-head"><div><div class="x97-month-title">Unscheduled</div><div class="x97-month-count">' + uns.pending.length + ' items need dates</div></div>' + icon("chevron") + '</div><div class="x97-month-money"><div><span>UGX pending</span><b>' + money(uns.ugx, "UGX", true) + '</b></div><div><span>USD pending</span><b class="x97-teal">' + money(uns.usd, "USD", true) + '</b></div></div></button>';
      content = '<div class="x97-grid x97-grid-2">' + cards + '</div>';
    } else {
      var groups = groupFollowups(filtered);
      var specs = [
        ["overdue","Overdue"],["today","Due today"],["soon","Due soon"],["unscheduled","Unscheduled"],["later","Later"],["paid","Paid"],["cancelled","Cancelled"]
      ];
      content = specs.map(function (spec) {
        var items = groups[spec[0]];
        if (!items.length) return "";
        return '<div class="x97-group"><b>' + esc(spec[1]) + '</b><span>' + items.length + ' item' + (items.length === 1 ? "" : "s") + '</span></div>' + items.map(upcomingCard).join("");
      }).join("");
      if (!content) content = '<div class="x97-card x97-empty">' + icon("search", 26) + '<strong>No matching upcoming payments</strong><p>Clear a filter or add a new expected payment.</p><button class="x97-btn primary" style="margin-top:14px" data-x97-action="add-upcoming">' + icon("plus") + ' Add upcoming</button></div>';
    }

    root.innerHTML = '<div class="x97-page">' +
      pageHeader("Receivables", "Upcoming", "Expected payments, dates and follow-ups", '<button class="x97-icon-btn" data-x97-action="add-upcoming" title="Add upcoming">' + icon("plus") + '</button>') +
      '<div class="x97-summary-grid" style="margin-bottom:14px"><div class="x97-card x97-summary"><div class="k">UGX pending</div><div class="v x97-money x97-green">' + money(ugx, "", true) + '</div><div class="s">Filtered view</div></div><div class="x97-card x97-summary"><div class="k">USD pending</div><div class="v x97-money x97-teal">' + money(usd, "", true) + '</div><div class="s">Filtered view</div></div><div class="x97-card x97-summary"><div class="k">Items</div><div class="v x97-money">' + filtered.length + '</div><div class="s">' + pending.length + ' pending</div></div><div class="x97-card x97-summary"><div class="k">Need attention</div><div class="v x97-money ' + (attention ? "x97-red" : "x97-green") + '">' + attention + '</div><div class="s">Dates, amounts or urgency</div></div></div>' +
      '<div class="x97-segment"><button class="' + (f.view === "list" ? "on" : "") + '" data-x97-action="upcoming-view" data-value="list">' + icon("list", 15) + ' List</button><button class="' + (f.view === "months" ? "on" : "") + '" data-x97-action="upcoming-view" data-value="months">' + icon("grid", 15) + ' Months</button></div>' +
      (f.view === "list" ? '<div class="x97-tools"><div class="x97-search">' + icon("search", 17) + '<input id="x97-up-search" autocomplete="off" placeholder="Search client, project or note" value="' + attr(f.search) + '"></div><button class="x97-icon-btn" data-x97-action="open-filters">' + icon("filter") + '<span>Filters</span>' + (activeFilterCount() ? '<b class="x97-badge-count">' + activeFilterCount() + '</b>' : '') + '</button></div><div class="x97-chips">' + quickChip("all","All") + quickChip("attention","Needs action",true) + quickChip("overdue","Overdue",true) + quickChip("today","Today") + quickChip("next7","Next 7 days") + quickChip("next30","Next 30 days") + quickChip("thisMonth","This month") + quickChip("nextMonth","Next month") + quickChip("unscheduled","Unscheduled") + quickChip("paid","Paid") + '</div><div class="x97-chips">' + monthChips + '</div>' + filterTagHTML() + '<div class="x97-count">Showing ' + filtered.length + ' of ' + all.length + ' records · Sorted by ' + esc(f.sort) + '</div>' : '<div class="x97-count">Rolling monthly view · tap a month to open its records</div>') +
      content +
      '<button class="x97-fab" data-x97-action="add-upcoming" aria-label="Add upcoming">' + icon("plus", 25) + '</button></div>';
  }

  function networkClass(network) {
    var n = String(network || "").toLowerCase();
    return n.indexOf("airtel") >= 0 ? "airtel" : n.indexOf("mtn") >= 0 ? "mtn" : "other";
  }

  function facilityFeeText(f) {
    var model = String(f.feeModel || "Manual");
    if (/fixed/i.test(model)) return pct(f.baseFee) + " fixed fee · " + (num(f.termDays) || 30) + " days";
    if (/daily/i.test(model)) return pct(f.baseFee) + " base + " + pct(f.dailyRate) + "/day · " + (num(f.termDays) || 30) + " days";
    return "Manual amount due · " + (num(f.termDays) || 30) + " days";
  }

  function activePrincipalForFacility(loans, facilityId) {
    return loans.filter(function (l) { return isActiveLoan(l) && String(l.facilityId) === String(facilityId); }).reduce(function (s,l){return s+num(l.principal);},0);
  }

  function facilityCard(f, loans) {
    var available = Math.max(0, num(f.limitOffer) - activePrincipalForFacility(loans, f.id));
    var active = activePrincipalForFacility(loans, f.id) > 0;
    var live = isFacilityLive(f);
    return '<article class="x97-card x97-facility"><div class="x97-facility-head"><div class="x97-network ' + networkClass(f.network) + '">' + esc(String(f.network || "?").slice(0,3).toUpperCase()) + '</div><div class="x97-facility-main"><div class="x97-facility-title">' + esc(f.service || "Credit facility") + '</div><div class="x97-facility-sub">' + esc(f.network || "") + (f.line ? ' · ' + esc(f.line) : '') + '<br>' + esc(facilityFeeText(f)) + '</div></div><div class="x97-facility-limit"><span>Available</span><b class="x97-money x97-teal">' + money(available, "UGX", true) + '</b></div></div><div class="x97-facility-actions"><button class="x97-btn teal" data-x97-action="borrow" data-id="' + attr(f.id) + '" ' + (active || available <= 0 || !live ? "disabled" : "") + '>' + icon("credit") + (active ? " Active borrowing" : !live ? " Unavailable" : "Record borrowing") + '</button><button class="x97-btn" data-x97-action="edit-facility" data-id="' + attr(f.id) + '">' + icon("edit") + ' Edit</button></div></article>';
  }

  function loanCard(doc, loan) {
    var f = facilityById(doc, loan.facilityId) || {};
    var due = dueDateForLoan(loan), days = daysBetween(todayDate(), parseLocalDate(due));
    var overdue = days != null && days < 0;
    var dueText = overdue ? Math.abs(days) + " days overdue" : days === 0 ? "Due today" : "Due in " + days + " days";
    var dueAmount = estimateLoan(loan, todayISO());
    return '<article class="x97-card x97-loan ' + (overdue ? "overdue" : "") + '"><div class="x97-loan-head"><div><div class="due">' + esc(dueText) + '</div><h3>' + esc((f.network ? f.network + " " : "") + (f.service || "Credit borrowing")) + '</h3></div><div class="x97-network ' + networkClass(f.network) + '">' + esc(String(f.network || "CR").slice(0,3).toUpperCase()) + '</div></div><div class="x97-loan-amount x97-money ' + (overdue ? "x97-red" : "") + '">' + money(dueAmount, "UGX") + '</div><div class="x97-loan-meta">Borrowed ' + money(loan.principal, "UGX") + ' on ' + formatDate(loan.borrowDate) + '<br>Due ' + formatDate(due) + ' · ' + esc(loan.feeModelSnapshot || f.feeModel || "") + '</div><div class="x97-facility-actions"><button class="x97-btn primary" data-x97-action="repay" data-id="' + attr(loan.id) + '">' + icon("check") + ' Mark repaid</button><button class="x97-btn" data-x97-action="loan-details" data-id="' + attr(loan.id) + '">Details</button></div></article>';
  }

  function renderCredit(doc) {
    var loans = virtualLegacyLoans(doc);
    var active = loans.filter(isActiveLoan);
    var history = loans.filter(function (l) { return !isActiveLoan(l); }).sort(function(a,b){return String(b.repaidDate||b.borrowDate).localeCompare(String(a.repaidDate||a.borrowDate));});
    var live = (doc.credit || []).filter(isFacilityLive);
    var unavailable = (doc.credit || []).filter(function (f) { return !isFacilityLive(f); });
    var availableTotal = live.reduce(function (s,f){return s+Math.max(0,num(f.limitOffer)-activePrincipalForFacility(active,f.id));},0);
    var borrowed = active.reduce(function(s,l){return s+num(l.principal);},0);
    var due = active.reduce(function(s,l){return s+estimateLoan(l,todayISO());},0);
    var body = "";
    if (state.creditView === "available") {
      var networks = {};
      live.forEach(function (f) { var k = f.network || "Other"; (networks[k] || (networks[k] = [])).push(f); });
      body = Object.keys(networks).sort().map(function (network) { return '<div class="x97-group"><b>' + esc(network) + '</b><span>' + networks[network].length + ' facilities</span></div>' + networks[network].map(function(f){return facilityCard(f,active);}).join(""); }).join("");
      if (!body) body = '<div class="x97-card x97-empty"><strong>No available facilities</strong><p>Add a mobile credit offer or change an unavailable facility to Live.</p></div>';
      if (unavailable.length) body += '<button class="x97-row x97-card" style="width:100%;padding:14px;margin-top:12px;text-align:left" data-x97-action="toggle-unavailable"><div class="x97-row-icon">' + icon("credit") + '</div><div class="x97-row-main"><div class="x97-row-title">Unavailable facilities</div><div class="x97-row-sub">' + unavailable.length + ' saved offers</div></div>' + icon(unavailableOpen ? "close" : "chevron") + '</button>' + (unavailableOpen ? '<div style="margin-top:9px">' + unavailable.map(function(f){return facilityCard(f,active);}).join("") + '</div>' : '');
    } else if (state.creditView === "borrowed") {
      body = active.length ? active.sort(function(a,b){return String(dueDateForLoan(a)).localeCompare(String(dueDateForLoan(b)));}).map(function(l){return loanCard(doc,l);}).join("") : '<div class="x97-card x97-empty">' + icon("check",26) + '<strong>No active borrowing</strong><p>Your saved credit offers are available, but nothing is currently owed.</p><button class="x97-btn teal" style="margin-top:14px" data-x97-action="credit-view" data-value="available">View available credit</button></div>';
    } else {
      body = history.length ? history.map(function (l) { var f=facilityById(doc,l.facilityId)||{}; return '<article class="x97-card x97-facility"><div class="x97-facility-head"><div class="x97-network ' + networkClass(f.network) + '">' + esc(String(f.network||"CR").slice(0,3).toUpperCase()) + '</div><div class="x97-facility-main"><div class="x97-facility-title">' + esc(f.service||"Credit borrowing") + '</div><div class="x97-facility-sub">Borrowed ' + formatDate(l.borrowDate) + ' · Repaid ' + formatDate(l.repaidDate) + '</div></div><div class="x97-facility-limit"><span>Paid</span><b class="x97-money x97-green">' + money(l.actualPaid || estimateLoan(l,l.repaidDate),"UGX",true) + '</b></div></div></article>'; }).join("") : '<div class="x97-card x97-empty"><strong>No repayment history yet</strong><p>Completed borrowing will stay here for reference.</p></div>';
    }
    root.innerHTML = '<div class="x97-page">' +
      pageHeader("Mobile finance", "Credit", "Available offers, borrowing and repayment", '<button class="x97-icon-btn" data-x97-action="add-facility" title="Add facility">' + icon("plus") + '</button>') +
      '<div class="x97-summary-grid" style="margin-bottom:14px"><div class="x97-card x97-summary"><div class="k">Available credit</div><div class="v x97-money x97-teal">' + money(availableTotal,"",true) + '</div><div class="s">Across ' + live.length + ' live facilities</div></div><div class="x97-card x97-summary"><div class="k">Borrowed</div><div class="v x97-money x97-red">' + money(borrowed,"",true) + '</div><div class="s">' + active.length + ' active</div></div><div class="x97-card x97-summary"><div class="k">Amount due</div><div class="v x97-money x97-red">' + money(due,"",true) + '</div><div class="s">Estimated today</div></div><div class="x97-card x97-summary"><div class="k">Next repayment</div><div class="v x97-money" style="font-size:17px">' + esc(nextLoanDue(active)) + '</div><div class="s">Earliest active loan</div></div></div>' +
      '<div class="x97-segment"><button class="' + (state.creditView === "available" ? "on" : "") + '" data-x97-action="credit-view" data-value="available">Available</button><button class="' + (state.creditView === "borrowed" ? "on" : "") + '" data-x97-action="credit-view" data-value="borrowed">Borrowed' + (active.length ? ' · ' + active.length : '') + '</button><button class="' + (state.creditView === "history" ? "on" : "") + '" data-x97-action="credit-view" data-value="history">History</button></div>' + body +
      '<button class="x97-fab" data-x97-action="add-facility" aria-label="Add credit facility">' + icon("plus",25) + '</button></div>';
  }

  function render() {
    if (!currentScreen || !ensureRoot()) return;
    var doc = readDoc();
    if (!doc) {
      root.innerHTML = '<div class="x97-page"><div class="x97-card x97-empty"><strong>Loading your finance data…</strong><p>Sign in and wait for the cloud copy to finish loading.</p></div></div>';
      return;
    }
    lastRaw = JSON.stringify(doc);
    if (currentScreen === "dashboard") renderDashboard(doc);
    else if (currentScreen === "upcoming") renderUpcoming(doc);
    else if (currentScreen === "credit") renderCredit(doc);
    updateCloudPill();
  }

  function openSheet(title, body, foot, options) {
    closeSheet();
    var back = document.createElement("div");
    back.className = "x97-back";
    back.id = "x97-sheet";
    back.innerHTML = '<section class="x97-sheet" role="dialog" aria-modal="true"><div class="x97-handle"></div><header class="x97-sheet-head"><h2>' + esc(title) + '</h2><button class="x97-close" data-x97-action="close-sheet">' + icon("close") + '</button></header><div class="x97-sheet-body">' + body + '</div>' + (foot ? '<footer class="x97-sheet-foot">' + foot + '</footer>' : '') + '</section>';
    document.body.appendChild(back);
    back.addEventListener("mousedown", function (e) { if (e.target === back) closeSheet(); });
    if (options && options.afterOpen) setTimeout(function(){ options.afterOpen(back); },0);
    var first = back.querySelector("input:not([type=hidden]),select,textarea"); if (first && window.innerWidth > 700) setTimeout(function(){first.focus();},80);
  }

  function closeSheet() { var el = document.getElementById("x97-sheet"); if (el) el.remove(); }

  function option(value, label, selected) { return '<option value="' + attr(value) + '" ' + (String(value) === String(selected) ? "selected" : "") + '>' + esc(label == null ? value : label) + '</option>'; }

  function field(label, input, help) { return '<div class="x97-field"><label>' + esc(label) + '</label>' + input + (help ? '<div class="x97-help">' + esc(help) + '</div>' : '') + '</div>'; }

  function contactPickerHTML(query, doc, hintName, currentPhone) {
    var contacts = campContacts(doc);
    if (!contacts.length) return "";
    var res = searchAllContacts(query, contacts, hintName, 20);
    var list = res.list, total = res.total;
    if (!list.length) return query ? '<div class="x97-help" style="margin-top:6px">No contacts match "' + esc(query) + '"</div>' : "";
    var chips = '<div class="x97-contact-chips' + (list.length > 8 ? ' scroll' : '') + '">' + list.map(function (c) {
      var on = currentPhone && waNumber(currentPhone, doc) === waNumber(c.phone, doc);
      return '<button type="button" class="x97-chip x97-contact-chip' + (on ? " on" : "") + '" data-phone="' + attr(c.phone) + '">' + icon("phone", 11) + ' ' + esc(c.name) + ' · ' + esc(c.phone) + '</button>';
    }).join("") + "</div>";
    var more = total > list.length ? '<div class="x97-help" style="margin-top:6px">Showing ' + list.length + ' of ' + total + ' matches — add another word (e.g. a surname) to narrow it down.</div>' : "";
    return chips + more;
  }

  function openUpcomingForm(id) {
    var doc = readDoc(), existing = id ? (doc.followups || []).find(function(x){return String(x.id)===String(id);}) : null;
    var item = existing ? clone(existing) : { id:"", client:"", category:"One Time", amount:"", currency:"UGX", status:"Pending", expectedBy:"", phone:"", note:"" };
    var categories = Array.from(new Set([].concat(doc.settings.categories || [], (doc.followups || []).map(function(x){return x.category;}), ["Design","One Time","Retainer"]).filter(Boolean))).sort();
    var statuses = Array.from(new Set([].concat(doc.settings.fuStatuses || [], ["Pending","Paid","Cancelled"]).filter(Boolean)));
    var hasContacts = campContacts(doc).length > 0;
    var body = '<form id="x97-upcoming-form" data-x97-form="upcoming"><input type="hidden" name="id" value="' + attr(item.id) + '">' +
      field("Client / project", '<input class="x97-input" name="client" required maxlength="160" placeholder="e.g. Apollo — Scene 3" value="' + attr(item.client) + '">') +
      field("WhatsApp number", '<input class="x97-input" name="phone" inputmode="tel" value="' + attr(item.phone || "") + '" placeholder="e.g. 0772 123 456">' +
        (hasContacts ? '<input class="x97-input x97-contact-search" style="margin-top:8px" placeholder="Or search any contact — e.g. a name, nickname, part of a number…">' : '') +
        '<div id="x97-contact-suggest">' + contactPickerHTML("", doc, item.client, item.phone) + '</div>', "Used for payment reminders. Local (0772…) or full (+256772…) both work.") +
      '<div class="x97-fields-2">' + field("Amount", '<input class="x97-input" name="amount" inputmode="decimal" type="number" min="0" step="1" value="' + attr(item.amount) + '" placeholder="0">') + field("Currency", '<select class="x97-select" name="currency">' + option("UGX","UGX",item.currency) + option("USD","USD",item.currency) + '</select>') + '</div>' +
      '<details class="x97-more"' + (existing ? " open" : "") + '><summary class="x97-more-summary">' + icon("chevron", 12) + ' More details</summary><div class="x97-more-body">' +
      '<div class="x97-fields-2">' +
      field("Category", '<select class="x97-select" name="category">' + categories.map(function(x){return option(x,x,item.category);}).join("") + '</select>') +
      field("Status", '<select class="x97-select" name="status">' + statuses.map(function(x){return option(x,x,item.status);}).join("") + '</select>') + '</div>' +
      field("Expected date", '<input class="x97-input" name="expectedBy" type="date" value="' + attr(item.expectedBy) + '"><div class="x97-chips" style="padding-top:7px"><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="0">Today</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="7">+7 days</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="30">+30 days</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-value="month-end">Month end</button></div>') +
      field("Note", '<textarea class="x97-textarea" name="note" maxlength="500" placeholder="Invoice, follow-up context, or next action">' + esc(item.note) + '</textarea>') + '</div></details></form>';
    var foot = (existing ? '<button class="x97-btn danger" data-x97-action="delete-upcoming" data-id="' + attr(item.id) + '">' + icon("trash") + ' Delete</button>' : '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button>') + '<button class="x97-btn primary" type="submit" form="x97-upcoming-form">' + icon("check") + (existing ? " Save changes" : " Add upcoming") + '</button>';
    openSheet(existing ? "Edit upcoming" : "Add upcoming", body, foot, { afterOpen: function (back) {
      var clientInput = back.querySelector('input[name="client"]'), phoneInput = back.querySelector('input[name="phone"]'), searchInput = back.querySelector(".x97-contact-search"), box = back.querySelector("#x97-contact-suggest");
      if (!clientInput || !phoneInput || !box) return;
      var timer = null;
      function refresh() {
        clearTimeout(timer);
        timer = setTimeout(function () { box.innerHTML = contactPickerHTML(searchInput ? searchInput.value : "", readDoc(), clientInput.value, phoneInput.value); }, 150);
      }
      clientInput.addEventListener("input", function () { if (!searchInput || !searchInput.value.trim()) refresh(); });
      phoneInput.addEventListener("input", refresh);
      if (searchInput) searchInput.addEventListener("input", refresh);
      back.addEventListener("click", function (e) {
        var chip = e.target.closest && e.target.closest(".x97-contact-chip"); if (!chip) return;
        phoneInput.value = chip.dataset.phone;
        refresh();
      });
    } });
  }

  function openFilters(doc) {
    var f = state.upcoming;
    var statuses = Array.from(new Set((doc.followups || []).map(function(x){return normalizeStatus(x.status);}).concat(["Pending","Paid"]))).filter(Boolean).sort();
    var currencies = Array.from(new Set((doc.followups || []).map(function(x){return String(x.currency||"UGX").toUpperCase();}))).filter(Boolean).sort();
    var categories = Array.from(new Set((doc.followups || []).map(function(x){return String(x.category||"");}))).filter(Boolean).sort();
    function checks(name, values, selected) { return '<div class="x97-checks">' + values.map(function(v){return '<label class="x97-check"><input type="checkbox" name="' + attr(name) + '" value="' + attr(v) + '" ' + (selected.indexOf(v)>=0?"checked":"") + '><span>' + esc(v) + '</span></label>';}).join("") + '</div>'; }
    var body = '<form id="x97-filter-form" data-x97-form="filters">' +
      field("Status", checks("statuses",statuses,f.statuses)) + field("Currency",checks("currencies",currencies,f.currencies)) + field("Category",checks("categories",categories,f.categories)) +
      '<div class="x97-fields-2">' + field("Date from",'<input class="x97-input" type="date" name="from" value="'+attr(f.from)+'">') + field("Date to",'<input class="x97-input" type="date" name="to" value="'+attr(f.to)+'">') + '</div>' +
      '<div class="x97-fields-2">' + field("Minimum amount",'<input class="x97-input" type="number" min="0" name="minAmount" value="'+attr(f.minAmount)+'" placeholder="0">') + field("Maximum amount",'<input class="x97-input" type="number" min="0" name="maxAmount" value="'+attr(f.maxAmount)+'" placeholder="No limit">') + '</div>' +
      field("Sort results",'<select class="x97-select" name="sort">'+option("urgency","Urgency first",f.sort)+option("dateAsc","Date — earliest first",f.sort)+option("dateDesc","Date — latest first",f.sort)+option("amountDesc","Amount — highest first",f.sort)+option("amountAsc","Amount — lowest first",f.sort)+option("client","Client A–Z",f.sort)+'</select>') + '</form>';
    var foot = '<button class="x97-btn" data-x97-action="reset-advanced-filters">Reset</button><button class="x97-btn primary" type="submit" form="x97-filter-form">' + icon("filter") + ' Apply filters</button>';
    openSheet("Filter Upcoming",body,foot);
  }

  function openAccountForm(id) {
    var doc=readDoc(), existing=id?(doc.balances||[]).find(function(x){return String(x.id)===String(id);}):null;
    var b=existing?clone(existing):{id:"",account:"",line:"",balance:"",notes:""};
    var body='<form id="x97-account-form" data-x97-form="account"><input type="hidden" name="id" value="'+attr(b.id)+'">'+field("Account name",'<input class="x97-input" name="account" required value="'+attr(b.account)+'" placeholder="e.g. Equity Bank">')+field("Line / identifier",'<input class="x97-input" name="line" value="'+attr(b.line)+'" placeholder="Optional">')+field("Current balance",'<input class="x97-input" name="balance" type="number" inputmode="decimal" step="1" value="'+attr(b.balance)+'">','This replaces the displayed balance and remains synced across devices.')+field("Notes",'<textarea class="x97-textarea" name="notes">'+esc(b.notes)+'</textarea>')+'</form>';
    var foot=(existing?'<button class="x97-btn danger" data-x97-action="delete-account" data-id="'+attr(b.id)+'">'+icon("trash")+' Delete</button>':'<button class="x97-btn" data-x97-action="close-sheet">Cancel</button>')+'<button class="x97-btn primary" type="submit" form="x97-account-form">'+icon("check")+' Save account</button>';
    openSheet(existing?"Update account":"Add account",body,foot);
  }

  function openFacilityForm(id) {
    var doc=readDoc(), existing=id?facilityById(doc,id):null;
    var f=existing?clone(existing):{id:"",network:"Airtel",line:"",service:"",limitOffer:"",status:"Live",feeModel:"Fixed fee",baseFee:"",dailyRate:"",termDays:30,notes:""};
    var body='<form id="x97-facility-form" data-x97-form="facility"><input type="hidden" name="id" value="'+attr(f.id)+'"><div class="x97-fields-2">'+field("Network",'<select class="x97-select" name="network">'+option("Airtel","Airtel",f.network)+option("MTN","MTN",f.network)+option("Other","Other",f.network)+'</select>')+field("Phone line",'<input class="x97-input" name="line" value="'+attr(f.line)+'" placeholder="e.g. 0708">')+'</div>'+field("Service",'<input class="x97-input" name="service" required value="'+attr(f.service)+'" placeholder="e.g. XtraCash">')+'<div class="x97-fields-2">'+field("Current offer",'<input class="x97-input" name="limitOffer" type="number" min="0" step="1" value="'+attr(f.limitOffer)+'">')+field("Availability",'<select class="x97-select" name="status">'+option("Live","Live",f.status)+option("Currently Unavailable","Currently unavailable",f.status)+'</select>')+'</div>'+field("Fee model",'<select class="x97-select" name="feeModel" id="x97-fee-model">'+option("Fixed fee","Fixed fee",f.feeModel)+option("Daily fee","Daily fee",f.feeModel)+option("Manual","Manual amount due",f.feeModel)+'</select>')+'<div class="x97-fields-2">'+field("Base fee rate",'<input class="x97-input" name="baseFeePct" type="number" min="0" step="0.01" value="'+attr(num(f.baseFee)*100)+'" placeholder="e.g. 9">','Enter percentage, not decimal.')+field("Daily rate",'<input class="x97-input" name="dailyRatePct" type="number" min="0" step="0.01" value="'+attr(num(f.dailyRate)*100)+'" placeholder="e.g. 1">','Used only for daily-fee facilities.')+'</div>'+field("Default term (days)",'<input class="x97-input" name="termDays" type="number" min="0" step="1" value="'+attr(f.termDays||30)+'">')+field("Notes",'<textarea class="x97-textarea" name="notes">'+esc(f.notes)+'</textarea>')+'</form>';
    var foot=(existing?'<button class="x97-btn danger" data-x97-action="delete-facility" data-id="'+attr(f.id)+'">'+icon("trash")+' Delete</button>':'<button class="x97-btn" data-x97-action="close-sheet">Cancel</button>')+'<button class="x97-btn primary" type="submit" form="x97-facility-form">'+icon("check")+' Save facility</button>';
    openSheet(existing?"Edit credit facility":"Add credit facility",body,foot);
  }

  function facilityPreview(f, amount, borrowDate, manualDue) {
    var loan={principal:num(amount),borrowDate:borrowDate||todayISO(),feeModelSnapshot:f.feeModel,baseFeeSnapshot:num(f.baseFee),dailyRateSnapshot:num(f.dailyRate),termDaysSnapshot:num(f.termDays||30),manualDue:num(manualDue)};
    var dueDate=dateISO(addDays(loan.borrowDate,loan.termDaysSnapshot));
    var estimated=estimateLoan(loan,dueDate);
    return {loan:loan,dueDate:dueDate,estimated:estimated,fee:Math.max(0,estimated-num(amount))};
  }

  function renderBorrowPreview(form, facility) {
    var holder=document.getElementById("x97-borrow-preview"); if(!holder)return;
    var p=facilityPreview(facility,form.amount.value,form.borrowDate.value,form.manualDue?form.manualDue.value:0);
    holder.innerHTML='<div class="x97-preview-row"><span>Principal</span><b>'+money(p.loan.principal,"UGX")+'</b></div><div class="x97-preview-row"><span>Estimated fee</span><b>'+money(p.fee,"UGX")+'</b></div><div class="x97-preview-row"><span>Due date</span><b>'+formatDate(p.dueDate)+'</b></div><div class="x97-preview-row total"><span>Estimated amount due</span><b class="x97-red">'+money(p.estimated,"UGX")+'</b></div>';
  }

  function openBorrowForm(id) {
    var doc=readDoc(), f=facilityById(doc,id); if(!f)return;
    var loans=virtualLegacyLoans(doc), available=Math.max(0,num(f.limitOffer)-activePrincipalForFacility(loans,f.id));
    var accounts=(doc.balances||[]).map(function(b){return option(b.id,b.account+' · '+money(b.balance,"UGX"),"");}).join("");
    var manual=/manual/i.test(String(f.feeModel));
    var body='<form id="x97-borrow-form" data-x97-form="borrow"><input type="hidden" name="facilityId" value="'+attr(f.id)+'"><div class="x97-card x97-pad" style="margin-bottom:14px"><div class="x97-row-sub">Available from '+esc(f.service)+'</div><div class="x97-money x97-teal" style="font-size:28px;margin-top:5px">'+money(available,"UGX")+'</div><div class="x97-row-sub">'+esc(facilityFeeText(f))+'</div></div>'+field("Amount borrowed",'<input class="x97-input" name="amount" required type="number" min="1" max="'+attr(available)+'" step="1" value=""><div class="x97-chips" style="padding-top:7px"><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="25">25%</button><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="50">50%</button><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="75">75%</button><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="100">Maximum</button></div>')+field("Borrowing date",'<input class="x97-input" name="borrowDate" type="date" required value="'+todayISO()+'">')+(manual?field("Amount due",'<input class="x97-input" name="manualDue" type="number" min="0" step="1" required>','Enter the provider’s total repayment amount.'):'')+field("Add money to account",'<select class="x97-select" name="destinationAccount"><option value="">No — record debt only</option>'+accounts+'</select>','An account balance changes only when you select it explicitly.')+'<div class="x97-preview" id="x97-borrow-preview"></div></form>';
    var foot='<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-borrow-form">'+icon("check")+' Record borrowing</button>';
    openSheet("Record borrowing",body,foot,{afterOpen:function(){var form=document.getElementById("x97-borrow-form");renderBorrowPreview(form,f);}});
  }

  function findLoan(doc,id) { return virtualLegacyLoans(doc).find(function(l){return String(l.id)===String(id);}); }

  function openRepayForm(id) {
    var doc=readDoc(), loan=findLoan(doc,id); if(!loan)return;
    var f=facilityById(doc,loan.facilityId)||{}, due=estimateLoan(loan,todayISO());
    var accounts=(doc.balances||[]).map(function(b){return option(b.id,b.account+' · '+money(b.balance,"UGX"),"");}).join("");
    var body='<form id="x97-repay-form" data-x97-form="repay"><input type="hidden" name="loanId" value="'+attr(loan.id)+'"><div class="x97-card x97-pad" style="margin-bottom:14px"><div class="x97-row-sub">'+esc((f.network?f.network+' ':'')+(f.service||'Credit borrowing'))+'</div><div class="x97-money x97-red" style="font-size:28px;margin-top:5px">'+money(due,"UGX")+'</div><div class="x97-row-sub">Estimated due today</div></div>'+field("Amount paid",'<input class="x97-input" name="actualPaid" type="number" min="0" step="1" required value="'+attr(due)+'">')+field("Payment date",'<input class="x97-input" name="repaidDate" type="date" required value="'+todayISO()+'">')+field("Paid from account",'<select class="x97-select" name="repaymentAccount"><option value="">Do not change an account balance</option>'+accounts+'</select>','The selected account will be reduced by the amount paid.')+'</form>';
    var foot='<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-repay-form">'+icon("check")+' Confirm repayment</button>';
    openSheet("Mark as repaid",body,foot);
  }

  function openLoanDetails(id) {
    var doc=readDoc(),loan=findLoan(doc,id);if(!loan)return;var f=facilityById(doc,loan.facilityId)||{},due=dueDateForLoan(loan);
    var body='<div class="x97-preview"><div class="x97-preview-row"><span>Facility</span><b>'+esc((f.network?f.network+' ':'')+(f.service||'Credit'))+'</b></div><div class="x97-preview-row"><span>Principal</span><b>'+money(loan.principal,"UGX")+'</b></div><div class="x97-preview-row"><span>Borrowed</span><b>'+formatDate(loan.borrowDate)+'</b></div><div class="x97-preview-row"><span>Due date</span><b>'+formatDate(due)+'</b></div><div class="x97-preview-row"><span>Fee model</span><b>'+esc(loan.feeModelSnapshot||f.feeModel||'')+'</b></div><div class="x97-preview-row total"><span>Estimated due today</span><b class="x97-red">'+money(estimateLoan(loan,todayISO()),"UGX")+'</b></div></div>'+(loan.notes?'<p class="x97-sub">'+esc(loan.notes)+'</p>':'');
    var foot='<button class="x97-btn" data-x97-action="close-sheet">Close</button><button class="x97-btn primary" data-x97-action="repay" data-id="'+attr(loan.id)+'">Mark repaid</button>';
    openSheet("Borrowing details",body,foot);
  }

  function formValues(form) {
    var data = {};
    Array.prototype.slice.call(form.elements).forEach(function (el) {
      if (!el.name) return;
      if (el.type === "checkbox") {
        if (!data[el.name]) data[el.name] = [];
        if (el.checked) data[el.name].push(el.value);
      } else data[el.name] = el.value;
    });
    return data;
  }

  function submitUpcoming(form) {
    var v=formValues(form), id=v.id||uid("fu");
    updateDoc(function(doc){var i=doc.followups.findIndex(function(x){return String(x.id)===String(id);});var item={id:id,client:v.client.trim(),category:v.category,amount:roundMoney(v.amount),currency:v.currency,status:v.status,expectedBy:v.expectedBy,phone:(v.phone||"").trim(),note:v.note.trim()};if(i>=0)doc.followups[i]=Object.assign({},doc.followups[i],item);else doc.followups.unshift(item);},"upcoming-save");
    closeSheet(); if(remindState.open) refreshRemind();
  }

  /* ============================ WhatsApp payment reminders ============================ */

  function readAiCfg() {
    try { var e = localStorage.getItem("ns97-ai-cfg-v1"); var t = e ? JSON.parse(e) : {}; return { apiKey: t.apiKey || "", model: t.model || "claude-haiku-4-5-20251001" }; }
    catch (_) { return { apiKey: "", model: "claude-haiku-4-5-20251001" }; }
  }

  function firstName(value) { var s = String(value == null ? "" : value).trim(); if (!s) return "there"; var m = s.split(/[\s\-—,:/|]+/)[0]; return m || s; }
  function prettyPhone(p) { return String(p == null ? "" : p).trim(); }

  function waCountry(doc) { return String((doc.settings && doc.settings.countryCode) || "256").replace(/\D/g, "") || "256"; }
  function waNumber(phone, doc, ccOverride) {
    var raw = String(phone == null ? "" : phone).trim();
    if (!raw) return "";
    if (raw.charAt(0) === "+") return raw.replace(/\D/g, "");
    var d = raw.replace(/\D/g, ""); if (!d) return "";
    var cc = String(ccOverride || "").replace(/\D/g, "") || waCountry(doc);
    if (d.indexOf(cc) === 0 && d.length >= cc.length + 8) return d;
    if (d.charAt(0) === "0") return cc + d.slice(1);
    if (d.length === 9) return cc + d;
    return d;
  }
  function hasWa(item, doc) { return waNumber(item.phone, doc).length >= 10; }

  function defaultTemplates() {
    return [
      { id: "t-friendly", name: "Friendly nudge", tone: "friendly", body: "Hi {name}, hope you're doing well! 🙏 Just a gentle reminder about {amount} for {project} (due {date}). Whenever you get a chance to sort it out, I'd really appreciate it. Thank you! — {you}" },
      { id: "t-followup", name: "Follow-up", tone: "followup", body: "Hi {name}, following up on {amount} for {project} — it's now {days} days past the {date} due date. Could you let me know when I can expect payment? Happy to resend the details if that helps. Thanks — {you}" },
      { id: "t-firm", name: "Firm final notice", tone: "firm", body: "Hi {name}, this is a final reminder that {amount} for {project} is now {days} days overdue (was due {date}). Please arrange payment at your earliest convenience, or reply with a date you can commit to. Thank you — {you}" }
    ];
  }
  function allTemplates(doc) { var t = doc.settings && doc.settings.reminderTemplates; return (t && t.length) ? t : defaultTemplates(); }
  function templateForTone(doc, tone) { var list = allTemplates(doc); var hit = list.find(function (x) { return x.tone === tone; }); return (hit || list[0]).body; }

  function autoTone(item) { var t = timing(item); if (t.days != null && t.days < 0) { return Math.abs(t.days) > 14 ? "firm" : "followup"; } return "friendly"; }

  function fillTemplate(body, item, doc) {
    var cur = String(item.currency || "UGX").toUpperCase();
    var t = timing(item); var late = (t.days != null && t.days < 0) ? Math.abs(t.days) : 0;
    var map = {
      "{name}": firstName(item.client),
      "{project}": item.client || "the project",
      "{amount}": num(item.amount) ? money(item.amount, cur) : "the outstanding amount",
      "{currency}": cur,
      "{date}": item.expectedBy ? formatDate(item.expectedBy, false) : "the agreed date",
      "{days}": String(late),
      "{you}": (doc.settings && doc.settings.senderName) || "97 LIVE"
    };
    return String(body).replace(/\{name\}|\{project\}|\{amount\}|\{currency\}|\{date\}|\{days\}|\{you\}/g, function (k) { return map[k]; });
  }

  function messageFor(item, doc) {
    if (remindState.drafts[item.id] != null) return remindState.drafts[item.id];
    var tone = remindState.tone === "auto" ? autoTone(item) : remindState.tone;
    return fillTemplate(templateForTone(doc, tone), item, doc);
  }

  function chaseList(doc) {
    return (doc.followups || []).filter(isOpenFollowup).filter(function (x) {
      var t = timing(x); return t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7);
    }).sort(function (a, b) {
      var ta = timing(a), tb = timing(b);
      function rank(t) { if (t.key === "overdue") return 0; if (t.key === "today") return 1; return 2; }
      var r = rank(ta) - rank(tb); if (r) return r;
      var da = ta.days == null ? 999 : ta.days, db = tb.days == null ? 999 : tb.days;
      if (da !== db) return da - db;
      return num(b.amount) - num(a.amount);
    });
  }
  function chaseSendable(doc) { return chaseList(doc).filter(function (x) { return hasWa(x, doc); }); }
  function selectedItems(doc) { return chaseList(doc).filter(function (x) { return remindState.selected[x.id]; }); }
  function selectedSendable(doc) { return selectedItems(doc).filter(function (x) { return hasWa(x, doc); }); }

  function safety(doc) {
    var s = (doc.settings && doc.settings.waSafety) || {};
    return {
      dailyCap: num(s.dailyCap) || 40, minDelay: num(s.minDelay) || 45, maxDelay: num(s.maxDelay) || 120,
      batchSize: num(s.batchSize) || 8, batchBreak: num(s.batchBreak) || 10,
      quietStart: s.quietStart || "21:00", quietEnd: s.quietEnd || "08:00",
      warmup: s.warmup !== false, knownOnly: !!s.knownOnly
    };
  }

  function remindSentToday(doc) {
    var now = new Date(); var key = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
    return (doc.reminderLog || []).filter(function (r) { var d = new Date(r.at); return (d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()) === key; }).length;
  }

  function markReminded(id, mode) {
    updateDoc(function (doc) {
      var x = (doc.followups || []).find(function (i) { return String(i.id) === String(id); });
      if (x) { x.lastRemindedAt = new Date().toISOString(); x.reminderCount = num(x.reminderCount) + 1; }
      doc.reminderLog = (doc.reminderLog || []).concat([{ at: new Date().toISOString(), id: String(id), mode: mode || "onetap" }]);
      var cut = Date.now() - 7 * 86400000;
      doc.reminderLog = doc.reminderLog.filter(function (r) { return new Date(r.at).getTime() > cut; });
    }, "reminder-sent");
  }

  function relFromISO(iso) {
    var d = new Date(iso).getTime(); if (!isFinite(d)) return "";
    var s = Math.round((Date.now() - d) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; return Math.floor(s / 86400) + "d ago";
  }
  function progLabel(p) { return ({ queued: "Queued", sending: "Sending…", typing: "Typing…", sent: "Sent ✓", error: "Failed", skipped: "Skipped", paused: "Paused" })[p] || p; }
  function safeJson(text) { try { return JSON.parse(text); } catch (_) {} var a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} } return null; }

  function openReminders() {
    injectRemindCSS();
    remindState.open = true; remindState.progress = {};
    var doc = readDoc();
    if (doc) chaseSendable(doc).forEach(function (x) { if (timing(x).key === "overdue" && !x.lastRemindedAt) remindState.selected[x.id] = true; });
    var el = document.getElementById("x97-remind");
    if (!el) { el = document.createElement("div"); el.id = "x97-remind"; el.className = "x97-remind-overlay"; document.body.appendChild(el); wireRemind(el); }
    document.body.classList.add("x97-remind-lock");
    refreshRemind();
  }
  function closeReminders() { remindState.open = false; var el = document.getElementById("x97-remind"); if (el) el.remove(); if (!campaignState.open && !document.getElementById("x97-msg")) document.body.classList.remove("x97-remind-lock"); }
  function refreshRemind() { var el = document.getElementById("x97-remind"); if (!el || !remindState.open) return; var doc = readDoc(); if (!doc) return; el.innerHTML = remindOverlayHTML(doc); }

  function remindRow(item, doc) {
    var t = timing(item), sel = !!remindState.selected[item.id], wa = hasWa(item, doc);
    var cur = String(item.currency || "UGX").toUpperCase();
    var prog = remindState.progress[item.id];
    var phoneHTML = wa
      ? '<span class="x97-pill">' + icon("phone", 12) + esc(prettyPhone(item.phone)) + '</span>'
      : '<button type="button" class="x97-pill" data-x97-action="edit-upcoming" data-id="' + attr(item.id) + '" style="cursor:pointer;border:1px dashed var(--line2)">' + icon("plus", 12) + ' Add number</button>';
    var reminded = item.lastRemindedAt ? '<span class="x97-pill good">' + icon("check", 12) + 'Reminded ' + esc(relFromISO(item.lastRemindedAt)) + '</span>' : '';
    var progHTML = prog ? '<span class="x97-pill ' + (prog === "sent" ? "good" : prog === "error" ? "bad" : "warn") + '">' + esc(progLabel(prog)) + '</span>' : '';
    return '<div class="x97-rm-item' + (sel ? ' on' : '') + (wa ? '' : ' nowa') + '" data-id="' + attr(item.id) + '">' +
      '<div class="x97-rm-head"><label class="x97-rm-pick"><input type="checkbox" class="x97-rm-check" data-id="' + attr(item.id) + '" ' + (sel ? 'checked' : '') + (wa ? '' : ' disabled') + '></label>' +
      '<div class="x97-rm-body"><div class="x97-rm-top"><span class="x97-rm-name">' + esc(item.client || "Untitled") + '</span><span class="x97-rm-amt x97-money">' + (num(item.amount) ? money(item.amount, cur) : "—") + '</span></div>' +
      '<div class="x97-rm-tags"><span class="x97-pill ' + esc(t.cls) + '">' + icon("clock", 12) + esc(t.label) + '</span>' + phoneHTML + reminded + progHTML + '</div></div></div>' +
      (sel && wa ? '<textarea class="x97-rm-msg" data-id="' + attr(item.id) + '" rows="4">' + esc(messageFor(item, doc)) + '</textarea>' : '') +
      '</div>';
  }

  function remindOverlayHTML(doc) {
    var list = chaseList(doc), sendableN = selectedSendable(doc).length;
    var sent = remindSentToday(doc), cap = safety(doc).dailyCap;
    var pct = Math.min(100, Math.round(sent / Math.max(1, cap) * 100));
    var meterCls = sent >= cap ? "bad" : (sent >= cap * 0.8 ? "warn" : "ok");
    var rows = list.length ? list.map(function (x) { return remindRow(x, doc); }).join("")
      : '<div class="x97-empty x97-brand-empty" style="padding:34px 16px">' + brandMark(40, "x97-brand-watermark") + '<strong>Nothing to chase 🎉</strong><p>No receivables are overdue or due within 7 days. This list fills up automatically as dates pass.</p></div>';
    var toneSel = '<select class="x97-rm-tone x97-select" style="min-height:38px;width:auto">' +
      option("auto", "Tone: Auto", remindState.tone) + option("friendly", "Tone: Friendly", remindState.tone) +
      option("followup", "Tone: Follow-up", remindState.tone) + option("firm", "Tone: Firm", remindState.tone) + '</select>';
    var modeSeg = '<div class="x97-rm-seg"><button data-rm="mode-onetap" class="' + (remindState.mode === "onetap" ? "on" : "") + '">One-tap</button><button data-rm="mode-auto" class="' + (remindState.mode === "auto" ? "on" : "") + '">Auto</button></div>';
    var aiToggle = '<label class="x97-rm-ai-wrap"><input type="checkbox" class="x97-rm-ai" ' + (remindState.useAI ? "checked" : "") + '>' + icon("bolt", 14) + ' AI-personalise' + (remindState.aiBusy ? ' …' : '') + '</label>';
    var footPrimary;
    if (remindState.mode === "auto") {
      footPrimary = remindExt.ready
        ? '<button class="x97-btn primary" data-rm="send-auto" ' + (sendableN ? '' : 'disabled') + '>' + icon("send") + ' Send automatically (' + sendableN + ')</button>'
        : '<button class="x97-btn primary" disabled style="opacity:.55">Sender extension not detected</button>';
    } else {
      footPrimary = '<button class="x97-btn primary" data-rm="send-onetap" ' + (sendableN ? '' : 'disabled') + '>' + icon("message") + ' Open next in WhatsApp (' + sendableN + ')</button>';
    }
    var autoHint = (remindState.mode === "auto" && !remindExt.ready)
      ? '<div class="x97-rm-hint">' + icon("shield", 14) + '<div>Auto mode needs the free <b>97 Sender</b> browser extension (Chrome/Edge). Install it, keep <b>web.whatsapp.com</b> open in a tab, and this turns on. Until then use <b>One-tap</b> — it works right now.</div></div>' : '';
    return '<div class="x97-remind-panel">' +
      '<header class="x97-rm-header"><div class="x97-rm-htop"><div><button class="x97-rm-link" data-rm="hub" style="margin-bottom:4px">‹ Messaging</button><div class="x97-rm-title">' + brandMark(16) + icon("message", 18) + ' Chase overdue</div><div class="x97-rm-sub">' + list.length + ' to chase · ' + chaseSendable(doc).length + ' with a number</div></div><button class="x97-rm-close" data-rm="close">' + icon("close") + '</button></div>' +
      '<div class="x97-rm-meter ' + meterCls + '"><div class="x97-rm-meter-bar" style="width:' + pct + '%"></div><span>Sent today ' + sent + ' / ' + cap + '</span><em class="' + (remindExt.ready ? "ok" : "") + '">' + (remindExt.ready ? "Sender connected" : "Sender off") + '</em></div></header>' +
      '<div class="x97-rm-toolbar">' + toneSel + aiToggle + '<span class="x97-rm-spacer"></span>' + modeSeg + '<button class="x97-rm-tool" data-rm="numbers">' + icon("phone", 14) + ' Numbers</button><button class="x97-rm-tool" data-rm="templates">' + icon("edit", 14) + ' Templates</button><button class="x97-rm-tool" data-rm="safety">' + icon("shield", 14) + ' Safety</button></div>' +
      '<div class="x97-rm-selrow"><button class="x97-rm-link" data-rm="select-all">Select all</button><button class="x97-rm-link" data-rm="select-none">Clear</button><span class="x97-rm-selcount">' + Object.keys(remindState.selected).length + ' selected</span></div>' +
      autoHint + '<div class="x97-rm-list">' + rows + '</div>' +
      '<footer class="x97-rm-footer">' + footPrimary + '</footer></div>';
  }

  function wireRemind(el) {
    el.addEventListener("click", function (e) {
      var seg = e.target.closest && e.target.closest("[data-rm]");
      if (seg && el.contains(seg)) { onRemindAction(seg.dataset.rm); }
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t.classList.contains("x97-rm-check")) { var id = t.dataset.id; if (t.checked) remindState.selected[id] = true; else delete remindState.selected[id]; refreshRemind(); return; }
      if (t.classList.contains("x97-rm-tone")) { remindState.tone = t.value; refreshRemind(); return; }
      if (t.classList.contains("x97-rm-ai")) { remindState.useAI = t.checked; if (t.checked) draftWithAI(readDoc()); else { remindState.drafts = {}; refreshRemind(); } return; }
    });
    el.addEventListener("input", function (e) { var t = e.target; if (t.classList.contains("x97-rm-msg")) remindState.drafts[t.dataset.id] = t.value; });
  }

  function onRemindAction(a) {
    var doc = readDoc();
    if (a === "close") return closeReminders();
    if (a === "hub") { closeReminders(); openMessaging(); return; }
    if (a === "select-all") { chaseSendable(doc).forEach(function (x) { remindState.selected[x.id] = true; }); return refreshRemind(); }
    if (a === "select-none") { remindState.selected = {}; return refreshRemind(); }
    if (a === "mode-onetap") { remindState.mode = "onetap"; return refreshRemind(); }
    if (a === "mode-auto") { remindState.mode = "auto"; return refreshRemind(); }
    if (a === "templates") return openTemplateManager();
    if (a === "numbers") return openNumbersManager();
    if (a === "safety") return openSafetySettings();
    if (a === "send-onetap") return sendOneTapNext();
    if (a === "send-auto") return sendAuto(doc);
  }

  function sendOneTapNext() {
    var doc = readDoc(); if (!doc) return;
    var list = selectedSendable(doc);
    if (!list.length) { toast("Select someone with a WhatsApp number", "error"); return; }
    var item = list[0];
    var url = "https://wa.me/" + waNumber(item.phone, doc) + "?text=" + encodeURIComponent(messageFor(item, doc));
    window.open(url, "_blank");
    markReminded(item.id, "onetap");
    delete remindState.selected[item.id];
    remindState.progress[item.id] = "sent";
    refreshRemind();
  }

  function sendAuto(doc) {
    if (!remindExt.ready) { toast("Install the 97 Sender extension first", "error"); return; }
    var jobs = selectedSendable(doc).map(function (item) { return { id: String(item.id), phone: waNumber(item.phone, doc), name: firstName(item.client), message: messageFor(item, doc) }; });
    if (!jobs.length) { toast("Select at least one client with a number", "error"); return; }
    jobs.forEach(function (j) { remindState.progress[j.id] = "queued"; });
    remindExt.sending = true;
    window.postMessage({ source: "x97-wa-app", type: "enqueue", jobs: jobs, safety: safety(doc) }, "*");
    refreshRemind();
    toast("Sending " + jobs.length + " reminder" + (jobs.length === 1 ? "" : "s") + " — keep WhatsApp Web open", "");
  }

  function draftWithAI(doc) {
    doc = doc || readDoc(); if (!doc) return;
    var cfg = readAiCfg();
    if (!cfg.apiKey) { toast("Add your Anthropic key in Settings to draft with AI", "error"); remindState.useAI = false; return refreshRemind(); }
    var items = selectedSendable(doc); if (!items.length) items = chaseSendable(doc);
    items = items.slice(0, 25);
    if (!items.length) { toast("Nothing to draft", "error"); return; }
    remindState.aiBusy = true; refreshRemind();
    toast("Drafting " + items.length + " message" + (items.length === 1 ? "" : "s") + " with AI…", "");
    var sender = (doc.settings && doc.settings.senderName) || "97 LIVE";
    var payload = items.map(function (x) { var t = timing(x); return { id: String(x.id), name: firstName(x.client), project: x.client || "", amount: num(x.amount) ? money(x.amount, String(x.currency || "UGX").toUpperCase()) : "the outstanding amount", due: x.expectedBy ? formatDate(x.expectedBy, false) : "the agreed date", daysOverdue: (t.days != null && t.days < 0) ? Math.abs(t.days) : 0, tone: autoTone(x) }; });
    var sys = "You are the credit-control assistant for " + sender + ". Write short, warm, professional WhatsApp payment reminders in the sender's voice. One message per client. Vary the wording so no two are identical. Keep each to 2-4 sentences with a polite, specific ask. Use the client's first name. Use at most one emoji, sparingly. No markdown, no bullet points. Sign off as " + sender + ". Match the tone field: friendly = light gentle nudge; followup = clear check-in; firm = final but respectful.";
    var user = "Return ONLY a JSON object mapping each id to its message string — no other text. Clients:\n" + JSON.stringify(payload);
    fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }, body: JSON.stringify({ model: cfg.model, max_tokens: 1800, system: sys, messages: [{ role: "user", content: user }] }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var text = (d && d.content && d.content[0] && d.content[0].text) || "";
        var obj = safeJson(text); if (!obj) throw new Error("parse");
        Object.keys(obj).forEach(function (id) { if (typeof obj[id] === "string") remindState.drafts[id] = obj[id].trim(); });
        remindState.useAI = true; remindState.aiBusy = false; toast("AI drafts ready — edit any before sending", ""); refreshRemind();
      })
      .catch(function () { remindState.aiBusy = false; remindState.useAI = false; toast("AI draft failed — using templates instead", "error"); refreshRemind(); });
  }

  function openTemplateManager() {
    var doc = readDoc(); var byTone = function (tone) { var list = allTemplates(doc); var hit = list.find(function (x) { return x.tone === tone; }); return hit ? hit.body : ""; };
    var body = '<form id="x97-tpl-form" data-x97-form="reminder-templates">' +
      '<div class="x97-help" style="margin-bottom:12px">Slots you can drop into any message: <b>{name}</b> · {project} · {amount} · {currency} · {date} · {days} · {you}</div>' +
      field("Your sign-off name", '<input class="x97-input" name="senderName" value="' + attr((doc.settings && doc.settings.senderName) || "") + '" placeholder="e.g. Zah · 97 LIVE">') +
      field("Country code", '<input class="x97-input" name="countryCode" inputmode="numeric" value="' + attr(waCountry(doc)) + '" placeholder="256">', "Digits only. 256 = Uganda. Local numbers starting with 0 are converted automatically.") +
      field("Friendly nudge", '<textarea class="x97-textarea" name="friendly" rows="3">' + esc(byTone("friendly")) + '</textarea>') +
      field("Follow-up", '<textarea class="x97-textarea" name="followup" rows="3">' + esc(byTone("followup")) + '</textarea>') +
      field("Firm final notice", '<textarea class="x97-textarea" name="firm" rows="3">' + esc(byTone("firm")) + '</textarea>') + '</form>';
    var foot = '<button class="x97-btn" data-x97-action="reset-templates">Reset defaults</button><button class="x97-btn primary" type="submit" form="x97-tpl-form">' + icon("check") + ' Save templates</button>';
    openSheet("Reminder templates", body, foot);
  }
  function submitTemplates(form) {
    var v = formValues(form), d = defaultTemplates();
    updateDoc(function (doc) {
      doc.settings = doc.settings || {};
      doc.settings.senderName = (v.senderName || "").trim();
      doc.settings.countryCode = (v.countryCode || "256").replace(/\D/g, "") || "256";
      doc.settings.reminderTemplates = [
        { id: "t-friendly", name: "Friendly nudge", tone: "friendly", body: (v.friendly || "").trim() || d[0].body },
        { id: "t-followup", name: "Follow-up", tone: "followup", body: (v.followup || "").trim() || d[1].body },
        { id: "t-firm", name: "Firm final notice", tone: "firm", body: (v.firm || "").trim() || d[2].body }
      ];
    }, "reminder-templates");
    closeSheet(); if (remindState.open) refreshRemind();
  }

  /* ---- Contact matching: fuzzy-match finance clients against imported contacts ---- */

  function normalizeForMatch(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }
  function primaryNamePart(raw) { var s = String(raw == null ? "" : raw); var seg = s.split(/[—–\-:|]/)[0]; return (seg && seg.trim()) || s.trim(); }
  function nameTokens(raw) { return normalizeForMatch(primaryNamePart(raw)).split(" ").filter(function (w) { return w.length > 1; }); }
  function nameSimilarity(a, b) {
    var na = normalizeForMatch(primaryNamePart(a)), nb = normalizeForMatch(primaryNamePart(b));
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    if (na.length >= 3 && nb.length >= 3 && (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0)) return 0.9;
    var ta = nameTokens(a), tb = nameTokens(b);
    if (!ta.length || !tb.length) return 0;
    var setB = {}; tb.forEach(function (t) { setB[t] = true; });
    var inter = ta.filter(function (t) { return setB[t]; }).length;
    if (!inter) return 0;
    return (2 * inter) / (ta.length + tb.length);
  }
  var MATCH_AUTO = 0.82, MATCH_SUGGEST = 0.4;
  function bestContactMatches(clientName, contacts, limit) {
    var scored = contacts.map(function (c) { return { contact: c, score: nameSimilarity(clientName, c.name) }; })
      .filter(function (x) { return x.score >= MATCH_SUGGEST; })
      .sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit || 4);
  }
  function classifyMatches(matches) {
    if (!matches.length) return "none";
    var top = matches[0].score, second = matches[1] ? matches[1].score : 0;
    if (top >= MATCH_AUTO && (top - second) >= 0.12) return "auto";
    return "review";
  }

  function editDistance(a, b, maxD) {
    var al = a.length, bl = b.length;
    if (Math.abs(al - bl) > maxD) return maxD + 1;
    var d = []; for (var i = 0; i <= al; i++) { d[i] = [i]; }
    for (var j = 0; j <= bl; j++) d[0][j] = j;
    for (i = 1; i <= al; i++) {
      var rowMin = maxD + 1;
      for (j = 1; j <= bl; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        var val = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) val = Math.min(val, d[i - 2][j - 2] + 1);
        d[i][j] = val;
        if (val < rowMin) rowMin = val;
      }
      if (rowMin > maxD) return maxD + 1;
    }
    return d[al][bl];
  }
  function tokenHitsWord(token, word) {
    if (word.indexOf(token) >= 0) return "exact";
    if (token.length >= 3) {
      var maxD = token.length <= 4 ? 1 : (token.length <= 7 ? 2 : 3);
      if (editDistance(token, word, maxD) <= maxD) return "fuzzy";
    }
    return null;
  }

  function searchAllContacts(query, contacts, hintName, limit) {
    limit = limit || 20;
    var q = normalizeForMatch(query);
    if (!q) return { list: bestContactMatches(hintName, contacts, limit).map(function (m) { return m.contact; }), total: 0 };
    var qTokens = q.split(" ").filter(Boolean);
    var qDigits = query.replace(/\D/g, "");
    var scored = contacts.map(function (c) {
      var name = normalizeForMatch(c.name);
      var nameWords = name.split(" ").filter(Boolean);
      var phoneDigits = String(c.phone || "").replace(/\D/g, "");
      // Every word typed matches somewhere in the name (any order, and tolerant of a small typo like a
      // transposed pair of letters) — so it never fails just because of word order, extra words in
      // between (e.g. a middle name), or a slipped keystroke.
      var exactAll = qTokens.length > 0, fuzzyAll = qTokens.length > 0;
      qTokens.forEach(function (t) {
        var hits = nameWords.map(function (w) { return tokenHitsWord(t, w); });
        if (hits.indexOf("exact") < 0) exactAll = false;
        if (hits.indexOf("exact") < 0 && hits.indexOf("fuzzy") < 0) fuzzyAll = false;
      });
      var rank = 99;
      if (name === q) rank = -1;
      else if (name.indexOf(q) === 0) rank = 0;
      else if (exactAll) rank = 1;
      else if (fuzzyAll) rank = 2;
      else if (name.indexOf(q) >= 0) rank = 3;
      else if (qDigits.length >= 3 && phoneDigits.indexOf(qDigits) >= 0) rank = 4;
      return { contact: c, rank: rank };
    }).filter(function (x) { return x.rank < 99; })
      .sort(function (a, b) { return a.rank - b.rank || a.contact.name.localeCompare(b.contact.name); });
    return { list: scored.slice(0, limit).map(function (x) { return x.contact; }), total: scored.length };
  }

  function numRowPickerHTML(query, contacts, hintName, currentPhone, doc, targetName) {
    var res = searchAllContacts(query, contacts, hintName, 20);
    var list = res.list, total = res.total;
    if (!list.length) return query ? '<div class="x97-help" style="margin-top:6px">No contacts match "' + esc(query) + '"</div>' : "";
    var chips = '<div class="x97-contact-chips' + (list.length > 6 ? ' scroll' : '') + '">' + list.map(function (c) {
      var on = currentPhone && waNumber(currentPhone, doc) === waNumber(c.phone, doc);
      return '<button type="button" class="x97-chip x97-contact-chip' + (on ? " on" : "") + '" data-phone="' + attr(c.phone) + '" data-target="' + attr(targetName) + '">' + icon("phone", 11) + ' ' + esc(c.name) + ' · ' + esc(c.phone) + '</button>';
    }).join("") + "</div>";
    var more = total > list.length ? '<div class="x97-help" style="margin-top:6px">Showing ' + list.length + ' of ' + total + ' — add a surname to narrow it down.</div>' : "";
    return chips + more;
  }

  function openNumbersManager() {
    injectRemindCSS();
    var doc = readDoc();
    var contacts = campContacts(doc);
    var list = (doc.followups || []).filter(isOpenFollowup).slice().sort(function (a, b) {
      var am = hasWa(a, doc) ? 1 : 0, bm = hasWa(b, doc) ? 1 : 0;
      if (am !== bm) return am - bm;                       // missing numbers first
      var ta = timing(a), tb = timing(b);
      var da = ta.days == null ? 9999 : ta.days, db = tb.days == null ? 9999 : tb.days;
      if (da !== db) return da - db;                        // most urgent next
      return String(a.client || "").localeCompare(String(b.client || ""));
    });
    var missing = list.filter(function (x) { return !hasWa(x, doc); }).length;
    var autoCount = 0, reviewCount = 0;
    var rows = list.map(function (x) {
      var cur = String(x.currency || "UGX").toUpperCase(), t = timing(x);
      var picker = "";
      if (!hasWa(x, doc) && contacts.length) {
        var matches = bestContactMatches(x.client, contacts, 4);
        var cls = classifyMatches(matches);
        if (cls === "auto") { autoCount++; x = Object.assign({}, x, { phone: matches[0].contact.phone }); }
        else if (matches.length) reviewCount++;
        var note = cls === "auto" ? '<div class="x97-num-auto">' + icon("check", 11) + ' Auto-matched — check it\'s right, then Save</div>'
          : (matches.length ? '<div class="x97-num-review">' + icon("phone", 11) + ' Possible matches — pick one, search, or type the number</div>' : '<div class="x97-num-review">' + icon("phone", 11) + ' No automatic match — search or type the number</div>');
        picker = note +
          '<input class="x97-input x97-num-search" data-row="' + attr(x.id) + '" style="margin-top:6px" placeholder="Search any contact…">' +
          '<div class="x97-num-picker" data-row="' + attr(x.id) + '">' + numRowPickerHTML("", contacts, x.client, x.phone, doc, "num_" + x.id) + '</div>';
      }
      return '<div class="x97-num-row"><div class="x97-num-meta"><div class="x97-num-name">' + esc(x.client || "Untitled") + '</div><div class="x97-num-sub"><span class="x97-pill ' + esc(t.cls) + '" style="padding:2px 6px">' + esc(t.label) + '</span>' + (num(x.amount) ? '<span>' + esc(money(x.amount, cur)) + '</span>' : '') + '</div>' + picker + '</div><input class="x97-input x97-num-input" name="num_' + attr(x.id) + '" inputmode="tel" value="' + attr(x.phone || "") + '" placeholder="0772…"></div>';
    }).join("");
    if (!list.length) rows = '<div class="x97-empty" style="padding:22px"><strong>No open receivables</strong><p>Add upcoming payments first.</p></div>';
    var matchNote = contacts.length ? ('<div class="x97-help" style="margin-bottom:6px">Matched against your ' + contacts.length + ' imported contacts — ' + (autoCount ? '<b>' + autoCount + '</b> filled in automatically, ' : '') + (reviewCount ? '<b>' + reviewCount + '</b> need you to pick one' : (autoCount ? 'nothing else needs a pick' : 'search or type the rest')) + '.</div>') : "";
    var body = '<form id="x97-numbers-form" data-x97-form="wa-numbers">' + matchNote + '<div class="x97-help" style="margin-bottom:12px">' + (missing ? '<b>' + missing + '</b> still need a number. ' : 'All clients have a number. ') + 'Local (0772…) or full (+256772…) both work.</div>' + rows + '</form>';
    var foot = '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-numbers-form">' + icon("check") + ' Save numbers</button>';
    openSheet("WhatsApp numbers", body, foot, { afterOpen: function (back) {
      function refreshRow(id) {
        var searchEl = back.querySelector('.x97-num-search[data-row="' + id + '"]');
        var pickerEl = back.querySelector('.x97-num-picker[data-row="' + id + '"]');
        var inputEl = back.querySelector('input[name="num_' + id + '"]');
        if (!pickerEl || !inputEl) return;
        var item = list.find(function (x) { return String(x.id) === String(id); });
        pickerEl.innerHTML = numRowPickerHTML(searchEl ? searchEl.value : "", contacts, item ? item.client : "", inputEl.value, readDoc(), "num_" + id);
      }
      back.addEventListener("input", function (e) {
        var t = e.target; if (!t.classList.contains("x97-num-search")) return;
        var id = t.dataset.row;
        clearTimeout(t.__timer); t.__timer = setTimeout(function () { refreshRow(id); }, 150);
      });
      back.addEventListener("click", function (e) {
        var chip = e.target.closest && e.target.closest(".x97-contact-chip[data-target]"); if (!chip) return;
        var input = back.querySelector('input[name="' + chip.dataset.target + '"]'); if (!input) return;
        input.value = chip.dataset.phone;
        refreshRow(String(chip.dataset.target).replace(/^num_/, ""));
      });
    } });
  }
  function submitNumbers(form) {
    var v = formValues(form);
    updateDoc(function (doc) {
      (doc.followups || []).forEach(function (x) { var k = "num_" + x.id; if (Object.prototype.hasOwnProperty.call(v, k)) x.phone = String(v[k] || "").trim(); });
    }, "wa-numbers");
    closeSheet(); if (remindState.open) refreshRemind();
  }

  function openSafetySettings() {
    var doc = readDoc(); var s = safety(doc);
    var body = '<form id="x97-safety-form" data-x97-form="wa-safety">' +
      '<div class="x97-help" style="margin-bottom:12px">These keep automated sending looking human so your number stays safe. They apply to <b>Auto</b> mode.</div>' +
      '<div class="x97-fields-2">' + field("Daily send cap", '<input class="x97-input" type="number" min="1" name="dailyCap" value="' + attr(s.dailyCap) + '">') + field("Warm-up ramp", '<select class="x97-select" name="warmup">' + option("true", "On — start slow", String(s.warmup)) + option("false", "Off", String(s.warmup)) + '</select>') + '</div>' +
      '<div class="x97-fields-2">' + field("Min gap (seconds)", '<input class="x97-input" type="number" min="5" name="minDelay" value="' + attr(s.minDelay) + '">') + field("Max gap (seconds)", '<input class="x97-input" type="number" min="10" name="maxDelay" value="' + attr(s.maxDelay) + '">') + '</div>' +
      '<div class="x97-fields-2">' + field("Batch size", '<input class="x97-input" type="number" min="1" name="batchSize" value="' + attr(s.batchSize) + '">') + field("Break after batch (min)", '<input class="x97-input" type="number" min="0" name="batchBreak" value="' + attr(s.batchBreak) + '">') + '</div>' +
      '<div class="x97-fields-2">' + field("Quiet hours from", '<input class="x97-input" type="time" name="quietStart" value="' + attr(s.quietStart) + '">') + field("Quiet hours to", '<input class="x97-input" type="time" name="quietEnd" value="' + attr(s.quietEnd) + '">') + '</div>' +
      field("Only known contacts", '<select class="x97-select" name="knownOnly">' + option("false", "No — send to any number", String(s.knownOnly)) + option("true", "Yes — safest, skip unsaved", String(s.knownOnly)) + '</select>') + '</form>';
    var foot = '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-safety-form">' + icon("check") + ' Save safety settings</button>';
    openSheet("Sending safety", body, foot);
  }
  function submitSafety(form) {
    var v = formValues(form);
    updateDoc(function (doc) { doc.settings = doc.settings || {}; doc.settings.waSafety = { dailyCap: num(v.dailyCap) || 40, minDelay: num(v.minDelay) || 45, maxDelay: num(v.maxDelay) || 120, batchSize: num(v.batchSize) || 8, batchBreak: num(v.batchBreak) || 10, quietStart: v.quietStart || "21:00", quietEnd: v.quietEnd || "08:00", warmup: v.warmup !== "false", knownOnly: v.knownOnly === "true" }; }, "wa-safety");
    closeSheet(); if (remindState.open) refreshRemind();
  }

  function handleExtProgress(d) {
    if (!d.id) return;
    if (campaignState.sending) { handleCampaignProgress(d); return; }
    remindState.progress[d.id] = d.status;
    if (d.status === "sent") { markReminded(d.id, "auto"); delete remindState.selected[d.id]; }
    if (remindState.open) refreshRemind();
  }
  function initRemindBridge() {
    window.addEventListener("message", function (ev) {
      if (ev.source !== window) return;
      var d = ev.data; if (!d || d.source !== "x97-wa-ext") return;
      if (d.type === "ready") { remindExt.ready = true; remindExt.version = d.version || ""; if (remindState.open) refreshRemind(); if (campaignState.open) refreshCamp(); refreshMsgHub(); }
      else if (d.type === "progress") handleExtProgress(d);
      else if (d.type === "done") { remindExt.sending = false; if (campaignState.sending) { campaignState.sending = false; if (campaignState.open) refreshCamp(); toast("Campaign finished", ""); } else { if (remindState.open) refreshRemind(); toast("Reminder run finished", ""); } refreshMsgHub(); }
      else if (d.type === "paused") { remindExt.sending = false; if (remindState.open) refreshRemind(); if (campaignState.open) refreshCamp(); }
    });
    try { window.postMessage({ source: "x97-wa-app", type: "hello" }, "*"); } catch (_) {}
  }

  function injectRemindCSS() {
    if (document.getElementById("x97-remind-css")) return;
    var css = ".x97-remind-lock{overflow:hidden}" +
      ".x97-remind-overlay{position:fixed;inset:0;z-index:120;background:rgba(6,10,14,.55);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center}" +
      "@media(min-width:760px){.x97-remind-overlay{align-items:center;padding:24px}}" +
      ".x97-remind-panel{background:var(--bg);width:100%;max-width:640px;max-height:94vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 -12px 44px rgba(0,0,0,.34)}" +
      "@media(min-width:760px){.x97-remind-panel{border-radius:22px;max-height:88vh}}" +
      ".x97-rm-header{padding:15px 15px 12px;border-bottom:1px solid var(--line);background:var(--card)}" +
      ".x97-rm-htop{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}" +
      ".x97-rm-title{display:flex;align-items:center;gap:8px;font-size:17px;font-weight:850;color:var(--tx)}" +
      ".x97-rm-sub{font-size:11.5px;color:var(--tx3);margin-top:3px}" +
      ".x97-rm-close{background:var(--card2);border:1px solid var(--line);border-radius:11px;width:38px;height:38px;min-width:38px;display:flex;align-items:center;justify-content:center;color:var(--tx2);cursor:pointer}" +
      ".x97-rm-meter{position:relative;margin-top:12px;height:26px;border-radius:9px;background:var(--card2);border:1px solid var(--line);overflow:hidden;display:flex;align-items:center}" +
      ".x97-rm-meter span{position:relative;z-index:1;font-size:10px;font-weight:850;color:var(--tx);padding-left:10px;text-transform:uppercase;letter-spacing:.05em}" +
      ".x97-rm-meter em{position:relative;z-index:1;margin-left:auto;padding-right:10px;font-style:normal;font-size:10px;font-weight:800;color:var(--tx3)}" +
      ".x97-rm-meter em.ok{color:var(--pos)}" +
      ".x97-rm-meter-bar{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--pos),var(--pos2));opacity:.3}" +
      ".x97-rm-meter.warn .x97-rm-meter-bar{background:var(--warn);opacity:.4}.x97-rm-meter.bad .x97-rm-meter-bar{background:var(--neg);opacity:.45}" +
      ".x97-rm-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--line)}" +
      ".x97-rm-spacer{flex:1 1 auto}" +
      ".x97-rm-ai-wrap{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:750;color:var(--tx);cursor:pointer}.x97-rm-ai{accent-color:var(--pos);width:16px;height:16px}" +
      ".x97-rm-seg{display:inline-flex;background:var(--card2);border:1px solid var(--line);border-radius:10px;overflow:hidden}" +
      ".x97-rm-seg button{border:0;background:transparent;padding:7px 13px;font-size:12px;font-weight:800;color:var(--tx3);cursor:pointer}.x97-rm-seg button.on{background:var(--pos);color:#fff}" +
      ".x97-rm-tool{display:inline-flex;align-items:center;gap:5px;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:7px 10px;font-size:11.5px;font-weight:750;color:var(--tx2);cursor:pointer}" +
      ".x97-rm-selrow{display:flex;align-items:center;gap:14px;padding:9px 15px}" +
      ".x97-rm-link{background:0;border:0;color:var(--pos);font-weight:800;font-size:12px;cursor:pointer;padding:0}" +
      ".x97-rm-selcount{margin-left:auto;font-size:11px;color:var(--tx3);font-weight:700}" +
      ".x97-rm-hint{margin:0 13px 10px;padding:11px 12px;background:var(--card2);border:1px solid var(--line2);border-radius:12px;font-size:11.5px;line-height:1.55;color:var(--tx2);display:flex;gap:8px;align-items:flex-start}" +
      ".x97-rm-list{flex:1 1 auto;overflow-y:auto;padding:6px 12px 12px}" +
      ".x97-rm-item{border:1px solid var(--line);border-radius:14px;padding:11px 12px;margin-bottom:9px;background:var(--card)}" +
      ".x97-rm-item.on{border-color:var(--pos);box-shadow:var(--ring)}.x97-rm-item.nowa{opacity:.9}" +
      ".x97-rm-head{display:flex;gap:11px;align-items:flex-start}.x97-rm-pick{padding-top:1px}.x97-rm-check{width:20px;height:20px;accent-color:var(--pos)}" +
      ".x97-rm-body{flex:1;min-width:0}" +
      ".x97-rm-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}" +
      ".x97-rm-name{font-size:14px;font-weight:800;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".x97-rm-amt{font-size:14px;font-weight:800;white-space:nowrap}" +
      ".x97-rm-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}" +
      ".x97-rm-msg{width:100%;margin-top:10px;border:1px solid var(--line2);border-radius:11px;background:var(--card2);color:var(--tx);padding:10px;font-size:12.5px;line-height:1.5;resize:vertical;min-height:74px;font-family:inherit}" +
      ".x97-rm-footer{padding:12px 14px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line);background:var(--card)}.x97-rm-footer .x97-btn{width:100%;justify-content:center}" +
      ".x97-num-row{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}" +
      ".x97-num-meta{flex:1;min-width:0}.x97-num-name{font-size:13px;font-weight:750;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".x97-num-sub{font-size:11px;color:var(--tx3);margin-top:4px;display:flex;gap:7px;align-items:center}" +
      ".x97-num-input{max-width:172px}" +
      ".x97-num-row{flex-wrap:wrap}.x97-num-search{width:100%;margin-top:6px;font-size:11.5px}" +
      ".x97-num-picker:empty{margin-top:0}" +
      ".x97-num-auto{width:100%;font-size:10.5px;color:var(--pos);font-weight:750;display:flex;align-items:center;gap:4px;margin-top:4px}" +
      ".x97-num-review{width:100%;font-size:10.5px;color:var(--warn);font-weight:750;display:flex;align-items:center;gap:4px;margin-top:4px}" +
      "@keyframes x97PanelUp{from{transform:translateY(28px);opacity:0}to{transform:translateY(0);opacity:1}}" +
      ".x97-remind-panel{animation:x97PanelUp .38s cubic-bezier(.3,1.22,.42,1)}" +
      "@keyframes x97PillPop{0%{transform:scale(.7)}60%{transform:scale(1.08)}100%{transform:scale(1)}}" +
      ".x97-rm-tags .x97-pill.good,.x97-camp-logrow .x97-pill.good{animation:x97PillPop .3s cubic-bezier(.34,1.56,.64,1)}" +
      ".x97-rm-tool,.x97-ws-tool,.x97-ws-b,.x97-camp-hist{transition:transform .1s}" +
      ".x97-rm-tool:active,.x97-ws-tool:active,.x97-ws-b:active,.x97-camp-hist:active{transform:scale(.96)}" +
      ".x97-brand-mark{border-radius:6px;display:inline-block;vertical-align:middle;object-fit:contain;flex:none}" +
      ".x97-brand-empty{display:flex;flex-direction:column;align-items:center}" +
      ".x97-brand-watermark{opacity:.55;margin-bottom:8px}" +
      ".x97-ws-signoff{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:10px;color:var(--tx3);font-weight:700}" +
      "@media(prefers-reduced-motion:reduce){.x97-remind-panel,.x97-rm-tags .x97-pill.good,.x97-camp-logrow .x97-pill.good{animation:none}.x97-rm-tool,.x97-ws-tool,.x97-ws-b,.x97-camp-hist{transition:none}}";
    var s = document.createElement("style"); s.id = "x97-remind-css"; s.textContent = css; document.head.appendChild(s);
  }

  /* ============================ Messaging hub ============================ */

  function combinedSentToday(doc) {
    var n = remindSentToday(doc);
    var now = new Date(); var key = now.getFullYear() + "-" + now.getMonth() + "-" + now.getDate();
    (doc.waCampaigns || []).forEach(function (c) { (c.log || []).forEach(function (e) { if (e.status !== "sent") return; var d = new Date(e.at); if ((d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()) === key) n++; }); });
    return n;
  }

  function messagingSummary(doc) {
    var cl = chaseList(doc);
    return {
      overdue: cl.filter(function (x) { return timing(x).key === "overdue"; }).length,
      dueSoon: cl.length,
      contacts: campContacts(doc).length,
      lists: campLists(doc).length,
      campaigns: campCampaigns(doc).length,
      sentToday: combinedSentToday(doc),
      cap: safety(doc).dailyCap
    };
  }

  function openMessaging() {
    injectRemindCSS(); injectCampCSS(); injectMsgCSS();
    var el = document.getElementById("x97-msg");
    if (!el) { el = document.createElement("div"); el.id = "x97-msg"; el.className = "x97-remind-overlay"; document.body.appendChild(el); wireMsgHub(el); }
    document.body.classList.add("x97-remind-lock");
    refreshMsgHub();
  }
  function closeMessaging() { var el = document.getElementById("x97-msg"); if (el) el.remove(); if (!remindState.open && !campaignState.open) document.body.classList.remove("x97-remind-lock"); }
  function refreshMsgHub() { var el = document.getElementById("x97-msg"); if (!el) return; var doc = readDoc(); if (!doc) return; el.innerHTML = msgHubHTML(doc); }

  function msgTile(opts) {
    return '<button class="x97-msg-tile" data-msg="' + attr(opts.action) + '">' +
      '<div class="x97-msg-tile-icon' + (opts.tone ? " " + opts.tone : "") + '">' + icon(opts.icon, 20) + '</div>' +
      '<div class="x97-msg-tile-body"><div class="x97-msg-tile-title">' + esc(opts.title) + '</div><div class="x97-msg-tile-sub">' + esc(opts.sub) + '</div></div>' +
      (opts.badge != null ? '<span class="x97-msg-tile-badge' + (opts.badgeTone ? " " + opts.badgeTone : "") + '">' + esc(opts.badge) + '</span>' : icon("chevron", 16)) +
      '</button>';
  }

  function msgHubHTML(doc) {
    var s = messagingSummary(doc);
    var pct = Math.min(100, Math.round(s.sentToday / Math.max(1, s.cap) * 100));
    var meterCls = s.sentToday >= s.cap ? "bad" : (s.sentToday >= s.cap * 0.8 ? "warn" : "ok");
    var campaigns = campCampaigns(doc).slice(0, 3);
    var histHTML = campaigns.length ? campaigns.map(function (c) {
      var st = c.stats || { sent: 0 };
      return '<button class="x97-camp-hist" data-msg="report" data-id="' + attr(c.id) + '"><div style="flex:1;min-width:0"><div class="x97-rm-name">' + esc(c.name || "Untitled") + '</div><div class="x97-rm-sub">' + esc(audienceLabel(doc, c.audience)) + ' · ' + (st.sent || 0) + ' sent' + (st.failed ? ' · ' + st.failed + ' failed' : '') + '</div></div>' + icon("chevron") + '</button>';
    }).join("") : "";
    return '<div class="x97-remind-panel">' +
      '<header class="x97-msg-header"><div class="x97-rm-htop"><div><div class="x97-rm-title">' + brandMark(20) + ' Messaging</div><div class="x97-rm-sub">WhatsApp reminders &amp; bulk campaigns, all in one place</div></div><button class="x97-rm-close" data-msg="close">' + icon("close") + '</button></div>' +
      '<div class="x97-msg-stats">' +
        '<div class="x97-msg-stat"><b class="' + (s.overdue ? "x97-red" : "") + '">' + s.overdue + '</b><span>To chase</span></div>' +
        '<div class="x97-msg-stat"><b>' + s.contacts + '</b><span>Contacts</span></div>' +
        '<div class="x97-msg-stat"><b>' + s.campaigns + '</b><span>Campaigns</span></div>' +
      '</div>' +
      '<div class="x97-rm-meter ' + meterCls + '" style="margin-top:2px"><div class="x97-rm-meter-bar" style="width:' + pct + '%"></div><span>Sent today ' + s.sentToday + ' / ' + s.cap + '</span><em class="' + (remindExt.ready ? "ok" : "") + '">' + (remindExt.ready ? "Sender connected" : "Sender off") + '</em></div>' +
      '</header>' +
      '<div class="x97-rm-list">' +
        '<div class="x97-camp-sec">Quick actions</div>' +
        '<div class="x97-msg-tiles">' +
          msgTile({ action: "chase", icon: "message", title: "Chase overdue", sub: s.overdue ? "Ready to send" : (s.dueSoon ? s.dueSoon + " due within 7 days" : "Nothing overdue right now"), badge: s.overdue || null, badgeTone: "bad", tone: s.overdue ? "bad" : "" }) +
          msgTile({ action: "new-campaign", icon: "send", title: "New campaign", sub: "Message a list or import a CSV" }) +
          msgTile({ action: "contacts", icon: "phone", title: "Contacts & lists", sub: s.contacts + " contacts · " + s.lists + " lists" }) +
          msgTile({ action: "templates", icon: "edit", title: "Templates", sub: "Reusable messages, saved once" }) +
        '</div>' +
        (histHTML ? '<div class="x97-camp-sec" style="margin-top:18px">Recent campaigns</div>' + histHTML : '') +
      '</div></div>';
  }

  function wireMsgHub(el) {
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-msg]"); if (!b || !el.contains(b)) return;
      var a = b.dataset.msg;
      if (a === "close") return closeMessaging();
      if (a === "chase") { closeMessaging(); openReminders(); return; }
      if (a === "new-campaign") { closeMessaging(); openCampaigns(true); return; }
      if (a === "contacts") { closeMessaging(); openCampaigns(); return; }
      if (a === "templates") return openTemplateManager();
      if (a === "report") { closeMessaging(); openCampaigns(); onCampAction("report", { dataset: { id: b.dataset.id } }); return; }
    });
  }

  function injectMsgCSS() {
    if (document.getElementById("x97-msg-css")) return;
    var css =
      ".x97-msg-card{width:100%;text-align:left;border:0;cursor:pointer;display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}" +
      ".x97-msg-icon{width:44px;height:44px;min-width:44px;border-radius:13px;display:flex;align-items:center;justify-content:center;background:linear-gradient(145deg,var(--pos),var(--pos2));color:#fff;box-shadow:0 6px 16px rgba(14,117,72,.28)}" +
      ".x97-msg-body{flex:1;min-width:0}.x97-msg-title{font-size:14.5px;font-weight:800;color:var(--tx)}.x97-msg-sub{font-size:11.5px;color:var(--tx3);margin-top:2px}" +
      ".x97-msg-pills{display:flex;gap:7px;margin-top:8px;flex-wrap:wrap}" +
      ".x97-msg-header{padding:16px 15px 13px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(23,164,104,.08),transparent 70%),var(--card)}" +
      ".x97-msg-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:13px 0 11px}" +
      ".x97-msg-stat{background:var(--card2);border:1px solid var(--line);border-radius:13px;padding:11px 8px;text-align:center}" +
      ".x97-msg-stat b{display:block;font-size:22px;font-variant-numeric:tabular-nums;font-weight:800;color:var(--tx)}" +
      ".x97-msg-stat span{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);font-weight:800}" +
      ".x97-msg-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px}" +
      "@media(max-width:420px){.x97-msg-tiles{grid-template-columns:1fr}}" +
      ".x97-msg-tile{display:flex;align-items:center;gap:11px;text-align:left;border:1px solid var(--line);background:var(--card);border-radius:15px;padding:13px;cursor:pointer;transition:border-color .15s,transform .1s}" +
      ".x97-msg-tile:active{transform:scale(.98)}.x97-msg-tile:hover{border-color:var(--line2)}" +
      ".x97-msg-tile-icon{width:38px;height:38px;min-width:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;background:var(--card2);color:var(--pos)}" +
      ".x97-msg-tile-icon.bad{background:rgba(229,72,77,.12);color:var(--neg)}" +
      ".x97-msg-tile-body{flex:1;min-width:0}.x97-msg-tile-title{font-size:13px;font-weight:800;color:var(--tx)}.x97-msg-tile-sub{font-size:10.5px;color:var(--tx3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".x97-msg-tile-badge{min-width:22px;height:22px;border-radius:99px;background:var(--card2);color:var(--tx2);font-size:11px;font-weight:850;display:flex;align-items:center;justify-content:center;padding:0 6px}" +
      ".x97-msg-tile-badge.bad{background:var(--neg);color:#fff}" +
      "@keyframes x97TileIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}" +
      ".x97-msg-tile{animation:x97TileIn .32s cubic-bezier(.22,1,.36,1) backwards}" +
      ".x97-msg-tile:nth-child(1){animation-delay:.03s}.x97-msg-tile:nth-child(2){animation-delay:.07s}.x97-msg-tile:nth-child(3){animation-delay:.11s}.x97-msg-tile:nth-child(4){animation-delay:.15s}" +
      "@keyframes x97StatIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}" +
      ".x97-msg-stat{animation:x97StatIn .3s cubic-bezier(.22,1,.36,1) backwards}" +
      ".x97-msg-stat:nth-child(1){animation-delay:0s}.x97-msg-stat:nth-child(2){animation-delay:.04s}.x97-msg-stat:nth-child(3){animation-delay:.08s}" +
      "@media(prefers-reduced-motion:reduce){.x97-msg-tile,.x97-msg-stat{animation:none}}";
    var s = document.createElement("style"); s.id = "x97-msg-css"; s.textContent = css; document.head.appendChild(s);
  }

  /* ============================ Bulk messaging / campaigns ============================ */

  function campLists(doc) { return doc.waLists || []; }
  function campContacts(doc) { return doc.waContacts || []; }
  function campCampaigns(doc) { return doc.waCampaigns || []; }

  function parseCSV(text) {
    text = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
    if (!text.trim()) return { headers: [], rows: [] };
    var first = text.split("\n")[0];
    var delim = ",";
    if (first.split("\t").length > first.split(",").length) delim = "\t";
    else if (first.split(";").length > first.split(",").length) delim = ";";
    var lines = [], cur = [], field = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else if (c === '"') inQ = true;
      else if (c === delim) { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); lines.push(cur); cur = []; field = ""; }
      else field += c;
    }
    cur.push(field); lines.push(cur);
    var headers = (lines.shift() || []).map(function (h) { return String(h).trim(); });
    var rows = lines.filter(function (l) { return l.some(function (v) { return String(v).trim(); }); }).map(function (l) {
      var o = {}; headers.forEach(function (h, idx) { o[h] = (l[idx] == null ? "" : String(l[idx]).trim()); }); return o;
    });
    return { headers: headers, rows: rows };
  }

  function detectPhoneCol(headers, rows) {
    var byName = headers.find(function (h) { return /phone|number|tel|whats|mobile|cell|contact|msisdn/i.test(h); });
    if (byName) return byName;
    var best = "", bestScore = 0;
    headers.forEach(function (h) {
      var digits = 0, n = 0;
      rows.slice(0, 20).forEach(function (r) { var v = String(r[h] || ""); if (!v) return; n++; if (v.replace(/[^\d]/g, "").length >= 7) digits++; });
      var score = n ? digits / n : 0;
      if (score > bestScore) { bestScore = score; best = h; }
    });
    return bestScore >= 0.6 ? best : (headers[0] || "");
  }
  function detectNameCol(headers, phoneCol) {
    var byName = headers.find(function (h) { return /name|client|customer|contact|company/i.test(h) && h !== phoneCol; });
    if (byName) return byName;
    return headers.find(function (h) { return h !== phoneCol; }) || headers[0] || "";
  }

  function resolveMessage(tpl, contact) {
    var s = String(tpl || "");
    s = s.replace(/\{([^{}|]*\|[^{}]*)\}/g, function (_, body) { var p = body.split("|"); return p[Math.floor(Math.random() * p.length)]; });
    s = s.replace(/\{\{\s*([\w .\-]+?)\s*\}\}/g, function (_, key) {
      var k = key.toLowerCase();
      if (k === "name") return contact.name || "";
      if (k === "phone") return contact.phone || "";
      var f = contact.fields || {};
      for (var fk in f) { if (fk.toLowerCase() === k) return f[fk] == null ? "" : String(f[fk]); }
      return "";
    });
    return s;
  }

  function audienceContacts(doc, audience) {
    if (!audience) return [];
    if (audience.type === "overdue") {
      return (doc.followups || []).filter(isOpenFollowup).filter(function (x) { var t = timing(x); return (t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7)) && hasWa(x, doc); }).map(function (x) {
        var t = timing(x), cur = String(x.currency || "UGX").toUpperCase();
        return { id: "od_" + x.id, name: x.client || "", phone: x.phone || "", fields: { amount: num(x.amount) ? money(x.amount, cur) : "", currency: cur, date: x.expectedBy ? formatDate(x.expectedBy, false) : "", days: (t.days != null && t.days < 0) ? String(Math.abs(t.days)) : "0", project: x.client || "" } };
      });
    }
    if (audience.type === "manual") {
      return String(campaignState.manualNumbers || "").split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s, i) { return { id: "m_" + i + "_" + s.replace(/\D/g, ""), name: "", phone: s, fields: {} }; });
    }
    var contacts = campContacts(doc);
    if (audience.type === "all") return contacts.slice();
    if (audience.type === "list") return contacts.filter(function (c) { return (c.lists || []).indexOf(audience.id) >= 0; });
    return [];
  }
  function campSafety(doc) {
    var p = ANTIBLOCK[campaignState.antiblock] || ANTIBLOCK.balanced;
    return { dailyCap: (doc.settings && doc.settings.waSafety && num(doc.settings.waSafety.dailyCap)) || 200, minDelay: p.min, maxDelay: p.max, batchSize: p.batch, batchBreak: p.brk, quietStart: "", quietEnd: "", warmup: campaignState.antiblock !== "fast", knownOnly: false };
  }
  function stampMessage(msg) {
    if (!campaignState.timestamp) return msg;
    try { return msg + "\n\n" + new Date().toLocaleString(); } catch (_) { return msg; }
  }
  function renderWaFormat(text) {
    var s = esc(text);
    s = s.replace(/```([\s\S]+?)```/g, '<code>$1</code>');
    s = s.replace(/(^|\s)\*(\S[^*]*?\S|\S)\*(?=\s|$)/g, '$1<b>$2</b>');
    s = s.replace(/(^|\s)_(\S[^_]*?\S|\S)_(?=\s|$)/g, '$1<i>$2</i>');
    s = s.replace(/(^|\s)~(\S[^~]*?\S|\S)~(?=\s|$)/g, '$1<s>$2</s>');
    return s.replace(/\n/g, "<br>");
  }
  function campTemplates(doc) { return (doc.settings && doc.settings.waTemplates) || []; }
  function audienceLabel(doc, audience) {
    if (!audience) return "No audience";
    if (audience.type === "overdue") return "Overdue clients";
    if (audience.type === "all") return "All contacts";
    var l = campLists(doc).find(function (x) { return x.id === audience.id; });
    return l ? l.name : "List";
  }
  function variableKeys(doc) {
    var c = audienceContacts(doc, campaignState.audience)[0];
    var keys = ["name", "phone"];
    if (c && c.fields) Object.keys(c.fields).forEach(function (k) { if (k && keys.indexOf(k) < 0) keys.push(k); });
    return keys;
  }
  function campaignJobs(doc) {
    var cc = campaignState.countryCode;
    var jobs = audienceContacts(doc, campaignState.audience).map(function (c) {
      var phone = waNumber(c.phone, doc, cc);
      return { id: c.id, cid: c.id, name: c.name, phone: phone, message: stampMessage(resolveMessage(campaignState.message, c)), valid: phone.length >= 10 };
    }).filter(function (j) { return j.valid; });
    if (campaignState.dupRemoval) { var seen = {}; jobs = jobs.filter(function (j) { if (seen[j.phone]) return false; seen[j.phone] = 1; return true; }); }
    return jobs;
  }

  function persistCampaign() {
    var id = campaignState.editId || uid("camp");
    var rec = { id: id, name: (campaignState.name || "Untitled campaign").trim(), message: campaignState.message, audience: campaignState.audience, mode: campaignState.mode, createdAt: campaignState.createdAt || new Date().toISOString() };
    updateDoc(function (doc) {
      doc.waCampaigns = doc.waCampaigns || [];
      var i = doc.waCampaigns.findIndex(function (c) { return c.id === id; });
      if (i >= 0) doc.waCampaigns[i] = Object.assign({}, doc.waCampaigns[i], rec);
      else doc.waCampaigns.unshift(Object.assign({ log: [], stats: { sent: 0, failed: 0, skipped: 0 } }, rec));
    }, "camp-save");
    campaignState.editId = id; campaignState.createdAt = rec.createdAt;
    return id;
  }
  function logCampaignResult(campaignId, cid, status) {
    updateDoc(function (doc) {
      var c = (doc.waCampaigns || []).find(function (x) { return x.id === campaignId; });
      if (!c) return;
      c.log = c.log || []; c.stats = c.stats || { sent: 0, failed: 0, skipped: 0 };
      var job = campaignState.jobsById && campaignState.jobsById[cid];
      c.log = c.log.filter(function (e) { return e.cid !== cid; });
      c.log.push({ cid: cid, name: job ? job.name : "", phone: job ? job.phone : "", status: status, at: new Date().toISOString() });
      var s = { sent: 0, skipped: 0, failed: 0 };
      c.log.forEach(function (e) { if (e.status === "sent") s.sent++; else if (e.status === "skipped") s.skipped++; else s.failed++; });
      c.stats = s;
    }, "camp-log");
  }

  function startCampaign(mode) {
    var doc = readDoc();
    if (!campaignState.message.trim()) { toast("Write a message first", "error"); return; }
    var jobs = campaignJobs(doc);
    if (!jobs.length) { toast("No valid numbers in this audience", "error"); return; }
    var id = persistCampaign();
    campaignState.runId = id; campaignState.jobs = jobs; campaignState.progress = {};
    campaignState.jobsById = {}; jobs.forEach(function (j) { campaignState.jobsById[j.id] = j; });
    campaignState.oneTapIdx = 0;
    if (mode === "auto") {
      if (!remindExt.ready) { toast("Install the 97 Sender extension for Auto", "error"); return; }
      jobs.forEach(function (j) { campaignState.progress[j.id] = "queued"; });
      campaignState.sending = true;
      window.postMessage({ source: "x97-wa-app", type: "enqueue", jobs: jobs.map(function (j) { return { id: j.id, phone: j.phone, name: j.name, message: j.message }; }), safety: campSafety(doc) }, "*");
      toast("Sending " + jobs.length + " — keep WhatsApp Web open", "");
      campaignState.view = "report"; refreshCamp();
    } else {
      campaignState.view = "report"; refreshCamp();
      sendCampaignOneTapNext();
    }
  }
  function sendCampaignOneTapNext() {
    var jobs = campaignState.jobs || [];
    while (campaignState.oneTapIdx < jobs.length && campaignState.progress[jobs[campaignState.oneTapIdx].id] === "sent") campaignState.oneTapIdx++;
    if (campaignState.oneTapIdx >= jobs.length) { toast("Campaign complete", ""); refreshCamp(); return; }
    var job = jobs[campaignState.oneTapIdx];
    window.open("https://wa.me/" + job.phone + "?text=" + encodeURIComponent(job.message), "_blank");
    campaignState.progress[job.id] = "sent";
    logCampaignResult(campaignState.runId, job.id, "sent");
    campaignState.oneTapIdx++;
    refreshCamp();
  }
  function handleCampaignProgress(d) {
    campaignState.progress[d.id] = d.status;
    if (d.status === "sent" || d.status === "skipped" || d.status === "error") logCampaignResult(campaignState.runId, d.id, d.status);
    if (campaignState.open) refreshCamp();
  }

  function importContacts(parsed, nameCol, phoneCol, listName) {
    var doc = readDoc(), added = 0, skipped = 0;
    var listId = uid("list");
    updateDoc(function (d) {
      d.waLists = d.waLists || []; d.waContacts = d.waContacts || [];
      d.waLists.unshift({ id: listId, name: (listName || "Imported list").trim(), createdAt: new Date().toISOString() });
      var byPhone = {}; d.waContacts.forEach(function (c) { var k = waNumber(c.phone, d); if (k) byPhone[k] = c; });
      parsed.rows.forEach(function (r) {
        var phoneRaw = r[phoneCol] || ""; var norm = waNumber(phoneRaw, d);
        if (norm.length < 10) { skipped++; return; }
        var fields = {}; Object.keys(r).forEach(function (h) { if (h !== phoneCol) fields[h] = r[h]; });
        var name = (r[nameCol] || "").trim() || phoneRaw;
        var existing = byPhone[norm];
        if (existing) { existing.lists = existing.lists || []; if (existing.lists.indexOf(listId) < 0) existing.lists.push(listId); existing.fields = Object.assign({}, fields, existing.fields); existing.name = existing.name || name; }
        else { var nc = { id: uid("ct"), name: name, phone: phoneRaw, fields: fields, lists: [listId] }; d.waContacts.push(nc); byPhone[norm] = nc; }
        added++;
      });
    }, "camp-import");
    return { listId: listId, added: added, skipped: skipped };
  }

  function downloadCSV(filename, csv) {
    try {
      var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (_) { toast("Could not export", "error"); }
  }
  function exportCampaignCSV(id) {
    var doc = readDoc(); var c = campCampaigns(doc).find(function (x) { return x.id === id; }); if (!c) return;
    var rows = [["name", "phone", "status", "at"]].concat((c.log || []).map(function (e) { return [e.name, e.phone, e.status, e.at]; }));
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? "" : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","); }).join("\n");
    downloadCSV((c.name || "campaign").replace(/[^\w]+/g, "-").toLowerCase() + "-report.csv", csv);
  }

  function openCampaigns(startCompose) {
    injectRemindCSS(); injectCampCSS();
    campaignState.open = true; campaignState.view = "home"; campaignState.progress = {}; campaignState.sending = false;
    var el = document.getElementById("x97-camp");
    if (!el) { el = document.createElement("div"); el.id = "x97-camp"; el.className = "x97-remind-overlay"; document.body.appendChild(el); wireCamp(el); }
    document.body.classList.add("x97-remind-lock");
    refreshCamp();
    if (startCompose) onCampAction("new");
  }
  function closeCampaigns() { campaignState.open = false; var el = document.getElementById("x97-camp"); if (el) el.remove(); if (!remindState.open && !document.getElementById("x97-msg")) document.body.classList.remove("x97-remind-lock"); }
  var campRefreshing = false;
  function refreshCamp() {
    if (campRefreshing) return;
    var el = document.getElementById("x97-camp"); if (!el || !campaignState.open) return;
    var doc = readDoc(); if (!doc) return;
    var active = document.activeElement; if (active && el.contains(active) && active.blur) { try { active.blur(); } catch (_) {} }
    campRefreshing = true;
    try { el.innerHTML = campOverlayHTML(doc); } finally { campRefreshing = false; }
  }

  function campOverlayHTML(doc) {
    var v = campaignState.view;
    var head = function (title, sub, back, backLabel) {
      return '<header class="x97-rm-header"><div class="x97-rm-htop"><div>' + (back ? '<button class="x97-rm-link" data-camp="' + back + '" style="margin-bottom:4px">‹ ' + esc(backLabel || "Back") + '</button>' : '') + '<div class="x97-rm-title">' + brandMark(16) + ' ' + esc(title) + '</div><div class="x97-rm-sub">' + esc(sub) + '</div></div><button class="x97-rm-close" data-camp="close">' + icon("close") + '</button></div></header>';
    };
    var inner;
    if (v === "import") inner = head("Import contacts", "Paste a CSV or choose a file", "home") + campImportHTML(doc);
    else if (v === "compose") inner = head(campaignState.editId ? "Edit campaign" : "New campaign", "Compose and send", "home") + campComposeHTML(doc);
    else if (v === "report") inner = head(campaignState.name || "Campaign", "Delivery report", campaignState.sending ? "" : "home") + campReportHTML(doc);
    else inner = head("Campaigns", campContacts(doc).length + " contacts · " + campLists(doc).length + " lists", "hub", "Messaging") + campHomeHTML(doc);
    return '<div class="x97-remind-panel">' + inner + '</div>';
  }

  /* ---- Google Contacts import (client-side OAuth, no server) ---- */

  var GOOGLE_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
  var googleTokenClient = null;

  function loadGIS() {
    return new Promise(function (resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
      var existing = document.getElementById("x97-gis-script");
      if (existing) { existing.addEventListener("load", function () { resolve(); }); existing.addEventListener("error", reject); return; }
      var s = document.createElement("script");
      s.id = "x97-gis-script"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
      s.onload = function () { resolve(); }; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function fetchGoogleContacts(accessToken) {
    var all = [];
    function page(pageToken) {
      var url = "https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers&pageSize=1000" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
      return fetch(url, { headers: { Authorization: "Bearer " + accessToken } }).then(function (r) {
        return r.json().then(function (data) {
          if (!r.ok) throw new Error((data.error && data.error.message) || ("Google API error " + r.status));
          (data.connections || []).forEach(function (p) {
            var name = (p.names && p.names[0] && p.names[0].displayName) || "";
            (p.phoneNumbers || []).forEach(function (ph) { if (ph.value) all.push({ name: name, phone: ph.value }); });
          });
          return data.nextPageToken ? page(data.nextPageToken) : all;
        });
      });
    }
    return page("");
  }

  function connectGoogleContacts() {
    var doc = readDoc();
    var clientId = (doc.settings && doc.settings.googleClientId) || "";
    if (!clientId) return openGoogleSetup();
    toast("Opening Google sign-in…", "");
    loadGIS().then(function () {
      googleTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: function (resp) {
          if (!resp || resp.error) { toast("Google sign-in was cancelled or failed" + (resp && resp.error ? " (" + resp.error + ")" : ""), "error"); return; }
          toast("Fetching your Google contacts…", "");
          fetchGoogleContacts(resp.access_token).then(function (contacts) {
            if (!contacts.length) { toast("No phone numbers found in your Google contacts", "error"); return; }
            var parsed = { headers: ["name", "phone"], rows: contacts };
            var res = importContacts(parsed, "name", "phone", "Google Contacts");
            toast(res.added + " imported from Google" + (res.skipped ? ", " + res.skipped + " skipped (no number)" : ""), "");
            if (campaignState.open) refreshCamp();
            refreshMsgHub();
          }).catch(function (err) { toast("Could not read Google contacts: " + err.message, "error"); });
        }
      });
      googleTokenClient.requestAccessToken({ prompt: "" });
    }).catch(function () { toast("Could not load Google sign-in — check your connection", "error"); });
  }

  function openGoogleSetup() {
    var doc = readDoc();
    var body = '<div class="x97-help" style="margin-bottom:12px">Connects your real Google Contacts (name + phone) into a list here. This needs a free, one-time <b>Google API Client ID</b> for your own copy of the app — same idea as the Anthropic key for the AI Copilot. See the setup guide, then paste the Client ID below.</div>' +
      '<form id="x97-google-form" data-x97-form="google-setup">' +
      field("Google OAuth Client ID", '<input class="x97-input" name="clientId" value="' + attr((doc.settings && doc.settings.googleClientId) || "") + '" placeholder="xxxxxxxxxxxx.apps.googleusercontent.com">', "Ends in .apps.googleusercontent.com — from Google Cloud Console → Credentials.") +
      '</form>';
    var foot = '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-google-form">' + icon("check") + ' Save &amp; connect</button>';
    openSheet("Connect Google Contacts", body, foot);
  }
  function submitGoogleSetup(form) {
    var v = formValues(form), clientId = (v.clientId || "").trim();
    updateDoc(function (doc) { doc.settings = doc.settings || {}; doc.settings.googleClientId = clientId; }, "google-setup");
    closeSheet();
    if (clientId) connectGoogleContacts();
  }

  function campHomeHTML(doc) {
    var lists = campLists(doc), campaigns = campCampaigns(doc);
    var od = audienceContacts(doc, { type: "overdue" }).length;
    var listRows = lists.map(function (l) {
      var n = campContacts(doc).filter(function (c) { return (c.lists || []).indexOf(l.id) >= 0; }).length;
      return '<div class="x97-camp-list"><div class="x97-camp-list-main" data-camp="use-list" data-id="' + attr(l.id) + '"><div class="x97-rm-name">' + esc(l.name) + '</div><div class="x97-rm-sub">' + n + ' contacts</div></div><button class="x97-rm-tool" data-camp="del-list" data-id="' + attr(l.id) + '">' + icon("trash", 13) + '</button></div>';
    }).join("");
    var histRows = campaigns.length ? campaigns.map(function (c) {
      var st = c.stats || { sent: 0 }, total = (c.log || []).length;
      return '<button class="x97-camp-hist" data-camp="report" data-id="' + attr(c.id) + '"><div style="flex:1;min-width:0"><div class="x97-rm-name">' + esc(c.name || "Untitled") + '</div><div class="x97-rm-sub">' + esc(audienceLabel(doc, c.audience)) + ' · ' + (st.sent || 0) + ' sent' + (st.failed ? ' · ' + st.failed + ' failed' : '') + '</div></div>' + icon("chevron") + '</button>';
    }).join("") : '<div class="x97-empty x97-brand-empty" style="padding:18px 6px">' + brandMark(32, "x97-brand-watermark") + '<div class="x97-rm-sub">No campaigns yet.</div></div>';
    return '<div class="x97-rm-list">' +
      '<button class="x97-btn primary" data-camp="new" style="width:100%;justify-content:center;margin-bottom:14px">' + icon("plus") + ' New campaign</button>' +
      '<div class="x97-camp-sec">Audiences</div>' +
      '<div class="x97-camp-list"><div class="x97-camp-list-main" data-camp="use-overdue"><div class="x97-rm-name">Overdue clients</div><div class="x97-rm-sub">Auto-built from your finances · ' + od + ' with a number</div></div><span class="x97-pill">smart</span></div>' +
      listRows +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="x97-rm-tool" data-camp="import">' + icon("plus", 13) + ' Import contacts (CSV)</button><button class="x97-rm-tool" data-camp="google-connect"><span class="x97-google-g">G</span> Connect Google Contacts</button>' + (campContacts(doc).length ? '<button class="x97-rm-tool" data-camp="match-numbers">' + icon("phone", 13) + ' Match against overdue clients</button>' : '') + '</div>' +
      '<div class="x97-camp-sec" style="margin-top:18px">Campaigns</div>' + histRows +
      '</div>';
  }

  function campImportHTML(doc) {
    var parsed = campaignState.importText ? parseCSV(campaignState.importText) : { headers: [], rows: [] };
    var mapping = "";
    if (parsed.headers.length) {
      var phoneCol = campaignState.phoneCol || detectPhoneCol(parsed.headers, parsed.rows);
      var nameCol = campaignState.nameCol || detectNameCol(parsed.headers, phoneCol);
      var valid = parsed.rows.filter(function (r) { return waNumber(r[phoneCol] || "", doc).length >= 10; }).length;
      var opts = function (sel) { return parsed.headers.map(function (h) { return option(h, h, sel); }).join(""); };
      mapping = '<div class="x97-camp-map"><div class="x97-fields-2">' +
        field("Name column", '<select class="x97-select x97-camp-namecol">' + opts(nameCol) + '</select>') +
        field("Phone column", '<select class="x97-select x97-camp-phonecol">' + opts(phoneCol) + '</select>') + '</div>' +
        '<div class="x97-help"><b>' + parsed.rows.length + '</b> rows · <b>' + valid + '</b> valid WhatsApp numbers detected.</div></div>';
    }
    return '<div class="x97-rm-list">' +
      field("List name", '<input class="x97-input x97-camp-listname" value="' + attr(campaignState.listName || "") + '" placeholder="e.g. October leads">') +
      '<label class="x97-rm-tool" style="display:inline-flex;margin-bottom:8px;cursor:pointer">' + icon("plus", 13) + ' Choose CSV file<input type="file" class="x97-camp-file" accept=".csv,.tsv,.txt,text/csv" style="display:none"></label>' +
      field("…or paste rows", '<textarea class="x97-textarea x97-camp-import" rows="6" placeholder="name,phone,amount&#10;Apollo,0772123456,500000">' + esc(campaignState.importText || "") + '</textarea>', "First row must be column headers. Comma, tab or semicolon separated.") +
      mapping +
      '<button class="x97-btn primary" data-camp="do-import" ' + (parsed.rows.length ? "" : "disabled") + ' style="width:100%;justify-content:center;margin-top:6px">' + icon("check") + ' Import ' + (parsed.rows.length ? parsed.rows.length + " contacts" : "") + '</button>' +
      '</div>';
  }

  function campComposeHTML(doc) {
    var contacts = audienceContacts(doc, campaignState.audience);
    var valid = campaignJobs(doc).length;
    var lists = campLists(doc);
    var audVal = campaignState.audience.type + ":" + (campaignState.audience.id || "");
    var audOpts = option("overdue:", "Overdue clients (" + audienceContacts(doc, { type: "overdue" }).length + ")", audVal) +
      lists.map(function (l) { var n = campContacts(doc).filter(function (c) { return (c.lists || []).indexOf(l.id) >= 0; }).length; return option("list:" + l.id, l.name + " (" + n + ")", audVal); }).join("") +
      option("all:", "All contacts (" + campContacts(doc).length + ")", audVal) +
      option("manual:", "Type numbers manually", audVal);

    /* ---- Message block ---- */
    var tplMenu = campaignState.showTemplates ? '<div class="x97-ws-menu">' +
      (campTemplates(doc).length ? campTemplates(doc).map(function (t) { return '<button class="x97-ws-menu-item" data-camp="load-tpl" data-id="' + attr(t.id) + '">' + esc(t.name) + '</button>'; }).join("") : '<div class="x97-ws-menu-empty">No saved templates yet</div>') +
      '<button class="x97-ws-menu-item save" data-camp="save-tpl">＋ Save current as template</button></div>' : "";
    var varMenu = campaignState.showVars ? '<div class="x97-ws-menu">' + variableKeys(doc).map(function (k) { return '<button class="x97-ws-menu-item" data-camp="var" data-var="' + attr(k) + '">{{' + esc(k) + '}}</button>'; }).join("") + '<button class="x97-ws-menu-item" data-camp="var" data-var="__spin">{Hi|Hello|Hey} spin</button></div>' : "";
    var emojiMenu = campaignState.showEmoji ? '<div class="x97-ws-emoji">' + EMOJIS.map(function (e) { return '<button class="x97-ws-emoji-b" data-camp="emoji" data-e="' + attr(e) + '">' + e + '</button>'; }).join("") + '</div>' : "";
    var toolbar = '<div class="x97-ws-tools">' +
      '<button class="x97-ws-tool" data-camp="attach" title="Attach">' + icon("plus", 14) + ' Attachment</button>' +
      '<div class="x97-ws-tw"><button class="x97-ws-tool ' + (campaignState.showTemplates ? "on" : "") + '" data-camp="tpl-menu">' + icon("edit", 14) + ' Templates ▾</button>' + tplMenu + '</div>' +
      '<div class="x97-ws-tw"><button class="x97-ws-tool ' + (campaignState.showVars ? "on" : "") + '" data-camp="var-menu">@value ▾</button>' + varMenu + '</div>' +
      '<button class="x97-ws-b" data-camp="fmt" data-m="*" title="Bold"><b>B</b></button>' +
      '<button class="x97-ws-b" data-camp="fmt" data-m="_" title="Italic"><i>I</i></button>' +
      '<button class="x97-ws-b" data-camp="fmt" data-m="~" title="Strikethrough"><s>S</s></button>' +
      '<button class="x97-ws-b" data-camp="fmt" data-m="```" title="Monospace">&lt;/&gt;</button>' +
      '<div class="x97-ws-tw"><button class="x97-ws-b ' + (campaignState.showEmoji ? "on" : "") + '" data-camp="emoji-menu" title="Emoji">😀</button>' + emojiMenu + '</div>' +
      '<button class="x97-ws-tool ' + (campaignState.showPreview ? "on" : "") + '" data-camp="preview-toggle" style="margin-left:auto">' + icon("send", 13) + ' Format test</button>' +
      '</div>';
    var preview = "";
    if (campaignState.showPreview && contacts.length) {
      var pc = contacts[campaignState.previewIdx % contacts.length];
      preview = '<div class="x97-camp-preview"><div class="x97-rm-sub" style="margin-bottom:6px">Preview → <b>' + esc(pc.name || pc.phone) + '</b> <button class="x97-rm-link" data-camp="shuffle">shuffle ↻</button></div><div class="x97-ws-bubble">' + renderWaFormat(stampMessage(resolveMessage(campaignState.message, pc))) + '</div><div class="x97-ws-signoff">' + brandMark(13) + ' Sent via 97 LIVE Messaging</div></div>';
    }
    var msgBlock = '<div class="x97-ws-card"><div class="x97-ws-h">' + icon("edit", 15) + ' Message</div>' + toolbar +
      '<textarea class="x97-textarea x97-camp-msg" rows="5" placeholder="Enter message  ·  Hi {{name}}, …  ·  {Hi|Hello} adds variety">' + esc(campaignState.message) + '</textarea>' + preview + '</div>';

    /* ---- Antiblock block ---- */
    var ab = ANTIBLOCK[campaignState.antiblock] || ANTIBLOCK.balanced;
    var seg = '<div class="x97-ws-seg">' + ["conservative", "balanced", "fast"].map(function (k) { return '<button data-camp="antiblock" data-k="' + k + '" class="' + (campaignState.antiblock === k ? "on" : "") + '">' + ANTIBLOCK[k].label + '</button>'; }).join("") + '</div>';
    var detail = campaignState.showDetail ? '<div class="x97-ws-detail">' +
      '<div class="x97-ws-note">' + ab.note + '</div>' +
      field("Country code (for numbers without one)", '<input class="x97-input x97-camp-cc" inputmode="numeric" value="' + attr(campaignState.countryCode || waCountry(doc)) + '" placeholder="256">') +
      '<label class="x97-ws-switch"><input type="checkbox" class="x97-camp-dup" ' + (campaignState.dupRemoval ? "checked" : "") + '><span><b>Duplicate removal</b><br>Skip repeated numbers to avoid double-messaging.</span></label>' +
      '<label class="x97-ws-switch"><input type="checkbox" class="x97-camp-ts" ' + (campaignState.timestamp ? "checked" : "") + '><span><b>Add timestamp</b><br>Append the date &amp; time to each message.</span></label>' +
      '</div>' : "";
    var antiblock = '<div class="x97-ws-card"><div class="x97-ws-h"><span>' + icon("shield", 15) + ' Antiblock: <b>' + ab.label + '</b></span><button class="x97-rm-link" data-camp="detail-toggle">' + (campaignState.showDetail ? "Hide detail ▲" : "Show detail ▼") + '</button></div>' + seg + detail + '</div>';

    /* ---- Phone Numbers block ---- */
    var recipInner = campaignState.audience.type === "manual"
      ? '<textarea class="x97-textarea x97-camp-manual" rows="4" placeholder="One number per line (with or without country code)&#10;0772123456&#10;+256700111222">' + esc(campaignState.manualNumbers || "") + '</textarea>'
      : field("Send to", '<select class="x97-select x97-camp-aud">' + audOpts + '</select>');
    var recipients = '<div class="x97-ws-card"><div class="x97-ws-h"><span>' + icon("phone", 15) + ' Phone Numbers</span><button class="x97-ws-tool" data-camp="import">' + icon("plus", 13) + ' Import Contacts</button></div>' +
      (campaignState.audience.type === "manual" ? '<div class="x97-rm-sub" style="margin:0 0 8px"><button class="x97-rm-link" data-camp="use-saved">‹ use a saved list instead</button></div>' : "") +
      recipInner +
      '<div class="x97-ws-count"><b class="x97-green">' + valid + '</b> recipient' + (valid === 1 ? "" : "s") + ' will receive this' + (contacts.length > valid ? ' · ' + (contacts.length - valid) + ' skipped (no number or duplicate)' : '') + '</div></div>';

    /* ---- Action bar ---- */
    var modeSeg = '<div class="x97-ws-seg small"><button data-camp="mode-onetap" class="' + (campaignState.mode === "onetap" ? "on" : "") + '">One-tap</button><button data-camp="mode-auto" class="' + (campaignState.mode === "auto" ? "on" : "") + '">Auto</button></div>';
    var sendBtn = campaignState.mode === "auto"
      ? (remindExt.ready ? '<button class="x97-btn primary" data-camp="send" ' + (valid ? "" : "disabled") + '>' + icon("send") + ' Send now (' + valid + ')</button>' : '<button class="x97-btn primary" disabled style="opacity:.55">Open WhatsApp Web first</button>')
      : '<button class="x97-btn primary" data-camp="send" ' + (valid ? "" : "disabled") + '>' + icon("send") + ' Send now (' + valid + ')</button>';

    return '<div class="x97-rm-list">' +
      field("Campaign name", '<input class="x97-input x97-camp-name" value="' + attr(campaignState.name || "") + '" placeholder="e.g. October promo">') +
      msgBlock + antiblock + recipients +
      '<div class="x97-ws-modebar"><span class="x97-rm-sub">Send mode</span>' + modeSeg + '</div>' +
      '<div class="x97-ws-actions"><button class="x97-btn" data-camp="reset-compose">' + icon("trash", 14) + ' Reset</button><button class="x97-btn" data-camp="save">' + icon("check", 14) + ' Save</button>' + sendBtn + '</div>' +
      '</div>';
  }

  function campReportHTML(doc) {
    var c = campaignState.runId ? campCampaigns(doc).find(function (x) { return x.id === campaignState.runId; }) : (campaignState.editId ? campCampaigns(doc).find(function (x) { return x.id === campaignState.editId; }) : null);
    var jobs = campaignState.jobs || [];
    var st = (c && c.stats) || { sent: 0, failed: 0, skipped: 0 };
    var total = jobs.length || (c ? (c.log || []).length : 0);
    var progressing = campaignState.sending || (jobs.length && campaignState.oneTapIdx < jobs.length);
    var rows;
    if (jobs.length) {
      rows = jobs.map(function (j) { var p = campaignState.progress[j.id]; return '<div class="x97-camp-logrow"><div style="flex:1;min-width:0"><div class="x97-rm-name">' + esc(j.name || j.phone) + '</div><div class="x97-rm-sub">' + esc(j.phone) + '</div></div><span class="x97-pill ' + (p === "sent" ? "good" : p === "error" ? "bad" : p ? "warn" : "") + '">' + esc(p ? progLabel(p) : "waiting") + '</span></div>'; }).join("");
    } else if (c) {
      rows = (c.log || []).map(function (e) { return '<div class="x97-camp-logrow"><div style="flex:1;min-width:0"><div class="x97-rm-name">' + esc(e.name || e.phone) + '</div><div class="x97-rm-sub">' + esc(e.phone) + '</div></div><span class="x97-pill ' + (e.status === "sent" ? "good" : e.status === "error" ? "bad" : "warn") + '">' + esc(progLabel(e.status)) + '</span></div>'; }).join("") || '<div class="x97-rm-sub">No sends logged yet.</div>';
    } else rows = '<div class="x97-rm-sub">Nothing to show.</div>';
    var tiles = '<div class="x97-camp-tiles"><div><b class="x97-green">' + (st.sent || 0) + '</b><span>Sent</span></div><div><b>' + total + '</b><span>Total</span></div><div><b class="' + (st.failed ? "x97-red" : "") + '">' + (st.failed || 0) + '</b><span>Failed</span></div><div><b>' + (st.skipped || 0) + '</b><span>Skipped</span></div></div>';
    var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
      (campaignState.mode !== "auto" && progressing ? '<button class="x97-btn primary" data-camp="onetap-next">' + icon("message") + ' Open next in WhatsApp</button>' : '') +
      (c ? '<button class="x97-btn" data-camp="export" data-id="' + attr(c.id) + '">' + icon("arrow") + ' Export CSV</button>' : '') + '</div>';
    return '<div class="x97-rm-list">' + tiles + actions + '<div class="x97-camp-sec" style="margin-top:16px">Recipients</div>' + rows + '</div>';
  }

  function insertAtCursor(token) {
    var ta = document.querySelector("#x97-camp .x97-camp-msg");
    if (ta) {
      var s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e = ta.selectionEnd == null ? ta.value.length : ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + token + ta.value.slice(e);
      campaignState.message = ta.value; ta.focus(); var pos = s + token.length; ta.setSelectionRange(pos, pos);
      var bub = document.querySelector("#x97-camp .x97-ws-bubble"); if (bub) { var doc = readDoc(); var cs = audienceContacts(doc, campaignState.audience); if (cs.length) bub.innerHTML = renderWaFormat(stampMessage(resolveMessage(campaignState.message, cs[campaignState.previewIdx % cs.length]))); }
    } else { campaignState.message += token; refreshCamp(); }
  }
  function insertVar(key) { insertAtCursor(key === "__spin" ? "{Hi|Hello|Hey}" : "{{" + key + "}}"); }
  function wrapSelection(marker) {
    var ta = document.querySelector("#x97-camp .x97-camp-msg"); if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || "text";
    ta.value = ta.value.slice(0, s) + marker + sel + marker + ta.value.slice(e);
    campaignState.message = ta.value; ta.focus();
    ta.setSelectionRange(s + marker.length, s + marker.length + sel.length);
  }

  function wireCamp(el) {
    el.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-camp]"); if (!b || !el.contains(b)) return;
      onCampAction(b.dataset.camp, b);
    });
    el.addEventListener("input", function (e) {
      var t = e.target;
      if (t.classList.contains("x97-camp-msg")) { campaignState.message = t.value; var bub = el.querySelector(".x97-ws-bubble"); if (bub) { var doc = readDoc(); var cs = audienceContacts(doc, campaignState.audience); if (cs.length) bub.innerHTML = renderWaFormat(stampMessage(resolveMessage(campaignState.message, cs[campaignState.previewIdx % cs.length]))); } return; }
      if (t.classList.contains("x97-camp-name")) { campaignState.name = t.value; return; }
      if (t.classList.contains("x97-camp-manual")) { campaignState.manualNumbers = t.value; return; }
      if (t.classList.contains("x97-camp-cc")) { campaignState.countryCode = t.value; return; }
      if (t.classList.contains("x97-camp-import")) { campaignState.importText = t.value; campaignState.nameCol = ""; campaignState.phoneCol = ""; refreshCamp(); return; }
      if (t.classList.contains("x97-camp-listname")) { campaignState.listName = t.value; return; }
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t.classList.contains("x97-camp-aud")) { var parts = t.value.split(":"); campaignState.audience = { type: parts[0], id: parts[1] || "" }; campaignState.previewIdx = 0; refreshCamp(); return; }
      if (t.classList.contains("x97-camp-namecol")) { campaignState.nameCol = t.value; return; }
      if (t.classList.contains("x97-camp-phonecol")) { campaignState.phoneCol = t.value; refreshCamp(); return; }
      if (t.classList.contains("x97-camp-dup")) { campaignState.dupRemoval = t.checked; return; }
      if (t.classList.contains("x97-camp-ts")) { campaignState.timestamp = t.checked; if (campaignState.showPreview) refreshCamp(); return; }
      if (t.classList.contains("x97-camp-cc")) { campaignState.countryCode = t.value; refreshCamp(); return; }
      if (t.classList.contains("x97-camp-manual")) { campaignState.manualNumbers = t.value; refreshCamp(); return; }
      if (t.classList.contains("x97-camp-file")) {
        var f = t.files && t.files[0]; if (!f) return;
        var r = new FileReader(); r.onload = function () { campaignState.importText = String(r.result || ""); campaignState.nameCol = ""; campaignState.phoneCol = ""; if (!campaignState.listName) campaignState.listName = f.name.replace(/\.[^.]+$/, ""); refreshCamp(); }; r.readAsText(f); return;
      }
    });
  }

  function onCampAction(a, node) {
    var doc = readDoc();
    if (a === "close") return closeCampaigns();
    if (a === "hub") { closeCampaigns(); openMessaging(); return; }
    if (a === "home") { campaignState.view = "home"; campaignState.jobs = null; return refreshCamp(); }
    if (a === "import") { campaignState.view = "import"; return refreshCamp(); }
    if (a === "google-connect") return connectGoogleContacts();
    if (a === "match-numbers") return openNumbersManager();
    if (a === "new") { campaignState.view = "compose"; campaignState.editId = null; campaignState.name = ""; campaignState.message = ""; campaignState.audience = { type: audienceContacts(doc, { type: "overdue" }).length ? "overdue" : "all", id: "" }; campaignState.previewIdx = 0; return refreshCamp(); }
    if (a === "use-list") { campaignState.view = "compose"; campaignState.editId = null; campaignState.name = ""; campaignState.message = ""; campaignState.audience = { type: "list", id: node.dataset.id }; campaignState.previewIdx = 0; return refreshCamp(); }
    if (a === "use-overdue") { campaignState.view = "compose"; campaignState.editId = null; campaignState.name = ""; campaignState.message = ""; campaignState.audience = { type: "overdue", id: "" }; campaignState.previewIdx = 0; return refreshCamp(); }
    if (a === "del-list") { if (confirm("Delete this list? Contacts stay, only the grouping is removed.")) { updateDoc(function (d) { d.waLists = (d.waLists || []).filter(function (l) { return l.id !== node.dataset.id; }); (d.waContacts || []).forEach(function (c) { c.lists = (c.lists || []).filter(function (id) { return id !== node.dataset.id; }); }); }, "camp-dellist"); refreshCamp(); } return; }
    if (a === "var") { insertVar(node.dataset.var); campaignState.showVars = false; return refreshCamp(); }
    if (a === "emoji") return insertAtCursor(node.dataset.e);
    if (a === "fmt") return wrapSelection(node.dataset.m);
    if (a === "shuffle") { campaignState.previewIdx++; return refreshCamp(); }
    if (a === "mode-onetap") { campaignState.mode = "onetap"; return refreshCamp(); }
    if (a === "mode-auto") { campaignState.mode = "auto"; return refreshCamp(); }
    if (a === "antiblock") { campaignState.antiblock = node.dataset.k; return refreshCamp(); }
    if (a === "detail-toggle") { campaignState.showDetail = !campaignState.showDetail; return refreshCamp(); }
    if (a === "preview-toggle") { campaignState.showPreview = !campaignState.showPreview; return refreshCamp(); }
    if (a === "tpl-menu") { campaignState.showTemplates = !campaignState.showTemplates; campaignState.showVars = false; campaignState.showEmoji = false; return refreshCamp(); }
    if (a === "var-menu") { campaignState.showVars = !campaignState.showVars; campaignState.showTemplates = false; campaignState.showEmoji = false; return refreshCamp(); }
    if (a === "emoji-menu") { campaignState.showEmoji = !campaignState.showEmoji; campaignState.showVars = false; campaignState.showTemplates = false; return refreshCamp(); }
    if (a === "load-tpl") { var t = campTemplates(doc).find(function (x) { return x.id === node.dataset.id; }); if (t) { campaignState.message = t.body; } campaignState.showTemplates = false; return refreshCamp(); }
    if (a === "save-tpl") { var nm = (prompt("Name this template:", campaignState.name || "My template") || "").trim(); if (nm) { updateDoc(function (d) { d.settings = d.settings || {}; d.settings.waTemplates = (d.settings.waTemplates || []).concat([{ id: uid("tpl"), name: nm, body: campaignState.message }]); }, "camp-tpl-save"); toast("Template saved", ""); } campaignState.showTemplates = false; return refreshCamp(); }
    if (a === "attach") { toast("Media attachments are coming soon — text, variables & emoji send now", ""); return; }
    if (a === "use-saved") { var ls = campLists(doc); campaignState.audience = ls.length ? { type: "list", id: ls[0].id } : { type: "overdue", id: "" }; return refreshCamp(); }
    if (a === "reset-compose") { if (confirm("Clear this campaign's message and name?")) { campaignState.message = ""; campaignState.name = ""; campaignState.manualNumbers = ""; refreshCamp(); } return; }
    if (a === "save") { persistCampaign(); toast("Campaign saved", ""); campaignState.view = "home"; return refreshCamp(); }
    if (a === "send") return startCampaign(campaignState.mode);
    if (a === "onetap-next") return sendCampaignOneTapNext();
    if (a === "report") { var c = campCampaigns(doc).find(function (x) { return x.id === node.dataset.id; }); if (c) { campaignState.runId = c.id; campaignState.editId = c.id; campaignState.name = c.name; campaignState.mode = c.mode || "onetap"; campaignState.jobs = null; campaignState.view = "report"; refreshCamp(); } return; }
    if (a === "export") return exportCampaignCSV(node.dataset.id);
    if (a === "do-import") {
      var parsed = parseCSV(campaignState.importText || "");
      if (!parsed.rows.length) { toast("Nothing to import", "error"); return; }
      var phoneCol = campaignState.phoneCol || detectPhoneCol(parsed.headers, parsed.rows);
      var nameCol = campaignState.nameCol || detectNameCol(parsed.headers, phoneCol);
      var res = importContacts(parsed, nameCol, phoneCol, campaignState.listName || "Imported list");
      toast(res.added + " imported" + (res.skipped ? ", " + res.skipped + " skipped (no number)" : ""), "");
      campaignState.importText = ""; campaignState.listName = ""; campaignState.nameCol = ""; campaignState.phoneCol = "";
      campaignState.view = "home"; refreshCamp();
    }
  }

  function injectCampCSS() {
    if (document.getElementById("x97-camp-css")) return;
    var css =
      ".x97-camp-sec{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:850;color:var(--tx3);margin:2px 2px 9px}" +
      ".x97-camp-list{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:13px;padding:11px 12px;margin-bottom:8px;background:var(--card)}" +
      ".x97-camp-list-main{flex:1;min-width:0;cursor:pointer}" +
      ".x97-camp-hist{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid var(--line);border-radius:13px;padding:11px 12px;margin-bottom:8px;background:var(--card);color:var(--tx);cursor:pointer}" +
      ".x97-camp-vars{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}" +
      ".x97-camp-var{background:var(--card2);border:1px solid var(--line2);border-radius:8px;padding:5px 9px;font-size:11.5px;font-weight:750;color:var(--pos);cursor:pointer;font-family:inherit}" +
      ".x97-camp-preview{background:var(--card2);border:1px dashed var(--line2);border-radius:12px;padding:12px;margin:4px 0 12px;font-size:12.5px;line-height:1.5;color:var(--tx);white-space:pre-wrap}" +
      ".x97-camp-map{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:12px}" +
      ".x97-camp-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:6px}" +
      ".x97-camp-tiles div{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:11px 6px;text-align:center}" +
      ".x97-camp-tiles b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.x97-camp-tiles span{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);font-weight:800}" +
      ".x97-camp-logrow{display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--line)}" +
      ".x97-google-g{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#fff;color:#4285F4;font-size:10px;font-weight:900;font-family:Georgia,serif;margin-right:2px}" +
      ".x97-ws-card{border:1px solid var(--line);border-radius:15px;background:var(--card);padding:13px;margin-bottom:12px}" +
      ".x97-ws-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:14px;font-weight:800;color:var(--tx);margin-bottom:11px}" +
      ".x97-ws-h span{display:inline-flex;align-items:center;gap:7px}" +
      ".x97-ws-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:9px}" +
      ".x97-ws-tw{position:relative}" +
      ".x97-ws-tool{display:inline-flex;align-items:center;gap:4px;background:var(--card2);border:1px solid var(--line2);border-radius:9px;padding:6px 9px;font-size:11.5px;font-weight:750;color:var(--tx2);cursor:pointer}" +
      ".x97-ws-tool.on{border-color:var(--pos);color:var(--pos)}" +
      ".x97-ws-b{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;background:var(--card2);border:1px solid var(--line2);border-radius:9px;font-size:13px;color:var(--tx2);cursor:pointer;font-weight:700}" +
      ".x97-ws-b.on{border-color:var(--pos);color:var(--pos)}" +
      ".x97-ws-menu{position:absolute;top:calc(100% + 5px);left:0;z-index:5;background:var(--card);border:1px solid var(--line2);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.35);padding:6px;min-width:170px;max-height:230px;overflow:auto}" +
      ".x97-ws-menu-item{display:block;width:100%;text-align:left;background:0;border:0;border-radius:8px;padding:8px 10px;font-size:12.5px;color:var(--tx);cursor:pointer;font-family:inherit}" +
      ".x97-ws-menu-item:hover{background:var(--card2)}.x97-ws-menu-item.save{color:var(--pos);font-weight:800;border-top:1px solid var(--line);margin-top:4px}" +
      ".x97-ws-menu-empty{padding:8px 10px;font-size:11.5px;color:var(--tx3)}" +
      ".x97-ws-emoji{position:absolute;top:calc(100% + 5px);left:0;z-index:5;background:var(--card);border:1px solid var(--line2);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.35);padding:8px;width:242px;display:flex;flex-wrap:wrap;gap:2px}" +
      "@media(max-width:759px){.x97-ws-menu,.x97-ws-emoji{position:fixed;left:12px;right:12px;bottom:12px;top:auto;width:auto;max-width:none;max-height:50vh}}" +
      ".x97-ws-emoji-b{width:30px;height:30px;border:0;background:0;border-radius:7px;font-size:17px;cursor:pointer;line-height:1}.x97-ws-emoji-b:hover{background:var(--card2)}" +
      ".x97-ws-seg{display:flex;gap:7px}.x97-ws-seg.small{flex:0 0 auto}" +
      ".x97-ws-seg button{flex:1;border:1px solid var(--line2);background:var(--card2);border-radius:99px;padding:8px 12px;font-size:12.5px;font-weight:800;color:var(--tx2);cursor:pointer}" +
      ".x97-ws-seg button.on{background:var(--pos);border-color:var(--pos);color:#fff}" +
      ".x97-ws-detail{margin-top:12px;padding-top:12px;border-top:1px dashed var(--line2)}" +
      ".x97-ws-note{font-size:11.5px;color:var(--tx3);margin-bottom:12px}" +
      ".x97-ws-switch{display:flex;gap:10px;align-items:flex-start;padding:9px 0;font-size:12px;color:var(--tx2);line-height:1.45}.x97-ws-switch input{width:18px;height:18px;accent-color:var(--pos);margin-top:1px}.x97-ws-switch b{color:var(--tx)}" +
      ".x97-ws-count{margin-top:10px;font-size:12px;color:var(--tx2);font-weight:700}" +
      ".x97-ws-bubble{background:#173d2e;color:#e8f5ee;border-radius:12px;border-top-right-radius:4px;padding:10px 12px;font-size:13px;line-height:1.5;white-space:normal;word-break:break-word}" +
      ".x97-ws-bubble code{font-family:ui-monospace,Menlo,monospace;font-size:12px}" +
      ".x97-ws-modebar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 2px 12px}" +
      ".x97-ws-actions{display:flex;gap:8px}.x97-ws-actions .x97-btn{flex:1;justify-content:center}.x97-ws-actions .x97-btn.primary{flex:2}";
    var s = document.createElement("style"); s.id = "x97-camp-css"; s.textContent = css; document.head.appendChild(s);
  }

  function submitFilters(form) {
    var v=formValues(form);state.upcoming.statuses=v.statuses||[];state.upcoming.currencies=v.currencies||[];state.upcoming.categories=v.categories||[];state.upcoming.from=v.from||"";state.upcoming.to=v.to||"";state.upcoming.minAmount=v.minAmount||"";state.upcoming.maxAmount=v.maxAmount||"";state.upcoming.sort=v.sort||"urgency";savePrefs();closeSheet();scheduleRender(0);
  }

  function submitAccount(form) {
    var v=formValues(form),id=v.id||uid("acct");updateDoc(function(doc){var i=doc.balances.findIndex(function(x){return String(x.id)===String(id);});var item={id:id,account:v.account.trim(),line:v.line.trim(),balance:roundMoney(v.balance),notes:v.notes.trim()};if(i>=0)doc.balances[i]=Object.assign({},doc.balances[i],item);else doc.balances.push(item);},"account-save");closeSheet();
  }

  function submitFacility(form) {
    var v=formValues(form),id=v.id||uid("facility");updateDoc(function(doc){var i=doc.credit.findIndex(function(x){return String(x.id)===String(id);});var old=i>=0?doc.credit[i]:{};var item=Object.assign({},old,{id:id,network:v.network,line:v.line.trim(),service:v.service.trim(),limitOffer:roundMoney(v.limitOffer),status:v.status,feeModel:v.feeModel,baseFee:num(v.baseFeePct)/100,dailyRate:num(v.dailyRatePct)/100,termDays:Math.max(0,roundMoney(v.termDays)),notes:v.notes.trim()});if(item.borrowed==null)item.borrowed=0;if(item.borrowDate==null)item.borrowDate="";if(item.manualDue==null)item.manualDue=0;if(i>=0)doc.credit[i]=item;else doc.credit.push(item);},"facility-save");closeSheet();
  }

  function submitBorrow(form) {
    var v=formValues(form),doc=readDoc(),f=facilityById(doc,v.facilityId);if(!f)return;var loans=virtualLegacyLoans(doc),available=Math.max(0,num(f.limitOffer)-activePrincipalForFacility(loans,f.id)),amount=roundMoney(v.amount);if(amount<=0||amount>available){toast("Enter an amount within the available offer","error");return;}var p=facilityPreview(f,amount,v.borrowDate,v.manualDue);updateDoc(function(next){var facility=facilityById(next,f.id);var loan={id:uid("loan"),facilityId:f.id,principal:amount,borrowDate:v.borrowDate,dueDate:p.dueDate,feeModelSnapshot:f.feeModel,baseFeeSnapshot:num(f.baseFee),dailyRateSnapshot:num(f.dailyRate),termDaysSnapshot:num(f.termDays||30),estimatedDue:p.estimated,manualDue:num(v.manualDue),status:"Active",destinationAccountId:v.destinationAccount||"",notes:"",createdAt:new Date().toISOString()};next.creditLoans.push(loan);facility.borrowed=amount;facility.borrowDate=v.borrowDate;facility.manualDue=p.estimated;if(v.destinationAccount){var account=next.balances.find(function(b){return String(b.id)===String(v.destinationAccount);});if(account)account.balance=num(account.balance)+amount;}},"credit-borrow");closeSheet();state.creditView="borrowed";scheduleRender(0);
  }

  function materializeLegacy(next, loan) {
    if (!loan.legacy) return next.creditLoans.find(function(l){return String(l.id)===String(loan.id);});
    var copy=clone(loan);delete copy.legacy;copy.id=uid("loan");next.creditLoans.push(copy);return copy;
  }

  function submitRepay(form) {
    var v=formValues(form),snapshot=readDoc(),loan=findLoan(snapshot,v.loanId);if(!loan)return;var amount=roundMoney(v.actualPaid);updateDoc(function(next){var stored=materializeLegacy(next,loan)||next.creditLoans.find(function(l){return String(l.id)===String(loan.id);});if(!stored)return;stored.status="Repaid";stored.actualPaid=amount;stored.repaidDate=v.repaidDate;stored.repaymentAccountId=v.repaymentAccount||"";stored.updatedAt=new Date().toISOString();var facility=facilityById(next,stored.facilityId);if(facility){facility.borrowed=0;facility.borrowDate="";facility.manualDue=0;}if(v.repaymentAccount){var account=next.balances.find(function(b){return String(b.id)===String(v.repaymentAccount);});if(account)account.balance=num(account.balance)-amount;}},"credit-repay");closeSheet();state.creditView="history";scheduleRender(0);
  }

  document.addEventListener("submit", function (e) {
    var form=e.target.closest("[data-x97-form]");if(!form)return;e.preventDefault();var type=form.dataset.x97Form;if(type==="upcoming")submitUpcoming(form);else if(type==="filters")submitFilters(form);else if(type==="account")submitAccount(form);else if(type==="facility")submitFacility(form);else if(type==="borrow")submitBorrow(form);else if(type==="repay")submitRepay(form);else if(type==="reminder-templates")submitTemplates(form);else if(type==="wa-safety")submitSafety(form);else if(type==="wa-numbers")submitNumbers(form);else if(type==="google-setup")submitGoogleSetup(form);
  });

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "x97-up-search") {
      state.upcoming.search=e.target.value;savePrefs();clearTimeout(searchTimer);searchTimer=setTimeout(function(){var pos=e.target.selectionStart;scheduleRender(0);setTimeout(function(){var input=document.getElementById("x97-up-search");if(input){input.focus();try{input.setSelectionRange(pos,pos);}catch(_){}}},0);},180);
    }
    var borrowForm=e.target.closest && e.target.closest("#x97-borrow-form");if(borrowForm){var doc=readDoc(),f=facilityById(doc,borrowForm.facilityId.value);if(f)renderBorrowPreview(borrowForm,f);}
  });

  document.addEventListener("click", function (e) {
    var nav=e.target.closest && e.target.closest(".navitem");
    if(nav){var text=(nav.textContent||"").trim().toLowerCase();var managed=/dashboard|home|follow|incoming|upcoming|receivable|credit|loan/.test(text);if(!managed&&needsReactRefresh){e.preventDefault();e.stopImmediatePropagation();try{sessionStorage.setItem(RESUME_KEY,text);sessionStorage.removeItem(REFRESH_KEY);}catch(_){}location.reload();return;}setTimeout(syncMode,30);return;}
    var navTarget=e.target.closest && e.target.closest("[data-x97-nav]");if(navTarget){var target=navTarget.dataset.x97Nav;var item=findNavItem(target);if(item)item.click();return;}
    var btn=e.target.closest && e.target.closest("[data-x97-action]");if(!btn)return;var action=btn.dataset.x97Action;
    if(action==="close-sheet"){closeSheet();return;}
    if(action==="open-messaging"){openMessaging();return;}
    if(action==="open-reminders"){openReminders();return;}
    if(action==="open-campaigns"){openCampaigns();return;}
    if(action==="reset-templates"){updateDoc(function(doc){if(doc.settings)doc.settings.reminderTemplates=null;},"reminder-templates-reset");closeSheet();openTemplateManager();return;}
    if(action==="add-upcoming"){openUpcomingForm();return;}
    if(action==="edit-upcoming"){e.stopPropagation();openUpcomingForm(btn.dataset.id);return;}
    if(action==="mark-paid"){e.stopPropagation();updateDoc(function(doc){var x=doc.followups.find(function(i){return String(i.id)===String(btn.dataset.id);});if(x)x.status="Paid";},"upcoming-paid");return;}
    if(action==="delete-upcoming"){if(confirm("Delete this upcoming payment?")){updateDoc(function(doc){doc.followups=doc.followups.filter(function(x){return String(x.id)!==String(btn.dataset.id);});},"upcoming-delete");closeSheet();}return;}
    if(action==="quick-date"){var input=document.querySelector("#x97-upcoming-form [name=expectedBy]");if(input){input.value=btn.dataset.value==="month-end"?dateISO(endOfMonth(todayDate())):dateISO(addDays(todayDate(),num(btn.dataset.days)));}return;}
    if(action==="upcoming-view"){state.upcoming.view=btn.dataset.value;savePrefs();scheduleRender(0);return;}
    if(action==="quick-filter"){state.upcoming.quick=btn.dataset.value;savePrefs();scheduleRender(0);return;}
    if(action==="month-filter"){state.upcoming.month=btn.dataset.value;savePrefs();scheduleRender(0);return;}
    if(action==="open-month"){state.upcoming.view="list";state.upcoming.month=btn.dataset.month;state.upcoming.quick="all";savePrefs();var item=findNavItem("upcoming");if(item&&!item.classList.contains("on"))item.click();else scheduleRender(0);return;}
    if(action==="open-filters"){openFilters(readDoc());return;}
    if(action==="clear-filter"){var k=btn.dataset.filter;if(k==="month")state.upcoming.month="all";else if(k==="statuses")state.upcoming.statuses=[];else if(k==="currencies")state.upcoming.currencies=[];else if(k==="categories")state.upcoming.categories=[];else if(k==="dates"){state.upcoming.from="";state.upcoming.to="";}else if(k==="amount"){state.upcoming.minAmount="";state.upcoming.maxAmount="";}else if(k==="sort")state.upcoming.sort="urgency";savePrefs();scheduleRender(0);return;}
    if(action==="clear-all-filters"||action==="reset-advanced-filters"){state.upcoming.statuses=[];state.upcoming.currencies=[];state.upcoming.categories=[];state.upcoming.from="";state.upcoming.to="";state.upcoming.minAmount="";state.upcoming.maxAmount="";state.upcoming.sort="urgency";if(action==="clear-all-filters"){state.upcoming.month="all";state.upcoming.quick="all";}savePrefs();if(action==="reset-advanced-filters")openFilters(readDoc());else scheduleRender(0);return;}
    if(action==="go-upcoming"||action==="go-upcoming-months"){if(action.indexOf("months")>=0)state.upcoming.view="months";var up=findNavItem("upcoming");if(up)up.click();return;}
    if(action==="go-credit"){var cr=findNavItem("credit");if(cr)cr.click();return;}
    if(action==="add-account"){openAccountForm();return;}
    if(action==="edit-account"){openAccountForm(btn.dataset.id);return;}
    if(action==="delete-account"){if(confirm("Delete this account?")){updateDoc(function(doc){doc.balances=doc.balances.filter(function(x){return String(x.id)!==String(btn.dataset.id);});},"account-delete");closeSheet();}return;}
    if(action==="credit-view"){state.creditView=btn.dataset.value;scheduleRender(0);return;}
    if(action==="toggle-unavailable"){unavailableOpen=!unavailableOpen;scheduleRender(0);return;}
    if(action==="add-facility"){openFacilityForm();return;}
    if(action==="edit-facility"){openFacilityForm(btn.dataset.id);return;}
    if(action==="delete-facility"){var doc=readDoc(),has=virtualLegacyLoans(doc).some(function(l){return isActiveLoan(l)&&String(l.facilityId)===String(btn.dataset.id);});if(has){toast("Repay or cancel the active borrowing first","error");return;}if(confirm("Delete this credit facility?")){updateDoc(function(next){next.credit=next.credit.filter(function(x){return String(x.id)!==String(btn.dataset.id);});},"facility-delete");closeSheet();}return;}
    if(action==="borrow"){openBorrowForm(btn.dataset.id);return;}
    if(action==="borrow-percent"){var form=document.getElementById("x97-borrow-form");if(form){var max=num(form.amount.max);form.amount.value=Math.floor(max*num(btn.dataset.value)/100);form.amount.dispatchEvent(new Event("input",{bubbles:true}));}return;}
    if(action==="repay"){openRepayForm(btn.dataset.id);return;}
    if(action==="loan-details"){openLoanDetails(btn.dataset.id);return;}
  }, true);

  function resumeOriginalTab() {
    var target="";try{target=sessionStorage.getItem(RESUME_KEY)||"";sessionStorage.removeItem(RESUME_KEY);sessionStorage.removeItem(REFRESH_KEY);}catch(_){}
    needsReactRefresh=false;if(!target)return;
    var tries=0,timer=setInterval(function(){tries++;var item=findNavItem(target);if(item){clearInterval(timer);item.click();}else if(tries>30)clearInterval(timer);},100);
  }

  function watchData() {
    setInterval(function () {
      updateCloudPill();
      if (!currentScreen) return;
      var raw="";try{raw=localStorage.getItem(DATA_KEY)||"";}catch(_){}
      if(raw&&raw!==lastRaw){lastRaw=raw;scheduleRender(50);}
    },1000);
  }

  function boot() {
    injectCSS();injectMsgCSS();loadPrefs();resumeOriginalTab();initRemindBridge();
    var tries=0,timer=setInterval(function(){tries++;if(document.querySelector(".navitem")&&document.querySelector(".wrap")){clearInterval(timer);syncMode();}else if(tries>80)clearInterval(timer);},100);
    var observer=new MutationObserver(function(mutations){
      var relevant=mutations.some(function(m){
        var target=m.target;
        if(target&&target.closest&&(target.closest("#x97-v2-root")||target.closest("#x97-sheet")||target.closest(".x97-toast-wrap")))return false;
        if(m.type==="attributes"&&m.attributeName==="class"&&target&&target.classList&&target.classList.contains("navitem"))return true;
        if(m.type==="childList"&&modeActive&&wrap&&(target===wrap||wrap.contains(target)))return true;
        if(m.type==="childList"&&!document.querySelector(".navitem"))return true;
        return false;
      });
      if(relevant)setTimeout(syncMode,20);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
    watchData();
    window.addEventListener("pageshow",syncMode);window.addEventListener("focus",function(){setTimeout(syncMode,30);});
    window.__x97v2={version:VERSION,render:scheduleRender,read:readDoc,analytics:function(){var d=readDoc();return d?analytics(d):null;},selfTest:function(){var d=readDoc();return {version:VERSION,dataReady:!!d,followups:d?d.followups.length:0,facilities:d?d.credit.length:0,loans:d?virtualLegacyLoans(d).length:0,screen:currentScreen};}};
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
