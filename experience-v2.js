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
      grid: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>'
    };
    return '<svg aria-hidden="true" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.more) + '</svg>';
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
      .x97-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:4px 0 18px}
      .x97-eyebrow{font-size:11px;line-height:1;text-transform:uppercase;letter-spacing:.14em;font-weight:800;color:var(--tx3);margin-bottom:7px}
      .x97-title{margin:0;color:var(--tx);font-size:29px;line-height:1.05;font-weight:800;letter-spacing:-.04em;font-family:var(--fu)}
      .x97-sub{margin:7px 0 0;color:var(--tx2);font-size:13px;line-height:1.5}
      .x97-cloud{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:8px 10px;font-size:11px;font-weight:700;color:var(--tx2);box-shadow:var(--elev-1)}
      .x97-cloud i{width:8px;height:8px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px var(--warndim)}
      .x97-cloud.online i{background:var(--pos);box-shadow:0 0 0 3px var(--posdim)}
      .x97-cloud.error i,.x97-cloud.offline i{background:var(--neg);box-shadow:0 0 0 3px var(--negdim)}
      .x97-card{background:var(--card);border:1px solid var(--line);border-radius:20px;box-shadow:var(--toplit),var(--elev-1)}
      .x97-pad{padding:18px}
      .x97-section{margin-top:18px}
      .x97-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 2px 10px}
      .x97-section-title{font-size:12px;text-transform:uppercase;letter-spacing:.1em;font-weight:800;color:var(--tx2)}
      .x97-link{border:0;background:transparent;color:var(--pos);font-size:12px;font-weight:750;padding:5px;display:inline-flex;align-items:center;gap:4px}
      .x97-money{font-family:var(--fnum)!important;font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"tnum";letter-spacing:-.01em;font-weight:600}
      .x97-hero{padding:22px;background:linear-gradient(145deg,#fff 30%,#F7FBF8);position:relative;overflow:hidden}
      .x97-hero:after{content:"";position:absolute;width:220px;height:220px;border-radius:50%;right:-110px;top:-130px;background:radial-gradient(circle,rgba(14,117,72,.12),transparent 66%)}
      .x97-hero-label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:var(--tx3)}
      .x97-hero-value{font-size:clamp(35px,8vw,50px);line-height:1;margin:10px 0 17px;color:var(--tx);position:relative;z-index:1}
      .x97-hero-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;position:relative;z-index:1}
      .x97-stat{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:11px 12px}
      .x97-stat span{display:block;font-size:10.5px;color:var(--tx3);font-weight:700;margin-bottom:5px}
      .x97-stat b{font-size:14px;color:var(--tx);font-weight:750;font-variant-numeric:tabular-nums}
      .x97-grid{display:grid;gap:14px}
      .x97-grid-2{grid-template-columns:1fr}
      .x97-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .x97-summary{padding:14px;min-height:94px}
      .x97-summary .k{font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:var(--tx3)}
      .x97-summary .v{font-size:23px;line-height:1.1;margin-top:9px;color:var(--tx)}
      .x97-summary .s{font-size:10.5px;color:var(--tx3);margin-top:6px}
      .x97-teal{color:var(--usd)!important}.x97-green{color:var(--pos)!important}.x97-red{color:var(--neg)!important}.x97-amber{color:var(--warn)!important}
      .x97-row{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}
      .x97-row:last-child{border-bottom:0}
      .x97-row-icon{width:38px;height:38px;border-radius:12px;background:var(--card2);display:grid;place-items:center;color:var(--tx2);flex:0 0 auto}
      .x97-row-icon.good{background:var(--posdim);color:var(--pos)}.x97-row-icon.warn{background:var(--warndim);color:var(--warn)}.x97-row-icon.bad{background:var(--negdim);color:var(--neg)}.x97-row-icon.usd{background:var(--usddim);color:var(--usd)}
      .x97-row-main{min-width:0;flex:1}.x97-row-title{font-size:13.5px;font-weight:750;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x97-row-sub{font-size:11.5px;color:var(--tx3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x97-row-value{text-align:right;font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
      .x97-empty{padding:30px 18px;text-align:center;color:var(--tx3)}.x97-empty strong{display:block;color:var(--tx);font-size:15px;margin:8px 0 5px}.x97-empty p{font-size:12px;line-height:1.5;margin:0}
      .x97-segment{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:4px;gap:3px;margin-bottom:13px}
      .x97-segment button{border:0;border-radius:10px;background:transparent;color:var(--tx3);font-size:12px;font-weight:800;min-height:38px;display:flex;align-items:center;justify-content:center;gap:6px}
      .x97-segment button.on{background:var(--card);color:var(--pos);box-shadow:0 2px 8px rgba(23,27,18,.08)}
      .x97-tools{display:flex;gap:8px;align-items:center;margin-bottom:10px}
      .x97-search{flex:1;min-width:0;position:relative}.x97-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--tx3)}.x97-search input{width:100%;height:44px;border:1px solid var(--line2);background:var(--card);border-radius:13px;padding:0 12px 0 39px;color:var(--tx);outline:0;font-size:13px}.x97-search input:focus{border-color:var(--pos);box-shadow:var(--ring)}
      .x97-icon-btn{height:44px;min-width:44px;padding:0 12px;border-radius:13px;border:1px solid var(--line2);background:var(--card);color:var(--tx2);display:inline-flex;align-items:center;justify-content:center;gap:7px;font-size:12px;font-weight:750;position:relative}
      .x97-badge-count{position:absolute;right:-4px;top:-5px;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:var(--pos);color:#fff;font-size:10px;display:grid;place-items:center;border:2px solid var(--bg)}
      .x97-chips{display:flex;gap:7px;overflow-x:auto;padding:2px 1px 9px;scrollbar-width:none}.x97-chips::-webkit-scrollbar{display:none}
      .x97-chip{white-space:nowrap;height:34px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--tx2);padding:0 12px;font-size:11.5px;font-weight:750;display:inline-flex;align-items:center;gap:6px}.x97-chip.on{background:var(--posdim);border-color:rgba(14,117,72,.25);color:var(--pos)}.x97-chip.alert.on{background:var(--negdim);border-color:rgba(181,53,46,.22);color:var(--neg)}
      .x97-active-filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px}.x97-filter-tag{border:0;background:var(--card2);color:var(--tx2);border-radius:999px;padding:6px 9px;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;gap:4px}
      .x97-count{font-size:11px;color:var(--tx3);margin:5px 2px 10px}
      .x97-group{margin:16px 0 8px;display:flex;justify-content:space-between;align-items:center}.x97-group b{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--tx2)}.x97-group span{font-size:10.5px;color:var(--tx3)}
      .x97-item{padding:15px 16px;margin-bottom:9px;cursor:pointer;transition:transform .12s,border-color .15s}.x97-item:active{transform:scale(.985)}
      .x97-item-top{display:flex;gap:10px;align-items:flex-start}.x97-item-main{flex:1;min-width:0}.x97-item-title{font-size:14px;line-height:1.3;font-weight:800;color:var(--tx);overflow:hidden;text-overflow:ellipsis}.x97-item-category{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:750;margin-bottom:4px}.x97-item-amount{text-align:right;font-size:17px;white-space:nowrap}.x97-item-foot{margin-top:12px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}.x97-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:6px 8px;font-size:10.5px;font-weight:750;background:var(--card2);color:var(--tx2)}.x97-pill.good{background:var(--posdim);color:var(--pos)}.x97-pill.warn{background:var(--warndim);color:var(--warn)}.x97-pill.bad{background:var(--negdim);color:var(--neg)}.x97-pill.usd{background:var(--usddim);color:var(--usd)}
      .x97-item-actions{margin-left:auto;display:flex;gap:5px}.x97-mini{border:1px solid var(--line);background:var(--card);color:var(--tx2);border-radius:9px;height:30px;padding:0 9px;font-size:10.5px;font-weight:750}
      .x97-month-card{padding:17px;margin-bottom:10px;cursor:pointer}.x97-month-head{display:flex;justify-content:space-between;align-items:start;gap:10px}.x97-month-title{font-size:15px;font-weight:850;color:var(--tx)}.x97-month-count{font-size:10.5px;color:var(--tx3);margin-top:4px}.x97-month-money{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:14px}.x97-month-money div{background:var(--card2);border-radius:12px;padding:10px}.x97-month-money span{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:800}.x97-month-money b{display:block;margin-top:5px;font-size:16px;font-variant-numeric:tabular-nums}
      .x97-progress{height:7px;background:var(--card3);border-radius:99px;overflow:hidden;margin-top:12px}.x97-progress i{display:block;height:100%;background:var(--pos);border-radius:inherit}
      .x97-btn{border:1px solid var(--line2);background:var(--card);color:var(--tx);border-radius:12px;min-height:42px;padding:0 14px;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;gap:7px}.x97-btn.primary{border:0;background:linear-gradient(180deg,#0F8552,var(--pos2));color:#fff;box-shadow:0 8px 20px -10px rgba(11,103,64,.6)}.x97-btn.danger{color:var(--neg);border-color:rgba(181,53,46,.3);background:var(--negdim)}.x97-btn.teal{color:var(--usd);border-color:rgba(11,114,133,.25);background:var(--usddim)}.x97-btn:active{transform:scale(.97)}
      .x97-fab{position:fixed;right:max(16px,calc(50% - 488px));bottom:calc(78px + env(safe-area-inset-bottom));z-index:54;width:56px;height:56px;border:0;border-radius:50%;background:linear-gradient(180deg,#0F8552,var(--pos2));color:white;display:grid;place-items:center;box-shadow:0 14px 30px -9px rgba(11,103,64,.65)}
      .x97-network{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:900;font-size:11px;color:#fff;flex:0 0 auto}.x97-network.airtel{background:#D72B2B}.x97-network.mtn{background:#F7C900;color:#171B12}.x97-network.other{background:var(--usd)}
      .x97-facility{padding:15px;margin-bottom:9px}.x97-facility-head{display:flex;gap:11px;align-items:start}.x97-facility-main{min-width:0;flex:1}.x97-facility-title{font-size:14px;font-weight:850}.x97-facility-sub{font-size:11px;color:var(--tx3);margin-top:3px}.x97-facility-limit{text-align:right}.x97-facility-limit b{display:block;font-size:16px}.x97-facility-limit span{font-size:9.5px;color:var(--tx3);text-transform:uppercase;font-weight:800}.x97-facility-actions{display:flex;gap:7px;margin-top:13px}.x97-facility-actions .x97-btn{flex:1}
      .x97-loan{padding:16px;margin-bottom:10px;border-left:4px solid var(--warn)}.x97-loan.overdue{border-left-color:var(--neg)}.x97-loan-head{display:flex;justify-content:space-between;gap:12px}.x97-loan h3{font-size:14px;margin:0}.x97-loan .due{font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.06em;color:var(--warn)}.x97-loan.overdue .due{color:var(--neg)}.x97-loan-amount{font-size:26px;margin:12px 0 3px}.x97-loan-meta{font-size:11px;color:var(--tx3);line-height:1.6}
      .x97-back{position:fixed;inset:0;z-index:1200;background:rgba(23,27,18,.42);backdrop-filter:blur(6px);display:flex;align-items:flex-end;justify-content:center;padding:0}.x97-sheet{width:100%;max-width:560px;max-height:94vh;background:var(--bg2);border:1px solid var(--line);border-radius:26px 26px 0 0;box-shadow:0 -28px 70px rgba(23,27,18,.24);display:flex;flex-direction:column;animation:x97-sheet .28s cubic-bezier(.22,1,.36,1)}@keyframes x97-sheet{from{transform:translateY(24px);opacity:.5}to{transform:none;opacity:1}}
      .x97-sheet-head{padding:10px 17px 13px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}.x97-handle{position:absolute;left:50%;transform:translateX(-50%);top:7px;width:38px;height:4px;background:var(--line2);border-radius:99px}.x97-sheet-head h2{font-size:18px;letter-spacing:-.02em;margin:9px 0 0;flex:1}.x97-close{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:var(--card2);display:grid;place-items:center;margin-top:7px}.x97-sheet-body{padding:17px;overflow:auto}.x97-sheet-foot{padding:12px 17px calc(14px + env(safe-area-inset-bottom));border-top:1px solid var(--line);display:flex;gap:9px;background:rgba(251,251,248,.96)}.x97-sheet-foot .x97-btn{flex:1}
      .x97-field{margin-bottom:14px}.x97-field label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx2);font-weight:800;margin:0 0 6px}.x97-input,.x97-select,.x97-textarea{width:100%;min-height:44px;border:1px solid var(--line2);border-radius:12px;background:var(--card);color:var(--tx);padding:10px 12px;font-size:13px;outline:0}.x97-textarea{min-height:82px;resize:vertical}.x97-input:focus,.x97-select:focus,.x97-textarea:focus{border-color:var(--pos);box-shadow:var(--ring)}.x97-fields-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.x97-help{font-size:10.5px;color:var(--tx3);line-height:1.5;margin-top:5px}.x97-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.x97-check{display:flex;gap:8px;align-items:center;padding:10px;background:var(--card);border:1px solid var(--line);border-radius:11px;font-size:12px;font-weight:700}.x97-check input{accent-color:var(--pos)}
      .x97-preview{background:var(--card2);border:1px solid var(--line);border-radius:14px;padding:13px;margin-top:8px}.x97-preview-row{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:12px}.x97-preview-row span{color:var(--tx3)}.x97-preview-row b{font-variant-numeric:tabular-nums}.x97-preview-row.total{border-top:1px solid var(--line);margin-top:6px;padding-top:10px;font-size:14px}
      .x97-toast-wrap{position:fixed;z-index:2000;left:50%;bottom:calc(142px + env(safe-area-inset-bottom));transform:translateX(-50%);width:min(430px,calc(100% - 28px));pointer-events:none}.x97-toast{background:#171B12;color:#fff;border-radius:13px;padding:11px 13px;font-size:12px;font-weight:700;box-shadow:0 15px 35px rgba(23,27,18,.28);animation:x97-toast .25s ease both}.x97-toast.success{background:#0B6740}.x97-toast.error{background:#9E2D27}@keyframes x97-toast{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
      @media(min-width:760px){#x97-v2-root{padding:24px 24px 110px}.x97-grid-2{grid-template-columns:1fr 1fr}.x97-summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.x97-dashboard-main{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:16px;align-items:start}.x97-dashboard-wide{grid-column:1/-1}.x97-sheet{border-radius:26px;margin:20px}.x97-back{align-items:center;padding:16px}.x97-fab{right:max(24px,calc(50% - 488px))}}
      @media(max-width:560px){.x97-top{align-items:center}.x97-title{font-size:26px}.x97-cloud{padding:7px 9px}.x97-cloud span{display:none}.x97-hero{padding:19px}.x97-hero-value{font-size:36px}.x97-fields-2{grid-template-columns:1fr}.x97-checks{grid-template-columns:1fr 1fr}.x97-fab{right:16px}.x97-item-actions{width:100%;margin-left:0}.x97-item-actions .x97-mini{flex:1}}

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
        '<section class="x97-section">' + sectionHead("Next 7 days") + '<div class="x97-card x97-pad"><div class="x97-hero-meta" style="margin-bottom:4px"><div class="x97-stat"><span>Expected in</span><b class="x97-green">' + money(in7, "UGX") + '</b></div><div class="x97-stat"><span>Expected out</span><b class="x97-red">' + money(out7, "UGX") + '</b></div></div>' + timelineRows + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Accounts", "Add account", "add-account") + '<div class="x97-card x97-pad">' + (accountRows || '<div class="x97-empty"><strong>No accounts yet</strong><p>Add your bank, mobile money or cash balance.</p></div>') + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Incoming pipeline", "View all months", "go-upcoming-months") + '<div class="x97-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + pipeline + '</div></section>' +
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

  function openUpcomingForm(id) {
    var doc = readDoc(), existing = id ? (doc.followups || []).find(function(x){return String(x.id)===String(id);}) : null;
    var item = existing ? clone(existing) : { id:"", client:"", category:"One Time", amount:"", currency:"UGX", status:"Pending", expectedBy:"", note:"" };
    var categories = Array.from(new Set([].concat(doc.settings.categories || [], (doc.followups || []).map(function(x){return x.category;}), ["Design","One Time","Retainer"]).filter(Boolean))).sort();
    var statuses = Array.from(new Set([].concat(doc.settings.fuStatuses || [], ["Pending","Paid","Cancelled"]).filter(Boolean)));
    var body = '<form id="x97-upcoming-form" data-x97-form="upcoming"><input type="hidden" name="id" value="' + attr(item.id) + '">' +
      field("Client / project", '<input class="x97-input" name="client" required maxlength="160" value="' + attr(item.client) + '" placeholder="e.g. Apollo — Scene 3">') +
      '<div class="x97-fields-2">' +
      field("Category", '<select class="x97-select" name="category">' + categories.map(function(x){return option(x,x,item.category);}).join("") + '</select>') +
      field("Status", '<select class="x97-select" name="status">' + statuses.map(function(x){return option(x,x,item.status);}).join("") + '</select>') + '</div>' +
      '<div class="x97-fields-2">' + field("Amount", '<input class="x97-input" name="amount" inputmode="decimal" type="number" min="0" step="1" value="' + attr(item.amount) + '" placeholder="0">') + field("Currency", '<select class="x97-select" name="currency">' + option("UGX","UGX",item.currency) + option("USD","USD",item.currency) + '</select>') + '</div>' +
      field("Expected date", '<input class="x97-input" name="expectedBy" type="date" value="' + attr(item.expectedBy) + '"><div class="x97-chips" style="padding-top:7px"><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="0">Today</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="7">+7 days</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="30">+30 days</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-value="month-end">Month end</button></div>') +
      field("Note", '<textarea class="x97-textarea" name="note" maxlength="500" placeholder="Invoice, follow-up context, or next action">' + esc(item.note) + '</textarea>') + '</form>';
    var foot = (existing ? '<button class="x97-btn danger" data-x97-action="delete-upcoming" data-id="' + attr(item.id) + '">' + icon("trash") + ' Delete</button>' : '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button>') + '<button class="x97-btn primary" type="submit" form="x97-upcoming-form">' + icon("check") + (existing ? " Save changes" : " Add upcoming") + '</button>';
    openSheet(existing ? "Edit upcoming" : "Add upcoming", body, foot);
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
    updateDoc(function(doc){var i=doc.followups.findIndex(function(x){return String(x.id)===String(id);});var item={id:id,client:v.client.trim(),category:v.category,amount:roundMoney(v.amount),currency:v.currency,status:v.status,expectedBy:v.expectedBy,note:v.note.trim()};if(i>=0)doc.followups[i]=Object.assign({},doc.followups[i],item);else doc.followups.unshift(item);},"upcoming-save");
    closeSheet();
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
    var form=e.target.closest("[data-x97-form]");if(!form)return;e.preventDefault();var type=form.dataset.x97Form;if(type==="upcoming")submitUpcoming(form);else if(type==="filters")submitFilters(form);else if(type==="account")submitAccount(form);else if(type==="facility")submitFacility(form);else if(type==="borrow")submitBorrow(form);else if(type==="repay")submitRepay(form);
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
    injectCSS();loadPrefs();resumeOriginalTab();
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
