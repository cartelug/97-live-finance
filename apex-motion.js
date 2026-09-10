(function () {
  "use strict";

  if (window.__S97_APEX_MOTION__) return;
  window.__S97_APEX_MOTION__ = true;

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var seen = new WeakSet();
  var frame = 0;
  var currentPage = "";
  var observer = null;
  var pending = [];
  var sweepTimer = 0;

  var variants = [
    "rise", "left", "right", "scale", "blur", "wipe", "fold", "drift",
    "glide", "zoom", "metric", "spotlight", "cascade", "ledger"
  ];

  function pageName() {
    var active = document.querySelector(".navitem.on");
    if (active) {
      var label = (active.textContent || "").trim().toLowerCase();
      if (label === "home") return "dashboard";
      if (label === "incoming") return "upcoming";
      if (label === "credit" || label === "expenses" || label === "settings") return label;
    }
    var dynamic = document.getElementById("x97-v2-root");
    if (dynamic && dynamic.dataset.screen) return dynamic.dataset.screen;
    var classic = document.querySelector(".v3-classic-app");
    return classic && classic.dataset.v3Page ? classic.dataset.v3Page : "home";
  }

  /* Already on screen? Reveal synchronously rather than hiding it and
     waiting for the observer's async first callback. That callback has to
     survive until the next frame, and experience-v2.js re-renders whole
     screens by replacing innerHTML — so an element decorated just before a
     re-render is destroyed with its reveal still pending, and the fresh
     copy that replaces it can lose the same race again. Anything above the
     fold is visible immediately; only content the user has yet to reach is
     handed to the observer, which is the only place the scroll choreography
     was ever meant to apply. */
  function onScreen(element) {
    var rect = element.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    var viewport = window.innerHeight || document.documentElement.clientHeight;
    return rect.top < viewport && rect.bottom > 0;
  }

  /* An element with no box at all is not "below the fold" — it is inside
     something currently hidden, which is what the legacy screens look like
     while the V2 layer is still swapping modes. Handing it straight to the
     observer left it unrevealed long after it was on screen (the page title on
     Expenses and Settings sat at opacity 0 until the 4s CSS failsafe fired).
     Track those separately and re-check them until they gain a box. */
  function boxless(element) {
    var rect = element.getBoundingClientRect();
    return !rect.width && !rect.height;
  }

  function motion(element, variant, order) {
    if (!element || seen.has(element)) return;
    seen.add(element);
    element.dataset.s97Motion = variant;
    element.style.setProperty("--s97-order", String(order || 0));
    if (reduced || !observer || onScreen(element)) { element.classList.add("is-inview"); return; }
    observer.observe(element);
    if (boxless(element)) { pending.push(element); ensureSweep(); }
  }

  function sweepPending() {
    if (!pending.length) return;
    pending = pending.filter(function (element) {
      if (!element.isConnected || element.classList.contains("is-inview")) return false;
      if (boxless(element)) return true;                 // still hidden — keep waiting
      if (onScreen(element)) {
        element.classList.add("is-inview");
        if (observer) observer.unobserve(element);
      }
      return false;                                      // has a box; the observer owns it now
    });
  }

  function ensureSweep() {
    if (sweepTimer || !pending.length) return;
    sweepTimer = setInterval(function () {
      sweepPending();
      if (!pending.length) { clearInterval(sweepTimer); sweepTimer = 0; }
    }, 120);
  }

  function classifyDashboard(scope) {
    var sections = scope.querySelectorAll(".x97-dashboard-main > section");
    Array.prototype.forEach.call(sections, function (section) {
      if (section.classList.contains("x97-hero-command")) section.dataset.s97Module = "hero";
      else if (section.classList.contains("x97-command-actions")) section.dataset.s97Module = "actions";
      else if (section.classList.contains("x97-glance-section")) section.dataset.s97Module = "glance";
      else if (section.classList.contains("x97-dashboard-accounts")) section.dataset.s97Module = "accounts";
      else if (section.classList.contains("x97-deals-overview")) section.dataset.s97Module = "deals";
      else if (section.classList.contains("x97-credit-preview")) section.dataset.s97Module = "credit";
      else {
        var title = section.querySelector(".x97-section-title");
        var key = title ? title.textContent.trim().toLowerCase() : "";
        if (key === "needs attention") section.dataset.s97Module = "attention";
        else if (key === "messaging") section.dataset.s97Module = "messaging";
        else if (key === "next 7 days") section.dataset.s97Module = "week";
        else if (key === "earnings") section.dataset.s97Module = "earnings";
        else if (key === "currency") section.dataset.s97Module = "currency";
        else if (key === "incoming pipeline") section.dataset.s97Module = "pipeline";
      }
    });
  }

  function decorate(scope) {
    if (!scope || scope.nodeType !== 1) return;
    classifyDashboard(scope);

    var page = pageName();
    document.body.dataset.s97Page = page;
    if (page !== currentPage) {
      currentPage = page;
      var screen = page === "expenses" || page === "settings"
        ? document.querySelector(".v3-screen")
        : document.querySelector("#x97-v2-root > *");
      if (screen) {
        screen.classList.remove("s97-page-enter");
        void screen.offsetWidth;
        screen.classList.add("s97-page-enter");
      }
    }

    Array.prototype.forEach.call(scope.querySelectorAll(".x97-brand-lockup, .v3-appbar-inner > div:first-child"), function (el, i) {
      motion(el, "brand", i);
    });
    Array.prototype.forEach.call(scope.querySelectorAll(".x97-title, .s97-page-heading h1"), function (el, i) {
      motion(el, "headline", i + 1);
    });
    Array.prototype.forEach.call(scope.querySelectorAll(".x97-hero-command, .ic-hero"), function (el, i) {
      motion(el, "hero", i);
    });

    var sectionTargets = scope.querySelectorAll(
      ".x97-dashboard-main > section:not(.x97-hero-command), .s97-budget-overview, " +
      ".s97-setting-card, .s97-page-heading, .s97-credit-summary, .s97-credit-page > .x97-segment, " +
      ".ic-filter-deck, #ic-controls, .ic-listwrap"
    );
    Array.prototype.forEach.call(sectionTargets, function (el, i) {
      motion(el, variants[i % 12], i % 6);
    });

    var cards = scope.querySelectorAll(
      ".x97-summary, .x97-command-action, .x97-month-card, .x97-deal-metric-card, " +
      ".x97-facility, .x97-loan, .s97-budget-card, .s97-expense-row, .s97-editable-tags > span"
    );
    Array.prototype.forEach.call(cards, function (el, i) {
      motion(el, variants[(i + 3) % variants.length], i % 9);
    });

    var rows = scope.querySelectorAll(".ic-group, .ic-list > .ic-row:not(.ic-row-head), .x97-timeline > *, .x97-account-rail > .x97-row");
    Array.prototype.forEach.call(rows, function (el, i) {
      motion(el, i % 4 === 0 ? "ledger" : variants[(i + 8) % variants.length], Math.min(i % 10, 9));
    });

    /* Smaller interface beats complete the sequence on sparse pages too:
       Expenses with no entries, for example, still receives 10+ intentional
       openings without manufacturing content or changing its data. */
    var micro = scope.querySelectorAll(
      ".x97-top-actions > *, .s97-page-heading > *, .s97-month-control > *, " +
      ".s97-section-label, .ic-toolbar > *, .ic-hero-chips > *, " +
      ".s97-credit-page > .x97-segment > *, .s97-backups .btn"
    );
    Array.prototype.forEach.call(micro, function (el, i) {
      motion(el, variants[(i + 5) % variants.length], i % 7);
    });
  }

  function scan() {
    frame = 0;
    decorate(document.body);
    sweepPending();
    document.documentElement.classList.add("s97-motion-ready");
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(scan);
  }

  function updateProgress() {
    var root = document.documentElement;
    var max = Math.max(0, root.scrollHeight - window.innerHeight);
    var value = max ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    root.style.setProperty("--s97-scroll", value.toFixed(4));
  }

  if (!reduced && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-inview");
        observer.unobserve(entry.target);
      });
    }, { threshold: .06, rootMargin: "0px 0px -3% 0px" });
  }

  var bar = document.createElement("div");
  bar.className = "s97-scroll-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);

  var scrollFrame = 0;
  window.addEventListener("scroll", function () {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(function () {
      scrollFrame = 0;
      updateProgress();
    });
  }, { passive: true });
  window.addEventListener("resize", updateProgress, { passive: true });

  var mutations = new MutationObserver(function (records) {
    var changed = records.some(function (record) { return record.addedNodes && record.addedNodes.length; });
    if (changed) schedule();
  });
  mutations.observe(document.body, { childList: true, subtree: true });

  updateProgress();
  schedule();
})();
