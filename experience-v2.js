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
  /* Set just before the reload below, and read by the boot script in
     index.html: this reload is a tab switch, not a cold start, so the splash
     should stay out of the way. */
  var QUIET_KEY = "ns97.v2.quiet-boot";
  var MANAGED = { dashboard: true, upcoming: true, credit: true };
  /* Expenses and Settings are still drawn by the legacy bundle. We do not
     re-render them, but they get the same header the managed screens use, so
     the app reads as one product instead of two. See enterChromeMode. */
  var CHROME = {
    expenses: { kicker: "97 LIVE / Spending", title: "Expenses", sub: "Budgets and what you have spent this month." },
    settings: { kicker: "97 LIVE / Workspace", title: "Settings", sub: "Currencies, categories and your cloud copy." }
  };
  var chromeScreen = null;
  var legacyHeader = null;
  var legacyHeaderDisplay = "";
  var root = null;
  var wrap = null;
  var hiddenChildren = [];
  var currentScreen = null;
  // Set true for exactly one render whenever the active tab actually
  // changes (see syncMode) — Incoming's own arrival animation reads and
  // clears it, so switching tabs rises in like Dashboard/Credit always
  // have, without replaying that animation on every filter click, which
  // re-renders the same screen far more often than a tab switch happens.
  var screenEntering = false;
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
      // Label and amount stay locked with the rest of the deal's structure,
      // but a date is a date: a not-yet-paid instalment can always be moved,
      // and one already paid can't be rescheduled regardless of lock state.
      var partPaid = num(previous.paid) > 0 && num(previous.paid) >= num(previous.amount) - 0.5;
      rows.push('<div class="x97-custom-row"><span class="x97-custom-index">' + (i + 1) + '</span><div class="x97-custom-fields"><input class="x97-input" name="partLabel_' + i + '" value="' + attr(previous.label || "Payment " + (i + 1)) + '" placeholder="What is this payment for?"' + (locked ? " disabled" : "") + '><div class="x97-fields-2"><input class="x97-input" name="partAmount_' + i + '" type="number" min="0" step="1" value="' + attr(previous.amount || "") + '" placeholder="Amount"' + (locked ? " disabled" : "") + '><input class="x97-input" name="partDate_' + i + '" type="date" value="' + attr(due) + '"' + (partPaid ? " disabled" : "") + '></div></div></div>');
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
    scheduleRender(0);
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
    if (meta) meta.setAttribute("content", dark ? "#071618" : "#F3F6F2");
    try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch (_) {}
  }
  function setTheme(mode) {
    if (loadTheme() === (mode === "dark" ? "dark" : "light")) return;
    applyTheme(mode);
    // Reopen the sheet so its own switch shows the choice that was just made.
    if (document.getElementById("x97-sheet")) openIncomingMore();
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
      rows: '<rect x="3" y="5" width="18" height="4" rx="1"></rect><rect x="3" y="11" width="18" height="4" rx="1"></rect><path d="M3 20h18"></path>'
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
    return '<header class="x97-top"><div class="x97-brand-lockup"><span class="x97-brand-mark"><img src="./icons/mark-97.png" width="48" height="42" alt="97" decoding="async"></span><span class="x97-brand-word">LIVE<small>FINANCE</small></span></div><div class="x97-top-copy"><h1 class="x97-title">' + esc(title) + '</h1>' + (subtitle ? '<p class="x97-sub">' + esc(subtitle) + '</p>' : '') + '</div><div class="x97-top-actions">' + (actionHTML || '') + cloudPill() + '</div></header>';
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
    if (/expense|spend/.test(text)) return "expenses";
    if (/setting|config/.test(text)) return "settings";
    return null;
  }

  function findNavItem(screenOrText) {
    var items = Array.prototype.slice.call(document.querySelectorAll(".navitem"));
    return items.find(function (item) {
      var text = (item.textContent || "").trim().toLowerCase();
      if (screenOrText === "dashboard") return /dashboard|home/.test(text);
      if (screenOrText === "upcoming") return /follow|incoming|upcoming|receivable/.test(text);
      if (screenOrText === "credit") return /credit|loan/.test(text);
      if (screenOrText === "expenses") return /expense|spend/.test(text);
      if (screenOrText === "settings") return /setting|config/.test(text);
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

  /* ── Shared chrome for the legacy screens ────────────────────────────────
     Expenses and Settings are still React's to render. We leave their body
     alone and only swap the header: hide the bundle's own small brand bar and
     put the standard page header above it, so the brand lockup, the title and
     the control deck sit exactly where they do everywhere else. */
  function hideLegacyHeader() {
    if (legacyHeader && legacyHeader.isConnected) { legacyHeader.style.display = "none"; return; }
    if (!wrap) return;
    var marks = wrap.querySelectorAll('img[src*="mark-97"]');
    for (var i = 0; i < marks.length; i++) {
      var child = directChildFor(marks[i], wrap);
      if (!child || child === root) continue;   // skip our own lockup
      legacyHeader = child;
      legacyHeaderDisplay = child.style.display;
      child.style.display = "none";
      return;
    }
  }

  function showLegacyHeader() {
    if (legacyHeader) legacyHeader.style.display = legacyHeaderDisplay || "";
    legacyHeader = null;
    legacyHeaderDisplay = "";
  }

  function enterChromeMode(screen) {
    var meta = CHROME[screen];
    if (!meta || !ensureRoot()) return;
    document.body.classList.add("x97-v2-mode", "x97-v2-chrome");
    root.classList.add("on");
    root.dataset.screen = screen;
    hideLegacyHeader();
    if (chromeScreen !== screen) {
      chromeScreen = screen;
      root.innerHTML = '<div class="x97-page" data-v2-page="' + attr(screen) + '">' +
        pageHeader(meta.kicker, meta.title, meta.sub, "") + '</div>';
      updateCloudPill();
    }
    scheduleViewportFab();
  }

  function exitChromeMode() {
    if (!chromeScreen) return;
    chromeScreen = null;
    document.body.classList.remove("x97-v2-chrome");
    if (!modeActive) document.body.classList.remove("x97-v2-mode");
    if (root) { root.classList.remove("on"); root.innerHTML = ""; delete root.dataset.screen; }
    showLegacyHeader();
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
      exitChromeMode();
      enterManagedMode();
      if (screen !== currentScreen) { currentScreen = screen; screenEntering = true; window.scrollTo(0, 0); }
      scheduleRender(0);
    } else if (screen && CHROME[screen]) {
      exitManagedMode();
      enterChromeMode(screen);
    } else {
      exitChromeMode();
      exitManagedMode();
    }
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

  // What a row of scheduled events is worth, per currency.
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

  // How far past due the worst one is — the number that decides which
  // overdue pile you open first.
  function attentionOldest(events) {
    var worst = 0;
    (events || []).forEach(function (event) {
      var days = daysBetween(todayDate(), parseLocalDate(event.date));
      if (days != null && days < 0) worst = Math.max(worst, -days);
    });
    return worst;
  }

  function attentionMeta() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join(" · ");
  }

  /* Each alert carries its count apart from its wording, so the count can be
     typeset as the figure it is rather than buried mid-sentence, and a meta
     line that says what is actually at stake. The second line used to read
     "Open Incoming to follow up" on every row — an instruction the chevron
     already gives, spending a whole line to say nothing. Money and dates go
     there instead. */
  function dashboardAttention(doc, a) {
    var items = [];
    if (a.overdue.length) {
      var oldest = attentionOldest(a.overdue);
      items.push({
        type: "bad", count: a.overdue.length, nav: "upcoming",
        label: "overdue incoming payment" + (a.overdue.length === 1 ? "" : "s"),
        meta: attentionMeta(attentionAmount(a.overdue), oldest ? "oldest " + oldest + " day" + (oldest === 1 ? "" : "s") : "")
      });
    }
    var overdueLoans = a.activeLoans.filter(function (l) { return daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))) < 0; });
    if (overdueLoans.length) items.push({
      type: "bad", count: overdueLoans.length, nav: "credit",
      label: "overdue credit repayment" + (overdueLoans.length === 1 ? "" : "s"),
      meta: attentionMeta(money(a.debt, "UGX", true) + " due", "earliest " + nextLoanDue(overdueLoans))
    });
    var soonLoans = a.activeLoans.filter(function (l) { var d = daysBetween(todayDate(), parseLocalDate(dueDateForLoan(l))); return d >= 0 && d <= 4; });
    if (soonLoans.length) items.push({
      type: "warn", count: soonLoans.length, nav: "credit",
      label: "repayment" + (soonLoans.length === 1 ? "" : "s") + " due soon",
      meta: attentionMeta("within four days", "earliest " + nextLoanDue(soonLoans))
    });
    if (a.next7.length) items.push({
      type: "warn", count: a.next7.length, nav: "upcoming",
      label: "incoming payment" + (a.next7.length === 1 ? "" : "s") + " due in 7 days",
      meta: attentionAmount(a.next7)
    });
    if (a.expenses.personalSafe < 0) items.push({
      type: "bad", nav: "expenses", label: "Personal budget is overcommitted",
      meta: money(Math.abs(a.expenses.personalSafe), "UGX", true) + " above the safe amount"
    });
    if (a.expenses.businessSafe < 0) items.push({
      type: "bad", nav: "expenses", label: "Business budget is overcommitted",
      meta: money(Math.abs(a.expenses.businessSafe), "UGX", true) + " above the safe amount"
    });
    var unscheduled = a.open.filter(function (x) { var next = nextScheduledPayment(doc, x); return !next || !next.dueDate; });
    if (unscheduled.length) items.push({
      type: "warn", count: unscheduled.length, nav: "upcoming",
      label: "incoming item" + (unscheduled.length === 1 ? " needs" : "s need") + " a date",
      meta: attentionMeta(attentionAmount(unscheduled.map(function (x) { return { amount: outstandingOf(x), currency: x.currency }; })), "not scheduled")
    });
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
    // Receivables are held in two currencies. The headline is a single home-currency
    // figure, so dollars convert at the live rate and fall back to the rate saved in
    // Settings — never silently dropped, which would understate what is owed.
    var outstandingUSDHome = 0;
    if (outstandingUSD) {
      var converted = fxConvert(outstandingUSD, "USD", FX_HOME);
      outstandingUSDHome = converted == null ? outstandingUSD * num(doc.meta && doc.meta.usdRate) : converted;
    }
    var incomingTotal = outstandingUGX + outstandingUSDHome;
    var totalPosition = a.cash + a.creditAvailable + incomingTotal;
    var months = [0, 1, 2].map(function (offset) { var d = startOfMonth(todayDate()); d.setMonth(d.getMonth() + offset); return monthKey(d); });
    var accountRows = (doc.balances || []).slice().sort(function (a, b) {
      var ae = /equity/i.test(String(a.account || "")), be = /equity/i.test(String(b.account || ""));
      return ae === be ? 0 : ae ? -1 : 1;
    }).map(function (b) {
      return '<button class="x97-row" style="width:100%;border-left:0;border-right:0;border-top:0;background:transparent;text-align:left" data-x97-action="edit-account" data-id="' + attr(b.id) + '">' + accountIconBox(b.account) + '<div class="x97-row-main"><div class="x97-row-title">' + esc(b.account || "Account") + '</div><div class="x97-row-sub">' + esc(b.line || b.notes || "Tap to update balance") + '</div></div><div class="x97-row-value">' + money(b.balance, "UGX") + '</div></button>';
    }).join("");
    /* One severity signal, not two: the rail carries the tone, so the row
       drops the tinted tile that repeated the same warning glyph on every
       line and said nothing the colour had not already said. The count
       leads as a figure; the wording follows it. */
    var attentionRows = attention.length ? '<div class="x97-attention">' + attention.map(function (x) {
      return '<button class="x97-att is-' + esc(x.type) + '" data-x97-nav="' + attr(x.nav) + '">' +
        (x.count != null ? '<span class="x97-att-count x97-money">' + esc(x.count) + '</span>' : '<span class="x97-att-count is-empty" aria-hidden="true"></span>') +
        '<span class="x97-att-body"><span class="x97-att-label">' + esc(x.label) + '</span>' +
        (x.meta ? '<span class="x97-att-meta">' + esc(x.meta) + '</span>' : '') + '</span>' +
        '<span class="x97-att-go">' + icon("chevron", 16) + '</span>' +
      '</button>';
    }).join("") + '</div>' : '<div class="x97-empty">' + icon("check", 25) + '<strong>Nothing urgent</strong><p>Your upcoming money, credit and budgets have no critical alerts.</p></div>';
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
      pageHeader("97 Live Finance", "Your money", "") +
      '<div class="x97-dashboard-main">' +
        '<section class="x97-card x97-hero x97-hero-command" data-v2-hero><div class="x97-hero-topline"><div class="x97-hero-label">Total position</div><span class="x97-hero-live">Cash + credit + incoming</span></div><button type="button" class="x97-hero-value x97-money x97-hero-value-btn" data-x97-action="edit-balances" aria-label="Update balances">' + money(totalPosition, "UGX") + '<span class="x97-hero-edit-hint">' + icon("edit", 18) + '</span></button>' +
          '<div class="x97-hero-split">' +
            '<div class="x97-hero-part"><span class="x97-hero-part-k">Cash on hand</span><b class="x97-money">' + money(a.cash, "UGX") + '</b></div>' +
            '<div class="x97-hero-part"><span class="x97-hero-part-k">Available credit</span><b class="x97-money is-credit">' + money(a.creditAvailable, "UGX") + '</b></div>' +
            '<div class="x97-hero-part"><span class="x97-hero-part-k">Incoming</span><b class="x97-money is-incoming">' + money(incomingTotal, "UGX") + (outstandingUSD ? '<small>incl. ' + esc(money(outstandingUSD, "USD", true)) + '</small>' : '') + '</b></div>' +
          '</div>' +
          '<div class="x97-hero-caption">Money you hold, credit you can draw and invoices still owed — tap the total to edit balances and credit lines.</div></section>' +
        '<section class="x97-command-actions x97-dashboard-wide"><button class="x97-command-action primary" data-x97-action="record-payment"><span class="x97-command-icon">' + icon("wallet", 17) + '</span><span><b>Record payment</b><small>Money received</small></span>' + icon("chevron", 14) + '</button><button class="x97-command-action" data-x97-action="add-upcoming"><span class="x97-command-icon teal">' + icon("plus", 17) + '</span><span><b>Add deal</b><small>Money expected</small></span>' + icon("chevron", 14) + '</button><button class="x97-command-action" data-x97-action="go-expenses"><span class="x97-command-icon warn">' + icon("trend", 17) + '</span><span><b>Add expense</b><small>Money spent</small></span>' + icon("chevron", 14) + '</button></section>' +
        '<section class="x97-section x97-glance-section x97-dashboard-wide">' + sectionHead("At a glance") + '<div class="x97-summary-grid x97-finance-pulse"><div class="x97-card x97-summary"><div class="k">Collected this month</div><div class="v x97-money x97-green">' + money(collectedThisMonth, "UGX", true) + '</div><div class="s">Actual money received</div></div><div class="x97-card x97-summary"><div class="k">Due next 7 days</div><div class="v x97-money x97-teal">' + money(in7, "UGX", true) + '</div><div class="s">' + (in7USD ? '<span class="x97-teal">' + money(in7USD, "USD", true) + '</span> · ' : '') + 'Scheduled incoming</div></div><div class="x97-card x97-summary"><div class="k">Outstanding</div><div class="v x97-money x97-amber">' + money(outstandingUGX, "UGX", true) + '</div><div class="s">' + (outstandingUSD ? '<span class="x97-teal">' + money(outstandingUSD, "USD", true) + '</span> · ' : '') + 'Still owed by clients</div></div><div class="x97-card x97-summary"><div class="k">Actual spending</div><div class="v x97-money x97-red">' + money(actualSpend, "UGX", true) + '</div><div class="s">This month</div></div></div></section>' +
        '<section class="x97-section x97-dashboard-accounts">' + sectionHead("Accounts", "Add account", "add-account") + '<div class="x97-card x97-pad x97-account-rail">' + (accountRows || '<div class="x97-empty"><strong>No accounts yet</strong><p>Add your bank, mobile money or cash balance.</p></div>') + '</div></section>' +
        '<section class="x97-section">' + sectionHead("Needs attention", "View Incoming", "go-upcoming") + '<div class="x97-card x97-pad">' + attentionRows + '</div></section>' +
        (function(){var s=messagingSummary(doc);var pillOd=s.overdue?'<span class="x97-pill bad">'+s.overdue+' overdue</span>':(s.dueSoon?'<span class="x97-pill warn">'+s.dueSoon+' due soon</span>':'<span class="x97-pill good">'+icon("check",11)+'All clear</span>');return '<section class="x97-section">' + sectionHead("Messaging", "Open", "open-messaging") + '<button class="x97-msg-card" data-x97-action="open-messaging"><div class="x97-msg-icon">' + icon("send") + '</div><div class="x97-msg-body"><div class="x97-msg-title">WhatsApp reminders &amp; campaigns</div><div class="x97-msg-sub">' + s.contacts + ' contacts · ' + s.campaigns + ' campaigns' + (remindExt.ready?' · sender connected':'') + '</div><div class="x97-msg-pills">' + pillOd + '</div></div>' + icon("chevron") + '</button></section>';})() +
        '<section class="x97-section">' + sectionHead("Next 7 days") + '<div class="x97-card x97-pad"><div class="x97-hero-meta" style="margin-bottom:4px"><div class="x97-stat x97-stat-in"><span>Expected in</span><b class="x97-green">' + money(in7, "UGX") + '</b></div><div class="x97-stat x97-stat-out"><span>Expected out</span><b class="x97-red">' + money(out7, "UGX") + '</b></div></div>' + timelineRows + '</div></section>' +
        earnCardHTML(doc) +
        fxCardHTML(doc) +
        '<section class="x97-section x97-dashboard-wide">' + sectionHead("Incoming pipeline", "View all months", "go-upcoming-months") + '<div class="x97-grid x97-pipeline x97-month-rail" data-v2-slider="months">' + pipeline + '</div></section>' +
        dealSummaryHTML(doc) +
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
      '<div class="ic-hero-top"><div><div class="ic-hero-label">' + esc(heroLabel) + '</div><div class="ic-hero-value tabnum"><span class="ic-hero-value-main">' + money(outUGX, "UGX", true) + '</span>' + (outUSD ? ' <span class="ic-hero-usd">+ ' + money(outUSD, "USD", true) + '</span>' : '') + '</div></div><div class="ic-hero-headline">' + esc(headline) + '</div></div>' +
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
      '<div class="ic-search">' + icon("search", 16) + '<input id="ic-search" type="search" aria-label="Search incoming deals" enterkeyhint="search" autocomplete="off" placeholder="Search deals…" value="' + attr(f.search) + '"></div>' +
      '<button class="ic-tbtn" data-x97-action="open-incoming-filters" title="Filter">' + icon("filter", 16) + (count ? '<b class="ic-tbadge">' + count + '</b>' : '') + '</button>' +
      '<button class="ic-tbtn' + (icBulk.on ? " on" : "") + '" data-x97-action="incoming-bulk-toggle" title="Select rows">' + icon("rows", 16) + '</button>' +
      '<button class="ic-tbtn" data-x97-action="open-incoming-more" title="More">' + icon("dots", 16) + '</button>' +
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
    return '<article class="ic-row ic-row-part is-' + cls + '" role="listitem" tabindex="0" data-part-index="' + index + '" data-cur="' + attr(cur) + '" data-x97-action="edit-upcoming" data-id="' + attr(parent.id) + '">' +
      '<span class="ic-c-edge"></span>' +
      '<span class="ic-c-client"><span class="ic-part-label">' + esc(part.label || ("Payment " + (index + 1))) + '</span><small>' + esc(index + 1) + ' of ' + count + '</small></span>' +
      '<span class="ic-c-structure ic-muted">—</span>' +
      '<span class="ic-c-total ic-num tabnum">' + esc(money(amount, cur)) + '</span>' +
      '<span class="ic-c-paid ic-num tabnum ' + (paid > 0 ? "ic-pos" : "") + '">' + esc(paid > 0 ? money(paid, cur) : "—") + '</span>' +
      '<span class="ic-c-balance ic-num tabnum">' + esc(left > 0 ? money(left, cur) : "—") + '</span>' +
      '<span class="ic-c-cur"><span class="ic-badge ic-cur-' + cur.toLowerCase() + '">' + cur + '</span></span>' +
      '<span class="ic-c-status"><span class="ic-badge ic-badge-' + cls + '">' + esc(statusText) + '</span></span>' +
      '<span class="ic-c-due">' + esc(due ? formatDate(due, true) : "No date") + '</span>' +
    '</article>';
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
    return '<article class="ic-row is-' + esc(t.key) + (bulked ? " is-bulked" : "") + '" role="listitem" tabindex="0" data-cur="' + attr(cur) + '" data-x97-action="' + rowAction + '" data-id="' + attr(item.id) + '">' +
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
    '</article>' +
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
        pageHeader("97 LIVE / Collections", "Incoming", "", '<button class="x97-icon-btn x97-add-primary" data-x97-action="add-upcoming" aria-label="Add incoming deal">' + icon("plus") + '<span>Add deal</span></button>') +
        '<div id="ic-summary"></div><div id="ic-controls"></div><div class="ic-filterchips" id="ic-active-filters"></div>' +
        '<div class="ic-gridwrap"><div class="ic-listwrap" id="ic-listwrap"></div></div>' +
        '<div class="ic-statusbar" id="ic-statusbar" role="status" aria-live="polite"></div>' +
      '</div>';
      shell = document.getElementById("ic-shell");
    }
    var pageY = window.scrollY;
    var sheetOpen = document.body.classList.contains("x97-sheet-open");
    var anchor = !entering && !sheetOpen && Array.from(shell.querySelectorAll('.ic-list > article[data-id]')).find(function (row) {
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
      filterButton.innerHTML = icon("filter", 16) + (filterCount ? '<b class="ic-tbadge">' + filterCount + '</b>' : '');
      var currentInput = document.getElementById("ic-search");
      if (currentInput && document.activeElement !== currentInput) currentInput.value = state.upcoming.search;
    }
    icPatchRegion(document.getElementById("ic-active-filters"), activeFilterCount() ? filterTagHTML() : "");
    icPatchRegion(document.getElementById("ic-listwrap"), (filtered.length ? icHeadHTML() : "") +
      '<div class="ic-list" id="ic-list" role="list" aria-label="Incoming receivables">' + body + '</div>' + empty);
    icPatchRegion(document.getElementById("ic-statusbar"), '<span>' + filtered.length + ' of ' + all.length + ' deals</span><span>' + esc(sortLabel(state.upcoming.sort)) + '</span>');

    if (anchorId && !sheetOpen) {
      var nextAnchor = Array.from(shell.querySelectorAll('.ic-list > article[data-id]')).find(function (row) {
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
    if (event.target.matches('.ic-list > article[data-x97-action]')) {
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
      '<div class="ic-filter-section"><label>Retainers</label><select id="ic-f-retainers" class="x97-select">' + option("all", "Include everything", f.retainers) + option("only", "Retainers only", f.retainers) + option("exclude", "Exclude retainers", f.retainers) + '</select></div>' +
      '<div class="ic-filter-section"><label>Status</label>' + chipRow("statuses", ["Pending", "Part Paid", "Paid", "Cancelled"], f.statuses) + '</div>' +
      '<div class="ic-filter-section"><label>Currency</label>' + chipRow("currencies", ["UGX", "USD"], f.currencies) + '</div>' +
      (categories.length ? '<div class="ic-filter-section"><label>Category</label>' + chipRow("categories", categories, f.categories) + '</div>' : "") +
      '<div class="ic-filter-section"><label>Due date range</label><div class="x97-fields-2"><input class="x97-input" type="date" id="ic-f-from" value="' + attr(f.from) + '"><input class="x97-input" type="date" id="ic-f-to" value="' + attr(f.to) + '"></div></div>' +
      '<div class="ic-filter-section"><label>Balance range</label><div class="x97-fields-2"><input class="x97-input" type="number" min="0" placeholder="Min" id="ic-f-min" value="' + attr(f.minAmount) + '"><input class="x97-input" type="number" min="0" placeholder="Max" id="ic-f-max" value="' + attr(f.maxAmount) + '"></div></div>' +
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
    var dark = loadTheme() === "dark";
    var body = '<div class="ic-more-list">' +
      '<button class="x97-row" data-x97-action="incoming-bulk-toggle-close">' + icon("rows", 16) + '<div class="x97-row-main"><div class="x97-row-title">Select rows…</div><div class="x97-row-sub">Pick several deals to delete at once</div></div></button>' +
      '<button class="x97-row" data-x97-action="grid-collapse-all" data-value="collapse">' + icon("collapse", 16) + '<div class="x97-row-main"><div class="x97-row-title">Collapse all schedules</div></div></button>' +
      '<button class="x97-row" data-x97-action="grid-collapse-all" data-value="expand">' + icon("expand", 16) + '<div class="x97-row-main"><div class="x97-row-title">Expand all schedules</div></div></button>' +
      '<button class="x97-row" data-x97-action="export-csv" data-kind="receivables">' + icon("list", 16) + '<div class="x97-row-main"><div class="x97-row-title">Export CSV</div></div></button>' +
    '</div>' +
    '<div class="ic-theme-row"><span class="ic-theme-label">Appearance</span><div class="ic-theme-seg"><button class="ic-theme-opt' + (!dark ? " on" : "") + '" data-x97-action="set-theme" data-value="light">' + icon("sun", 14) + ' Light</button><button class="ic-theme-opt' + (dark ? " on" : "") + '" data-x97-action="set-theme" data-value="dark">' + icon("moon", 14) + ' Dark</button></div></div>';
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
    var loans = loansOf(doc);
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
    root.innerHTML = '<div class="x97-page s97-credit-page">' +
      pageHeader("Mobile finance", "Credit", "Offers, borrowing and repayments.", '<button class="x97-icon-btn" data-x97-action="add-facility" title="Add facility">' + icon("plus") + '</button>') +
      '<div class="x97-summary-grid s97-credit-summary"><div class="x97-card x97-summary"><div class="k">Available credit</div><div class="v x97-money x97-teal">' + money(availableTotal,"UGX",true) + '</div><div class="s">Across ' + live.length + ' live facilities</div></div><div class="x97-card x97-summary"><div class="k">Borrowed</div><div class="v x97-money x97-red">' + money(borrowed,"UGX",true) + '</div><div class="s">' + active.length + ' active</div></div><div class="x97-card x97-summary"><div class="k">Amount due</div><div class="v x97-money x97-red">' + money(due,"UGX",true) + '</div><div class="s">Estimated today</div></div><div class="x97-card x97-summary"><div class="k">Next repayment</div><div class="v x97-money" style="font-size:17px">' + esc(nextLoanDue(active)) + '</div><div class="s">Earliest active loan</div></div></div>' +
      '<div class="x97-segment"><button class="' + (state.creditView === "available" ? "on" : "") + '" data-x97-action="credit-view" data-value="available">Available</button><button class="' + (state.creditView === "borrowed" ? "on" : "") + '" data-x97-action="credit-view" data-value="borrowed">Borrowed' + (active.length ? ' · ' + active.length : '') + '</button><button class="' + (state.creditView === "history" ? "on" : "") + '" data-x97-action="credit-view" data-value="history">History</button></div><div class="s97-credit-list">' + body + '</div>' +
      '<button class="x97-fab" data-x97-action="add-facility" aria-label="Add credit facility">' + icon("plus",25) + '</button></div>';
  }

  /* Loading placeholder: the silhouette of the screen that is about to arrive.
     Reads as "nearly there" rather than as an error state. */
  function skeletonHTML() {
    var rows = "";
    for (var i = 0; i < 4; i++) {
      rows += '<div class="x97-skel-row">' +
        '<span class="x97-sk x97-sk-dot" style="--i:' + (i + 3) + '"></span>' +
        '<span class="x97-sk x97-sk-line" style="--i:' + (i + 3) + '"></span>' +
        '<span class="x97-sk x97-sk-amt" style="--i:' + (i + 3) + '"></span>' +
      '</div>';
    }
    return '<div class="x97-skel" role="status" aria-live="polite" aria-label="Loading your finance data">' +
      '<div class="x97-skel-head"><span class="x97-sk x97-sk-title"></span><span class="x97-sk x97-sk-sub" style="--i:1"></span></div>' +
      '<div class="x97-skel-card">' +
        '<span class="x97-sk x97-sk-label" style="--i:1"></span>' +
        '<span class="x97-sk x97-sk-big" style="--i:2"></span>' +
        '<div class="x97-skel-split"><span class="x97-sk" style="--i:2"></span><span class="x97-sk" style="--i:3"></span></div>' +
      '</div>' + rows +
      '<p class="x97-skel-note">Loading your finance data\u2026</p>' +
    '</div>';
  }

  function render() {
    if (!currentScreen || !ensureRoot()) return;
    root.dataset.screen = currentScreen;
    var doc = readDoc();
    if (!doc) {
      root.innerHTML = '<div class="x97-page">' + skeletonHTML() + '</div>';
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
  function progLabel(p) { return ({ queued: "Queued", sending: "Sending…", typing: "Typing…", sent: "Sent ✓", error: "Failed", skipped: "Skipped", paused: "Paused" })[p] || p; }
  function safeJson(text) { try { return JSON.parse(text); } catch (_) {} var a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} } return null; }

  function openReminders() {
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
    var form=e.target.closest("[data-x97-form]");if(!form)return;e.preventDefault();var type=form.dataset.x97Form;if(type==="upcoming")submitUpcoming(form);else if(type==="payment")submitPayment(form);else if(type==="account")submitAccount(form);else if(type==="facility")submitFacility(form);else if(type==="balances")submitBalances(form);else if(type==="borrow")submitBorrow(form);else if(type==="repay")submitRepay(form);else if(type==="reminder-templates")submitTemplates(form);else if(type==="wa-safety")submitSafety(form);else if(type==="wa-numbers")submitNumbers(form);else if(type==="google-setup")submitGoogleSetup(form);
  });

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "x97-up-search") {
      state.upcoming.search=e.target.value;savePrefs();clearTimeout(searchTimer);searchTimer=setTimeout(function(){var pos=e.target.selectionStart;scheduleRender(0);setTimeout(function(){var input=document.getElementById("x97-up-search");if(input){input.focus();try{input.setSelectionRange(pos,pos);}catch(_){}}},0);},180);
    }
    var borrowForm=e.target.closest && e.target.closest("#x97-borrow-form");if(borrowForm){var doc=readDoc(),f=facilityById(doc,borrowForm.facilityId.value);if(f)renderBorrowPreview(borrowForm,f);}
  });

  document.addEventListener("click", function (e) {
    var nav=e.target.closest && e.target.closest(".navitem");
    if(nav){var text=(nav.textContent||"").trim().toLowerCase();var managed=/dashboard|home|follow|incoming|upcoming|receivable|credit|loan/.test(text);if(!managed&&needsReactRefresh){e.preventDefault();e.stopImmediatePropagation();try{sessionStorage.setItem(RESUME_KEY,text);sessionStorage.setItem(QUIET_KEY,"1");sessionStorage.removeItem(REFRESH_KEY);}catch(_){}location.reload();return;}setTimeout(syncMode,30);return;}
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
    if(action==="month-filter"){state.upcoming.month=btn.dataset.month;savePrefs();scheduleRender(0);return;}
    if(action==="filter-retainer"){var wasOn=state.upcoming.retainers==="only";state.upcoming.retainers=wasOn?"all":"only";state.upcoming.categories=[];state.upcoming.quick=wasOn?"open":"all";savePrefs();scheduleRender(0);return;}
    if(action==="open-month"){state.upcoming.month=btn.dataset.month;state.upcoming.quick="open";savePrefs();var item=findNavItem("upcoming");if(item&&!item.classList.contains("on"))item.click();else scheduleRender(0);return;}
    if(action==="clear-filter"){var k=btn.dataset.filter;if(k==="month")state.upcoming.month="all";else if(k==="statuses")state.upcoming.statuses=[];else if(k==="currencies")state.upcoming.currencies=[];else if(k==="categories")state.upcoming.categories=[];else if(k==="retainers")state.upcoming.retainers="all";else if(k==="dates"){state.upcoming.from="";state.upcoming.to="";}else if(k==="amount"){state.upcoming.minAmount="";state.upcoming.maxAmount="";}else if(k==="sort")state.upcoming.sort="urgency";savePrefs();scheduleRender(0);return;}
    if(action==="clear-all-filters"){state.upcoming.retainers="all";state.upcoming.statuses=[];state.upcoming.currencies=[];state.upcoming.categories=[];state.upcoming.from="";state.upcoming.to="";state.upcoming.minAmount="";state.upcoming.maxAmount="";state.upcoming.sort="urgency";state.upcoming.month="all";state.upcoming.quick="all";savePrefs();scheduleRender(0);return;}
    if(action==="go-upcoming"||action==="go-upcoming-months"){var up=findNavItem("upcoming");if(up)up.click();return;}
    if(action==="record-payment"){var current=readDoc(), summary=current&&analytics(current), target=summary&&(summary.overdue[0]||summary.next7[0]);if(target)openPaymentForm(target.itemId);else {var firstOpen=current&&(current.followups||[]).find(isOpenFollowup);if(firstOpen)openPaymentForm(firstOpen.id);else toast("Add an incoming deal first","error");}return;}
    if(action==="go-expenses"){var expenses=findNavItem("expenses");if(expenses)expenses.click();return;}
    if(action==="go-credit"){var cr=findNavItem("credit");if(cr)cr.click();return;}
    if(action==="edit-balances"){openBalancesEditor();return;}
    if(action==="add-account"){openAccountForm();return;}
    if(action==="edit-account"){openAccountForm(btn.dataset.id);return;}
    if(action==="delete-account"){if(confirm("Delete this account?")){updateDoc(function(doc){doc.balances=doc.balances.filter(function(x){return String(x.id)!==String(btn.dataset.id);});},"account-delete");closeSheet();}return;}
    if(action==="credit-view"){state.creditView=btn.dataset.value;scheduleRender(0);return;}
    if(action==="toggle-unavailable"){unavailableOpen=!unavailableOpen;scheduleRender(0);return;}
    if(action==="add-facility"){openFacilityForm();return;}
    if(action==="edit-facility"){openFacilityForm(btn.dataset.id);return;}
    if(action==="delete-facility"){var doc=readDoc(),has=loansOf(doc).some(function(l){return isActiveLoan(l)&&String(l.facilityId)===String(btn.dataset.id);});if(has){toast("Repay or cancel the active borrowing first","error");return;}if(confirm("Delete this credit facility?")){updateDoc(function(next){next.credit=next.credit.filter(function(x){return String(x.id)!==String(btn.dataset.id);});},"facility-delete");closeSheet();}return;}
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
    if(action==="set-theme"){setTheme(btn.dataset.value);return;}
    if(action==="grid-collapse-all"){icCollapseAll(btn.dataset.value!=="expand");closeSheet();return;}
    if(action==="incoming-bulk-toggle"){icSetBulkMode(!icBulk.on);return;}
    if(action==="incoming-bulk-cancel"){icSetBulkMode(false);return;}
    if(action==="incoming-bulk-delete"){icDeleteBulkRows();return;}
    if(action==="incoming-bulk-row"){e.stopPropagation();icToggleBulkRow(btn.dataset.id);return;}
    if(action==="incoming-collapse"){e.stopPropagation();icToggleCollapse(btn.dataset.id);return;}
  }, true);

  function resumeDone(){try{window.dispatchEvent(new CustomEvent("s97:resume-done"));}catch(_){}}

  function resumeOriginalTab() {
    var target="";try{target=sessionStorage.getItem(RESUME_KEY)||"";sessionStorage.removeItem(RESUME_KEY);sessionStorage.removeItem(REFRESH_KEY);}catch(_){}
    needsReactRefresh=false;
    if(!target){resumeDone();return;}
    var tries=0,timer=setInterval(function(){
      tries++;
      var item=findNavItem(target);
      if(item){clearInterval(timer);item.click();setTimeout(resumeDone,90);}
      else if(tries>30){clearInterval(timer);resumeDone();}
    },100);
  }

  // Store the credit migration (see migrateFacilityLoans) once, on the stored
  // document as-is, so the cloud copy and every device converge on one shape.
  // Runs after resumeOriginalTab, which resets the refresh flag set here.
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
    // The legacy screens loaded the old shape; reload before they are used again.
    needsReactRefresh = true;
    try { sessionStorage.setItem(REFRESH_KEY, "1"); } catch (_) {}
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
    try { localStorage.removeItem("ns97-ai-cfg-v1"); } catch (_) {}
    applyTheme(loadTheme());
    loadPrefs();resumeOriginalTab();initRemindBridge();fxWatch();persistCreditMigration();
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
    window.__x97v2={version:VERSION,render:scheduleRender,read:readDoc,analytics:function(){var d=readDoc();return d?analytics(d):null;},fx:{rates:fxLoad,refresh:function(){fxRefresh(true);},convert:fxConvert},money:{gross:grossOf,paid:paidOf,outstanding:outstandingOf,earned:earnedIn,series:earningsSeries,csv:function(kind){return csvFor(readDoc(),kind).csv;},doc:function(id,kind){var d=readDoc();var i=(d.followups||[]).find(function(x){return String(x.id)===String(id);});return i?documentText(i,d,kind):"";}},selfTest:function(){var d=readDoc(),fx=fxLoad();return {version:VERSION,dataReady:!!d,followups:d?d.followups.length:0,payments:d?d.payments.length:0,facilities:d?d.credit.length:0,loans:d?loansOf(d).length:0,screen:currentScreen,fx:fx?{source:fx.source,day:fx.day,ugx:fx.rates.UGX,currencies:Object.keys(fx.rates).length,stale:fxStale(fx)}:null};}};
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
