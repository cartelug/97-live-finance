/* 97 LIVE — Experience V2 Premium
   Additive UI upgrade for Dashboard, Incoming and Credit.
   Uses the existing ns97-finance-v1 document so Supabase sync, backups and old records remain compatible.
*/
(function () {
  "use strict";

  if (window.__S97_EXPERIENCE_V2__) return;
  window.__S97_EXPERIENCE_V2__ = true;

  var VERSION = "experience-v2-premium.1";
  var DATA_KEY = "ns97-finance-v1";
  var PREF_KEY = "ns97.v3.incoming.filters";
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
  var fabFrame = 0;
  var sheetScrollY = 0;
  var unavailableOpen = false;
  var needsReactRefresh = false;
  var modeActive = false;
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
      month: "all",
      search: "",
      statuses: [],
      currencies: [],
      categories: [],
      from: "",
      to: "",
      minAmount: "",
      maxAmount: "",
      sort: "urgency",
      gridWidths: {},
      gridHidden: [],
      gridZoom: null,
      gridOrder: null,
      gridFreeze: 1,
      gridCollapsed: [],
      gridRowOrder: []
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
    // Recalculate structured deals in memory whenever a screen reads the
    // document. This keeps old records compatible while making the derived
    // amount/status/next-date fields agree with the payment ledger.
    doc.followups.forEach(function (item) {
      if (Array.isArray(item.parts) || paymentsFor(doc, item.id).length) rebuildDealParts(doc, item);
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

  function isPartPaid(item) { return paidOf(item) > 0 && outstandingOf(item) > 0; }

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
    if (payments.length) rows.forEach(function (row) { row.paid = 0; row.paidOn = ""; row.status = "Pending"; });
    if (!payments.length && paidOf(item) > 0) {
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
    var ledger = paymentsFor(doc, item.id);
    var paid = ledger.length
      ? ledger.reduce(function (sum, payment) { return sum + num(payment.amount); }, 0)
      : Math.max(num(item.paid), schedule.reduce(function (sum, row) { return sum + num(row.paid); }, 0));
    item.gross = roundMoney(gross || item.gross || item.amount);
    item.paid = roundMoney(paid || (paymentsFor(doc, item.id).length ? 0 : num(item.paid)));
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
    var label = String(values && values.partLabel || item && item.partLabel || (type === "monthly" ? "months" : "parts")).trim().toLowerCase() || "parts";
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
      dates[0] = String(values && values.firstDue || dates[0]);
      dates[1] = String(values && values.secondDue || dates[1] || dates[0]);
    }
    if (type === "deposit") {
      dates[0] = String(values && (values.depositDue || values.firstDue) || dates[0]);
      dates[1] = String(values && (values.balanceDue || values.secondDue) || dates[1] || dates[0]);
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

  function dealScheduleHTML(item, editable) {
    if (!item || !Array.isArray(item.parts) || (!isDeal(item) && !editable)) return "";
    var parts = item.parts || [], label = dealLabel(item), paidCount = dealPaidPartCount(item);
    var visible = editable ? parts : parts.slice(0, 5);
    var rows = visible.map(function (p, i) {
      var paid = num(p.paid) >= num(p.amount) - 0.5;
      var partial = !paid && num(p.paid) > 0;
      var date = editable ? '<input class="x97-input x97-deal-date" name="partDate_' + i + '" type="date" value="' + attr(p.dueDate) + '"' + (editable === "locked" ? " disabled" : "") + '>' : esc(formatDate(p.dueDate, true));
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
      rows.push('<div class="x97-custom-row"><span class="x97-custom-index">' + (i + 1) + '</span><div class="x97-custom-fields"><input class="x97-input" name="partLabel_' + i + '" value="' + attr(previous.label || "Payment " + (i + 1)) + '" placeholder="What is this payment for?"' + (locked ? " disabled" : "") + '><div class="x97-fields-2"><input class="x97-input" name="partAmount_' + i + '" type="number" min="0" step="1" value="' + attr(previous.amount || "") + '" placeholder="Amount"' + (locked ? " disabled" : "") + '><input class="x97-input" name="partDate_' + i + '" type="date" value="' + attr(due) + '"' + (locked ? " disabled" : "") + '></div></div></div>');
    }
    return rows.join("");
  }

  function dealSummaryHTML(doc) {
    var deals = (doc.followups || []).filter(function (item) { return isDeal(item) && !isCancelled(item.status); });
    if (!deals.length) return "";
    var currencies = ["UGX", "USD"].filter(function (currency) { return deals.some(function (x) { return String(x.currency || "UGX").toUpperCase() === currency; }); });
    var blocks = currencies.map(function (currency) {
      var rows = deals.filter(function (x) { return String(x.currency || "UGX").toUpperCase() === currency; });
      var booked = rows.reduce(function (s, x) { return s + grossOf(x); }, 0);
      var received = rows.reduce(function (s, x) { return s + receivedOf(x); }, 0);
      var left = rows.reduce(function (s, x) { return s + outstandingOf(x); }, 0);
      return '<div class="x97-deal-metric-card x97-card"><div class="x97-deal-metric-currency">' + currency + '</div><div class="x97-deal-metric-main">' + money(booked, "", true) + '</div><div class="x97-row-sub" style="margin-top:3px">Booked total</div><div class="x97-deal-metric-grid"><span><b>' + money(received, "", true) + '</b> received</span><span><b>' + money(left, "", true) + '</b> uncollected</span></div></div>';
    }).join("");
    return '<section class="x97-section x97-deals-overview x97-dashboard-wide"><div class="x97-section-head"><div><div class="x97-section-title">Deal overview</div><div class="x97-row-sub">Booked work, received money and what is still uncollected</div></div><span class="x97-pill good">' + deals.length + ' deals</span></div><div class="x97-deal-metrics">' + blocks + '</div></section>';
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
    if (!doc) return;
    var value = JSON.stringify(doc);
    try { localStorage.setItem(DATA_KEY, value); } catch (err) { toast("Could not save on this device", "error"); return; }
    lastRaw = value;
    needsReactRefresh = true;
    try { sessionStorage.setItem(REFRESH_KEY, "1"); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent("s97:v2-data-change", { detail: { reason: reason || "update" } })); } catch (_) {}
    // The grid patches its own rows after an edit; rebuilding the whole
    // screen for one cell costs a third of a second on a long sheet.
    if (!igSuppressRender) scheduleRender(0);
    if (!quiet) toast("Saved · syncing to cloud", "success");
  }

  function updateDoc(mutator, reason, quiet) {
    var doc = readDoc();
    if (!doc) { toast("Finance data is not ready yet", "error"); return false; }
    mutator(doc);
    writeDoc(doc, reason, quiet);
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

  /* Light and dark. The palette for both has been in the stylesheet all
     along, but nothing ever set the attribute that switches it on, so the
     app has only ever been light and the dark half was unreachable.
     Light stays the default and the system's dark preference is deliberately
     not consulted: this is a spreadsheet, spreadsheets are white, and a phone
     that flips itself dark at sunset should not repaint a ledger the owner
     knows as white. Dark is a choice, made once, and remembered. */
  function loadTheme() {
    var saved = "";
    try { saved = localStorage.getItem(THEME_KEY) || ""; } catch (_) {}
    return saved === "dark" ? "dark" : "light";
  }
  function applyTheme(mode) {
    var dark = mode === "dark";
    if (dark) document.documentElement.setAttribute("data-v2-theme", "dark");
    else document.documentElement.removeAttribute("data-v2-theme");
    // The browser's own chrome (status bar, address bar) follows too.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#050B08" : "#FFFFFF");
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch (_) {}
  }
  function setTheme(mode) {
    if (loadTheme() === (mode === "dark" ? "dark" : "light")) return;
    applyTheme(mode);
    // Reopen the sheet so its own switch shows the choice that was just made.
    if (document.getElementById("x97-sheet")) openGridMore();
    scheduleRender(0);
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
    if (!r) return 2;
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
      fxSyncDoc(next);
      fxPaint();
      scheduleRender(0);
      if (force) toast("Rates updated", "success");
      if (onDone) onDone(next, null);
    }, function (err) {
      fxBusy = false;
      fxPaint();
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
  function usdEquivalent(usd) {
    var value = fxConvert(usd, "USD", FX_HOME);
    if (value == null || !num(usd)) return "Expected incoming";
    return "≈ " + money(value, FX_HOME, true) + " today";
  }

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
      return '<div class="x97-earn-col' + (last ? " now" : "") + '">' +
        '<div class="x97-earn-bars">' +
          '<i class="in" style="height:' + earnedH + '%" title="' + attr(r.label + " earned " + money(r.earned, FX_HOME)) + '"></i>' +
          '<i class="out" style="height:' + spentH + '%" title="' + attr(r.label + " spent " + money(r.spent, FX_HOME)) + '"></i>' +
        '</div><span class="x97-earn-mon">' + esc(r.label.split(" ")[0]) + '</span></div>';
    }).join("");
    return '<div class="x97-earn-key"><span class="in">Earned</span><span class="out">Spent</span></div>' +
      '<div class="x97-earn-chart" role="img" aria-label="' + attr("Earned versus spent for the last " + series.length + " months. " + series.map(function (r) { return r.label + ": earned " + money(r.earned, FX_HOME) + ", spent " + money(r.spent, FX_HOME); }).join(". ")) + '">' + cols + '</div>' +
      '<div class="x97-earn-now">' + esc(current.label) + ' · <b class="x97-green">' + esc(money(current.earned, FX_HOME, true)) + '</b> in · <b class="x97-red">' + esc(money(current.spent, FX_HOME, true)) + '</b> out</div>';
  }

  function earnCardHTML(doc) {
    var series = earningsSeries(doc, 6);
    var current = series[series.length - 1], prev = series[series.length - 2];
    var delta = prev && prev.earned > 0 ? Math.round((current.earned - prev.earned) / prev.earned * 100) : null;
    var net = current.earned - current.spent;
    var pill = delta == null ? "" : '<span class="x97-pill ' + (delta >= 0 ? "good" : "bad") + '">' + (delta >= 0 ? "+" : "") + delta + '% vs ' + esc(prev.label.split(" ")[0]) + '</span>';
    return '<section class="x97-section x97-dashboard-wide">' + sectionHead("Earnings", "History", "open-earnings") +
      '<div class="x97-card x97-pad">' +
        '<div class="x97-earn-top"><div><div class="x97-fx-label">Received this month</div>' +
        '<div class="x97-earn-value x97-money x97-green">' + money(current.earned, FX_HOME) + '</div></div>' + pill + '</div>' +
        '<div class="x97-hero-meta" style="margin:13px 0 4px"><div class="x97-stat"><span>Spent</span><b class="x97-red">' + money(current.spent, FX_HOME, true) + '</b></div>' +
        '<div class="x97-stat"><span>Kept</span><b class="' + (net < 0 ? "x97-red" : "x97-green") + '">' + money(net, FX_HOME, true) + '</b></div></div>' +
        earnChartHTML(series) +
      '</div></section>';
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

  function fxCardHTML(doc) {
    var store = fxLoad();
    var manual = !!(doc.settings && doc.settings.fxManual);
    var rows = FX_TICKER.map(function (code) {
      var value = fxConvert(1, code, FX_HOME, store);
      return '<div class="x97-fx-tick"><span>1 ' + esc(code) + '</span><b class="x97-money">' + (value == null ? "—" : fxAmount(value, FX_HOME)) + '</b></div>';
    }).join("");
    var headline = store ? fxAmount(fxRate(FX_HOME, store), FX_HOME) : "—";
    return '<section class="x97-section">' + sectionHead("Currency", "Convert", "open-converter") +
      '<button class="x97-fx-card" data-x97-action="open-converter">' +
        '<div class="x97-fx-top">' +
          '<div><div class="x97-fx-label">1 USD buys</div>' +
          '<div class="x97-fx-value x97-money">' + headline + ' <em>UGX</em></div></div>' +
          '<div class="x97-fx-badge' + (fxBusy ? " busy" : (store && !fxStale(store) ? " live" : "")) + '" data-x97-fx="stamp">' + esc(fxStamp(store)) + '</div>' +
        '</div>' +
        '<div class="x97-fx-ticks">' + rows + '</div>' +
        (manual ? '<div class="x97-fx-note">Manual rate on — auto-update is paused</div>' : '') +
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
    document.querySelectorAll('[data-x97-fx="stamp"]').forEach(function (el) {
      el.textContent = fxStamp(store);
      el.classList.toggle("busy", fxBusy);
      el.classList.toggle("live", !fxBusy && !!store && !fxStale(store));
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
        ? fxStamp(store) + " · " + (store.sourceLabel || store.source || "rate service") + " · refreshes automatically each day"
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
          '<label>From</label>' +
          '<div class="x97-fx-leg-row">' + fxSelect("x97-fx-from", fxConv.from, store) +
          '<input class="x97-input x97-fx-amount x97-money" id="x97-fx-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="' + attr(fxConv.amount) + '"></div>' +
          '<div class="x97-chips x97-fx-quick">' + chips + '</div>' +
        '</div>' +
        '<div class="x97-fx-swap-row"><button type="button" class="x97-fx-swap" data-x97-action="fx-swap" aria-label="Swap currencies">' + icon("arrow", 17) + '</button></div>' +
        '<div class="x97-fx-leg">' +
          '<label>To</label>' +
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

  function injectFeatureCSS() {
    if (document.getElementById("x97-feature-css")) return;
    var style = document.createElement("style");
    style.id = "x97-feature-css";
    style.textContent =
      ".x97-fx-card{display:block;width:100%;text-align:left;padding:17px 17px 15px;background:linear-gradient(180deg,var(--card) 0%,var(--bg2) 135%);border:1px solid var(--line);border-radius:22px;box-shadow:var(--toplit),var(--elev-1);transition:border-color .2s ease,box-shadow .24s ease,transform .24s cubic-bezier(.22,1,.36,1);cursor:pointer}" +
      "@media(hover:hover){.x97-fx-card:hover{border-color:var(--line2);box-shadow:var(--toplit),var(--elev-2);transform:translateY(-2px)}}" +
      ".x97-fx-card:active{transform:scale(.99)}" +
      ".x97-fx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}" +
      ".x97-fx-label{font-size:9.5px;text-transform:uppercase;letter-spacing:.09em;font-weight:800;color:var(--tx3)}" +
      ".x97-fx-value{font-size:29px;line-height:1.05;margin-top:9px;color:var(--tx);letter-spacing:-.03em}" +
      ".x97-fx-value em{font-style:normal;font-size:14px;font-weight:800;color:var(--tx3);letter-spacing:0}" +
      ".x97-fx-badge{flex:none;font-size:10px;font-weight:800;padding:6px 9px;border-radius:999px;background:var(--card2);color:var(--tx3);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}" +
      ".x97-fx-badge.live{background:var(--posdim);color:var(--pos)}" +
      ".x97-fx-badge.live::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--pos);animation:x97-pulse 2.4s ease-in-out infinite}" +
      ".x97-fx-badge.busy{background:var(--warndim);color:var(--warn)}" +
      "@media(prefers-reduced-motion:reduce){.x97-fx-badge.live::before{animation:none}}" +
      ".x97-fx-ticks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:15px;padding-top:13px;border-top:1px solid var(--line)}" +
      ".x97-fx-tick{min-width:0}.x97-fx-tick span{display:block;font-size:9.5px;font-weight:800;color:var(--tx3);letter-spacing:.05em}" +
      ".x97-fx-tick b{display:block;font-size:13px;color:var(--tx);margin-top:4px;overflow:hidden;text-overflow:ellipsis}" +
      ".x97-fx-note{margin-top:11px;font-size:10.5px;font-weight:700;color:var(--warn)}" +
      ".x97-fx-leg label{display:block;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx2);font-weight:800;margin:0 0 6px}" +
      ".x97-fx-leg-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:9px;align-items:stretch}" +
      ".x97-fx-leg-row>*{min-width:0}" +
      ".x97-fx-amount{font-size:19px;text-align:right}" +
      ".x97-fx-result{display:flex;align-items:center;justify-content:flex-end;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--posdim);color:var(--pos);font-size:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".x97-fx-quick{margin-top:9px}" +
      ".x97-fx-swap-row{display:flex;justify-content:center;margin:11px 0;position:relative}" +
      ".x97-fx-swap-row::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:var(--line)}" +
      ".x97-fx-swap{position:relative;width:40px;height:40px;border-radius:50%;border:1px solid var(--line2);background:var(--card);color:var(--pos);display:grid;place-items:center;box-shadow:var(--toplit),var(--elev-1);cursor:pointer;transition:transform .18s cubic-bezier(.22,1,.36,1)}" +
      ".x97-fx-swap svg{transform:rotate(90deg)}.x97-fx-swap:active{transform:rotate(180deg) scale(.94)}" +
      ".x97-fx-rates{margin-top:15px;padding:12px 13px;background:var(--card2);border-radius:13px}" +
      ".x97-fx-rate-main{font-size:13px;font-weight:800;color:var(--tx)}" +
      ".x97-fx-rate-sub{font-size:11px;color:var(--tx3);margin-top:4px;font-weight:600}" +
      ".x97-fx-meta{font-size:10.5px;color:var(--tx3);line-height:1.5;margin-top:9px}" +
      ".x97-fx-manual{margin-top:14px;align-items:flex-start}" +
      ".x97-fx-manual span{display:block}.x97-fx-manual em{display:block;font-style:normal;font-weight:600;font-size:10.5px;color:var(--tx3);margin-top:3px;line-height:1.45}" +
      // Part payments
      ".x97-pay-progress{margin-top:12px}.x97-pay-progress.compact{margin:11px 0 0}" +
      ".x97-pay-bar{height:6px;border-radius:99px;background:var(--card3);overflow:hidden}" +
      ".x97-pay-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#17A468,var(--pos2))}" +
      ".x97-pay-split{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:10.5px;font-weight:700;color:var(--tx3)}" +
      ".x97-pay-split b{color:var(--tx)}" +
      ".x97-pay-log{border:1px solid var(--line);border-radius:13px;overflow:hidden}" +
      ".x97-pay-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}" +
      ".x97-pay-row:last-child{border-bottom:0}.x97-pay-row b{display:block;font-size:13px}" +
      ".x97-pay-row span{display:block;font-size:10.5px;color:var(--tx3);margin-top:2px}" +
      ".x97-mini.danger{color:var(--neg)}" +
      // Earnings chart — earned is always the left bar, so identity never rests on hue
      ".x97-earn-top{display:flex;align-items:flex-start;justify-content:space-between;gap:11px}" +
      ".x97-earn-value{font-size:29px;line-height:1.05;margin-top:8px;letter-spacing:-.03em}" +
      ".x97-earn-key{display:flex;gap:14px;margin:4px 0 9px}" +
      ".x97-earn-key span{display:inline-flex;align-items:center;gap:6px;font-size:10.5px;font-weight:750;color:var(--tx3)}" +
      ".x97-earn-key span::before{content:'';width:9px;height:9px;border-radius:3px}" +
      ".x97-earn-key .in::before{background:var(--pos)}.x97-earn-key .out::before{background:var(--neg)}" +
      ".x97-earn-chart{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:9px;align-items:end;height:96px}" +
      ".x97-earn-col{display:flex;flex-direction:column;align-items:center;gap:6px;height:100%;min-width:0}" +
      ".x97-earn-bars{flex:1;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:2px}" +
      ".x97-earn-bars i{width:38%;max-width:15px;border-radius:4px 4px 0 0;min-height:0;transition:height .3s cubic-bezier(.22,1,.36,1)}" +
      ".x97-earn-bars .in{background:var(--pos)}.x97-earn-bars .out{background:var(--neg)}" +
      ".x97-earn-mon{font-size:9.5px;font-weight:750;color:var(--tx3);white-space:nowrap}" +
      ".x97-earn-col.now .x97-earn-mon{color:var(--tx);font-weight:850}" +
      ".x97-earn-now{margin-top:11px;font-size:11px;color:var(--tx3);font-weight:650}" +
      ".x97-earn-table{border:1px solid var(--line);border-radius:13px;overflow:hidden}" +
      ".x97-earn-row{display:grid;grid-template-columns:minmax(0,1.2fr) repeat(3,minmax(0,1fr));gap:8px;padding:10px 12px;border-bottom:1px solid var(--line);align-items:center}" +
      ".x97-earn-row:last-child{border-bottom:0}" +
      ".x97-earn-row.head{background:var(--card2);font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;font-weight:800;color:var(--tx3)}" +
      ".x97-earn-row-mon{font-size:12px;font-weight:750;color:var(--tx);overflow:hidden;text-overflow:ellipsis}" +
      ".x97-earn-row-num{font-size:12px;text-align:right;overflow:hidden;text-overflow:ellipsis}" +
      ".x97-deal-builder{margin:14px 0;background:linear-gradient(145deg,var(--card) 0%,var(--bg2) 100%);border-color:var(--line2);box-shadow:var(--toplit),var(--elev-1);overflow:hidden;position:relative}.x97-deal-builder::before{content:'';position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,var(--pos),#6be0ae,var(--pos2))}" +
      ".x97-deal-builder-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.x97-deal-eyebrow{font-size:9px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:var(--pos);margin-bottom:5px}.x97-deal-builder-title{font-size:17px;font-weight:900;color:var(--tx);letter-spacing:-.02em}.x97-deal-builder-sub{font-size:11.5px;line-height:1.5;color:var(--tx3);margin:6px 0 14px;max-width:56ch}.x97-deal-live-badge{flex:none;padding:6px 8px;border-radius:999px;background:var(--posdim);color:var(--pos);font-size:9.5px;font-weight:850;white-space:nowrap}.x97-deal-live-badge::before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:currentColor;margin:0 5px 1px 0}" +
      ".x97-deal-steps{display:flex;align-items:center;gap:7px;margin:0 0 15px;padding:8px 9px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025);overflow:auto}.x97-deal-steps span{display:inline-flex;align-items:center;gap:5px;color:var(--tx3);font-size:9.5px;font-weight:800;white-space:nowrap}.x97-deal-steps span:not(:last-child)::after{content:'›';margin-left:4px;color:var(--tx3);font-size:14px}.x97-deal-steps i{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--card3);font-style:normal;font-size:9px;color:var(--tx2)}.x97-deal-steps .active{color:var(--pos)}.x97-deal-steps .active i{background:var(--pos);color:#fff}" +
      ".x97-deal-type-hint{margin:1px 0 12px;padding:10px 11px;border-radius:11px;background:var(--card2);color:var(--tx2);font-size:11px;line-height:1.45;border-left:3px solid var(--pos)}" +
      ".x97-deal-glance{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:5px 0 14px}.x97-deal-glance>div{min-width:0;padding:9px 9px 8px;border:1px solid var(--line);border-radius:11px;background:rgba(255,255,255,.018)}.x97-deal-glance span{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);font-weight:850;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.x97-deal-glance b{display:block;margin-top:5px;font-size:11.5px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".x97-deal-schedule-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;margin-bottom:7px;padding-top:13px;border-top:1px solid var(--line)}.x97-deal-schedule-heading b{display:block;font-size:12px;color:var(--tx)}.x97-deal-schedule-heading span{display:block;color:var(--tx3);font-size:10px;margin-top:3px}.x97-deal-schedule-dot{font-size:13px!important;color:var(--pos)!important;margin:0!important}.x97-deal-preview{margin-top:0}.x97-deal-schedule{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--card);box-shadow:0 4px 14px rgba(0,0,0,.06)}" +
      ".x97-deal-schedule-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 12px;background:linear-gradient(90deg,var(--card2),transparent);font-size:11px;color:var(--tx2)}.x97-deal-schedule-head span{font-size:10px;color:var(--tx3);font-weight:750}.x97-deal-row{display:flex;align-items:center;gap:9px;padding:10px 11px;border-top:1px solid var(--line);transition:background .18s ease}.x97-deal-row:first-of-type{border-top:0}.x97-deal-row:hover{background:var(--card2)}.x97-deal-row.paid{background:var(--posdim)}" +
      ".x97-deal-mark{width:23px;height:23px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--card2);border:1px solid var(--line2);font-size:10px;font-weight:850;color:var(--tx2)}.x97-deal-row.paid .x97-deal-mark{background:var(--pos);color:#fff;border-color:var(--pos)}" +
      ".x97-deal-part{flex:1;min-width:0}.x97-deal-part b{display:block;font-size:11.5px;color:var(--tx)}.x97-deal-part span{display:block;font-size:10.5px;color:var(--tx3);margin-top:2px}.x97-deal-part .x97-input{min-height:32px;padding:6px 8px;font-size:11px;margin-top:3px}.x97-deal-row>strong{font-size:11.5px;white-space:nowrap;color:var(--tx)}.x97-deal-total{display:flex;justify-content:space-between;gap:10px;margin-top:9px;padding:11px 12px;border:1px solid var(--line2);border-radius:11px;background:var(--posdim);color:var(--tx2);font-size:11.5px}.x97-deal-total b{color:var(--pos);font-size:13px}.x97-deal-more{padding:9px 12px;border-top:1px solid var(--line);font-size:10.5px;color:var(--tx3);font-weight:750}" +
      ".x97-deal-card-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:10px 0 0;padding:10px 11px;border:1px solid var(--line);border-radius:11px;background:linear-gradient(90deg,var(--card2),transparent);font-size:11px}.x97-deal-card-meta b{color:var(--tx)}.x97-deal-card-meta span{color:var(--tx3);font-size:10px;text-align:right}.x97-deal-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.x97-deal-metric-card{padding:14px 15px;position:relative;overflow:hidden}.x97-deal-metric-card::after{content:'';position:absolute;width:72px;height:72px;border-radius:50%;right:-28px;top:-28px;background:var(--posdim)}.x97-deal-metric-currency{font-size:10px;font-weight:900;letter-spacing:.1em;color:var(--pos)}.x97-deal-metric-main{font-size:25px;font-weight:900;letter-spacing:-.03em;margin-top:6px}.x97-deal-metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;border-top:1px solid var(--line);margin-top:10px;padding-top:9px}.x97-deal-metric-grid span{font-size:9.5px;color:var(--tx3);line-height:1.3}.x97-deal-metric-grid b{display:block;font-size:12px;color:var(--tx);margin-bottom:2px}.x97-deal-lock-note{margin-top:10px;padding:10px 11px;border-radius:11px;background:var(--warndim);color:var(--warn);font-size:11px;line-height:1.45}.x97-deals-overview{margin-top:16px}" +
      "@media(max-width:560px){.x97-deal-metrics{grid-template-columns:1fr}.x97-deal-card-meta{align-items:flex-start;flex-direction:column}.x97-deal-card-meta span{text-align:left}.x97-deal-glance{gap:5px}.x97-deal-glance>div{padding:8px 7px}.x97-deal-glance b{font-size:10.5px}.x97-deal-steps{margin-left:-2px;margin-right:-2px}}" +
      // Documents
      ".x97-doc-preview{border:1px solid var(--line);border-radius:13px;padding:14px;background:var(--card2);font-size:12.5px;line-height:1.6;color:var(--tx);white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto}" +
      ".x97-doc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}.x97-doc-actions .x97-btn{flex:1;min-width:130px}" +
      "@media(max-width:560px){.x97-earn-value{font-size:25px}.x97-earn-chart{height:84px}.x97-earn-row{grid-template-columns:minmax(0,1.1fr) repeat(3,minmax(0,1fr));gap:6px;padding:9px 10px}.x97-earn-row-num{font-size:11px}.x97-fx-value{font-size:25px}.x97-fx-ticks{grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.x97-fx-leg-row{grid-template-columns:1fr}.x97-fx-amount{text-align:left}.x97-fx-result{justify-content:flex-start}}";
    document.head.appendChild(style);
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
      expand: '<path d="m7 9 5-5 5 5"></path><path d="m7 15 5 5 5-5"></path>'
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
      body.x97-v2-mode{overflow-x:visible}
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

  function injectProCSS() {
    if (document.getElementById("x97-pro-css")) return;
    var style = document.createElement("style");
    style.id = "x97-pro-css";
    style.textContent = `
      /* 97 LIVE command-centre pass: calmer hierarchy, stronger actions, less repetition. */
      body.x97-v2-mode .wrap{background:var(--bg)!important}
      body.x97-v2-mode .nav{background:rgba(251,251,248,.9);backdrop-filter:blur(22px) saturate(1.35);box-shadow:0 -14px 38px -24px rgba(23,27,18,.35);border-top-color:var(--line2)}
      body.x97-v2-mode .navin{padding:0 8px}
      body.x97-v2-mode .navitem{min-height:67px;padding-top:9px;font-size:9px;letter-spacing:.01em}
      body.x97-v2-mode .navitem.on svg{box-shadow:0 8px 19px -8px rgba(11,103,64,.72),inset 0 1px 0 rgba(255,255,255,.28)}
      #x97-v2-root{background:radial-gradient(70% 25% at 50% 0%,rgba(14,117,72,.075),transparent 75%),var(--bg)}
      .x97-top{align-items:center;margin:8px 0 24px;padding:0 2px}
      .x97-top-copy{min-width:0}
      .x97-top-actions{display:flex;align-items:center;gap:8px;flex:none}
      .x97-title{font-size:clamp(28px,4.2vw,39px);letter-spacing:-.055em;line-height:.98}
      .x97-sub{max-width:56ch;margin-top:9px;color:var(--tx3);font-size:12.5px}
      .x97-eyebrow{margin-bottom:10px;font-size:9.5px;letter-spacing:.2em}
      .x97-cloud{border-color:var(--line2);background:rgba(255,255,255,.7);box-shadow:var(--toplit),var(--elev-1);min-height:36px}
      .x97-card{border-radius:20px;box-shadow:var(--toplit),0 1px 2px rgba(23,27,18,.04),0 16px 35px -24px rgba(23,27,18,.26)}
      .x97-section{margin-top:25px}
      .x97-section-head{margin:0 1px 10px;align-items:center}
      .x97-section-title{font-size:10px;letter-spacing:.16em;color:var(--tx2)}
      .x97-section-title::before{width:4px;height:13px}
      .x97-link{min-height:32px;padding:6px 10px;background:transparent;box-shadow:none;border-color:var(--line2);font-size:10.5px}
      .x97-link:hover{background:var(--posdim)}
      .x97-hero-command{min-height:252px;padding:25px 25px 23px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(145deg,#FFFFFF 0%,#F7FBF8 46%,#EAF5EF 100%)}
      .x97-hero-command::before{height:4px;background:linear-gradient(90deg,var(--pos2),#36B878 50%,transparent)}
      .x97-hero-command::after{width:350px;height:350px;right:-180px;top:-200px;background:radial-gradient(circle,rgba(14,117,72,.17),transparent 68%)}
      .x97-hero-topline{display:flex;align-items:center;justify-content:space-between;gap:10px;position:relative;z-index:1}
      .x97-hero-live{font-size:9px;text-transform:uppercase;letter-spacing:.09em;color:var(--pos);font-weight:850;display:inline-flex;align-items:center;gap:5px}
      .x97-hero-live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--pos);box-shadow:0 0 0 4px var(--posdim)}
      .x97-hero-value{font-size:clamp(39px,7vw,64px);margin:19px 0 6px;letter-spacing:-.055em}
      .x97-hero-caption{position:relative;z-index:1;color:var(--tx3);font-size:11px;line-height:1.45;max-width:36ch}
      .x97-hero-meta{margin-top:20px;gap:9px}
      .x97-stat{padding:11px 12px;border-radius:13px;background:rgba(255,255,255,.68)}
      .x97-stat span{font-size:8.5px;letter-spacing:.1em;margin-bottom:5px}
      .x97-stat b{font-size:14px}
      .x97-command-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:0}
      .x97-command-action{min-width:0;display:flex;align-items:center;gap:9px;text-align:left;padding:12px 12px;border:1px solid var(--line);border-radius:15px;background:rgba(255,255,255,.62);color:var(--tx);box-shadow:var(--toplit);transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease}
      .x97-command-action:hover{background:var(--card);border-color:var(--line2);box-shadow:var(--toplit),var(--elev-1);transform:translateY(-2px)}
      .x97-command-action:active{transform:scale(.98)}
      .x97-command-action>span:nth-child(2){min-width:0;flex:1}
      .x97-command-action b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11.5px;font-weight:850}
      .x97-command-action small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;color:var(--tx3);font-size:9.5px}
      .x97-command-action>svg{color:var(--tx3);flex:none}
      .x97-command-icon{width:31px;height:31px;border-radius:10px;display:grid;place-items:center;flex:none;background:var(--posdim);color:var(--pos)}
      .x97-command-icon.teal{background:var(--usddim);color:var(--usd)}
      .x97-command-icon.warn{background:var(--warndim);color:var(--warn)}
      .x97-command-action.primary{background:var(--pos);border-color:var(--pos);color:var(--onpos);box-shadow:0 10px 25px -18px var(--pos2)}
      .x97-command-action.primary small,.x97-command-action.primary>svg{color:rgba(255,255,255,.72)}
      .x97-command-action.primary .x97-command-icon{background:rgba(255,255,255,.16);color:#fff}
      .x97-glance-section{margin-top:4px}
      .x97-summary-grid{gap:9px}
      .x97-summary{min-height:102px;padding:14px 14px;background:linear-gradient(150deg,var(--card),var(--bg2))}
      .x97-summary .k{font-size:8.5px;letter-spacing:.11em}
      .x97-summary .v{font-size:23px;margin-top:12px}
      .x97-summary .s{font-size:9.5px;margin-top:6px}
      .x97-deals-overview{margin-top:4px}
      .x97-deals-overview .x97-section-head{align-items:flex-end}
      .x97-deals-overview .x97-row-sub{font-size:10.5px;margin-top:5px}
      .x97-deal-metric-card{border-radius:17px;background:linear-gradient(145deg,var(--card),var(--bg2));padding:16px}
      .x97-deal-metric-main{font-size:27px}
      .x97-deal-metrics{gap:9px}
      .x97-item{padding:17px 17px;margin-bottom:10px;border-radius:19px}
      .x97-item-title{font-size:15px;letter-spacing:-.02em}
      .x97-item-category{font-size:8.5px;letter-spacing:.12em}
      .x97-item-amount{font-size:19px}
      .x97-item-foot{margin-top:14px}
      .x97-group{margin-top:23px;margin-bottom:10px}
      .x97-group b{font-size:9.5px;letter-spacing:.14em}
      .x97-group span{font-size:9.5px}
      .x97-segment{margin-bottom:15px;border-radius:16px;padding:4px;background:rgba(255,255,255,.56)}
      .x97-segment button{min-height:40px;font-size:11.5px}
      .x97-tools{margin-bottom:9px}
      .x97-search input,.x97-icon-btn{height:46px;border-radius:14px}
      .x97-chip{height:33px;font-size:10.5px;padding:0 11px}
      .x97-secondary-module{opacity:.96}
      .x97-secondary-module .x97-section-title{color:var(--tx3)}
      .x97-secondary-module .x97-card{box-shadow:var(--toplit),0 1px 2px rgba(23,27,18,.03)}
      .x97-fab{width:58px;height:58px;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 16px 30px -10px rgba(11,103,64,.7)}
      .x97-fab::after{opacity:.7}
      .x97-back{background:rgba(18,23,17,.48);backdrop-filter:blur(10px) saturate(1.12)}
      .x97-sheet{border-radius:28px 28px 0 0;border-color:var(--line2);box-shadow:0 -30px 80px rgba(23,27,18,.29)}
      .x97-sheet-head{padding:13px 20px 15px}
      .x97-sheet-head h2{font-size:19px;letter-spacing:-.035em}
      .x97-sheet-body{padding:20px}
      .x97-sheet-foot{padding:13px 20px calc(16px + env(safe-area-inset-bottom));background:rgba(251,251,248,.97)}
      .x97-field{margin-bottom:16px}
      .x97-field label{font-size:9.5px;letter-spacing:.1em}
      .x97-input,.x97-select,.x97-textarea{min-height:46px;border-radius:14px;font-size:13.5px}
      .x97-btn{min-height:44px;border-radius:14px}
      .x97-deal-mode-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:0 0 15px}
      .x97-deal-mode{min-width:0;min-height:66px;padding:9px 8px;text-align:left;border:1px solid var(--line);border-radius:13px;background:var(--card2);color:var(--tx2);cursor:pointer;transition:background .15s,border-color .15s,transform .15s}
      .x97-deal-mode:hover{border-color:var(--line2);transform:translateY(-1px)}.x97-deal-mode.on{background:var(--posdim);border-color:var(--pos);color:var(--pos);box-shadow:var(--ring)}
      .x97-deal-mode b{display:block;font-size:10.5px;line-height:1.2}.x97-deal-mode span{display:block;margin-top:5px;color:var(--tx3);font-size:9px;line-height:1.25}.x97-deal-mode.on span{color:var(--pos)}
      .x97-custom-editor{display:none;margin:3px 0 14px}.x97-custom-editor:has([name^=partAmount_]){display:block}.x97-custom-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:5px 0 8px}.x97-custom-editor-head b{display:block;font-size:12px;color:var(--tx)}.x97-custom-editor-head span:not(.x97-pill){display:block;color:var(--tx3);font-size:10px;margin-top:3px}
      .x97-custom-row{display:flex;gap:8px;padding:9px 0;border-top:1px solid var(--line);align-items:flex-start}.x97-custom-index{width:24px;height:24px;display:grid;place-items:center;border-radius:50%;background:var(--card2);border:1px solid var(--line2);font-size:10px;font-weight:850;color:var(--tx2);flex:none;margin-top:4px}.x97-custom-fields{flex:1;min-width:0}.x97-custom-fields .x97-input{min-height:40px;font-size:12px;margin-bottom:7px}.x97-custom-fields .x97-fields-2{gap:7px}.x97-custom-fields .x97-fields-2 .x97-input{margin-bottom:0}.x97-single-preview{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px;border:1px solid var(--line);border-radius:14px;background:var(--card);font-size:11.5px;color:var(--tx2)}.x97-single-preview strong{font-size:15px;color:var(--pos)}
      .x97-item-next{margin-top:5px;color:var(--tx3);font-size:10.5px}.x97-payment-target-list{border:1px solid var(--line);border-radius:13px;overflow:hidden;background:var(--card)}.x97-payment-target-row{display:flex;align-items:center;gap:8px;padding:9px 10px;border-top:1px solid var(--line)}.x97-payment-target-row:first-child{border-top:0}.x97-payment-target-row>span:nth-child(2){min-width:0;flex:1}.x97-payment-target-row b{display:block;font-size:11px;color:var(--tx)}.x97-payment-target-row small{display:block;margin-top:3px;font-size:9.5px;color:var(--tx3)}.x97-payment-target-row>strong{font-size:10.5px;color:var(--tx2);white-space:nowrap}.x97-deal-mark.good{background:var(--posdim);color:var(--pos);border-color:transparent}.x97-payment-hero{background:linear-gradient(145deg,var(--card),var(--posdim));border-color:rgba(14,117,72,.16)}
      @media(max-width:620px){.x97-deal-mode-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.x97-deal-mode{min-height:60px}.x97-custom-editor-head{align-items:flex-start;flex-direction:column;gap:5px}}
      @media(min-width:760px){
        #x97-v2-root{padding:34px 30px 124px}
        .x97-dashboard-main{grid-template-columns:minmax(0,1.04fr) minmax(330px,.96fr);gap:20px}
        .x97-command-actions{grid-column:1/-1}
        .x97-hero-command{min-height:278px}
        .x97-top{margin-bottom:30px}
        .x97-sheet-foot{border-radius:0 0 28px 28px}
      }
      @media(min-width:1040px){
        #x97-v2-root{padding-left:40px;padding-right:40px}
        .x97-page{max-width:1120px}
        .x97-title{font-size:42px}
      }
      @media(max-width:620px){
        .x97-command-actions{grid-template-columns:1fr;gap:7px}
        .x97-command-action{padding:11px 12px}
        .x97-command-action small{font-size:9px}
        .x97-top{align-items:flex-start;margin-bottom:20px}
        .x97-top-actions{gap:5px}
        .x97-cloud{min-width:36px;padding-left:10px;padding-right:10px}
        .x97-hero-command{min-height:230px;padding:21px 18px 19px}
        .x97-hero-value{font-size:clamp(38px,11vw,48px)}
        .x97-hero-caption{font-size:10.5px}
      }
      @media(max-width:420px){
        #x97-v2-root{padding-left:12px;padding-right:12px}
        .x97-title{font-size:27px}
        .x97-sub{font-size:11.5px}
        .x97-summary{padding:12px 11px;min-height:94px}
        .x97-summary .v{font-size:20px}
        .x97-deal-metric-card{padding:13px}
      }
      @media(prefers-reduced-motion:reduce){
        .x97-card,.x97-command-action,.x97-fab,.x97-page{transition:none!important;animation:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function injectRevampCSS() {
    if (document.getElementById("x97-revamp-css")) return;
    var style = document.createElement("style");
    style.id = "x97-revamp-css";
    style.textContent = `
      :root{
        --bg:#F1F5F1;--bg2:#FBFCFA;--card:#FFFFFF;--card2:#EEF3EF;--card3:#DEE8E0;
        --line:rgba(17,35,27,.09);--line2:rgba(17,35,27,.17);
        --tx:#10231B;--tx2:#4F6258;--tx3:#697A70;
        --pos:#0D8053;--pos2:#075D3D;--posdim:rgba(13,128,83,.11);
        --usd:#126A82;--usddim:rgba(18,106,130,.10);
        --warn:#A76508;--warndim:rgba(167,101,8,.12);
        --neg:#BC3E45;--negdim:rgba(188,62,69,.10);
        --lime:#D9FF66;--forest:#062D21;
        --fu:'Geist Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --fd:'Geist Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --fnum:'Geist Mono','SFMono-Regular',Consolas,monospace;
        --elev-1:0 1px 2px rgba(10,35,24,.04),0 14px 34px -23px rgba(6,45,33,.25);
        --elev-2:0 3px 8px rgba(10,35,24,.06),0 24px 50px -25px rgba(6,45,33,.32);
      }
      html,body,.app,input,select,button,textarea{font-family:var(--fu)}
      .tabnum,.x97-money{font-family:var(--fnum)!important;font-weight:500!important;letter-spacing:-.055em!important}
      body::before{opacity:.72}
      .nav{background:rgba(6,45,33,.96)!important;border-top-color:rgba(217,255,102,.12)!important;box-shadow:0 -16px 42px -24px rgba(6,45,33,.82)!important;backdrop-filter:blur(24px) saturate(1.25)!important}
      .navitem{color:rgba(255,255,255,.58)!important}
      .navitem.on{color:var(--lime)!important}
      .navitem svg{color:inherit!important}
      .navitem.on svg{background:var(--lime)!important;color:var(--forest)!important;box-shadow:0 8px 22px -8px rgba(217,255,102,.55)!important}
      #x97-v2-root{background:
        radial-gradient(80% 28% at 50% -4%,rgba(13,128,83,.10),transparent 72%),
        linear-gradient(180deg,var(--bg2) 0%,var(--bg) 34%,var(--bg) 100%)}
      .x97-page>.x97-top{animation:x97-rise .38s cubic-bezier(.2,.82,.25,1) both}
      .x97-page>.x97-dashboard-main,.x97-page>.x97-collection-command,.x97-page>.x97-segment{animation:x97-rise .48s .05s cubic-bezier(.2,.82,.25,1) both}
      .x97-group,.x97-item,.x97-month-card{animation:x97-rise .38s cubic-bezier(.2,.82,.25,1) both}
      .x97-item:nth-of-type(2),.x97-month-card:nth-of-type(2){animation-delay:35ms}
      .x97-item:nth-of-type(3),.x97-month-card:nth-of-type(3){animation-delay:70ms}
      .x97-item:nth-of-type(4),.x97-month-card:nth-of-type(4){animation-delay:105ms}
      @keyframes x97-rise{from{opacity:0;transform:translateY(13px) scale(.992)}to{opacity:1;transform:none}}
      .x97-title{font-weight:800;letter-spacing:-.065em}
      .x97-eyebrow{color:var(--pos2);font-family:var(--fnum);font-weight:500;letter-spacing:.13em}
      .x97-cloud{font-family:var(--fnum);font-size:9.5px;letter-spacing:-.02em}
      .x97-add-primary{background:var(--forest);border-color:var(--forest);color:var(--lime);padding:0 14px;box-shadow:0 10px 22px -13px rgba(6,45,33,.72)}
      .x97-add-primary:hover{background:#08402F}
      .x97-card{border-radius:19px}
      .x97-hero-command{background:linear-gradient(138deg,#0A4A35 0%,var(--forest) 58%,#041D16 100%);border-color:rgba(217,255,102,.10);box-shadow:0 24px 48px -25px rgba(6,45,33,.78);color:#fff}
      .x97-hero-command::before{background:linear-gradient(90deg,var(--lime),#69D78D 48%,transparent)}
      .x97-hero-command::after{right:-145px;top:-175px;background:radial-gradient(circle,rgba(217,255,102,.19),transparent 66%)}
      .x97-hero-command .x97-hero-label{background:rgba(217,255,102,.12);color:var(--lime)}
      .x97-hero-command .x97-hero-label::before{background:var(--lime)}
      .x97-hero-command .x97-hero-live{color:var(--lime)}
      .x97-hero-command .x97-hero-live::before{background:var(--lime);box-shadow:0 0 0 4px rgba(217,255,102,.12)}
      .x97-hero-command .x97-hero-value{color:#fff;text-shadow:0 12px 34px rgba(0,0,0,.16)}
      .x97-hero-command .x97-hero-caption{color:rgba(255,255,255,.62)}
      .x97-hero-command .x97-stat{background:rgba(255,255,255,.075);border-color:rgba(255,255,255,.12);box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
      .x97-hero-command .x97-stat span{color:rgba(255,255,255,.50)}
      .x97-hero-command .x97-stat b{color:#fff}
      .x97-command-action.primary{background:var(--forest);border-color:var(--forest);color:#fff}
      .x97-command-action.primary .x97-command-icon{background:var(--lime);color:var(--forest)}
      .x97-summary .v,.x97-deal-metric-main,.x97-earn-value,.x97-fx-value{font-family:var(--fnum);font-weight:500;letter-spacing:-.065em}
      .x97-progress i,.x97-pay-bar i{transform-origin:left;animation:x97-fill .72s cubic-bezier(.2,.9,.25,1) both}
      @keyframes x97-fill{from{transform:scaleX(.04)}to{transform:scaleX(1)}}

      .x97-collection-command{position:relative;overflow:hidden;margin-bottom:14px;padding:22px;border-radius:24px;background:linear-gradient(135deg,#0A4B35 0%,var(--forest) 60%,#041F17 100%);color:#fff;box-shadow:0 24px 48px -26px rgba(6,45,33,.82)}
      .x97-collection-command::before{content:"";position:absolute;inset:0;background:
        linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px),
        linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px);
        background-size:23px 23px;mask-image:linear-gradient(90deg,#000,transparent 92%);animation:x97-grid-move 22s linear infinite}
      .x97-collection-command::after{content:"";position:absolute;width:250px;height:250px;border:1px solid rgba(217,255,102,.28);border-radius:50%;right:-118px;top:-142px;box-shadow:0 0 0 29px rgba(217,255,102,.025),0 0 0 58px rgba(217,255,102,.018)}
      @keyframes x97-grid-move{to{background-position:23px 23px}}
      .x97-collection-command>*{position:relative;z-index:1}
      .x97-collection-command-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .x97-collection-kicker{font-family:var(--fnum);font-size:9px;text-transform:uppercase;letter-spacing:.11em;color:rgba(255,255,255,.52)}
      .x97-collection-total{margin-top:8px;font-size:clamp(31px,7vw,48px);line-height:1;color:#fff}
      .x97-collection-usd{margin-top:8px;font-size:15px;color:var(--lime)}
      .x97-collection-signal{display:flex;align-items:center;gap:7px;color:var(--lime);font-family:var(--fnum);font-size:8.5px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap}
      .x97-collection-signal i{width:6px;height:6px;border-radius:50%;background:var(--lime);animation:x97-signal 1.9s ease-in-out infinite}
      @keyframes x97-signal{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(217,255,102,.34)}50%{opacity:.55;box-shadow:0 0 0 7px rgba(217,255,102,0)}}
      .x97-collection-command>p{max-width:52ch;margin:16px 0 15px;color:rgba(255,255,255,.66);font-size:11.5px;line-height:1.5}
      .x97-collection-focus{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .x97-collection-focus button{min-width:0;padding:11px 10px;border:1px solid rgba(255,255,255,.11);border-radius:14px;background:rgba(255,255,255,.065);color:#fff;text-align:left;transition:transform .18s ease,background .18s ease,border-color .18s ease}
      .x97-collection-focus button:hover{transform:translateY(-2px);background:rgba(255,255,255,.11)}
      .x97-collection-focus button:active{transform:scale(.97)}
      .x97-collection-focus button.on{background:var(--lime);border-color:var(--lime);color:var(--forest);box-shadow:0 9px 22px -12px rgba(217,255,102,.7)}
      .x97-collection-focus small,.x97-collection-focus b,.x97-collection-focus span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .x97-collection-focus small{font-family:var(--fnum);font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.50)}
      .x97-collection-focus button.on small{color:rgba(6,45,33,.62)}
      .x97-collection-focus b{margin-top:6px;font-family:var(--fnum);font-size:20px;font-weight:500}
      .x97-collection-focus span{margin-top:4px;font-size:8.5px;color:rgba(255,255,255,.55)}
      .x97-collection-focus button.on span{color:rgba(6,45,33,.66)}
      .x97-core-filters{margin-bottom:2px}
      .x97-core-filters .x97-chip.on{background:var(--forest);border-color:var(--forest);color:var(--lime);box-shadow:0 7px 16px -12px rgba(6,45,33,.68)}
      .x97-count b{color:var(--tx);font-family:var(--fnum);font-weight:500}

      .x97-collection-card{overflow:hidden;border-left:3px solid transparent}
      .x97-collection-card.is-overdue,.x97-collection-card.is-today{border-left-color:var(--neg)}
      .x97-collection-card.is-very-soon,.x97-collection-card.is-soon,.x97-collection-card.is-unscheduled{border-left-color:var(--warn)}
      .x97-collection-card.is-paid{border-left-color:var(--pos)}
      .x97-item-amount{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
      .x97-item-amount small{font-family:var(--fu);font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:800}
      .x97-collection-progress{height:5px;margin:14px 0 12px;border-radius:99px;background:var(--card3);overflow:hidden}
      .x97-collection-progress i{display:block;width:var(--progress);height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--pos2),#51C57C);transform-origin:left;animation:x97-fill .68s cubic-bezier(.2,.9,.25,1) both}
      .x97-collection-next{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:13px;background:var(--card2);border:1px solid transparent}
      .x97-collection-next.settled{background:var(--posdim)}
      .x97-collection-next-icon{width:32px;height:32px;display:grid;place-items:center;flex:none;border-radius:10px;background:var(--card);color:var(--tx2);box-shadow:0 1px 2px rgba(6,45,33,.06)}
      .x97-collection-next-icon.bad{background:var(--negdim);color:var(--neg)}
      .x97-collection-next-icon.warn{background:var(--warndim);color:var(--warn)}
      .x97-collection-next-icon.good{background:var(--pos);color:#fff}
      .x97-collection-next-copy{min-width:0;flex:1}
      .x97-collection-next-copy small,.x97-collection-next-copy b,.x97-collection-next-copy em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .x97-collection-next-copy small{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:var(--tx3);font-weight:850}
      .x97-collection-next-copy b{margin-top:3px;font-size:11.5px;color:var(--tx)}
      .x97-collection-next-copy em{margin-top:2px;font-size:9.5px;color:var(--tx3);font-style:normal}
      .x97-collection-actions{display:flex;gap:7px;margin-top:11px}
      .x97-card-action{min-height:36px;padding:0 11px;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--tx2);display:inline-flex;align-items:center;justify-content:center;gap:6px;font-size:10px;font-weight:800;transition:transform .16s ease,box-shadow .18s ease,background .18s ease}
      .x97-card-action:hover{box-shadow:var(--elev-1);transform:translateY(-1px)}
      .x97-card-action:active{transform:scale(.97)}
      .x97-card-action.primary{flex:1;background:var(--forest);border-color:var(--forest);color:#fff}
      .x97-card-action.whatsapp{background:#DDF8E6;border-color:#BDE9CA;color:#087A3F}
      .x97-card-action.quiet{margin-left:auto;background:transparent}
      .x97-card-action.full{width:100%;margin-left:0}
      body>.x97-fab.x97-fab-viewport{position:fixed!important;right:max(16px,calc(50% - 488px))!important;bottom:calc(78px + env(safe-area-inset-bottom))!important;margin:0!important;z-index:58!important;display:grid!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;transform:translateZ(0)!important}
      body.x97-fab-sheet-open>.x97-fab.x97-fab-viewport{visibility:hidden!important;opacity:0!important;pointer-events:none!important}
      .x97-sheet{background:var(--bg2)}
      .x97-sheet-head h2{font-weight:800;letter-spacing:-.045em}
      .x97-deal-mode.on{background:var(--forest);border-color:var(--forest);color:var(--lime);box-shadow:0 9px 20px -14px rgba(6,45,33,.72)}
      .x97-deal-mode.on span{color:rgba(255,255,255,.62)}

      @media(max-width:620px){
        .x97-add-primary span{display:none}
        .x97-add-primary{width:42px;padding:0}
        body>.x97-fab.x97-fab-viewport{right:14px!important;bottom:calc(76px + env(safe-area-inset-bottom))!important;width:52px!important;height:52px!important}
        .x97-collection-command{padding:19px 16px;border-radius:21px}
        .x97-collection-signal span{display:none}
        .x97-collection-focus{gap:6px}
        .x97-collection-focus button{padding:10px 8px}
        .x97-collection-focus span{font-size:8px}
        .x97-core-filters{flex-wrap:wrap;overflow:visible;padding-bottom:6px}
        .x97-item-amount{font-size:16px;max-width:42%}
        .x97-collection-actions{display:grid;grid-template-columns:1.25fr 1fr}
        .x97-card-action.quiet{grid-column:1/-1;margin-left:0}
        .x97-card-action.full{grid-column:1/-1}
      }
      @media(max-width:380px){
        .x97-collection-focus span{display:none}
        .x97-collection-focus b{font-size:18px}
        .x97-collection-total{font-size:29px}
      }
      @media(prefers-reduced-motion:reduce){
        .x97-page>*,.x97-group,.x97-item,.x97-month-card,.x97-collection-progress i,.x97-progress i,.x97-pay-bar i,.x97-collection-command::before,.x97-collection-signal i{animation:none!important}
      }
    `;
    document.head.appendChild(style);
  }

  function injectV2CSS() {
    if (document.getElementById("x97-v4-css")) return;
    var style = document.createElement("style");
    style.id = "x97-v4-css";
    style.textContent = `
      /* V2 Premium: one type scale, intentional motion and mobile-safe financial layouts. */
      :root{
        --fu:'Geist Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --fd:'Geist Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        --fnum:'IBM Plex Mono','SFMono-Regular',Consolas,monospace;
        --x97-nav-h:67px;
        --x97-motion-fast:160ms;
        --x97-motion-base:260ms;
        --x97-ease-out:cubic-bezier(.2,.82,.25,1);
      }
      html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
      html,body{min-width:0}
      html,body,.app,input,select,button,textarea{font-family:var(--fu)}
      .tabnum,.x97-money{font-family:var(--fnum)!important;font-weight:500!important;letter-spacing:-.04em!important}
      .x97-title,.x97-sheet-head h2,.x97-rm-title,.s97-cloud-brand{font-family:var(--fd);font-weight:700;letter-spacing:-.045em}

      /* Let a bad child expose itself while its flex/grid parent is constrained; do not hide data. */
      body.x97-v2-mode{overflow-x:visible}
      #x97-v2-root{min-width:0;padding-bottom:calc(164px + env(safe-area-inset-bottom))}
      #x97-v2-root .x97-page,#x97-v2-root .x97-page>*,#x97-v2-root .x97-dashboard-main,
      #x97-v2-root .x97-card,#x97-v2-root .x97-row,#x97-v2-root .x97-item-top,
      #x97-v2-root .x97-item-main,#x97-v2-root .x97-facility-head,#x97-v2-root .x97-facility-main,
      #x97-v2-root .x97-payment-target-row,#x97-v2-root .x97-tl-body{min-width:0}
      #x97-v2-root button,.navitem,.btn,.press,.x97-btn,.x97-link,.x97-icon-btn,.x97-fab,.fab{touch-action:manipulation}
      :focus-visible{outline:3px solid rgba(13,128,83,.58);outline-offset:3px}

      /* A single bottom-nav token keeps the composer, floating action and content clear of each other. */
      .nav{min-height:var(--x97-nav-h)}
      .navitem{min-height:var(--x97-nav-h)}
      .composer{bottom:calc(var(--x97-nav-h) + env(safe-area-inset-bottom))}
      .fab,.x97-fab,.s97-cloud-fab{bottom:calc(var(--x97-nav-h) + 12px + env(safe-area-inset-bottom))}
      .x97-toast-wrap{bottom:calc(var(--x97-nav-h) + 74px + env(safe-area-inset-bottom))}

      /* Sheets stay inside the visible viewport when browser chrome or the keyboard changes height. */
      body.x97-sheet-open{position:fixed;left:0;top:var(--x97-sheet-scroll-y,0px);width:100%;overflow:hidden;overscroll-behavior:none}
      .x97-back,.backdrop,.x97-remind-overlay,.s97-cloud-back{overscroll-behavior:contain}
      .x97-back{padding-top:env(safe-area-inset-top);touch-action:none}
      .x97-sheet,.sheet,.x97-remind-panel,.s97-cloud-modal{
        min-height:0;max-height:calc(100vh - env(safe-area-inset-top));
        max-height:calc(100svh - env(safe-area-inset-top));max-height:calc(100dvh - env(safe-area-inset-top));
      }
      .x97-sheet{touch-action:pan-y}
      .x97-sheet-body,.x97-rm-list{min-height:0;flex:1 1 auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      .x97-sheet-foot{flex:0 0 auto}
      .x97-remind-overlay{padding-top:env(safe-area-inset-top);touch-action:none}
      .x97-remind-panel{touch-action:pan-y}

      /* Motion is composited only. Backwards fill avoids leaving a transformed parent around fixed UI. */
      @keyframes x97-v4-reveal{from{opacity:0;transform:translate3d(0,10px,0)}to{opacity:1;transform:none}}
      @keyframes x97-v4-fill{from{transform:scaleX(.03)}to{transform:scaleX(1)}}
      #x97-v2-root .x97-page>:not(.x97-fab){animation:x97-v4-reveal var(--x97-motion-base) var(--x97-ease-out) backwards}
      #x97-v2-root .x97-page>:not(.x97-fab):nth-child(2){animation-delay:35ms}
      #x97-v2-root .x97-page>:not(.x97-fab):nth-child(3){animation-delay:70ms}
      #x97-v2-root .x97-page>:not(.x97-fab):nth-child(4){animation-delay:105ms}
      .x97-progress i,.x97-pay-bar i,.x97-collection-progress i{transform-origin:left;animation:x97-v4-fill .56s var(--x97-ease-out) backwards}
      .x97-card,.x97-item,.x97-month-card,.x97-command-action,.x97-btn,.x97-link,.x97-icon-btn,.x97-chip,.x97-deal-mode,.x97-fab{
        transition:transform var(--x97-motion-fast) var(--x97-ease-out),border-color var(--x97-motion-fast) ease,background-color var(--x97-motion-fast) ease,box-shadow var(--x97-motion-base) ease,color var(--x97-motion-fast) ease;
      }
      @media(hover:hover){
        .x97-card.x97-item:hover,.x97-item:hover,.x97-month-card:hover{transform:translateY(-2px)}
        .x97-btn:hover,.x97-link:hover,.x97-icon-btn:hover,.x97-chip:hover{transform:translateY(-1px)}
      }
      .x97-btn:active,.x97-link:active,.x97-icon-btn:active,.x97-chip:active,.x97-deal-mode:active{transform:scale(.975)}

      /* Phone layout: readable inputs, reliable targets and no clipped money. */
      @media(max-width:759px){
        .x97-input,.x97-select,.x97-textarea,.inp,.cinput,.s97-cloud-input{font-size:16px!important;line-height:1.35}
        .x97-input,.x97-select,.inp,.cinput,.s97-cloud-input{min-height:48px!important}
        .x97-textarea{min-height:112px}
        .x97-search input{height:48px;font-size:16px!important}
        .x97-icon-btn{height:48px;min-width:48px}
        .x97-btn,.btn,.s97-cloud-btn{min-height:46px}
        .s97-cloud-gate{min-height:100vh!important;min-height:100dvh!important;align-items:flex-start!important;overflow-y:auto!important;padding:max(16px,env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom))!important}
        .s97-cloud-gate .s97-cloud-card{width:min(100%,480px);margin:auto;padding:24px 18px 20px}
        .s97-cloud-gate .s97-cloud-actions{display:grid;grid-template-columns:1fr}
        .x97-collection-focus{grid-template-columns:repeat(2,minmax(0,1fr))}
        .x97-camp-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}
      }
      @media(max-width:480px){
        .x97-top{gap:10px}.x97-top-actions{gap:5px}.x97-cloud{max-width:42vw;overflow:hidden;text-overflow:ellipsis}
        .x97-earn-row.head{display:none}
        .x97-earn-row:not(.head){grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;padding:11px 12px;margin-bottom:8px;border:1px solid var(--line);border-radius:13px;background:var(--card)}
        .x97-earn-row-mon{grid-column:1/-1;overflow:visible;text-overflow:clip;font-size:12px}
        .x97-earn-row-num{display:flex;align-items:baseline;justify-content:space-between;gap:6px;overflow:visible;text-overflow:clip;font-size:12px;text-align:left}
        .x97-earn-row-num::before{font-family:var(--fu);font-size:9px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3)}
        .x97-earn-row-num:nth-child(2)::before{content:"In"}.x97-earn-row-num:nth-child(3)::before{content:"Out"}.x97-earn-row-num:nth-child(4)::before{content:"Kept"}
      }
      @media(max-width:420px){
        #x97-v2-root{padding-left:12px;padding-right:12px}
        .x97-fields-2{grid-template-columns:minmax(0,1fr)}
        #root div[style*="grid-template-columns"][style*="1fr 1fr 1fr"]{grid-template-columns:minmax(0,1fr)!important}
        .x97-row,.x97-item-top,.x97-facility-head,.x97-loan-head,.x97-payment-target-row{align-items:flex-start;flex-wrap:wrap}
        .x97-row-value,.x97-item-amount,.x97-facility-limit,.x97-payment-target-row>strong{white-space:normal;overflow:visible;overflow-wrap:anywhere;word-break:normal;max-width:52%;line-height:1.28}
        .x97-row-value,.x97-item-amount,.x97-facility-limit{margin-left:auto;text-align:right}
        .x97-tl-row{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:start;gap:10px}
        .x97-tl-amt{grid-column:2;white-space:normal;overflow-wrap:anywhere;text-align:left}
      }
      @media(max-width:380px){
        .x97-summary-grid,.x97-collection-focus,.x97-deal-mode-grid{grid-template-columns:minmax(0,1fr)}
        .x97-earn-row:not(.head){grid-template-columns:minmax(0,1fr)}
        .x97-item-amount,.x97-facility-limit,.x97-row-value,.x97-payment-target-row>strong{max-width:100%;margin-left:50px;text-align:left}
        .x97-command-action b,.x97-command-action small{white-space:normal;overflow:visible;text-overflow:clip}
      }
      @media(orientation:landscape) and (max-height:560px){
        .x97-sheet,.sheet,.x97-remind-panel{max-height:100dvh;border-radius:18px 18px 0 0}
        .x97-sheet-head{padding-top:8px;padding-bottom:9px}.x97-sheet-body{padding-top:12px;padding-bottom:12px}
      }
      @media(min-width:760px){.x97-remind-overlay{padding:24px}}
      @media(prefers-reduced-motion:reduce){
        *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}
      }

      /* Visual QA guardrail — the runtime UI is assembled from several feature
         modules. These final tokens prevent a light surface from ever pairing
         with dark-theme text, and keep the header, sheets and form controls
         readable in either colour mode. */
      html:not([data-v2-theme="dark"]){
        --bg:#F1F5F1;--bg2:#FBFCFA;--card:#FFFFFF;--card2:#EEF3EF;--card3:#DEE8E0;
        --line:rgba(17,35,27,.09);--line2:rgba(17,35,27,.17);
        --tx:#10231B;--tx2:#4F6258;--tx3:#697A70;
        --pos:#0D8053;--pos2:#075D3D;--posdim:rgba(13,128,83,.11);
        --usd:#126A82;--usddim:rgba(18,106,130,.10);
        --warn:#A76508;--warndim:rgba(167,101,8,.12);
        --neg:#BC3E45;--negdim:rgba(188,62,69,.10);
      }
      html[data-v2-theme="dark"]{
        --bg:#050B08;--bg2:#09120E;--card:#0D1712;--card2:#142019;--card3:#193428;
        --line:rgba(235,255,242,.085);--line2:rgba(235,255,242,.15);
        --tx:#F2F7F4;--tx2:#B6C3BB;--tx3:#899A90;
        --pos:#55D79B;--pos2:#37B879;--posdim:rgba(86,212,147,.13);
        --usd:#6CC7DD;--usddim:rgba(99,202,226,.12);
        --warn:#EAB65F;--warndim:rgba(241,182,94,.12);
        --neg:#F9858D;--negdim:rgba(255,139,145,.12);
      }
      #x97-v2-root,.x97-page{color:var(--tx)}
      .x97-title,.x97-sheet-head h2,.x97-rm-title{color:var(--tx)!important}
      .x97-sub,.x97-cloud,.x97-field label,.x97-help{color:var(--tx2)!important}
      .x97-cloud,.x97-sheet,.x97-sheet-foot,.x97-input,.x97-select,.x97-textarea,.x97-search input{background:var(--card)!important}
      .x97-cloud,.x97-input,.x97-select,.x97-textarea,.x97-search input{border-color:var(--line2)!important}
      html[data-v2-theme="dark"] .x97-sheet-foot{background:var(--bg2)!important}
      html[data-v2-theme="dark"] .x97-card-action.whatsapp{background:rgba(86,212,147,.14);border-color:rgba(86,212,147,.30);color:var(--pos)}

      /* Premium visual upgrade — polished, executive and deliberately calm. */
      #x97-v2-root{
        background:
          radial-gradient(50rem 26rem at 100% -8%,rgba(18,106,130,.12),transparent 68%),
          radial-gradient(42rem 24rem at -10% 14%,rgba(13,128,83,.13),transparent 64%),
          var(--bg)!important;
      }
      .x97-top{position:relative;padding:8px 2px 20px;margin-bottom:22px!important}
      .x97-top::after{content:"";position:absolute;left:2px;right:2px;bottom:0;height:1px;background:linear-gradient(90deg,var(--pos),var(--line2) 34%,transparent 76%)}
      .x97-eyebrow{padding:6px 9px 6px 7px;border:1px solid color-mix(in srgb,var(--pos) 18%,transparent);border-radius:999px;background:var(--posdim);width:max-content}
      .x97-eyebrow::before{width:5px;height:5px;background:var(--pos);box-shadow:0 0 0 4px var(--posdim)}
      .x97-title{font-size:clamp(30px,4.3vw,46px)!important;letter-spacing:-.067em!important;line-height:.94!important}
      .x97-sub{max-width:62ch;font-size:12.5px;line-height:1.65}
      .x97-cloud{border-radius:999px!important;padding:9px 12px!important;box-shadow:0 8px 20px -16px rgba(3,27,19,.48)!important}
      .x97-cloud.online{border-color:color-mix(in srgb,var(--pos) 38%,var(--line2))!important;background:color-mix(in srgb,var(--pos) 8%,var(--card))!important}
      .x97-card,.x97-item,.x97-month-card{
        border-color:color-mix(in srgb,var(--line) 78%,var(--pos) 22%)!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,.48),0 18px 42px -32px rgba(3,27,19,.44)!important;
      }
      .x97-card{position:relative;overflow:hidden}
      .x97-hero-command{border-radius:28px!important;isolation:isolate;overflow:hidden!important;background:linear-gradient(135deg,#063726 0%,#062D21 54%,#041B14 100%)!important;box-shadow:0 24px 55px -30px rgba(3,27,19,.85)!important}
      .x97-hero-command::before{height:3px!important;background:linear-gradient(90deg,var(--lime),#5BE0A1 50%,rgba(91,224,161,0))!important}
      .x97-hero-command::after{width:420px!important;height:420px!important;right:-160px!important;top:-235px!important;background:radial-gradient(circle,rgba(217,255,102,.19),transparent 65%)!important;animation:x97-orbit 12s ease-in-out infinite alternate}
      .x97-hero-value{text-shadow:0 12px 34px rgba(0,0,0,.22);font-size:clamp(42px,7vw,68px)!important}
      .x97-stat{backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1)!important}
      .x97-summary{border-radius:18px!important;min-height:118px!important;background:linear-gradient(145deg,color-mix(in srgb,var(--card) 92%,var(--posdim)),var(--bg2))!important}
      .x97-summary .v{font-size:clamp(22px,2.3vw,30px)!important;letter-spacing:-.055em!important}
      .x97-section-title{letter-spacing:.18em!important}
      .x97-section-title::before{border-radius:999px;box-shadow:0 0 0 4px var(--posdim)}
      .x97-command-action{border-radius:16px!important;min-height:72px;border-color:var(--line)!important;background:color-mix(in srgb,var(--card) 86%,var(--posdim))!important}
      .x97-command-action.primary{background:linear-gradient(135deg,var(--pos),var(--pos2))!important;box-shadow:0 14px 28px -18px var(--pos2)!important}
      .x97-command-icon{border-radius:11px!important}
      .x97-item{border-radius:18px!important;padding:17px!important;background:linear-gradient(135deg,var(--card),var(--bg2))!important}
      .x97-item-amount,.x97-row-value{letter-spacing:-.045em!important}
      .x97-input,.x97-select,.x97-textarea,.x97-search input{box-shadow:inset 0 1px 2px rgba(3,27,19,.06)!important;transition:border-color .2s ease,box-shadow .2s ease,transform .2s ease!important}
      .x97-input:focus,.x97-select:focus,.x97-textarea:focus,.x97-search input:focus{border-color:var(--pos)!important;box-shadow:0 0 0 4px var(--posdim),inset 0 1px 2px rgba(3,27,19,.04)!important}
      .x97-btn,.x97-link,.x97-icon-btn,.x97-chip{border-radius:13px!important}
      .x97-btn.primary{background:linear-gradient(135deg,#11935E,var(--pos2))!important;box-shadow:0 12px 24px -15px var(--pos2)!important}
      .x97-progress i,.x97-pay-bar i,.x97-collection-progress i{background:linear-gradient(90deg,var(--pos2),#4FD490,var(--lime),#4FD490)!important;background-size:220% 100%!important;animation:x97-progress-sheen 2.4s linear infinite!important}
      .nav{border-top-color:color-mix(in srgb,var(--pos) 18%,var(--line))!important;box-shadow:0 -14px 38px -26px rgba(3,27,19,.55)!important}
      .navitem.on svg{box-shadow:0 10px 24px -12px rgba(217,255,102,.64)!important}
      @media(hover:hover){
        .x97-card:hover,.x97-item:hover,.x97-month-card:hover{transform:translateY(-4px)!important;border-color:color-mix(in srgb,var(--pos) 42%,var(--line2))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 25px 48px -30px rgba(3,27,19,.58)!important}
        .x97-command-action:hover{transform:translateY(-3px)!important;border-color:color-mix(in srgb,var(--pos) 48%,var(--line2))!important;box-shadow:0 17px 30px -24px rgba(3,27,19,.52)!important}
        .x97-btn:hover,.x97-link:hover,.x97-icon-btn:hover{transform:translateY(-2px)!important;filter:brightness(1.03)}
      }
      @keyframes x97-orbit{from{transform:translate3d(-12px,-4px,0) scale(.94)}to{transform:translate3d(15px,14px,0) scale(1.08)}}
      @keyframes x97-progress-sheen{from{background-position:100% 0}to{background-position:-120% 0}}
      @media(max-width:620px){
        .x97-top{padding-bottom:16px}.x97-title{font-size:31px!important}.x97-sub{font-size:11.5px;line-height:1.55}.x97-hero-command{border-radius:23px!important}.x97-command-action{min-height:62px}.x97-summary{min-height:104px!important}
      }
      @media(prefers-reduced-motion:reduce){
        .x97-hero-command::after,.x97-progress i,.x97-pay-bar i,.x97-collection-progress i{animation:none!important}
      }
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
    return '<header class="x97-top"><div class="x97-top-copy"><div class="x97-eyebrow">' + esc(kicker) + '</div><h1 class="x97-title">' + esc(title) + '</h1>' + (subtitle ? '<p class="x97-sub">' + esc(subtitle) + '</p>' : '') + '</div><div class="x97-top-actions">' + (actionHTML || '') + cloudPill() + '</div></header>';
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
    if (!modeActive) { currentScreen = null; scheduleViewportFab(); return; }
    modeActive = false;
    document.body.classList.remove("x97-v2-mode");
    if (root) root.classList.remove("on");
    hiddenChildren.forEach(function (entry) { if (entry.node) entry.node.style.display = entry.display || ""; });
    hiddenChildren = [];
    currentScreen = null;
    scheduleViewportFab();
  }

  function scheduleRender(delay) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay == null ? 40 : delay);
  }

  function syncViewportFab() {
    fabFrame = 0;
    var active = modeActive && (currentScreen === "upcoming" || currentScreen === "credit");
    var fresh = root ? root.querySelector(".x97-fab:not(.x97-fab-viewport)") : null;
    var mounted = document.querySelector("body>.x97-fab.x97-fab-viewport");
    if (fresh && active) {
      if (mounted && mounted !== fresh) mounted.remove();
      fresh.classList.add("x97-fab-viewport");
      document.body.appendChild(fresh);
      mounted = fresh;
    } else if (mounted && !active) mounted.remove();
    document.body.classList.toggle("x97-fab-sheet-open", !!document.getElementById("x97-sheet"));
  }

  function scheduleViewportFab() {
    if (fabFrame) return;
    fabFrame = requestAnimationFrame(syncViewportFab);
  }

  function syncMode() {
    var screen = activeScreen();
    if (screen && MANAGED[screen]) {
      enterManagedMode();
      if (screen !== currentScreen) { currentScreen = screen; window.scrollTo(0, 0); }
      scheduleRender(0);
    } else exitManagedMode();
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
    var loans = virtualLegacyLoans(doc);
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

  function dashboardAttention(doc, a) {
    var items = [];
    if (a.overdue.length) items.push({ type: "bad", title: a.overdue.length + " overdue incoming payment" + (a.overdue.length === 1 ? "" : "s"), sub: "Open Incoming to follow up", nav: "upcoming" });
    var overdueLoans = a.activeLoans.filter(function (l) { return daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))) < 0; });
    if (overdueLoans.length) items.push({ type: "bad", title: overdueLoans.length + " overdue credit repayment" + (overdueLoans.length === 1 ? "" : "s"), sub: "Review active borrowing", nav: "credit" });
    var soonLoans = a.activeLoans.filter(function (l) { var d = daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))); return d >= 0 && d <= 4; });
    if (soonLoans.length) items.push({ type: "warn", title: soonLoans.length + " repayment" + (soonLoans.length === 1 ? "" : "s") + " due soon", sub: "Due within four days", nav: "credit" });
    if (a.next7.length) items.push({ type: "warn", title: a.next7.length + " incoming payment" + (a.next7.length === 1 ? "" : "s") + " due in 7 days", sub: "Review dates and clients", nav: "upcoming" });
    if (a.expenses.personalSafe < 0) items.push({ type: "bad", title: "Personal budget is overcommitted", sub: money(Math.abs(a.expenses.personalSafe), "UGX") + " above the safe amount", nav: "expenses" });
    if (a.expenses.businessSafe < 0) items.push({ type: "bad", title: "Business budget is overcommitted", sub: money(Math.abs(a.expenses.businessSafe), "UGX") + " above the safe amount", nav: "expenses" });
    var unscheduled = a.open.filter(function (x) { var next = nextScheduledPayment(doc, x); return !next || !next.dueDate; }).length;
    if (unscheduled) items.push({ type: "warn", title: unscheduled + " incoming item" + (unscheduled === 1 ? " needs" : "s need") + " a date", sub: "Set an expected payment date", nav: "upcoming" });
    return items.slice(0, 4);
  }

  function timeline(doc, a) {
    var out = [];
    a.next7.forEach(function (x) {
      out.push({ date: x.date, title: x.client || "Incoming payment", label: x.label, amount: num(x.amount), currency: x.currency || "UGX", direction: "in", source: "upcoming", id: x.itemId });
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
    var events = scheduledEvents(doc, false).filter(function (x) { return key === "unscheduled" ? !x.date : monthKey(x.date) === key; });
    var allScheduled = scheduledEvents(doc, true).filter(function (x) { return key === "unscheduled" ? !x.date : monthKey(x.date) === key; });
    var records = (doc.followups || []).filter(function (x) { return allScheduled.some(function (event) { return String(event.itemId) === String(x.id); }) || (key === "unscheduled" && isOpenFollowup(x) && !nextScheduledPayment(doc, x)); });
    var pending = records.filter(isOpenFollowup);
    var paid = records.filter(function (x) { return isPaid(x.status); });
    var ugx = events.filter(function (x) { return String(x.currency).toUpperCase() !== "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var usd = events.filter(function (x) { return String(x.currency).toUpperCase() === "USD"; }).reduce(function (a, x) { return a + num(x.amount); }, 0);
    var paidAmount = records.reduce(function (a, x) { return a + receivedOf(x); }, 0);
    var attention = pending.filter(function (x) { var t = timing(x, doc); return t.key === "overdue" || t.key === "today" || t.key === "very-soon" || !t.next || !t.next.dueDate || outstandingOf(x) <= 0; }).length;
    return { key: key, records: records, pending: pending, paid: paid, ugx: ugx, usd: usd, paidAmount: paidAmount, attention: attention };
  }

  function renderDashboard(doc) {
    var a = analytics(doc);
    var attention = dashboardAttention(doc, a);
    var events = timeline(doc, a);
    var in7 = events.filter(function (x) { return x.direction === "in" && String(x.currency).toUpperCase() !== "USD"; }).reduce(function (s, x) { return s + x.amount; }, 0);
    var in7USD = events.filter(function (x) { return x.direction === "in" && String(x.currency).toUpperCase() === "USD"; }).reduce(function (s, x) { return s + x.amount; }, 0);
    var out7 = events.filter(function (x) { return x.direction === "out"; }).reduce(function (s, x) { return s + x.amount; }, 0);
    var collectedThisMonth = earnedIn(doc, monthKey(todayDate()));
    var outstandingUGX = a.open.filter(function (x) { return String(x.currency || "UGX").toUpperCase() !== "USD"; }).reduce(function (s, x) { return s + outstandingOf(x); }, 0);
    var outstandingUSD = a.open.filter(function (x) { return String(x.currency || "UGX").toUpperCase() === "USD"; }).reduce(function (s, x) { return s + outstandingOf(x); }, 0);
    var actualSpend = (a.expenses.personalActual || 0) + (a.expenses.businessActual || 0);
    var months = [0, 1, 2].map(function (offset) { var d = startOfMonth(todayDate()); d.setMonth(d.getMonth() + offset); return monthKey(d); });
    var accountRows = (doc.balances || []).slice().sort(function (a, b) {
      var ae = /equity/i.test(String(a.account || "")), be = /equity/i.test(String(b.account || ""));
      return ae === be ? 0 : ae ? -1 : 1;
    }).map(function (b) {
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
        + '<div class="x97-tl-body"><div class="x97-tl-title">' + esc(x.title) + '</div><div class="x97-tl-sub"><span class="x97-tl-dir">' + (din ? "IN" : "OUT") + '</span>' + (x.label ? esc(x.label) + ' · ' : '') + esc(relDay(x.date)) + '</div></div>'
        + '<div class="x97-tl-amt x97-money">' + (din ? "+\u202f" : "−\u202f") + money(x.amount, x.currency) + '</div>'
        + '</button>';
    }).join("") + '</div>' : '<div class="x97-empty">' + icon("calendar", 25) + '<strong>No movement in the next 7 days</strong><p>Add dates to Upcoming or planned expenses to build this timeline.</p></div>';
    var pipeline = months.map(function (key) {
      var m = monthSummary(doc, key);
      return '<button class="x97-month-card x97-card" style="text-align:left;width:100%;margin:0" data-x97-action="open-month" data-month="' + attr(key) + '"><div class="x97-month-title">' + esc(monthLabel(key, true)) + '</div><div class="x97-month-count">' + m.pending.length + ' pending · ' + m.attention + ' need attention</div><div style="margin-top:12px"><div class="x97-money" style="font-size:20px">' + money(m.ugx, "UGX", true) + '</div><div class="x97-row-sub x97-teal" style="margin-top:5px">' + money(m.usd, "USD", true) + '</div></div></button>';
    }).join("");

    root.innerHTML = '<div class="x97-page" data-v2-page="dashboard">' +
      pageHeader("97 Live Finance", "Command centre", "Cash, collections, commitments and the next move—computed from your live records.") +
      '<div class="x97-dashboard-main">' +
        '<section class="x97-card x97-hero x97-hero-command" data-v2-hero><div class="x97-hero-topline"><div class="x97-hero-label">Available cash</div><span class="x97-hero-live">Live position</span></div><div class="x97-hero-value x97-money">' + money(a.cash, "UGX") + '</div><div class="x97-hero-caption">Real account balances only. Client promises and unused credit stay outside this number.</div><div class="x97-hero-meta"><div class="x97-stat"><span>After active debt</span><b>' + money(a.cash - a.debt, "UGX") + '</b></div><div class="x97-stat"><span>Active debt</span><b class="' + (a.debt ? "x97-red" : "x97-green") + '">' + money(a.debt, "UGX") + '</b></div></div></section>' +
        '<section class="x97-command-actions x97-dashboard-wide"><button class="x97-command-action primary" data-x97-action="record-payment"><span class="x97-command-icon">' + icon("wallet", 17) + '</span><span><b>Record payment</b><small>Update money received</small></span>' + icon("chevron", 14) + '</button><button class="x97-command-action" data-x97-action="add-upcoming"><span class="x97-command-icon teal">' + icon("plus", 17) + '</span><span><b>Add incoming deal</b><small>Build a payment schedule</small></span>' + icon("chevron", 14) + '</button><button class="x97-command-action" data-x97-action="go-expenses"><span class="x97-command-icon warn">' + icon("trend", 17) + '</span><span><b>Add expense</b><small>Keep cash position honest</small></span>' + icon("chevron", 14) + '</button></section>' +
        dealSummaryHTML(doc) +
        '<section class="x97-section x97-glance-section x97-dashboard-wide">' + sectionHead("Finance pulse") + '<div class="x97-summary-grid x97-finance-pulse" data-v2-slider="pulse"><div class="x97-card x97-summary"><div class="k">Collected this month</div><div class="v x97-money x97-green">' + money(collectedThisMonth, "UGX", true) + '</div><div class="s">Actual money received</div></div><div class="x97-card x97-summary"><div class="k">Due next 7 days</div><div class="v x97-money x97-teal">' + money(in7, "UGX", true) + '</div><div class="s">' + (in7USD ? '<span class="x97-teal">' + money(in7USD, "USD", true) + '</span> · ' : '') + 'Scheduled incoming</div></div><div class="x97-card x97-summary"><div class="k">Outstanding</div><div class="v x97-money x97-amber">' + money(outstandingUGX, "UGX", true) + '</div><div class="s">' + (outstandingUSD ? '<span class="x97-teal">' + money(outstandingUSD, "USD", true) + '</span> · ' : '') + 'Still owed by clients</div></div><div class="x97-card x97-summary"><div class="k">Actual spending</div><div class="v x97-money x97-red">' + money(actualSpend, "UGX", true) + '</div><div class="s">This month</div></div></div></section>' +
        '<section class="x97-section">' + sectionHead("Financial signals", "View Incoming", "go-upcoming") + '<div class="x97-card x97-pad">' + attentionRows + '</div></section>' +
        (function(){var s=messagingSummary(doc);var pillOd=s.overdue?'<span class="x97-pill bad">'+s.overdue+' overdue</span>':(s.dueSoon?'<span class="x97-pill warn">'+s.dueSoon+' due soon</span>':'<span class="x97-pill good">'+icon("check",11)+'All clear</span>');return '<section class="x97-section">' + sectionHead("Messaging", "Open", "open-messaging") + '<button class="x97-msg-card" data-x97-action="open-messaging"><div class="x97-msg-icon">' + icon("send") + '</div><div class="x97-msg-body"><div class="x97-msg-title">WhatsApp reminders &amp; campaigns</div><div class="x97-msg-sub">' + s.contacts + ' contacts · ' + s.campaigns + ' campaigns' + (remindExt.ready?' · sender connected':'') + '</div><div class="x97-msg-pills">' + pillOd + '</div></div>' + icon("chevron") + '</button></section>';})() +
        '<section class="x97-section">' + sectionHead("Next 7 days") + '<div class="x97-card x97-pad"><div class="x97-hero-meta" style="margin-bottom:4px"><div class="x97-stat x97-stat-in"><span>Expected in</span><b class="x97-green">' + money(in7, "UGX") + '</b></div><div class="x97-stat x97-stat-out"><span>Expected out</span><b class="x97-red">' + money(out7, "UGX") + '</b></div></div>' + timelineRows + '</div></section>' +
        earnCardHTML(doc) +
        fxCardHTML(doc) +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Accounts", "Add account", "add-account") + '<div class="x97-card x97-pad x97-account-rail" data-v2-slider="accounts">' + (accountRows || '<div class="x97-empty"><strong>No accounts yet</strong><p>Add your bank, mobile money or cash balance.</p></div>') + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Incoming pipeline", "View all months", "go-upcoming-months") + '<div class="x97-grid x97-pipeline x97-month-rail" data-v2-slider="months">' + pipeline + '</div></section>' +
        '<section class="x97-section x97-dashboard-wide x97-secondary-module x97-credit-preview">' + sectionHead("Credit position", "Open Credit", "go-credit") + '<div class="x97-card x97-pad"><div class="x97-summary-grid"><div class="x97-summary" style="padding:4px"><div class="k">Available credit</div><div class="v x97-money x97-teal">' + money(a.creditAvailable, "", true) + '</div><div class="s">Not included in cash</div></div><div class="x97-summary" style="padding:4px"><div class="k">Borrowed</div><div class="v x97-money x97-red">' + money(a.activeLoans.reduce(function (s,l){return s+num(l.principal);},0), "", true) + '</div><div class="s">' + a.activeLoans.length + ' active</div></div><div class="x97-summary" style="padding:4px"><div class="k">Amount due</div><div class="v x97-money x97-red">' + money(a.debt, "", true) + '</div><div class="s">Estimated today</div></div><div class="x97-summary" style="padding:4px"><div class="k">Next repayment</div><div class="v x97-money" style="font-size:17px">' + esc(nextLoanDue(a.activeLoans)) + '</div><div class="s">Earliest active loan</div></div></div></div></section>' +
      '</div></div>';
  }

  function nextLoanDue(loans) {
    if (!loans.length) return "None";
    var sorted = loans.slice().sort(function (a,b) { return String(dueDateForLoan(a)).localeCompare(String(dueDateForLoan(b))); });
    return formatDate(dueDateForLoan(sorted[0]), true);
  }

  function availableMonths(doc) {
    var seen = {};
    (doc.followups || []).forEach(function (x) {
      scheduleRowsFor(x).forEach(function (row) { var k = monthKey(row.dueDate); if (k) seen[k] = true; });
    });
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

  function followupMatches(item, doc) {
    var f = state.upcoming;
    var q = String(f.search || "").trim().toLowerCase();
    var scheduleText = projectSchedule(doc, item).map(function (row) { return [row.label, row.dueDate].join(" "); }).join(" ");
    if (q && [item.client, item.category, item.note, item.currency, item.status, scheduleText].join(" ").toLowerCase().indexOf(q) < 0) return false;
    var t = timing(item, doc), next = t.next, expectedBy = next ? next.dueDate : item.expectedBy;
    if (f.month === "unscheduled" && expectedBy) return false;
    if (f.month !== "all" && f.month !== "unscheduled" && monthKey(expectedBy) !== f.month) return false;
    if (f.statuses.length && f.statuses.indexOf(normalizeStatus(item.status)) < 0) return false;
    if (f.currencies.length && f.currencies.indexOf(String(item.currency || "UGX").toUpperCase()) < 0) return false;
    if (f.categories.length && f.categories.indexOf(String(item.category || "")) < 0) return false;
    if (f.from && (!expectedBy || expectedBy < f.from)) return false;
    if (f.to && (!expectedBy || expectedBy > f.to)) return false;
    if (f.minAmount !== "" && outstandingOf(item) < num(f.minAmount)) return false;
    if (f.maxAmount !== "" && outstandingOf(item) > num(f.maxAmount)) return false;
    var today = todayDate(), nowMonth = monthKey(today), nextMonthDate = new Date(startOfMonth(today)); nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
    if (f.quick === "open" && !isOpenFollowup(item)) return false;
    if (f.quick === "attention" && !(isOpenFollowup(item) && (t.key === "overdue" || t.key === "today" || (t.days != null && t.days <= 7) || !next || !next.dueDate || outstandingOf(item) <= 0))) return false;
    if (f.quick === "overdue" && t.key !== "overdue") return false;
    if (f.quick === "today" && t.key !== "today") return false;
    if (f.quick === "next7" && !(isOpenFollowup(item) && t.days != null && t.days >= 0 && t.days <= 7)) return false;
    if (f.quick === "next30" && !(isOpenFollowup(item) && t.days != null && t.days >= 0 && t.days <= 30)) return false;
    if (f.quick === "thisMonth" && monthKey(expectedBy) !== nowMonth) return false;
    if (f.quick === "nextMonth" && monthKey(expectedBy) !== monthKey(nextMonthDate)) return false;
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
    if (f.categories.length) tags.push({ label: f.categories.length + " categories", key: "categories" });
    if (f.from || f.to) tags.push({ label: (f.from ? formatDate(f.from, true) : "Any") + " – " + (f.to ? formatDate(f.to, true) : "Any"), key: "dates" });
    if (f.minAmount || f.maxAmount) tags.push({ label: "Amount " + (f.minAmount || "0") + "–" + (f.maxAmount || "∞"), key: "amount" });
    if (f.sort !== "urgency") tags.push({ label: "Sorted: " + igSortLabel(f.sort), key: "sort" });
    if (!tags.length) return "";
    return '<div class="x97-active-filters">' + tags.map(function (t) { return '<button class="x97-filter-tag" data-x97-action="clear-filter" data-filter="' + attr(t.key) + '">' + esc(t.label) + ' ' + icon("close", 11) + '</button>'; }).join("") + '<button class="x97-filter-tag" data-x97-action="clear-all-filters" style="color:var(--neg)">Clear all</button></div>';
  }

  function igSortLabel(mode) {
    return { urgency: "Most urgent", client: "Client A–Z", amountDesc: "Largest first", amountAsc: "Smallest first", dateAsc: "Earliest due", dateDesc: "Latest due", custom: "Custom order" }[mode] || mode;
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
     INCOMING — spreadsheet grid engine.
     Real rows/columns (no cards), frozen row-number + Client columns via
     native CSS sticky, keyboard + mouse + touch cell editing, resize/hide,
     range copy/paste, undo, and a mobile-first filter sheet. Scope-locked
     to #x97-v2-root[data-screen="upcoming"] — see v2-premium.css.
     ══════════════════════════════════════════════════════════════════════ */

  var IG_ROWNUM_W = 42;
  var IG_COLS = [
    { key: "client", label: "Client", width: 148, min: 96, type: "text", align: "left", sticky: true },
    { key: "gross", label: "Total", width: 106, min: 84, type: "money", align: "right" },
    { key: "paid", label: "Paid", width: 96, min: 78, type: "money", align: "right" },
    { key: "balance", label: "Balance", width: 106, min: 84, type: "money", align: "right" },
    { key: "currency", label: "Cur", width: 60, min: 54, type: "currency", align: "center" },
    { key: "status", label: "Status", width: 98, min: 84, type: "status", align: "left" },
    { key: "due", label: "Due date", width: 100, min: 88, type: "date", align: "left" },
    { key: "lastPaid", label: "Last paid", width: 96, min: 84, type: "date", align: "left" },
    { key: "structure", label: "Structure", width: 116, min: 96, type: "structure", align: "left" },
    { key: "phone", label: "WhatsApp", width: 118, min: 96, type: "phone", align: "left" },
    { key: "note", label: "Notes", width: 190, min: 130, type: "text", align: "left" }
  ];
  // The columns a collections screen is actually read for. The default zoom
  // on a phone is chosen to fit exactly these, so Balance never hides behind
  // a horizontal scroll on the device most of this work happens on.
  var IG_KEY_COLS = ["client", "gross", "paid", "balance"];

  var gridState = {
    active: null, anchor: null, editing: null,
    rows: [], byId: {}, order: [], rowEls: {}, cellEls: {},
    widths: {}, hidden: {}, zoom: 1,
    scrollTop: 0, scrollLeft: 0,
    quickEntry: null, pendingFocusRow: null, chromeAway: false,
    undoStack: [], redoStack: [],
    pendingExternalRender: false,
    menuEl: null, selEls: [], activeEl: null, activeRowEl: null, activeHeadEl: null, fillPreviewEls: []
  };
  var IG_ZOOM_MIN = 0.6, IG_ZOOM_MAX = 1.3, IG_ZOOM_STEP = 0.1;

  // Columns sit in whatever order the user dragged them into. Anything the
  // saved order doesn't mention (a column added in a later build) keeps its
  // place from IG_COLS at the end, so an old preference never hides a column.
  function igOrderedCols() {
    var saved = state.upcoming.gridOrder;
    if (!Array.isArray(saved) || !saved.length) return IG_COLS.slice();
    var out = [], seen = {};
    saved.forEach(function (key) {
      var c = igColDef(key);
      if (c && !seen[key]) { seen[key] = true; out.push(c); }
    });
    IG_COLS.forEach(function (c) { if (!seen[c.key]) out.push(c); });
    return out;
  }
  function igVisibleCols() { return igOrderedCols().filter(function (c) { return !gridState.hidden[c.key]; }); }
  function igColDef(key) { return IG_COLS.filter(function (c) { return c.key === key; })[0]; }
  function igSaveColOrder(cols) { state.upcoming.gridOrder = cols.map(function (c) { return c.key; }); savePrefs(); }
  // Move a column to where it was dropped. The order is stored over every
  // column, hidden ones included, so hiding and re-showing keeps the place.
  function igMoveColumn(key, toVisibleIndex) {
    var visible = igVisibleCols(), from = visible.map(function (c) { return c.key; }).indexOf(key);
    if (from < 0) return false;
    toVisibleIndex = Math.max(0, Math.min(visible.length - 1, toVisibleIndex));
    if (toVisibleIndex === from) return false;
    var moved = visible.splice(from, 1)[0];
    visible.splice(toVisibleIndex, 0, moved);
    var order = [], placed = {};
    visible.forEach(function (c) { order.push(c); placed[c.key] = true; });
    igOrderedCols().forEach(function (c) { if (!placed[c.key]) order.push(c); });
    igSaveColOrder(order);
    return true;
  }

  /* Frozen columns. Sheets freezes a run of leading columns; here that run is
     whatever the user picked, defaulting to the client name. On a narrow phone
     a deep freeze would swallow the window, so the run is clamped to what
     still leaves room to read the rest of the sheet. */
  function igFreezeCount() {
    var visible = igVisibleCols();
    var n = state.upcoming.gridFreeze;
    n = n === undefined || n === null ? 1 : Math.max(0, Math.min(visible.length, n | 0));
    var room = (window.innerWidth || 900) * 0.62 - igRownumWidth(), used = 0, fit = 0;
    for (var i = 0; i < n; i++) {
      used += igColWidth(visible[i].key);
      if (used > room && fit > 0) break;
      fit++;
    }
    return fit;
  }
  function igFreezeOffsets() {
    var offs = [], run = igRownumWidth(), visible = igVisibleCols(), n = igFreezeCount();
    for (var i = 0; i < n; i++) { offs.push(run); run += igColWidth(visible[i].key); }
    return offs;
  }
  // Rebuilt once per render so every cell string can ask "am I frozen?"
  // without recomputing the run for all ten columns, ten times a row.
  function igRefreshFrozenMap() {
    var map = {}, visible = igVisibleCols(), n = igFreezeCount();
    for (var i = 0; i < n; i++) map[visible[i].key] = i;
    gridState.frozen = map;
    gridState.frozenLast = n > 0 ? visible[n - 1].key : null;
    return map;
  }
  function igColWidth(key) {
    var c = igColDef(key), w = gridState.widths[key] || (c ? c.width : 100), z = gridState.zoom || 1;
    return Math.max(36, Math.round((c ? c.min : 60) * Math.min(1, z)), Math.round(w * z));
  }
  function igRownumWidth() { return Math.max(28, Math.round(IG_ROWNUM_W * (gridState.zoom || 1))); }
  function igTemplate() {
    var parts = [igRownumWidth() + "px"];
    igVisibleCols().forEach(function (c) { parts.push(igColWidth(c.key) + "px"); });
    return parts.join(" ");
  }
  // Default zoom is derived from the device, not guessed: shrink just enough
  // that the row number, Client and the three money columns fit the window.
  // A 320px phone lands near 0.63, a 412px phone near 0.82, anything with
  // real width stays at 1.
  function igAutoZoom() {
    try {
      var vw = window.innerWidth || 0;
      if (!vw || vw >= 900) return 1;
      var need = IG_ROWNUM_W;
      IG_KEY_COLS.forEach(function (key) {
        if (gridState.hidden[key]) return;
        var c = igColDef(key);
        if (c) need += (gridState.widths[key] || c.width);
      });
      if (need <= 0) return 1;
      return Math.max(IG_ZOOM_MIN, Math.min(1, Math.round(((vw - 4) / need) * 100) / 100));
    } catch (_) { return 1; }
  }
  function igSyncPersisted() {
    gridState.widths = Object.assign({}, state.upcoming.gridWidths || {});
    gridState.hidden = {};
    (state.upcoming.gridHidden || []).forEach(function (k) { gridState.hidden[k] = true; });
    gridState.zoom = state.upcoming.gridZoom || igAutoZoom();
  }
  function igSavePersistedWidths() { state.upcoming.gridWidths = Object.assign({}, gridState.widths); savePrefs(); }
  function igSavePersistedHidden() { state.upcoming.gridHidden = Object.keys(gridState.hidden).filter(function (k) { return gridState.hidden[k]; }); savePrefs(); }
  // Every measurement the grid layout depends on, in one place: the column
  // template, the row-number gutter and the left offset of each frozen
  // column. Zoom, a resize drag and an autofit all go through here so the
  // frozen run can never drift out of step with the columns it sits on.
  function igLayoutVars() {
    var vars = { "--ig-zoom": String(gridState.zoom || 1), "--ig-rownum-w": igRownumWidth() + "px", "--ig-tpl": igTemplate() };
    igFreezeOffsets().forEach(function (px, i) { vars["--ig-fz-" + i] = px + "px"; });
    return vars;
  }
  function igLayoutStyle() {
    var vars = igLayoutVars();
    return Object.keys(vars).map(function (k) { return k + ":" + vars[k]; }).join(";");
  }
  function igApplyLayout(inner) {
    inner = inner || document.getElementById("ig-grid-inner");
    if (!inner) return;
    var vars = igLayoutVars();
    Object.keys(vars).forEach(function (k) { inner.style.setProperty(k, vars[k]); });
  }
  function igApplyZoomLive() {
    igApplyLayout();
    igFillEmptyRows();
    var pct = document.querySelector(".ig-zpct"); if (pct) pct.textContent = Math.round((gridState.zoom || 1) * 100) + "%";
  }

  /* An empty sheet in Sheets is still a sheet: the gridlines run to the
     bottom of the window whether there are three rows or three hundred.
     These filler rows carry no data and take no events — they exist so the
     grid fills whatever space the device gives it. */
  var IG_FILLER_MAX = 40;
  function igFillerRowHTML(cols) {
    var cells = '<div class="ig-cell ig-rownum ig-sticky-num ig-filler-cell"></div>';
    cells += cols.map(function (c) {
      return '<div class="ig-cell ig-filler-cell' + igFrozenClasses(c.key).map(function (k) { return " " + k; }).join("") + '"' + igFrozenAttrs(c.key) + '></div>';
    }).join("");
    return '<div class="ig-row ig-filler-row">' + cells + '</div>';
  }
  function igFillEmptyRows() {
    var scroll = document.getElementById("ig-scroll"), filler = document.getElementById("ig-filler"), body = document.getElementById("ig-body");
    if (!scroll || !filler || !body) return;
    var first = body.firstElementChild;
    var rowH = first ? first.offsetHeight : 0;
    if (rowH < 8) rowH = Math.max(8, Math.round(36 * (gridState.zoom || 1)));
    var head = document.querySelector(".ig-head-row");
    var space = scroll.clientHeight - (head ? head.offsetHeight : 0) - body.offsetHeight;
    // Floor, never ceil: a filler row that overshoots would invent a
    // scrollbar on a sheet that actually fits.
    var want = space > rowH ? Math.min(IG_FILLER_MAX, Math.floor(space / rowH)) : 0;
    var cols = igVisibleCols();
    var sig = want + ":" + cols.map(function (c) { return c.key; }).join(",");
    if (filler.getAttribute("data-fill") === sig) return;
    var html = "";
    for (var i = 0; i < want; i++) html += igFillerRowHTML(cols);
    filler.innerHTML = html;
    filler.setAttribute("data-fill", sig);
  }

  /* The on-screen keyboard. A phone keyboard covers the bottom half of the
     window without changing the layout viewport, so the cell being typed
     into can sit underneath it. visualViewport says how much is covered;
     the sheet gives up exactly that much height and scrolls the open cell
     back into what is left. */
  function igWireKeyboardInset() {
    var vv = window.visualViewport;
    if (!vv || gridState.kbWired) return;
    gridState.kbWired = true;
    var apply = function () {
      var shell = root && root.querySelector(".ig-shell");
      if (!shell) return;
      var covered = Math.max(0, (window.innerHeight || 0) - (vv.height + vv.offsetTop));
      var open = covered > 90;
      shell.style.setProperty("--ig-kb", (open ? Math.round(covered) : 0) + "px");
      shell.classList.toggle("ig-kb-open", open);
      if (open && gridState.editing) {
        igFillEmptyRows();
        igScrollCellIntoView(gridState.editing.rowId, gridState.editing.col);
      }
    };
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
  }

  // Rotating a phone changes the auto zoom and how many columns can stay
  // frozen; without this the sheet kept its portrait shape until something
  // else happened to trigger a render.
  function igOnViewportChange() {
    var inner = document.getElementById("ig-grid-inner");
    if (!inner) return;
    if (!state.upcoming.gridZoom) gridState.zoom = igAutoZoom();
    var before = Object.keys(gridState.frozen || {}).join(",");
    igRefreshFrozenMap();
    if (Object.keys(gridState.frozen || {}).join(",") !== before) { scheduleRender(0); return; }
    igApplyLayout(inner);
    igFillEmptyRows();
    igPaintActive();
  }
  function igSetZoom(action) {
    var z = gridState.zoom || 1;
    if (action === "in") z = Math.min(IG_ZOOM_MAX, Math.round((z + IG_ZOOM_STEP) * 100) / 100);
    else if (action === "out") z = Math.max(IG_ZOOM_MIN, Math.round((z - IG_ZOOM_STEP) * 100) / 100);
    else { state.upcoming.gridZoom = null; z = igAutoZoom(); savePrefs(); gridState.zoom = z; igApplyZoomLive(); return; }
    gridState.zoom = z;
    state.upcoming.gridZoom = z;
    savePrefs();
    igApplyZoomLive();
  }

  function igStatusInfo(item) {
    var label = isCancelled(item.status) ? "Cancelled" : isPaid(item.status) ? "Paid" : isPartPaid(item) ? "Part Paid" : "Pending";
    var tone = isCancelled(item.status) ? "muted" : isPaid(item.status) ? "good" : isPartPaid(item) ? "warn" : "neutral";
    return { label: label, tone: tone };
  }

  // The date of the most recent receipt. It used to live only inside the
  // payment form; it is a column now, so the row says when money last moved.
  function igLastPaidDate(doc, item) {
    var log = paymentsFor(doc, item.id);
    if (!log.length) return item.paidOn || "";
    var newest = log.slice().sort(function (a, b) {
      return String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""));
    })[0];
    return (newest && newest.date) || item.paidOn || "";
  }

  function igBuildRow(item, doc, index) {
    var t = timing(item, doc), next = t.next, due = next ? next.dueDate : item.expectedBy;
    var locked = dealHasRecordedMoney(item), structured = isDeal(item), status = igStatusInfo(item);
    // One tone drives the row: the edge marker in the frozen row-number
    // gutter, always on screen regardless of horizontal scroll. Nothing
    // else repeats it — the due date and the balance used to be recoloured
    // to say the same thing a second and third time, which is what read as
    // "confusing" rather than as one clear signal.
    var rowTone = isCancelled(item.status) ? "muted"
      : outstandingOf(item) <= 0 ? "good"
      : t.key === "overdue" ? "bad"
      : (t.key === "today" || t.key === "very-soon" || t.key === "soon") ? "warn"
      : !due ? "undated" : "";
    return {
      tone: rowTone,
      id: item.id, index: index,
      client: item.client || "", category: item.category || "",
      gross: grossOf(item), paid: paidOf(item), balance: outstandingOf(item),
      currency: String(item.currency || "UGX").toUpperCase(),
      status: status.label, statusTone: status.tone,
      due: due || "",
      lastPaid: igLastPaidDate(doc, item),
      structure: structured ? (DEAL_TYPES[normalizeDealType(item.dealType)] || "Payment schedule") : "One payment",
      phone: item.phone || "", note: item.note || "",
      locked: locked, structured: structured, open: isOpenFollowup(item), raw: item
    };
  }
  /* A deal with a payment schedule is not one row: it is a row per
     instalment, under a row that totals them. The instalment's amount, date,
     money in and state are cells like any other — none of it lives behind a
     form any more. Collapsing a deal is Sheets' row grouping, not a hiding
     place: the toggle sits in the row-number gutter. */
  function igCollapsed(id) { return (state.upcoming.gridCollapsed || []).indexOf(String(id)) >= 0; }
  function igToggleCollapse(id) {
    var list = (state.upcoming.gridCollapsed || []).slice(), i = list.indexOf(String(id));
    if (i >= 0) list.splice(i, 1); else list.push(String(id));
    state.upcoming.gridCollapsed = list;
    savePrefs();
    scheduleRender(0);
  }
  /* One button for every schedule on the sheet. The direction is decided by
     what is on screen — if anything is open, the button closes things — but
     the action covers every deal in the document, so a schedule that is
     filtered out of view now does not spring open when it comes back. */
  function igVisibleCollapsibles() { return (gridState.rows || []).filter(function (r) { return r.hasParts; }); }
  function igCollapseAll(collapse) {
    var doc = readDoc();
    var ids = ((doc && doc.followups) || [])
      .filter(function (it) { return Array.isArray(it.parts) && it.parts.length; })
      .map(function (it) { return String(it.id); });
    if (!ids.length) return;
    state.upcoming.gridCollapsed = collapse ? ids : [];
    savePrefs();
    scheduleRender(0);
  }

  /* Adding an instalment. A new one arrives at zero, so the deal's total and
     everything already received are untouched — the sheet then puts the
     cursor on its amount so the figure can just be typed. */
  function igAddPart(rowId) {
    var gridRow = gridState.byId[rowId], ownerId = igOwnerId(rowId), newPartId = uid("part");
    if (!ownerId) return;
    // A collapsed deal has to open, or the row that was just added is added
    // somewhere the user cannot see.
    if (igCollapsed(ownerId)) {
      state.upcoming.gridCollapsed = (state.upcoming.gridCollapsed || []).filter(function (id) { return String(id) !== String(ownerId); });
      savePrefs();
    }
    igPushUndo(ownerId);
    igWritePatched(function (doc) {
      var item = (doc.followups || []).find(function (x) { return String(x.id) === String(ownerId); });
      if (!item) return;
      var every = Math.max(1, Math.round(num(item.partEvery || 7)));
      var singular = dealLabelSingular(item);
      var word = singular.charAt(0).toUpperCase() + singular.slice(1);
      if (!Array.isArray(item.parts) || !item.parts.length) {
        // A one-payment deal becomes a schedule: what was already agreed
        // stays as the first payment, the new one lands after it.
        item.dealType = "custom";
        item.partLabel = item.partLabel || "parts";
        item.partEvery = every;
        item.parts = [{
          id: uid("part"), index: 1, label: word + " 1",
          amount: roundMoney(grossOf(item)), dueDate: item.expectedBy || todayISO(),
          paid: paidOf(item), status: item.status || "Pending", paidOn: item.paidOn || ""
        }];
      }
      var parts = item.parts;
      var at = gridRow && gridRow.partId ? parts.map(function (p) { return String(p.id); }).indexOf(String(gridRow.partId)) : parts.length - 1;
      if (at < 0) at = parts.length - 1;
      var prev = parts[at];
      var due = prev && prev.dueDate ? dateISO(addDays(prev.dueDate, every)) : (item.expectedBy || todayISO());
      parts.splice(at + 1, 0, {
        id: newPartId, index: at + 2, label: word + " " + (at + 2),
        amount: 0, dueDate: due, paid: 0, status: "Pending", paidOn: ""
      });
      parts.forEach(function (p, i) { p.index = i + 1; });
      // Renumber only the labels still in the default "<thing> <n>" shape;
      // anything renamed by hand ("Deposit", "Kickoff") keeps its name.
      var auto = new RegExp("^\\s*" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+\\d+\\s*$", "i");
      parts.forEach(function (p, i) { if (auto.test(String(p.label || ""))) p.label = word + " " + (i + 1); });
      item.partCount = parts.length;
      rebuildDealParts(doc, item);
    }, "grid-add-part", [ownerId]);
    var newRowId = ownerId + "::" + newPartId;
    if (gridState.byId[newRowId]) igSetActive(newRowId, "gross");
    toast("Instalment added — type its amount", "success");
  }

  function igBuildPartRow(parent, item, part, doc, index, count) {
    var due = part.dueDate || "";
    var t = due ? timingForDate(due) : null;
    var paid = num(part.paid), amount = roundMoney(part.amount), balance = Math.max(0, amount - paid);
    // A brand-new instalment has no amount yet. Arithmetically nothing is
    // owed on it, but calling that "Paid" reads as done rather than empty.
    var status = amount <= 0 ? "Pending" : paid >= amount - 0.5 ? "Paid" : paid > 0 ? "Part Paid" : "Pending";
    var tone = isCancelled(item.status) ? "muted"
      : balance <= 0 ? "good"
      : t === "overdue" ? "bad"
      : t === "soon" ? "warn"
      : !due ? "undated" : "";
    return {
      tone: tone, part: true, parentId: parent.id, partId: String(part.id), partIndex: index, partCount: count,
      id: parent.id + "::" + part.id, index: parent.index + "." + index,
      client: part.label || ("Payment " + index), category: parent.category,
      gross: amount, paid: paid, balance: balance,
      currency: parent.currency,
      status: status, statusTone: balance <= 0 ? "good" : paid > 0 ? "warn" : "",
      due: due,
      lastPaid: part.paidOn || "",
      structure: "Part " + index + " of " + count,
      phone: parent.phone, note: parent.note,
      locked: paid > 0, structured: true, open: balance > 0 && !isCancelled(item.status), raw: item
    };
  }
  // A part's date only needs the coarse buckets the row tone uses.
  function timingForDate(iso) {
    var days = daysBetween(todayISO(), iso);
    if (days == null) return null;
    return days < 0 ? "overdue" : days <= 7 ? "soon" : "";
  }
  function igBuildRows(doc, list) {
    var out = [];
    list.forEach(function (item, i) {
      var parent = igBuildRow(item, doc, i + 1);
      var parts = Array.isArray(item.parts) ? item.parts : [];
      parent.hasParts = parts.length > 0;
      parent.collapsed = parent.hasParts && igCollapsed(item.id);
      out.push(parent);
      if (parent.hasParts && !parent.collapsed) {
        parts.forEach(function (part, pi) { out.push(igBuildPartRow(parent, item, part, doc, pi + 1, parts.length)); });
      }
    });
    return out;
  }

  // There are no read-only cells. Where money is already recorded the edit
  // does the ledger-safe thing — rescale the schedule, convert at the live
  // rate, reverse the newest receipts — rather than refusing the keystroke.
  function igEditable() { return true; }

  function igCellText(col, row) {
    if (col.type === "money") return money(row[col.key] || 0, "");
    if (col.type === "currency") return row.currency;
    if (col.type === "status") return row.status;
    if (col.type === "date") {
      var d = row[col.key];
      if (d) return formatDate(d, true);
      return col.key === "due" ? (row.open ? "No date" : "—") : "—";
    }
    if (col.type === "structure") return row.structure;
    return row[col.key] || "";
  }
  function igRawValue(row, key) { return row[key] == null ? "" : row[key]; }

  // Frozen columns carry their left offset as a CSS variable rather than a
  // baked pixel value, so a resize drag or a zoom moves the whole run without
  // rebuilding a single cell.
  function igFrozenAttrs(key) {
    var idx = gridState.frozen ? gridState.frozen[key] : undefined;
    if (idx === undefined) return "";
    return ' style="left:var(--ig-fz-' + idx + ',0px)"';
  }
  function igFrozenClasses(key) {
    var idx = gridState.frozen ? gridState.frozen[key] : undefined;
    if (idx === undefined) return [];
    return gridState.frozenLast === key ? ["ig-frozen", "ig-frozen-last"] : ["ig-frozen"];
  }
  function igCellClass(col, row) {
    var cls = ["ig-cell", "ig-c-" + col.key, "ig-a-" + col.align].concat(igFrozenClasses(col.key));
    if (igEditable(col, row)) cls.push("ig-editable");
    else cls.push("ig-readonly");
    if (col.key === "status") cls.push("ig-tone-badge");
    if (col.key === "client" && !row.client) cls.push("ig-placeholder");
    // One meaning per colour: green on Balance says the deal is settled —
    // nothing recolours it for urgency a second time, since the frozen
    // row-edge marker already says that, always in view. What's still owed
    // reads as plain, bold text; the due date is plain text too.
    if (col.key === "balance") cls.push(row.balance <= 0 ? "ig-tone-good" : "ig-tone-owed");
    if (col.key === "paid" && row.paid > 0) cls.push("ig-tone-paid");
    return cls.join(" ");
  }
  function igCellInner(col, row) {
    var text = igCellText(col, row);
    if (col.key === "client" && !row.client) return '<span class="ig-muted">Untitled — click to name</span>';
    if (col.type === "money" || col.type === "date") return '<span class="tabnum">' + esc(text) + '</span>';
    if (col.key === "status") return '<span class="ig-badge ig-badge-' + esc(row.statusTone) + '">' + esc(text) + '</span>';
    if (col.key === "currency") return '<span class="ig-badge ig-cur-' + esc(row.currency.toLowerCase()) + '">' + esc(text) + '</span>';
    if (col.key === "structure" && row.locked) return esc(text) + ' ' + icon("lock", 11);
    return esc(text);
  }
  function igCellHTML(col, row) {
    var text = igCellText(col, row);
    return '<div class="' + igCellClass(col, row) + '" role="gridcell" data-col="' + attr(col.key) + '" data-row="' + attr(row.id) + '" tabindex="-1" title="' + attr(text) + '"' + igFrozenAttrs(col.key) + '>' + igCellInner(col, row) + '</div>';
  }
  function igRowHTML(row) {
    var num0 = row.hasParts
      ? '<button type="button" class="ig-group" data-group="' + attr(row.raw && row.raw.id || row.id) + '" aria-expanded="' + (row.collapsed ? "false" : "true") + '" title="' + (row.collapsed ? "Show instalments" : "Hide instalments") + '">' + icon("chevron", 9) + '</button><span class="ig-rownum-n">' + row.index + '</span>'
      : '<span class="ig-rownum-n">' + row.index + '</span>';
    var cells = '<div class="ig-cell ig-rownum ig-sticky ig-sticky-num' + (row.hasParts ? " ig-has-parts" : "") + (row.collapsed ? " ig-collapsed" : "") + '" role="rowheader" data-rownum="' + attr(row.id) + '">' + num0 + '</div>';
    cells += igVisibleCols().map(function (c) { return igCellHTML(c, row); }).join("");
    return '<div class="ig-row' + (row.open ? "" : " ig-row-settled") + (row.tone ? " ig-row-" + row.tone : "") + (row.part ? " ig-row-part" : "") + '" role="row" data-row-id="' + attr(row.id) + '">' + cells + '</div>';
  }
  function igSortMatches(key) {
    var s = state.upcoming.sort;
    if (key === "client") return s === "client" ? "on" : "";
    if (key === "gross" || key === "balance") return s === "amountDesc" ? "desc" : s === "amountAsc" ? "asc" : "";
    if (key === "due") return s === "dateAsc" ? "asc" : s === "dateDesc" ? "desc" : "";
    return "";
  }
  function igHeaderHTML() {
    var head = '<div class="ig-cell ig-rownum ig-colhead ig-sticky-num" role="columnheader" title="Select the whole sheet">#</div>';
    head += igVisibleCols().map(function (c) {
      var sortable = c.key === "client" || c.key === "gross" || c.key === "balance" || c.key === "due";
      var active = igSortMatches(c.key);
      return '<div class="ig-cell ig-colhead ig-a-' + c.align + igFrozenClasses(c.key).map(function (k) { return " " + k; }).join("") + (active ? " ig-sorted" : "") + '" role="columnheader" data-colhead="' + attr(c.key) + '"' + (sortable ? ' data-x97-action="grid-sort" data-col="' + attr(c.key) + '"' : "") + igFrozenAttrs(c.key) + '><span>' + esc(c.label) + '</span>' + (active ? '<i class="ig-sort-ic">' + icon("chevron", 10) + '</i>' : "") + '<b class="ig-colmenu" data-colmenu="' + attr(c.key) + '" title="Column options" aria-label="Column options">' + icon("chevron", 9) + '</b><b class="ig-resize" data-resize="' + attr(c.key) + '"></b></div>';
    }).join("");
    return '<div class="ig-row ig-head-row" role="row">' + head + '</div>';
  }

  function igFormulaBarHTML() {
    return '<div class="ig-formula-bar"><div class="ig-cell-ref" id="ig-cell-ref">—</div><input class="ig-formula-input" id="ig-formula-input" autocomplete="off" placeholder="Select a cell" disabled></div>';
  }
  function igGridFilterCount() {
    var f = state.upcoming, count = 0;
    if (f.statuses.length) count++;
    if (f.currencies.length) count++;
    if (f.categories.length) count++;
    if (f.minAmount || f.maxAmount) count++;
    if (f.quick !== "open" && f.quick !== "all") count++;
    return count;
  }
  function igToolbarHTML() {
    var f = state.upcoming, count = igGridFilterCount();
    var collapsible = igVisibleCollapsibles();
    var anyOpen = collapsible.some(function (r) { return !r.collapsed; });
    return '<div class="ig-toolbar">' +
      '<div class="ig-toolbar-group">' +
        '<button class="ig-tbtn" data-x97-action="grid-undo" title="Undo"' + (gridState.undoStack.length ? "" : " disabled") + '>' + icon("undo", 16) + '</button>' +
        '<button class="ig-tbtn ig-tbtn-redo" data-x97-action="grid-redo" title="Redo"' + (gridState.redoStack.length ? "" : " disabled") + '>' + icon("redo", 16) + '</button>' +
        '<span class="ig-tsep"></span>' +
        '<button class="ig-tbtn" data-x97-action="grid-add-row" title="Add row">' + icon("plus", 16) + '<span class="ig-tlabel">Row</span></button>' +
        (collapsible.length ? '<button class="ig-tbtn ig-tbtn-collapse" data-x97-action="grid-collapse-all" data-value="' + (anyOpen ? "collapse" : "expand") + '" title="' + (anyOpen ? "Collapse every schedule" : "Expand every schedule") + '">' + icon(anyOpen ? "collapse" : "expand", 16) + '</button>' : "") +
      '</div>' +
      '<div class="ig-toolbar-search"><span class="ig-search-ic">' + icon("search", 15) + '</span><input id="x97-up-search" autocomplete="off" placeholder="Search Incoming" value="' + attr(f.search) + '"></div>' +
      '<div class="ig-toolbar-group">' +
        '<button class="ig-tbtn" data-x97-action="open-grid-filters" title="Filter"><span class="ig-tbtn-badge-wrap">' + icon("filter", 16) + (count ? '<b class="ig-tbadge">' + count + '</b>' : "") + '</span><span class="ig-tlabel">Filter</span></button>' +
        '<button class="ig-tbtn ig-tbtn-columns" data-x97-action="open-grid-columns" title="Columns">' + icon("columns", 16) + '</button>' +
        '<button class="ig-tbtn" data-x97-action="grid-legend" title="What the colours mean">' + icon("info", 16) + '</button>' +
        '<button class="ig-tbtn" data-x97-action="open-grid-more" title="More">' + icon("dots", 16) + '</button>' +
      '</div>' +
    '</div>';
  }
  function igQuickViewsHTML(stats) {
    var f = state.upcoming;
    function chip(key, label, count) {
      return '<button class="ig-quick' + (f.quick === key ? " on" : "") + '" data-x97-action="quick-filter" data-value="' + attr(key) + '">' + esc(label) + (count != null ? ' <b>' + count + '</b>' : "") + '</button>';
    }
    return '<div class="ig-quickviews">' + chip("all", "All") + chip("open", "Outstanding", stats.open.length) + chip("overdue", "Overdue", stats.overdue.length) + chip("next7", "Due soon", stats.due7.length) + chip("paid", "Paid") + '</div>';
  }
  function igStatusBarHTML(filteredCount, totalCount, stats) {
    var zoomPct = Math.round((gridState.zoom || 1) * 100);
    // Instalment rows are rows too — say how many are actually on screen.
    var instalments = (gridState.rows || []).filter(function (r) { return r.part; }).length;
    return '<div class="ig-statusbar"><div class="ig-statusbar-info"><span>' + filteredCount + ' of ' + totalCount + ' deal' + (totalCount === 1 ? "" : "s") + (instalments ? " · " + instalments + " instalment" + (instalments === 1 ? "" : "s") : "") + '</span><span class="ig-statusbar-sep">·</span><span>Outstanding ' + esc(money(stats.outstandingUGX, "UGX", true)) + (stats.outstandingUSD ? " + " + esc(money(stats.outstandingUSD, "USD", true)) : "") + '</span></div>' +
      '<div class="ig-selstats" id="ig-selstats" hidden></div>' +
      '<div class="ig-zoom" role="group" aria-label="Grid zoom">' +
        '<button class="ig-zbtn" data-x97-action="grid-zoom" data-value="out" title="Zoom out" aria-label="Zoom out">' + icon("minus", 13) + '</button>' +
        '<button class="ig-zpct" data-x97-action="grid-zoom" data-value="reset" title="Reset zoom">' + zoomPct + '%</button>' +
        '<button class="ig-zbtn" data-x97-action="grid-zoom" data-value="in" title="Zoom in" aria-label="Zoom in">' + icon("plus", 13) + '</button>' +
      '</div></div>';
  }
  /* What is expected, and when. Every unpaid scheduled payment falls into
     exactly one time bucket so the tiles answer "what is late, what lands
     today, what lands this week, what lands this month" at a glance. */
  function igPeriodStats(doc) {
    var today = todayDate(), endMonth = endOfMonth(today);
    function bucket() { return { ugx: 0, usd: 0, count: 0 }; }
    var b = { overdue: bucket(), today: bucket(), week: bucket(), month: bucket() };
    function add(target, event) {
      target.count++;
      if (String(event.currency || "UGX").toUpperCase() === "USD") target.usd += num(event.amount);
      else target.ugx += num(event.amount);
    }
    scheduledEvents(doc, false).forEach(function (event) {
      var due = parseLocalDate(event.date);
      if (!due) return;
      var days = daysBetween(today, due);
      if (days == null) return;
      if (days < 0) { add(b.overdue, event); return; }
      if (days === 0) add(b.today, event);
      if (days <= 6) add(b.week, event);
      if (due <= endMonth) add(b.month, event);
    });
    return b;
  }

  function igSummaryHTML(stats, periods) {
    function amounts(ugx, usd) {
      var parts = [];
      if (ugx) parts.push(esc(money(ugx, "UGX", true)));
      if (usd) parts.push(esc(money(usd, "USD", true)));
      // An empty period reads as a dash; "UGX 0" is noise next to a sub
      // line that already says nothing is due.
      return parts.length ? parts.join(" + ") : '<span class="ig-stat-empty">—</span>';
    }
    function tile(label, primary, sub, tone) {
      return '<div class="ig-stat' + (tone ? " ig-stat-" + tone : "") + '">' +
        '<div class="ig-stat-label"><i class="ig-stat-dot"></i>' + esc(label) + '</div>' +
        '<div class="ig-stat-value tabnum">' + primary + '</div>' +
        '<div class="ig-stat-sub">' + sub + '</div>' +
      '</div>';
    }
    function payments(n) { return n + (n === 1 ? " payment" : " payments"); }
    return '<div class="ig-summary">' +
      tile("Overdue", amounts(periods.overdue.ugx, periods.overdue.usd),
        periods.overdue.count ? payments(periods.overdue.count) + " late" : "Nothing late",
        periods.overdue.count ? "bad" : "good") +
      tile("Due today", amounts(periods.today.ugx, periods.today.usd),
        periods.today.count ? payments(periods.today.count) : "Nothing today", periods.today.count ? "warn" : "") +
      tile("This week", amounts(periods.week.ugx, periods.week.usd),
        periods.week.count ? payments(periods.week.count) + " to " + esc(formatDate(dateISO(addDays(todayDate(), 6)), true)) : "Nothing this week",
        periods.week.count ? "warn" : "") +
      tile("This month", amounts(periods.month.ugx, periods.month.usd),
        periods.month.count ? payments(periods.month.count) + " by " + esc(formatDate(dateISO(endOfMonth(todayDate())), true)) : "Nothing this month", "") +
      tile("Outstanding", amounts(stats.outstandingUGX, stats.outstandingUSD),
        stats.open.length + " open · " + stats.unscheduled.length + " undated", "total") +
    '</div>';
  }

  function renderUpcoming(doc) {
    igSyncPersisted();
    igRefreshFrozenMap();
    var all = doc.followups || [];
    var filtered = sortFollowups(all.filter(function (item) { return followupMatches(item, doc); }), doc);
    // A row you just created belongs at the top, not wherever urgency sort
    // files a deal with no amount and no date yet.
    if (gridState.quickEntry) {
      var qi = filtered.findIndex(function (x) { return String(x.id) === String(gridState.quickEntry); });
      if (qi > 0) filtered.unshift(filtered.splice(qi, 1)[0]);
    }
    var stats = collectionStats(doc);
    var rows = igBuildRows(doc, filtered);
    gridState.rows = rows;
    gridState.filteredCount = filtered.length;
    gridState.order = rows.map(function (r) { return r.id; });
    gridState.byId = {};
    rows.forEach(function (r) { gridState.byId[r.id] = r; });
    if (gridState.active && !gridState.byId[gridState.active.rowId]) gridState.active = null;
    if (gridState.editing && !gridState.byId[gridState.editing.rowId]) gridState.editing = null;

    var clientNames = Array.from(new Set(all.map(function (x) { return x.client; }).filter(Boolean))).sort();
    var datalist = '<datalist id="ig-client-list">' + clientNames.map(function (n) { return '<option value="' + attr(n) + '">'; }).join("") + '</datalist>';
    var bodyRows = rows.length ? rows.map(igRowHTML).join("") : "";
    var empty = rows.length ? "" : '<div class="ig-empty">' + icon("search", 24) + '<strong>No rows in this view</strong><p>Clear filters or add a row to get started.</p><button class="x97-btn primary" data-x97-action="grid-add-row">' + icon("plus") + ' Add row</button></div>';

    root.innerHTML = '<div class="ig-shell">' +
      pageHeader("Collections", "Incoming", "", '<button class="x97-icon-btn x97-add-primary" data-x97-action="grid-add-row" title="Add row">' + icon("plus") + '<span>Add row</span></button>') +
      igSummaryHTML(stats, igPeriodStats(doc)) +
      igToolbarHTML() +
      igQuickViewsHTML(stats) +
      (activeFilterCount() ? '<div class="ig-filterchips">' + filterTagHTML() + '</div>' : "") +
      igFormulaBarHTML() +
      '<div class="ig-gridwrap" id="ig-gridwrap"><div class="ig-scroll" id="ig-scroll" tabindex="0" role="grid" aria-rowcount="' + rows.length + '" aria-label="Incoming receivables">' +
        '<div class="ig-grid-inner" id="ig-grid-inner" style="' + igLayoutStyle() + '">' + igHeaderHTML() + '<div class="ig-body" id="ig-body">' + bodyRows + '</div><div class="ig-filler" id="ig-filler" aria-hidden="true"></div><div id="ig-range-frame" class="ig-range-frame" aria-hidden="true"></div></div>' +
        empty +
      '</div></div>' +
      igStatusBarHTML(filtered.length, all.length, stats) +
      datalist +
    '</div>';

    mountIncomingGrid();
  }

  /* ── Grid interaction controller ─────────────────────────────────────── */

  function igIndexDom(body) {
    gridState.rowEls = {}; gridState.cellEls = {};
    Array.prototype.slice.call(body.children).forEach(function (rowEl) {
      var rid = rowEl.getAttribute("data-row-id");
      gridState.rowEls[rid] = rowEl;
      var map = {};
      Array.prototype.slice.call(rowEl.children).forEach(function (cellEl) {
        map[cellEl.getAttribute("data-col") || "__rownum"] = cellEl;
      });
      gridState.cellEls[rid] = map;
    });
  }

  function igColLabel(key) { var c = igColDef(key); return c ? c.label : key; }

  function igClearActiveClasses() {
    (gridState.selEls || []).forEach(function (el) { el.classList.remove("ig-in-range"); });
    if (gridState.activeEl) {
      gridState.activeEl.classList.remove("ig-active");
      var oldHandle = gridState.activeEl.querySelector(".ig-fill-handle");
      if (oldHandle) oldHandle.remove();
    }
    if (gridState.activeRowEl) gridState.activeRowEl.classList.remove("ig-row-active");
    if (gridState.activeHeadEl) gridState.activeHeadEl.classList.remove("ig-col-active");
    gridState.selEls = []; gridState.activeEl = null; gridState.activeRowEl = null; gridState.activeHeadEl = null;
  }

  function igRangeBounds() {
    if (!gridState.active) return null;
    var a = gridState.anchor || gridState.active;
    var cols = igVisibleCols().map(function (c) { return c.key; });
    var ai = cols.indexOf(a.col), fi = cols.indexOf(gridState.active.col);
    var ri = gridState.order.indexOf(a.rowId), fr = gridState.order.indexOf(gridState.active.rowId);
    if (ai < 0 || fi < 0 || ri < 0 || fr < 0) return null;
    return { c0: Math.min(ai, fi), c1: Math.max(ai, fi), r0: Math.min(ri, fr), r1: Math.max(ri, fr), cols: cols };
  }

  function igUpdateFormulaBar() {
    var ref = document.getElementById("ig-cell-ref"), input = document.getElementById("ig-formula-input");
    if (!ref || !input) return;
    if (!gridState.active) { ref.textContent = "—"; input.value = ""; input.disabled = true; input.placeholder = "Select a cell"; return; }
    var row = gridState.byId[gridState.active.rowId], col = igColDef(gridState.active.col);
    if (!row || !col) return;
    ref.textContent = (row.client || "Row " + row.index) + " · " + col.label;
    var editable = igEditable(col, row);
    input.disabled = !editable;
    input.placeholder = editable ? "Type to edit, Enter to commit" : "Read-only — set on the deal";
    if (document.activeElement !== input) input.value = igRawValue(row, col.key);
  }

  function igUpdateRangeFrame(bounds) {
    var frame = document.getElementById("ig-range-frame");
    if (!frame) return;
    var single = !bounds || (bounds.r0 === bounds.r1 && bounds.c0 === bounds.c1);
    if (single) { frame.style.display = "none"; return; }
    var tl = gridState.cellEls[gridState.order[bounds.r0]] && gridState.cellEls[gridState.order[bounds.r0]][bounds.cols[bounds.c0]];
    var br = gridState.cellEls[gridState.order[bounds.r1]] && gridState.cellEls[gridState.order[bounds.r1]][bounds.cols[bounds.c1]];
    if (!tl || !br) { frame.style.display = "none"; return; }
    frame.style.display = "block";
    frame.style.left = tl.offsetLeft + "px";
    frame.style.top = tl.offsetTop + "px";
    frame.style.width = (br.offsetLeft + br.offsetWidth - tl.offsetLeft) + "px";
    frame.style.height = (br.offsetTop + br.offsetHeight - tl.offsetTop) + "px";
  }

  // What a marquee of numbers is worth — Sheets' Sum/Count status strip.
  // Split by currency, since adding UGX to USD would just be wrong.
  function igSelectionStats(bounds) {
    if (!bounds || (bounds.r0 === bounds.r1 && bounds.c0 === bounds.c1)) return null;
    var count = 0, sums = { UGX: 0, USD: 0 }, numericCount = 0;
    for (var r = bounds.r0; r <= bounds.r1; r++) {
      var row = gridState.byId[gridState.order[r]];
      if (!row) continue;
      for (var c = bounds.c0; c <= bounds.c1; c++) {
        var col = igColDef(bounds.cols[c]);
        count++;
        if (col && col.type === "money") { sums[row.currency === "USD" ? "USD" : "UGX"] += num(row[col.key]); numericCount++; }
      }
    }
    return { count: count, numericCount: numericCount, sums: sums };
  }
  function igUpdateSelectionStats(bounds) {
    var el = document.getElementById("ig-selstats");
    if (!el) return;
    var s = igSelectionStats(bounds);
    if (!s || !s.numericCount) { el.hidden = true; el.innerHTML = ""; return; }
    var parts = [];
    if (s.sums.UGX) parts.push(esc(money(s.sums.UGX, "UGX", true)));
    if (s.sums.USD) parts.push(esc(money(s.sums.USD, "USD", true)));
    el.innerHTML = '<span>Count <b class="tabnum">' + s.count + '</b></span><span>Sum <b class="tabnum">' + (parts.join(" + ") || "0") + '</b></span>';
    el.hidden = false;
  }

  function igPaintActive() {
    igClearActiveClasses();
    if (!gridState.active || !gridState.byId[gridState.active.rowId]) { igUpdateFormulaBar(); igUpdateRangeFrame(null); igUpdateSelectionStats(null); return; }
    var bounds = igRangeBounds();
    if (bounds) {
      for (var r = bounds.r0; r <= bounds.r1; r++) {
        var rid = gridState.order[r];
        for (var c = bounds.c0; c <= bounds.c1; c++) {
          var el = gridState.cellEls[rid] && gridState.cellEls[rid][bounds.cols[c]];
          if (el) { el.classList.add("ig-in-range"); gridState.selEls.push(el); }
        }
      }
    }
    var activeEl = gridState.cellEls[gridState.active.rowId] && gridState.cellEls[gridState.active.rowId][gridState.active.col];
    if (activeEl) {
      activeEl.classList.add("ig-active"); gridState.activeEl = activeEl;
      // The fill handle only makes sense on a value you can type into, and
      // only when nothing is in the way of dragging it.
      var col = igColDef(gridState.active.col), row = gridState.byId[gridState.active.rowId];
      if (col && row && igEditable(col, row) && !gridState.editing) {
        var handle = document.createElement("div");
        handle.className = "ig-fill-handle";
        activeEl.appendChild(handle);
      }
    }
    var rowEl = gridState.rowEls[gridState.active.rowId];
    if (rowEl) { rowEl.classList.add("ig-row-active"); gridState.activeRowEl = rowEl; }
    var headEl = document.querySelector('.ig-colhead[data-colhead="' + gridState.active.col + '"]');
    if (headEl) { headEl.classList.add("ig-col-active"); gridState.activeHeadEl = headEl; }
    igUpdateFormulaBar();
    igUpdateRangeFrame(bounds);
    igUpdateSelectionStats(bounds);
  }

  function igScrollCellIntoView(rowId, col) {
    var el = gridState.cellEls[rowId] && gridState.cellEls[rowId][col];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function igSetActive(rowId, col, opts) {
    opts = opts || {};
    if (gridState.editing && !(gridState.editing.rowId === rowId && gridState.editing.col === col)) igCommitEdit();
    // Moving off a freshly added row ends its fast-entry run: it stops being
    // pinned to the top and takes its place in the sort like any other row.
    if (gridState.quickEntry && String(rowId) !== String(gridState.quickEntry)) gridState.quickEntry = null;
    if (!opts.extend) gridState.anchor = { rowId: rowId, col: col };
    gridState.active = { rowId: rowId, col: col };
    igPaintActive();
    if (!opts.silent) igScrollCellIntoView(rowId, col);
  }

  function igSelectCellFromEl(cell, extend) {
    var rowId = cell.getAttribute("data-row"), col = cell.getAttribute("data-col");
    if (!rowId || !col) return;
    igSetActive(rowId, col, { extend: extend });
  }

  function igMoveAfterCommit(direction) {
    if (!gridState.active) return;
    var cols = igVisibleCols().map(function (c) { return c.key; });
    var ci = cols.indexOf(gridState.active.col), ri = gridState.order.indexOf(gridState.active.rowId);
    if (direction === "auto") direction = gridState.quickEntry === gridState.active.rowId ? "right" : "down";
    if (direction === "down") ri = Math.min(gridState.order.length - 1, ri + 1);
    else if (direction === "up") ri = Math.max(0, ri - 1);
    else if (direction === "right") ci = Math.min(cols.length - 1, ci + 1);
    else if (direction === "left") ci = Math.max(0, ci - 1);
    var rid = gridState.order[ri], key = cols[ci];
    if (rid && key) igSetActive(rid, key);
  }
  function igStep(extend, dr, dc) {
    if (!gridState.active) return;
    var cols = igVisibleCols().map(function (c) { return c.key; });
    var base = gridState.active;
    var ci = Math.max(0, Math.min(cols.length - 1, cols.indexOf(base.col) + dc));
    var ri = Math.max(0, Math.min(gridState.order.length - 1, gridState.order.indexOf(base.rowId) + dr));
    var rid = gridState.order[ri], key = cols[ci];
    if (rid && key) igSetActive(rid, key, { extend: extend });
  }

  function igRepaintCell(rowId, colKey) {
    var row = gridState.byId[rowId], col = igColDef(colKey), cell = gridState.cellEls[rowId] && gridState.cellEls[rowId][colKey];
    if (!row || !col || !cell) return;
    cell.classList.remove("ig-editing");
    cell.className = igCellClass(col, row);
    cell.title = igCellText(col, row);
    cell.innerHTML = igCellInner(col, row);
    if (gridState.active && gridState.active.rowId === rowId && gridState.active.col === colKey) {
      cell.classList.add("ig-active");
      if (igEditable(col, row)) cell.appendChild(Object.assign(document.createElement("div"), { className: "ig-fill-handle" }));
    }
  }

  function igFlushPendingExternalRender() {
    if (gridState.pendingExternalRender) { gridState.pendingExternalRender = false; scheduleRender(0); }
  }

  /* Typing a figure into Paid (or Balance, which is its mirror) has to leave
     the payment ledger telling the truth, because the dashboard, receipts
     and account balances all read from it. Raising the figure records a
     payment for the difference; lowering it reverses the most recent
     payments until the totals agree again. */
  /* Changing the schedule shape in the cell. The deal's total is what the
     user already agreed with the client, so it is held constant and the
     instalments are rebuilt underneath it; anything already received stays
     recorded and is re-allocated across the new instalments. */
  var IG_STRUCT_COUNT = { deposit: 2, split: 2, custom: 2, monthly: 3, part: 2 };
  function igApplyStructure(doc, item, label) {
    var type = normalizeDealType(label), now = normalizeDealType(item.dealType);
    if (type === now && (type === "one" || Array.isArray(item.parts))) return true;
    var gross = grossOf(item);
    if (type === "one") {
      item.gross = gross; item.paid = paidOf(item); item.amount = roundMoney(Math.max(0, gross - item.paid));
      if (Array.isArray(item.parts) && item.parts.length && !item.expectedBy) item.expectedBy = item.parts[0].dueDate || "";
      ["dealType", "parts", "partLabel", "partCount", "partEvery", "partAmount", "depositAmount"].forEach(function (k) { delete item[k]; });
      return true;
    }
    var count = IG_STRUCT_COUNT[type] || 2;
    // monthly and per-part price each instalment, so the unit is the share.
    var unit = type === "monthly" || type === "part" ? roundMoney(gross / count) : gross;
    var values = { dealType: type, amount: unit, partCount: count, startDate: item.expectedBy || todayISO(), partEvery: item.partEvery || 7 };
    if (type === "custom") { values.partAmount_0 = roundMoney(gross / 2); values.partAmount_1 = roundMoney(gross - roundMoney(gross / 2)); }
    var parts = dealPartsFor(Object.assign({}, item, { parts: null }), values);
    item.dealType = type;
    item.partLabel = type === "monthly" ? "months" : "parts";
    item.parts = parts;
    item.partCount = parts.length;
    item.partEvery = values.partEvery;
    item.partAmount = parts[0] ? num(parts[0].amount) : 0;
    item.depositAmount = type === "deposit" ? num(parts[0] && parts[0].amount) : 0;
    rebuildDealParts(doc, item);
    return true;
  }

  function igSetPaidTotal(doc, item, target) {
    var gross = grossOf(item);
    target = Math.max(0, Math.min(roundMoney(target), gross));
    if (Math.abs(target - paidOf(item)) < 0.5) return true;
    if (target > paidOf(item)) {
      return !!applyPayment(doc, item.id, { amount: roundMoney(target - paidOf(item)), date: todayISO(), accountId: "", note: "Entered in sheet" });
    }
    var newestFirst = paymentsFor(doc, item.id).slice().sort(function (a, b) {
      return String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""));
    });
    for (var i = 0; i < newestFirst.length && paidOf(item) > target + 0.5; i++) reversePayment(doc, newestFirst[i].id);
    if (paidOf(item) > target + 0.5) {
      // Older records carried a paid figure with no ledger entry behind it.
      item.paid = roundMoney(target);
      item.amount = roundMoney(Math.max(0, gross - target));
      rebuildDealParts(doc, item);
    } else if (paidOf(item) < target - 0.5) {
      applyPayment(doc, item.id, { amount: roundMoney(target - paidOf(item)), date: todayISO(), accountId: "", note: "Entered in sheet" });
    }
    return true;
  }

  function igMutateField(doc, item, colKey, value) {
    if (colKey === "client") { item.client = String(value || "").trim(); return true; }
    if (colKey === "category") { item.category = String(value || "").trim() || "One Time"; return true; }
    if (colKey === "phone") { item.phone = String(value || "").trim(); return true; }
    if (colKey === "note") { item.note = String(value || "").trim(); return true; }
    // Switching currency on a deal that has money against it converts the
    // figures at the live rate instead of silently re-labelling them; the
    // receipts in the ledger keep the currency they were taken in.
    if (colKey === "currency") {
      var nextCur = String(value || "UGX").toUpperCase(), curNow = String(item.currency || "UGX").toUpperCase();
      if (nextCur !== "UGX" && nextCur !== "USD") return igFail("Currency is UGX or USD");
      if (nextCur === curNow) return true;
      if (dealHasRecordedMoney(item)) {
        var rate = fxConvert(1, curNow, nextCur);
        if (!rate) {
          // No rate to convert with. Never re-label money silently — say what
          // is about to happen and let the user decide.
          if (!confirm("There is no live " + curNow + "→" + nextCur + " rate right now.\n\nSwitch this deal to " + nextCur + " and leave the figures exactly as they are?")) {
            return igFail("Kept in " + curNow + " — no live rate to convert with");
          }
          item.currency = nextCur;
          return true;
        }
        if (Array.isArray(item.parts)) item.parts.forEach(function (p) {
          p.amount = roundMoney(num(p.amount) * rate);
          p.paid = roundMoney(num(p.paid) * rate);
        });
        item.gross = roundMoney(grossOf(item) * (Array.isArray(item.parts) && item.parts.length ? 1 : rate));
        item.paid = roundMoney(paidOf(item) * rate);
        item.amount = roundMoney(Math.max(0, grossOf(item) - item.paid));
      }
      item.currency = nextCur;
      return true;
    }
    // A new total on a schedule rescales its parts in proportion, never
    // below what a part has already taken in.
    if (colKey === "gross") {
      var g = roundMoney(value);
      if (g <= 0) return igFail("Enter the deal total");
      var paidNow = paidOf(item);
      if (g < paidNow - 0.5) return igFail("That total is below the " + money(paidNow, String(item.currency || "UGX").toUpperCase()) + " already received");
      if (Array.isArray(item.parts) && item.parts.length) {
        var oldGross = grossOf(item) || g, scale = g / oldGross;
        item.parts.forEach(function (p) { p.amount = roundMoney(Math.max(num(p.paid), num(p.amount) * scale)); });
        rebuildDealParts(doc, item);
        return true;
      }
      item.gross = g; item.paid = paidNow; item.amount = roundMoney(Math.max(0, g - paidNow));
      if (!isCancelled(item.status)) item.status = paidNow <= 0 ? "Pending" : paidNow >= g - 0.5 ? "Paid" : "Part Paid";
      return true;
    }
    // The date on the row is the next unpaid instalment's date, so that is
    // the one a new date lands on.
    if (colKey === "due") {
      if (Array.isArray(item.parts) && item.parts.length) {
        var target = item.parts.filter(function (p) { return num(p.paid) < num(p.amount) - 0.5; })[0] || item.parts[0];
        target.dueDate = value;
        rebuildDealParts(doc, item);
      } else item.expectedBy = value;
      return true;
    }
    // Re-dating the last receipt in the cell, rather than in a form behind it.
    if (colKey === "lastPaid") {
      var log = paymentsFor(doc, item.id);
      if (!log.length) { item.paidOn = value || ""; return true; }
      var newestPay = log.slice().sort(function (a, b) {
        return String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""));
      })[0];
      if (newestPay) newestPay.date = value || newestPay.date;
      item.paidOn = value || item.paidOn;
      return true;
    }
    // Money on a cancelled deal reopens it — recording a receipt against
    // something cancelled is the clearest possible statement that it isn't.
    if (colKey === "paid") {
      if (isCancelled(item.status) && roundMoney(value) > 0) item.status = "Pending";
      return igSetPaidTotal(doc, item, value);
    }
    // Balance is Paid seen from the other side: say what is still owed and
    // the received figure follows.
    if (colKey === "balance") {
      var wantPaid = grossOf(item) - roundMoney(value);
      if (isCancelled(item.status) && wantPaid > 0) item.status = "Pending";
      return igSetPaidTotal(doc, item, wantPaid);
    }
    // The shape of the schedule is a cell like any other: pick a different
    // one and the instalments are rebuilt around the same total.
    if (colKey === "structure") return igApplyStructure(doc, item, value);
    if (colKey === "status") {
      if (/cancel/i.test(String(value))) { item.status = "Cancelled"; return true; }
      // Reopening hands the status back to whatever the money says it is.
      item.status = paidOf(item) <= 0 ? "Pending" : outstandingOf(item) > 0 ? "Part Paid" : "Paid";
      return true;
    }
    return false;
  }
  // Any row id resolves to the deal that owns it; an instalment row also
  // resolves to its part.
  function igOwnerId(rowId) {
    var row = gridState.byId[rowId];
    return row && row.parentId ? row.parentId : rowId;
  }
  function igPartOf(item, partId) {
    return (Array.isArray(item.parts) ? item.parts : []).filter(function (p) { return String(p.id) === String(partId); })[0] || null;
  }
  /* Money against an instalment. Receipts are allocated in order — part 1
     first — so "part 3 has taken X" means everything before it is settled
     and X has landed on it. Saying so in the cell sets the deal's received
     total to exactly that, which the ledger then re-allocates. */
  function igSetPartPaid(doc, item, part, value) {
    var parts = Array.isArray(item.parts) ? item.parts : [];
    var idx = parts.map(function (p) { return String(p.id); }).indexOf(String(part.id));
    if (idx < 0) return igFail("That instalment is no longer there");
    var before = 0;
    for (var i = 0; i < idx; i++) before += num(parts[i].amount);
    var want = Math.max(0, Math.min(roundMoney(value), num(part.amount)));
    return igSetPaidTotal(doc, item, roundMoney(before + want));
  }
  function igMutatePart(doc, item, partId, colKey, value) {
    var part = igPartOf(item, partId);
    if (!part) return igFail("That instalment is no longer there");
    if (colKey === "client") { part.label = String(value || "").trim() || part.label; return true; }
    if (colKey === "gross") {
      var amount = roundMoney(value);
      if (amount <= 0) return igFail("Enter the instalment amount");
      if (amount < num(part.paid) - 0.5) return igFail("That is below the " + money(num(part.paid), String(item.currency || "UGX").toUpperCase()) + " already taken on this instalment");
      part.amount = amount;
      rebuildDealParts(doc, item);
      return true;
    }
    if (colKey === "due") { part.dueDate = value || ""; rebuildDealParts(doc, item); return true; }
    if (colKey === "paid") return igSetPartPaid(doc, item, part, value);
    if (colKey === "balance") return igSetPartPaid(doc, item, part, num(part.amount) - roundMoney(value));
    if (colKey === "status") {
      if (/paid/i.test(String(value)) && !/part/i.test(String(value))) return igSetPartPaid(doc, item, part, num(part.amount));
      if (/pending/i.test(String(value))) return igSetPartPaid(doc, item, part, 0);
      return igFail("An instalment is Pending or Paid");
    }
    if (colKey === "lastPaid") { part.paidOn = value || ""; return true; }
    // Everything else on an instalment row belongs to the deal it sits under.
    return igMutateField(doc, item, colKey, value);
  }

  /* Editing a cell used to rebuild the entire screen: at 60 deals with a
     12-payment schedule each — 420 rows, 4,600 cells — that was a third of a
     second per keystroke on a laptop and near a second on a phone. An edit
     now rewrites only the rows of the deal it touched, plus the strips that
     read from totals, and leaves the row order alone: rows stop jumping
     around underneath the cursor mid-edit, exactly as they don't in Sheets.
     The order refreshes on the next filter, sort, or reload. */
  var igSuppressRender = false;
  function igIndexRow(rowEl) {
    var rid = rowEl.getAttribute("data-row-id");
    if (!rid) return;
    gridState.rowEls[rid] = rowEl;
    var map = {};
    Array.prototype.slice.call(rowEl.children).forEach(function (cellEl) {
      map[cellEl.getAttribute("data-col") || "__rownum"] = cellEl;
    });
    gridState.cellEls[rid] = map;
  }
  function igRowsOfDeal(dealId) {
    var prefix = String(dealId) + "::";
    return (gridState.order || []).filter(function (id) { return String(id) === String(dealId) || String(id).indexOf(prefix) === 0; });
  }
  // Returns false when the sheet has to be rebuilt after all (the deal is
  // gone, or its rows are not on screen).
  function igPatchDeal(doc, dealId) {
    var body = document.getElementById("ig-body");
    if (!body) return false;
    var oldIds = igRowsOfDeal(dealId);
    if (!oldIds.length) return false;
    var firstEl = gridState.rowEls[oldIds[0]];
    if (!firstEl || !firstEl.parentNode) return false;
    var item = (doc.followups || []).find(function (x) { return String(x.id) === String(dealId); });
    if (!item) return false;
    var at = gridState.order.indexOf(oldIds[0]);
    var parent = igBuildRow(item, doc, gridState.byId[dealId] ? gridState.byId[dealId].index : at + 1);
    var parts = Array.isArray(item.parts) ? item.parts : [];
    parent.hasParts = parts.length > 0;
    parent.collapsed = parent.hasParts && igCollapsed(item.id);
    var fresh = [parent];
    if (parent.hasParts && !parent.collapsed) {
      parts.forEach(function (part, pi) { fresh.push(igBuildPartRow(parent, item, part, doc, pi + 1, parts.length)); });
    }
    var holder = document.createElement("div");
    holder.innerHTML = fresh.map(igRowHTML).join("");
    var newEls = Array.prototype.slice.call(holder.children);
    newEls.forEach(function (el) { firstEl.parentNode.insertBefore(el, firstEl); });
    oldIds.forEach(function (id) {
      var el = gridState.rowEls[id];
      if (el && el.parentNode) el.parentNode.removeChild(el);
      delete gridState.rowEls[id];
      delete gridState.cellEls[id];
      delete gridState.byId[id];
    });
    newEls.forEach(igIndexRow);
    gridState.order.splice(at, oldIds.length);
    gridState.rows.splice(at, oldIds.length);
    fresh.forEach(function (r, i) {
      gridState.order.splice(at + i, 0, r.id);
      gridState.rows.splice(at + i, 0, r);
      gridState.byId[r.id] = r;
    });
    // A selection sitting on an instalment that no longer exists moves to
    // the deal itself rather than vanishing.
    if (gridState.active && !gridState.byId[gridState.active.rowId]) gridState.active = { rowId: dealId, col: gridState.active.col };
    if (gridState.anchor && !gridState.byId[gridState.anchor.rowId]) gridState.anchor = gridState.active;
    return true;
  }
  function igPatchChrome(doc) {
    if (!root) return;
    var stats = collectionStats(doc);
    var summary = root.querySelector(".ig-summary");
    if (summary) summary.outerHTML = igSummaryHTML(stats, igPeriodStats(doc));
    var quick = root.querySelector(".ig-quickviews");
    if (quick) quick.outerHTML = igQuickViewsHTML(stats);
    var status = root.querySelector(".ig-statusbar");
    if (status) status.outerHTML = igStatusBarHTML(gridState.filteredCount || 0, (doc.followups || []).length, stats);
    // Undo availability and the collapse-all direction both live in the
    // toolbar and both move with an edit — but never rebuild it out from
    // under someone typing in the search box.
    var toolbar = root.querySelector(".ig-toolbar");
    if (toolbar && document.activeElement !== document.getElementById("x97-up-search")) toolbar.outerHTML = igToolbarHTML();
  }
  // One write, then a repaint of just what moved.
  function igWritePatched(mutator, reason, dealIds) {
    igSuppressRender = true;
    var ok;
    try { ok = updateDoc(mutator, reason, true); } finally { igSuppressRender = false; }
    if (!ok) return false;
    var doc = readDoc();
    var whole = false;
    dealIds.forEach(function (id) { if (!igPatchDeal(doc, id)) whole = true; });
    if (whole) { scheduleRender(0); return true; }
    igPatchChrome(doc);
    igPaintActive();
    igFillEmptyRows();
    return true;
  }

  function igDealsOf(rowIds) {
    var seenDeals = {}, out = [];
    (rowIds || []).forEach(function (rid) {
      var owner = igOwnerId(rid);
      if (!seenDeals[owner]) { seenDeals[owner] = true; out.push(owner); }
    });
    return out;
  }

  // Every batched write — fill, clear, paste — goes through the same door as
  // a typed edit, so an instalment row is written as an instalment.
  function igWriteRow(doc, byId, rowId, key, value) {
    var gridRow = gridState.byId[rowId], item = byId[igOwnerId(rowId)];
    if (!item) return false;
    return gridRow && gridRow.partId ? igMutatePart(doc, item, gridRow.partId, key, value) : igMutateField(doc, item, key, value);
  }

  // A refusal should say what it wants, not just "locked". Mutators leave
  // their reason here and the caller shows it.
  function igFail(message) { gridState.editError = message || ""; return false; }
  function igEditErrorFor(colKey) {
    var msg = gridState.editError;
    gridState.editError = "";
    return msg || (colKey === "gross" ? "Enter the deal total" : "That value was not accepted");
  }
  function igApplyCellValue(rowId, colKey, value) {
    var applied = true;
    gridState.editError = "";
    var row = gridState.byId[rowId], ownerId = igOwnerId(rowId), partId = row && row.partId;
    igWritePatched(function (doc) {
      var item = (doc.followups || []).find(function (x) { return String(x.id) === String(ownerId); });
      if (!item) { applied = false; return; }
      applied = partId ? igMutatePart(doc, item, partId, colKey, value) : igMutateField(doc, item, colKey, value);
    }, "grid-edit", [ownerId]);
    return applied;
  }

  function igPushUndo(rowId) {
    var doc = readDoc(), ownerId = igOwnerId(rowId);
    var item = doc && (doc.followups || []).find(function (x) { return String(x.id) === String(ownerId); });
    gridState.undoStack.push({ rowId: ownerId, snapshot: item ? clone(item) : null, existed: !!item });
    if (gridState.undoStack.length > 50) gridState.undoStack.shift();
    gridState.redoStack = [];
  }
  function igRestoreSnapshot(entry) {
    updateDoc(function (d) {
      var idx = d.followups.findIndex(function (x) { return String(x.id) === String(entry.rowId); });
      if (entry.existed) { if (idx >= 0) d.followups[idx] = entry.snapshot; else d.followups.unshift(entry.snapshot); }
      else if (idx >= 0) d.followups.splice(idx, 1);
    }, "grid-undo", true);
  }
  function igUndo() {
    var entry = gridState.undoStack.pop();
    if (!entry) return;
    var doc = readDoc(), i = doc.followups.findIndex(function (x) { return String(x.id) === String(entry.rowId); });
    gridState.redoStack.push({ rowId: entry.rowId, snapshot: i >= 0 ? clone(doc.followups[i]) : null, existed: i >= 0 });
    igRestoreSnapshot(entry);
  }
  function igRedo() {
    var entry = gridState.redoStack.pop();
    if (!entry) return;
    igRestoreSnapshot(entry);
  }

  function igBeginEdit(rowId, colKey) {
    var row = gridState.byId[rowId], col = igColDef(colKey);
    if (!row || !col || !igEditable(col, row)) return;
    if (gridState.editing) igCommitEdit();
    var cell = gridState.cellEls[rowId] && gridState.cellEls[rowId][colKey];
    if (!cell) return;
    gridState.editing = { rowId: rowId, col: colKey };
    if (colKey === "currency") {
      var current = igRawValue(row, colKey);
      cell.classList.add("ig-editing");
      cell.innerHTML = '<div class="ig-cur-toggle">' +
        '<button type="button" class="ig-cur-opt ig-cur-ugx' + (current === "UGX" ? " on" : "") + '" data-cur="UGX">UGX</button>' +
        '<button type="button" class="ig-cur-opt ig-cur-usd' + (current === "USD" ? " on" : "") + '" data-cur="USD">USD</button>' +
      '</div>';
      Array.prototype.slice.call(cell.querySelectorAll(".ig-cur-opt")).forEach(function (btn) {
        btn.addEventListener("click", function (e) { e.stopPropagation(); igCommitCurrencyChoice(rowId, btn.getAttribute("data-cur")); });
        btn.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); igCancelEdit(); } });
      });
      var firstOpt = cell.querySelector(".ig-cur-opt");
      if (firstOpt) setTimeout(function () { firstOpt.focus(); }, 0);
      return;
    }
    var value = igRawValue(row, colKey), inputHTML;
    if (colKey === "status" && row.part) {
      // An instalment is settled or it is not; there is no cancelling one
      // half of a deal.
      inputHTML = '<select class="ig-edit-input">' +
        option("Pending", "Pending", row.status === "Pending" ? "Pending" : "") +
        option("Paid", "Paid", row.status === "Paid" ? "Paid" : "") +
      '</select>';
    }
    else if (colKey === "status") {
      // Paid and Part Paid are what the money says, so they are shown but
      // not choosable; cancelling and reopening are the real decisions.
      inputHTML = '<select class="ig-edit-input">' +
        (row.status === "Paid" || row.status === "Part Paid" ? '<option value="' + attr(row.status) + '" selected>' + esc(row.status) + '</option>' : "") +
        option("Pending", "Pending", row.status === "Pending" ? "Pending" : "") +
        option("Cancelled", "Cancelled", row.status === "Cancelled" ? "Cancelled" : "") +
      '</select>';
    }
    else if (colKey === "structure") {
      inputHTML = '<select class="ig-edit-input">' + Object.keys(DEAL_TYPES).map(function (key) {
        return option(DEAL_TYPES[key], DEAL_TYPES[key], value);
      }).join("") + '</select>';
    }
    else if (col.type === "date") inputHTML = '<input class="ig-edit-input" type="date" value="' + attr(value) + '">';
    else if (colKey === "gross" || colKey === "paid" || colKey === "balance") inputHTML = '<input class="ig-edit-input ig-edit-num" type="number" inputmode="decimal" min="0" step="1" value="' + attr(roundMoney(value)) + '">';
    else if (colKey === "phone") inputHTML = '<input class="ig-edit-input" type="text" inputmode="tel" value="' + attr(value) + '">';
    else if (colKey === "client") inputHTML = '<input class="ig-edit-input" type="text" list="ig-client-list" value="' + attr(value) + '">';
    else inputHTML = '<input class="ig-edit-input" type="text" value="' + attr(value) + '">';
    cell.classList.add("ig-editing");
    cell.innerHTML = inputHTML;
    var input = cell.querySelector(".ig-edit-input");
    input.setAttribute("enterkeyhint", gridState.quickEntry === rowId ? "next" : "done");
    input.addEventListener("keydown", igEditKeydown);
    input.addEventListener("blur", igEditBlur);
    // Picking from a dropdown is the decision — it should not also need an
    // Enter or a tap elsewhere to stick.
    if (input.tagName === "SELECT") input.addEventListener("change", function () { igCommitEdit(); });
    setTimeout(function () {
      input.focus();
      if (input.select) input.select();
      // The keyboard animates in after focus; check again once it has.
      setTimeout(function () { if (gridState.editing) igScrollCellIntoView(gridState.editing.rowId, gridState.editing.col); }, 320);
    }, 0);
  }
  function igEditKeydown(e) {
    // These keys belong to the editor. Without stopping them here they also
    // reach the grid's own key handler, which — seeing the edit already
    // committed — would open a second editor on the cell below and let it
    // write its stale text back when the re-render tore it down.
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); igCommitEdit(); igMoveAfterCommit(e.shiftKey ? "up" : "auto"); }
    else if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); igCommitEdit(); igMoveAfterCommit(e.shiftKey ? "left" : "right"); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); igCancelEdit(); }
  }
  function igEditBlur(e) {
    // An input the render already threw away has nothing to say.
    if (e && e.target && !e.target.isConnected) { gridState.editing = null; return; }
    if (gridState.editing) igCommitEdit();
  }
  function igCancelEdit() {
    if (!gridState.editing) return;
    var e = gridState.editing; gridState.editing = null;
    igRepaintCell(e.rowId, e.col);
    igFlushPendingExternalRender();
  }
  function igCommitEdit() {
    if (!gridState.editing) return;
    var e = gridState.editing, rowId = e.rowId, colKey = e.col;
    var cell = gridState.cellEls[rowId] && gridState.cellEls[rowId][colKey];
    var input = cell && cell.querySelector(".ig-edit-input");
    // Some editors are not a single input — the currency picker is a pair of
    // buttons that commits on its own. With nothing to read there is nothing
    // to commit, and writing an empty value here would blank the cell.
    if (!input) { gridState.editing = null; igRepaintCell(rowId, colKey); igFlushPendingExternalRender(); return; }
    // Same rule for a detached editor: it holds a value from before the last
    // render and must never be written back.
    if (!input.isConnected) { gridState.editing = null; return; }
    var value = input.value;
    gridState.editing = null;
    var row = gridState.byId[rowId], col = igColDef(colKey);
    if (!row || !col) return;
    if (String(value).trim() === String(igRawValue(row, colKey)).trim()) { igRepaintCell(rowId, colKey); igFlushPendingExternalRender(); return; }
    igPushUndo(rowId);
    var ok = igApplyCellValue(rowId, colKey, value);
    if (!ok) { gridState.undoStack.pop(); igRepaintCell(rowId, colKey); toast(igEditErrorFor(colKey), "error"); }
  }
  function igCommitCurrencyChoice(rowId, value) {
    var row = gridState.byId[rowId];
    gridState.editing = null;
    if (!row || String(value) === String(row.currency)) { igRepaintCell(rowId, "currency"); igFlushPendingExternalRender(); return; }
    igPushUndo(rowId);
    var ok = igApplyCellValue(rowId, "currency", value);
    if (!ok) { gridState.undoStack.pop(); igRepaintCell(rowId, "currency"); toast(igEditErrorFor("currency"), "error"); }
  }

  function igActivateCell(rowId, colKey, wantsEdit) {
    var row = gridState.byId[rowId], col = igColDef(colKey);
    if (!row || !col) return;
    igSetActive(rowId, colKey);
    if (wantsEdit && igEditable(col, row)) igBeginEdit(rowId, colKey);
  }

  function igAddRow() {
    var doc = readDoc();
    var categories = (doc.settings && doc.settings.categories) || [];
    var id = uid("fu");
    // A blank row has no client and no date, so a narrow view or an active
    // search would file it somewhere the user cannot see. Open the view up
    // enough that the row they just asked for is the row they land on.
    if (["all", "open", "attention", "unscheduled"].indexOf(state.upcoming.quick) < 0) state.upcoming.quick = "open";
    if (state.upcoming.search) state.upcoming.search = "";
    if (state.upcoming.month !== "all") state.upcoming.month = "all";
    savePrefs();
    igPushUndo(id);
    updateDoc(function (d) {
      d.followups.unshift({ id: id, client: "", category: categories[0] || "One Time", gross: 0, paid: 0, amount: 0, currency: "UGX", status: "Pending", expectedBy: "", phone: "", note: "" });
    }, "grid-add-row", true);
    gridState.quickEntry = id;
    gridState.pendingFocusRow = id;
  }
  function igDeleteRow(rowId) {
    var gridRow = gridState.byId[rowId];
    var doc = readDoc(), item = doc && (doc.followups || []).find(function (x) { return String(x.id) === String(igOwnerId(rowId)); });
    if (!item) return;
    // On an instalment row, "delete row" means drop that instalment — the
    // deal keeps going with one fewer payment in its schedule.
    if (gridRow && gridRow.partId) {
      var part = igPartOf(item, gridRow.partId);
      if (!part) return;
      if (num(part.paid) > 0) { toast("That instalment has money on it", "error"); return; }
      if ((item.parts || []).length <= 1) { toast("A schedule needs at least one instalment", "error"); return; }
      if (!confirm('Remove "' + (part.label || "this instalment") + '" from the schedule?')) return;
      igPushUndo(rowId);
      updateDoc(function (d) {
        var target = (d.followups || []).find(function (x) { return String(x.id) === String(item.id); });
        if (!target) return;
        target.parts = (target.parts || []).filter(function (p) { return String(p.id) !== String(gridRow.partId); });
        target.partCount = target.parts.length;
        rebuildDealParts(d, target);
      }, "grid-delete-part", true);
      if (gridState.active && gridState.active.rowId === rowId) gridState.active = null;
      toast("Instalment removed", "success");
      return;
    }
    if (dealHasRecordedMoney(item)) { toast("A deal with recorded money cannot be deleted", "error"); return; }
    if (!confirm('Delete this row? "' + (item.client || "Untitled") + '"')) return;
    igPushUndo(rowId);
    updateDoc(function (d) { d.followups = d.followups.filter(function (x) { return String(x.id) !== String(rowId); }); }, "grid-delete-row", true);
    if (gridState.active && gridState.active.rowId === rowId) gridState.active = null;
    toast("Row deleted", "success");
  }

  /* Fill handle — drag the active cell's corner down (or up) a column to
     copy its value onto every cell it passes over, exactly like Sheets. One
     batched write on release, not one per row crossed. */
  function igFillPreview(fromIndex, toIndex, colKey) {
    igClearFillPreview();
    var lo = Math.min(fromIndex, toIndex), hi = Math.max(fromIndex, toIndex);
    for (var i = lo; i <= hi; i++) {
      var rid = gridState.order[i];
      var el = rid && gridState.cellEls[rid] && gridState.cellEls[rid][colKey];
      if (el) { el.classList.add("ig-fill-preview"); gridState.fillPreviewEls.push(el); }
    }
  }
  function igClearFillPreview() {
    (gridState.fillPreviewEls || []).forEach(function (el) { el.classList.remove("ig-fill-preview"); });
    gridState.fillPreviewEls = [];
  }
  function igCommitFill(startRowId, startIndex, endIndex, colKey, sourceValue) {
    var lo = Math.min(startIndex, endIndex), hi = Math.max(startIndex, endIndex);
    if (lo === hi) return;
    var col = igColDef(colKey), touched = [];
    for (var i = lo; i <= hi; i++) {
      var rid = gridState.order[i];
      if (!rid || String(rid) === String(startRowId)) continue;
      var row = gridState.byId[rid];
      if (row && igEditable(col, row)) touched.push(rid);
    }
    if (!touched.length) return;
    touched.forEach(function (rid) { igPushUndo(rid); });
    igWritePatched(function (doc) {
      var byId = {}; (doc.followups || []).forEach(function (it) { byId[it.id] = it; });
      touched.forEach(function (rid) { igWriteRow(doc, byId, rid, colKey, sourceValue); });
    }, "grid-fill", igDealsOf(touched));
    toast("Filled " + touched.length + " cell" + (touched.length === 1 ? "" : "s"), "success");
  }
  function igStartFillDrag(e) {
    if (!gridState.active || gridState.editing) return;
    var startRowId = gridState.active.rowId, colKey = gridState.active.col;
    var col = igColDef(colKey), row = gridState.byId[startRowId];
    if (!col || !row || !igEditable(col, row)) return;
    var sourceValue = igRawValue(row, colKey);
    var startIndex = gridState.order.indexOf(startRowId);
    if (startIndex < 0) return;
    var lastTarget = startIndex, moved = false;
    document.body.classList.add("ig-filling");
    function onMove(ev) {
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      var cell = el && el.closest && el.closest('.ig-cell[data-col="' + colKey + '"]');
      if (!cell) return;
      var rid = cell.getAttribute("data-row"), idx = gridState.order.indexOf(rid);
      if (idx < 0) return;
      moved = true; lastTarget = idx;
      igFillPreview(startIndex, idx, colKey);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.classList.remove("ig-filling");
      igClearFillPreview();
      if (moved) igCommitFill(startRowId, startIndex, lastTarget, colKey, sourceValue);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function igClearableKeys() { return { category: 1, phone: 1, note: 1, due: 1 }; }
  function igClearSelectionValues() {
    var bounds = igRangeBounds();
    if (!bounds) return;
    var clearable = igClearableKeys(), plan = [], seen = {};
    for (var c = bounds.c0; c <= bounds.c1; c++) {
      var key = bounds.cols[c];
      if (!clearable[key]) continue;
      for (var r = bounds.r0; r <= bounds.r1; r++) {
        var rid = gridState.order[r];
        if (!gridState.byId[rid]) continue;
        plan.push({ rowId: rid, key: key }); seen[rid] = true;
      }
    }
    if (!plan.length) return;
    Object.keys(seen).forEach(function (rid) { igPushUndo(rid); });
    igWritePatched(function (doc) {
      var byId = {}; (doc.followups || []).forEach(function (it) { byId[it.id] = it; });
      plan.forEach(function (p) { igWriteRow(doc, byId, p.rowId, p.key, ""); });
    }, "grid-clear", igDealsOf(Object.keys(seen)));
  }

  function igCopySelection() {
    var bounds = igRangeBounds();
    if (!bounds) return;
    var lines = [];
    for (var r = bounds.r0; r <= bounds.r1; r++) {
      var row = gridState.byId[gridState.order[r]], vals = [];
      for (var c = bounds.c0; c <= bounds.c1; c++) vals.push(igCellText(igColDef(bounds.cols[c]), row));
      lines.push(vals.join("\t"));
    }
    var text = lines.join("\n");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast("Copied", "success"); }, function () { igFallbackCopy(text); });
    else igFallbackCopy(text);
  }
  function igFallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Copied", "success"); } catch (_) {}
    document.body.removeChild(ta);
  }
  function igPasteClipboard() {
    if (!gridState.active) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) { toast("Use your device's paste gesture on the field", "error"); return; }
    navigator.clipboard.readText().then(function (text) {
      if (!text) return;
      var lines = text.replace(/\r/g, "").split("\n"); if (lines.length && lines[lines.length - 1] === "") lines.pop();
      var cols = igVisibleCols().map(function (c) { return c.key; });
      var ci0 = cols.indexOf(gridState.active.col), ri0 = gridState.order.indexOf(gridState.active.rowId), plan = [], touched = {};
      lines.forEach(function (line, r) {
        var rid = gridState.order[ri0 + r];
        if (!rid) return;
        line.split("\t").forEach(function (val, c) {
          var key = cols[ci0 + c];
          if (!key) return;
          var col = igColDef(key), row = gridState.byId[rid];
          if (!col || !row || !igEditable(col, row)) return;
          touched[rid] = true;
          plan.push({ rowId: rid, key: key, value: val });
        });
      });
      if (!plan.length) return;
      Object.keys(touched).forEach(function (rid) { igPushUndo(rid); });
      igWritePatched(function (doc) {
        var byId = {}; (doc.followups || []).forEach(function (it) { byId[it.id] = it; });
        plan.forEach(function (p) { igWriteRow(doc, byId, p.rowId, p.key, p.value); });
      }, "grid-paste", igDealsOf(Object.keys(touched)));
      toast("Pasted " + plan.length + " cell" + (plan.length === 1 ? "" : "s"), "success");
    }, function () { toast("Clipboard permission was blocked", "error"); });
  }

  function igCloseMenu() {
    if (gridState.menuEl) { gridState.menuEl.remove(); gridState.menuEl = null; }
    document.removeEventListener("mousedown", igMenuOutsideClick, true);
  }
  function igMenuOutsideClick(e) { if (gridState.menuEl && !gridState.menuEl.contains(e.target)) igCloseMenu(); }
  function igPlaceMenu(menu, x, y) {
    document.body.appendChild(menu);
    var vw = window.innerWidth, vh = window.innerHeight, mw = menu.offsetWidth || 180, mh = menu.offsetHeight || 160;
    menu.style.left = Math.max(6, Math.min(x, vw - mw - 6)) + "px";
    menu.style.top = Math.max(6, Math.min(y, vh - mh - 6)) + "px";
    gridState.menuEl = menu;
    setTimeout(function () { document.addEventListener("mousedown", igMenuOutsideClick, true); }, 0);
  }
  function igOpenCellMenuAt(x, y, rowId) {
    igCloseMenu();
    var row = gridState.byId[rowId];
    if (!row) return;
    var menu = document.createElement("div");
    menu.className = "ig-menu";
    // Nothing here opens a detail sheet: every figure this menu used to hide
    // behind a form is a cell on the row itself.
    var items = [
      { label: "Copy", action: "copy" }, { label: "Cut", action: "cut" }, { label: "Paste", action: "paste" },
      { label: "Clear", action: "clear" },
      { label: row.part ? "Add instalment below" : "Add instalment", action: "add-part" },
      { label: row.part ? "Delete instalment" : "Delete row", action: "delete", danger: !row.locked, disabled: row.locked }
    ];
    menu.innerHTML = items.map(function (it) { return '<button class="ig-menu-item' + (it.danger ? " danger" : "") + '" data-menu="' + it.action + '"' + (it.disabled ? " disabled" : "") + '>' + esc(it.label) + '</button>'; }).join("");
    menu.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".ig-menu-item");
      if (!btn) return;
      var act = btn.getAttribute("data-menu"); igCloseMenu();
      if (act === "copy") igCopySelection();
      else if (act === "cut") { igCopySelection(); igClearSelectionValues(); }
      else if (act === "paste") igPasteClipboard();
      else if (act === "clear") igClearSelectionValues();
      else if (act === "add-part") igAddPart(row.id);
      else if (act === "delete") igDeleteRow(row.id);
    });
    igPlaceMenu(menu, x, y);
  }
  function igOpenCellMenu(cellEl) {
    var rect = cellEl.getBoundingClientRect();
    var rowId = cellEl.getAttribute("data-row") || cellEl.getAttribute("data-rownum");
    igOpenCellMenuAt(rect.left, rect.bottom, rowId);
  }

  /* The column menu — Sheets' header dropdown. It is also the whole
     column toolkit on a phone, where there is no room for a drag and no
     hover to reveal anything: sort, move, freeze, hide and fit all live
     here so a touch user can reshape the sheet with one thumb. */
  function igSortModeFor(key, dir) {
    if (key === "client") return "client";
    if (key === "gross" || key === "balance") return dir === "asc" ? "amountAsc" : "amountDesc";
    if (key === "due") return dir === "asc" ? "dateAsc" : "dateDesc";
    return null;
  }
  function igOpenColMenu(key, x, y) {
    igCloseMenu();
    var col = igColDef(key);
    if (!col) return;
    var visible = igVisibleCols(), idx = visible.map(function (c) { return c.key; }).indexOf(key);
    if (idx < 0) return;
    var frozen = igFreezeCount(), sortable = !!igSortModeFor(key, "asc");
    var items = [];
    if (sortable) {
      var asc = col.type === "money" || col.type === "date" ? "Sort smallest first" : "Sort A → Z";
      var desc = col.type === "money" || col.type === "date" ? "Sort largest first" : "Sort Z → A";
      if (col.type === "date") { asc = "Sort earliest first"; desc = "Sort latest first"; }
      items.push({ label: asc, action: "sort-asc" }, { label: desc, action: "sort-desc" });
    }
    items.push({ label: "Move left", action: "move-left", disabled: idx === 0 });
    items.push({ label: "Move right", action: "move-right", disabled: idx === visible.length - 1 });
    items.push(frozen === idx + 1
      ? { label: "Unfreeze columns", action: "freeze-none" }
      : { label: idx === 0 ? "Freeze this column" : "Freeze up to here", action: "freeze-here" });
    items.push({ label: "Fit to content", action: "autofit" });
    items.push({ label: "Reset width", action: "reset-width" });
    items.push({ label: "Hide column", action: "hide", disabled: visible.length <= 1 });
    var menu = document.createElement("div");
    menu.className = "ig-menu";
    menu.innerHTML = items.map(function (it) { return '<button class="ig-menu-item" data-menu="' + it.action + '"' + (it.disabled ? " disabled" : "") + '>' + esc(it.label) + '</button>'; }).join("");
    menu.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".ig-menu-item");
      if (!btn) return;
      var act = btn.getAttribute("data-menu"); igCloseMenu();
      var inner = document.getElementById("ig-grid-inner");
      if (act === "sort-asc" || act === "sort-desc") {
        var mode = igSortModeFor(key, act === "sort-asc" ? "asc" : "desc");
        if (mode) { state.upcoming.sort = mode; savePrefs(); scheduleRender(0); }
      } else if (act === "move-left") { if (igMoveColumn(key, idx - 1)) scheduleRender(0); }
      else if (act === "move-right") { if (igMoveColumn(key, idx + 1)) scheduleRender(0); }
      else if (act === "freeze-here") { state.upcoming.gridFreeze = idx + 1; savePrefs(); scheduleRender(0); }
      else if (act === "freeze-none") { state.upcoming.gridFreeze = 0; savePrefs(); scheduleRender(0); }
      else if (act === "autofit") { if (inner) igAutofitColumn(key, inner); }
      else if (act === "reset-width") { delete gridState.widths[key]; igSavePersistedWidths(); if (inner) igApplyLayout(inner); }
      else if (act === "hide") { gridState.hidden[key] = true; igSavePersistedHidden(); scheduleRender(0); }
    });
    igPlaceMenu(menu, x, y);
  }
  /* One place that spells out the vocabulary, for anyone who lands on the
     sheet without having watched it get simplified. */
  function igOpenLegend(x, y) {
    igCloseMenu();
    var pop = document.createElement("div");
    pop.className = "ig-menu ig-legend-pop";
    pop.innerHTML =
      '<div class="ig-legend-title">Row colour</div>' +
      '<div class="ig-legend-row"><i class="ig-legend-dot bad"></i>Overdue</div>' +
      '<div class="ig-legend-row"><i class="ig-legend-dot warn"></i>Due soon</div>' +
      '<div class="ig-legend-row"><i class="ig-legend-dot good"></i>Settled, or money in</div>' +
      '<div class="ig-legend-row"><i class="ig-legend-dot muted"></i>Cancelled, or no date</div>';
    igPlaceMenu(pop, x, y);
  }
  function igOpenColMenuFor(headEl) {
    var rect = headEl.getBoundingClientRect();
    igOpenColMenu(headEl.getAttribute("data-colhead"), rect.left, rect.bottom);
  }
  function igSelectAll() {
    var allCols = igVisibleCols();
    if (!gridState.order.length || !allCols.length) return;
    gridState.anchor = { rowId: gridState.order[0], col: allCols[0].key };
    gridState.active = { rowId: gridState.order[gridState.order.length - 1], col: allCols[allCols.length - 1].key };
    igPaintActive();
  }
  function igOnClick(e) {
    if (gridState.suppressClick) { gridState.suppressClick = false; return; }
    var caret = e.target.closest && e.target.closest(".ig-colmenu");
    if (caret) {
      e.preventDefault(); e.stopPropagation();
      igOpenColMenuFor(caret.closest(".ig-colhead"));
      return;
    }
    var corner = e.target.closest && e.target.closest(".ig-rownum.ig-colhead");
    if (corner) { igSelectAll(); return; }
    var group = e.target.closest && e.target.closest(".ig-group");
    if (group) { e.preventDefault(); e.stopPropagation(); igToggleCollapse(group.getAttribute("data-group")); return; }
    var rownum = e.target.closest && e.target.closest(".ig-rownum:not(.ig-colhead):not(.ig-filler-cell)");
    if (rownum) {
      var rid = rownum.getAttribute("data-rownum"), cols = igVisibleCols();
      if (cols.length) { gridState.anchor = { rowId: rid, col: cols[0].key }; gridState.active = { rowId: rid, col: cols[cols.length - 1].key }; igPaintActive(); }
      return;
    }
    var colhead = e.target.closest && e.target.closest(".ig-colhead:not(.ig-rownum)");
    if (colhead && !(e.target.closest && e.target.closest(".ig-resize"))) {
      var key = colhead.getAttribute("data-colhead");
      if (key && gridState.order.length) { gridState.anchor = { rowId: gridState.order[0], col: key }; gridState.active = { rowId: gridState.order[gridState.order.length - 1], col: key }; igPaintActive(); }
    }
  }
  function igOnDblClick(e) {
    var cell = e.target.closest && e.target.closest(".ig-cell:not(.ig-rownum):not(.ig-colhead):not(.ig-filler-cell)");
    if (!cell) return;
    igActivateCell(cell.getAttribute("data-row"), cell.getAttribute("data-col"), true);
  }
  function igOnContextMenu(e) {
    var head = e.target.closest && e.target.closest(".ig-colhead[data-colhead]");
    if (head) { e.preventDefault(); igOpenColMenu(head.getAttribute("data-colhead"), e.clientX, e.clientY); return; }
    var cell = e.target.closest && e.target.closest(".ig-cell:not(.ig-colhead):not(.ig-filler-cell)");
    if (!cell) return;
    e.preventDefault();
    var rowId = cell.getAttribute("data-row") || cell.getAttribute("data-rownum");
    if (!rowId) return;
    if (cell.hasAttribute("data-col")) igSelectCellFromEl(cell, false);
    igOpenCellMenuAt(e.clientX, e.clientY, rowId);
  }

  function igWireCellEvents(scroll) {
    scroll.addEventListener("click", igOnClick);
    scroll.addEventListener("dblclick", igOnDblClick);
    scroll.addEventListener("contextmenu", igOnContextMenu);
    var dragging = false, lpTimer = null, lpFired = false, startX = 0, startY = 0, startCell = null;
    var touches = {}, pinching = false, pinchStartDist = 0, pinchStartZoom = 1;
    function touchIds() { return Object.keys(touches); }
    function touchDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    scroll.addEventListener("pointerdown", function (e) {
      var fillHandle = e.target.closest && e.target.closest(".ig-fill-handle");
      if (fillHandle) { e.preventDefault(); e.stopPropagation(); igStartFillDrag(e); return; }
      if (e.pointerType === "touch") {
        touches[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (touchIds().length === 2) {
          pinching = true; dragging = false; lpFired = true; clearTimeout(lpTimer); igCloseMenu();
          var ids = touchIds();
          pinchStartDist = touchDist(touches[ids[0]], touches[ids[1]]);
          pinchStartZoom = gridState.zoom || 1;
          return;
        }
      }
      if (pinching) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      var cell = e.target.closest && e.target.closest(".ig-cell:not(.ig-colhead):not(.ig-filler-cell)");
      if (!cell || gridState.editing) return;
      startX = e.clientX; startY = e.clientY; startCell = cell; lpFired = false;
      if (cell.classList.contains("ig-rownum")) return;
      dragging = true;
      igSelectCellFromEl(cell, !!e.shiftKey);
      if (e.pointerType === "touch") {
        clearTimeout(lpTimer);
        lpTimer = setTimeout(function () { lpFired = true; dragging = false; igOpenCellMenu(cell); }, 520);
      }
    });
    scroll.addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch" && touches[e.pointerId]) touches[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinching) {
        var ids = touchIds();
        if (ids.length === 2 && pinchStartDist > 10) {
          var d = touchDist(touches[ids[0]], touches[ids[1]]);
          var z = Math.max(IG_ZOOM_MIN, Math.min(IG_ZOOM_MAX, Math.round((pinchStartZoom * (d / pinchStartDist)) * 100) / 100));
          gridState.zoom = z;
          igApplyZoomLive();
        }
        return;
      }
      if (!startCell) return;
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
        clearTimeout(lpTimer);
        if (dragging && !lpFired) {
          var el = document.elementFromPoint(e.clientX, e.clientY);
          var overCell = el && el.closest && el.closest(".ig-cell:not(.ig-rownum):not(.ig-colhead):not(.ig-filler-cell)");
          if (overCell) igSelectCellFromEl(overCell, true);
        }
      }
    });
    function endTouch(e) {
      if (e.pointerType === "touch") delete touches[e.pointerId];
      if (pinching && touchIds().length < 2) {
        pinching = false; pinchStartDist = 0;
        state.upcoming.gridZoom = gridState.zoom; savePrefs();
      }
    }
    scroll.addEventListener("pointerup", function (e) { endTouch(e); dragging = false; clearTimeout(lpTimer); startCell = null; });
    scroll.addEventListener("pointercancel", function (e) { endTouch(e); dragging = false; clearTimeout(lpTimer); startCell = null; });
  }

  // Real autofit, not a reset to the default: every row is already in the
  // DOM (nothing here is virtualised), so the widest rendered cell in the
  // column is measured directly rather than guessed.
  function igAutofitColumn(key, inner) {
    var col = igColDef(key);
    if (!col) return;
    var max = 0;
    var headEl = document.querySelector('.ig-colhead[data-colhead="' + key + '"]');
    if (headEl) max = Math.max(max, headEl.scrollWidth);
    Object.keys(gridState.cellEls).forEach(function (rid) {
      var cell = gridState.cellEls[rid][key];
      if (cell) max = Math.max(max, cell.scrollWidth);
    });
    if (!max) return;
    var zoom = gridState.zoom || 1;
    // Store the unzoomed base width, matching how igColWidth() re-scales it.
    gridState.widths[key] = Math.round(Math.max(col.min, Math.min(420, max + 20)) / zoom);
    igApplyLayout(inner);
    igSavePersistedWidths();
  }

  // A drag or a long press must not also land as a click on the header
  // underneath it, but the click may never arrive (the row can re-render
  // first), so the guard expires on its own rather than eating the next one.
  function igSuppressNextClick() {
    gridState.suppressClick = true;
    setTimeout(function () { gridState.suppressClick = false; }, 350);
  }

  /* Dragging a row to reorder it, the way Sheets does. Rows are otherwise
     always computed by the active sort, so there is nothing to hold a manual
     position — dragging one switches the sheet to "Custom order" (mirroring
     how a column drag writes gridOrder) and remembers where every deal you
     have touched belongs. A deal not yet placed sorts after the ones that
     are, so this never has to solve a full merge with an unrelated sort. */
  function igTopLevelOrder() { return (gridState.order || []).filter(function (id) { return String(id).indexOf("::") < 0; }); }
  function igCommitRowOrder(draggedId, targetIndex) {
    var visible = igTopLevelOrder();
    var fromIdx = visible.indexOf(String(draggedId));
    if (fromIdx < 0) return false;
    targetIndex = Math.max(0, Math.min(visible.length - 1, targetIndex));
    if (targetIndex === fromIdx) return false;
    var wasCustom = state.upcoming.sort === "custom" && Array.isArray(state.upcoming.gridRowOrder) && state.upcoming.gridRowOrder.length;
    var baseline = wasCustom ? state.upcoming.gridRowOrder.slice() : visible.slice();
    var reordered = visible.slice();
    reordered.splice(targetIndex, 0, reordered.splice(fromIdx, 1)[0]);
    var visibleSet = {};
    visible.forEach(function (id) { visibleSet[id] = true; });
    var withoutVisible = [], insertAt = -1, seenOthers = 0;
    baseline.forEach(function (id) {
      if (visibleSet[id]) { if (insertAt < 0) insertAt = seenOthers; }
      else { withoutVisible.push(id); seenOthers++; }
    });
    if (insertAt < 0) insertAt = withoutVisible.length;
    state.upcoming.gridRowOrder = withoutVisible.slice(0, insertAt).concat(reordered, withoutVisible.slice(insertAt));
    state.upcoming.sort = "custom";
    savePrefs();
    return true;
  }
  function igStartRowDrag(e, rownumEl, rowId) {
    var scroll = document.getElementById("ig-scroll"), body = document.getElementById("ig-body");
    if (!scroll || !body) return;
    var startY = e.clientY, armed = false, targetIndex = null;
    var order = igTopLevelOrder(), fromIndex = order.indexOf(String(rowId));
    if (fromIndex < 0) return;
    var indicator = null, ghost = null, blockEls = [];
    try { rownumEl.setPointerCapture(e.pointerId); } catch (_) {}
    function dealRowEls() {
      return order.map(function (id) { return gridState.rowEls[id]; }).filter(Boolean);
    }
    function blockOf(id) {
      var els = [gridState.rowEls[id]].filter(Boolean);
      (gridState.rows || []).forEach(function (r) { if (r.part && r.parentId === id) { var el = gridState.rowEls[r.id]; if (el) els.push(el); } });
      return els;
    }
    function arm() {
      armed = true;
      document.body.classList.add("ig-rowdragging");
      blockEls = blockOf(rowId);
      blockEls.forEach(function (el) { el.classList.add("ig-row-dragging"); });
      indicator = document.createElement("div");
      indicator.className = "ig-row-drop";
      body.appendChild(indicator);
      ghost = document.createElement("div");
      ghost.className = "ig-row-ghost";
      var row = gridState.byId[rowId];
      ghost.textContent = (row && row.client) || "Row";
      document.body.appendChild(ghost);
    }
    function onMove(ev) {
      if (!armed) {
        if (Math.abs(ev.clientY - startY) < 6) return;
        arm();
      }
      ghost.style.left = ev.clientX + "px";
      ghost.style.top = ev.clientY + "px";
      var els = dealRowEls(), idx = fromIndex, placedAbove = true;
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { idx = i; placedAbove = true; break; }
        idx = i; placedAbove = false;
      }
      targetIndex = placedAbove ? idx : Math.min(order.length - 1, idx + 1);
      var refEl = els[idx];
      if (refEl) {
        // The indicator lives in #ig-body, whose only positioned ancestor
        // is itself — offsetTop is already in the right coordinate space,
        // no scroll math needed.
        indicator.style.top = (placedAbove ? refEl.offsetTop : refEl.offsetTop + refEl.offsetHeight) + "px";
        indicator.style.width = document.getElementById("ig-grid-inner").offsetWidth + "px";
      }
      // Auto-scroll the sheet while a drag is held near its top or bottom edge.
      var sr = scroll.getBoundingClientRect(), edge = 28;
      if (ev.clientY < sr.top + edge) scroll.scrollTop -= 12;
      else if (ev.clientY > sr.bottom - edge) scroll.scrollTop += 12;
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("ig-rowdragging");
      blockEls.forEach(function (el) { el.classList.remove("ig-row-dragging"); });
      if (indicator) indicator.remove();
      if (ghost) ghost.remove();
      if (!armed) return;
      igSuppressNextClick();
      if (targetIndex !== null && igCommitRowOrder(rowId, targetIndex)) scheduleRender(0);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }
  function igWireRowDrag(scroll) {
    var lp = null;
    scroll.addEventListener("pointerdown", function (e) {
      var handle = e.target.closest && e.target.closest(".ig-rownum:not(.ig-colhead):not(.ig-filler-cell)");
      if (!handle || (e.target.closest && e.target.closest(".ig-group"))) return;
      var rowId = handle.getAttribute("data-rownum");
      if (!rowId || rowId.indexOf("::") >= 0) return;
      if (e.pointerType === "touch") {
        var sx = e.clientX, sy = e.clientY;
        lp = setTimeout(function () { igStartRowDrag(e, handle, rowId); }, 380);
        var cancel = function (ev) {
          if (ev.type === "pointermove" && Math.abs(ev.clientX - sx) < 8 && Math.abs(ev.clientY - sy) < 8) return;
          clearTimeout(lp);
          document.removeEventListener("pointerup", cancel);
          document.removeEventListener("pointercancel", cancel);
          document.removeEventListener("pointermove", cancel);
        };
        document.addEventListener("pointerup", cancel);
        document.addEventListener("pointercancel", cancel);
        document.addEventListener("pointermove", cancel);
        return;
      }
      if (e.pointerType === "mouse" && e.button !== 0) return;
      igStartRowDrag(e, handle, rowId);
    });
  }

  /* Drag a column header sideways to reorder, the way Sheets does.  /* Drag a column header sideways to reorder, the way Sheets does. Touch is
     deliberately left out: a sideways swipe on a phone has to stay a scroll,
     so a long press there opens the column menu instead, where Move left and
     Move right do the same job with a thumb. */
  function igStartColDrag(e, head, key, inner) {
    var startX = e.clientX, armed = false, targetIdx = null;
    var visible = igVisibleCols().map(function (c) { return c.key; });
    var fromIdx = visible.indexOf(key);
    if (fromIdx < 0) return;
    var indicator = null, ghost = null;
    try { head.setPointerCapture(e.pointerId); } catch (_) {}
    function headEls() { return Array.prototype.slice.call(inner.querySelectorAll(".ig-colhead[data-colhead]")); }
    function onMove(ev) {
      if (!armed) {
        if (Math.abs(ev.clientX - startX) < 5) return;
        armed = true;
        document.body.classList.add("ig-coldragging");
        head.classList.add("ig-col-dragging");
        indicator = document.createElement("div");
        indicator.className = "ig-col-drop";
        inner.appendChild(indicator);
        ghost = document.createElement("div");
        ghost.className = "ig-col-ghost";
        ghost.textContent = igColLabel(key);
        document.body.appendChild(ghost);
      }
      ghost.style.left = ev.clientX + "px";
      ghost.style.top = ev.clientY + "px";
      var els = headEls(), idx = fromIdx;
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (ev.clientX < r.right || i === els.length - 1) { idx = i; break; }
      }
      targetIdx = idx;
      var drop = els[idx];
      indicator.style.left = (idx >= fromIdx ? drop.offsetLeft + drop.offsetWidth : drop.offsetLeft) + "px";
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("ig-coldragging");
      head.classList.remove("ig-col-dragging");
      if (indicator) indicator.remove();
      if (ghost) ghost.remove();
      if (!armed) return;
      igSuppressNextClick();
      if (targetIdx !== null && targetIdx !== fromIdx && igMoveColumn(key, targetIdx)) scheduleRender(0);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }
  function igWireHeaderInteractions(inner) {
    Array.prototype.slice.call(inner.querySelectorAll(".ig-colhead[data-colhead]")).forEach(function (head) {
      head.addEventListener("pointerdown", function (e) {
        if (e.target.closest && (e.target.closest(".ig-resize") || e.target.closest(".ig-colmenu"))) return;
        var key = head.getAttribute("data-colhead");
        if (e.pointerType === "touch") {
          var lp = setTimeout(function () { igOpenColMenuFor(head); igSuppressNextClick(); }, 480);
          var done = function () {
            clearTimeout(lp);
            document.removeEventListener("pointerup", done);
            document.removeEventListener("pointercancel", done);
            document.removeEventListener("pointermove", moved);
          };
          var moved = function (ev) { if (Math.abs(ev.clientX - e.clientX) > 8 || Math.abs(ev.clientY - e.clientY) > 8) done(); };
          document.addEventListener("pointerup", done);
          document.addEventListener("pointercancel", done);
          document.addEventListener("pointermove", moved);
          return;
        }
        if (e.pointerType === "mouse" && e.button !== 0) return;
        igStartColDrag(e, head, key, inner);
      });
    });
  }

  function igWireResize(inner) {
    Array.prototype.slice.call(inner.querySelectorAll(".ig-resize")).forEach(function (handle) {
      handle.addEventListener("pointerdown", function (e) {
        e.preventDefault(); e.stopPropagation();
        var key = handle.getAttribute("data-resize"), startX = e.clientX, startW = igColWidth(key);
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        function onMove(ev) {
          var col = igColDef(key);
          gridState.widths[key] = Math.max(col.min, startW + (ev.clientX - startX));
          igApplyLayout(inner);
        }
        function onUp() { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); igSavePersistedWidths(); }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
      handle.addEventListener("dblclick", function (e) {
        e.stopPropagation();
        igAutofitColumn(handle.getAttribute("data-resize"), inner);
      });
    });
  }

  function igWireFormulaBar() {
    var input = document.getElementById("ig-formula-input");
    if (!input) return;
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!gridState.active || input.disabled) return;
        var rowId = gridState.active.rowId, colKey = gridState.active.col, row = gridState.byId[rowId];
        if (String(input.value).trim() !== String(igRawValue(row, colKey)).trim()) { igPushUndo(rowId); igApplyCellValue(rowId, colKey, input.value); }
        igMoveAfterCommit("down");
      } else if (e.key === "Escape") { e.preventDefault(); igUpdateFormulaBar(); input.blur(); }
    });
  }

  function igWireKeyboard(scroll) {
    scroll.addEventListener("keydown", function (e) {
      if (gridState.editing) return;
      if (!gridState.active) {
        if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter"].indexOf(e.key) >= 0 && gridState.order.length) {
          e.preventDefault();
          igSetActive(gridState.order[0], igVisibleCols()[0].key);
        }
        return;
      }
      var mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); igCopySelection(); return; }
      if (mod && !e.shiftKey && (e.key === "v" || e.key === "V")) { e.preventDefault(); igPasteClipboard(); return; }
      if (mod && !e.shiftKey && (e.key === "x" || e.key === "X")) { e.preventDefault(); igCopySelection(); igClearSelectionValues(); return; }
      if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); igUndo(); return; }
      if (mod && ((e.shiftKey && (e.key === "z" || e.key === "Z")) || e.key === "y" || e.key === "Y")) { e.preventDefault(); igRedo(); return; }
      if (mod && (e.key === "f" || e.key === "F")) { e.preventDefault(); var s = document.getElementById("x97-up-search"); if (s) s.focus(); return; }
      if (mod && !e.shiftKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); igSelectAll(); return; }
      if (mod && e.key === "Home") { e.preventDefault(); igSetActive(gridState.order[0], igVisibleCols()[0].key); return; }
      if (mod && e.key === "End") { var ec = igVisibleCols(); e.preventDefault(); igSetActive(gridState.order[gridState.order.length - 1], ec[ec.length - 1].key); return; }
      if (e.key === "F2") {
        e.preventDefault();
        var f2row = gridState.byId[gridState.active.rowId], f2col = igColDef(gridState.active.col);
        if (f2col && igEditable(f2col, f2row)) igBeginEdit(gridState.active.rowId, gridState.active.col);
        return;
      }
      if (e.key === "ArrowDown") { e.preventDefault(); igStep(e.shiftKey, 1, 0); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); igStep(e.shiftKey, -1, 0); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); igStep(e.shiftKey, 0, -1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); igStep(e.shiftKey, 0, 1); return; }
      if (e.key === "Tab") { e.preventDefault(); igMoveAfterCommit(e.shiftKey ? "left" : "right"); return; }
      if (e.key === "Home") { e.preventDefault(); igSetActive(gridState.active.rowId, igVisibleCols()[0].key); return; }
      if (e.key === "End") { var cs = igVisibleCols(); e.preventDefault(); igSetActive(gridState.active.rowId, cs[cs.length - 1].key); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        var row = gridState.byId[gridState.active.rowId], col = igColDef(gridState.active.col);
        if (col && igEditable(col, row)) igBeginEdit(gridState.active.rowId, gridState.active.col);
        return;
      }
      if (e.key === "Escape") { igCloseMenu(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); igClearSelectionValues(); return; }
      if (e.key.length === 1 && !mod && !e.altKey) {
        var rrow = gridState.byId[gridState.active.rowId], rcol = igColDef(gridState.active.col);
        if (rcol && igEditable(rcol, rrow) && rcol.type !== "date" && rcol.key !== "currency") {
          igBeginEdit(gridState.active.rowId, gridState.active.col);
          var rid = gridState.active.rowId, key = gridState.active.col, ch = e.key;
          setTimeout(function () {
            var input = gridState.cellEls[rid] && gridState.cellEls[rid][key] && gridState.cellEls[rid][key].querySelector(".ig-edit-input");
            // A dropdown does its own type-ahead; forcing the character in
            // would just blank it.
            if (input && input.tagName !== "SELECT") input.value = ch;
          }, 0);
        }
      }
    });
  }

  function mountIncomingGrid() {
    var scroll = document.getElementById("ig-scroll");
    if (!scroll) return;
    var inner = document.getElementById("ig-grid-inner"), body = document.getElementById("ig-body");
    igIndexDom(body);
    scroll.scrollTop = gridState.scrollTop || 0;
    scroll.scrollLeft = gridState.scrollLeft || 0;
    var shell = root && root.querySelector(".ig-shell");
    scroll.addEventListener("scroll", function () {
      gridState.scrollTop = scroll.scrollTop;
      gridState.scrollLeft = scroll.scrollLeft;
      // Hand the summary strip's height back to the rows once the user is
      // working down the sheet; it returns as soon as they scroll back up.
      if (shell) {
        var away = scroll.scrollTop > 24;
        if (away !== gridState.chromeAway) { gridState.chromeAway = away; shell.classList.toggle("ig-scrolled", away); }
        var overX = scroll.scrollLeft > 2;
        if (overX !== gridState.scrolledX) { gridState.scrolledX = overX; shell.classList.toggle("ig-scrolled-x", overX); }
      }
    }, { passive: true });
    if (shell && gridState.chromeAway) shell.classList.add("ig-scrolled");
    if (shell && gridState.scrolledX) shell.classList.add("ig-scrolled-x");
    if (!gridState.active && gridState.order.length) {
      var cols0 = igVisibleCols();
      if (cols0.length) { gridState.anchor = { rowId: gridState.order[0], col: cols0[0].key }; gridState.active = gridState.anchor; }
    }
    // The shell's flex layout is not final in the same tick the markup lands,
    // so the first measurement can undercount the free space; take it again
    // once the frame has settled. igFillEmptyRows() is a no-op if nothing moved.
    igFillEmptyRows();
    if (window.requestAnimationFrame) requestAnimationFrame(function () { requestAnimationFrame(igFillEmptyRows); });
    if (!gridState.viewportWired) {
      gridState.viewportWired = true;
      var vpTimer = null;
      var onViewport = function () {
        clearTimeout(vpTimer);
        vpTimer = setTimeout(function () { if (document.getElementById("ig-grid-inner")) igOnViewportChange(); }, 120);
      };
      window.addEventListener("resize", onViewport);
      window.addEventListener("orientationchange", onViewport);
    }
    igWireKeyboardInset();
    igWireCellEvents(scroll);
    igWireHeaderInteractions(inner);
    igWireRowDrag(scroll);
    igWireResize(inner);
    igWireKeyboard(scroll);
    igWireFormulaBar();
    igPaintActive();
    if (gridState.pendingFocusRow && gridState.byId[gridState.pendingFocusRow]) {
      var pfr = gridState.pendingFocusRow; gridState.pendingFocusRow = null;
      igSetActive(pfr, "client");
      setTimeout(function () { igBeginEdit(pfr, "client"); }, 30);
    }
    igFlushPendingExternalRender();
  }

  /* ── Filter sheet (mobile-first, live count) & columns panel ────────── */

  function igFilterCount(doc) { return (doc.followups || []).filter(function (item) { return followupMatches(item, doc); }).length; }

  function openGridFilters(doc) {
    var f = state.upcoming;
    var currencies = Array.from(new Set((doc.followups || []).map(function (x) { return String(x.currency || "UGX").toUpperCase(); }))).sort();
    var categories = Array.from(new Set((doc.followups || []).map(function (x) { return String(x.category || ""); }))).filter(Boolean).sort();
    function chip(kind, label, value, on) { return '<button type="button" class="ig-filter-chip' + (on ? " on" : "") + '" data-grid-filter="' + attr(kind) + '" data-value="' + attr(value) + '">' + esc(label) + '</button>'; }
    var body = '<div class="ig-filter-sheet">' +
      '<div class="ig-filter-section"><label>Status</label><div class="ig-filter-chiprow">' +
        chip("status", "Paid", "Paid", f.statuses.indexOf("Paid") >= 0) + chip("status", "Partial", "Part Paid", f.statuses.indexOf("Part Paid") >= 0) + chip("status", "Unpaid", "Pending", f.statuses.indexOf("Pending") >= 0) + chip("status", "Cancelled", "Cancelled", f.statuses.indexOf("Cancelled") >= 0) +
      '</div></div>' +
      '<div class="ig-filter-section"><label>Due</label><div class="ig-filter-chiprow">' +
        chip("due", "Overdue", "overdue", f.quick === "overdue") + chip("due", "Today", "today", f.quick === "today") + chip("due", "This week", "next7", f.quick === "next7") + chip("due", "This month", "thisMonth", f.quick === "thisMonth") + chip("due", "No date", "unscheduled", f.quick === "unscheduled") +
      '</div></div>' +
      '<div class="ig-filter-section"><label>Month</label><select class="x97-select" id="ig-filter-month">' + option("all", "All months", f.month) + availableMonths(doc).map(function (k) { return option(k, monthLabel(k, true), f.month); }).join("") + option("unscheduled", "Unscheduled only", f.month) + '</select></div>' +
      (categories.length ? '<div class="ig-filter-section"><label>Category</label><div class="ig-filter-chiprow">' + categories.map(function (c) { return chip("category", c, c, f.categories.indexOf(c) >= 0); }).join("") + '</div></div>' : "") +
      (currencies.length > 1 ? '<div class="ig-filter-section"><label>Currency</label><div class="ig-filter-chiprow">' + currencies.map(function (c) { return chip("currency", c, c, f.currencies.indexOf(c) >= 0); }).join("") + '</div></div>' : "") +
      '<div class="ig-filter-section"><label>Client</label><input class="x97-input" id="ig-filter-client" placeholder="Search client…" value="' + attr(f.search) + '"></div>' +
      '<div class="ig-filter-section x97-fields-2"><div>' + field("Min amount", '<input class="x97-input" id="ig-filter-min" type="number" min="0" value="' + attr(f.minAmount) + '" placeholder="0">') + '</div><div>' + field("Max amount", '<input class="x97-input" id="ig-filter-max" type="number" min="0" value="' + attr(f.maxAmount) + '" placeholder="No limit">') + '</div></div>' +
    '</div>';
    var foot = '<button class="x97-btn" data-x97-action="grid-filters-reset">Reset</button><button class="x97-btn primary" type="button" data-x97-action="grid-filters-apply">' + icon("check", 15) + ' <span id="ig-filter-count">Show ' + igFilterCount(doc) + ' rows</span></button>';
    openSheet("Filter Incoming", body, foot, { afterOpen: function (back) {
      function refreshCount() { var el = back.querySelector("#ig-filter-count"); if (el) el.textContent = "Show " + igFilterCount(readDoc()) + " rows"; }
      back.addEventListener("click", function (e) {
        var chipEl = e.target.closest && e.target.closest("[data-grid-filter]");
        if (!chipEl) return;
        var kind = chipEl.getAttribute("data-grid-filter"), value = chipEl.getAttribute("data-value");
        if (kind === "status") {
          var i = f.statuses.indexOf(value); if (i >= 0) f.statuses.splice(i, 1); else f.statuses.push(value); chipEl.classList.toggle("on");
          if (f.statuses.length && (f.quick === "open" || f.quick === "attention")) {
            f.quick = "all";
            Array.prototype.slice.call(back.querySelectorAll('[data-grid-filter="due"]')).forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-value") === f.quick); });
          }
        }
        else if (kind === "category") { var j = f.categories.indexOf(value); if (j >= 0) f.categories.splice(j, 1); else f.categories.push(value); chipEl.classList.toggle("on"); }
        else if (kind === "currency") { var k = f.currencies.indexOf(value); if (k >= 0) f.currencies.splice(k, 1); else f.currencies.push(value); chipEl.classList.toggle("on"); }
        else if (kind === "due") {
          f.quick = f.quick === value ? "all" : value;
          Array.prototype.slice.call(back.querySelectorAll('[data-grid-filter="due"]')).forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-value") === f.quick); });
        }
        refreshCount();
      });
      var minEl = back.querySelector("#ig-filter-min"), maxEl = back.querySelector("#ig-filter-max"), clientEl = back.querySelector("#ig-filter-client"), monthEl = back.querySelector("#ig-filter-month");
      if (minEl) minEl.addEventListener("input", function () { f.minAmount = minEl.value; refreshCount(); });
      if (maxEl) maxEl.addEventListener("input", function () { f.maxAmount = maxEl.value; refreshCount(); });
      if (clientEl) clientEl.addEventListener("input", function () { f.search = clientEl.value; refreshCount(); });
      if (monthEl) monthEl.addEventListener("change", function () { f.month = monthEl.value; refreshCount(); });
    } });
  }

  function openGridColumns() {
    var body = '<div class="x97-checks">' + igOrderedCols().map(function (c) {
      var visible = !gridState.hidden[c.key];
      return '<label class="x97-check"><input type="checkbox" data-col-toggle="' + attr(c.key) + '" ' + (visible ? "checked" : "") + (c.key === "client" ? " disabled" : "") + '><span>' + esc(c.label) + '</span></label>';
    }).join("") + '</div><div class="x97-help" style="margin-top:10px">Hidden columns keep their data — nothing is deleted.</div>';
    openSheet("Visible columns", body, '<button class="x97-btn primary" data-x97-action="close-sheet">Done</button>', { afterOpen: function (back) {
      back.addEventListener("change", function (e) {
        var box = e.target.closest && e.target.closest("[data-col-toggle]");
        if (!box) return;
        var key = box.getAttribute("data-col-toggle");
        if (box.checked) delete gridState.hidden[key]; else gridState.hidden[key] = true;
        igSavePersistedHidden(); scheduleRender(0);
      });
    } });
  }

  function openGridMore() {
    var theme = loadTheme();
    var moreCollapsible = igVisibleCollapsibles();
    var moreAnyOpen = moreCollapsible.some(function (r) { return !r.collapsed; });
    var body = '<div class="ig-more-list">' +
      '<button class="x97-card-action full" data-x97-action="grid-add-row">' + icon("plus", 15) + ' Add row</button>' +
      '<button class="x97-card-action full" data-x97-action="grid-undo">' + icon("undo", 15) + ' Undo</button>' +
      '<button class="x97-card-action full" data-x97-action="grid-redo">' + icon("redo", 15) + ' Redo</button>' +
      '<button class="x97-card-action full" data-x97-action="open-grid-columns">' + icon("columns", 15) + ' Columns</button>' +
      (moreCollapsible.length ? '<button class="x97-card-action full" data-x97-action="grid-collapse-all" data-value="' + (moreAnyOpen ? "collapse" : "expand") + '">' + icon(moreAnyOpen ? "collapse" : "expand", 15) + (moreAnyOpen ? ' Collapse all schedules' : ' Expand all schedules') + '</button>' : "") +
      '<button class="x97-card-action full" data-x97-action="open-exports">' + icon("list", 15) + ' Export</button>' +
      '<div class="ig-theme-row">' +
        '<span class="ig-theme-label">Appearance</span>' +
        '<div class="ig-theme-seg" role="group" aria-label="Appearance">' +
          '<button class="ig-theme-opt' + (theme === "light" ? " on" : "") + '" data-x97-action="set-theme" data-value="light">' + icon("sun", 14) + 'Light</button>' +
          '<button class="ig-theme-opt' + (theme === "dark" ? " on" : "") + '" data-x97-action="set-theme" data-value="dark">' + icon("moon", 14) + 'Dark</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    openSheet("More", body, "");
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
      pageHeader("Mobile finance", "Credit", "Available offers, active borrowing and repayment history", '<button class="x97-icon-btn" data-x97-action="add-facility" title="Add facility">' + icon("plus") + '</button>') +
      '<div class="x97-summary-grid" style="margin-bottom:14px"><div class="x97-card x97-summary"><div class="k">Available credit</div><div class="v x97-money x97-teal">' + money(availableTotal,"",true) + '</div><div class="s">Across ' + live.length + ' live facilities</div></div><div class="x97-card x97-summary"><div class="k">Borrowed</div><div class="v x97-money x97-red">' + money(borrowed,"",true) + '</div><div class="s">' + active.length + ' active</div></div><div class="x97-card x97-summary"><div class="k">Amount due</div><div class="v x97-money x97-red">' + money(due,"",true) + '</div><div class="s">Estimated today</div></div><div class="x97-card x97-summary"><div class="k">Next repayment</div><div class="v x97-money" style="font-size:17px">' + esc(nextLoanDue(active)) + '</div><div class="s">Earliest active loan</div></div></div>' +
      '<div class="x97-segment"><button class="' + (state.creditView === "available" ? "on" : "") + '" data-x97-action="credit-view" data-value="available">Available</button><button class="' + (state.creditView === "borrowed" ? "on" : "") + '" data-x97-action="credit-view" data-value="borrowed">Borrowed' + (active.length ? ' · ' + active.length : '') + '</button><button class="' + (state.creditView === "history" ? "on" : "") + '" data-x97-action="credit-view" data-value="history">History</button></div>' + body +
      '<button class="x97-fab" data-x97-action="add-facility" aria-label="Add credit facility">' + icon("plus",25) + '</button></div>';
  }

  function render() {
    if (!currentScreen || !ensureRoot()) return;
    root.dataset.screen = currentScreen;
    var doc = readDoc();
    if (!doc) {
      root.innerHTML = '<div class="x97-page"><div class="x97-card x97-empty"><strong>Loading your finance data…</strong><p>Sign in and wait for the cloud copy to finish loading.</p></div></div>';
      return;
    }
    try { lastRaw = localStorage.getItem(DATA_KEY) || JSON.stringify(doc); } catch (_) { lastRaw = JSON.stringify(doc); }
    if (currentScreen === "dashboard") renderDashboard(doc);
    else if (currentScreen === "upcoming") renderUpcoming(doc);
    else if (currentScreen === "credit") renderCredit(doc);
    updateCloudPill();
    scheduleViewportFab();
  }

  function lockSheetScroll() {
    sheetScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.setProperty("--x97-sheet-scroll-y", "-" + sheetScrollY + "px");
    document.body.classList.add("x97-sheet-open");
  }

  function unlockSheetScroll() {
    if (!document.body.classList.contains("x97-sheet-open")) return;
    var restoreY = sheetScrollY;
    document.body.classList.remove("x97-sheet-open");
    document.body.style.removeProperty("--x97-sheet-scroll-y");
    sheetScrollY = 0;
    window.requestAnimationFrame(function () { window.scrollTo(0, restoreY); });
  }

  function openSheet(title, body, foot, options) {
    closeSheet();
    var back = document.createElement("div");
    back.className = "x97-back";
    back.id = "x97-sheet";
    back.innerHTML = '<section class="x97-sheet" role="dialog" aria-modal="true"><div class="x97-handle"></div><header class="x97-sheet-head"><h2>' + esc(title) + '</h2><button class="x97-close" data-x97-action="close-sheet">' + icon("close") + '</button></header><div class="x97-sheet-body">' + body + '</div>' + (foot ? '<footer class="x97-sheet-foot">' + foot + '</footer>' : '') + '</section>';
    document.body.appendChild(back);
    lockSheetScroll();
    scheduleViewportFab();
    back.addEventListener("mousedown", function (e) { if (e.target === back) closeSheet(); });
    back.addEventListener("focusin", function (e) {
      var target = e.target;
      if (!target || !target.matches || !target.matches("input,select,textarea")) return;
      setTimeout(function () {
        if (document.activeElement !== target) return;
        target.scrollIntoView({ block: "center", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }, 180);
    });
    if (options && options.afterOpen) setTimeout(function(){ options.afterOpen(back); },0);
    var first = back.querySelector("input:not([type=hidden]),select,textarea"); if (first && window.innerWidth > 700) setTimeout(function(){first.focus();},80);
  }

  function closeSheet() { var el = document.getElementById("x97-sheet"); if (el) el.remove(); unlockSheetScroll(); scheduleViewportFab(); }

  function option(value, label, selected) { return '<option value="' + attr(value) + '" ' + (String(value) === String(selected) ? "selected" : "") + '>' + esc(label == null ? value : label) + '</option>'; }

  function field(label, input, help) { return '<div class="x97-field"><label>' + esc(label) + '</label>' + input + (help ? '<div class="x97-help">' + esc(help) + '</div>' : '') + '</div>'; }
  function fieldWithLabelId(id, label, input, help) { return '<div class="x97-field"><label id="' + attr(id) + '">' + esc(label) + '</label>' + input + (help ? '<div class="x97-help">' + esc(help) + '</div>' : '') + '</div>'; }

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
    var firstDue = (item.parts && item.parts[0] && item.parts[0].dueDate) || item.expectedBy || todayISO();
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
      '<div class="x97-fields-2"><div class="x97-deal-start-field">' + field("First / next due date", '<input class="x97-input x97-deal-control" name="startDate" type="date" value="' + attr(firstDue) + '"' + (locked ? " disabled" : "") + '>') + '</div><div class="x97-deal-second-field">' + field("Second payment due", '<input class="x97-input x97-deal-control" name="secondDue" type="date" value="' + attr(secondDue) + '"' + (locked ? " disabled" : "") + '>') + '</div></div>' +
      '<div class="x97-deposit-dates x97-fields-2"><div>' + field("Deposit due", '<input class="x97-input x97-deal-control" name="depositDue" type="date" value="' + attr(firstDue) + '"' + (locked ? " disabled" : "") + '>') + '</div><div>' + field("Balance due", '<input class="x97-input x97-deal-control" name="balanceDue" type="date" value="' + attr(secondDue) + '"' + (locked ? " disabled" : "") + '>') + '</div></div>' +
      '<div class="x97-custom-editor" id="x97-custom-editor">' + (customRows ? '<div class="x97-custom-editor-head"><div><b>Custom schedule</b><span>Each row is a real promised payment.</span></div><span class="x97-pill">Amounts must equal total</span></div>' + customRows : "") + '</div>' +
      '<div id="x97-deal-hint" class="x97-deal-type-hint"></div><div id="x97-deal-glance" class="x97-deal-glance"></div><div class="x97-deal-schedule-heading"><div><b>Review the schedule</b><span>Every payment remains visible after saving.</span></div><span class="x97-deal-schedule-dot">●</span></div><div id="x97-deal-preview" class="x97-deal-preview"></div>' + (locked ? '<div class="x97-deal-lock-note">Money has already been recorded. Dates and financial structure are locked; you can still update the client, category, contact and note.</div>' : '') + '</div>';
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
        var previewHTML = normalizedType === "one" ? '<div class="x97-single-preview"><span>One payment' + (nextDraft && nextDraft.dueDate ? ' · due ' + esc(formatDate(nextDraft.dueDate, true)) : "") + '</span><strong>' + money(total, draft.currency) + '</strong></div>' : dealScheduleHTML(draft, false);
        preview.innerHTML = previewHTML + '<div class="x97-deal-total"><span>Deal total</span><b>' + money(total, draft.currency) + '</b></div>';
      }
      function toggleDealFields() {
        var value = normalizeDealType(typeInput ? typeInput.value : "one");
        Array.prototype.slice.call(back.querySelectorAll(".x97-deal-mode")).forEach(function (button) { var on = button.dataset.dealMode === value; button.classList.toggle("on", on); button.setAttribute("aria-pressed", on ? "true" : "false"); });
        var count = back.querySelector(".x97-deal-count-field"), interval = back.querySelector(".x97-deal-interval-field"), second = back.querySelector(".x97-deal-second-field"), deposit = back.querySelector(".x97-deposit-field"), depositDates = back.querySelector(".x97-deposit-dates"), label = back.querySelector(".x97-deal-label-field"), start = back.querySelector(".x97-deal-start-field");
        if (count) count.style.display = value === "one" || value === "split" || value === "deposit" ? "none" : "block";
        if (interval) interval.style.display = value === "monthly" || value === "part" ? "block" : "none";
        if (second) second.style.display = value === "split" ? "block" : "none";
        if (deposit) deposit.style.display = value === "deposit" ? "block" : "none";
        if (depositDates) depositDates.style.display = value === "deposit" ? "grid" : "none";
        if (label) label.style.display = value === "monthly" || value === "part" ? "block" : "none";
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
    var v = formValues(form), id = v.id || uid("fu"), type = normalizeDealType(v.dealType || "one"), oldSnapshot = readDoc(), old = oldSnapshot && (oldSnapshot.followups || []).find(function (x) { return String(x.id) === String(id); });
    if (!String(v.client || "").trim()) { toast("Add a client or project name", "error"); return; }
    if (old && dealHasRecordedMoney(old)) {
      updateDoc(function (doc) {
        var i = doc.followups.findIndex(function (x) { return String(x.id) === String(id); });
        if (i >= 0) doc.followups[i] = Object.assign({}, doc.followups[i], { client: String(v.client || "").trim(), category: v.category, phone: String(v.phone || "").trim(), note: String(v.note || "").trim() });
      }, "upcoming-meta-save");
      closeSheet(); if (remindState.open) refreshRemind(); return;
    }
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
  function progLabel(p) { return ({ queued: "Queued", sending: "Sending…", typing: "Typing…", sent: "Sent ✓", error: "Failed", skipped: "Skipped", paused: "Paused" })[p] || p; }
  function safeJson(text) { try { return JSON.parse(text); } catch (_) {} var a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} } return null; }

  function openReminders() {
    injectRemindCSS();
    remindState.open = true; remindState.progress = {};
    var doc = readDoc();
    if (doc) chaseSendable(doc).forEach(function (x) { if (timing(x, doc).key === "overdue" && !x.lastRemindedAt) remindState.selected[x.id] = true; });
    var el = document.getElementById("x97-remind");
    if (!el) { el = document.createElement("div"); el.id = "x97-remind"; el.className = "x97-remind-overlay"; document.body.appendChild(el); wireRemind(el); }
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
      : '<button type="button" class="x97-pill" data-x97-action="edit-upcoming" data-id="' + attr(item.id) + '" style="cursor:pointer;border:1px dashed var(--line2)">' + icon("plus", 12) + ' Add number</button>';
    var reminded = item.lastRemindedAt ? '<span class="x97-pill good">' + icon("check", 12) + 'Reminded ' + esc(relFromISO(item.lastRemindedAt)) + '</span>' : '';
    var progHTML = prog ? '<span class="x97-pill ' + (prog === "sent" ? "good" : prog === "error" ? "bad" : "warn") + '">' + esc(progLabel(prog)) + '</span>' : '';
    return '<div class="x97-rm-item' + (sel ? ' on' : '') + (wa ? '' : ' nowa') + '" data-id="' + attr(item.id) + '">' +
      '<div class="x97-rm-head"><label class="x97-rm-pick"><input type="checkbox" class="x97-rm-check" data-id="' + attr(item.id) + '" ' + (sel ? 'checked' : '') + (wa ? '' : ' disabled') + '></label>' +
      '<div class="x97-rm-body"><div class="x97-rm-top"><span class="x97-rm-name">' + esc(item.client || "Untitled") + '</span><span class="x97-rm-amt x97-money">' + (outstandingOf(item) ? money(outstandingOf(item), cur) : "—") + '</span></div>' +
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
    var body = '<div class="x97-help" style="margin-bottom:12px">Connects your real Google Contacts (name + phone) into a list here. This needs a free, one-time <b>Google API Client ID</b> for your own copy of the app. See the setup guide, then paste the Client ID below.</div>' +
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
    var form=e.target.closest("[data-x97-form]");if(!form)return;e.preventDefault();var type=form.dataset.x97Form;if(type==="upcoming")submitUpcoming(form);else if(type==="payment")submitPayment(form);else if(type==="account")submitAccount(form);else if(type==="facility")submitFacility(form);else if(type==="borrow")submitBorrow(form);else if(type==="repay")submitRepay(form);else if(type==="reminder-templates")submitTemplates(form);else if(type==="wa-safety")submitSafety(form);else if(type==="wa-numbers")submitNumbers(form);else if(type==="google-setup")submitGoogleSetup(form);
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
    if(action==="mark-paid"){e.stopPropagation();openPaymentForm(btn.dataset.id);return;}
    if(action==="chase-one"){e.stopPropagation();var chaseDoc=readDoc(),chaseItem=chaseDoc&&(chaseDoc.followups||[]).find(function(x){return String(x.id)===String(btn.dataset.id);});if(!chaseItem||!hasWa(chaseItem,chaseDoc)){toast("Add a verified WhatsApp number first","error");return;}window.open("https://wa.me/"+waNumber(chaseItem.phone,chaseDoc)+"?text="+encodeURIComponent(messageFor(chaseItem,chaseDoc)),"_blank","noopener");markReminded(chaseItem.id,"onetap");return;}
    if(action==="pay-part"){var pf=document.getElementById("x97-pay-form");if(pf){var cap=num(pf.amount.max);pf.amount.value=Math.max(1,Math.round(cap*num(btn.dataset.value)/100));}return;}
    if(action==="undo-payment"){if(confirm("Undo this payment? The amount goes back to outstanding and any account credit is reversed.")){var pid=btn.dataset.id,fid="";updateDoc(function(doc){var p=(doc.payments||[]).find(function(x){return String(x.id)===String(pid);});if(p)fid=p.followupId;reversePayment(doc,pid);},"payment-undo");closeSheet();if(fid)openPaymentForm(fid);}return;}
    if(action==="delete-upcoming"){var targetDoc=readDoc(),targetItem=targetDoc&&(targetDoc.followups||[]).find(function(x){return String(x.id)===String(btn.dataset.id);});if(targetItem&&dealHasRecordedMoney(targetItem)){toast("A deal with recorded money cannot be deleted","error");return;}if(confirm("Delete this upcoming payment?")){updateDoc(function(doc){doc.followups=doc.followups.filter(function(x){return String(x.id)!==String(btn.dataset.id);});},"upcoming-delete");closeSheet();}return;}
    if(action==="quick-date"){var value=btn.dataset.value==="month-end"?dateISO(endOfMonth(todayDate())):dateISO(addDays(todayDate(),num(btn.dataset.days))),changed=[];var input=document.querySelector("#x97-upcoming-form [name=expectedBy]"),start=document.querySelector("#x97-upcoming-form [name=startDate]"),first=document.querySelector("#x97-upcoming-form [name=firstDue]"),depositDue=document.querySelector("#x97-upcoming-form [name=depositDue]");if(input){input.value=value;changed.push(input);}if(start){start.value=value;changed.push(start);}if(first){first.value=value;changed.push(first);}if(depositDue){depositDue.value=value;changed.push(depositDue);}var second=document.querySelector("#x97-upcoming-form [name=secondDue]"),balanceDue=document.querySelector("#x97-upcoming-form [name=balanceDue]"),dealTypeInput=document.querySelector("#x97-upcoming-form [name=dealType]");if(second&&dealTypeInput&&(dealTypeInput.value==="split"||dealTypeInput.value==="deposit")&&!second.value){second.value=value;changed.push(second);}if(balanceDue&&dealTypeInput&&dealTypeInput.value==="deposit"&&!balanceDue.value){balanceDue.value=value;changed.push(balanceDue);}changed.forEach(function(el){try{el.dispatchEvent(new Event("input",{bubbles:true}));}catch(_){}});return;}
    if(action==="quick-filter"){state.upcoming.quick=btn.dataset.value;savePrefs();scheduleRender(0);return;}
    if(action==="open-month"){state.upcoming.month=btn.dataset.month;state.upcoming.quick="open";savePrefs();var item=findNavItem("upcoming");if(item&&!item.classList.contains("on"))item.click();else scheduleRender(0);return;}
    if(action==="clear-filter"){var k=btn.dataset.filter;if(k==="month")state.upcoming.month="all";else if(k==="statuses")state.upcoming.statuses=[];else if(k==="currencies")state.upcoming.currencies=[];else if(k==="categories")state.upcoming.categories=[];else if(k==="dates"){state.upcoming.from="";state.upcoming.to="";}else if(k==="amount"){state.upcoming.minAmount="";state.upcoming.maxAmount="";}else if(k==="sort")state.upcoming.sort="urgency";savePrefs();scheduleRender(0);return;}
    if(action==="clear-all-filters"){state.upcoming.statuses=[];state.upcoming.currencies=[];state.upcoming.categories=[];state.upcoming.from="";state.upcoming.to="";state.upcoming.minAmount="";state.upcoming.maxAmount="";state.upcoming.sort="urgency";state.upcoming.month="all";state.upcoming.quick="all";savePrefs();scheduleRender(0);return;}
    if(action==="go-upcoming"||action==="go-upcoming-months"){var up=findNavItem("upcoming");if(up)up.click();return;}
    if(action==="record-payment"){var current=readDoc(), summary=current&&analytics(current), target=summary&&(summary.overdue[0]||summary.next7[0]);if(target)openPaymentForm(target.itemId);else {var firstOpen=current&&(current.followups||[]).find(isOpenFollowup);if(firstOpen)openPaymentForm(firstOpen.id);else toast("Add an incoming deal first","error");}return;}
    if(action==="go-expenses"){var expenses=findNavItem("expenses");if(expenses)expenses.click();return;}
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
    if(action==="grid-add-row"){igAddRow();return;}
    if(action==="grid-undo"){igUndo();return;}
    if(action==="grid-redo"){igRedo();return;}
    if(action==="grid-sort"){var gsKey=btn.dataset.col;if(gsKey==="client")state.upcoming.sort="client";else if(gsKey==="gross"||gsKey==="balance")state.upcoming.sort=state.upcoming.sort==="amountDesc"?"amountAsc":"amountDesc";else if(gsKey==="due")state.upcoming.sort=state.upcoming.sort==="dateAsc"?"dateDesc":"dateAsc";savePrefs();scheduleRender(0);return;}
    if(action==="open-grid-filters"){openGridFilters(readDoc());return;}
    if(action==="grid-filters-apply"){savePrefs();closeSheet();scheduleRender(0);return;}
    if(action==="grid-filters-reset"){state.upcoming.statuses=[];state.upcoming.currencies=[];state.upcoming.categories=[];state.upcoming.from="";state.upcoming.to="";state.upcoming.minAmount="";state.upcoming.maxAmount="";state.upcoming.quick="open";state.upcoming.sort="urgency";state.upcoming.search="";state.upcoming.month="all";savePrefs();closeSheet();scheduleRender(0);return;}
    if(action==="grid-legend"){var lgr=btn.getBoundingClientRect();igOpenLegend(lgr.left,lgr.bottom+6);return;}
    if(action==="open-grid-columns"){openGridColumns();return;}
    if(action==="open-grid-more"){openGridMore();return;}
    if(action==="grid-zoom"){igSetZoom(btn.dataset.value);return;}
    if(action==="set-theme"){setTheme(btn.dataset.value);return;}
    if(action==="grid-collapse-all"){igCollapseAll(btn.dataset.value!=="expand");closeSheet();return;}
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
      if(raw&&raw!==lastRaw){lastRaw=raw;if(gridState.editing){gridState.pendingExternalRender=true;return;}scheduleRender(50);}
    },1000);
  }

  function boot() {
    try { localStorage.removeItem("ns97-ai-cfg-v1"); } catch (_) {}
    applyTheme(loadTheme());
    injectCSS();injectMsgCSS();injectFeatureCSS();injectProCSS();injectRevampCSS();injectV2CSS();loadPrefs();resumeOriginalTab();initRemindBridge();fxWatch();
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
    window.__x97v2={version:VERSION,render:scheduleRender,read:readDoc,analytics:function(){var d=readDoc();return d?analytics(d):null;},fx:{rates:fxLoad,refresh:function(){fxRefresh(true);},convert:fxConvert},money:{gross:grossOf,paid:paidOf,outstanding:outstandingOf,earned:earnedIn,series:earningsSeries,csv:function(kind){return csvFor(readDoc(),kind).csv;},doc:function(id,kind){var d=readDoc();var i=(d.followups||[]).find(function(x){return String(x.id)===String(id);});return i?documentText(i,d,kind):"";}},selfTest:function(){var d=readDoc(),fx=fxLoad();return {version:VERSION,dataReady:!!d,followups:d?d.followups.length:0,payments:d?d.payments.length:0,facilities:d?d.credit.length:0,loans:d?virtualLegacyLoans(d).length:0,screen:currentScreen,fx:fx?{source:fx.source,day:fx.day,ugx:fx.rates.UGX,currencies:Object.keys(fx.rates).length,stale:fxStale(fx)}:null};}};
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
