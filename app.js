/* 97 LIVE — the app.
   One script owns the whole interface: the shell (header, navigation, routes),
   every screen, the sheets and the messaging panels. It reads and writes one
   document in localStorage (ns97-finance-v1); sync.js keeps that document in
   step with the cloud and announces cloud changes with an "s97:data" event,
   which redraws the screen in place. Old documents load unchanged: every
   reader below tolerates missing fields, and migrations are additive.
*/
(function () {
  "use strict";

  if (window.__S97_APP__) return;
  window.__S97_APP__ = true;

  var VERSION = "3.0.0";
  var DATA_KEY = "ns97-finance-v1";
  var PREF_KEY = "ns97.v3.incoming.filters";
  var PRIVACY_KEY = "ns97.v2.privacy";
  var BACKUP_KEY = "ns97.v3.restore-point";
  // Screens by route. Screen keys are what the code has always called them;
  // routes are what the address bar shows (#/incoming, #/credit, …).
  var ROUTES = { home: "dashboard", incoming: "upcoming", credit: "credit", expenses: "expenses", settings: "settings" };
  var SCREEN_ROUTE = { dashboard: "home", upcoming: "incoming", credit: "credit", expenses: "expenses", settings: "settings" };
  var SCREEN_TITLE = { dashboard: "Home", upcoming: "Incoming", credit: "Credit", expenses: "Expenses", settings: "Settings" };
  var root = null;
  var currentScreen = null;
  // True for exactly one render after the screen changes, so a screen that
  // patches itself in place (Incoming) knows to build its frame afresh.
  var screenEntering = false;
  var lastRaw = "";
  var renderTimer = null;
  var searchTimer = null;
  var sheetScrollY = 0;
  var sheetOpener = null;
  var unavailableOpen = false;
  var remindExt = { ready: false, version: "", sending: false };
  var remindState = { open: false, mode: "onetap", tone: "auto", selected: {}, drafts: {}, showAll: false, progress: {} };
  var campaignState = { open: false, view: "home", mode: "onetap", editId: null, audience: { type: "list", id: "" }, message: "", previewIdx: 0, progress: {}, sending: false, runId: null, oneTapIdx: 0, antiblock: "balanced", showDetail: false, showVars: false, showEmoji: false, showPreview: false, showTemplates: false, dupRemoval: true, timestamp: false, countryCode: "", manualNumbers: "" };
  var ANTIBLOCK = {
    conservative: { label: "Conservative", min: 60, max: 180, batch: 5, brk: 15, note: "Safest · 60–180s between sends" },
    balanced: { label: "Balanced", min: 30, max: 90, batch: 8, brk: 10, note: "Recommended · 30–90s between sends" },
    fast: { label: "Fast", min: 8, max: 25, batch: 15, brk: 5, note: "Quick · 8–25s between sends" }
  };
  var EMOJIS = ["😀","😁","😅","😂","🙂","😉","😍","😘","😎","🤩","🥳","🙏","👍","👌","👏","🙌","💪","🔥","✨","🎉","💯","✅","❗","❓","⚠️","💰","💸","🧾","📅","⏰","📌","📞","📱","💬","➡️","👉","❤️","🧡","💚","💙","🙏🏾","😊","😄","🤝","🎬","🎥","📸","🌟"];

  var FX_KEY = "ns97.v2.fx";
  var FX_FAIL_KEY = "ns97.v2.fx-fail";
  var THEME_KEY = "ns97.v2.theme";
  var FX_BASE = "USD";
  var FX_HOME = "UGX";
  var FX_TICKER = ["EUR", "GBP", "KES", "TZS"];
  var FX_NAMES = {
    UGX: "Uganda Shilling", USD: "US Dollar", EUR: "Euro", GBP: "British Pound", KES: "Kenyan Shilling",
    TZS: "Tanzanian Shilling", RWF: "Rwandan Franc", BIF: "Burundian Franc", SSP: "South Sudanese Pound",
    CDF: "Congolese Franc", ETB: "Ethiopian Birr", ZAR: "South African Rand", NGN: "Nigerian Naira",
    GHS: "Ghanaian Cedi", ZMW: "Zambian Kwacha", EGP: "Egyptian Pound", MAD: "Moroccan Dirham",
    AED: "UAE Dirham", SAR: "Saudi Riyal", QAR: "Qatari Riyal", TRY: "Turkish Lira", INR: "Indian Rupee",
    CNY: "Chinese Yuan", JPY: "Japanese Yen", CAD: "Canadian Dollar", AUD: "Australian Dollar",
    CHF: "Swiss Franc", SEK: "Swedish Krona", NOK: "Norwegian Krone", DKK: "Danish Krone"
  };
  var FX_ORDER = ["UGX","USD","EUR","GBP","KES","TZS","RWF","BIF","SSP","CDF","ETB","ZAR","NGN","GHS","ZMW","EGP","MAD","AED","SAR","QAR","TRY","INR","CNY","JPY","CAD","AUD","CHF","SEK","NOK","DKK"];
  var FX_SOURCES = [
    {
      id: "exchangerate-api",
      label: "ExchangeRate-API",
      url: "https://open.er-api.com/v6/latest/USD",
      parse: function (j) {
        if (!j || j.result === "error" || !j.rates) return null;
        return { rates: j.rates, updatedAt: num(j.time_last_update_unix) * 1000, nextAt: num(j.time_next_update_unix) * 1000 };
      }
    },
    {
      id: "currency-api",
      label: "Currency-API",
      url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
      parse: parseCurrencyApi
    },
    {
      id: "currency-api",
      label: "Currency-API",
      url: "https://latest.currency-api.pages.dev/v1/currencies/usd.min.json",
      parse: parseCurrencyApi
    }
  ];
  var fxBusy = false;
  var fxConv = { amount: "", from: "USD", to: "UGX" };

  var state = {
    upcoming: {
      quick: "open",
      month: monthKey(todayDate()),
      search: "",
      statuses: [],
      currencies: [],
      categories: [],
      retainers: "all",
      from: "",
      to: "",
      minAmount: "",
      maxAmount: "",
      sort: "urgency",
      collapsed: []
    },
    creditView: "available",
    // Screen state only — never saved into the document.
    expenses: { month: monthKey(todayDate()), filter: "all" }
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
    if (compact && abs >= 1000000000) text = (amount / 1000000000).toFixed(abs >= 10000000000 ? 1 : 2).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") + "B";
    else if (compact && abs >= 1000000) text = (amount / 1000000).toFixed(abs >= 10000000 ? 1 : 2).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") + "M";
    else if (compact && abs >= 1000) text = (amount / 1000).toFixed(abs >= 100000 ? 0 : 1).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1") + "K";
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
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff === -1) return "Yesterday";
    return diff < 0 ? -diff + " days ago" : "in " + diff + " days";
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
    if (!Array.isArray(doc.payments)) doc.payments = [];
    migrateFacilityLoans(doc);
    // Recalculate structured deals in memory whenever a screen reads the
    // document. This keeps old records compatible while making the derived
    // amount/status/next-date fields agree with the payment ledger.
    doc.followups.forEach(function (item) {
      if (Array.isArray(item.parts) || allPaymentsFor(doc, item.id).length) rebuildDealParts(doc, item);
    });
    return doc;
  }

  /* ── Money received ───────────────────────────────────────────────────────
     `amount` stays what it has always meant to every reader of this document
     — what is still owed — so every finance screen keeps summing
     it correctly with no changes. `gross` remembers the invoiced total and
     `paid` what has come in, which is what makes part payments honest. */

  function grossOf(item) {
    if (item && Array.isArray(item.parts) && item.parts.length) {
      return roundMoney(item.parts.reduce(function (sum, part) { return sum + num(part.amount); }, 0));
    }
    var gross = num(item.gross);
    return gross > 0 ? gross : num(item.amount) + num(item.paid);
  }

  function paidOf(item) {
    var paid = Math.max(0, num(item && item.paid));
    // Older versions marked a record Paid without creating a payment ledger
    // entry. Treat that legacy state as received, but keep real ledger values
    // authoritative for every newer record.
    return paid > 0 ? paid : item && isPaid(item.status) ? grossOf(item) : 0;
  }

  function outstandingOf(item) { return Math.max(0, grossOf(item) - paidOf(item)); }

  function isReversedPayment(payment) { return !!(payment && (payment.reversedAt || /reversed/i.test(String(payment.status || "")))); }

  function allPaymentsFor(doc, followupId) {
    return (doc.payments || []).filter(function (p) { return String(p.followupId) === String(followupId); });
  }

  function paymentsFor(doc, followupId) {
    return allPaymentsFor(doc, followupId).filter(function (p) { return !isReversedPayment(p); });
  }

  // What actually landed. Items settled before payments existed have no ledger
  // entry, so fall back to their face value rather than reporting zero earned.
  function receivedOf(item) {
    var paid = paidOf(item);
    if (paid > 0) return paid;
    return isPaid(item.status) ? grossOf(item) : 0;
  }

  // Records money in against a receivable and rewrites the item so that
  // `amount` keeps meaning "still owed" while it is open, and returns to the
  // invoiced total once settled (paid items are excluded from every sum, and
  // the Paid list should show what the job was worth, not zero).
  function scheduleRowsFor(item) {
    if (item && Array.isArray(item.parts) && item.parts.length) return item.parts.map(function (part, index) {
      return {
        id: String(part.id || (item.id + "::part-" + index)),
        index: index + 1,
        label: part.label || (dealLabelSingular(item) + " " + (index + 1)),
        amount: roundMoney(part.amount),
        dueDate: part.dueDate || "",
        paid: num(part.paid),
        paidOn: part.paidOn || "",
        status: part.status || "Pending"
      };
    });
    return [{ id: String(item && item.id || "single") + "::single", index: 1, label: "Payment", amount: grossOf(item), dueDate: item && item.expectedBy || "", paid: 0, paidOn: "", status: "Pending" }];
  }

  function orderedPayments(doc, item) {
    return paymentsFor(doc, item.id).slice().sort(function (a, b) {
      var ac = String(a.createdAt || a.date || ""), bc = String(b.createdAt || b.date || "");
      return ac.localeCompare(bc);
    });
  }

  function applyAllocationToRows(rows, partId, amount, date) {
    var remaining = Math.max(0, num(amount));
    var start = rows.findIndex(function (row) { return String(row.id) === String(partId); });
    if (start < 0) start = 0;
    for (var i = start; i < rows.length && remaining > 0; i++) {
      var row = rows[i], left = Math.max(0, num(row.amount) - num(row.paid));
      if (left <= 0) continue;
      var applied = Math.min(left, remaining);
      row.paid = roundMoney(num(row.paid) + applied);
      row.paidOn = date || row.paidOn || "";
      remaining = roundMoney(remaining - applied);
    }
    return remaining;
  }

  function projectSchedule(doc, item) {
    var rows = scheduleRowsFor(item);
    var payments = orderedPayments(doc, item);
    var hasLedger = allPaymentsFor(doc, item.id).length > 0;
    if (hasLedger) {
      rows.forEach(function (row) { row.paid = 0; row.paidOn = ""; row.status = "Pending"; });
      // Preserve receipts recorded before this app had a payment ledger.
      (item.paymentOpeningParts || []).forEach(function (opening) {
        applyAllocationToRows(rows, opening.partId, opening.amount, opening.date);
      });
    }
    if (!hasLedger && paidOf(item) > 0) {
      var seeded = rows.reduce(function (sum, row) { return sum + num(row.paid); }, 0);
      applyAllocationToRows(rows, null, Math.max(0, paidOf(item) - seeded), item.paidOn || todayISO());
    }
    payments.forEach(function (payment) {
      var amount = Math.max(0, num(payment.amount));
      var allocations = Array.isArray(payment.allocations) ? payment.allocations : [];
      if (allocations.length) {
        allocations.forEach(function (allocation) {
          amount = applyAllocationToRows(rows, allocation.partId, allocation.amount, payment.date);
        });
      } else {
        applyAllocationToRows(rows, null, amount, payment.date);
      }
    });
    rows.forEach(function (row) {
      row.status = num(row.amount) > 0 && row.paid >= num(row.amount) - 0.5 ? "Paid" : row.paid > 0 ? "Part Paid" : "Pending";
    });
    return rows;
  }

  function buildPaymentAllocations(doc, item, amount, targetPartId) {
    var rows = projectSchedule(doc, item);
    var remaining = Math.max(0, num(amount));
    var start = targetPartId ? rows.findIndex(function (row) { return String(row.id) === String(targetPartId); }) : -1;
    if (start < 0) start = rows.findIndex(function (row) { return num(row.paid) < num(row.amount) - 0.5; });
    if (start < 0) start = 0;
    var allocations = [];
    for (var i = start; i < rows.length && remaining > 0; i++) {
      var row = rows[i], left = Math.max(0, num(row.amount) - num(row.paid));
      if (left <= 0) continue;
      var applied = Math.min(left, remaining);
      allocations.push({ partId: row.id, amount: roundMoney(applied) });
      remaining = roundMoney(remaining - applied);
    }
    return { allocations: allocations, remaining: remaining };
  }

  function rebuildDealParts(doc, item) {
    if (!item) return;
    var schedule = projectSchedule(doc, item);
    var gross = schedule.reduce(function (sum, row) { return sum + num(row.amount); }, 0);
    var hasLedger = allPaymentsFor(doc, item.id).length > 0;
    var scheduledPaid = schedule.reduce(function (sum, row) { return sum + num(row.paid); }, 0);
    var paid = hasLedger ? scheduledPaid : Math.max(num(item.paid), scheduledPaid);
    item.gross = roundMoney(gross || item.gross || item.amount);
    item.paid = roundMoney(paid);
    item.amount = roundMoney(Math.max(0, item.gross - item.paid));
    if (!isCancelled(item.status)) item.status = item.paid >= item.gross - 0.5 ? "Paid" : item.paid > 0 ? "Part Paid" : "Pending";
    var next = schedule.find(function (row) { return num(row.paid) < num(row.amount) - 0.5; });
    if (next && next.dueDate) item.expectedBy = next.dueDate;
    if (Array.isArray(item.parts)) item.parts.forEach(function (part, index) {
      var row = schedule[index];
      if (!row) return;
      part.id = row.id;
      part.paid = row.paid;
      part.status = row.status;
      part.paidOn = row.paidOn;
    });
  }

  function applyPayment(doc, followupId, entry) {
    var item = (doc.followups || []).find(function (x) { return String(x.id) === String(followupId); });
    if (!item) return null;
    var gross = grossOf(item);
    var outstanding = Math.max(0, gross - paidOf(item));
    var received = roundMoney(entry.amount);
    if (received <= 0 || received > outstanding + 0.5) return null;
    var allocationPlan = buildPaymentAllocations(doc, item, received, entry.targetPartId);
    if (allocationPlan.remaining > 0.5) return null;
    var payment = {
      id: uid("pay"),
      followupId: item.id,
      client: item.client || "",
      category: item.category || "",
      amount: received,
      currency: String(item.currency || "UGX").toUpperCase(),
      date: entry.date || todayISO(),
      accountId: entry.accountId || "",
      accountName: "",
      note: (entry.note || "").trim(),
      allocations: allocationPlan.allocations,
      createdAt: new Date().toISOString()
    };
    if (!allPaymentsFor(doc, item.id).length && !Array.isArray(item.paymentOpeningParts)) {
      item.paymentOpeningParts = projectSchedule(doc, item).filter(function (row) { return num(row.paid) > 0; }).map(function (row) {
        return { partId: row.id, amount: num(row.paid), date: row.paidOn || item.paidOn || "" };
      });
    }
    item.gross = gross;
    item.paid = paidOf(item) + received;
    item.paidOn = payment.date;
    var settled = item.paid >= gross - 0.5;
    item.amount = settled ? gross : roundMoney(gross - item.paid);
    item.status = settled ? "Paid" : "Part Paid";
    if (entry.accountId) {
      var account = (doc.balances || []).find(function (b) { return String(b.id) === String(entry.accountId); });
      if (account) {
        payment.accountName = account.account || "";
        // Accounts are held in shillings; dollar receipts land at today's rate.
        var credited = payment.currency === "USD" ? fxConvert(received, "USD", FX_HOME) : received;
        if (credited != null) {
          account.balance = roundMoney(num(account.balance) + credited);
          payment.creditedUGX = roundMoney(credited);
        }
      }
    }
    doc.payments.unshift(payment);
    rebuildDealParts(doc, item);
    return payment;
  }

  function reversePayment(doc, paymentId) {
    var idx = (doc.payments || []).findIndex(function (p) { return String(p.id) === String(paymentId); });
    if (idx < 0) return false;
    var payment = doc.payments[idx];
    if (isReversedPayment(payment)) return false;
    payment.status = "Reversed";
    payment.reversedAt = new Date().toISOString();
    var item = (doc.followups || []).find(function (x) { return String(x.id) === String(payment.followupId); });
    if (item) {
      rebuildDealParts(doc, item);
      var rest = paymentsFor(doc, item.id);
      item.paidOn = rest.length ? rest[0].date : "";
    }
    if (payment.accountId) {
      var account = (doc.balances || []).find(function (b) { return String(b.id) === String(payment.accountId); });
      if (account) account.balance = roundMoney(num(account.balance) - num(payment.creditedUGX != null ? payment.creditedUGX : payment.amount));
    }
    if (item) rebuildDealParts(doc, item);
    return true;
  }

  /* ── Structured deals ────────────────────────────────────────────────────
     A deal is one parent record with a visible schedule underneath it. The
     existing follow-up/payment fields remain the source of truth, so old
     records, receipts, reminders, cloud sync and backups stay compatible. */

  var DEAL_TYPES = {
    one: "One payment",
    deposit: "Deposit + balance",
    split: "Equal split",
    custom: "Custom schedule",
    monthly: "Monthly retainer",
    part: "Per part"
  };

  function normalizeDealType(value) {
    var raw = String(value || "one").trim().toLowerCase();
    if (/deposit|balance/.test(raw)) return "deposit";
    if (/custom|schedule|installment|instalment/.test(raw)) return "custom";
    if (/split|half/.test(raw)) return "split";
    if (/monthly|retainer|month/.test(raw)) return "monthly";
    if (/part|scene|episode|unit|milestone/.test(raw)) return "part";
    return "one";
  }

  function dealAmountLabel(type, label) {
    var normalized = normalizeDealType(type);
    if (normalized === "monthly") return "Amount per month";
    if (normalized === "part") return "Amount per " + dealLabelSingular({ partLabel: label || "parts" });
    if (normalized === "deposit") return "Full deal total";
    return "Deal total";
  }

  function dealTypeHint(type, label) {
    var normalized = normalizeDealType(type);
    if (normalized === "deposit") return "Enter the full deal total and the deposit. The balance is calculated automatically.";
    if (normalized === "split") return "Enter the full contract total — the app divides it into two equal payments.";
    if (normalized === "custom") return "Add each promised payment manually. The schedule must add up to the deal total.";
    if (normalized === "monthly") return "Enter the amount for each month — the deal total is calculated from the number of months.";
    if (normalized === "part") return "Enter the amount for each " + dealLabelSingular({ partLabel: label || "parts" }) + " — the deal total is calculated below.";
    return "Enter one total amount and one due date.";
  }

  function isRetainerCategory(value) { return /^(monthly\s+)?retainers?$/i.test(String(value || "").trim()); }
  function isRetainer(item) { return !!item && (normalizeDealType(item.dealType) === "monthly" || isRetainerCategory(item.category)); }

  function isDeal(item) { return !!(item && normalizeDealType(item.dealType) !== "one" && Array.isArray(item.parts)); }

  function dealLabel(item) {
    var raw = String(item && item.partLabel || "parts").trim().toLowerCase();
    return raw === "scene" ? "scenes" : raw === "episode" ? "episodes" : raw === "unit" ? "units" : raw === "milestone" ? "milestones" : raw || "parts";
  }

  function dealLabelSingular(item) {
    var plural = dealLabel(item);
    return plural.replace(/s$/, "") || "part";
  }

  function addMonths(value, months) {
    var d = value instanceof Date ? new Date(value) : parseLocalDate(value);
    if (!d) d = todayDate();
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + Number(months || 0));
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    return d;
  }

  function dealPaidPartCount(item) {
    // An instalment with no amount on it yet is a placeholder, not a settled
    // payment — counting it as paid would make an untouched deal look like it
    // had money against it, and lock the row.
    return (item && Array.isArray(item.parts) ? item.parts : []).filter(function (p) { return num(p.amount) > 0 && num(p.paid) >= num(p.amount) - 0.5; }).length;
  }

  function dealHasRecordedMoney(item) {
    return !!(item && (paidOf(item) > 0 || dealPaidPartCount(item) > 0));
  }

  function dealPartAmount(item) {
    var parts = item && Array.isArray(item.parts) ? item.parts : [];
    return parts.length ? num(parts[0].amount) : num(item && item.partAmount);
  }

  function dealPartsFor(item, values) {
    var type = normalizeDealType(values && values.dealType || item && item.dealType || "one");
    var count = Math.max(1, Math.round(num(values && (values.partCount || values.scheduleCount) || item && item.partCount || ((type === "split" || type === "deposit") ? 2 : 1))));
    var label = type === "monthly" ? "months" : String(values && values.partLabel || item && item.partLabel || "parts").trim().toLowerCase() || "parts";
    var start = String(values && (values.startDate || values.expectedBy) || item && item.expectedBy || todayISO());
    var totalInput = roundMoney(values && values.amount != null ? values.amount : grossOf(item));
    var unit = type === "monthly" || type === "part" ? totalInput : (type === "split" ? Math.floor(totalInput / 2) : totalInput);
    if (type === "split") count = 2;
    if (type === "deposit") count = 2;
    if (type === "one") count = 1;
    var dates = [];
    for (var i = 0; i < count; i++) {
      var raw = values && values["partDate_" + i];
      if (!raw && item && item.parts && item.parts[i]) raw = item.parts[i].dueDate;
      if (!raw) raw = type === "monthly" ? dateISO(addMonths(start, i)) : dateISO(addDays(start, i * Math.max(1, Math.round(num(values && values.partEvery || item && item.partEvery || 7)))));
      dates.push(raw);
    }
    if (type === "split") {
      dates[0] = String(values && values.startDate || dates[0]);
      dates[1] = String(values && values.secondDue || dates[1] || dates[0]);
    }
    if (type === "deposit") {
      dates[0] = String(values && (values.depositDue || values.startDate) || dates[0]);
      dates[1] = String(values && (values.balanceDue || values.secondDue) || dates[1] || dates[0]);
    }
    // Monthly/per-part deals have one visible date field — "First / next due
    // date" — for a whole chain the form otherwise generates from a start
    // date and an interval. On an existing deal that chain is already fixed
    // per instalment (the fallback above always prefers it), so this field
    // used to have no effect at all past creation. It now retargets whichever
    // instalment is actually next — the one the field's own label promises —
    // never a payment already marked paid.
    if ((type === "monthly" || type === "part") && values && values.startDate) {
      var existingParts = (item && item.parts) || [];
      var editableIndex = 0;
      for (var k = 0; k < existingParts.length; k++) {
        if (num(existingParts[k].paid) < num(existingParts[k].amount) - 0.5) { editableIndex = k; break; }
      }
      if (editableIndex < count) dates[editableIndex] = String(values.startDate);
    }
    var parts = [];
    for (var j = 0; j < count; j++) {
      var previous = item && item.parts && item.parts[j] ? item.parts[j] : {};
      var amount = unit;
      if (type === "split" && j === 1) amount = Math.max(0, totalInput - unit);
      if (type === "deposit" && j === 0) amount = roundMoney(values && (values.depositAmount != null ? values.depositAmount : values.partAmount_0) != null ? (values.depositAmount != null ? values.depositAmount : values.partAmount_0) : (item && item.parts && item.parts[0] ? item.parts[0].amount : Math.floor(totalInput / 2)));
      if (type === "deposit" && j === 1) amount = Math.max(0, totalInput - num(parts[0] && parts[0].amount));
      if (type === "custom") {
        var customAmount = values && values["partAmount_" + j];
        if (customAmount == null && item && item.parts && item.parts[j]) customAmount = item.parts[j].amount;
        amount = roundMoney(customAmount);
      }
      var rowLabel = type === "deposit" ? (j === 0 ? "Deposit" : "Balance") : type === "custom" ? String(values && values["partLabel_" + j] || previous.label || "Payment " + (j + 1)).trim() : label.replace(/s$/, "") + " " + (j + 1);
      if (type === "one") amount = totalInput;
      parts.push({
        id: previous.id || uid("part"),
        index: j + 1,
        label: rowLabel || ("Payment " + (j + 1)),
        amount: amount,
        dueDate: dates[j] || "",
        paid: num(previous.paid),
        status: previous.status || "Pending",
        paidOn: previous.paidOn || ""
      });
    }
    return parts;
  }

  function dealScheduleHTML(item, editable, fullSchedule) {
    if (!item || !Array.isArray(item.parts) || (!isDeal(item) && !editable)) return "";
    var parts = item.parts || [], label = dealLabel(item), paidCount = dealPaidPartCount(item);
    var visible = editable || fullSchedule ? parts : parts.slice(0, 5);
    var rows = visible.map(function (p, i) {
      var paid = num(p.paid) >= num(p.amount) - 0.5;
      var partial = !paid && num(p.paid) > 0;
      var date = editable ? '<input class="x97-input x97-deal-date" name="partDate_' + i + '" type="date" aria-label="' + attr((p.label || "Payment " + (i + 1)) + " due date") + '" value="' + attr(p.dueDate) + '"' + (editable === "locked" ? " disabled" : "") + '>' : esc(formatDate(p.dueDate, true));
      var labelHTML = editable && normalizeDealType(item.dealType) === "custom" ? '<input class="x97-input x97-deal-label" name="partLabel_' + i + '" value="' + attr(p.label || "Payment " + (i + 1)) + '"' + (editable === "locked" ? " disabled" : "") + '>' : '<b>' + esc(p.label || (dealLabelSingular(item) + " " + (i + 1))) + '</b>';
      var amountHTML = editable && normalizeDealType(item.dealType) === "custom" ? '<input class="x97-input x97-deal-amount" name="partAmount_' + i + '" type="number" min="0" step="1" value="' + attr(p.amount) + '"' + (editable === "locked" ? " disabled" : "") + '>' : '<strong>' + money(p.amount, item.currency) + '</strong>';
      var paidText = partial ? ' · ' + money(p.paid, item.currency) + ' received' : '';
      return '<div class="x97-deal-row ' + (paid ? "paid " : "") + (partial ? "partial" : "") + '"><span class="x97-deal-mark">' + (paid ? icon("check", 12) : (partial ? "·" : (i + 1))) + '</span><div class="x97-deal-part">' + labelHTML + '<span>' + date + paidText + '</span></div>' + amountHTML + '</div>';
    }).join("");
    if (!editable && parts.length > visible.length) rows += '<div class="x97-deal-more">+ ' + (parts.length - visible.length) + ' more ' + esc(label) + '</div>';
    return '<div class="x97-deal-schedule"><div class="x97-deal-schedule-head"><b>' + esc(label) + ' schedule</b><span>' + paidCount + ' of ' + parts.length + ' paid</span></div>' + rows + '</div>';
  }

  function customBuilderRows(item, count, start, locked) {
    var rows = [];
    for (var i = 0; i < Math.max(1, Math.min(24, Math.round(num(count) || 1))); i++) {
      var previous = item && item.parts && item.parts[i] ? item.parts[i] : {};
      var due = previous.dueDate || dateISO(addDays(start || todayISO(), i * 7));
      // Label and amount stay locked with the rest of the deal's structure,
      // but a date is a date: a not-yet-paid instalment can always be moved,
      // and one already paid can't be rescheduled regardless of lock state.
      var partPaid = num(previous.paid) > 0 && num(previous.paid) >= num(previous.amount) - 0.5;
      rows.push('<div class="x97-custom-row"><span class="x97-custom-index">' + (i + 1) + '</span><div class="x97-custom-fields"><input class="x97-input" name="partLabel_' + i + '" aria-label="Payment ' + (i + 1) + ' — what it is for" value="' + attr(previous.label || "Payment " + (i + 1)) + '" placeholder="What is this payment for?"' + (locked ? " disabled" : "") + '><div class="x97-fields-2"><input class="x97-input" name="partAmount_' + i + '" type="number" min="0" step="1" aria-label="Payment ' + (i + 1) + ' amount" value="' + attr(previous.amount || "") + '" placeholder="Amount"' + (locked ? " disabled" : "") + '><input class="x97-input" name="partDate_' + i + '" type="date" aria-label="Payment ' + (i + 1) + ' due date" value="' + attr(due) + '"' + (partPaid ? " disabled" : "") + '></div></div></div>');
    }
    return rows.join("");
  }

  // Every non-reversed ledger payment received in a month, expressed in
  // shillings; dollar receipts use the recorded credit or the current FX rate.
  function earnedIn(doc, key) {
    return (doc.payments || []).filter(function (p) { return !isReversedPayment(p) && monthKey(p.date) === key; }).reduce(function (sum, p) {
      if (String(p.currency).toUpperCase() !== "USD") return sum + num(p.amount);
      var ugx = p.creditedUGX != null ? num(p.creditedUGX) : fxConvert(p.amount, "USD", FX_HOME);
      return sum + (ugx == null ? 0 : ugx);
    }, 0);
  }

  function spentIn(doc, key) {
    return ((doc.expenses && doc.expenses.entries) || []).filter(function (e) {
      return monthKey(e.date) === key && String(e.kind || "").toLowerCase() === "actual";
    }).reduce(function (sum, e) { return sum + num(e.amount); }, 0);
  }

  function earningsSeries(doc, months) {
    var out = [];
    var start = startOfMonth(todayDate());
    for (var i = num(months) - 1; i >= 0; i--) {
      var d = new Date(start.getFullYear(), start.getMonth() - i, 1, 12, 0, 0, 0);
      var key = monthKey(d);
      out.push({ key: key, label: monthLabel(key, true), earned: earnedIn(doc, key), spent: spentIn(doc, key) });
    }
    return out;
  }

  function writeDoc(doc, reason, quiet) {
    if (!doc) return false;
    var value = JSON.stringify(doc);
    try { localStorage.setItem(DATA_KEY, value); } catch (err) { toast("Couldn't save on this device — storage is full or blocked", "error"); return false; }
    lastRaw = value;
    scheduleRender(0);
    if (!quiet) toast(typeof quiet === "string" ? quiet : "Saved", "success");
    return true;
  }

  // Every edit goes through here: read the latest copy, change it, write it back.
  // A device with no document yet (a new account) starts from an empty one, which
  // is only stored once something is actually entered.
  function updateDoc(mutator, reason, quiet) {
    var doc = readDoc();
    if (!doc) {
      // Starting fresh before the cloud copy has loaded would put an empty
      // workspace up against the real one; wait for it instead.
      if (!canStartFresh()) { toast("Still loading your data — try again in a moment", "error"); return false; }
      doc = emptyDoc();
    }
    mutator(doc);
    return writeDoc(doc, reason, quiet);
  }
  // True when there is no cloud copy to wait for: no sync on this page, or sync
  // has loaded and found none (a new account).
  function canStartFresh() {
    var c = cloudState();
    return !c || !!c.ready;
  }
  // The document to draw: the stored one, or an empty workspace once it is
  // certain there is nothing to load. Null means "still loading".
  function viewDoc() {
    return readDoc() || (canStartFresh() ? emptyDoc() : null);
  }

  // The shape every reader expects, with nothing in it. Used for a brand-new
  // workspace; it is never written until the first real edit.
  function emptyDoc() {
    return {
      meta: { appName: "97 LIVE", usdRate: 0 },
      balances: [],
      followups: [],
      credit: [],
      creditLoans: [],
      payments: [],
      expenses: { monthStart: dateISO(startOfMonth(todayDate())), personalBudget: 0, businessBudget: 0, personalCeiling: 0, businessCeiling: 0, entries: [] },
      settings: {
        categories: ["Retainer", "Design", "One Time", "Website", "Social Media", "Ads", "Video", "Branding", "Other"],
        fuStatuses: ["Pending", "Invoice Sent", "Follow Up", "In Progress", "Part Paid", "Paid", "On Hold", "Cancelled"],
        creditStatuses: ["Live", "Ready", "Paid", "Closed", "Currently Unavailable", "Manual"],
        networks: ["Airtel", "MTN"],
        currencies: ["UGX", "USD"]
      }
    };
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
    if (["all", "only", "exclude"].indexOf(state.upcoming.retainers) < 0) state.upcoming.retainers = "all";
    if (state.upcoming.categories.length === 1 && isRetainerCategory(state.upcoming.categories[0]) && state.upcoming.retainers === "all") {
      state.upcoming.categories = []; state.upcoming.retainers = "only";
    }
    // A specific month saved from an earlier day goes stale silently — carry
    // it forward to the current month instead of leaving the Incoming page
    // parked on a month that's already passed. "All months"/"unscheduled" and
    // a deliberately-chosen future month are left alone.
    var currentMonth = monthKey(todayDate());
    if (state.upcoming.month !== "all" && state.upcoming.month !== "unscheduled" && state.upcoming.month < currentMonth) {
      state.upcoming.month = currentMonth;
    }
  }

  /* Theme: light (the default — this is a ledger, and ledgers are white),
     dark, or "system" to follow the device. The choice is remembered per
     device; index.html applies it before first paint so nothing flashes. */
  var systemDark = null;
  function loadTheme() {
    var saved = "";
    try { saved = localStorage.getItem(THEME_KEY) || ""; } catch (_) {}
    return saved === "dark" || saved === "system" ? saved : "light";
  }
  function effectiveTheme(mode) {
    if (mode === "system") return systemDark && systemDark.matches ? "dark" : "light";
    return mode === "dark" ? "dark" : "light";
  }
  function applyTheme(mode) {
    var dark = effectiveTheme(mode) === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    // The browser's own chrome (status bar, address bar) follows too.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0A1211" : "#F4F5F1");
    var toggle = document.querySelector('[data-x97-action="toggle-theme"]');
    if (toggle) {
      toggle.setAttribute("aria-label", dark ? "Use light theme" : "Use dark theme");
      toggle.innerHTML = icon(dark ? "sun" : "moon", 20);
    }
  }
  function setTheme(mode) {
    mode = mode === "dark" || mode === "system" ? mode : "light";
    try { localStorage.setItem(THEME_KEY, mode); } catch (_) {}
    applyTheme(mode);
    scheduleRender(0);
  }

  /* Privacy: blur every amount, for working in public. One tap in the header. */
  function privacyOn() {
    try { return localStorage.getItem(PRIVACY_KEY) === "on"; } catch (_) { return false; }
  }
  function setPrivacy(on) {
    try { localStorage.setItem(PRIVACY_KEY, on ? "on" : "off"); } catch (_) {}
    applyPrivacy();
  }
  function applyPrivacy() {
    var on = privacyOn();
    if (on) document.documentElement.setAttribute("data-privacy", "on");
    else document.documentElement.removeAttribute("data-privacy");
    var toggle = document.querySelector('[data-x97-action="toggle-privacy"]');
    if (toggle) {
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      toggle.setAttribute("aria-label", on ? "Show amounts" : "Hide amounts");
      toggle.innerHTML = icon(on ? "eyeoff" : "eye", 20);
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(state.upcoming)); } catch (_) {}
  }

  /* ── Live FX ──────────────────────────────────────────────────────────────
     Rates are pulled from a free, no-key provider once a day, straight from the
     browser without a middle server. The last good
     table is cached so the converter keeps working offline, and doc.meta.usdRate
     is kept in step so the rest of the app reads the same
     number. Set doc.settings.fxManual to keep a hand-typed rate instead. */

  function parseCurrencyApi(j) {
    if (!j || !j.usd || typeof j.usd !== "object") return null;
    var stamp = parseLocalDate(j.date);
    return { rates: j.usd, updatedAt: stamp ? stamp.getTime() : 0, nextAt: 0 };
  }

  function fxNormalize(rates) {
    var out = {};
    Object.keys(rates || {}).forEach(function (code) {
      var key = String(code).toUpperCase();
      var value = num(rates[code]);
      if (/^[A-Z]{3}$/.test(key) && value > 0 && isFinite(value)) out[key] = value;
    });
    out[FX_BASE] = 1;
    // A payload without a sane home rate is a broken payload — never let it
    // overwrite a good cached table or the user's manual rate.
    if (!(out[FX_HOME] > 100 && out[FX_HOME] < 1000000)) return null;
    return out;
  }

  function fxLoad() {
    var store;
    try { store = JSON.parse(localStorage.getItem(FX_KEY) || "null"); } catch (_) { store = null; }
    if (!store || typeof store !== "object" || !store.rates || !store.rates[FX_HOME]) return null;
    return store;
  }

  function fxSave(store) {
    try { localStorage.setItem(FX_KEY, JSON.stringify(store)); } catch (_) {}
  }

  function fxStale(store) {
    if (!store) return true;
    if (store.day !== todayISO()) return true;
    if (store.nextAt && Date.now() >= store.nextAt) return true;
    return false;
  }

  // Background refreshes used to fail without a trace. The last failure is kept
  // so the app can say why its rates are old, and cleared by the next success.
  function fxFailure() {
    try { return JSON.parse(localStorage.getItem(FX_FAIL_KEY) || "null"); } catch (_) { return null; }
  }
  function fxRecordFailure() {
    try { localStorage.setItem(FX_FAIL_KEY, JSON.stringify({ at: Date.now() })); } catch (_) {}
  }
  function fxClearFailure() {
    try { localStorage.removeItem(FX_FAIL_KEY); } catch (_) {}
  }

  // Why the saved rates are out of date, once that is worth saying: "offline",
  // or "unreachable" after a refresh has been tried and failed. Null while the
  // rates are current or simply haven't been due for a refresh yet.
  function fxStaleReason(store) {
    if (!store || !fxStale(store)) return null;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
    var failure = fxFailure();
    return failure && num(failure.at) >= num(store.fetchedAt) ? "unreachable" : null;
  }

  function fxStaleText(store) {
    var reason = fxStaleReason(store);
    if (reason === "offline") return "Offline. Using rates saved " + fxAgo(store) + ".";
    if (reason === "unreachable") return "Couldn't reach the rate service. Using rates saved " + fxAgo(store) + " — retrying automatically.";
    return "";
  }

  function fxRate(code, store) {
    var s = store || fxLoad();
    if (!s) return 0;
    return num(s.rates[String(code || "").toUpperCase()]);
  }

  function fxConvert(amount, from, to, store) {
    var a = fxRate(from, store), b = fxRate(to, store);
    if (!a || !b) return null;
    return num(amount) / a * b;
  }

  function fxCurrencies(store) {
    var have = (store && store.rates) || {};
    var listed = FX_ORDER.filter(function (c) { return have[c]; });
    var rest = Object.keys(have).filter(function (c) { return FX_ORDER.indexOf(c) < 0; }).sort();
    return listed.concat(rest);
  }

  function fxDecimals(code) {
    var r = fxRate(code);
    if (!r) return /^(UGX|TZS|RWF|BIF|CDF|SSP)$/.test(String(code)) ? 0 : 2;
    // Weak units (UGX, TZS…) read better whole; strong ones need cents.
    return r >= 500 ? 0 : 2;
  }

  function fxAmount(value, code) {
    var n = num(value);
    var abs = Math.abs(n);
    var d = fxDecimals(code);
    // Whole shillings are right for real sums, but "1 TZS = 1" throws the
    // answer away — small results keep their decimals whatever the currency.
    if (abs && abs < 10) d = Math.max(d, abs < 1 ? 4 : 2);
    return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fxRateLine(from, to, store) {
    var one = fxConvert(1, from, to, store);
    if (one == null) return "";
    var d = one >= 500 ? 0 : one >= 1 ? 2 : one >= 0.01 ? 4 : 6;
    return "1 " + from + " = " + one.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + " " + to;
  }

  function fxAgo(store) {
    if (!store) return "never";
    var ms = Date.now() - num(store.updatedAt || store.fetchedAt);
    if (!isFinite(ms) || ms < 0) return "just now";
    var mins = Math.round(ms / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    return days === 1 ? "yesterday" : days + "d ago";
  }

  function fxFetchJSON(url) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    var opts = { cache: "no-store", mode: "cors" };
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (j) { clearTimeout(timer); return j; }, function (err) { clearTimeout(timer); throw err; });
  }

  // Walks the provider list in order and keeps the first sane answer.
  function fxFetch() {
    var i = 0;
    function attempt() {
      if (i >= FX_SOURCES.length) return Promise.reject(new Error("no source available"));
      var src = FX_SOURCES[i++];
      return fxFetchJSON(src.url).then(function (j) {
        var parsed = src.parse(j);
        var rates = parsed && fxNormalize(parsed.rates);
        if (!rates) throw new Error("unusable payload");
        return {
          base: FX_BASE,
          rates: rates,
          source: src.id,
          sourceLabel: src.label,
          fetchedAt: Date.now(),
          updatedAt: parsed.updatedAt || Date.now(),
          nextAt: parsed.nextAt || 0,
          day: todayISO()
        };
      }).catch(attempt);
    }
    return attempt();
  }

  // Keeps doc.meta.usdRate (used by finance calculations and Settings) in step
  // with the live table, unless the user has pinned a manual rate.
  function fxSyncDoc(store) {
    var doc = readDoc();
    if (!doc || !store) return;
    if (doc.settings && doc.settings.fxManual) return;
    var live = Math.round(num(store.rates[FX_HOME]));
    if (!live || Math.abs(num(doc.meta.usdRate) - live) < 1) return;
    doc.meta.usdRate = live;
    writeDoc(doc, "fx-rate", true);
  }

  function fxRefresh(force, onDone) {
    var store = fxLoad();
    if (fxBusy) return;
    if (!force && !fxStale(store)) { if (onDone) onDone(store, null); return; }
    if (!navigator.onLine) {
      if (force) toast("You're offline — showing the last saved rates", "error");
      if (onDone) onDone(store, new Error("offline"));
      return;
    }
    fxBusy = true;
    fxPaint();
    fxFetch().then(function (next) {
      fxBusy = false;
      fxSave(next);
      fxClearFailure();
      fxSyncDoc(next);
      fxPaint();
      scheduleRender(0);
      if (force) toast("Rates updated", "success");
      if (onDone) onDone(next, null);
    }, function (err) {
      fxBusy = false;
      fxRecordFailure();
      fxPaint();
      scheduleRender(0);
      if (force) toast("Could not reach the rate service", "error");
      if (onDone) onDone(fxLoad(), err);
    });
  }

  function fxWatch() {
    fxRefresh(false);
    // A new day should bring new rates even on a device that never gets closed.
    setInterval(function () { fxRefresh(false); }, 30 * 60 * 1000);
    window.addEventListener("online", function () { fxRefresh(false); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) fxRefresh(false); });
  }

  // Sub-line for the dashboard's USD tile: what those dollars are worth at home.
  /* ── Earnings ─────────────────────────────────────────────────────────────
     Earned and spent are the same unit on one scale, so they share one axis.
     Green-in / red-out matches every other inflow/outflow cue in the app, but
     that pair sits at ΔE 6.4 for deuteranopia — so identity never rests on
     colour alone: earned is always the left bar, both are labelled in the key,
     and the sheet carries the same numbers as a table. */

  function earnChartHTML(series) {
    var peak = series.reduce(function (m, r) { return Math.max(m, r.earned, r.spent); }, 0);
    if (peak <= 0) return '<div class="x97-empty">' + icon("trend", 25) + '<strong>No payments recorded yet</strong><p>Mark a receivable paid and this fills in month by month.</p></div>';
    var current = series[series.length - 1];
    var cols = series.map(function (r, i) {
      var last = i === series.length - 1;
      var earnedH = Math.max(r.earned > 0 ? 3 : 0, Math.round(r.earned / peak * 100));
      var spentH = Math.max(r.spent > 0 ? 3 : 0, Math.round(r.spent / peak * 100));
      return '<div class="x97-earn-col' + (last ? " now" : "") + '" style="--i:' + i + '">' +
        '<div class="x97-earn-bars">' +
          '<i class="in" style="height:' + earnedH + '%" title="' + attr(r.label + " earned " + money(r.earned, FX_HOME)) + '"></i>' +
          '<i class="out" style="height:' + spentH + '%" title="' + attr(r.label + " spent " + money(r.spent, FX_HOME)) + '"></i>' +
        '</div><span class="x97-earn-mon">' + esc(r.label.split(" ")[0]) + '</span></div>';
    }).join("");
    return '<div class="x97-earn-key"><span class="in">Earned</span><span class="out">Spent</span></div>' +
      '<div class="x97-earn-chart" role="img" aria-label="' + attr("Earned versus spent for the last " + series.length + " months. " + series.map(function (r) { return r.label + ": earned " + money(r.earned, FX_HOME) + ", spent " + money(r.spent, FX_HOME); }).join(". ")) + '">' + cols + '</div>' +
      '<div class="x97-earn-now">' + esc(current.label) + ' · <b class="x97-green">' + esc(money(current.earned, FX_HOME, true)) + '</b> in · <b class="x97-red">' + esc(money(current.spent, FX_HOME, true)) + '</b> out</div>';
  }

  function openEarnings() {
    var doc = readDoc();
    if (!doc) return;
    var series = earningsSeries(doc, 12).slice().reverse();
    var payments = (doc.payments || []).filter(function (payment) { return !isReversedPayment(payment); }).slice(0, 60);
    var rows = series.filter(function (r) { return r.earned > 0 || r.spent > 0; }).map(function (r) {
      var net = r.earned - r.spent;
      return '<div class="x97-earn-row"><div class="x97-earn-row-mon">' + esc(r.label) + '</div>' +
        '<div class="x97-earn-row-num x97-money x97-green">' + money(r.earned, "", true) + '</div>' +
        '<div class="x97-earn-row-num x97-money x97-red">' + money(r.spent, "", true) + '</div>' +
        '<div class="x97-earn-row-num x97-money ' + (net < 0 ? "x97-red" : "") + '"><b>' + money(net, "", true) + '</b></div></div>';
    }).join("");
    var log = payments.length ? payments.map(function (p) {
      return '<div class="x97-row" style="border-left:0;border-right:0;border-top:0"><div class="x97-row-icon good">' + icon("check") + '</div>' +
        '<div class="x97-row-main"><div class="x97-row-title">' + esc(p.client || "Payment") + '</div>' +
        '<div class="x97-row-sub">' + esc(formatDate(p.date)) + (p.accountName ? " · " + esc(p.accountName) : "") + (p.note ? " · " + esc(p.note) : "") + '</div></div>' +
        '<div class="x97-row-value x97-money x97-green">' + money(p.amount, p.currency) + '</div></div>';
    }).join("") : '<div class="x97-empty"><strong>No payments yet</strong><p>Recording payments builds your earnings history.</p></div>';
    var body =
      '<div class="x97-card x97-pad" style="margin-bottom:15px">' + earnChartHTML(earningsSeries(doc, 6)) + '</div>' +
      (rows ? '<div class="x97-field"><label>Month by month</label><div class="x97-earn-table">' +
        '<div class="x97-earn-row head"><div class="x97-earn-row-mon">Month</div><div class="x97-earn-row-num">In</div><div class="x97-earn-row-num">Out</div><div class="x97-earn-row-num">Kept</div></div>' +
        rows + '</div></div>' : "") +
      '<div class="x97-field"><label>Payments received</label><div class="x97-card" style="overflow:hidden">' + log + '</div></div>';
    var foot = '<button class="x97-btn" data-x97-action="open-exports">' + icon("list", 15) + ' Export</button>' +
      '<button class="x97-btn primary" data-x97-action="close-sheet">Done</button>';
    openSheet("Earnings", body, foot);
  }

  /* ── Books: exports and documents ─────────────────────────────────────── */

  function csvCell(value) {
    var s = String(value == null ? "" : value);
    // Excel reads a leading =, +, - or @ as a formula; prefix so it stays text.
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(headers, rows) {
    return [headers.map(csvCell).join(",")].concat(rows.map(function (r) { return r.map(csvCell).join(","); })).join("\r\n");
  }

  function csvFor(doc, kind) {
    if (kind === "payments") {
      return {
        name: "97-payments",
        csv: toCSV(["Date", "Client", "Category", "Amount", "Currency", "Amount UGX", "Account", "Status", "Applied to", "Note"],
          (doc.payments || []).map(function (p) {
            var ugx = p.creditedUGX != null ? num(p.creditedUGX) : (String(p.currency).toUpperCase() === "USD" ? fxConvert(p.amount, "USD", FX_HOME) : num(p.amount));
            var applied = Array.isArray(p.allocations) ? p.allocations.map(function (a) { return a.partId + ": " + num(a.amount); }).join(" | ") : "";
            return [p.date, p.client, p.category, num(p.amount), p.currency, ugx == null ? "" : Math.round(ugx), p.accountName, p.status || "Received", applied, p.note];
          }))
      };
    }
    if (kind === "expenses") {
      return {
        name: "97-expenses",
        csv: toCSV(["Date", "Type", "Kind", "Item", "Amount", "Note"],
          ((doc.expenses && doc.expenses.entries) || []).map(function (e) { return [e.date, e.type, e.kind, e.item, num(e.amount), e.note]; }))
      };
    }
    return {
      name: "97-receivables",
      csv: toCSV(["Client", "Category", "Deal type", "Invoice total", "Received", "Outstanding", "Currency", "Status", "Next payment", "Next due", "Schedule", "Last payment", "Note"],
        (doc.followups || []).map(function (x) {
          var schedule = projectSchedule(doc, x), next = nextScheduledPayment(doc, x);
          var text = schedule.length > 1 ? schedule.map(function (p) { return p.label + ": " + num(p.amount) + " " + (p.dueDate || "no date") + " (" + p.status + ")"; }).join(" | ") : "";
          return [x.client, x.category, DEAL_TYPES[normalizeDealType(x.dealType)] || "One payment", grossOf(x), paidOf(x), outstandingOf(x), String(x.currency || "UGX").toUpperCase(), normalizeStatus(x.status), next ? next.label : "", next ? next.dueDate : x.expectedBy, text, x.paidOn || "", x.note];
        }))
    };
  }

  function exportCSV(kind) {
    var doc = readDoc();
    if (!doc) return;
    var out = csvFor(doc, kind);
    // A BOM keeps Excel from mangling shillings and accented client names.
    downloadCSV(out.name + "-" + todayISO() + ".csv", "﻿" + out.csv);
    toast("Exported " + out.name.replace("97-", ""), "success");
  }

  function openExports() {
    var doc = readDoc();
    if (!doc) return;
    var counts = {
      receivables: (doc.followups || []).length,
      payments: (doc.payments || []).length,
      expenses: ((doc.expenses && doc.expenses.entries) || []).length
    };
    function row(kind, title, sub) {
      return '<button class="x97-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:transparent;text-align:left" data-x97-action="export-csv" data-kind="' + attr(kind) + '">' +
        '<div class="x97-row-icon good">' + icon("list") + '</div><div class="x97-row-main"><div class="x97-row-title">' + esc(title) + '</div>' +
        '<div class="x97-row-sub">' + esc(sub) + '</div></div>' + icon("chevron") + '</button>';
    }
    var body = '<div class="x97-help" style="margin-bottom:12px">Spreadsheet files your accountant can open directly — amounts, dates and references, no formatting to unpick.</div>' +
      '<div class="x97-card" style="overflow:hidden">' +
        row("receivables", "Receivables", counts.receivables + " records · invoice total, received and outstanding") +
        row("payments", "Payments received", counts.payments + " payments · with UGX value of dollar receipts") +
        row("expenses", "Expenses", counts.expenses + " entries · planned and actual") +
      '</div>';
    openSheet("Export for the books", body, '<button class="x97-btn primary" data-x97-action="close-sheet">Done</button>');
  }

  function docNumber(prefix, item, doc) {
    var list = (doc.followups || []).slice().reverse();
    var seq = Math.max(1, list.findIndex(function (x) { return String(x.id) === String(item.id); }) + 1);
    var d = parseLocalDate((nextScheduledPayment(doc, item) || {}).dueDate || item.expectedBy) || todayDate();
    return prefix + "-" + d.getFullYear() + "-" + String(seq).padStart(3, "0");
  }

  // Invoices and receipts go out over WhatsApp, so they are plain text the
  // client can read in the chat rather than a file they have to open.
  function documentText(item, doc, kind) {
    var currency = String(item.currency || "UGX").toUpperCase();
    var business = String((doc.settings && doc.settings.businessName) || doc.meta.appName || "97 LIVE").trim();
    var receipt = kind === "receipt";
    var lines = [];
    lines.push("*" + (receipt ? "RECEIPT" : "INVOICE") + "*  " + docNumber(receipt ? "RCT" : "INV", item, doc));
    lines.push(business);
    lines.push("");
    lines.push("*Billed to:* " + (item.client || "—"));
    lines.push("*Date:* " + formatDate(todayISO()));
    var next = nextScheduledPayment(doc, item);
    if (!receipt && next && next.dueDate) lines.push("*Next due:* " + (next.label ? next.label + " · " : "") + formatDate(next.dueDate));
    lines.push("");
    if (Array.isArray(item.parts) && item.parts.length > 1) {
      lines.push("*Schedule*");
      projectSchedule(doc, item).forEach(function (p) {
        var left = Math.max(0, num(p.amount) - num(p.paid));
        lines.push("· " + p.label + " — " + money(p.amount, currency) + (p.dueDate ? " · due " + formatDate(p.dueDate, true) : "") + (left <= 0.5 ? " · paid" : num(p.paid) > 0 ? " · " + money(p.paid, currency) + " received" : ""));
      });
    } else lines.push((item.category || "Services") + " — " + money(grossOf(item), currency));
    if (item.note) lines.push("_" + item.note + "_");
    lines.push("");
    lines.push("*Total:* " + money(grossOf(item), currency));
    if (paidOf(item) > 0) {
      lines.push("*Received:* " + money(paidOf(item), currency));
      var left = outstandingOf(item);
      lines.push(left > 0 ? "*Still due:* " + money(left, currency) : "*Settled in full — thank you.*");
    }
    var pays = paymentsFor(doc, item.id);
    if (receipt && pays.length) {
      lines.push("");
      lines.push("*Payments*");
      pays.slice().reverse().forEach(function (p) { lines.push("· " + formatDate(p.date, true) + " — " + money(p.amount, p.currency) + (p.accountName ? " (" + p.accountName + ")" : "")); });
    }
    return lines.join("\n");
  }

  function openDocument(id, kind) {
    var doc = readDoc();
    var item = doc && (doc.followups || []).find(function (x) { return String(x.id) === String(id); });
    if (!item) { toast("That record is no longer there", "error"); return; }
    var text = documentText(item, doc, kind);
    var body = '<div class="x97-field"><label>' + (kind === "receipt" ? "Receipt" : "Invoice") + ' preview</label>' +
      '<div class="x97-doc-preview">' + renderWaFormat(esc(text)).replace(/\n/g, "<br>") + '</div></div>' +
      field("Your business name", '<input class="x97-input" id="x97-doc-business" value="' + attr((doc.settings && doc.settings.businessName) || "") + '" placeholder="' + attr(doc.meta.appName || "97 LIVE") + '">', "Saved and reused on every document.") +
      '<textarea id="x97-doc-text" class="x97-textarea" style="display:none">' + esc(text) + '</textarea>';
    var wa = hasWa(item, doc);
    var foot = '<button class="x97-btn" data-x97-action="copy-document">' + icon("list", 15) + ' Copy</button>' +
      (wa ? '<button class="x97-btn primary" data-x97-action="send-document" data-id="' + attr(item.id) + '" data-kind="' + attr(kind) + '">' + icon("send", 15) + ' Send on WhatsApp</button>'
          : '<button class="x97-btn primary" data-x97-action="close-sheet">Done</button>');
    openSheet(kind === "receipt" ? "Receipt" : "Invoice", body, foot, { afterOpen: function (back) {
      var input = back.querySelector("#x97-doc-business");
      if (input) input.addEventListener("change", function () {
        var name = input.value.trim();
        updateDoc(function (d) { d.settings.businessName = name; }, "business-name", true);
        closeSheet(); openDocument(id, kind);
      });
    } });
  }

  function fxStamp(store) {
    if (fxBusy) return "Updating…";
    if (!store) return navigator.onLine ? "Tap to load rates" : "Offline · no rates yet";
    var live = !fxStale(store);
    return (live ? "Live" : "Last known") + " · " + fxAgo(store);
  }

  function fxBadgeState(store) {
    if (fxBusy) return " busy";
    if (store && !fxStale(store)) return " live";
    return fxStaleReason(store) ? " stale" : "";
  }

  // The dollar rate the app is actually using: your own when you set one, the
  // day's live rate otherwise, and the last saved rate when there is neither.
  function fxCardHTML(doc) {
    var store = fxLoad();
    var manual = !!(doc.settings && doc.settings.fxManual);
    var saved = num(doc.meta && doc.meta.usdRate);
    var rows = store ? FX_TICKER.map(function (code) {
      var value = fxConvert(1, code, FX_HOME, store);
      return '<div class="x97-fx-tick"><span>1 ' + esc(code) + '</span><b class="x97-money">' + (value == null ? "—" : fxAmount(value, FX_HOME)) + '</b></div>';
    }).join("") : "";
    var rate = manual ? saved : store ? fxRate(FX_HOME, store) : saved;
    var headline = rate ? fxAmount(rate, FX_HOME) : "—";
    var note = manual ? "Your own rate — daily updates are paused" : !store && saved ? "Saved rate — live rates load when you're online" : fxStaleText(store);
    return '<section class="card panel">' + sectionHead("Dollar rate", "Converter", "open-converter", "refresh", "info") +
      '<button type="button" class="x97-fx-card" data-x97-action="open-converter">' +
        '<div class="x97-fx-top">' +
          '<div><div class="x97-fx-label">1 USD buys</div>' +
          '<div class="x97-fx-value x97-money">' + headline + ' <em>UGX</em></div></div>' +
          '<div class="x97-fx-badge' + (manual ? "" : fxBadgeState(store)) + '" data-x97-fx="stamp">' + esc(manual ? "Your rate" : fxStamp(store)) + '</div>' +
        '</div>' +
        (rows ? '<div class="x97-fx-ticks">' + rows + '</div>' : '') +
        (note ? '<div class="x97-fx-note"' + (!manual && fxStaleText(store) ? ' data-x97-fx="stale"' : '') + '>' + esc(note) + '</div>' : '') +
      '</button></section>';
  }

  function fxQuickAmounts(from) {
    var weak = fxRate(from) >= 500;
    return weak ? [10000, 50000, 100000, 1000000] : [10, 50, 100, 1000];
  }

  // Chips follow the "from" currency — 1M makes sense in shillings, not dollars.
  function fxQuickHTML(from) {
    return fxQuickAmounts(from).map(function (v) {
      return '<button type="button" class="x97-chip" data-x97-action="fx-amount" data-value="' + v + '">' + money(v, "", true) + '</button>';
    }).join("");
  }

  function fxSwap() {
    var from = document.getElementById("x97-fx-from");
    var to = document.getElementById("x97-fx-to");
    var swapped = fxConv.from;
    fxConv.from = fxConv.to;
    fxConv.to = swapped;
    if (from) from.value = fxConv.from;
    if (to) to.value = fxConv.to;
    var quick = document.querySelector(".x97-fx-quick");
    if (quick) quick.innerHTML = fxQuickHTML(fxConv.from);
    fxPaint();
  }

  function fxSelect(id, selected, store) {
    return '<select class="x97-select" id="' + id + '">' + fxCurrencies(store).map(function (code) {
      return option(code, code + (FX_NAMES[code] ? " · " + FX_NAMES[code] : ""), selected);
    }).join("") + '</select>';
  }

  // Repaints the live parts in place so typing never rebuilds the sheet.
  function fxPaint() {
    var store = fxLoad();
    var state = fxBadgeState(store).trim();
    document.querySelectorAll('[data-x97-fx="stamp"]').forEach(function (el) {
      el.textContent = fxStamp(store);
      el.classList.toggle("busy", state === "busy");
      el.classList.toggle("live", state === "live");
      el.classList.toggle("stale", state === "stale");
    });
    var out = document.getElementById("x97-fx-result");
    if (!out) return;
    var amount = num(fxConv.amount);
    var value = fxConvert(amount, fxConv.from, fxConv.to, store);
    out.textContent = value == null ? "—" : fxAmount(value, fxConv.to);
    var rate = document.getElementById("x97-fx-rate");
    if (rate) rate.textContent = fxRateLine(fxConv.from, fxConv.to, store) || "Rates not loaded yet";
    var inverse = document.getElementById("x97-fx-inverse");
    if (inverse) inverse.textContent = fxRateLine(fxConv.to, fxConv.from, store) || "";
    var meta = document.getElementById("x97-fx-meta");
    if (meta) {
      meta.textContent = store
        ? (fxStaleText(store) || fxStamp(store) + " · " + (store.sourceLabel || store.source || "rate service") + " · refreshes automatically each day")
        : (navigator.onLine ? "No rates saved yet — tap Refresh" : "Offline — connect once to load rates");
    }
  }

  function openConverter() {
    var doc = readDoc() || { settings: {} };
    var store = fxLoad();
    if (!fxCurrencies(store).length) { fxConv.from = "USD"; fxConv.to = "UGX"; }
    var manual = !!(doc.settings && doc.settings.fxManual);
    var chips = fxQuickHTML(fxConv.from);
    var body =
      '<div class="x97-fx-conv">' +
        '<div class="x97-fx-leg">' +
          '<label for="x97-fx-from">From</label>' +
          '<div class="x97-fx-leg-row">' + fxSelect("x97-fx-from", fxConv.from, store) +
          '<input class="x97-input x97-fx-amount x97-money" id="x97-fx-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="' + attr(fxConv.amount) + '"></div>' +
          '<div class="x97-chips x97-fx-quick">' + chips + '</div>' +
        '</div>' +
        '<div class="x97-fx-swap-row"><button type="button" class="x97-fx-swap" data-x97-action="fx-swap" aria-label="Swap currencies">' + icon("arrow", 17) + '</button></div>' +
        '<div class="x97-fx-leg">' +
          '<label for="x97-fx-to">To</label>' +
          '<div class="x97-fx-leg-row">' + fxSelect("x97-fx-to", fxConv.to, store) +
          '<div class="x97-fx-result x97-money" id="x97-fx-result">—</div></div>' +
        '</div>' +
        '<div class="x97-fx-rates"><div id="x97-fx-rate" class="x97-fx-rate-main"></div><div id="x97-fx-inverse" class="x97-fx-rate-sub"></div></div>' +
        '<div class="x97-fx-meta" id="x97-fx-meta"></div>' +
        '<label class="x97-check x97-fx-manual"><input type="checkbox" id="x97-fx-manual"' + (manual ? " checked" : "") + '>' +
          '<span>Keep my own USD rate<em>Stops the daily rate from updating Settings and dashboard calculations</em></span></label>' +
      '</div>';
    var foot = '<button class="x97-btn" data-x97-action="fx-refresh">' + icon("bolt", 15) + 'Refresh</button>' +
      '<button class="x97-btn primary" data-x97-action="close-sheet">Done</button>';
    openSheet("Currency converter", body, foot, { afterOpen: wireConverter });
  }

  function wireConverter(back) {
    var amount = back.querySelector("#x97-fx-amount");
    var from = back.querySelector("#x97-fx-from");
    var to = back.querySelector("#x97-fx-to");
    var manual = back.querySelector("#x97-fx-manual");
    if (amount) amount.addEventListener("input", function () { fxConv.amount = amount.value; fxPaint(); });
    if (from) from.addEventListener("change", function () { fxConv.from = from.value; fxPaint(); });
    if (to) to.addEventListener("change", function () { fxConv.to = to.value; fxPaint(); });
    if (manual) manual.addEventListener("change", function () {
      var on = manual.checked;
      updateDoc(function (doc) { doc.settings.fxManual = on; }, "fx-manual", true);
      if (!on) fxSyncDoc(fxLoad());
      toast(on ? "Auto-update paused — your typed rate stays" : "Auto-update on — daily rate will sync", "success");
      scheduleRender(0);
    });
    fxPaint();
    fxRefresh(false);
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
      send: '<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7Z"></path>',
      undo: '<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"></path>',
      redo: '<path d="m15 14 5-5-5-5"></path><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"></path>',
      columns: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16M15 4v16"></path>',
      minus: '<path d="M5 12h14"></path>',
      lock: '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
      pin: '<path d="M12 2 9 9l-6 2 4.5 3.5L6 21l6-4 6 4-1.5-6.5L21 11l-6-2Z"></path>',
      dots: '<circle cx="12" cy="5" r="1.4"></circle><circle cx="12" cy="12" r="1.4"></circle><circle cx="12" cy="19" r="1.4"></circle>',
      info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 8h.01"></path>',
      sun: '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path>',
      moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path>',
      collapse: '<path d="m7 4 5 5 5-5"></path><path d="m7 20 5-5 5 5"></path>',
      expand: '<path d="m7 9 5-5 5 5"></path><path d="m7 15 5 5 5-5"></path>',
      rows: '<rect x="3" y="5" width="18" height="4" rx="1"></rect><rect x="3" y="11" width="18" height="4" rx="1"></rect><path d="M3 20h18"></path>',
      eye: '<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.6"></circle>',
      eyeoff: '<path d="m3 3 18 18"></path><path d="M10.6 6.1A10 10 0 0 1 12 6c6.1 0 9.5 6 9.5 6a17 17 0 0 1-2.4 3.1M6.4 7.6A16.5 16.5 0 0 0 2.5 12s3.4 6 9.5 6a9.6 9.6 0 0 0 4-.9"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>',
      download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5"></path><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>',
      upload: '<path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5"></path><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"></path>',
      refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"></path><path d="M4 4v4h4"></path><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"></path><path d="M20 20v-4h-4"></path>',
      cloud: '<path d="M7 18h10.5a4.5 4.5 0 0 0 .6-9 6.5 6.5 0 0 0-12.4 1.6A3.8 3.8 0 0 0 7 18Z"></path>',
      receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"></path><path d="M9 8h6M9 12h6"></path>',
      arrowin: '<path d="M17 7 7 17"></path><path d="M16 17H7V8"></path>',
      arrowout: '<path d="M7 17 17 7"></path><path d="M8 7h9v9"></path>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"></path>',
      repeat: '<path d="m17 2 3 3-3 3"></path><path d="M4 11V9a4 4 0 0 1 4-4h12"></path><path d="m7 22-3-3 3-3"></path><path d="M20 13v2a4 4 0 0 1-4 4H4"></path>',
      palette: '<circle cx="12" cy="12" r="9"></circle><circle cx="8" cy="10" r="1.2"></circle><circle cx="12" cy="7.5" r="1.2"></circle><circle cx="16" cy="10" r="1.2"></circle><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a3 3 0 0 0 3-3"></path>',
      database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"></ellipse><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"></path><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"></path>',
      tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9Z"></path><circle cx="7.5" cy="7.5" r="1.3"></circle>'
    };
    return '<svg aria-hidden="true" focusable="false" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || paths.more) + '</svg>';
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

  /* ── Feedback ───────────────────────────────────────────────────────────
     One polite live region (#toasts in index.html), so screen readers hear
     every confirmation. An optional action turns a toast into an undo. */
  function toast(message, kind, action) {
    var holder = document.getElementById("toasts");
    if (!holder) {
      holder = document.createElement("div");
      holder.id = "toasts";
      holder.className = "toasts";
      holder.setAttribute("role", "status");
      holder.setAttribute("aria-live", "polite");
      document.body.appendChild(holder);
    }
    var glyph = kind === "error" ? '<path d="M12 8v5M12 16.5h.01"></path>' : '<path d="m5 12.5 4.5 4.5L19 7"></path>';
    holder.innerHTML = '<div class="toast ' + esc(kind || "") + '"><span class="toast-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</svg></span><span>' + esc(message) + '</span>' +
      (action ? '<button type="button" class="toast-action">' + esc(action.label) + '</button>' : '') + '</div>';
    if (kind === "success") haptic(10);
    if (action) holder.querySelector(".toast-action").addEventListener("click", function () {
      holder.innerHTML = "";
      clearTimeout(holder._timer);
      action.run();
    });
    clearTimeout(holder._timer);
    holder._timer = setTimeout(function () { holder.innerHTML = ""; }, action ? 7000 : 2800);
  }

  // Delete one record from a top-level list (deals, accounts, credit offers),
  // with Undo instead of an "are you sure?" dialog.
  function deleteRecord(list, id, reason) {
    var removed = null, index = -1;
    var ok = updateDoc(function (doc) {
      var arr = doc[list] || [];
      index = arr.findIndex(function (x) { return String(x.id) === String(id); });
      if (index >= 0) removed = arr.splice(index, 1)[0];
    }, reason, true);
    if (!ok || !removed) return;
    closeSheet();
    var name = removed.client || removed.account || removed.service || "record";
    undoable("Deleted " + name, function (doc) {
      var arr = Array.isArray(doc[list]) ? doc[list] : (doc[list] = []);
      if (arr.some(function (x) { return String(x.id) === String(removed.id); })) return;
      arr.splice(Math.min(index, arr.length), 0, removed);
    });
  }

  // A delete that can be taken back for a few seconds. `restore` puts the
  // removed record back into a fresh copy of the document (never a stale one).
  function undoable(message, restore) {
    toast(message, "success", { label: "Undo", run: function () { updateDoc(restore, "undo", "Restored"); } });
  }

  function cloudState() {
    try { return typeof window.__s97cloud === "function" ? window.__s97cloud() : null; } catch (_) { return null; }
  }

  function pageHeader(kicker, title, subtitle, actionHTML, live) {
    return '<header class="page-head"><div class="page-head-text">' +
      (kicker ? '<p class="eyebrow">' + (live ? '<span class="live-dot" aria-hidden="true"></span>' : '') + esc(kicker) + '</p>' : '') +
      '<h1 class="page-title" tabindex="-1">' + esc(title) + '</h1>' +
      (subtitle ? '<p class="page-sub">' + esc(subtitle) + '</p>' : '') +
      '</div>' + (actionHTML ? '<div class="page-actions">' + actionHTML + '</div>' : '') + '</header>';
  }

  function sectionHead(title, actionText, action, iconName, tone) {
    return '<div class="section-head"><h2 class="section-title">' + (iconName ? '<span class="sec-icon' + (tone ? " is-" + tone : "") + '" aria-hidden="true">' + icon(iconName, 16) + '</span>' : '') + esc(title) + '</h2>' +
      (actionText ? '<button type="button" class="link-btn" data-x97-action="' + attr(action) + '">' + esc(actionText) + icon("chevron", 14) + '</button>' : '') + '</div>';
  }

  /* ── Shell and routes ─────────────────────────────────────────────────────
     The header, navigation and <main> are static markup in index.html; this
     only marks the current tab and draws the current screen into <main>.
     Routes live in the address (#/incoming), so Back, refresh and home-screen
     shortcuts all land where they should. */
  var focusAfterRoute = false;

  function routeFromHash() {
    var m = /^#\/?([a-z]+)/.exec(location.hash || "");
    return m && ROUTES[m[1]] ? m[1] : "home";
  }

  function navigate(screen) {
    var route = SCREEN_ROUTE[screen] || (ROUTES[screen] ? screen : "home");
    var hash = "#/" + route;
    focusAfterRoute = true;
    if (location.hash === hash) onRoute();
    else location.hash = hash;
  }

  function onRoute() {
    var screen = ROUTES[routeFromHash()];
    var changed = screen !== currentScreen;
    if (changed) {
      currentScreen = screen;
      screenEntering = true;
      if (document.getElementById("x97-sheet")) closeSheet();
      closeAllPanels();
    }
    var route = SCREEN_ROUTE[screen];
    Array.prototype.forEach.call(document.querySelectorAll(".tab[data-route]"), function (tab) {
      if (tab.getAttribute("data-route") === route) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    });
    document.body.setAttribute("data-screen", screen);
    document.title = screen === "dashboard" ? "97 LIVE" : SCREEN_TITLE[screen] + " · 97 LIVE";
    moveGlider();
    if (changed && focusAfterRoute) haptic(8);
    clearTimeout(renderTimer);
    render();
    if (changed) window.scrollTo(0, 0);
    if (changed && focusAfterRoute) {
      var heading = root && root.querySelector(".page-title");
      if (heading) try { heading.focus({ preventScroll: true }); } catch (_) { heading.focus(); }
    }
    focusAfterRoute = false;
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay == null ? 40 : delay);
  }

  // A redraw would throw away what is being typed into a field on the screen,
  // so it waits until that field loses focus. Fields that the screen patches
  // around (Incoming's search box) opt out with data-live.
  var renderDeferred = false;
  function typingInScreen() {
    var a = document.activeElement;
    if (!a || !root || !root.contains(a) || a.hasAttribute("data-live")) return false;
    return a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable;
  }

  function nextScheduledPayment(doc, item) {
    if (!item || isCancelled(item.status)) return null;
    var rows = doc ? projectSchedule(doc, item) : scheduleRowsFor(item);
    return rows.filter(function (row) { return num(row.paid) < num(row.amount) - 0.5; }).sort(function (a, b) {
      var ad = a.dueDate || "9999-12-31", bd = b.dueDate || "9999-12-31";
      return ad.localeCompare(bd) || num(a.index) - num(b.index);
    })[0] || null;
  }

  function timing(item, doc) {
    if (isCancelled(item.status)) return { key: "cancelled", label: "Cancelled", cls: "", days: null, next: null };
    var next = nextScheduledPayment(doc, item);
    if (!next) return { key: "paid", label: "Paid", cls: "good", days: null, next: null };
    var expectedBy = next.dueDate || item.expectedBy;
    if (!expectedBy) return { key: "unscheduled", label: "Unscheduled", cls: "warn", days: null, next: next };
    var days = daysBetween(todayDate(), parseLocalDate(expectedBy));
    if (days < 0) return { key: "overdue", label: Math.abs(days) + (Math.abs(days) === 1 ? " day overdue" : " days overdue"), cls: "bad", days: days, next: next };
    if (days === 0) return { key: "today", label: "Due today", cls: "bad", days: 0, next: next };
    if (days <= 4) return { key: "very-soon", label: "Due in " + days + " days", cls: "warn", days: days, next: next };
    if (days <= 11) return { key: "soon", label: "Due in " + days + " days", cls: "warn", days: days, next: next };
    return { key: "later", label: "Due in " + days + " days", cls: "", days: days, next: next };
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

  // Loans live in doc.creditLoans and nowhere else. Before that array existed a
  // facility carried at most one loan in its own borrowed / borrowDate /
  // manualDue fields; readDoc() moves such a loan into creditLoans once, so no
  // other code needs to know the old shape. Borrowing again on that facility
  // used to overwrite those fields, silently dropping the older loan.
  function loansOf(doc) { return (doc && doc.creditLoans) || []; }

  function sameLoan(a, facilityId, principal, borrowDate) {
    return String(a.facilityId) === String(facilityId) && num(a.principal) === num(principal) && String(a.borrowDate || "") === String(borrowDate || "");
  }

  // Returns true when it changed the document. Safe to run on every read.
  function migrateFacilityLoans(doc) {
    var loans = doc.creditLoans, changed = false;
    (doc.credit || []).forEach(function (f) {
      var principal = num(f.borrowed), date = String(f.borrowDate || "");
      if (principal <= 0 || !date) return;
      var recorded = loans.some(function (l) { return sameLoan(l, f.id, principal, date); });
      if (!recorded) {
        // These fields match no loan while another one is open on this facility.
        // Earlier versions never showed such fields as debt; leave them untouched.
        if (loans.some(function (l) { return isActiveLoan(l) && String(l.facilityId) === String(f.id); })) return;
        loans.push({
          // Derived from the loan itself, so two devices migrating the same
          // document produce the same record and sync merges them into one.
          id: "legacy-" + f.id + "-" + date + "-" + principal,
          facilityId: f.id,
          principal: principal,
          borrowDate: date,
          dueDate: dateISO(addDays(date, num(f.termDays || 30))),
          feeModelSnapshot: f.feeModel,
          baseFeeSnapshot: num(f.baseFee),
          dailyRateSnapshot: num(f.dailyRate),
          termDaysSnapshot: num(f.termDays || 30),
          manualDue: num(f.manualDue),
          status: "Active",
          notes: f.notes || "",
          migratedFrom: "facility"
        });
      }
      f.borrowed = 0;
      f.borrowDate = "";
      f.manualDue = 0;
      changed = true;
    });
    // A version from before this migration repays such a loan by saving its own
    // copy. If that copy arrives beside the migrated one, the repaid copy wins.
    for (var i = loans.length - 1; i >= 0; i--) {
      var m = loans[i];
      if (m.migratedFrom !== "facility" || !isActiveLoan(m)) continue;
      if (loans.some(function (l) { return l !== m && !isActiveLoan(l) && sameLoan(l, m.facilityId, m.principal, m.borrowDate); })) {
        loans.splice(i, 1);
        changed = true;
      }
    }
    return changed;
  }

  function isActiveLoan(loan) { return !/repaid|cancel/i.test(String(loan.status || "Active")); }

  function scheduledEvents(doc, includeSettled) {
    var events = [];
    (doc.followups || []).forEach(function (item) {
      if (isCancelled(item.status)) return;
      projectSchedule(doc, item).forEach(function (row) {
        var outstanding = Math.max(0, num(row.amount) - num(row.paid));
        if (!includeSettled && outstanding <= 0.5) return;
        events.push({
          id: item.id + "::" + row.id,
          itemId: item.id,
          client: item.client || "Incoming payment",
          label: row.label || "Payment",
          date: row.dueDate || "",
          amount: includeSettled ? num(row.amount) : outstanding,
          scheduledAmount: num(row.amount),
          paid: num(row.paid),
          currency: String(item.currency || "UGX").toUpperCase(),
          item: item,
          row: row
        });
      });
    });
    return events;
  }

  function analytics(doc) {
    var balances = doc.balances || [];
    var cash = balances.reduce(function (a, b) { return a + num(b.balance); }, 0);
    var loans = loansOf(doc);
    var activeLoans = loans.filter(isActiveLoan);
    var debt = activeLoans.reduce(function (a, loan) { return a + estimateLoan(loan, todayISO()); }, 0);
    var open = (doc.followups || []).filter(isOpenFollowup);
    var events = scheduledEvents(doc, false);
    var overdue = events.filter(function (x) { var d = daysBetween(todayDate(), parseLocalDate(x.date)); return d != null && d < 0; });
    var next7 = events.filter(function (x) { var d = daysBetween(todayDate(), parseLocalDate(x.date)); return d != null && d >= 0 && d <= 7; });
    var currentMonth = monthKey(todayDate());
    var thisMonth = events.filter(function (x) { return monthKey(x.date) === currentMonth; });
    var ugxMonth = thisMonth.filter(function (x) { return String(x.currency).toUpperCase() !== "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var usdMonth = thisMonth.filter(function (x) { return String(x.currency).toUpperCase() === "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var creditAvailable = (doc.credit || []).filter(isFacilityLive).reduce(function (a, f) {
      var borrowed = activeLoans.filter(function (l) { return String(l.facilityId) === String(f.id); }).reduce(function (s, l) { return s + num(l.principal); }, 0);
      return a + Math.max(0, num(f.limitOffer) - borrowed);
    }, 0);
    return { cash: cash, loans: loans, activeLoans: activeLoans, debt: debt, open: open, events: events, overdue: overdue, next7: next7, ugxMonth: ugxMonth, usdMonth: usdMonth, creditAvailable: creditAvailable, expenses: expenseStats(doc) };
  }

  // What a list of scheduled events is worth, per currency ("UGX 4.2M + USD 1.5K").
  function attentionAmount(events) {
    var ugx = 0, usd = 0;
    (events || []).forEach(function (event) {
      if (String(event.currency || "UGX").toUpperCase() === "USD") usd += num(event.amount);
      else ugx += num(event.amount);
    });
    var parts = [];
    if (ugx) parts.push(money(ugx, "UGX", true));
    if (usd) parts.push(money(usd, "USD", true));
    return parts.join(" + ");
  }

  function joinMeta() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(" · ");
  }

  /* ── Money model shared by Home and Expenses ─────────────────────────────
     Dollars count at the live rate when there is one and at the rate saved in
     Settings otherwise — never silently dropped, which would understate. */
  function usdRateFor(doc) {
    var live = fxConvert(1, "USD", FX_HOME);
    return live != null ? live : num(doc && doc.meta && doc.meta.usdRate);
  }
  function toHome(amount, currency, doc) {
    return String(currency || "UGX").toUpperCase() === "USD" ? num(amount) * usdRateFor(doc) : num(amount);
  }

  function expenseKey(item) { return String(item || "").trim().toUpperCase(); }
  function isActualExpense(x) { return /actual/i.test(String(x && x.kind || "")); }
  function expenseType(x) { return /business/i.test(String(x && x.type || "")) ? "Business" : "Personal"; }

  // How one budget stands in one month. A planned entry is drawn down by the
  // actual entries logged under the same name that month, so paying a planned
  // bill never counts twice. safe = budget − spent − still planned.
  function budgetUse(doc, type, key) {
    var e = doc.expenses || {};
    var entries = (e.entries || []).filter(function (x) { return monthKey(x.date) === key && expenseType(x) === type; });
    var actual = 0, planned = {}, spent = {};
    entries.forEach(function (x) {
      var k = expenseKey(x.item);
      if (isActualExpense(x)) { actual += num(x.amount); spent[k] = (spent[k] || 0) + num(x.amount); }
      else planned[k] = (planned[k] || 0) + num(x.amount);
    });
    var stillPlanned = Object.keys(planned).reduce(function (s, k) { return s + Math.max(0, planned[k] - (spent[k] || 0)); }, 0);
    var budget = num(type === "Business" ? e.businessBudget : e.personalBudget);
    var used = budget > 0 ? (actual + stillPlanned) / budget : 0;
    return {
      type: type, key: key, budget: budget, actual: actual, stillPlanned: stillPlanned,
      safe: budget - actual - stillPlanned, used: used, count: entries.length,
      tone: budget <= 0 ? "" : used >= 1 ? "bad" : used >= 0.8 ? "warn" : "good"
    };
  }

  function expenseStats(doc) {
    var key = monthKey(todayDate());
    var p = budgetUse(doc, "Personal", key), b = budgetUse(doc, "Business", key);
    return {
      personalPlanned: p.stillPlanned, personalActual: p.actual, businessPlanned: b.stillPlanned, businessActual: b.actual,
      personalSafe: p.safe, businessSafe: b.safe, personalBudget: p.budget, businessBudget: b.budget
    };
  }

  // Planned spending still to pay, each on its own date: a planned entry less
  // what has actually been spent under the same name that month (earliest plan
  // first). Plans from past months are history, not plans.
  function plannedOutflows(doc) {
    var current = monthKey(todayDate());
    var entries = ((doc.expenses && doc.expenses.entries) || []).slice();
    var spent = {};
    function slot(x) { return monthKey(x.date) + "|" + expenseType(x) + "|" + expenseKey(x.item); }
    entries.forEach(function (x) { if (isActualExpense(x) && x.date) spent[slot(x)] = (spent[slot(x)] || 0) + num(x.amount); });
    return entries.filter(function (x) { return !isActualExpense(x) && x.date && monthKey(x.date) >= current; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
      .map(function (x) {
        var k = slot(x), take = Math.min(num(x.amount), spent[k] || 0);
        spent[k] = (spent[k] || 0) - take;
        return { id: x.id, date: x.date, item: x.item, type: expenseType(x), amount: num(x.amount) - take };
      }).filter(function (x) { return x.amount > 0.5; });
  }

  /* Cash forecast: today's balances, then every dated movement in the window —
     scheduled incoming (not overdue: that is not assumed to arrive), planned
     spending still to pay, and loan repayments at what they will cost on the
     day. Anything already late is counted as due today. */
  function cashForecast(doc, days) {
    var today = todayISO(), end = dateISO(addDays(todayDate(), days));
    var cash = (doc.balances || []).reduce(function (a, b) { return a + num(b.balance); }, 0);
    var moves = [], overdueIn = 0;
    scheduledEvents(doc, false).forEach(function (ev) {
      if (!ev.date) return;
      var value = toHome(ev.amount, ev.currency, doc);
      if (ev.date < today) { overdueIn += value; return; }
      if (ev.date > end) return;
      moves.push({ date: ev.date, dir: "in", amount: value, original: num(ev.amount), currency: String(ev.currency || "UGX").toUpperCase(), title: ev.client, label: ev.label, screen: "upcoming", id: ev.itemId });
    });
    plannedOutflows(doc).forEach(function (p) {
      var date = p.date < today ? today : p.date;
      if (date > end) return;
      moves.push({ date: date, dir: "out", amount: p.amount, original: p.amount, currency: "UGX", title: p.item || "Planned expense", label: p.type + " · planned", screen: "expenses", id: p.id });
    });
    loansOf(doc).filter(isActiveLoan).forEach(function (loan) {
      var due = dueDateForLoan(loan), date = due < today ? today : due;
      if (date > end) return;
      var f = facilityById(doc, loan.facilityId) || {};
      var value = estimateLoan(loan, date);
      moves.push({ date: date, dir: "out", amount: value, original: value, currency: "UGX", title: (f.service || "Credit") + " repayment", label: f.network || "Credit", screen: "credit", id: loan.id });
    });
    // Same day: money out first, so the lowest point is never understated.
    moves.sort(function (a, b) { return a.date.localeCompare(b.date) || (a.dir === b.dir ? 0 : a.dir === "out" ? -1 : 1); });
    var balance = cash, low = cash, lowDate = today, inflow = 0, outflow = 0, points = [{ date: today, balance: cash }];
    moves.forEach(function (m) {
      if (m.dir === "in") { balance += m.amount; inflow += m.amount; } else { balance -= m.amount; outflow += m.amount; }
      m.balance = balance;
      if (balance < low) { low = balance; lowDate = m.date; }
      points.push({ date: m.date, balance: balance });
    });
    return { days: days, today: today, endDate: end, cash: cash, inflow: inflow, outflow: outflow, end: balance, low: low, lowDate: lowDate, moves: moves, points: points, overdueIn: overdueIn };
  }

  // How many days the cash on hand lasts at the recent daily spend (actual
  // expenses over up to the last 90 days). Null without enough history.
  function runwayDays(doc, cash) {
    var today = todayDate(), from = dateISO(addDays(today, -89)), to = todayISO();
    var actual = ((doc.expenses && doc.expenses.entries) || []).filter(function (x) { return isActualExpense(x) && x.date && x.date >= from && x.date <= to; });
    if (!actual.length) return null;
    var total = actual.reduce(function (s, x) { return s + num(x.amount); }, 0);
    var earliest = actual.reduce(function (m, x) { return x.date < m ? x.date : m; }, to);
    var span = Math.min(90, Math.max(30, daysBetween(parseLocalDate(earliest), today) + 1));
    var daily = total / span;
    if (daily <= 0) return null;
    return Math.max(0, Math.floor(cash / daily));
  }

  // A step line of the projected balance across the window.
  function sparklineSVG(fc) {
    var W = 300, H = 56, pad = 3;
    var values = fc.points.map(function (p) { return p.balance; });
    var max = Math.max.apply(null, values.concat([0])), min = Math.min.apply(null, values.concat([0]));
    var span = max - min || 1;
    function x(date) { var d = daysBetween(parseLocalDate(fc.today), parseLocalDate(date)); return pad + (W - 2 * pad) * Math.max(0, Math.min(1, d / fc.days)); }
    function y(v) { return pad + (H - 2 * pad) * (1 - (v - min) / span); }
    var d = "M" + x(fc.today).toFixed(1) + " " + y(fc.cash).toFixed(1), last = fc.cash;
    fc.points.slice(1).forEach(function (p) { d += " H" + x(p.date).toFixed(1) + " V" + y(p.balance).toFixed(1); last = p.balance; });
    d += " H" + (W - pad);
    var zero = min < 0 ? '<line class="spark-zero" x1="0" x2="' + W + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"></line>' : "";
    var dot = '<span class="spark-dot" style="left:' + ((W - pad) / W * 100).toFixed(2) + '%;top:' + (y(last) / H * 100).toFixed(2) + '%"></span>';
    return '<span class="spark-wrap" aria-hidden="true"><svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + zero + '<path class="spark-fill" d="' + d + ' V' + H + ' H' + pad + ' Z"></path><path class="spark-line" d="' + d + '"></path></svg>' + dot + '</span>';
  }

  /* One prioritised list of what needs doing, most urgent first. Each item
     says what, how much, and opens the exact filtered view that deals with it. */
  function attentionItems(doc, a, fc) {
    var items = [];
    var today = todayISO();
    if (a.overdue.length) {
      var worst = 0;
      a.overdue.forEach(function (ev) { var d = daysBetween(todayDate(), parseLocalDate(ev.date)); if (d != null && d < 0) worst = Math.max(worst, -d); });
      var clients = {};
      a.overdue.forEach(function (ev) { clients[ev.itemId] = true; });
      var n = Object.keys(clients).length;
      items.push({ tone: "bad", count: a.overdue.length, title: a.overdue.length === 1 ? "Overdue payment" : "Overdue payments", meta: joinMeta(attentionAmount(a.overdue), n > 1 ? "from " + n + " clients" : "", worst ? "oldest " + worst + (worst === 1 ? " day" : " days") : ""), screen: "upcoming", quick: "overdue" });
    }
    var lateLoans = a.activeLoans.filter(function (l) { return dueDateForLoan(l) < today; });
    if (lateLoans.length) items.push({ tone: "bad", count: lateLoans.length, title: lateLoans.length === 1 ? "Overdue loan repayment" : "Overdue loan repayments", meta: joinMeta(money(lateLoans.reduce(function (s, l) { return s + estimateLoan(l, today); }, 0), "UGX", true) + " to clear", "fees keep growing"), screen: "credit", view: "borrowed" });
    if (fc.low < 0) items.push({ tone: "bad", title: "Cash could run short on " + formatDate(fc.lowDate, true), meta: joinMeta("projected " + money(fc.low, "UGX", true), "unless overdue money comes in"), action: "open-forecast" });
    var soonLoans = a.activeLoans.filter(function (l) { var d = daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))); return d != null && d >= 0 && d <= 3; });
    if (soonLoans.length) items.push({ tone: "warn", count: soonLoans.length, title: soonLoans.length === 1 ? "Loan due within 3 days" : "Loans due within 3 days", meta: joinMeta(money(soonLoans.reduce(function (s, l) { return s + estimateLoan(l, dueDateForLoan(l)); }, 0), "UGX", true), "earliest " + nextLoanDue(soonLoans)), screen: "credit", view: "borrowed" });
    ["Personal", "Business"].forEach(function (type) {
      var u = budgetUse(doc, type, monthKey(todayDate()));
      if (u.budget > 0 && u.safe < 0) items.push({ tone: "bad", title: type + " budget is over", meta: money(-u.safe, "UGX", true) + " above " + money(u.budget, "UGX", true), screen: "expenses" });
    });
    if (a.next7.length) items.push({ tone: "warn", count: a.next7.length, title: a.next7.length === 1 ? "Payment due this week" : "Payments due this week", meta: attentionAmount(a.next7), screen: "upcoming", quick: "next7" });
    var undated = a.open.filter(function (x) { var next = nextScheduledPayment(doc, x); return !next || !next.dueDate; });
    if (undated.length) items.push({ tone: "info", count: undated.length, title: undated.length === 1 ? "Deal without a due date" : "Deals without a due date", meta: joinMeta(attentionAmount(undated.map(function (x) { return { amount: outstandingOf(x), currency: x.currency }; })), "add one so it counts"), screen: "upcoming", quick: "unscheduled" });
    return items;
  }

  function attentionHTML(items) {
    if (!items.length) return '<div class="all-clear">' + icon("check", 20) + '<div><strong>All clear</strong><span>Nothing overdue, nothing due this week, budgets on track.</span></div></div>';
    return '<div class="attention">' + items.slice(0, 5).map(function (x) {
      var attrs = x.action ? 'data-x97-action="' + attr(x.action) + '"' : 'data-x97-action="go" data-screen="' + attr(x.screen) + '"' + (x.quick ? ' data-quick="' + attr(x.quick) + '"' : '') + (x.view ? ' data-view="' + attr(x.view) + '"' : '');
      return '<button type="button" class="att is-' + esc(x.tone) + '" ' + attrs + '>' +
        (x.count != null ? '<span class="att-count">' + esc(x.count) + '</span>' : '<span class="att-count is-icon">' + icon(x.tone === "bad" ? "alert" : "info", 16) + '</span>') +
        '<span class="att-body"><span class="att-title">' + esc(x.title) + '</span>' + (x.meta ? '<span class="att-meta">' + esc(x.meta) + '</span>' : '') + '</span>' +
        icon("chevron", 16) + '</button>';
    }).join("") + '</div>';
  }

  function moveRow(m) {
    var d = parseLocalDate(m.date);
    var usd = m.currency === "USD";
    return '<button type="button" class="move is-' + m.dir + '" data-x97-action="go" data-screen="' + attr(m.screen) + '">' +
      '<span class="move-date"><b>' + (d ? d.getDate() : "") + '</b><span>' + esc(d ? d.toLocaleDateString(undefined, { month: "short" }) : "") + '</span></span>' +
      '<span class="move-main"><b>' + esc(m.title || "") + '</b><span>' + esc(joinMeta(m.label, relDay(m.date))) + '</span></span>' +
      '<span class="move-amt x97-money">' + (m.dir === "in" ? "+" : "−") + esc(money(usd ? m.original : m.amount, usd ? "USD" : "UGX", true)) + '</span></button>';
  }

  // A compact figure with a small currency code, for the hero's three tiles.
  function heroFig(value) {
    return '<span class="cur">UGX</span>' + esc(money(value, "", true));
  }

  function greetingLine() {
    var hour = new Date().getHours();
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  }

  function renderDashboard(doc) {
    var a = analytics(doc);
    var fc = cashForecast(doc, 30);
    var items = attentionItems(doc, a, fc);
    var cash = a.cash;
    var outUGX = a.open.filter(function (x) { return String(x.currency || "UGX").toUpperCase() !== "USD"; }).reduce(function (s, x) { return s + outstandingOf(x); }, 0);
    var outUSD = a.open.filter(function (x) { return String(x.currency || "UGX").toUpperCase() === "USD"; }).reduce(function (s, x) { return s + outstandingOf(x); }, 0);
    var owed = outUGX + outUSD * usdRateFor(doc);
    var runway = runwayDays(doc, cash);
    var key = monthKey(todayDate());
    var earned = earnedIn(doc, key), spent = spentIn(doc, key);
    // One line under the greeting that says what the list below says, with numbers.
    var summary = items.length ? items.slice(0, 2).map(function (x) {
      return x.count != null ? x.count + " " + x.title.charAt(0).toLowerCase() + x.title.slice(1) : x.title;
    }).join(" · ") + (items.length > 2 ? " · and more" : "") : "Everything is on track — nothing overdue or due this week.";
    var dateLine = todayDate().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    var stale = outUSD && fxStaleReason(fxLoad()) ? " · rate saved " + fxAgo(fxLoad()) : "";

    var hero = '<section class="hero" aria-labelledby="hero-label">' +
      '<div class="hero-aura" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<div class="hero-top"><span id="hero-label" class="hero-label">Cash on hand</span><button type="button" class="hero-edit" data-x97-action="edit-balances">' + icon("edit", 15) + '<span>Update</span></button></div>' +
      '<div class="hero-value x97-money" data-count="cash">' + money(cash, "UGX") + '</div>' +
      '<div class="hero-sub">' + esc(joinMeta((doc.balances || []).length + ((doc.balances || []).length === 1 ? " account" : " accounts"), runway == null ? "" : runway > 365 ? "over a year of spending" : "about " + runway + (runway === 1 ? " day" : " days") + " of spending")) + '</div>' +
      '<div class="hero-grid">' +
        '<button type="button" class="hero-fig" data-x97-action="go" data-screen="upcoming" data-quick="open"><span>Owed to you</span><b class="x97-money" data-count="owed">' + heroFig(owed) + '</b>' + (outUSD ? '<small>incl. ' + esc(money(outUSD, "USD", true) + stale) + '</small>' : '<small>' + a.open.length + (a.open.length === 1 ? ' open deal' : ' open deals') + '</small>') + '</button>' +
        '<button type="button" class="hero-fig" data-x97-action="go" data-screen="credit" data-view="borrowed"><span>You owe</span><b class="x97-money" data-count="owe">' + heroFig(a.debt) + '</b><small>' + (a.activeLoans.length ? a.activeLoans.length + (a.activeLoans.length === 1 ? " loan" : " loans") + " · next " + esc(nextLoanDue(a.activeLoans)) : "No loans") + '</small></button>' +
        '<button type="button" class="hero-fig" data-x97-action="go" data-screen="credit"><span>Can borrow</span><b class="x97-money" data-count="borrow">' + heroFig(a.creditAvailable) + '</b><small>Not counted as cash</small></button>' +
      '</div>' +
      '<button type="button" class="forecast" data-x97-action="open-forecast">' +
        '<span class="forecast-text"><span>In 30 days</span><b class="x97-money" data-count="fc30">' + money(fc.end, "UGX", true) + '</b><small>' + esc(fc.low < fc.cash ? "Lowest " + money(fc.low, "UGX", true) + " on " + formatDate(fc.lowDate, true) : "Never below today") + '</small></span>' +
        sparklineSVG(fc) + '</button>' +
    '</section>';

    var quick = '<div class="quick">' +
      '<button type="button" class="quick-btn is-pay" data-x97-action="record-payment"><span class="qi" aria-hidden="true">' + icon("wallet", 19) + '</span><span>Record payment</span></button>' +
      '<button type="button" class="quick-btn is-deal" data-x97-action="add-upcoming"><span class="qi" aria-hidden="true">' + icon("plus", 19) + '</span><span>New deal</span></button>' +
      '<button type="button" class="quick-btn is-spend" data-x97-action="add-expense"><span class="qi" aria-hidden="true">' + icon("receipt", 19) + '</span><span>Log expense</span></button>' +
    '</div>';

    var soon = fc.moves.filter(function (m) { return daysBetween(todayDate(), parseLocalDate(m.date)) <= 14; });
    var coming = '<section class="card panel">' + sectionHead("Next two weeks", fc.moves.length ? "Full forecast" : "", "open-forecast", "calendar", "info") +
      (soon.length ? '<div class="moves">' + soon.slice(0, 6).map(moveRow).join("") + '</div>' + (soon.length > 6 ? '<button type="button" class="more-link" data-x97-action="open-forecast">' + (soon.length - 6) + ' more</button>' : '')
        : emptyState("calendar", "Nothing dated in the next two weeks", "Add due dates to deals and planned expenses to see them here.")) +
    '</section>';

    var month = '<section class="card panel">' + sectionHead(monthLabel(key) , "History", "open-earnings", "trend", "pos") +
      '<div class="trio">' +
        '<div><span>Collected</span><b class="x97-money pos" data-count="collected">' + money(earned, "UGX", true) + '</b></div>' +
        '<div><span>Spent</span><b class="x97-money neg" data-count="spent">' + money(spent, "UGX", true) + '</b></div>' +
        '<div><span>Kept</span><b class="x97-money' + (earned - spent < 0 ? " neg" : "") + '" data-count="kept">' + money(earned - spent, "UGX", true) + '</b></div>' +
      '</div>' + earnChartHTML(earningsSeries(doc, 6)) + '</section>';

    var accounts = (doc.balances || []).slice().sort(function (x, y) {
      var xe = /equity/i.test(String(x.account || "")), ye = /equity/i.test(String(y.account || ""));
      return xe === ye ? num(y.balance) - num(x.balance) : xe ? -1 : 1;
    });
    var accountsCard = '<section class="card panel">' + sectionHead("Accounts", "Add", "add-account", "bank") +
      (accounts.length ? '<div class="list">' + accounts.map(function (b) {
        return '<button type="button" class="list-row" data-x97-action="edit-account" data-id="' + attr(b.id) + '">' + accountIconBox(b.account) + '<span class="list-main"><b>' + esc(b.account || "Account") + '</b><span>' + esc(b.line || b.notes || "Tap to update") + '</span></span><span class="list-value"><b class="x97-money">' + money(b.balance, "UGX") + '</b></span></button>';
      }).join("") + '</div>' : emptyState("bank", "No accounts yet", "Add your bank, mobile money and cash so Home can add them up.", '<button type="button" class="x97-btn" data-x97-action="add-account">' + icon("plus", 16) + ' Add account</button>')) +
    '</section>';

    var budgets = ["Personal", "Business"].map(function (type) { return budgetUse(doc, type, key); });
    var budgetCard = '<section class="card panel">' + sectionHead("Budgets", "Expenses", "go-expenses", "wallet", "warn") +
      budgets.map(function (u) { return budgetBarHTML(u, true); }).join("") + '</section>';

    var pipeMonths = [];
    for (var i = 0; i < 6; i++) {
      var d = startOfMonth(todayDate()); d.setMonth(d.getMonth() + i);
      var mk = monthKey(d), ev = scheduledEvents(doc, false).filter(function (x) { return monthKey(x.date) === mk; });
      if (ev.length) pipeMonths.push({ key: mk, events: ev });
    }
    var pipeline = '<section class="card panel">' + sectionHead("Coming in", "All deals", "go-upcoming", "arrowin", "pos") +
      (pipeMonths.length ? '<div class="pipe">' + pipeMonths.slice(0, 4).map(function (m) {
        var ugx = m.events.filter(function (x) { return x.currency !== "USD"; }).reduce(function (s, x) { return s + num(x.amount); }, 0);
        var usd = m.events.filter(function (x) { return x.currency === "USD"; }).reduce(function (s, x) { return s + num(x.amount); }, 0);
        var deals = {}; m.events.forEach(function (x) { deals[x.itemId] = true; });
        return '<button type="button" class="pipe-row" data-x97-action="open-month" data-month="' + attr(m.key) + '"><span class="pipe-month">' + esc(monthLabel(m.key, true)) + '</span><span class="pipe-count">' + Object.keys(deals).length + (Object.keys(deals).length === 1 ? ' deal' : ' deals') + '</span><span class="pipe-amt"><b class="x97-money">' + (ugx ? money(ugx, "UGX", true) : "") + '</b>' + (usd ? '<b class="x97-money usd">' + money(usd, "USD", true) + '</b>' : '') + '</span></button>';
      }).join("") + '</div>' : emptyState("trend", "Nothing scheduled", "Deals with due dates show up here by month.")) +
    '</section>';

    var s = messagingSummary(doc);
    var msgCard = '<section class="card panel">' + sectionHead("Reminders", "Open", "open-messaging", "message") +
      '<button type="button" class="msg-card" data-x97-action="open-messaging"><span class="msg-icon">' + icon("message", 20) + '</span><span class="msg-main"><b>WhatsApp reminders &amp; campaigns</b><span>' + esc(joinMeta(s.contacts + " contacts", s.campaigns + " campaigns", remindExt.ready ? "sender connected" : "")) + '</span></span>' +
      (s.overdue ? '<span class="pill bad">' + s.overdue + ' to chase</span>' : s.dueSoon ? '<span class="pill warn">' + s.dueSoon + ' due soon</span>' : '<span class="pill good">All clear</span>') + '</button></section>';

    root.innerHTML = '<div class="page home" data-page="dashboard">' +
      pageHeader(dateLine, greetingLine(), summary, "", true) +
      '<div class="home-grid">' +
        '<div class="home-hero">' + hero + quick + '</div>' +
        '<section class="card panel home-attn">' + sectionHead("Needs attention", "Incoming", "go-upcoming", items.length ? "alert" : "check", items.length ? "bad" : "pos") + attentionHTML(items) + '</section>' +
        '<div class="home-coming">' + coming + '</div>' +
        '<div class="home-month">' + month + '</div>' +
        '<div class="home-accounts">' + accountsCard + '</div>' +
        '<div class="home-budgets">' + budgetCard + '</div>' +
        '<div class="home-pipe">' + pipeline + '</div>' +
        '<div class="home-msg">' + msgCard + '</div>' +
        '<div class="home-fx">' + fxCardHTML(doc) + '</div>' +
      '</div></div>';
  }

  // The forecast in full: pick a horizon, see every movement and the balance after it.
  function openForecast(days) {
    var doc = viewDoc();
    if (!doc) return;
    days = num(days) || 30;
    var fc = cashForecast(doc, days);
    var rows = fc.moves.length ? '<div class="moves with-balance">' + fc.moves.map(function (m) {
      return moveRow(m).replace('</button>', '<span class="move-bal x97-money' + (m.balance < 0 ? " neg" : "") + '">' + money(m.balance, "UGX", true) + '</span></button>');
    }).join("") + '</div>' : emptyState("calendar", "Nothing dated in this window", "");
    var body = '<div class="segmented" role="tablist" aria-label="Forecast horizon">' +
        [30, 60, 90].map(function (n) { return segButton("forecast-days", String(n), n + " days", String(days)); }).join("") + '</div>' +
      '<div class="card forecast-card">' + sparklineSVG(fc) +
        '<div class="trio">' +
          '<div><span>Today</span><b class="x97-money">' + money(fc.cash, "UGX", true) + '</b></div>' +
          '<div><span>In ' + days + ' days</span><b class="x97-money' + (fc.end < 0 ? " neg" : "") + '">' + money(fc.end, "UGX", true) + '</b></div>' +
          '<div><span>Lowest</span><b class="x97-money' + (fc.low < 0 ? " neg" : "") + '">' + money(fc.low, "UGX", true) + '</b></div>' +
        '</div>' +
        '<p class="note">' + esc(joinMeta("+" + money(fc.inflow, "UGX", true) + " expected in", "−" + money(fc.outflow, "UGX", true) + " planned out")) + '</p>' +
        (fc.overdueIn > 0 ? '<p class="note">' + esc(money(fc.overdueIn, "UGX", true) + " overdue is not counted — it comes on top when it arrives.") + '</p>' : '') +
      '</div>' + rows +
      '<p class="fine">Built from your account balances, dated incoming payments (dollars at ' + esc(money(usdRateFor(doc), "UGX")) + '), planned expenses still to pay and loan repayments with fees on their due date.</p>';
    openSheet("Cash forecast", body, '<button type="button" class="x97-btn primary" data-x97-action="close-sheet">Done</button>', { wide: true });
  }

  // Record a payment: choose the deal first, most urgent at the top.
  function openPaymentPicker() {
    var doc = viewDoc();
    if (!doc) return;
    var open = sortByUrgency((doc.followups || []).filter(function (x) { return isOpenFollowup(x) && outstandingOf(x) > 0; }), doc);
    if (!open.length) { toast("No open deals — add one first", "error"); openUpcomingForm(); return; }
    if (open.length === 1) { openPaymentForm(open[0].id); return; }
    var body = '<div class="field"><label for="pick-search">Find a deal</label><input id="pick-search" class="x97-input" type="search" autocomplete="off" placeholder="Client or project"></div>' +
      '<div class="list card" id="pick-list">' + open.map(function (x) {
        var t = timing(x, doc), cur = String(x.currency || "UGX").toUpperCase();
        return '<button type="button" class="list-row" data-x97-action="mark-paid" data-id="' + attr(x.id) + '" data-search="' + attr(String(x.client || "").toLowerCase() + " " + String(x.category || "").toLowerCase()) + '"><span class="list-main"><b>' + esc(x.client || "Untitled") + '</b><span class="' + (t.cls ? "t-" + t.cls : "") + '">' + esc(t.label) + '</span></span><span class="list-value"><b class="x97-money">' + money(outstandingOf(x), cur) + '</b></span></button>';
      }).join("") + '</div>';
    openSheet("Record a payment", body, "", { afterOpen: function (back) {
      var input = back.querySelector("#pick-search");
      if (input) input.addEventListener("input", function () {
        var q = input.value.trim().toLowerCase();
        Array.prototype.forEach.call(back.querySelectorAll("#pick-list .list-row"), function (row) { row.hidden = !!q && row.getAttribute("data-search").indexOf(q) < 0; });
      });
    } });
  }

  function sortByUrgency(items, doc) {
    function rank(x) { var t = timing(x, doc); return t.key === "overdue" ? 0 : t.key === "today" ? 1 : t.key === "very-soon" ? 2 : t.key === "soon" ? 3 : t.key === "unscheduled" ? 5 : 4; }
    return items.slice().sort(function (a, b) {
      var r = rank(a) - rank(b);
      if (r) return r;
      var an = nextScheduledPayment(doc, a), bn = nextScheduledPayment(doc, b);
      return String(an && an.dueDate || "9999").localeCompare(String(bn && bn.dueDate || "9999"));
    });
  }

  // A budget as one bar: spent (solid) and still planned (lighter) against the budget.
  function budgetBarHTML(u, compact) {
    var spentPct = u.budget > 0 ? Math.min(100, u.actual / u.budget * 100) : 0;
    var planPct = u.budget > 0 ? Math.min(100 - spentPct, u.stillPlanned / u.budget * 100) : 0;
    var head = u.budget > 0
      ? '<b class="x97-money' + (u.safe < 0 ? " neg" : "") + '" data-count="safe-' + u.type + '">' + money(u.safe, "UGX", compact) + '</b><span>' + (u.safe < 0 ? "over budget" : "safe to spend") + '</span>'
      : '<b>No budget</b><span>' + esc(money(u.actual, "UGX", compact)) + ' spent</span>';
    return '<div class="budget' + (u.tone ? " is-" + u.tone : "") + '">' +
      '<div class="budget-head"><span class="budget-name">' + esc(u.type) + '</span><span class="budget-left">' + head + '</span></div>' +
      '<div class="bar" role="img" aria-label="' + attr(u.type + ": " + money(u.actual, "UGX") + " spent, " + money(u.stillPlanned, "UGX") + " still planned" + (u.budget > 0 ? ", of " + money(u.budget, "UGX") : "")) + '"><i class="bar-spent" style="width:' + spentPct.toFixed(1) + '%"></i><i class="bar-plan" style="width:' + planPct.toFixed(1) + '%"></i></div>' +
      '<div class="budget-foot"><span><i class="key-spent"></i>Spent <b class="x97-money">' + money(u.actual, "UGX", true) + '</b></span><span><i class="key-plan"></i>Planned <b class="x97-money">' + money(u.stillPlanned, "UGX", true) + '</b></span>' + (u.budget > 0 ? '<span>of <b class="x97-money">' + money(u.budget, "UGX", true) + '</b></span>' : '') + '</div>' +
    '</div>';
  }

  /* ══ EXPENSES ═════════════════════════════════════════════════════════════
     Budgets and entries for one month at a time. The month being viewed is
     screen state, not part of the document, so browsing never syncs anywhere. */

  function shiftMonth(key, delta) {
    var d = monthDate(key) || startOfMonth(todayDate());
    d = new Date(d.getFullYear(), d.getMonth() + delta, 1, 12);
    return monthKey(d);
  }

  function expenseRowHTML(x) {
    var actual = isActualExpense(x);
    return '<div class="exp-row">' +
      '<button type="button" class="exp-main" data-x97-action="edit-expense" data-id="' + attr(x.id) + '">' +
        '<span class="exp-text"><b>' + esc(x.item || "Untitled") + '</b><span>' +
          '<span class="tag ' + (expenseType(x) === "Business" ? "biz" : "own") + '">' + esc(expenseType(x)) + '</span>' +
          (actual ? '' : '<span class="tag plan">Planned</span>') +
          (x.note ? '<span class="exp-note">' + esc(x.note) + '</span>' : '') +
        '</span></span>' +
        '<span class="exp-amt x97-money' + (actual ? "" : " is-plan") + '">−' + esc(money(x.amount, "UGX")) + '</span>' +
      '</button>' +
      (actual ? '' : '<button type="button" class="exp-pay" data-x97-action="expense-paid" data-id="' + attr(x.id) + '" aria-label="' + attr("Mark " + (x.item || "this") + " as paid") + '" title="Mark as paid">' + icon("check", 16) + '</button>') +
    '</div>';
  }

  function renderExpenses(doc) {
    var ex = state.expenses;
    var key = ex.month || monthKey(todayDate());
    var current = monthKey(todayDate());
    var entries = ((doc.expenses && doc.expenses.entries) || []).filter(function (x) { return monthKey(x.date) === key; });
    var shown = entries.filter(function (x) {
      if (ex.filter === "personal") return expenseType(x) === "Personal";
      if (ex.filter === "business") return expenseType(x) === "Business";
      if (ex.filter === "planned") return !isActualExpense(x);
      if (ex.filter === "actual") return isActualExpense(x);
      return true;
    }).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")) || (isActualExpense(a) === isActualExpense(b) ? 0 : isActualExpense(a) ? 1 : -1); });
    var byDay = {};
    shown.forEach(function (x) { (byDay[x.date || ""] || (byDay[x.date || ""] = [])).push(x); });
    var days = Object.keys(byDay).sort().reverse();
    var list = days.map(function (day) {
      var rows = byDay[day];
      var total = rows.reduce(function (s, x) { return s + num(x.amount); }, 0);
      return '<div class="day"><div class="day-head"><span>' + esc(day ? relDayLabel(day) : "No date") + '</span><span class="x97-money">' + esc(money(total, "UGX", true)) + '</span></div>' + rows.map(expenseRowHTML).join("") + '</div>';
    }).join("");
    var others = ((doc.expenses && doc.expenses.entries) || []).length - entries.length;
    var budgets = ["Personal", "Business"].map(function (type) { return budgetUse(doc, type, key); });
    var spentAll = budgets[0].actual + budgets[1].actual, planAll = budgets[0].stillPlanned + budgets[1].stillPlanned;
    root.innerHTML = '<div class="page" data-page="expenses">' +
      pageHeader("", "Expenses", "What you plan to spend, and what you have spent.", '<button type="button" class="x97-btn primary" data-x97-action="add-expense">' + icon("plus", 16) + '<span>Log expense</span></button>') +
      '<div class="month-nav"><button type="button" class="icon-btn" data-x97-action="expense-month" data-value="-1" aria-label="Previous month">' + icon("chevron", 18) + '</button>' +
        '<div class="month-nav-label"><b>' + esc(monthLabel(key)) + '</b><span>' + esc(key === current ? "This month" : key < current ? "Past month" : "Upcoming month") + '</span></div>' +
        '<button type="button" class="icon-btn" data-x97-action="expense-month" data-value="1" aria-label="Next month">' + icon("chevron", 18) + '</button>' +
        (key !== current ? '<button type="button" class="link-btn" data-x97-action="expense-month" data-value="now">Today</button>' : '') + '</div>' +
      '<div class="budget-grid">' + budgets.map(function (u) { return '<section class="card budget-card">' + budgetBarHTML(u, false) + '</section>'; }).join("") + '</div>' +
      '<div class="exp-summary"><span>' + esc(joinMeta("Spent " + money(spentAll, "UGX", true), "still planned " + money(planAll, "UGX", true))) + '</span><button type="button" class="link-btn" data-x97-action="edit-budgets">Edit budgets</button></div>' +
      '<div class="chips" role="group" aria-label="Show">' +
        [["all", "All"], ["actual", "Spent"], ["planned", "Planned"], ["personal", "Personal"], ["business", "Business"]].map(function (f) {
          return '<button type="button" class="chip' + (ex.filter === f[0] ? " on" : "") + '" aria-pressed="' + (ex.filter === f[0] ? "true" : "false") + '" data-x97-action="expense-filter" data-value="' + f[0] + '">' + f[1] + '</button>';
        }).join("") + '</div>' +
      (list ? '<div class="card exp-list">' + list + '</div>' : emptyState("receipt", entries.length ? "Nothing matches this filter" : "Nothing logged for " + monthLabel(key), entries.length ? "" : "Log what you spend, or plan a bill ahead — it counts against the budget until it's paid.", '<button type="button" class="x97-btn primary" data-x97-action="add-expense">' + icon("plus", 16) + ' Log expense</button>')) +
      '<p class="fine">Safe to spend = budget − spent − still planned. Log a payment under the same name as a planned item and the plan is drawn down, not counted twice.' + (others > 0 ? ' ' + others + (others === 1 ? ' entry is' : ' entries are') + ' in other months.' : '') + '</p>' +
    '</div>';
  }

  // "Today", "Yesterday", "Mon 21 Sep".
  function relDayLabel(iso) {
    var d = daysBetween(todayDate(), parseLocalDate(iso));
    if (d === 0) return "Today";
    if (d === -1) return "Yesterday";
    if (d === 1) return "Tomorrow";
    var date = parseLocalDate(iso);
    return date ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : iso;
  }

  function openExpenseForm(id) {
    var doc = viewDoc();
    if (!doc) { toast("Still loading your data — try again in a moment", "error"); return; }
    var existing = id ? ((doc.expenses && doc.expenses.entries) || []).find(function (x) { return String(x.id) === String(id); }) : null;
    var x = existing ? clone(existing) : { id: "", date: todayISO(), type: state.expenses.filter === "business" ? "Business" : "Personal", kind: state.expenses.filter === "planned" ? "Planned" : "Actual", item: "", amount: "", note: "" };
    // Names already used, so a payment can be logged under its planned name.
    var names = {};
    ((doc.expenses && doc.expenses.entries) || []).forEach(function (e) { if (e.item) names[String(e.item).trim()] = true; });
    var kind = isActualExpense(x) ? "Actual" : "Planned", type = expenseType(x);
    var body = '<form id="x97-expense-form" data-x97-form="expense"><input type="hidden" name="id" value="' + attr(x.id) + '">' +
      '<div class="field amount-field"><label for="exp-amount">Amount (UGX)</label><input id="exp-amount" class="x97-input amount-input" name="amount" type="number" inputmode="numeric" min="1" step="1" required value="' + attr(x.amount) + '" placeholder="0"></div>' +
      '<div class="field"><label for="exp-item">What for</label><input id="exp-item" class="x97-input" name="item" required maxlength="120" list="exp-names" autocomplete="off" value="' + attr(x.item) + '" placeholder="e.g. Studio rent"><datalist id="exp-names">' + Object.keys(names).sort().map(function (n) { return '<option value="' + attr(n) + '"></option>'; }).join("") + '</datalist><p class="x97-help">Use a planned item\'s name to pay it off.</p></div>' +
      '<div class="fields-2">' +
        '<fieldset class="field"><legend>Kind</legend><div class="segmented small">' + radioSeg("kind", "Actual", "Spent", kind) + radioSeg("kind", "Planned", "Planned", kind) + '</div></fieldset>' +
        '<fieldset class="field"><legend>Budget</legend><div class="segmented small">' + radioSeg("type", "Personal", "Personal", type) + radioSeg("type", "Business", "Business", type) + '</div></fieldset>' +
      '</div>' +
      '<div class="field"><label for="exp-date">Date</label><input id="exp-date" class="x97-input" name="date" type="date" required value="' + attr(x.date || todayISO()) + '"></div>' +
      '<div class="field"><label for="exp-note">Note <span class="optional">optional</span></label><input id="exp-note" class="x97-input" name="note" maxlength="200" value="' + attr(x.note || "") + '" placeholder="e.g. paid by MoMo"></div>' +
      '</form>';
    var foot = (existing ? '<button type="button" class="x97-btn danger" data-x97-action="delete-expense" data-id="' + attr(x.id) + '">' + icon("trash", 16) + ' Delete</button>' : '<button type="button" class="x97-btn" data-x97-action="close-sheet">Cancel</button>') +
      '<button type="submit" class="x97-btn primary" form="x97-expense-form">' + icon("check", 16) + (existing ? ' Save' : ' Log expense') + '</button>';
    openSheet(existing ? "Edit expense" : "Log expense", body, foot);
  }

  function radioSeg(name, value, label, current) {
    var id = "seg-" + name + "-" + String(value).toLowerCase();
    return '<input type="radio" class="seg-input" id="' + attr(id) + '" name="' + attr(name) + '" value="' + attr(value) + '"' + (value === current ? " checked" : "") + '><label class="seg" for="' + attr(id) + '">' + esc(label) + '</label>';
  }

  function radioValue(form, name) {
    var hit = form.querySelector('input[name="' + name + '"]:checked');
    return hit ? hit.value : "";
  }

  function submitExpense(form) {
    var v = formValues(form);
    var amount = roundMoney(v.amount);
    if (amount <= 0) { toast("Enter an amount", "error"); return; }
    var entry = {
      id: v.id || uid("ex"), date: v.date || todayISO(), type: radioValue(form, "type") || "Personal", kind: radioValue(form, "kind") || "Actual",
      item: String(v.item || "").trim(), amount: amount, note: String(v.note || "").trim()
    };
    var ok = updateDoc(function (doc) {
      var list = doc.expenses.entries;
      var i = list.findIndex(function (x) { return String(x.id) === String(entry.id); });
      if (i >= 0) list[i] = Object.assign({}, list[i], entry); else list.push(entry);
    }, "expense-save", v.id ? "Saved" : entry.kind === "Planned" ? "Planned" : "Logged");
    if (!ok) return;
    closeSheet();
    // Show the month the entry landed in.
    if (monthKey(entry.date) !== state.expenses.month && currentScreen === "expenses") { state.expenses.month = monthKey(entry.date); scheduleRender(0); }
  }

  function deleteExpense(id) {
    var removed = null, index = -1;
    var ok = updateDoc(function (doc) {
      var list = doc.expenses.entries;
      index = list.findIndex(function (x) { return String(x.id) === String(id); });
      if (index >= 0) removed = list.splice(index, 1)[0];
    }, "expense-delete", true);
    if (!ok || !removed) return;
    closeSheet();
    undoable("Deleted " + (removed.item || "expense"), function (doc) {
      if (doc.expenses.entries.some(function (x) { return String(x.id) === String(removed.id); })) return;
      doc.expenses.entries.splice(Math.min(index, doc.expenses.entries.length), 0, removed);
    });
  }

  // A planned bill got paid: it becomes the actual expense, dated today unless
  // it was planned for a day that has already passed.
  function markExpensePaid(id) {
    var before = null;
    var ok = updateDoc(function (doc) {
      var x = doc.expenses.entries.find(function (e) { return String(e.id) === String(id); });
      if (!x) return;
      before = clone(x);
      x.kind = "Actual";
      if (!x.date || x.date > todayISO()) x.date = todayISO();
    }, "expense-paid", true);
    if (!ok || !before) return;
    closeSheet();
    undoable("Marked " + (before.item || "expense") + " as paid", function (doc) {
      var x = doc.expenses.entries.find(function (e) { return String(e.id) === String(id); });
      if (x) { x.kind = before.kind; x.date = before.date; }
    });
  }

  function openBudgetForm() {
    var doc = viewDoc();
    if (!doc) return;
    var e = doc.expenses || {};
    var body = '<form id="x97-budget-form" data-x97-form="budgets">' +
      '<p class="x97-help">A monthly limit for each budget. Planned and actual spending both count against it.</p>' +
      '<div class="field"><label for="bud-p">Personal, per month (UGX)</label><input id="bud-p" class="x97-input" name="personalBudget" type="number" inputmode="numeric" min="0" step="1" value="' + attr(num(e.personalBudget) || "") + '" placeholder="0"></div>' +
      '<div class="field"><label for="bud-b">Business, per month (UGX)</label><input id="bud-b" class="x97-input" name="businessBudget" type="number" inputmode="numeric" min="0" step="1" value="' + attr(num(e.businessBudget) || "") + '" placeholder="0"></div>' +
      '</form>';
    openSheet("Monthly budgets", body, '<button type="button" class="x97-btn" data-x97-action="close-sheet">Cancel</button><button type="submit" class="x97-btn primary" form="x97-budget-form">' + icon("check", 16) + ' Save budgets</button>');
  }

  function submitBudgets(form) {
    var v = formValues(form);
    if (updateDoc(function (doc) { doc.expenses.personalBudget = roundMoney(v.personalBudget); doc.expenses.businessBudget = roundMoney(v.businessBudget); }, "budgets", "Budgets saved")) closeSheet();
  }

  /* ══ SETTINGS ═════════════════════════════════════════════════════════════
     Grouped the way people look for things. Text fields save when you leave
     them (a redraw never interrupts typing); toggles and choices save at once. */

  function settingRow(iconName, title, sub, action, extra) {
    return '<button type="button" class="set-row" data-x97-action="' + attr(action) + '"' + (extra || "") + '>' + '<span class="set-icon">' + icon(iconName, 18) + '</span><span class="set-text"><b>' + esc(title) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' + icon("chevron", 16) + '</button>';
  }

  function tagEditorHTML(list, values, label, placeholder) {
    return '<div class="tag-editor" data-list="' + attr(list) + '"><ul class="tags" aria-label="' + attr(label) + '">' + values.map(function (v) {
      return '<li class="tag-chip"><span>' + esc(v) + '</span><button type="button" data-x97-action="tag-remove" data-list="' + attr(list) + '" data-value="' + attr(v) + '" aria-label="' + attr("Remove " + v) + '">' + icon("close", 14) + '</button></li>';
    }).join("") + '</ul><div class="tag-add"><input class="x97-input" data-tag-input="' + attr(list) + '" maxlength="40" placeholder="' + attr(placeholder) + '" aria-label="' + attr("Add to " + label) + '"><button type="button" class="x97-btn" data-x97-action="tag-add" data-list="' + attr(list) + '">Add</button></div></div>';
  }

  function restorePoint() {
    try { var r = JSON.parse(localStorage.getItem(BACKUP_KEY) || "null"); return r && r.raw ? r : null; } catch (_) { return null; }
  }

  // Keep the current document before anything replaces it wholesale.
  function saveRestorePoint(reason) {
    var raw = "";
    try { raw = localStorage.getItem(DATA_KEY) || ""; } catch (_) {}
    if (!raw) return true;
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), reason: reason, raw: raw })); return true; } catch (_) { return false; }
  }

  function renderSettings(doc) {
    var theme = loadTheme();
    var c = cloudState();
    var settings = doc.settings || {};
    var manual = !!settings.fxManual;
    var live = fxConvert(1, "USD", FX_HOME);
    var rp = restorePoint();
    var syncLine = !c ? "Sync is not running on this page" : c.user ? c.user + " · " + (c.status === "online" ? "all changes saved" : c.status === "saving" ? "saving…" : c.status === "offline" ? "offline — changes are kept on this device" : c.status === "error" ? "needs attention — retrying" : c.status) : "Not signed in";
    root.innerHTML = '<div class="page settings" data-page="settings">' +
      pageHeader("", "Settings", "Your business details, lists, and your data.", "") +
      '<div class="settings-grid">' +

      '<section class="card set-group"><h2 class="set-title">' + icon("palette", 18) + 'Appearance</h2>' +
        '<div class="field"><span class="label">Theme</span><div class="segmented" role="radiogroup" aria-label="Theme">' +
          [["light", "Light"], ["dark", "Dark"], ["system", "Match device"]].map(function (t) { return '<button type="button" role="radio" aria-checked="' + (theme === t[0] ? "true" : "false") + '" class="seg' + (theme === t[0] ? " on" : "") + '" data-x97-action="set-theme" data-value="' + t[0] + '">' + t[1] + '</button>'; }).join("") + '</div></div>' +
        '<label class="switch-row"><span><b>Hide amounts</b><span>Blur every figure, for working in public. Also in the header.</span></span><input type="checkbox" class="switch" data-x97-toggle="privacy"' + (privacyOn() ? " checked" : "") + '></label>' +
      '</section>' +

      '<section class="card set-group"><h2 class="set-title">' + icon("user", 18) + 'Business</h2>' +
        '<div class="field"><label for="set-business">Business name</label><input id="set-business" class="x97-input" data-setting="businessName" maxlength="80" value="' + attr(settings.businessName || "") + '" placeholder="' + attr(doc.meta.appName || "97 LIVE") + '"><p class="x97-help">Printed on invoices and receipts.</p></div>' +
        '<div class="field"><label for="set-cc">Phone country code</label><input id="set-cc" class="x97-input" data-setting="countryCode" inputmode="numeric" maxlength="4" value="' + attr(settings.countryCode || "") + '" placeholder="256"><p class="x97-help">Turns local numbers like 0772… into WhatsApp links.</p></div>' +
      '</section>' +

      '<section class="card set-group"><h2 class="set-title">' + icon("wallet", 18) + 'Money</h2>' +
        '<label class="switch-row"><span><b>Set the dollar rate myself</b><span>' + esc(manual ? "Your rate is used everywhere; daily updates are paused." : live != null ? "Updated daily — today 1 USD = " + money(live, "UGX") + "." : "Updated daily when online.") + '</span></span><input type="checkbox" class="switch" data-x97-toggle="fx-manual"' + (manual ? " checked" : "") + '></label>' +
        '<div class="field"><label for="set-rate">USD → UGX rate</label><input id="set-rate" class="x97-input" data-setting="usdRate" type="number" inputmode="decimal" min="0" step="any" value="' + attr(num(doc.meta.usdRate) || "") + '"' + (manual ? "" : " disabled") + '></div>' +
        '<div class="fields-2">' +
          '<div class="field"><label for="set-bp">Personal budget / month</label><input id="set-bp" class="x97-input" data-setting="personalBudget" type="number" inputmode="numeric" min="0" step="1" value="' + attr(num(doc.expenses.personalBudget) || "") + '" placeholder="0"></div>' +
          '<div class="field"><label for="set-bb">Business budget / month</label><input id="set-bb" class="x97-input" data-setting="businessBudget" type="number" inputmode="numeric" min="0" step="1" value="' + attr(num(doc.expenses.businessBudget) || "") + '" placeholder="0"></div>' +
        '</div>' +
      '</section>' +

      '<section class="card set-group"><h2 class="set-title">' + icon("tag", 18) + 'Lists</h2>' +
        '<div class="field"><span class="label">Deal categories</span>' + tagEditorHTML("categories", settings.categories || [], "Deal categories", "New category") + '</div>' +
        '<div class="field"><span class="label">Mobile networks</span>' + tagEditorHTML("networks", settings.networks || [], "Mobile networks", "New network") + '</div>' +
      '</section>' +

      '<section class="card set-group"><h2 class="set-title">' + icon("message", 18) + 'WhatsApp reminders</h2>' +
        '<div class="set-rows">' +
          settingRow("edit", "Message templates", "What reminders say, by tone", "open-templates") +
          settingRow("shield", "Sending safety", "Daily limit and who Auto mode may message", "open-safety") +
          settingRow("phone", "Client numbers", "Check and fix WhatsApp numbers", "open-numbers") +
          settingRow("user", "Google contacts", "Import contacts to match numbers", "open-google-setup") +
        '</div>' +
      '</section>' +

      '<section class="card set-group"><h2 class="set-title">' + icon("cloud", 18) + 'Sync</h2>' +
        '<p class="set-status" data-status="' + attr(c ? c.status : "none") + '"><span class="s97-cloud-dot ' + attr(c ? c.status : "") + '"></span>' + esc(syncLine) + '</p>' +
        '<div class="set-rows">' + settingRow("refresh", "Sync details", "Sync now, rename this device, sign out", "open-sync") + '</div>' +
      '</section>' +

      '<section class="card set-group"><h2 class="set-title">' + icon("database", 18) + 'Your data</h2>' +
        '<div class="set-rows">' +
          settingRow("download", "Download a backup", "Everything, as one file you can restore", "export-backup") +
          settingRow("list", "Export spreadsheets", "Receivables, payments and expenses as CSV", "open-exports") +
          settingRow("upload", "Restore from a backup", "Checks the file and shows what's in it first", "import-backup") +
          (rp ? settingRow("undo", "Undo the last replace", "Put back the data from before " + (rp.reason || "the last change") + " · " + formatDate(String(rp.savedAt).slice(0, 10), true), "use-restore-point") : "") +
        '</div>' +
        '<input type="file" id="set-import-file" accept="application/json,.json" hidden>' +
        '<button type="button" class="x97-btn danger block" data-x97-action="erase-data">' + icon("trash", 16) + ' Erase all data…</button>' +
      '</section>' +

      '</div>' +
      '<p class="about">97 LIVE ' + esc(VERSION) + ' · THE 97 WORLD</p>' +
    '</div>';
  }

  function downloadFile(filename, text, type) {
    var blob = new Blob([text], { type: type || "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function exportBackup(quiet) {
    var raw = "";
    try { raw = localStorage.getItem(DATA_KEY) || ""; } catch (_) {}
    if (!raw) { toast("Nothing to back up yet", "error"); return false; }
    var pretty = raw;
    try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch (_) {}
    downloadFile("97-finance-backup-" + todayISO() + ".json", pretty, "application/json");
    if (!quiet) toast("Backup downloaded", "success");
    return true;
  }

  // What a backup file holds, or why it can't be used.
  function inspectBackup(text) {
    var doc;
    try { doc = JSON.parse(text); } catch (_) { return { error: "That file isn't readable JSON." }; }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { error: "That file isn't a 97 LIVE backup." };
    if (!doc.meta || typeof doc.meta !== "object" || !Array.isArray(doc.followups) || !Array.isArray(doc.balances) || !Array.isArray(doc.credit)) {
      return { error: "That file isn't a 97 LIVE backup — it is missing deals, accounts or credit." };
    }
    return {
      doc: doc,
      counts: {
        deals: doc.followups.length,
        payments: Array.isArray(doc.payments) ? doc.payments.length : 0,
        accounts: doc.balances.length,
        facilities: doc.credit.length,
        loans: Array.isArray(doc.creditLoans) ? doc.creditLoans.length : 0,
        expenses: doc.expenses && Array.isArray(doc.expenses.entries) ? doc.expenses.entries.length : 0,
        contacts: Array.isArray(doc.waContacts) ? doc.waContacts.length : 0
      }
    };
  }

  function countsText(c) {
    return [[c.deals, "deal"], [c.payments, "payment"], [c.accounts, "account"], [c.expenses, "expense"], [c.facilities, "credit offer"], [c.loans, "loan"], [c.contacts, "contact"]]
      .filter(function (x) { return x[0]; }).map(function (x) { return x[0] + " " + x[1] + (x[0] === 1 ? "" : "s"); }).join(", ") || "no records";
  }

  function importBackupFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var info = inspectBackup(String(reader.result || ""));
      if (info.error) { toast(info.error, "error"); return; }
      var current = readDoc();
      var now = current ? inspectBackup(JSON.stringify(current)).counts : null;
      var body = '<p>This file has <b>' + esc(countsText(info.counts)) + '</b>.</p>' +
        (now ? '<p>It replaces what is here now (' + esc(countsText(now)) + ') on this device and in the cloud.</p>' : '') +
        '<p class="x97-help">The current data is kept as a restore point — Settings → Undo the last replace puts it back.</p>';
      openSheet("Restore this backup?", body, '<button type="button" class="x97-btn" data-x97-action="close-sheet">Cancel</button><button type="button" class="x97-btn primary" id="confirm-import">Replace my data</button>', { afterOpen: function (back) {
        back.querySelector("#confirm-import").addEventListener("click", function () {
          if (!saveRestorePoint("the restore") && !confirm("There isn't room to keep a restore point on this device. Replace anyway?")) return;
          if (writeDoc(info.doc, "import", "Backup restored")) { persistCreditMigration(); closeSheet(); }
        });
      } });
    };
    reader.onerror = function () { toast("Couldn't read that file", "error"); };
    reader.readAsText(file);
  }

  function useRestorePoint() {
    var rp = restorePoint();
    if (!rp) return;
    var info = inspectBackup(rp.raw);
    if (info.error) { toast("The restore point can't be read", "error"); return; }
    if (!confirm("Put back the data from before " + (rp.reason || "the last change") + " (" + countsText(info.counts) + ")? What is here now becomes the new restore point.")) return;
    var now = "";
    try { now = localStorage.getItem(DATA_KEY) || ""; } catch (_) {}
    if (writeDoc(info.doc, "restore-point", "Data put back")) {
      try { if (now) localStorage.setItem(BACKUP_KEY, JSON.stringify({ savedAt: new Date().toISOString(), reason: "undoing a replace", raw: now })); } catch (_) {}
      scheduleRender(0);
    }
  }

  // Wiping everything is typed, not tapped, and always leaves a way back.
  function openEraseSheet() {
    var body = '<p>This deletes every deal, payment, account, expense and credit record — on this device and on every device signed in to this account.</p>' +
      '<p class="x97-help">A backup file downloads first, and the data is also kept here as a restore point.</p>' +
      '<div class="field"><label for="erase-confirm">Type ERASE to confirm</label><input id="erase-confirm" class="x97-input" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>';
    openSheet("Erase all data?", body, '<button type="button" class="x97-btn" data-x97-action="close-sheet">Keep my data</button><button type="button" class="x97-btn danger" id="erase-go" disabled>' + icon("trash", 16) + ' Erase everything</button>', { afterOpen: function (back) {
      var input = back.querySelector("#erase-confirm"), go = back.querySelector("#erase-go");
      input.addEventListener("input", function () { go.disabled = input.value.trim().toUpperCase() !== "ERASE"; });
      go.addEventListener("click", function () {
        if (input.value.trim().toUpperCase() !== "ERASE") return;
        exportBackup(true);
        saveRestorePoint("erasing everything");
        var fresh = emptyDoc();
        var old = readDoc();
        // Keep how the app is set up; lose the records.
        if (old) { fresh.settings = old.settings || fresh.settings; fresh.meta = { appName: old.meta.appName || "97 LIVE", usdRate: num(old.meta.usdRate) }; }
        if (writeDoc(fresh, "erase", "Everything erased — a backup was downloaded")) closeSheet();
      });
    } });
  }

  function saveSetting(input) {
    var key = input.getAttribute("data-setting"), value = input.value;
    updateDoc(function (doc) {
      if (key === "businessName") doc.settings.businessName = String(value).trim();
      else if (key === "countryCode") doc.settings.countryCode = String(value).replace(/\D/g, "").slice(0, 4);
      else if (key === "usdRate") doc.meta.usdRate = num(value);
      else if (key === "personalBudget") doc.expenses.personalBudget = roundMoney(value);
      else if (key === "businessBudget") doc.expenses.businessBudget = roundMoney(value);
    }, "setting-" + key);
  }

  function addTag(list) {
    var input = document.querySelector('[data-tag-input="' + list + '"]');
    var value = input ? String(input.value).trim() : "";
    if (!value) { if (input) input.focus(); return; }
    var dup = false;
    updateDoc(function (doc) {
      var arr = Array.isArray(doc.settings[list]) ? doc.settings[list] : (doc.settings[list] = []);
      if (arr.some(function (x) { return String(x).toLowerCase() === value.toLowerCase(); })) { dup = true; return; }
      arr.push(value);
    }, "tag-add", true);
    if (dup) toast(value + " is already there", "error");
    else {
      scheduleRender(0);
      setTimeout(function () { var next = document.querySelector('[data-tag-input="' + list + '"]'); if (next) next.focus(); }, 60);
    }
  }

  function removeTag(list, value) {
    var index = -1;
    updateDoc(function (doc) {
      var arr = doc.settings[list] || [];
      index = arr.indexOf(value);
      if (index >= 0) arr.splice(index, 1);
    }, "tag-remove", true);
    if (index >= 0) undoable("Removed " + value, function (doc) {
      var arr = Array.isArray(doc.settings[list]) ? doc.settings[list] : (doc.settings[list] = []);
      if (arr.indexOf(value) < 0) arr.splice(Math.min(index, arr.length), 0, value);
    });
  }

  function nextLoanDue(loans) {
    if (!loans.length) return "None";
    var sorted = loans.slice().sort(function (a,b) { return String(dueDateForLoan(a)).localeCompare(String(dueDateForLoan(b))); });
    return formatDate(dueDateForLoan(sorted[0]), true);
  }

  function activeFilterCount() {
    var f = state.upcoming, count = 0;
    if (f.month !== "all") count++;
    if (f.statuses.length) count++;
    if (f.currencies.length) count++;
    if (f.categories.length) count++;
    if (f.retainers !== "all") count++;
    if (f.from || f.to) count++;
    if (f.minAmount || f.maxAmount) count++;
    if (f.sort !== "urgency") count++;
    return count;
  }

  // Apply period filters to individual scheduled payments. A six-month deal
  // belongs to six months, even while its first instalment is still unpaid.
  function incomingPeriodMatches(row, f) {
    var due = row.dueDate || "";
    if (f.month === "unscheduled" && due) return false;
    if (f.month !== "all" && f.month !== "unscheduled" && monthKey(due) !== f.month) return false;
    if (f.from && (!due || due < f.from)) return false;
    if (f.to && (!due || due > f.to)) return false;
    return true;
  }

  function followupMatches(item, doc, filters) {
    var f = filters || state.upcoming;
    var q = String(f.search || "").trim().toLowerCase();
    var schedule = projectSchedule(doc, item);
    var scheduleText = schedule.map(function (row) { return [row.label, row.dueDate].join(" "); }).join(" ");
    if (q && [item.client, item.category, item.note, item.currency, item.status, scheduleText].join(" ").toLowerCase().indexOf(q) < 0) return false;
    var t = timing(item, doc), next = t.next, expectedBy = next ? next.dueDate : item.expectedBy;
    if (!schedule.some(function (row) { return incomingPeriodMatches(row, f); })) return false;
    if (f.statuses.length && f.statuses.indexOf(normalizeStatus(item.status)) < 0) return false;
    if (f.currencies.length && f.currencies.indexOf(String(item.currency || "UGX").toUpperCase()) < 0) return false;
    if (f.categories.length && !f.categories.some(function (category) {
      return isRetainerCategory(category) ? isRetainer(item) : String(category).trim().toLowerCase() === String(item.category || "").trim().toLowerCase();
    })) return false;
    if (f.retainers === "only" && !isRetainer(item)) return false;
    if (f.retainers === "exclude" && isRetainer(item)) return false;
    if (f.minAmount !== "" && outstandingOf(item) < num(f.minAmount)) return false;
    if (f.maxAmount !== "" && outstandingOf(item) > num(f.maxAmount)) return false;
    var today = todayDate(), nowMonth = monthKey(today), nextMonthDate = new Date(startOfMonth(today)); nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    if (f.quick === "open" && !isOpenFollowup(item)) return false;
    if (f.quick === "attention" && !(isOpenFollowup(item) && (t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7) || !next || !next.dueDate || outstandingOf(item) <= 0))) return false;
    if (f.quick === "overdue" && t.key !== "overdue") return false;
    if (f.quick === "today" && t.key !== "today") return false;
    if (f.quick === "next7" && !(isOpenFollowup(item) && t.days != null && t.days >= 0 && t.days <= 7)) return false;
    if (f.quick === "next30" && !(isOpenFollowup(item) && t.days != null && t.days >= 0 && t.days <= 30)) return false;
    if (f.quick === "thisMonth" && !schedule.some(function (row) { return monthKey(row.dueDate) === nowMonth && incomingPeriodMatches(row, f); })) return false;
    if (f.quick === "nextMonth" && !schedule.some(function (row) { return monthKey(row.dueDate) === monthKey(nextMonthDate) && incomingPeriodMatches(row, f); })) return false;
    if (f.quick === "unscheduled" && expectedBy) return false;
    if (f.quick === "paid" && !isPaid(item.status)) return false;
    return true;
  }

  function sortFollowups(items, doc) {
    var mode = state.upcoming.sort;
    if (mode === "custom") {
      var order = state.upcoming.gridRowOrder || [];
      var rank = {};
      order.forEach(function (id, i) { rank[String(id)] = i; });
      return items.sort(function (a, b) {
        var ra = rank[String(a.id)], rb = rank[String(b.id)];
        if (ra == null && rb == null) return 0;
        if (ra == null) return 1;
        if (rb == null) return -1;
        return ra - rb;
      });
    }
    return items.sort(function (a, b) {
      var at = timing(a, doc), bt = timing(b, doc), ad = at.next ? at.next.dueDate : a.expectedBy, bd = bt.next ? bt.next.dueDate : b.expectedBy;
      if (mode === "dateAsc") return String(ad || "9999-12-31").localeCompare(String(bd || "9999-12-31"));
      if (mode === "dateDesc") return String(bd || "0000-00-00").localeCompare(String(ad || "0000-00-00"));
      if (mode === "amountDesc") return outstandingOf(b) - outstandingOf(a);
      if (mode === "amountAsc") return outstandingOf(a) - outstandingOf(b);
      if (mode === "client") return String(a.client || "").localeCompare(String(b.client || ""));
      function rank(x) { var t = timing(x, doc); if (t.key === "overdue") return 0; if (t.key === "today") return 1; if (t.days != null && t.days <= 7) return 2; if (!t.next || !t.next.dueDate) return 3; if (isPaid(x.status)) return 5; if (isCancelled(x.status)) return 6; return 4; }
      var r = rank(a) - rank(b);
      return r || String(ad || "9999-12-31").localeCompare(String(bd || "9999-12-31"));
    });
  }

  function filterTagHTML() {
    var f = state.upcoming, tags = [];
    if (f.month !== "all") tags.push({ label: monthLabel(f.month, true), key: "month" });
    // The chip says what the sort does, not what the code calls it.
    if (f.statuses.length) tags.push({ label: f.statuses.join(", "), key: "statuses" });
    if (f.currencies.length) tags.push({ label: f.currencies.join(" + "), key: "currencies" });
    if (f.retainers !== "all") tags.push({ label: f.retainers === "only" ? "Retainers only" : "Retainers excluded", key: "retainers" });
    if (f.categories.length) tags.push({ label: f.categories.length + " categories", key: "categories" });
    if (f.from || f.to) tags.push({ label: (f.from ? formatDate(f.from, true) : "Any") + " – " + (f.to ? formatDate(f.to, true) : "Any"), key: "dates" });
    if (f.minAmount || f.maxAmount) tags.push({ label: "Amount " + (f.minAmount || "0") + "–" + (f.maxAmount || "∞"), key: "amount" });
    if (f.sort !== "urgency") tags.push({ label: "Sorted: " + sortLabel(f.sort), key: "sort" });
    if (!tags.length) return "";
    return '<div class="x97-active-filters">' + tags.map(function (t) { return '<button class="x97-filter-tag" data-x97-action="clear-filter" data-filter="' + attr(t.key) + '">' + esc(t.label) + ' ' + icon("close", 11) + '</button>'; }).join("") + '<button class="x97-filter-tag" data-x97-action="clear-all-filters" style="color:var(--neg)">Clear all</button></div>';
  }

  function collectionStats(doc) {
    var open = (doc.followups || []).filter(isOpenFollowup);
    var events = scheduledEvents(doc, false);
    var overdue = events.filter(function (event) {
      var days = daysBetween(todayDate(), parseLocalDate(event.date));
      return days != null && days < 0;
    });
    var due7 = events.filter(function (event) {
      var days = daysBetween(todayDate(), parseLocalDate(event.date));
      return days != null && days >= 0 && days <= 7;
    });
    var unscheduled = open.filter(function (item) {
      var next = nextScheduledPayment(doc, item);
      return !next || !next.dueDate;
    });
    function outstanding(currency) {
      return open.filter(function (item) {
        return String(item.currency || "UGX").toUpperCase() === currency;
      }).reduce(function (sum, item) { return sum + outstandingOf(item); }, 0);
    }
    function eventAmount(list, currency) {
      return list.filter(function (event) {
        return String(event.currency || "UGX").toUpperCase() === currency;
      }).reduce(function (sum, event) { return sum + num(event.amount); }, 0);
    }
    return {
      open: open,
      events: events,
      overdue: overdue,
      due7: due7,
      unscheduled: unscheduled,
      outstandingUGX: outstanding("UGX"),
      outstandingUSD: outstanding("USD"),
      overdueUGX: eventAmount(overdue, "UGX"),
      overdueUSD: eventAmount(overdue, "USD"),
      due7UGX: eventAmount(due7, "UGX"),
      due7USD: eventAmount(due7, "USD")
    };
  }

  /* ══════════════════════════════════════════════════════════════════════
     INCOMING — a dense, scannable ledger.
     Every deal is one row, as many rows on screen as will fit — the thing a
     spreadsheet is loved for. Nothing is edited in the row itself: a tap
     opens the same guided deal sheet that has always driven Add/Edit, so
     there is no cell to select, no drag range, no fill handle, and nothing
     for a thumb to get wrong. Desktop shows every column at once; a phone
     collapses to two lines per row and never scrolls sideways.
     ══════════════════════════════════════════════════════════════════════ */

  function sortLabel(mode) {
    return { urgency: "Most urgent", client: "Client A–Z", amountDesc: "Largest first", amountAsc: "Smallest first", dateAsc: "Earliest due", dateDesc: "Latest due" }[mode] || mode;
  }

  // One flag, held on the module rather than in `state`, so a bulk selection
  // never survives a reload — it is a mode you enter and leave, not a
  // preference. Collapsed instalment parents persist (state.upcoming), since
  // that is a layout choice worth remembering.
  var icBulk = { on: false, rows: {} };
  function icClearBulk() { icBulk.on = false; icBulk.rows = {}; }
  function icBulkCount() { return Object.keys(icBulk.rows).length; }

  function icCollapsed(id) { return (state.upcoming.collapsed || []).indexOf(String(id)) >= 0; }
  function icToggleCollapse(id) {
    var list = state.upcoming.collapsed || (state.upcoming.collapsed = []);
    var i = list.indexOf(String(id));
    if (i >= 0) list.splice(i, 1); else list.push(String(id));
    savePrefs(); scheduleRender(0);
  }
  function icCollapseAll(collapse) {
    var doc = readDoc(), ids = (doc.followups || []).filter(function (x) { return isDeal(x); }).map(function (x) { return String(x.id); });
    state.upcoming.collapsed = collapse ? ids : [];
    savePrefs(); scheduleRender(0);
  }

  // Buckets exactly the way the summary tiles count: one deal, one bucket,
  // by the timing of whichever payment on it is next due.
  function icGroupFollowups(list, doc) {
    var groups = { overdue: [], today: [], soon: [], unscheduled: [], later: [], paid: [], cancelled: [] };
    list.forEach(function (item) {
      var t = timing(item, doc);
      if (t.key === "cancelled") groups.cancelled.push(item);
      else if (t.key === "paid") groups.paid.push(item);
      else if (t.key === "unscheduled") groups.unscheduled.push(item);
      else if (t.key === "overdue") groups.overdue.push(item);
      else if (t.key === "today") groups.today.push(item);
      else if (t.key === "very-soon" || t.key === "soon") groups.soon.push(item);
      else groups.later.push(item);
    });
    return groups;
  }

  function icQuickChip(value, label, count, danger) {
    var on = state.upcoming.quick === value;
    return '<button class="ic-quick' + (on ? " on" : "") + (danger ? " danger" : "") + '" data-x97-action="quick-filter" data-value="' + attr(value) + '">' + esc(label) + (count != null ? ' <b>' + count + '</b>' : '') + '</button>';
  }

  function icRetainerChip(doc) {
    var count = (doc.followups || []).filter(isRetainer).length;
    var on = state.upcoming.retainers === "only";
    return '<button class="ic-quick retainer' + (on ? " on" : "") + '" aria-pressed="' + on + '" data-x97-action="filter-retainer">Retainers <b>' + count + '</b></button>';
  }

  // Count distinct deals per month; a parent is counted only once even when
  // it has several scheduled payments in the same month.
  function icMonthChipsHTML(doc) {
    var counts = {}, total = 0;
    var filters = Object.assign({}, state.upcoming, { month: "all" });
    (doc.followups || []).forEach(function (item) {
      if (!followupMatches(item, doc, filters)) return;
      var seen = {};
      projectSchedule(doc, item).forEach(function (row) {
        var key = monthKey(row.dueDate);
        if (key && incomingPeriodMatches(row, filters)) seen[key] = true;
      });
      Object.keys(seen).forEach(function (key) { counts[key] = (counts[key] || 0) + 1; });
      total++;
    });
    var current = state.upcoming.month;
    if (current !== "all" && current !== "unscheduled" && !counts[current]) counts[current] = 0;
    var months = Object.keys(counts).sort();
    if (!months.length) return "";
    var chips = '<button type="button" class="ic-month-chip' + (current === "all" ? " on" : "") + '" data-x97-action="month-filter" data-month="all">All months<b>' + total + '</b></button>' +
      months.map(function (key) {
        return '<button type="button" class="ic-month-chip' + (current === key ? " on" : "") + '" data-x97-action="month-filter" data-month="' + attr(key) + '">' + esc(monthLabel(key, true)) + '<b>' + counts[key] + '</b></button>';
      }).join("");
    return '<div class="ic-month-row" role="group" aria-label="Filter by month">' + chips + '</div>';
  }

  function icOutstandingForMonth(doc, key) {
    var totals = { ugx: 0, usd: 0 };
    var filters = Object.assign({}, state.upcoming, { month: key });
    (doc.followups || []).forEach(function (item) {
      if (!isOpenFollowup(item) || !followupMatches(item, doc, filters)) return;
      var currency = String(item.currency || "UGX").toLowerCase();
      if (!(currency in totals)) return;
      projectSchedule(doc, item).forEach(function (row) {
        if (incomingPeriodMatches(row, filters)) totals[currency] += Math.max(0, num(row.amount) - num(row.paid));
      });
    });
    return totals;
  }

  function icHeroHTML(doc, stats) {
    var headline = stats.overdue.length
      ? stats.overdue.length + " payment" + (stats.overdue.length === 1 ? "" : "s") + " overdue"
      : stats.due7.length
        ? stats.due7.length + " due in the next 7 days"
        : stats.unscheduled.length
          ? stats.unscheduled.length + " open deal" + (stats.unscheduled.length === 1 ? "" : "s") + " need" + (stats.unscheduled.length === 1 ? "s" : "") + " a date"
          : "Nothing needs chasing right now";
    var selectedMonth = state.upcoming.month;
    var scoped = icOutstandingForMonth(doc, selectedMonth);
    var outUGX = scoped.ugx, outUSD = scoped.usd;
    var heroLabel = "Outstanding" + (state.upcoming.retainers === "only" ? " · Retainers" : state.upcoming.retainers === "exclude" ? " · Excluding retainers" : "") + (selectedMonth !== "all" ? " · " + monthLabel(selectedMonth, true) : "");
    return '<section class="ic-hero">' +
      '<div class="ic-hero-top"><div><div class="ic-hero-label">' + esc(heroLabel) + '</div><div class="ic-hero-value tabnum"><span class="ic-hero-value-main" data-count="ic-ugx">' + money(outUGX, "UGX", true) + '</span>' + (outUSD ? ' <span class="ic-hero-usd" data-count="ic-usd">+ ' + money(outUSD, "USD", true) + '</span>' : '') + '</div></div><div class="ic-hero-headline">' + esc(headline) + '</div></div>' +
      '</section><div class="ic-filter-deck"><div class="ic-hero-chips" role="group" aria-label="Filter incoming deals">' +
        icQuickChip("overdue", "Overdue", stats.overdue.length, true) +
        icQuickChip("next7", "Next 7 days", stats.due7.length) +
        icQuickChip("unscheduled", "No date", stats.unscheduled.length) +
        icRetainerChip(doc) +
        icQuickChip("paid", "Paid") +
        icQuickChip("all", "Everything") +
      '</div>' +
      icMonthChipsHTML(doc) +
    '</div>';
  }

  function icToolbarHTML() {
    var f = state.upcoming, count = activeFilterCount();
    return '<div class="ic-toolbar">' +
      '<div class="ic-search">' + icon("search", 16) + '<input id="ic-search" data-live type="search" aria-label="Search incoming deals" enterkeyhint="search" autocomplete="off" placeholder="Search clients, notes, dates…" value="' + attr(f.search) + '"></div>' +
      '<button type="button" class="ic-tbtn" data-x97-action="open-incoming-filters" aria-label="Filter and sort' + (count ? ' (' + count + ' active)' : '') + '" title="Filter and sort">' + icon("filter", 17) + (count ? '<b class="ic-tbadge">' + count + '</b>' : '') + '</button>' +
      '<button type="button" class="ic-tbtn' + (icBulk.on ? " on" : "") + '" data-x97-action="incoming-bulk-toggle" aria-pressed="' + (icBulk.on ? "true" : "false") + '" aria-label="Select several deals" title="Select several deals">' + icon("rows", 17) + '</button>' +
      '<button type="button" class="ic-tbtn" data-x97-action="open-incoming-more" aria-label="More options" title="More options">' + icon("dots", 17) + '</button>' +
    '</div>';
  }

  function icBulkBarHTML() {
    var n = icBulkCount();
    return '<div class="ic-toolbar ic-bulkbar">' +
      '<span class="ic-bulkbar-count">' + n + ' selected</span>' +
      '<button class="x97-btn" data-x97-action="incoming-bulk-cancel">Cancel</button>' +
      '<button class="x97-btn danger" data-x97-action="incoming-bulk-delete"' + (n ? "" : " disabled") + '>' + icon("trash", 14) + ' Delete</button>' +
    '</div>';
  }

  // The header row desktop shows above the list — mobile drops it, since a
  // two-line stacked row already labels itself.
  function icHeadHTML() {
    return '<div class="ic-row ic-row-head" aria-hidden="true">' +
      '<span class="ic-c-edge" aria-hidden="true"></span>' +
      '<span class="ic-c-client">Client</span>' +
      '<span class="ic-c-structure">Structure</span>' +
      '<span class="ic-c-total ic-num">Total</span>' +
      '<span class="ic-c-paid ic-num">Paid</span>' +
      '<span class="ic-c-balance ic-num">Balance</span>' +
      '<span class="ic-c-cur">Cur</span>' +
      '<span class="ic-c-status">Status</span>' +
      '<span class="ic-c-due">Due</span>' +
    '</div>';
  }

  function icPartRowHTML(parent, part, index, count, doc) {
    var due = part.dueDate || "";
    var paid = num(part.paid), amount = num(part.amount), left = Math.max(0, amount - paid);
    var settled = left <= 0 && amount > 0;
    var cur = String(parent.currency || "UGX").toUpperCase();
    var cls = settled ? "good" : due && parseLocalDate(due) < todayDate() ? "bad" : due && monthKey(due) === monthKey(todayDate()) ? "warn" : "";
    var statusText = settled ? "Paid" : paid > 0 ? "Part paid" : "Pending";
    return '<div class="ic-row ic-row-part is-' + cls + '" role="listitem" tabindex="0" data-part-index="' + index + '" data-cur="' + attr(cur) + '" data-x97-action="edit-upcoming" data-id="' + attr(parent.id) + '">' +
      '<span class="ic-c-edge"></span>' +
      '<span class="ic-c-client"><span class="ic-part-label">' + esc(part.label || ("Payment " + (index + 1))) + '</span><small>' + esc(index + 1) + ' of ' + count + '</small></span>' +
      '<span class="ic-c-structure ic-muted">—</span>' +
      '<span class="ic-c-total ic-num tabnum">' + esc(money(amount, cur)) + '</span>' +
      '<span class="ic-c-paid ic-num tabnum ' + (paid > 0 ? "ic-pos" : "") + '">' + esc(paid > 0 ? money(paid, cur) : "—") + '</span>' +
      '<span class="ic-c-balance ic-num tabnum">' + esc(left > 0 ? money(left, cur) : "—") + '</span>' +
      '<span class="ic-c-cur"><span class="ic-badge ic-cur-' + cur.toLowerCase() + '">' + cur + '</span></span>' +
      '<span class="ic-c-status"><span class="ic-badge ic-badge-' + cls + '">' + esc(statusText) + '</span></span>' +
      '<span class="ic-c-due">' + esc(due ? formatDate(due, true) : "No date") + '</span>' +
    '</div>';
  }

  function icRowHTML(item, doc) {
    var t = timing(item, doc), cur = String(item.currency || "UGX").toUpperCase();
    var gross = grossOf(item), paid = paidOf(item), left = outstandingOf(item);
    var open = isOpenFollowup(item);
    var deal = isDeal(item), parts = deal ? (item.parts || []) : [];
    var collapsed = deal && icCollapsed(item.id);
    var structure = deal ? (DEAL_TYPES[normalizeDealType(item.dealType)] || "Per part") : "One payment";
    var next = t.next;
    var dueText = t.key === "cancelled" ? "—" : t.key === "paid" ? (item.paidOn ? formatDate(item.paidOn, true) : "Settled") : t.key === "unscheduled" ? "No date" : (next && next.dueDate ? formatDate(next.dueDate, true) : "No date");
    var subLine = t.key === "cancelled" ? "Cancelled" : t.key === "paid" ? "Fully received" : deal ? dealPaidPartCount(item) + " of " + parts.length + " " + dealLabel(item) + " paid" : t.label;
    var bulked = icBulk.on && !!icBulk.rows[item.id];
    var leading = icBulk.on
      ? '<button type="button" class="ic-check' + (bulked ? " on" : "") + '" data-x97-action="incoming-bulk-row" data-id="' + attr(item.id) + '" aria-label="Select">' + (bulked ? icon("check", 13) : "") + '</button>'
      : (deal ? '<button type="button" class="ic-collapse-btn" data-x97-action="incoming-collapse" data-id="' + attr(item.id) + '" aria-expanded="' + (collapsed ? "false" : "true") + '" title="' + (collapsed ? "Show" : "Hide") + ' the schedule">' + icon("chevron", 13) + '</button>' : '<span class="ic-c-edge"></span>');
    var quick = open
      ? '<button type="button" class="ic-quickact" data-x97-action="mark-paid" data-id="' + attr(item.id) + '" title="Record a payment">' + icon("wallet", 15) + '</button>' +
        (hasWa(item, doc) ? '<button type="button" class="ic-quickact" data-x97-action="chase-one" data-id="' + attr(item.id) + '" title="WhatsApp">' + icon("message", 15) + '</button>' : '')
      : '';
    var rowAction = icBulk.on ? "incoming-bulk-row" : "edit-upcoming";
    return '<div class="ic-row is-' + esc(t.key) + (bulked ? " is-bulked" : "") + '" role="listitem" tabindex="0" data-cur="' + attr(cur) + '" data-x97-action="' + rowAction + '" data-id="' + attr(item.id) + '">' +
      leading +
      '<span class="ic-c-client"><b>' + esc(item.client || "Untitled") + '</b><small>' + esc(item.category || "Incoming") + '</small></span>' +
      '<span class="ic-c-structure">' + esc(structure) + '</span>' +
      '<span class="ic-c-total ic-num tabnum">' + esc(money(gross, cur)) + '</span>' +
      '<span class="ic-c-paid ic-num tabnum ' + (paid > 0 ? "ic-pos" : "") + '">' + esc(paid > 0 ? money(paid, cur) : "—") + '</span>' +
      '<span class="ic-c-balance ic-num tabnum ' + (left <= 0 ? "ic-pos" : "") + '">' + esc(left > 0 ? money(left, cur) : "Settled") + '</span>' +
      '<span class="ic-c-cur"><span class="ic-badge ic-cur-' + cur.toLowerCase() + '">' + cur + '</span></span>' +
      '<span class="ic-c-status"><span class="ic-badge ic-badge-' + esc(t.cls || "neutral") + '">' + esc(t.key === "cancelled" ? "Cancelled" : t.key === "paid" ? "Paid" : t.key === "overdue" ? "Overdue" : paid > 0 ? "Part paid" : "Pending") + '</span></span>' +
      '<span class="ic-c-due"><b>' + esc(dueText) + '</b><small>' + esc(subLine) + '</small></span>' +
      (quick ? '<span class="ic-quickacts">' + quick + '</span>' : '') +
    '</div>' +
    (deal && !collapsed ? parts.map(function (p, i) { return incomingPeriodMatches(p, state.upcoming) ? icPartRowHTML(item, p, i, parts.length, doc) : ""; }).join("") : "");
  }

  function icGroupHTML(label, items, doc) {
    if (!items.length) return "";
    return '<div class="ic-group"><b>' + esc(label) + '</b><span>' + items.length + '</span></div>' + items.map(function (item) { return icRowHTML(item, doc); }).join("");
  }

  function renderUpcoming(doc) {
    if (!Array.isArray(state.upcoming.collapsed)) state.upcoming.collapsed = [];
    if (icBulk.on) { var live = {}; (doc.followups || []).forEach(function (x) { if (icBulk.rows[x.id]) live[x.id] = true; }); icBulk.rows = live; }
    var all = doc.followups || [];
    var filtered = sortFollowups(all.filter(function (item) { return followupMatches(item, doc); }), doc);
    var stats = collectionStats(doc);
    var groups = icGroupFollowups(filtered, doc);
    var body = state.upcoming.sort === "urgency"
      ? [icGroupHTML("Overdue", groups.overdue, doc), icGroupHTML("Due today", groups.today, doc), icGroupHTML("Due soon", groups.soon, doc),
         icGroupHTML("No date", groups.unscheduled, doc), icGroupHTML("Later", groups.later, doc), icGroupHTML("Paid", groups.paid, doc), icGroupHTML("Cancelled", groups.cancelled, doc)].join("")
      : filtered.map(function (item) { return icRowHTML(item, doc); }).join("");
    var empty = filtered.length ? "" : '<div class="ic-empty">' + icon("search", 26) + '<strong>No deals in this view</strong><p>Clear filters or add one to get started.</p><button class="x97-btn primary" style="margin-top:12px" data-x97-action="add-upcoming">' + icon("plus") + ' Add incoming deal</button></div>';
    var entering = screenEntering; screenEntering = false;

    // Keep the shell, search input and scroll containers mounted. Replacing
    // root.innerHTML on every keystroke dismisses mobile keyboards and resets
    // scroll momentum. Only replace regions whose actual content changed.
    var shell = document.getElementById("ic-shell");
    if (!shell || entering) {
      root.innerHTML = '<div class="ic-shell" id="ic-shell">' +
        pageHeader("", "Incoming", "Money owed to you, by when it is due.", '<button type="button" class="x97-btn primary" data-x97-action="add-upcoming">' + icon("plus", 16) + '<span>Add deal</span></button>') +
        '<div id="ic-summary"></div><div id="ic-controls"></div><div class="ic-filterchips" id="ic-active-filters"></div>' +
        '<div class="ic-gridwrap"><div class="ic-listwrap" id="ic-listwrap"></div></div>' +
        '<div class="ic-statusbar" id="ic-statusbar" role="status" aria-live="polite"></div>' +
      '</div>';
      shell = document.getElementById("ic-shell");
    }
    var pageY = window.scrollY;
    var sheetOpen = document.body.classList.contains("sheet-open");
    var anchor = !entering && !sheetOpen && Array.from(shell.querySelectorAll('.ic-list > .ic-row[data-id]')).find(function (row) {
      return row.getBoundingClientRect().bottom > 0;
    });
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    var anchorId = anchor ? anchor.dataset.id : null;
    var anchorPart = anchor ? anchor.dataset.partIndex : null;

    icPatchRegion(document.getElementById("ic-summary"), icHeroHTML(doc, stats));
    var controls = document.getElementById("ic-controls");
    var controlMode = icBulk.on ? "bulk" : "search";
    if (controls.dataset.mode !== controlMode || icBulk.on) {
      icPatchRegion(controls, icBulk.on ? icBulkBarHTML() : icToolbarHTML());
      controls.dataset.mode = controlMode;
    } else {
      var filterButton = controls.querySelector('[data-x97-action="open-incoming-filters"]');
      var filterCount = activeFilterCount();
      filterButton.innerHTML = icon("filter", 17) + (filterCount ? '<b class="ic-tbadge">' + filterCount + '</b>' : '');
      filterButton.setAttribute("aria-label", "Filter and sort" + (filterCount ? " (" + filterCount + " active)" : ""));
      var currentInput = document.getElementById("ic-search");
      if (currentInput && document.activeElement !== currentInput) currentInput.value = state.upcoming.search;
    }
    icPatchRegion(document.getElementById("ic-active-filters"), activeFilterCount() ? filterTagHTML() : "");
    icPatchRegion(document.getElementById("ic-listwrap"), (filtered.length ? icHeadHTML() : "") +
      '<div class="ic-list" id="ic-list" role="list" aria-label="Incoming receivables">' + body + '</div>' + empty);
    icPatchRegion(document.getElementById("ic-statusbar"), '<span>' + filtered.length + ' of ' + all.length + ' deals</span><span>' + esc(sortLabel(state.upcoming.sort)) + '</span>');

    if (anchorId && !sheetOpen) {
      var nextAnchor = Array.from(shell.querySelectorAll('.ic-list > .ic-row[data-id]')).find(function (row) {
        return row.dataset.id === anchorId && row.dataset.partIndex === anchorPart;
      });
      // A disappearing filter result should not fling the user back to the
      // top. Keep the previous position, naturally clamped to the new page.
      var targetY = nextAnchor ? pageY + nextAnchor.getBoundingClientRect().top - anchorTop : pageY;
      if (Math.abs(window.scrollY - targetY) > 1) window.scrollTo({ top: targetY, behavior: "instant" });
    }
    var searchInput = document.getElementById("ic-search");
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = "true";
      searchInput.addEventListener("input", function (event) {
        state.upcoming.search = searchInput.value; savePrefs();
        if (!event.isComposing) scheduleRender(180);
      });
      searchInput.addEventListener("compositionend", function () {
        state.upcoming.search = searchInput.value; savePrefs(); scheduleRender(180);
      });
    }
  }

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target.matches('.ic-list > .ic-row[data-x97-action]')) {
      event.preventDefault(); event.target.click();
    }
  });

  function icPatchRegion(element, html) {
    if (element._icHTML === html) return;
    var rails = Array.from(element.querySelectorAll(".ic-hero-chips,.ic-month-row"));
    var positions = rails.map(function (rail) { return rail.scrollLeft; });
    element.innerHTML = html;
    element._icHTML = html;
    element.querySelectorAll(".ic-hero-chips,.ic-month-row").forEach(function (rail, index) {
      rail.scrollLeft = positions[index] || 0;
    });
  }

  function openIncomingFilters(doc) {
    var f = state.upcoming;
    var categories = Array.from(new Set((doc.followups || []).map(function (x) { return isRetainerCategory(x.category) ? "Retainer" : x.category; }).concat((doc.followups || []).some(isRetainer) ? ["Retainer"] : []).filter(Boolean))).sort();
    function chipRow(name, options, selected) {
      return '<div class="ic-filter-chiprow" data-filter-group="' + attr(name) + '">' + options.map(function (o) {
        return '<button type="button" class="ic-filter-chip' + (selected.indexOf(o) >= 0 ? " on" : "") + '" data-value="' + attr(o) + '">' + esc(o) + '</button>';
      }).join("") + '</div>';
    }
    var body = '<div class="ic-filter-sheet">' +
      '<div class="ic-filter-section"><label for="ic-f-retainers">Retainers</label><select id="ic-f-retainers" class="x97-select">' + option("all", "Include everything", f.retainers) + option("only", "Retainers only", f.retainers) + option("exclude", "Exclude retainers", f.retainers) + '</select></div>' +
      '<div class="ic-filter-section"><label>Status</label>' + chipRow("statuses", ["Pending", "Part Paid", "Paid", "Cancelled"], f.statuses) + '</div>' +
      '<div class="ic-filter-section"><label>Currency</label>' + chipRow("currencies", ["UGX", "USD"], f.currencies) + '</div>' +
      (categories.length ? '<div class="ic-filter-section"><label>Category</label>' + chipRow("categories", categories, f.categories) + '</div>' : "") +
      '<div class="ic-filter-section"><label>Due date range</label><div class="x97-fields-2"><input class="x97-input" type="date" id="ic-f-from" aria-label="Due from" value="' + attr(f.from) + '"><input class="x97-input" type="date" id="ic-f-to" aria-label="Due to" value="' + attr(f.to) + '"></div></div>' +
      '<div class="ic-filter-section"><label>Balance range</label><div class="x97-fields-2"><input class="x97-input" type="number" min="0" placeholder="Min" aria-label="Smallest balance" id="ic-f-min" value="' + attr(f.minAmount) + '"><input class="x97-input" type="number" min="0" placeholder="Max" aria-label="Largest balance" id="ic-f-max" value="' + attr(f.maxAmount) + '"></div></div>' +
      '<div class="ic-filter-section"><label>Sort</label>' + chipRow("sort", ["urgency", "client", "amountDesc", "amountAsc", "dateAsc", "dateDesc"], []) + '</div>' +
    '</div>';
    var foot = '<button class="x97-btn" data-x97-action="incoming-filters-reset">Reset</button><button class="x97-btn primary" data-x97-action="incoming-filters-apply">' + icon("check", 15) + ' Apply</button>';
    openSheet("Filter Incoming", body, foot, { afterOpen: function (back) {
      var draft = { statuses: f.statuses.slice(), currencies: f.currencies.slice(), categories: f.categories.slice(), sort: f.sort };
      Array.prototype.slice.call(back.querySelectorAll(".ic-filter-chiprow")).forEach(function (row) {
        var group = row.getAttribute("data-filter-group");
        if (group === "sort") {
          Array.prototype.slice.call(row.querySelectorAll(".ic-filter-chip")).forEach(function (chip) {
            chip.textContent = sortLabel(chip.getAttribute("data-value"));
            chip.classList.toggle("on", chip.getAttribute("data-value") === draft.sort);
          });
        }
        row.addEventListener("click", function (e) {
          var chip = e.target.closest(".ic-filter-chip"); if (!chip) return;
          var value = chip.getAttribute("data-value");
          if (group === "sort") { draft.sort = value; Array.prototype.slice.call(row.querySelectorAll(".ic-filter-chip")).forEach(function (c) { c.classList.toggle("on", c === chip); }); return; }
          chip.classList.toggle("on");
          var arr = draft[group], i = arr.indexOf(value);
          if (i >= 0) arr.splice(i, 1); else arr.push(value);
        });
      });
      back.querySelector('[data-x97-action="incoming-filters-reset"]').addEventListener("click", function () {
        state.upcoming.statuses = []; state.upcoming.currencies = []; state.upcoming.categories = []; state.upcoming.retainers = "all";
        state.upcoming.from = ""; state.upcoming.to = ""; state.upcoming.minAmount = ""; state.upcoming.maxAmount = ""; state.upcoming.sort = "urgency";
        savePrefs(); closeSheet(); scheduleRender(0);
      });
      back.querySelector('[data-x97-action="incoming-filters-apply"]').addEventListener("click", function () {
        state.upcoming.retainers = back.querySelector("#ic-f-retainers").value;
        state.upcoming.statuses = draft.statuses; state.upcoming.currencies = draft.currencies; state.upcoming.categories = draft.categories; state.upcoming.sort = draft.sort;
        state.upcoming.from = back.querySelector("#ic-f-from").value; state.upcoming.to = back.querySelector("#ic-f-to").value;
        state.upcoming.minAmount = back.querySelector("#ic-f-min").value; state.upcoming.maxAmount = back.querySelector("#ic-f-max").value;
        savePrefs(); closeSheet(); scheduleRender(0);
      });
    } });
  }

  function openIncomingMore() {
    var body = '<div class="ic-more-list">' +
      '<button class="x97-row" data-x97-action="incoming-bulk-toggle-close">' + icon("rows", 16) + '<div class="x97-row-main"><div class="x97-row-title">Select rows…</div><div class="x97-row-sub">Pick several deals to delete at once</div></div></button>' +
      '<button class="x97-row" data-x97-action="grid-collapse-all" data-value="collapse">' + icon("collapse", 16) + '<div class="x97-row-main"><div class="x97-row-title">Collapse all schedules</div></div></button>' +
      '<button class="x97-row" data-x97-action="grid-collapse-all" data-value="expand">' + icon("expand", 16) + '<div class="x97-row-main"><div class="x97-row-title">Expand all schedules</div></div></button>' +
      '<button class="x97-row" data-x97-action="export-csv" data-kind="receivables">' + icon("list", 16) + '<div class="x97-row-main"><div class="x97-row-title">Export CSV</div></div></button>' +
    '</div>';
    openSheet("More", body, "", { afterOpen: function (back) {
      var b = back.querySelector('[data-x97-action="incoming-bulk-toggle-close"]');
      if (b) b.addEventListener("click", function () { closeSheet(); icSetBulkMode(true); });
    } });
  }

  function icSetBulkMode(on) {
    icBulk.on = on; icBulk.rows = {};
    scheduleRender(0);
  }
  function icToggleBulkRow(id) {
    if (icBulk.rows[id]) delete icBulk.rows[id]; else icBulk.rows[id] = true;
    scheduleRender(0);
  }
  function icDeleteBulkRows() {
    var doc = readDoc(); if (!doc) return;
    var ids = Object.keys(icBulk.rows);
    if (!ids.length) return;
    var locked = ids.filter(function (id) { var item = (doc.followups || []).find(function (x) { return String(x.id) === String(id); }); return item && dealHasRecordedMoney(item); });
    var removable = ids.filter(function (id) { return locked.indexOf(id) < 0; });
    if (!removable.length) { toast("Every selected deal has recorded money — nothing was deleted", "error"); return; }
    var msg = "Delete " + removable.length + " deal" + (removable.length === 1 ? "" : "s") + "?" + (locked.length ? " (" + locked.length + " with money recorded will be kept.)" : "");
    if (!confirm(msg)) return;
    updateDoc(function (d) { d.followups = (d.followups || []).filter(function (x) { return removable.indexOf(String(x.id)) < 0; }); }, "incoming-bulk-delete");
    icClearBulk(); scheduleRender(0);
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

  function networkBadge(network) {
    var n = String(network || "").trim();
    return '<span class="net-badge ' + networkClass(n) + '" aria-hidden="true">' + esc((n || "CR").slice(0, 3).toUpperCase()) + '</span>';
  }

  function facilityCard(f, loans) {
    var used = activePrincipalForFacility(loans, f.id);
    var limit = num(f.limitOffer);
    var available = Math.max(0, limit - used);
    var live = isFacilityLive(f);
    var usedPct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
    var borrowLabel = used > 0 ? "Borrowing active" : !live ? "Unavailable" : available <= 0 ? "Nothing available" : "Borrow";
    return '<article class="card facility' + (live ? "" : " is-off") + '">' +
      '<div class="facility-head">' + networkBadge(f.network) +
        '<div class="facility-name"><h3>' + esc(f.service || "Credit facility") + '</h3><p>' + esc([f.network, f.line].filter(Boolean).join(" · ")) + '</p></div>' +
        '<div class="facility-avail"><span>Available</span><b class="x97-money">' + money(available, "UGX", true) + '</b></div>' +
      '</div>' +
      (limit > 0 ? '<div class="meter" role="img" aria-label="' + attr(usedPct + "% of the limit in use") + '"><i style="width:' + usedPct + '%"></i></div>' : '') +
      '<p class="facility-terms">' + esc(facilityFeeText(f)) + (limit > 0 ? ' · limit ' + esc(money(limit, "UGX", true)) : '') + '</p>' +
      '<div class="card-actions">' +
        '<button type="button" class="x97-btn primary" data-x97-action="borrow" data-id="' + attr(f.id) + '"' + (used > 0 || available <= 0 || !live ? " disabled" : "") + '>' + icon("credit", 16) + ' ' + esc(borrowLabel) + '</button>' +
        '<button type="button" class="x97-btn" data-x97-action="edit-facility" data-id="' + attr(f.id) + '">' + icon("edit", 16) + ' Edit</button>' +
      '</div></article>';
  }

  // A loan: how long is left, what it costs to clear today, what it will cost
  // at the end of its term, and how much of that is fee.
  function loanCard(doc, loan) {
    var f = facilityById(doc, loan.facilityId) || {};
    var due = dueDateForLoan(loan), days = daysBetween(todayDate(), parseLocalDate(due));
    var overdue = days != null && days < 0;
    var dueText = days == null ? "No due date" : overdue ? Math.abs(days) + (Math.abs(days) === 1 ? " day overdue" : " days overdue") : days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : "Due in " + days + " days";
    var today = estimateLoan(loan, todayISO());
    var atTerm = estimateLoan(loan, due);
    var fee = Math.max(0, today - num(loan.principal));
    var tone = overdue || days === 0 ? "bad" : days != null && days <= 3 ? "warn" : "";
    return '<article class="card loan' + (tone ? " is-" + tone : "") + '">' +
      '<div class="facility-head">' + networkBadge(f.network) +
        '<div class="facility-name"><h3>' + esc(f.service || "Credit borrowing") + '</h3><p>' + esc([f.network, f.line].filter(Boolean).join(" · ")) + '</p></div>' +
        '<span class="pill ' + (tone || "neutral") + '">' + esc(dueText) + '</span>' +
      '</div>' +
      '<div class="loan-figures">' +
        '<div><span>To clear today</span><b class="x97-money' + (overdue ? " neg" : "") + '">' + money(today, "UGX") + '</b></div>' +
        '<div><span>Borrowed</span><b class="x97-money">' + money(loan.principal, "UGX") + '</b></div>' +
        '<div><span>Fee so far</span><b class="x97-money">' + money(fee, "UGX") + '</b></div>' +
        (atTerm !== today && !overdue ? '<div><span>At term (' + esc(formatDate(due, true)) + ')</span><b class="x97-money">' + money(atTerm, "UGX") + '</b></div>' : '<div><span>Due date</span><b>' + esc(formatDate(due, true)) + '</b></div>') +
      '</div>' +
      '<div class="card-actions">' +
        '<button type="button" class="x97-btn primary" data-x97-action="repay" data-id="' + attr(loan.id) + '">' + icon("check", 16) + ' Mark repaid</button>' +
        '<button type="button" class="x97-btn" data-x97-action="loan-details" data-id="' + attr(loan.id) + '">Details</button>' +
      '</div></article>';
  }

  function renderCredit(doc) {
    var loans = loansOf(doc);
    var active = loans.filter(isActiveLoan);
    var history = loans.filter(function (l) { return !isActiveLoan(l); }).sort(function (a, b) { return String(b.repaidDate || b.borrowDate).localeCompare(String(a.repaidDate || a.borrowDate)); });
    var live = (doc.credit || []).filter(isFacilityLive);
    var unavailable = (doc.credit || []).filter(function (f) { return !isFacilityLive(f); });
    var availableTotal = live.reduce(function (s, f) { return s + Math.max(0, num(f.limitOffer) - activePrincipalForFacility(active, f.id)); }, 0);
    var borrowed = active.reduce(function (s, l) { return s + num(l.principal); }, 0);
    var due = active.reduce(function (s, l) { return s + estimateLoan(l, todayISO()); }, 0);
    var feesPaid = history.reduce(function (s, l) { return s + Math.max(0, num(l.actualPaid || estimateLoan(l, l.repaidDate)) - num(l.principal)); }, 0);
    var view = state.creditView;
    var body = "";
    if (view === "available") {
      var networks = {};
      live.forEach(function (f) { var k = f.network || "Other"; (networks[k] || (networks[k] = [])).push(f); });
      body = Object.keys(networks).sort().map(function (network) {
        return '<div class="group-head"><h2>' + esc(network) + '</h2><span>' + networks[network].length + (networks[network].length === 1 ? ' facility' : ' facilities') + '</span></div><div class="card-grid">' + networks[network].map(function (f) { return facilityCard(f, active); }).join("") + '</div>';
      }).join("");
      if (!body) body = emptyState("credit", "No live credit offers", "Add the loan offers on your mobile money lines to see what you can borrow and what it costs.", '<button type="button" class="x97-btn primary" data-x97-action="add-facility">' + icon("plus", 16) + ' Add facility</button>');
      if (unavailable.length) body += '<button type="button" class="disclosure" data-x97-action="toggle-unavailable" aria-expanded="' + (unavailableOpen ? "true" : "false") + '"><span>' + unavailable.length + ' unavailable ' + (unavailable.length === 1 ? 'offer' : 'offers') + '</span>' + icon("chevron", 16) + '</button>' +
        (unavailableOpen ? '<div class="card-grid">' + unavailable.map(function (f) { return facilityCard(f, active); }).join("") + '</div>' : '');
    } else if (view === "borrowed") {
      body = active.length ? '<div class="card-grid">' + active.slice().sort(function (a, b) { return String(dueDateForLoan(a)).localeCompare(String(dueDateForLoan(b))); }).map(function (l) { return loanCard(doc, l); }).join("") + '</div>'
        : emptyState("check", "Nothing owed", "No active borrowing. Your offers are ready if you need them.", '<button type="button" class="x97-btn" data-x97-action="credit-view" data-value="available">See available credit</button>');
    } else {
      body = history.length ? '<p class="note">' + esc(history.length + (history.length === 1 ? " loan" : " loans") + " repaid · " + money(feesPaid, "UGX") + " paid in fees") + '</p><div class="list card">' + history.map(function (l) {
        var f = facilityById(doc, l.facilityId) || {};
        var paid = num(l.actualPaid || estimateLoan(l, l.repaidDate));
        return '<div class="list-row">' + networkBadge(f.network) + '<div class="list-main"><b>' + esc(f.service || "Credit borrowing") + '</b><span>' + esc("Borrowed " + formatDate(l.borrowDate, true) + " · repaid " + formatDate(l.repaidDate, true)) + '</span></div><div class="list-value"><b class="x97-money">' + money(paid, "UGX", true) + '</b><span>fee ' + esc(money(Math.max(0, paid - num(l.principal)), "UGX", true)) + '</span></div></div>';
      }).join("") + '</div>'
        : emptyState("clock", "No repayments yet", "Loans you repay are kept here, with what each one cost.");
    }
    root.innerHTML = '<div class="page" data-page="credit">' +
      pageHeader("", "Credit", "What you can borrow, what you owe, and when.", '<button type="button" class="x97-btn primary" data-x97-action="add-facility">' + icon("plus", 16) + '<span>Add facility</span></button>') +
      '<div class="stats">' +
        statTile("Available to borrow", money(availableTotal, "UGX", true), "Across " + live.length + (live.length === 1 ? " live offer" : " live offers"), "brand", false, "credit") +
        statTile("Borrowed", money(borrowed, "UGX", true), active.length + " active", active.length ? "neg" : "", false, "arrowout") +
        statTile("To clear today", money(due, "UGX", true), "Principal plus fees", due ? "neg" : "", false, "clock") +
        statTile("Next repayment", esc(nextLoanDue(active)), active.length ? "Earliest due date" : "Nothing due", "", true, "calendar") +
      '</div>' +
      '<div class="segmented" role="tablist" aria-label="Credit view">' +
        segButton("credit-view", "available", "Available", view) +
        segButton("credit-view", "borrowed", "Borrowed" + (active.length ? " · " + active.length : ""), view) +
        segButton("credit-view", "history", "History", view) +
      '</div>' +
      '<div class="credit-body">' + body + '</div></div>';
  }

  // Shared building blocks for the screens.
  function statTile(label, valueHTML, sub, tone, plain, iconName) {
    return '<div class="stat' + (tone ? " is-" + tone : "") + '">' + (iconName ? '<span class="stat-icon" aria-hidden="true">' + icon(iconName, 16) + '</span>' : '') + '<span class="stat-label">' + esc(label) + '</span><b class="stat-value' + (plain ? "" : " x97-money") + '">' + valueHTML + '</b>' + (sub ? '<span class="stat-sub">' + esc(sub) + '</span>' : '') + '</div>';
  }
  function segButton(action, value, label, current) {
    var on = value === current;
    return '<button type="button" role="tab" aria-selected="' + (on ? "true" : "false") + '" class="seg' + (on ? " on" : "") + '" data-x97-action="' + attr(action) + '" data-value="' + attr(value) + '">' + esc(label) + '</button>';
  }
  function emptyState(iconName, title, text, actionHTML) {
    return '<div class="empty">' + icon(iconName, 22) + '<strong>' + esc(title) + '</strong>' + (text ? '<p>' + esc(text) + '</p>' : '') + (actionHTML || '') + '</div>';
  }

  /* Loading placeholder: the outline of a screen, while the first cloud copy
     arrives on a device that has none yet. */
  function skeletonHTML() {
    var c = cloudState();
    var note = c && c.status === "offline" ? "You're offline. Connect once to load your data onto this device." : c && c.status === "error" ? "Can't reach the cloud yet — retrying…" : "Loading your data…";
    return '<div class="skeleton" role="status" aria-live="polite">' +
      '<span class="sk sk-title"></span><span class="sk sk-hero"></span>' +
      '<div class="sk-row"><span class="sk"></span><span class="sk"></span><span class="sk"></span></div>' +
      '<span class="sk sk-line"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span>' +
      '<p class="sk-note">' + esc(note) + '</p></div>';
  }

  /* ── Motion ──────────────────────────────────────────────────────────────
     Every screen is complete the moment it is drawn; motion only adds the way
     it arrives. The stylesheet owns the animations (its motion layer). This
     marks what should animate on a screen's first draw (runEntrance), counts
     figures up and between values (countUp), and drives what CSS alone can't:
     the tab glider, touch ripples, the hero's tilt, transitions between
     screens and themes, and the intro's exit. Reduced motion turns it all off. */
  var reduceQuery = null;
  var introActive = false;
  var lastWasSkeleton = false;
  var canScrollReveal = !!(window.CSS && CSS.supports && CSS.supports("animation-timeline: view()"));
  function reducedMotion() { return !!(reduceQuery && reduceQuery.matches); }

  // What arrives how, in order. The first rule that claims an element wins, and
  // anything inside a block that reveals on scroll arrives with that block.
  var ENTRANCE = [
    [".page-head .eyebrow", "fade"], [".page-head .page-title", "title"], [".page-head .page-sub", "fade"], [".page-head .page-actions", "pop"],
    [".home-hero, .ic-hero", "hero"],
    [".home-grid > :not(.home-hero)", "rise"],
    [".hero-fig, .forecast, .quick-btn", "pop"],
    [".att, .move, .pipe-row, .home-accounts .list-row", "ledger"],
    [".ic-filter-deck, #ic-controls, .ic-filterchips", "rise"],
    [".ic-list > .ic-row, .ic-list > .ic-group", "ledger"],
    [".page > .stats > .stat", "pop"],
    [".page > .segmented, .month-nav, .exp-summary, .page > .chips, .budget-grid > *", "rise"],
    [".credit-body > *, .credit-body .card-grid > *", "rise"],
    [".exp-list .day, .page > .empty, .settings-grid > *", "rise"],
    [".page > .fine, .page > .about", "fade"]
  ];

  function afterRender(entering) {
    if (introActive) return;               // the intro's exit plays the entrance
    if (entering) runEntrance(); else countUp(false);
  }

  function runEntrance() {
    if (!root || reducedMotion()) { countUp(true); return; }
    var box = root.querySelector(".page, .ic-shell");
    if (!box) return;
    var fold = (window.innerHeight || 800) * 1.02;
    box.classList.remove("enter");
    ENTRANCE.forEach(function (rule) {
      var n = 0;
      Array.prototype.forEach.call(box.querySelectorAll(rule[0]), function (el) {
        if (el.hasAttribute("data-m") || (el.parentElement && el.parentElement.closest('[data-m="scroll"]'))) return;
        if (canScrollReveal && el.getBoundingClientRect().top > fold) { el.setAttribute("data-m", "scroll"); return; }
        el.setAttribute("data-m", rule[1]);
        el.style.setProperty("--i", String(Math.min(n++, 14)));
      });
    });
    void box.offsetWidth;                  // restart, even when replaying after the intro
    box.classList.add("enter");
    countUp(true);
  }

  // Figures count up when a screen arrives, and run from their old value to
  // the new one when data changes under them (a payment, a filter, a sync).
  var COUNTS = ".hero-value, .hero-fig b, .forecast-text b, .stat-value.x97-money, .trio b, .budget-left b.x97-money, .ic-hero-value-main, .ic-hero-usd, .facility-avail b, .loan-figures b, .pipe-amt b, .x97-fx-value";
  var shownFigures = {};
  function countUp(entering) {
    if (!root) return;
    var still = reducedMotion() || privacyOn() || document.hidden;
    var fold = window.innerHeight || 800;
    Array.prototype.forEach.call(root.querySelectorAll(COUNTS), function (el, i) {
      var node = numberNode(el);
      if (!node) return;
      // Incoming patches regions in place, so a figure can still be counting
      // when the next render reads it: read the value it is counting to.
      var m = /-?\d[\d,]*(?:\.\d+)?/.exec(finalText(node));
      if (!m || (!/UGX|USD/.test(el.textContent) && !el.hasAttribute("data-count"))) return;
      var target = parseFloat(m[0].replace(/,/g, ""));
      var key = currentScreen + ":" + (el.getAttribute("data-count") || i);
      var from = entering ? 0 : (key in shownFigures ? shownFigures[key] : target);
      shownFigures[key] = target;
      if (still || from === target || !isFinite(target)) return;
      if (entering && el.getBoundingClientRect().top > fold) return;
      tweenFigure(el, node, m, from, target, entering ? 1150 : 700, entering ? 260 + Math.min(i, 8) * 70 : 0);
    });
  }
  function numberNode(el) {
    var walker = document.createTreeWalker(el, 4, null), n;   // 4 = text nodes
    while ((n = walker.nextNode())) if (/\d/.test(n.nodeValue)) return n;
    return null;
  }
  function finalText(node) { return node.__final != null ? node.__final : node.nodeValue; }
  function tweenFigure(el, node, match, from, to, duration, delay) {
    var text = finalText(node), prefix = text.slice(0, match.index), suffix = text.slice(match.index + match[0].length);
    var decimals = (match[0].split(".")[1] || "").length, grouped = match[0].indexOf(",") >= 0;
    node.nodeValue = text;                 // measure at the final value
    el.style.minWidth = ""; el.style.display = "";
    var inline = getComputedStyle(el).display === "inline";
    // Hold the final width so nothing beside the figure moves while it counts.
    var width = el.getBoundingClientRect().width;
    if (inline) el.style.display = "inline-block";
    el.style.minWidth = width + "px";
    var token = {}, start = 0;
    el.__tween = token;
    node.__final = text;
    function fmt(v) { return grouped ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals); }
    function settle() { node.__final = null; el.style.minWidth = ""; if (inline) el.style.display = ""; }
    function frame(now) {
      if (el.__tween !== token) return;
      if (!node.isConnected) { settle(); return; }   // the figure was re-rendered
      if (!start) start = now + delay;
      var t = Math.min(1, Math.max(0, (now - start) / duration));
      if (t >= 1) { node.nodeValue = text; settle(); el.__tween = null; return; }
      node.nodeValue = prefix + fmt(from + (to - from) * (1 - Math.pow(2, -10 * t))) + suffix;
      requestAnimationFrame(frame);
    }
    node.nodeValue = prefix + fmt(from) + suffix;
    requestAnimationFrame(frame);
  }

  // The highlight behind the current tab slides to it.
  function moveGlider() {
    var nav = document.querySelector(".tabs"), glider = nav && nav.querySelector(".tab-glider");
    var active = nav && nav.querySelector('.tab[aria-current="page"]');
    if (!glider || !active) return;
    glider.style.setProperty("--gx", active.offsetLeft + "px");
    glider.style.setProperty("--gy", active.offsetTop + "px");
    glider.style.setProperty("--gw", active.offsetWidth + "px");
    glider.style.setProperty("--gh", active.offsetHeight + "px");
    if (!glider.classList.contains("ready")) {
      void glider.offsetWidth;
      requestAnimationFrame(function () { glider.classList.add("ready"); });
    }
  }

  // A soft ripple from wherever a finger or pointer lands.
  var RIPPLE = ".x97-btn, .quick-btn, .chip, .x97-chip, .ic-quick, .ic-month-chip, .ic-filter-chip, .att, .set-row, .hero-fig, .forecast, .seg, .tab, .s97-cloud-btn, .x97-msg-tile, .x97-deal-mode, .list-row, .move, .pipe-row, .hero-edit, .x97-rm-tool, .sync-chip";
  function wireRipple() {
    document.addEventListener("pointerdown", function (e) {
      if (reducedMotion() || e.button > 0) return;
      var host = e.target && e.target.closest && e.target.closest(RIPPLE);
      if (!host || host.disabled) return;
      var r = host.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
      var dot = document.createElement("span");
      dot.className = "ripple";
      dot.setAttribute("aria-hidden", "true");
      dot.style.width = dot.style.height = size + "px";
      dot.style.left = (e.clientX - r.left - size / 2) + "px";
      dot.style.top = (e.clientY - r.top - size / 2) + "px";
      host.appendChild(dot);
      setTimeout(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 700);
    }, { passive: true });
  }

  // On a desktop, the command cards lean toward the pointer and a light follows it.
  function wireTilt() {
    if (!window.matchMedia || !matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var active = null, frame = 0, last = null;
    function reset(el) {
      el.classList.remove("is-tilting");
      ["--rx", "--ry", "--mx", "--my"].forEach(function (k) { el.style.removeProperty(k); });
    }
    document.addEventListener("pointermove", function (e) {
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = 0;
        var card = !reducedMotion() && last.target && last.target.closest ? last.target.closest(".hero, .ic-hero") : null;
        if (active && active !== card) reset(active);
        active = card;
        if (!card) return;
        var r = card.getBoundingClientRect(), x = (last.clientX - r.left) / r.width, y = (last.clientY - r.top) / r.height;
        card.style.setProperty("--mx", (x * 100).toFixed(1) + "%");
        card.style.setProperty("--my", (y * 100).toFixed(1) + "%");
        card.style.setProperty("--ry", ((x - 0.5) * 5).toFixed(2) + "deg");
        card.style.setProperty("--rx", ((0.5 - y) * 4).toFixed(2) + "deg");
        card.classList.add("is-tilting");
      });
    }, { passive: true });
    document.addEventListener("pointerout", function (e) { if (!e.relatedTarget && active) { reset(active); active = null; } });   // left the window
  }

  // The header lifts off the page once it scrolls.
  function wireScroll() {
    var html = document.documentElement, on = null, frame = 0;
    function check() {
      frame = 0;
      var s = (window.scrollY || 0) > 6;
      if (s !== on) { on = s; html.classList.toggle("scrolled", s); }
    }
    window.addEventListener("scroll", function () { if (!frame) frame = requestAnimationFrame(check); }, { passive: true });
    check();
  }

  function haptic(ms) {
    try { if (navigator.vibrate && !reducedMotion()) navigator.vibrate(ms || 8); } catch (_) {}
  }

  // Run `update` inside a view transition when the browser has them and motion
  // is welcome; `kind` picks the transition's look in the stylesheet.
  var transitions = {};                    // kind → how many are still running
  function withTransition(kind, update) {
    var html = document.documentElement;
    if (!document.startViewTransition || reducedMotion() || document.hidden) { update(); return; }
    // A second tap cuts the first transition short; its class stays until the
    // last one of its kind has finished.
    transitions[kind] = (transitions[kind] || 0) + 1;
    html.classList.add("vt-" + kind);
    function clear() { if (--transitions[kind] <= 0) { transitions[kind] = 0; html.classList.remove("vt-" + kind); } }
    try { document.startViewTransition(update).finished.then(clear, clear); }
    catch (_) { clear(); update(); }
  }

  var ROUTE_ORDER = ["dashboard", "upcoming", "credit", "expenses", "settings"];
  function routeWithTransition() {
    focusAfterRoute = true;
    var next = ROUTES[routeFromHash()];
    if (introActive || !currentScreen || next === currentScreen) { onRoute(); return; }
    document.documentElement.style.setProperty("--dir", ROUTE_ORDER.indexOf(next) >= ROUTE_ORDER.indexOf(currentScreen) ? "1" : "-1");
    withTransition("route", onRoute);
  }

  // Light and dark swap in a circle that grows from the control that asked.
  function switchTheme(mode, from) {
    var html = document.documentElement;
    if (from && from.getBoundingClientRect) {
      var r = from.getBoundingClientRect();
      html.style.setProperty("--vt-x", Math.round(r.left + r.width / 2) + "px");
      html.style.setProperty("--vt-y", Math.round(r.top + r.height / 2) + "px");
    }
    withTransition("theme", function () { setTheme(mode); });
  }

  // The intro stays up until the first screen is drawn and its moment has
  // played (about a second and a half after launch), then the mark flies into
  // the header while the screen arrives underneath.
  function finishIntro() {
    var html = document.documentElement, intro = document.getElementById("intro");
    if (!intro || html.getAttribute("data-intro") !== "on") { if (intro) intro.remove(); html.setAttribute("data-intro", "off"); return; }
    introActive = true;
    var elapsed = window.performance && performance.now ? performance.now() : 0;
    var gone = false, timer = setTimeout(leave, Math.max(0, 1500 - elapsed));
    // A tap or a key skips it.
    intro.addEventListener("pointerdown", leave);
    document.addEventListener("keydown", leave);
    function leave() {
      if (gone) return;
      gone = true; clearTimeout(timer);
      document.removeEventListener("keydown", leave);
      function swap() {
        if (intro.parentNode) intro.parentNode.removeChild(intro);
        html.setAttribute("data-intro", "done");
        introActive = false;
        moveGlider();
        runEntrance();
      }
      if (document.startViewTransition && !reducedMotion() && !document.hidden) withTransition("intro", swap);
      else {
        intro.classList.add("leaving");
        setTimeout(function () { introActive = false; runEntrance(); }, 180);
        setTimeout(function () { if (intro.parentNode) intro.parentNode.removeChild(intro); html.setAttribute("data-intro", "done"); }, 580);
      }
    }
  }

  function render() {
    renderTimer = null;
    if (!currentScreen || !root) return;
    if (typingInScreen()) { renderDeferred = true; return; }
    renderDeferred = false;
    root.setAttribute("data-screen", currentScreen);
    var doc = viewDoc();
    if (!doc) {
      root.innerHTML = skeletonHTML();
      lastWasSkeleton = true;
      return;
    }
    // A screen arriving (a new tab, or real data replacing the loading
    // outline) gets its entrance; any other redraw only moves the figures.
    var entering = screenEntering || lastWasSkeleton;
    lastWasSkeleton = false;
    try { lastRaw = localStorage.getItem(DATA_KEY) || ""; } catch (_) { lastRaw = ""; }
    if (currentScreen === "dashboard") renderDashboard(doc);
    else if (currentScreen === "upcoming") renderUpcoming(doc);
    else if (currentScreen === "credit") renderCredit(doc);
    else if (currentScreen === "expenses") renderExpenses(doc);
    else if (currentScreen === "settings") renderSettings(doc);
    screenEntering = false;
    afterRender(entering);
  }

  /* ── Sheets ───────────────────────────────────────────────────────────────
     One dialog at a time: a bottom sheet on phones, a centred panel on wider
     screens. It is a real modal: focus moves in and is kept there, Escape
     closes it, and focus returns to whatever opened it. */
  function lockSheetScroll() {
    if (document.body.classList.contains("sheet-open")) return;
    sheetScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.setProperty("--sheet-scroll-y", "-" + sheetScrollY + "px");
    document.body.classList.add("sheet-open");
  }

  function unlockSheetScroll() {
    if (!document.body.classList.contains("sheet-open")) return;
    var restoreY = sheetScrollY;
    document.body.classList.remove("sheet-open");
    document.body.style.removeProperty("--sheet-scroll-y");
    sheetScrollY = 0;
    window.scrollTo(0, restoreY);
  }

  function focusables(container) {
    return Array.prototype.filter.call(container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'), function (el) {
      return el.offsetWidth || el.offsetHeight || el.getClientRects().length;
    });
  }

  function openSheet(title, body, foot, options) {
    var reopening = !!document.getElementById("x97-sheet");
    if (!reopening) sheetOpener = document.activeElement;
    closeSheet(true);
    var back = document.createElement("div");
    back.className = "x97-back";
    back.id = "x97-sheet";
    back.innerHTML = '<section class="x97-sheet' + (options && options.wide ? " wide" : "") + '" role="dialog" aria-modal="true" aria-labelledby="x97-sheet-title"><div class="x97-handle" aria-hidden="true"></div><div class="x97-sheet-head"><h2 id="x97-sheet-title">' + esc(title) + '</h2><button type="button" class="x97-close" data-x97-action="close-sheet" aria-label="Close">' + icon("close") + '</button></div><div class="x97-sheet-body">' + body + '</div>' + (foot ? '<div class="x97-sheet-foot">' + foot + '</div>' : '') + '</section>';
    document.body.appendChild(back);
    Array.prototype.forEach.call(back.querySelectorAll(".x97-sheet-body > *"), function (el, i) { el.style.setProperty("--i", String(Math.min(i, 10))); });
    lockSheetScroll();
    back.addEventListener("mousedown", function (e) { if (e.target === back) closeSheet(); });
    back.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.stopPropagation(); closeSheet(); return; }
      if (e.key !== "Tab") return;
      var list = focusables(back);
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    if (options && options.afterOpen) setTimeout(function () { options.afterOpen(back); }, 0);
    // Wide screens start typing straight away; phones keep the keyboard down
    // until a field is tapped, so the whole sheet is visible first.
    var first = back.querySelector("input:not([type=hidden]):not([disabled]),select,textarea");
    var close = back.querySelector(".x97-close");
    if (first && window.innerWidth > 700) setTimeout(function () { try { first.focus(); } catch (_) {} }, 60);
    else if (close) try { close.focus({ preventScroll: true }); } catch (_) { close.focus(); }
  }

  function closeSheet(keepFocus) {
    var el = document.getElementById("x97-sheet");
    if (el) el.remove();
    if (keepFocus) return;
    unlockSheetScroll();
    var opener = sheetOpener;
    sheetOpener = null;
    if (opener && opener.isConnected && opener.focus) try { opener.focus({ preventScroll: true }); } catch (_) {}
  }

  function option(value, label, selected) { return '<option value="' + attr(value) + '" ' + (String(value) === String(selected) ? "selected" : "") + '>' + esc(label == null ? value : label) + '</option>'; }

  // A labelled field. The label is tied to the first control in `input` (an id
  // is added when it has none), so tapping the label focuses the field and
  // screen readers announce it; help text is tied with aria-describedby.
  var fieldSeq = 0;
  function labelled(input, help) {
    var id = "", helpId = help ? "fh" + (++fieldSeq) : "";
    var out = input.replace(/<(input|select|textarea)\b((?:(?!type="hidden")[^>])*)>/, function (all, tag, rest) {
      var has = /\sid="([^"]+)"/.exec(rest);
      id = has ? has[1] : "fld" + (++fieldSeq);
      return "<" + tag + (has ? "" : ' id="' + id + '"') + (helpId ? ' aria-describedby="' + helpId + '"' : "") + rest + ">";
    });
    return { id: id, html: out, help: help ? '<div class="x97-help" id="' + helpId + '">' + esc(help) + '</div>' : "" };
  }
  function field(label, input, help) {
    var f = labelled(input, help);
    return '<div class="x97-field"><label' + (f.id ? ' for="' + attr(f.id) + '"' : "") + '>' + esc(label) + '</label>' + f.html + f.help + '</div>';
  }
  function fieldWithLabelId(labelId, label, input, help) {
    var f = labelled(input, help);
    return '<div class="x97-field"><label id="' + attr(labelId) + '"' + (f.id ? ' for="' + attr(f.id) + '"' : "") + '>' + esc(label) + '</label>' + f.html + f.help + '</div>';
  }

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
    var doc = readDoc(), existing = id ? (doc.followups || []).find(function (x) { return String(x.id) === String(id); }) : null;
    var item = existing ? clone(existing) : { id: "", client: "", category: "One Time", amount: "", currency: "UGX", status: "Pending", expectedBy: "", phone: "", note: "", dealType: "one", partLabel: "parts", partCount: 1, partEvery: 7 };
    var type = normalizeDealType(item.dealType || "one");
    var locked = !!(existing && dealHasRecordedMoney(item));
    var partLabel = item.partLabel || (type === "monthly" ? "months" : "parts");
    var partCount = item.partCount || (item.parts && item.parts.length) || (type === "split" || type === "deposit" ? 2 : 1);
    // The field is labelled "next due date" and has to mean it: once a deal
    // has parts, the payment that field should show — and reschedule — is
    // whichever one hasn't been paid yet, not always the first. Editing it
    // used to be silently inert for every existing multi-part deal, because
    // dealPartsFor always preferred the stored date over anything typed here.
    var nextUnpaidPart = item.parts && item.parts.filter(function (p) { return num(p.paid) < num(p.amount) - 0.5; })[0];
    var firstDue = (nextUnpaidPart && nextUnpaidPart.dueDate) || (item.parts && item.parts[0] && item.parts[0].dueDate) || item.expectedBy || todayISO();
    var secondDue = (item.parts && item.parts[1] && item.parts[1].dueDate) || dateISO(addDays(firstDue, item.partEvery || 7));
    var depositAmount = item.parts && item.parts[0] ? item.parts[0].amount : "";
    var amountValue = existing ? (type === "monthly" || type === "part" ? dealPartAmount(item) : grossOf(item)) : "";
    var categories = Array.from(new Set([].concat(doc.settings.categories || [], (doc.followups || []).map(function (x) { return x.category; }), ["Design", "One Time", "Retainer"]).filter(Boolean))).sort();
    var statuses = Array.from(new Set([].concat(doc.settings.fuStatuses || [], ["Pending", "Cancelled"]).filter(Boolean)));
    if (isCancelled(item.status) && statuses.indexOf("Cancelled") < 0) statuses.push("Cancelled");
    if (isPaid(item.status) && statuses.indexOf("Paid") < 0) statuses.push("Paid");
    var hasContacts = campContacts(doc).length > 0;
    var modeButtons = Object.keys(DEAL_TYPES).map(function (key) {
      return '<button type="button" class="x97-deal-mode' + (key === type ? " on" : "") + '" data-deal-mode="' + attr(key) + '" aria-pressed="' + (key === type ? "true" : "false") + '"><b>' + esc(DEAL_TYPES[key]) + '</b><span>' + esc(key === "one" ? "One total" : key === "deposit" ? "Deposit + balance" : key === "split" ? "Two equal payments" : key === "custom" ? "You set every amount" : key === "monthly" ? "Repeats each month" : "Repeats per part") + '</span></button>';
    }).join("");
    var dealOptions = Object.keys(DEAL_TYPES).map(function (key) { return option(key, DEAL_TYPES[key], type); }).join("");
    var labelOptions = ["parts", "scenes", "episodes", "months", "units", "milestones"].map(function (x) { return option(x, x.charAt(0).toUpperCase() + x.slice(1), partLabel); }).join("");
    var customRows = type === "custom" ? customBuilderRows(item, partCount, firstDue, locked) : "";
    var dealFields = '<div class="x97-deal-builder x97-card x97-pad"><div class="x97-deal-builder-top"><div><div class="x97-deal-eyebrow">Deal builder</div><div class="x97-deal-builder-title">Structure the money</div></div><span class="x97-deal-live-badge">Live preview</span></div><div class="x97-deal-builder-sub">Choose what the client promised. The app keeps one deal together and shows each payment separately.</div>' +
      '<div class="x97-deal-steps"><span class="active"><i>1</i> Structure</span><span><i>2</i> Amount</span><span><i>3</i> Schedule</span></div>' +
      '<div class="x97-deal-mode-grid">' + modeButtons + '</div><select class="x97-deal-control" name="dealType" style="display:none" aria-hidden="true">' + dealOptions + '</select>' +
      '<div class="x97-fields-2"><div>' + fieldWithLabelId("x97-deal-amount-label", dealAmountLabel(type, partLabel), '<input class="x97-input x97-deal-control" name="amount" inputmode="decimal" type="number" min="0" step="1" value="' + attr(amountValue) + '" placeholder="0"' + (locked ? " disabled" : "") + '>', locked ? "Structure is locked because money has already been recorded." : (type === "monthly" || type === "part" ? "This is the amount for each scheduled " + dealLabelSingular({ partLabel: partLabel }) + "." : type === "custom" ? "Enter the full deal total; the rows below must add up to it." : "The app calculates the schedule from this total.")) + '</div><div>' + field("Currency", '<select class="x97-select x97-deal-control" name="currency"' + (locked ? " disabled" : "") + '>' + option("UGX", "UGX", item.currency) + option("USD", "USD", item.currency) + '</select>') + '</div></div>' +
      '<div class="x97-fields-2"><div class="x97-deal-label-field">' + field("Part label", '<select class="x97-select x97-deal-control" name="partLabel"' + (locked ? " disabled" : "") + '>' + labelOptions + '</select>') + '</div><div class="x97-deal-count-field">' + field("Number of parts", '<input class="x97-input x97-deal-control" name="partCount" type="number" min="1" max="24" step="1" value="' + attr(partCount) + '"' + (locked ? " disabled" : "") + '>') + '</div></div>' +
      '<div class="x97-fields-2"><div class="x97-deal-interval-field">' + field("Days between parts", '<input class="x97-input x97-deal-control" name="partEvery" type="number" min="1" max="365" step="1" value="' + attr(item.partEvery || 7) + '"' + (locked ? " disabled" : "") + '>') + '</div><div class="x97-deposit-field">' + field("Deposit amount", '<input class="x97-input x97-deal-control" name="depositAmount" type="number" min="1" step="1" value="' + attr(depositAmount) + '"' + (locked ? " disabled" : "") + '>', "The balance is full total minus deposit.") + '</div></div>' +
      '<div class="x97-fields-2"><div class="x97-deal-start-field">' + field("First / next due date", '<input class="x97-input x97-deal-control" name="startDate" type="date" value="' + attr(firstDue) + '">') + '</div><div class="x97-deal-second-field">' + field("Second payment due", '<input class="x97-input x97-deal-control" name="secondDue" type="date" value="' + attr(secondDue) + '">') + '</div></div>' +
      '<div class="x97-deposit-dates x97-fields-2"><div>' + field("Deposit due", '<input class="x97-input x97-deal-control" name="depositDue" type="date" value="' + attr(firstDue) + '">') + '</div><div>' + field("Balance due", '<input class="x97-input x97-deal-control" name="balanceDue" type="date" value="' + attr(secondDue) + '">') + '</div></div>' +
      '<div class="x97-custom-editor" id="x97-custom-editor">' + (customRows ? '<div class="x97-custom-editor-head"><div><b>Custom schedule</b><span>Each row is a real promised payment.</span></div><span class="x97-pill">Amounts must equal total</span></div>' + customRows : "") + '</div>' +
      '<div id="x97-deal-hint" class="x97-deal-type-hint"></div><div id="x97-deal-glance" class="x97-deal-glance"></div><div class="x97-deal-schedule-heading"><div><b>Review the schedule</b><span>Every payment remains visible after saving.</span></div><span class="x97-deal-schedule-dot">●</span></div><div id="x97-deal-preview" class="x97-deal-preview"></div>' + (locked ? '<div class="x97-deal-lock-note">Money has already been recorded, so the total, currency and number of payments are locked. Due dates on anything not yet paid are still yours to reschedule.</div>' : '') + '</div>';
    var body = '<form id="x97-upcoming-form" data-x97-form="upcoming"><input type="hidden" name="id" value="' + attr(item.id) + '"><input type="hidden" name="expectedBy" value="' + attr(firstDue) + '">' +
      field("Client / project", '<input class="x97-input" name="client" required maxlength="160" placeholder="e.g. Apollo Studios" value="' + attr(item.client) + '">') +
      field("WhatsApp number", '<input class="x97-input" name="phone" inputmode="tel" value="' + attr(item.phone || "") + '" placeholder="e.g. 0772 123 456">' +
        (hasContacts ? '<input class="x97-input x97-contact-search" style="margin-top:8px" placeholder="Or search any contact — e.g. a name, nickname, part of a number…">' : '') +
        '<div id="x97-contact-suggest">' + contactPickerHTML("", doc, item.client, item.phone) + '</div>', "Used for payment reminders. Local (0772…) or full (+256772…) both work.") +
      dealFields +
      '<details class="x97-more"' + (existing ? " open" : "") + '><summary class="x97-more-summary">' + icon("chevron", 12) + ' More details</summary><div class="x97-more-body">' +
      '<div class="x97-fields-2">' + field("Category", '<select class="x97-select" name="category">' + categories.map(function (x) { return option(x, x, item.category); }).join("") + '</select>') +
      field("Status", '<select class="x97-select" name="status"' + (locked ? " disabled" : "") + '>' + statuses.map(function (x) { return option(x, x, isCancelled(item.status) ? "Cancelled" : isPaid(item.status) ? "Paid" : "Pending"); }).join("") + '</select>') + '</div>' +
      field("Quick due date", '<div class="x97-chips"><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="0">Today</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="7">+7 days</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-days="30">+30 days</button><button type="button" class="x97-chip" data-x97-action="quick-date" data-value="month-end">Month end</button></div>', "For a custom schedule, set each row’s date above.") +
      field("Note", '<textarea class="x97-textarea" name="note" maxlength="500" placeholder="Invoice, follow-up context, or next action">' + esc(item.note) + '</textarea>') + '</div></details></form>';
    if (existing) body += '<div class="x97-doc-actions"><button type="button" class="x97-btn" data-x97-action="open-invoice" data-id="' + attr(item.id) + '">' + icon("list", 15) + ' Invoice</button>' +
      (paidOf(item) > 0 ? '<button type="button" class="x97-btn" data-x97-action="open-receipt" data-id="' + attr(item.id) + '">' + icon("check", 15) + ' Receipt</button>' : '') +
      (!isPaid(item.status) && !isCancelled(item.status) ? '<button type="button" class="x97-btn teal" data-x97-action="mark-paid" data-id="' + attr(item.id) + '">' + icon("wallet", 15) + ' Record payment</button>' : '') + '</div>';
    var foot = (existing && !locked ? '<button class="x97-btn danger" data-x97-action="delete-upcoming" data-id="' + attr(item.id) + '">' + icon("trash") + ' Delete</button>' : '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button>') + '<button class="x97-btn primary" type="submit" form="x97-upcoming-form">' + icon("check") + (existing ? " Save changes" : " Add incoming deal") + '</button>';
    openSheet(existing ? "Edit incoming deal" : "Add incoming deal", body, foot, { afterOpen: function (back) {
      var clientInput = back.querySelector('input[name="client"]'), phoneInput = back.querySelector('input[name="phone"]'), searchInput = back.querySelector(".x97-contact-search"), box = back.querySelector("#x97-contact-suggest");
      var form = back.querySelector("#x97-upcoming-form"), preview = back.querySelector("#x97-deal-preview"), typeInput = back.querySelector('[name="dealType"]'), customEditor = back.querySelector("#x97-custom-editor");
      function draftValues() { return formValues(form); }
      function renderCustomEditor(values) {
        if (!customEditor) return;
        if (normalizeDealType(values.dealType) !== "custom") { customEditor.innerHTML = ""; return; }
        var count = Math.max(1, Math.min(24, Math.round(num(values.partCount) || 1))), first = values.startDate || firstDue;
        customEditor.innerHTML = '<div class="x97-custom-editor-head"><div><b>Custom schedule</b><span>Each row is a real promised payment.</span></div><span class="x97-pill">Amounts must equal total</span></div>' + customBuilderRows(item, count, first, locked);
      }
      function refreshDealPreview() {
        if (!preview || !typeInput) return;
        var values = draftValues(), normalizedType = normalizeDealType(values.dealType || typeInput.value), draft = clone(item);
        draft.dealType = normalizedType; draft.partLabel = values.partLabel || partLabel; draft.partCount = values.partCount || partCount; draft.partEvery = values.partEvery || item.partEvery || 7; draft.currency = values.currency || item.currency;
        draft.parts = locked && item.parts ? clone(item.parts) : dealPartsFor(item, values);
        var total = draft.parts.reduce(function (s, p) { return s + num(p.amount); }, 0), nextDraft = draft.parts.find(function (p) { return num(p.amount) > 0; });
        var totalInput = form.querySelector('[name="amount"]');
        if (!locked && normalizedType === "custom" && totalInput) {
          totalInput.value = total ? roundMoney(total) : "";
          totalInput.readOnly = true;
          totalInput.setAttribute("aria-label", "Deal total calculated from custom payments");
        } else if (totalInput) {
          totalInput.readOnly = false;
          totalInput.removeAttribute("aria-label");
        }
        var hint = back.querySelector("#x97-deal-hint"), glance = back.querySelector("#x97-deal-glance"), amountLabelEl = back.querySelector("#x97-deal-amount-label");
        if (hint) hint.textContent = dealTypeHint(normalizedType, draft.partLabel);
        if (amountLabelEl) amountLabelEl.textContent = dealAmountLabel(normalizedType, draft.partLabel);
        if (glance) glance.innerHTML = '<div><span>Structure</span><b>' + esc(DEAL_TYPES[normalizedType]) + '</b></div><div><span>Payments</span><b>' + draft.parts.length + '</b></div><div><span>Total value</span><b>' + money(total, draft.currency) + '</b></div>';
        var previewHTML = normalizedType === "one" ? '<div class="x97-single-preview"><span>One payment' + (nextDraft && nextDraft.dueDate ? ' · due ' + esc(formatDate(nextDraft.dueDate, true)) : "") + '</span><strong>' + money(total, draft.currency) + '</strong></div>' : dealScheduleHTML(draft, false, true);
        preview.innerHTML = previewHTML + '<div class="x97-deal-total"><span>Deal total</span><b>' + money(total, draft.currency) + '</b></div>';
      }
      function toggleDealFields() {
        var value = normalizeDealType(typeInput ? typeInput.value : "one");
        Array.prototype.slice.call(back.querySelectorAll(".x97-deal-mode")).forEach(function (button) { var on = button.dataset.dealMode === value; button.classList.toggle("on", on); button.setAttribute("aria-pressed", on ? "true" : "false"); });
        var count = back.querySelector(".x97-deal-count-field"), interval = back.querySelector(".x97-deal-interval-field"), second = back.querySelector(".x97-deal-second-field"), deposit = back.querySelector(".x97-deposit-field"), depositDates = back.querySelector(".x97-deposit-dates"), label = back.querySelector(".x97-deal-label-field"), start = back.querySelector(".x97-deal-start-field");
        if (count) count.style.display = value === "one" || value === "split" || value === "deposit" ? "none" : "block";
        if (interval) interval.style.display = value === "part" ? "block" : "none";
        if (second) second.style.display = value === "split" ? "block" : "none";
        if (deposit) deposit.style.display = value === "deposit" ? "block" : "none";
        if (depositDates) depositDates.style.display = value === "deposit" ? "grid" : "none";
        if (label) label.style.display = value === "part" ? "block" : "none";
        if (count && count.querySelector("label")) count.querySelector("label").textContent = value === "monthly" ? "Number of months" : "Number of parts";
        var categoryInput = back.querySelector('[name="category"]');
        if (value === "monthly") {
          if (categoryInput) categoryInput.value = "Retainer";
          back.querySelector('[name="partLabel"]').value = "months";
        }
        if (categoryInput) categoryInput.disabled = value === "monthly";
        if (start) start.style.display = value === "custom" ? "none" : "block";
        if (customEditor) customEditor.style.display = value === "custom" ? "block" : "none";
        if (customEditor && value === "custom" && !customEditor.querySelector("[name^=partAmount_]")) renderCustomEditor(draftValues());
        refreshDealPreview();
      }
      Array.prototype.slice.call(back.querySelectorAll(".x97-deal-mode")).forEach(function (button) { button.addEventListener("click", function () { if (locked) return; typeInput.value = button.dataset.dealMode; toggleDealFields(); }); });
      if (typeInput) typeInput.addEventListener("change", toggleDealFields);
      back.addEventListener("input", function (e) { if (e.target.closest && e.target.closest(".x97-deal-builder")) { if (e.target.name === "partCount" && normalizeDealType(typeInput.value) === "custom") renderCustomEditor(draftValues()); refreshDealPreview(); } });
      back.addEventListener("change", function (e) { if (e.target.closest && e.target.closest(".x97-deal-builder")) refreshDealPreview(); });
      toggleDealFields();
      if (!clientInput || !phoneInput || !box) return;
      var timer = null;
      function refreshContacts() { clearTimeout(timer); timer = setTimeout(function () { box.innerHTML = contactPickerHTML(searchInput ? searchInput.value : "", readDoc(), clientInput.value, phoneInput.value); }, 150); }
      clientInput.addEventListener("input", function () { if (!searchInput || !searchInput.value.trim()) refreshContacts(); });
      phoneInput.addEventListener("input", refreshContacts);
      if (searchInput) searchInput.addEventListener("input", refreshContacts);
      back.addEventListener("click", function (e) {
        var chip = e.target.closest && e.target.closest(".x97-contact-chip"); if (!chip) return;
        phoneInput.value = chip.dataset.phone; refreshContacts();
      });
    } });
  }

  function openPaymentForm(id) {
    var doc = readDoc(), item = doc && (doc.followups || []).find(function (x) { return String(x.id) === String(id); });
    if (!item) { toast("That payment is no longer there", "error"); return; }
    var currency = String(item.currency || "UGX").toUpperCase(), gross = grossOf(item), already = paidOf(item), left = outstandingOf(item), rows = projectSchedule(doc, item), next = nextScheduledPayment(doc, item);
    if (left <= 0) { toast("This deal is already settled", "success"); return; }
    var history = paymentsFor(doc, item.id);
    var accounts = (doc.balances || []).map(function (b) { return option(b.id, b.account + " · " + money(b.balance, FX_HOME), ""); }).join("");
    var targets = rows.filter(function (row) { return num(row.paid) < num(row.amount) - 0.5; }).map(function (row) {
      var owing = Math.max(0, num(row.amount) - num(row.paid));
      return option(row.id, row.label + " · " + money(owing, currency) + (row.dueDate ? " · due " + formatDate(row.dueDate, true) : ""), next && String(next.id) === String(row.id) ? row.id : "");
    }).join("");
    var scheduleHTML = rows.length > 1 ? '<div class="x97-field"><label>Deal schedule</label><div class="x97-payment-target-list">' + rows.map(function (row) {
      var owing = Math.max(0, num(row.amount) - num(row.paid)), status = row.status === "Paid" ? "good" : row.status === "Part Paid" ? "warn" : "";
      return '<div class="x97-payment-target-row"><span class="x97-deal-mark ' + status + '">' + (row.status === "Paid" ? icon("check", 12) : row.index) + '</span><span><b>' + esc(row.label) + '</b><small>' + (row.dueDate ? esc(formatDate(row.dueDate, true)) : "No due date") + '</small></span><strong>' + (owing ? money(owing, currency) + " left" : "Paid") + '</strong></div>';
    }).join("") + '</div></div>' : "";
    var progress = already > 0 ? '<div class="x97-pay-progress"><div class="x97-pay-bar"><i style="width:' + Math.min(100, Math.round(already / (gross || 1) * 100)) + '%"></i></div><div class="x97-pay-split"><span>Paid ' + money(already, currency) + '</span><b>' + money(left, currency) + ' left</b></div></div>' : "";
    var historyHTML = history.length ? '<div class="x97-field"><label>Payments so far</label><div class="x97-pay-log">' + history.map(function (p) {
      var applied = Array.isArray(p.allocations) && p.allocations.length ? ' · ' + p.allocations.map(function (a) { var row = rows.find(function (r) { return String(r.id) === String(a.partId); }); return (row ? row.label : "part") + " " + money(a.amount, currency); }).join(", ") : "";
      return '<div class="x97-pay-row"><div><b class="x97-money">' + money(p.amount, p.currency) + '</b><span>' + esc(formatDate(p.date, true)) + (p.accountName ? " · " + esc(p.accountName) : "") + esc(applied) + '</span></div><button type="button" class="x97-mini danger" data-x97-action="undo-payment" data-id="' + attr(p.id) + '">' + icon("trash", 12) + ' Undo</button></div>';
    }).join("") + '</div></div>' : "";
    var defaultAmount = next ? Math.min(left, Math.max(1, num(next.amount) - num(next.paid))) : left;
    var body = '<form id="x97-pay-form" data-x97-form="payment"><input type="hidden" name="id" value="' + attr(item.id) + '">' +
      '<div class="x97-card x97-pad x97-payment-hero" style="margin-bottom:14px"><div class="x97-row-sub">' + esc(item.client || "Receivable") + '</div><div class="x97-money" style="font-size:28px;margin-top:5px">' + money(left, currency) + '</div><div class="x97-row-sub">Still owed of ' + esc(money(gross, currency)) + '</div>' + progress + '</div>' +
      scheduleHTML +
      (targets ? field("Apply payment to", '<select class="x97-select" name="targetPartId">' + targets + '</select>', "Choose a part; any amount above it carries forward to the next unpaid part.") : "") +
      field("Amount received", '<input class="x97-input" name="amount" type="number" required min="1" max="' + attr(left) + '" step="1" value="' + attr(defaultAmount) + '"><div class="x97-chips" style="padding-top:7px"><button type="button" class="x97-chip" data-x97-action="pay-part" data-value="25">25%</button><button type="button" class="x97-chip" data-x97-action="pay-part" data-value="50">50%</button><button type="button" class="x97-chip" data-x97-action="pay-part" data-value="75">75%</button><button type="button" class="x97-chip" data-x97-action="pay-part" data-value="100">Next / full amount</button></div>', "Record only money that actually arrived. It will never be allowed to exceed the deal balance.") +
      field("Date received", '<input class="x97-input" name="date" type="date" required value="' + todayISO() + '">' ) +
      field("Into which account", '<select class="x97-select" name="accountId"><option value="">Don’t change any balance</option>' + accounts + '</select>', currency === "USD" ? "Dollars are converted at today’s live rate before the account balance moves." : "The selected account balance goes up by this amount.") +
      field("Note", '<input class="x97-input" name="note" maxlength="200" placeholder="Optional — e.g. MoMo ref, deposit slip">') + historyHTML + '</form>';
    var foot = '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-pay-form">' + icon("check") + ' Record payment</button>';
    openSheet("Record payment", body, foot);
  }

  function submitPayment(form) {
    var v = formValues(form);
    var received = roundMoney(v.amount);
    if (received <= 0) { toast("Enter how much came in", "error"); return; }
    var saved = null;
    updateDoc(function (doc) {
      saved = applyPayment(doc, v.id, { amount: received, date: v.date, accountId: v.accountId, note: v.note, targetPartId: v.targetPartId });
    }, "payment-record");
    if (!saved) { toast("That amount is above the remaining deal balance", "error"); return; }
    closeSheet();
    var doc = readDoc();
    var item = doc && (doc.followups || []).find(function (x) { return String(x.id) === String(v.id); });
    var left = item ? outstandingOf(item) : 0;
    toast(left > 0 ? money(left, String(saved.currency)) + " still outstanding" : "Settled in full — nice one", "success");
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

  // One editor for every amount that makes up "Cash on hand" — tapping the
  // dashboard hero figure lands here instead of hunting down each bank,
  // mobile-money and credit-line row on its own screen.
  function openBalancesEditor() {
    var doc = readDoc();
    var accounts = doc.balances || [], lines = doc.credit || [];
    var accountFields = accounts.length ? accounts.map(function (b) {
      var label = b.account || "Account";
      if (b.line) label += " · " + b.line;
      return field(label, '<input class="x97-input" type="number" inputmode="decimal" step="1" name="balance__' + attr(b.id) + '" value="' + attr(b.balance) + '">');
    }).join("") : '<div class="x97-empty" style="padding:12px 6px"><p>No accounts yet.</p></div>';
    var lineFields = lines.length ? lines.map(function (f) {
      var label = (f.network ? f.network + " " : "") + (f.service || "Credit line");
      if (f.line) label += " · " + f.line;
      return field(label, '<input class="x97-input" type="number" inputmode="decimal" min="0" step="1" name="limit__' + attr(f.id) + '" value="' + attr(f.limitOffer) + '">');
    }).join("") : '<div class="x97-empty" style="padding:12px 6px"><p>No credit lines yet.</p></div>';
    var body = '<div class="x97-help" style="margin-bottom:12px">Update any balance or credit limit below, then save — every change applies at once.</div>' +
      '<form id="x97-balances-form" data-x97-form="balances">' +
      '<div class="x97-camp-sec">Bank &amp; mobile money accounts</div>' + accountFields +
      '<div style="margin:2px 0 18px"><button type="button" class="x97-rm-tool" data-x97-action="add-account">' + icon("plus", 13) + ' Add account</button></div>' +
      '<div class="x97-camp-sec">Credit lines</div>' + lineFields +
      '<div style="margin:2px 0 4px"><button type="button" class="x97-rm-tool" data-x97-action="add-facility">' + icon("plus", 13) + ' Add credit facility</button></div>' +
      '</form>';
    var foot = '<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-balances-form">' + icon("check") + ' Save all</button>';
    openSheet("Update balances", body, foot);
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
    var loans=loansOf(doc), available=Math.max(0,num(f.limitOffer)-activePrincipalForFacility(loans,f.id));
    var accounts=(doc.balances||[]).map(function(b){return option(b.id,b.account+' · '+money(b.balance,"UGX"),"");}).join("");
    var manual=/manual/i.test(String(f.feeModel));
    var body='<form id="x97-borrow-form" data-x97-form="borrow"><input type="hidden" name="facilityId" value="'+attr(f.id)+'"><div class="x97-card x97-pad" style="margin-bottom:14px"><div class="x97-row-sub">Available from '+esc(f.service)+'</div><div class="x97-money x97-teal" style="font-size:28px;margin-top:5px">'+money(available,"UGX")+'</div><div class="x97-row-sub">'+esc(facilityFeeText(f))+'</div></div>'+field("Amount borrowed",'<input class="x97-input" name="amount" required type="number" min="1" max="'+attr(available)+'" step="1" value=""><div class="x97-chips" style="padding-top:7px"><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="25">25%</button><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="50">50%</button><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="75">75%</button><button type="button" class="x97-chip" data-x97-action="borrow-percent" data-value="100">Maximum</button></div>')+field("Borrowing date",'<input class="x97-input" name="borrowDate" type="date" required value="'+todayISO()+'">')+(manual?field("Amount due",'<input class="x97-input" name="manualDue" type="number" min="0" step="1" required>','Enter the provider’s total repayment amount.'):'')+field("Add money to account",'<select class="x97-select" name="destinationAccount"><option value="">No — record debt only</option>'+accounts+'</select>','An account balance changes only when you select it explicitly.')+'<div class="x97-preview" id="x97-borrow-preview"></div></form>';
    var foot='<button class="x97-btn" data-x97-action="close-sheet">Cancel</button><button class="x97-btn primary" type="submit" form="x97-borrow-form">'+icon("check")+' Record borrowing</button>';
    openSheet("Record borrowing",body,foot,{afterOpen:function(){var form=document.getElementById("x97-borrow-form");renderBorrowPreview(form,f);}});
  }

  function findLoan(doc,id) { return loansOf(doc).find(function(l){return String(l.id)===String(id);}); }

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
    var v = formValues(form), id = v.id || uid("fu"), type = normalizeDealType(v.dealType || "one"), oldSnapshot = readDoc(), old = oldSnapshot && (oldSnapshot.followups || []).find(function (x) { return String(x.id) === String(id); });
    if (!String(v.client || "").trim()) { toast("Add a client or project name", "error"); return; }
    if (type === "monthly") {
      if (!Number.isInteger(num(v.partCount)) || num(v.partCount) < 1 || num(v.partCount) > 24) { toast("Enter between 1 and 24 months", "error"); return; }
      if (!parseLocalDate(v.startDate)) { toast("Choose the first or next monthly due date", "error"); return; }
      v.category = "Retainer"; v.partLabel = "months";
    }
    // A deal with money already recorded disables the amount/currency/count/
    // interval/label inputs in the form, but formValues() reads a disabled
    // field's value like any other — so those fields round-trip unchanged
    // below regardless, while the due-date fields (never disabled — see
    // openUpcomingForm) carry through whatever was actually rescheduled.
    // There used to be a separate branch here that saved only client/
    // category/phone/note and quietly dropped every date edit on a deal
    // with money recorded — exactly the "I changed it and it stayed the
    // same" bug.
    var parts = type === "one" ? [] : dealPartsFor(old || {}, v), gross = type === "one" ? roundMoney(v.amount) : roundMoney(parts.reduce(function (sum, p) { return sum + num(p.amount); }, 0));
    if (gross <= 0) { toast("Enter the deal total", "error"); return; }
    if (type === "deposit") {
      var deposit = num(v.depositAmount);
      if (deposit <= 0 || deposit >= gross) { toast("Deposit must be less than the full deal total", "error"); return; }
    }
    if (type === "custom") {
      if (parts.some(function (p) { return num(p.amount) <= 0; })) { toast("Give every custom payment an amount", "error"); return; }
    }
    var already = old ? paidOf(old) : 0;
    if (old && isPaid(old.status) && already <= 0) already = gross;
    if (already > gross + 0.5) { toast("The new total cannot be below money already received", "error"); return; }
    var due = type === "custom" ? (parts[0] && parts[0].dueDate || "") : type === "deposit" ? (v.depositDue || v.firstDue || parts[0] && parts[0].dueDate || "") : (parts[0] && parts[0].dueDate || v.startDate || v.expectedBy || "");
    var cancelled = String(v.status || "").toLowerCase() === "cancelled";
    var item = { id: id, client: String(v.client || "").trim(), category: v.category || "One Time", gross: gross, paid: already, amount: roundMoney(Math.max(0, gross - already)), currency: String(v.currency || "UGX").toUpperCase(), status: cancelled ? "Cancelled" : already >= gross - 0.5 && already > 0 ? "Paid" : already > 0 ? "Part Paid" : "Pending", expectedBy: due, phone: String(v.phone || "").trim(), note: String(v.note || "").trim() };
    if (type !== "one") {
      item.dealType = type; item.partLabel = String(v.partLabel || (type === "monthly" ? "months" : "parts")).toLowerCase(); item.partCount = parts.length; item.partEvery = Math.max(1, Math.round(num(v.partEvery || 7))); item.partAmount = parts[0] ? num(parts[0].amount) : 0; item.depositAmount = type === "deposit" ? num(v.depositAmount) : 0; item.parts = parts;
    }
    updateDoc(function (doc) {
      var i = doc.followups.findIndex(function (x) { return String(x.id) === String(id); }), previous = i >= 0 ? doc.followups[i] : null, next = Object.assign({}, previous || {}, item);
      if (type !== "one") rebuildDealParts(doc, next);
      else { delete next.dealType; delete next.partLabel; delete next.partCount; delete next.partEvery; delete next.partAmount; delete next.depositAmount; delete next.parts; }
      if (i >= 0) doc.followups[i] = next; else doc.followups.unshift(next);
    }, "upcoming-save");
    closeSheet(); if (remindState.open) refreshRemind();
  }

  /* ============================ WhatsApp payment reminders ============================ */

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

  function autoTone(item, doc) { var t = timing(item, doc); if (t.days != null && t.days < 0) { return Math.abs(t.days) > 14 ? "firm" : "followup"; } return "friendly"; }

  function fillTemplate(body, item, doc) {
    var cur = String(item.currency || "UGX").toUpperCase();
    var t = timing(item, doc), next = t.next, nextLeft = next ? Math.max(0, num(next.amount) - num(next.paid)) : outstandingOf(item); var late = (t.days != null && t.days < 0) ? Math.abs(t.days) : 0;
    var map = {
      "{name}": firstName(item.client),
      "{project}": item.category || item.client || "the project",
      "{amount}": nextLeft ? money(nextLeft, cur) : "the outstanding amount",
      "{currency}": cur,
      "{date}": next && next.dueDate ? formatDate(next.dueDate, false) : (item.expectedBy ? formatDate(item.expectedBy, false) : "the agreed date"),
      "{days}": String(late),
      "{you}": (doc.settings && doc.settings.senderName) || "97 LIVE"
    };
    return String(body).replace(/\{name\}|\{project\}|\{amount\}|\{currency\}|\{date\}|\{days\}|\{you\}/g, function (k) { return map[k]; });
  }

  function messageFor(item, doc) {
    if (remindState.drafts[item.id] != null) return remindState.drafts[item.id];
    var tone = remindState.tone === "auto" ? autoTone(item, doc) : remindState.tone;
    return fillTemplate(templateForTone(doc, tone), item, doc);
  }

  function chaseList(doc) {
    return (doc.followups || []).filter(isOpenFollowup).filter(function (x) {
      var t = timing(x, doc); return t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7);
    }).sort(function (a, b) {
      var ta = timing(a, doc), tb = timing(b, doc);
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
  function progLabel(p) { return ({ queued: "Queued", sending: "Sending…", typing: "Typing…", sent: "Sent ✓", error: "Failed", skipped: "Skipped", "not-contact": "Skipped · not in contacts", paused: "Paused" })[p] || p; }

  // The messaging panels are full-screen dialogs: announced as such, and
  // Escape (or leaving the screen) closes the top one.
  function panelDialog(el, label) {
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", label);
    el.tabIndex = -1;
    setTimeout(function () { if (el.isConnected) try { el.focus({ preventScroll: true }); } catch (_) {} }, 0);
  }
  function closeTopPanel() {
    if (document.getElementById("x97-camp")) { closeCampaigns(); return true; }
    if (document.getElementById("x97-remind")) { closeReminders(); return true; }
    if (document.getElementById("x97-msg")) { closeMessaging(); return true; }
    return false;
  }
  function closeAllPanels() { while (closeTopPanel()) {} }

  function openReminders() {
    remindState.open = true; remindState.progress = {};
    var doc = readDoc();
    if (doc) chaseSendable(doc).forEach(function (x) { if (timing(x, doc).key === "overdue" && !x.lastRemindedAt) remindState.selected[x.id] = true; });
    var el = document.getElementById("x97-remind");
    if (!el) { el = document.createElement("div"); el.id = "x97-remind"; el.className = "x97-remind-overlay"; panelDialog(el, "Chase overdue payments"); document.body.appendChild(el); wireRemind(el); }
    document.body.classList.add("x97-remind-lock");
    refreshRemind();
  }
  function closeReminders() { remindState.open = false; var el = document.getElementById("x97-remind"); if (el) el.remove(); if (!campaignState.open && !document.getElementById("x97-msg")) document.body.classList.remove("x97-remind-lock"); }
  function refreshRemind() { var el = document.getElementById("x97-remind"); if (!el || !remindState.open) return; var doc = readDoc(); if (!doc) return; el.innerHTML = remindOverlayHTML(doc); }

  function remindRow(item, doc) {
    var t = timing(item, doc), sel = !!remindState.selected[item.id], wa = hasWa(item, doc);
    var cur = String(item.currency || "UGX").toUpperCase();
    var prog = remindState.progress[item.id];
    var phoneHTML = wa
      ? '<span class="x97-pill">' + icon("phone", 12) + esc(prettyPhone(item.phone)) + '</span>'
      : '<button type="button" class="x97-pill add-number" data-x97-action="edit-upcoming" data-id="' + attr(item.id) + '">' + icon("plus", 12) + ' Add number</button>';
    var reminded = item.lastRemindedAt ? '<span class="x97-pill good">' + icon("check", 12) + 'Reminded ' + esc(relFromISO(item.lastRemindedAt)) + '</span>' : '';
    var progHTML = prog ? '<span class="x97-pill ' + (prog === "sent" ? "good" : prog === "error" ? "bad" : "warn") + '">' + esc(progLabel(prog)) + '</span>' : '';
    return '<div class="x97-rm-item' + (sel ? ' on' : '') + (wa ? '' : ' nowa') + '" data-id="' + attr(item.id) + '">' +
      '<div class="x97-rm-head"><label class="x97-rm-pick"><input type="checkbox" class="x97-rm-check" data-id="' + attr(item.id) + '" aria-label="' + attr("Remind " + (item.client || "this client")) + '" ' + (sel ? 'checked' : '') + (wa ? '' : ' disabled') + '></label>' +
      '<div class="x97-rm-body"><div class="x97-rm-top"><span class="x97-rm-name">' + esc(item.client || "Untitled") + '</span><span class="x97-rm-amt x97-money">' + (outstandingOf(item) ? money(outstandingOf(item), cur) : "—") + '</span></div>' +
      '<div class="x97-rm-tags"><span class="x97-pill ' + esc(t.cls) + '">' + icon("clock", 12) + esc(t.label) + '</span>' + phoneHTML + reminded + progHTML + '</div></div></div>' +
      (sel && wa ? '<textarea class="x97-rm-msg" data-id="' + attr(item.id) + '" rows="4" aria-label="' + attr("Message to " + (item.client || "client")) + '">' + esc(messageFor(item, doc)) + '</textarea>' : '') +
      '</div>';
  }

  function remindOverlayHTML(doc) {
    var list = chaseList(doc), sendableN = selectedSendable(doc).length;
    var sent = remindSentToday(doc), cap = safety(doc).dailyCap;
    var pct = Math.min(100, Math.round(sent / Math.max(1, cap) * 100));
    var meterCls = sent >= cap ? "bad" : (sent >= cap * 0.8 ? "warn" : "ok");
    var rows = list.length ? list.map(function (x) { return remindRow(x, doc); }).join("")
      : '<div class="x97-empty x97-brand-empty" style="padding:34px 16px">' + brandMark(40, "x97-brand-watermark") + '<strong>Nothing to chase 🎉</strong><p>No receivables are overdue or due within 7 days. This list fills up automatically as dates pass.</p></div>';
    var toneSel = '<select class="x97-rm-tone x97-select" aria-label="Message tone">' +
      option("auto", "Tone: Auto", remindState.tone) + option("friendly", "Tone: Friendly", remindState.tone) +
      option("followup", "Tone: Follow-up", remindState.tone) + option("firm", "Tone: Firm", remindState.tone) + '</select>';
    var modeSeg = '<div class="x97-rm-seg"><button data-rm="mode-onetap" class="' + (remindState.mode === "onetap" ? "on" : "") + '">One-tap</button><button data-rm="mode-auto" class="' + (remindState.mode === "auto" ? "on" : "") + '">Auto</button></div>';
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
      '<div class="x97-rm-header"><div class="x97-rm-htop"><div><button class="x97-rm-link" data-rm="hub" style="margin-bottom:4px">‹ Messaging</button><div class="x97-rm-title">' + brandMark(16) + icon("message", 18) + ' Chase overdue</div><div class="x97-rm-sub">' + list.length + ' to chase · ' + chaseSendable(doc).length + ' with a number</div></div><button type="button" class="x97-rm-close" data-rm="close" aria-label="Close">' + icon("close") + '</button></div>' +
      '<div class="x97-rm-meter ' + meterCls + '"><div class="x97-rm-meter-bar" style="width:' + pct + '%"></div><span>Sent today ' + sent + ' / ' + cap + '</span><em class="' + (remindExt.ready ? "ok" : "") + '">' + (remindExt.ready ? "Sender connected" : "Sender off") + '</em></div></div>' +
      '<div class="x97-rm-toolbar">' + toneSel + '<span class="x97-rm-spacer"></span>' + modeSeg + '<button class="x97-rm-tool" data-rm="numbers">' + icon("phone", 14) + ' Numbers</button><button class="x97-rm-tool" data-rm="templates">' + icon("edit", 14) + ' Templates</button><button class="x97-rm-tool" data-rm="safety">' + icon("shield", 14) + ' Safety</button></div>' +
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

  // "Only known contacts": Auto mode sends only to numbers in the contacts you
  // imported. Messages to numbers that don't have yours saved are what WhatsApp
  // treats as spam, and the imported contacts are this app's record of who does.
  function knownContactFilter(doc, jobs) {
    if (!safety(doc).knownOnly) return { send: jobs, skipped: [], noContacts: false };
    var known = {};
    campContacts(doc).forEach(function (c) { var k = waNumber(c.phone, doc); if (k) known[k] = true; });
    var send = [], skipped = [];
    jobs.forEach(function (j) { (known[j.phone] ? send : skipped).push(j); });
    return { send: send, skipped: skipped, noContacts: !Object.keys(known).length };
  }

  function sendAuto(doc) {
    if (!remindExt.ready) { toast("Install the 97 Sender extension first", "error"); return; }
    var jobs = selectedSendable(doc).map(function (item) { return { id: String(item.id), phone: waNumber(item.phone, doc), name: firstName(item.client), message: messageFor(item, doc) }; });
    if (!jobs.length) { toast("Select at least one client with a number", "error"); return; }
    var gate = knownContactFilter(doc, jobs);
    if (gate.noContacts) { toast("“Only known contacts” is on but Contacts & lists is empty. Import your contacts there, or turn the setting off in Safety.", "error"); return; }
    gate.skipped.forEach(function (j) { remindState.progress[j.id] = "not-contact"; });
    if (!gate.send.length) { refreshRemind(); toast("None of the selected numbers are in your contacts, so nothing was sent", "error"); return; }
    gate.send.forEach(function (j) { remindState.progress[j.id] = "queued"; });
    remindExt.sending = true;
    window.postMessage({ source: "x97-wa-app", type: "enqueue", jobs: gate.send, safety: safety(doc) }, "*");
    refreshRemind();
    var n = gate.send.length, k = gate.skipped.length;
    toast("Sending " + n + " reminder" + (n === 1 ? "" : "s") + (k ? " · " + k + " skipped, not in your contacts" : "") + " — keep WhatsApp Web open", "");
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
    var doc = readDoc();
    var contacts = campContacts(doc);
    var list = (doc.followups || []).filter(isOpenFollowup).slice().sort(function (a, b) {
      var am = hasWa(a, doc) ? 1 : 0, bm = hasWa(b, doc) ? 1 : 0;
      if (am !== bm) return am - bm;                       // missing numbers first
      var ta = timing(a, doc), tb = timing(b, doc);
      var da = ta.days == null ? 9999 : ta.days, db = tb.days == null ? 9999 : tb.days;
      if (da !== db) return da - db;                        // most urgent next
      return String(a.client || "").localeCompare(String(b.client || ""));
    });
    var missing = list.filter(function (x) { return !hasWa(x, doc); }).length;
    var autoCount = 0, reviewCount = 0;
    var rows = list.map(function (x) {
      var cur = String(x.currency || "UGX").toUpperCase(), t = timing(x, doc);
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
      return '<div class="x97-num-row"><div class="x97-num-meta"><div class="x97-num-name">' + esc(x.client || "Untitled") + '</div><div class="x97-num-sub"><span class="x97-pill ' + esc(t.cls) + '" style="padding:2px 6px">' + esc(t.label) + '</span>' + (outstandingOf(x) ? '<span>' + esc(money(outstandingOf(x), cur)) + '</span>' : '') + '</div>' + picker + '</div><input class="x97-input x97-num-input" name="num_' + attr(x.id) + '" inputmode="tel" value="' + attr(x.phone || "") + '" placeholder="0772…"></div>';
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
      field("Only known contacts", '<select class="x97-select" name="knownOnly">' + option("false", "No — send to any number", String(s.knownOnly)) + option("true", "Yes — safest, skip unsaved", String(s.knownOnly)) + '</select>', "Known means the number is in Contacts & lists. Anyone else is skipped and marked in the reminder list.") + '</form>';
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
      overdue: cl.filter(function (x) { return timing(x, doc).key === "overdue"; }).length,
      dueSoon: cl.length,
      contacts: campContacts(doc).length,
      lists: campLists(doc).length,
      campaigns: campCampaigns(doc).length,
      sentToday: combinedSentToday(doc),
      cap: safety(doc).dailyCap
    };
  }

  function openMessaging() {
    var el = document.getElementById("x97-msg");
    if (!el) { el = document.createElement("div"); el.id = "x97-msg"; el.className = "x97-remind-overlay"; panelDialog(el, "Messaging"); document.body.appendChild(el); wireMsgHub(el); }
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
      '<div class="x97-msg-header"><div class="x97-rm-htop"><div><div class="x97-rm-title">' + brandMark(20) + ' Messaging</div><div class="x97-rm-sub">WhatsApp reminders &amp; bulk campaigns, all in one place</div></div><button type="button" class="x97-rm-close" data-msg="close" aria-label="Close">' + icon("close") + '</button></div>' +
      '<div class="x97-msg-stats">' +
        '<div class="x97-msg-stat"><b class="' + (s.overdue ? "x97-red" : "") + '">' + s.overdue + '</b><span>To chase</span></div>' +
        '<div class="x97-msg-stat"><b>' + s.contacts + '</b><span>Contacts</span></div>' +
        '<div class="x97-msg-stat"><b>' + s.campaigns + '</b><span>Campaigns</span></div>' +
      '</div>' +
      '<div class="x97-rm-meter ' + meterCls + '" style="margin-top:2px"><div class="x97-rm-meter-bar" style="width:' + pct + '%"></div><span>Sent today ' + s.sentToday + ' / ' + s.cap + '</span><em class="' + (remindExt.ready ? "ok" : "") + '">' + (remindExt.ready ? "Sender connected" : "Sender off") + '</em></div>' +
      '</div>' +
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
      return (doc.followups || []).filter(isOpenFollowup).filter(function (x) { var t = timing(x, doc); return (t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7)) && hasWa(x, doc); }).map(function (x) {
        var t = timing(x, doc), next = t.next, cur = String(x.currency || "UGX").toUpperCase(), left = next ? Math.max(0, num(next.amount) - num(next.paid)) : outstandingOf(x);
        return { id: "od_" + x.id, name: x.client || "", phone: x.phone || "", fields: { amount: left ? money(left, cur) : "", currency: cur, date: next && next.dueDate ? formatDate(next.dueDate, false) : "", days: (t.days != null && t.days < 0) ? String(Math.abs(t.days)) : "0", project: x.client || "" } };
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
    campaignState.open = true; campaignState.view = "home"; campaignState.progress = {}; campaignState.sending = false;
    var el = document.getElementById("x97-camp");
    if (!el) { el = document.createElement("div"); el.id = "x97-camp"; el.className = "x97-remind-overlay"; panelDialog(el, "Campaigns"); document.body.appendChild(el); wireCamp(el); }
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
    campRefreshing = true;
    try { el.innerHTML = campOverlayHTML(doc); } finally { campRefreshing = false; }
  }

  function campOverlayHTML(doc) {
    var v = campaignState.view;
    var head = function (title, sub, back, backLabel) {
      return '<div class="x97-rm-header"><div class="x97-rm-htop"><div>' + (back ? '<button class="x97-rm-link" data-camp="' + back + '" style="margin-bottom:4px">‹ ' + esc(backLabel || "Back") + '</button>' : '') + '<div class="x97-rm-title">' + brandMark(16) + ' ' + esc(title) + '</div><div class="x97-rm-sub">' + esc(sub) + '</div></div><button type="button" class="x97-rm-close" data-camp="close" aria-label="Close">' + icon("close") + '</button></div></div>';
    };
    var inner;
    if (v === "import") inner = head("Import contacts", "Paste a CSV or choose a file", "home") + campImportHTML(doc);
    else if (v === "compose") inner = head(campaignState.editId ? "Edit campaign" : "New campaign", "Compose and send", "home") + campComposeHTML(doc);
    else if (v === "report") inner = head(campaignState.name || "Campaign", "Delivery report", campaignState.sending ? "" : "home") + campReportHTML(doc);
    else inner = head("Campaigns", campContacts(doc).length + " contacts · " + campLists(doc).length + " lists", "hub", "Messaging") + campHomeHTML(doc);
    // The Google refresh FAB sits as a sibling of the sheet, not nested
    // inside it — .x97-remind-panel clips overflow, which would clip a
    // position:fixed button rendered inside it.
    var fab = (v === "import" || v === "compose" || v === "report") ? "" : '<button type="button" class="x97-fab" data-camp="google-refresh" aria-label="Refresh Google contacts"><span class="x97-google-g" style="width:26px;height:26px;font-size:15px">G</span></button>';
    return '<div class="x97-remind-panel">' + inner + '</div>' + fab;
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

  // Keeps the contacts directory itself current — not a campaign list, just
  // name+phone — merging in anyone new from Google without creating a
  // duplicate "Google Contacts" list on every press. Only ever runs when
  // someone presses the Google refresh floating button, never on its own:
  // prompt:"" asks Google for a token without forcing the account chooser
  // when the browser already holds a granted session for this app, but
  // still surfaces Google's own sign-in UI the first time it's needed.
  function mergeContactsQuiet(contacts) {
    var added = 0;
    updateDoc(function (d) {
      d.waContacts = d.waContacts || [];
      var byPhone = {};
      d.waContacts.forEach(function (c) { var k = waNumber(c.phone, d); if (k) byPhone[k] = c; });
      contacts.forEach(function (c) {
        var norm = waNumber(c.phone, d);
        if (norm.length < 10) return;
        var name = (c.name || "").trim() || c.phone;
        var existing = byPhone[norm];
        if (existing) { if (!existing.name || existing.name === existing.phone) existing.name = name; }
        else { var nc = { id: uid("ct"), name: name, phone: c.phone, fields: {}, lists: [] }; d.waContacts.push(nc); byPhone[norm] = nc; added++; }
      });
      d.settings.googleContactsLastSync = new Date().toISOString();
    }, "google-contacts-sync", true);
    return added;
  }

  // Manual only — reached by pressing the floating Google button on
  // Contacts & lists. Never called automatically, so nothing Google-related
  // fires without a deliberate tap: no client ID yet opens setup (which
  // itself only ever proceeds once one is saved), otherwise it asks Google
  // for the latest contacts and merges in anyone new.
  function refreshGoogleContacts() {
    var doc = readDoc();
    var clientId = doc && doc.settings && doc.settings.googleClientId;
    if (!clientId) return openGoogleSetup();
    toast("Checking Google for new contacts…", "");
    loadGIS().then(function () {
      var client = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: function (resp) {
          if (!resp || resp.error || !resp.access_token) { toast("Google sign-in was cancelled or failed" + (resp && resp.error ? " (" + resp.error + ")" : ""), "error"); return; }
          fetchGoogleContacts(resp.access_token).then(function (contacts) {
            if (!contacts.length) { toast("No phone numbers found in your Google contacts", "error"); return; }
            var added = mergeContactsQuiet(contacts);
            toast(added ? (added + " new Google contact" + (added === 1 ? "" : "s") + " synced") : "Google contacts are already up to date", "success");
            refreshMsgHub();
            if (campaignState.open) refreshCamp();
          }).catch(function (err) { toast("Could not read Google contacts: " + err.message, "error"); });
        }
      });
      client.requestAccessToken({ prompt: "" });
    }).catch(function () { toast("Could not load Google sign-in — check your connection", "error"); });
  }

  function openGoogleSetup() {
    var doc = readDoc();
    var body = '<div class="x97-help" style="margin-bottom:12px">Connects your real Google Contacts (name + phone) into a list here. This needs a free, one-time <b>Google API Client ID</b> for your own copy of the app. See the setup guide, then paste the Client ID below. Once connected, press the floating Google button on Contacts &amp; lists any time you want to check for anyone new — nothing runs on its own.</div>' +
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
      (campaignState.importText ? '<button class="x97-btn subtle" data-camp="refresh-import" style="margin:-2px 0 12px">Preview columns</button>' : '') +
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
      if (t.classList.contains("x97-camp-import")) { campaignState.importText = t.value; campaignState.nameCol = ""; campaignState.phoneCol = ""; return; }
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
    if (a === "refresh-import") return refreshCamp();
    if (a === "google-connect") return connectGoogleContacts();
    if (a === "google-refresh") return refreshGoogleContacts();
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

  function submitAccount(form) {
    var v=formValues(form),id=v.id||uid("acct");updateDoc(function(doc){var i=doc.balances.findIndex(function(x){return String(x.id)===String(id);});var item={id:id,account:v.account.trim(),line:v.line.trim(),balance:roundMoney(v.balance),notes:v.notes.trim()};if(i>=0)doc.balances[i]=Object.assign({},doc.balances[i],item);else doc.balances.push(item);},"account-save");closeSheet();
  }

  function submitFacility(form) {
    var v=formValues(form),id=v.id||uid("facility");updateDoc(function(doc){var i=doc.credit.findIndex(function(x){return String(x.id)===String(id);});var old=i>=0?doc.credit[i]:{};var item=Object.assign({},old,{id:id,network:v.network,line:v.line.trim(),service:v.service.trim(),limitOffer:roundMoney(v.limitOffer),status:v.status,feeModel:v.feeModel,baseFee:num(v.baseFeePct)/100,dailyRate:num(v.dailyRatePct)/100,termDays:Math.max(0,roundMoney(v.termDays)),notes:v.notes.trim()});if(item.borrowed==null)item.borrowed=0;if(item.borrowDate==null)item.borrowDate="";if(item.manualDue==null)item.manualDue=0;if(i>=0)doc.credit[i]=item;else doc.credit.push(item);},"facility-save");closeSheet();
  }

  function submitBalances(form) {
    var v = formValues(form), changed = 0;
    updateDoc(function (doc) {
      (doc.balances || []).forEach(function (b) {
        var key = "balance__" + b.id;
        if (!(key in v) || String(v[key]).trim() === "") return;
        var next = roundMoney(v[key]);
        if (next !== num(b.balance)) changed++;
        b.balance = next;
      });
      (doc.credit || []).forEach(function (f) {
        var key = "limit__" + f.id;
        if (!(key in v) || String(v[key]).trim() === "") return;
        var next = roundMoney(v[key]);
        if (next !== num(f.limitOffer)) changed++;
        f.limitOffer = next;
      });
    }, "balances-bulk-edit");
    closeSheet();
    toast(changed ? "Updated " + changed + " amount" + (changed === 1 ? "" : "s") : "No changes made", changed ? "success" : "");
  }

  function submitBorrow(form) {
    var v=formValues(form),doc=readDoc(),f=facilityById(doc,v.facilityId);if(!f)return;var available=Math.max(0,num(f.limitOffer)-activePrincipalForFacility(loansOf(doc),f.id)),amount=roundMoney(v.amount);if(amount<=0||amount>available){toast("Enter an amount within the available offer","error");return;}updateDoc(function(next){recordBorrow(next,f.id,amount,v);},"credit-borrow");closeSheet();state.creditView="borrowed";scheduleRender(0);
  }

  // The document changes behind borrowing and repaying, kept apart from the
  // forms so they can be tested. A loan is only ever written to creditLoans.
  function recordBorrow(doc, facilityId, amount, v) {
    var f = facilityById(doc, facilityId);
    if (!f) return false;
    var p = facilityPreview(f, amount, v.borrowDate, v.manualDue);
    doc.creditLoans.push({ id: uid("loan"), facilityId: f.id, principal: amount, borrowDate: v.borrowDate, dueDate: p.dueDate, feeModelSnapshot: f.feeModel, baseFeeSnapshot: num(f.baseFee), dailyRateSnapshot: num(f.dailyRate), termDaysSnapshot: num(f.termDays || 30), estimatedDue: p.estimated, manualDue: num(v.manualDue), status: "Active", destinationAccountId: v.destinationAccount || "", notes: "", createdAt: new Date().toISOString() });
    if (v.destinationAccount) {
      var account = doc.balances.find(function (b) { return String(b.id) === String(v.destinationAccount); });
      if (account) account.balance = num(account.balance) + amount;
    }
    return true;
  }

  function recordRepay(doc, loanId, amount, v) {
    var stored = loansOf(doc).find(function (l) { return String(l.id) === String(loanId); });
    if (!stored) return false;
    stored.status = "Repaid";
    stored.actualPaid = amount;
    stored.repaidDate = v.repaidDate;
    stored.repaymentAccountId = v.repaymentAccount || "";
    stored.updatedAt = new Date().toISOString();
    // Older versions cleared these fields on every repayment; keep doing so, so
    // anything they left on the facility can't reappear as a loan afterwards.
    var facility = facilityById(doc, stored.facilityId);
    if (facility) { facility.borrowed = 0; facility.borrowDate = ""; facility.manualDue = 0; }
    if (v.repaymentAccount) {
      var account = doc.balances.find(function (b) { return String(b.id) === String(v.repaymentAccount); });
      if (account) account.balance = num(account.balance) - amount;
    }
    return true;
  }

  function submitRepay(form) {
    var v=formValues(form),loan=findLoan(readDoc(),v.loanId);if(!loan)return;var amount=roundMoney(v.actualPaid);updateDoc(function(next){recordRepay(next,loan.id,amount,v);},"credit-repay");closeSheet();state.creditView="history";scheduleRender(0);
  }

  document.addEventListener("submit", function (e) {
    var form=e.target.closest("[data-x97-form]");if(!form)return;e.preventDefault();var type=form.dataset.x97Form;if(type==="upcoming")submitUpcoming(form);else if(type==="payment")submitPayment(form);else if(type==="account")submitAccount(form);else if(type==="facility")submitFacility(form);else if(type==="balances")submitBalances(form);else if(type==="borrow")submitBorrow(form);else if(type==="repay")submitRepay(form);else if(type==="reminder-templates")submitTemplates(form);else if(type==="wa-safety")submitSafety(form);else if(type==="wa-numbers")submitNumbers(form);else if(type==="google-setup")submitGoogleSetup(form);else if(type==="expense")submitExpense(form);else if(type==="budgets")submitBudgets(form);
  });

  // Settings: text fields save when they change (on leaving them), toggles at once.
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    if (t.hasAttribute("data-setting")) { saveSetting(t); return; }
    var toggle = t.getAttribute("data-x97-toggle");
    if (toggle === "privacy") { setPrivacy(t.checked); return; }
    if (toggle === "fx-manual") {
      var on = t.checked;
      updateDoc(function (doc) { doc.settings.fxManual = on; }, "fx-manual", on ? "Using your own rate" : "Daily rate back on");
      if (!on) fxSyncDoc(fxLoad());
      return;
    }
    if (t.id === "set-import-file") importBackupFile(t.files && t.files[0]);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target && e.target.hasAttribute && e.target.hasAttribute("data-tag-input")) { e.preventDefault(); addTag(e.target.getAttribute("data-tag-input")); }
    if (e.key === "Escape" && !document.getElementById("x97-sheet") && !document.getElementById("s97-cloud-modal")) closeTopPanel();
  });

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "x97-up-search") {
      state.upcoming.search=e.target.value;savePrefs();clearTimeout(searchTimer);searchTimer=setTimeout(function(){var pos=e.target.selectionStart;scheduleRender(0);setTimeout(function(){var input=document.getElementById("x97-up-search");if(input){input.focus();try{input.setSelectionRange(pos,pos);}catch(_){}}},0);},180);
    }
    var borrowForm=e.target.closest && e.target.closest("#x97-borrow-form");if(borrowForm){var doc=readDoc(),f=facilityById(doc,borrowForm.facilityId.value);if(f)renderBorrowPreview(borrowForm,f);}
  });

  document.addEventListener("click", function (e) {
    var tab=e.target.closest && e.target.closest(".tab[data-route]");
    if(tab){focusAfterRoute=true;if(tab.getAttribute("href")===location.hash||(!location.hash&&tab.getAttribute("data-route")==="home")){e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});}return;}
    var navTarget=e.target.closest && e.target.closest("[data-x97-nav]");if(navTarget){navigate(navTarget.dataset.x97Nav);return;}
    var btn=e.target.closest && e.target.closest("[data-x97-action]");if(!btn)return;var action=btn.dataset.x97Action;
    if(action==="close-sheet"){closeSheet();return;}
    if(action==="open-messaging"){openMessaging();return;}
    if(action==="open-reminders"){openReminders();return;}
    if(action==="open-campaigns"){openCampaigns();return;}
    if(action==="reset-templates"){updateDoc(function(doc){if(doc.settings)doc.settings.reminderTemplates=null;},"reminder-templates-reset");closeSheet();openTemplateManager();return;}
    if(action==="add-upcoming"){openUpcomingForm();return;}
    if(action==="edit-upcoming"){e.stopPropagation();openUpcomingForm(btn.dataset.id);return;}
    if(action==="mark-paid"){e.stopPropagation();openPaymentForm(btn.dataset.id);return;}
    if(action==="chase-one"){e.stopPropagation();var chaseDoc=readDoc(),chaseItem=chaseDoc&&(chaseDoc.followups||[]).find(function(x){return String(x.id)===String(btn.dataset.id);});if(!chaseItem||!hasWa(chaseItem,chaseDoc)){toast("Add a verified WhatsApp number first","error");return;}window.open("https://wa.me/"+waNumber(chaseItem.phone,chaseDoc)+"?text="+encodeURIComponent(messageFor(chaseItem,chaseDoc)),"_blank","noopener");markReminded(chaseItem.id,"onetap");return;}
    if(action==="pay-part"){var pf=document.getElementById("x97-pay-form");if(pf){var cap=num(pf.amount.max);pf.amount.value=Math.max(1,Math.round(cap*num(btn.dataset.value)/100));}return;}
    if(action==="undo-payment"){if(confirm("Undo this payment? The amount goes back to outstanding and any account credit is reversed.")){var pid=btn.dataset.id,fid="";updateDoc(function(doc){var p=(doc.payments||[]).find(function(x){return String(x.id)===String(pid);});if(p)fid=p.followupId;reversePayment(doc,pid);},"payment-undo");closeSheet();if(fid)openPaymentForm(fid);}return;}
    if(action==="delete-upcoming"){var targetDoc=readDoc(),targetItem=targetDoc&&(targetDoc.followups||[]).find(function(x){return String(x.id)===String(btn.dataset.id);});if(targetItem&&dealHasRecordedMoney(targetItem)){toast("A deal with recorded money cannot be deleted","error");return;}deleteRecord("followups",btn.dataset.id,"upcoming-delete");return;}
    if(action==="quick-date"){var value=btn.dataset.value==="month-end"?dateISO(endOfMonth(todayDate())):dateISO(addDays(todayDate(),num(btn.dataset.days))),changed=[];var input=document.querySelector("#x97-upcoming-form [name=expectedBy]"),start=document.querySelector("#x97-upcoming-form [name=startDate]"),first=document.querySelector("#x97-upcoming-form [name=firstDue]"),depositDue=document.querySelector("#x97-upcoming-form [name=depositDue]");if(input){input.value=value;changed.push(input);}if(start){start.value=value;changed.push(start);}if(first){first.value=value;changed.push(first);}if(depositDue){depositDue.value=value;changed.push(depositDue);}var second=document.querySelector("#x97-upcoming-form [name=secondDue]"),balanceDue=document.querySelector("#x97-upcoming-form [name=balanceDue]"),dealTypeInput=document.querySelector("#x97-upcoming-form [name=dealType]");if(second&&dealTypeInput&&(dealTypeInput.value==="split"||dealTypeInput.value==="deposit")&&!second.value){second.value=value;changed.push(second);}if(balanceDue&&dealTypeInput&&dealTypeInput.value==="deposit"&&!balanceDue.value){balanceDue.value=value;changed.push(balanceDue);}changed.forEach(function(el){try{el.dispatchEvent(new Event("input",{bubbles:true}));}catch(_){}});return;}
    if(action==="quick-filter"){state.upcoming.quick=btn.dataset.value;savePrefs();scheduleRender(0);return;}
    if(action==="month-filter"){state.upcoming.month=btn.dataset.month;savePrefs();scheduleRender(0);return;}
    if(action==="filter-retainer"){var wasOn=state.upcoming.retainers==="only";state.upcoming.retainers=wasOn?"all":"only";state.upcoming.categories=[];state.upcoming.quick=wasOn?"open":"all";savePrefs();scheduleRender(0);return;}
    if(action==="open-month"){state.upcoming.month=btn.dataset.month;state.upcoming.quick="open";savePrefs();navigate("upcoming");return;}
    if(action==="clear-filter"){var k=btn.dataset.filter;if(k==="month")state.upcoming.month="all";else if(k==="statuses")state.upcoming.statuses=[];else if(k==="currencies")state.upcoming.currencies=[];else if(k==="categories")state.upcoming.categories=[];else if(k==="retainers")state.upcoming.retainers="all";else if(k==="dates"){state.upcoming.from="";state.upcoming.to="";}else if(k==="amount"){state.upcoming.minAmount="";state.upcoming.maxAmount="";}else if(k==="sort")state.upcoming.sort="urgency";savePrefs();scheduleRender(0);return;}
    if(action==="clear-all-filters"){state.upcoming.retainers="all";state.upcoming.statuses=[];state.upcoming.currencies=[];state.upcoming.categories=[];state.upcoming.from="";state.upcoming.to="";state.upcoming.minAmount="";state.upcoming.maxAmount="";state.upcoming.sort="urgency";state.upcoming.month="all";state.upcoming.quick="all";savePrefs();scheduleRender(0);return;}
    if(action==="go-upcoming"||action==="go-upcoming-months"){navigate("upcoming");return;}
    if(action==="record-payment"){openPaymentPicker();return;}
    if(action==="go"){if(btn.dataset.quick){state.upcoming.quick=btn.dataset.quick;state.upcoming.month="all";savePrefs();}if(btn.dataset.view)state.creditView=btn.dataset.view;navigate(btn.dataset.screen);return;}
    if(action==="open-forecast"){openForecast(30);return;}
    if(action==="add-expense"){openExpenseForm();return;}
    if(action==="edit-expense"){openExpenseForm(btn.dataset.id);return;}
    if(action==="delete-expense"){deleteExpense(btn.dataset.id);return;}
    if(action==="expense-paid"){markExpensePaid(btn.dataset.id);return;}
    if(action==="expense-month"){var em=btn.dataset.value;state.expenses.month=em==="now"?monthKey(todayDate()):shiftMonth(state.expenses.month,num(em));scheduleRender(0);return;}
    if(action==="expense-filter"){state.expenses.filter=btn.dataset.value;scheduleRender(0);return;}
    if(action==="edit-budgets"){openBudgetForm();return;}
    if(action==="tag-add"){addTag(btn.dataset.list);return;}
    if(action==="tag-remove"){removeTag(btn.dataset.list,btn.dataset.value);return;}
    if(action==="open-templates"){openTemplateManager();return;}
    if(action==="open-safety"){openSafetySettings();return;}
    if(action==="open-numbers"){openNumbersManager();return;}
    if(action==="open-google-setup"){openGoogleSetup();return;}
    if(action==="open-sync"){var chip=document.getElementById("s97-cloud-status")||document.querySelector(".s97-cloud-fab");if(chip)chip.click();else toast("Sync isn't running on this page","error");return;}
    if(action==="export-backup"){exportBackup();return;}
    if(action==="import-backup"){var fi=document.getElementById("set-import-file");if(fi){fi.value="";fi.click();}return;}
    if(action==="use-restore-point"){useRestorePoint();return;}
    if(action==="erase-data"){openEraseSheet();return;}
    if(action==="forecast-days"){openForecast(btn.dataset.value);return;}
    if(action==="go-expenses"){navigate("expenses");return;}
    if(action==="go-credit"){navigate("credit");return;}
    if(action==="toggle-theme"){switchTheme(effectiveTheme(loadTheme())==="dark"?"light":"dark",btn);return;}
    if(action==="toggle-privacy"){setPrivacy(!privacyOn());return;}
    if(action==="edit-balances"){openBalancesEditor();return;}
    if(action==="add-account"){openAccountForm();return;}
    if(action==="edit-account"){openAccountForm(btn.dataset.id);return;}
    if(action==="delete-account"){deleteRecord("balances",btn.dataset.id,"account-delete");return;}
    if(action==="credit-view"){state.creditView=btn.dataset.value;scheduleRender(0);return;}
    if(action==="toggle-unavailable"){unavailableOpen=!unavailableOpen;scheduleRender(0);return;}
    if(action==="add-facility"){openFacilityForm();return;}
    if(action==="edit-facility"){openFacilityForm(btn.dataset.id);return;}
    if(action==="delete-facility"){var doc=readDoc(),has=loansOf(doc).some(function(l){return isActiveLoan(l)&&String(l.facilityId)===String(btn.dataset.id);});if(has){toast("Repay or cancel the active borrowing first","error");return;}deleteRecord("credit",btn.dataset.id,"facility-delete");return;}
    if(action==="borrow"){openBorrowForm(btn.dataset.id);return;}
    if(action==="borrow-percent"){var form=document.getElementById("x97-borrow-form");if(form){var max=num(form.amount.max);form.amount.value=Math.floor(max*num(btn.dataset.value)/100);form.amount.dispatchEvent(new Event("input",{bubbles:true}));}return;}
    if(action==="repay"){openRepayForm(btn.dataset.id);return;}
    if(action==="loan-details"){openLoanDetails(btn.dataset.id);return;}
    if(action==="open-converter"){openConverter();return;}
    if(action==="fx-refresh"){fxRefresh(true);return;}
    if(action==="fx-swap"){fxSwap();return;}
    if(action==="open-earnings"){openEarnings();return;}
    if(action==="open-exports"){openExports();return;}
    if(action==="export-csv"){exportCSV(btn.dataset.kind);return;}
    if(action==="open-invoice"){e.stopPropagation();openDocument(btn.dataset.id,"invoice");return;}
    if(action==="open-receipt"){e.stopPropagation();openDocument(btn.dataset.id,"receipt");return;}
    if(action==="copy-document"){var ta=document.getElementById("x97-doc-text");if(ta){navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(ta.value).then(function(){toast("Copied","success");},function(){toast("Could not copy","error");}):(ta.style.display="block",ta.select(),toast("Select and copy","success"));}return;}
    if(action==="send-document"){var sdoc=readDoc();var sitem=sdoc&&(sdoc.followups||[]).find(function(x){return String(x.id)===String(btn.dataset.id);});if(sitem){var body=documentText(sitem,sdoc,btn.dataset.kind);window.open("https://wa.me/"+waNumber(sitem.phone,sdoc)+"?text="+encodeURIComponent(body),"_blank");closeSheet();}return;}
    if(action==="fx-amount"){fxConv.amount=btn.dataset.value;var amt=document.getElementById("x97-fx-amount");if(amt)amt.value=fxConv.amount;fxPaint();return;}
    if(action==="open-incoming-filters"){openIncomingFilters(readDoc());return;}
    if(action==="open-incoming-more"){openIncomingMore();return;}
    if(action==="set-theme"){switchTheme(btn.dataset.value,btn);return;}
    if(action==="grid-collapse-all"){icCollapseAll(btn.dataset.value!=="expand");closeSheet();return;}
    if(action==="incoming-bulk-toggle"){icSetBulkMode(!icBulk.on);return;}
    if(action==="incoming-bulk-cancel"){icSetBulkMode(false);return;}
    if(action==="incoming-bulk-delete"){icDeleteBulkRows();return;}
    if(action==="incoming-bulk-row"){e.stopPropagation();icToggleBulkRow(btn.dataset.id);return;}
    if(action==="incoming-collapse"){e.stopPropagation();icToggleCollapse(btn.dataset.id);return;}
  }, true);

  // Store the credit migration (see migrateFacilityLoans) once, on the stored
  // document as-is, so the cloud copy and every device converge on one shape.
  function persistCreditMigration() {
    var raw = "", doc;
    try { raw = localStorage.getItem(DATA_KEY) || ""; } catch (_) {}
    try { doc = JSON.parse(raw); } catch (_) { return; }
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.credit)) return;
    if (!Array.isArray(doc.creditLoans)) doc.creditLoans = [];
    if (!migrateFacilityLoans(doc)) return;
    var value = JSON.stringify(doc);
    try { localStorage.setItem(DATA_KEY, value); } catch (_) { return; }
    lastRaw = value;
  }

  // Redraw when the stored document changes underneath the screen: the cloud
  // (sync.js announces "s97:data") or another tab of the app ("storage").
  function watchData() {
    function changed() {
      var raw = "";
      try { raw = localStorage.getItem(DATA_KEY) || ""; } catch (_) {}
      if (raw === lastRaw) return;
      lastRaw = raw;
      persistCreditMigration();
      scheduleRender(30);
      if (remindState.open) refreshRemind();
      if (campaignState.open) refreshCamp();
    }
    window.addEventListener("s97:data", changed);
    window.addEventListener("storage", function (e) { if (!e.key || e.key === DATA_KEY) changed(); });
    window.addEventListener("storage", function (e) {
      if (e.key === THEME_KEY) applyTheme(loadTheme());
      if (e.key === PRIVACY_KEY) applyPrivacy();
    });
  }

  function boot() {
    try { localStorage.removeItem("ns97-ai-cfg-v1"); } catch (_) {}
    ["ns97.v2.react-refresh", "ns97.v2.resume-tab", "ns97.v2.quiet-boot"].forEach(function (k) { try { sessionStorage.removeItem(k); } catch (_) {} });
    root = document.getElementById("main");
    if (window.matchMedia) {
      reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      systemDark = window.matchMedia("(prefers-color-scheme: dark)");
      var follow = function () { if (loadTheme() === "system") { applyTheme("system"); scheduleRender(0); } };
      if (systemDark.addEventListener) systemDark.addEventListener("change", follow); else if (systemDark.addListener) systemDark.addListener(follow);
    }
    applyTheme(loadTheme());
    applyPrivacy();
    loadPrefs(); initRemindBridge(); fxWatch(); persistCreditMigration();
    watchData();
    window.addEventListener("hashchange", routeWithTransition);
    // A redraw that waited for a field to lose focus happens as soon as it does.
    document.addEventListener("focusout", function () { if (renderDeferred) setTimeout(function () { if (renderDeferred && !typingInScreen()) render(); }, 0); });
    // Sync status changes (sync.js announces each one): the first cloud load can
    // turn "loading" into an empty workspace, and Settings shows the status.
    var lastReady = null;
    window.addEventListener("s97:cloud", function () {
      var c = cloudState(), ready = !!(c && c.ready);
      if (ready !== lastReady) { lastReady = ready; if (!readDoc()) scheduleRender(0); }
      if (currentScreen === "settings") scheduleRender(60);
    });
    wireRipple(); wireTilt(); wireScroll();
    var gliderFrame = 0;
    window.addEventListener("resize", function () { if (!gliderFrame) gliderFrame = requestAnimationFrame(function () { gliderFrame = 0; moveGlider(); }); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(moveGlider, function () {});
    if (document.documentElement.getAttribute("data-intro") === "on") introActive = true;
    onRoute();
    finishIntro();
    window.__x97v2={version:VERSION,render:scheduleRender,navigate:navigate,read:readDoc,analytics:function(){var d=readDoc();return d?analytics(d):null;},forecast:function(days){var d=readDoc();return d?cashForecast(d,days||30):null;},fx:{rates:fxLoad,refresh:function(){fxRefresh(true);},convert:fxConvert},money:{gross:grossOf,paid:paidOf,outstanding:outstandingOf,earned:earnedIn,series:earningsSeries,csv:function(kind){return csvFor(readDoc(),kind).csv;},doc:function(id,kind){var d=readDoc();var i=(d.followups||[]).find(function(x){return String(x.id)===String(id);});return i?documentText(i,d,kind):"";}},selfTest:function(){var d=readDoc(),fx=fxLoad();return {version:VERSION,dataReady:!!d,followups:d?d.followups.length:0,payments:d?d.payments.length:0,facilities:d?d.credit.length:0,loans:d?loansOf(d).length:0,screen:currentScreen,fx:fx?{source:fx.source,day:fx.day,ugx:fx.rates.UGX,currencies:Object.keys(fx.rates).length,stale:fxStale(fx)}:null};}};
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
