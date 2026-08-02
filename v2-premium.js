(function () {
  "use strict";

  if (window.__S97_PREMIUM_V2__) return;
  window.__S97_PREMIUM_V2__ = true;

  var THEME_KEY = "ns97.v2.theme";
  var PRIVACY_KEY = "ns97.v2.privacy";
  var AI_KEY = "ns97-ai-cfg-v1";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var frame = 0;
  var deck = null;

  function read(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function icon(name) {
    var paths = {
      sun: '<circle cx="12" cy="12" r="3.5"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>',
      moon: '<path d="M20.4 15.1A8.5 8.5 0 0 1 8.9 3.6 8.6 8.6 0 1 0 20.4 15.1Z"></path>',
      eye: '<path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z"></path><circle cx="12" cy="12" r="2.5"></circle>',
      eyeoff: '<path d="m3 3 18 18M10.6 6.7c.46-.13.93-.2 1.4-.2 6.1 0 9.5 5.5 9.5 5.5a17.7 17.7 0 0 1-2.1 2.7M6.4 7.5A17.2 17.2 0 0 0 2.5 12s3.4 5.5 9.5 5.5c1 0 2-.15 2.8-.42M9.9 9.9a3 3 0 0 0 4.2 4.2"></path>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
  }

  function currentTheme() {
    var saved = read(THEME_KEY, "");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setTheme(theme, animate) {
    var apply = function () {
      document.documentElement.dataset.v2Theme = theme;
      write(THEME_KEY, theme);
      refreshDeck();
    };
    if (animate && !reduceMotion && document.startViewTransition) document.startViewTransition(apply);
    else apply();
  }

  function privacyOn() {
    return read(PRIVACY_KEY, "off") === "on";
  }

  function setPrivacy(on) {
    if (document.body) document.body.classList.toggle("v2-private", on);
    write(PRIVACY_KEY, on ? "on" : "off");
    refreshDeck();
  }

  function tool(label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "v2-tool";
    button.dataset.v2Tool = action;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    return button;
  }

  function markClassicUI() {
    var app = document.querySelector(".app");
    if (!app) return;
    app.classList.add("v3-classic-app");

    var wrap = null;
    Array.prototype.some.call(app.children, function (child) {
      if (child.classList && child.classList.contains("wrap")) { wrap = child; return true; }
      return false;
    });
    if (!wrap) return;

    var activeNav = app.querySelector(".navitem.on");
    if (activeNav) {
      var pageName = (activeNav.textContent || "home").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      app.dataset.v3Page = pageName || "home";
    }

    Array.prototype.forEach.call(wrap.children, function (child) {
      if (child.classList && child.classList.contains("fu")) child.classList.add("v3-screen");
      if (child.style && child.style.position === "sticky") {
        child.classList.add("v3-appbar");
        if (child.firstElementChild) child.firstElementChild.classList.add("v3-appbar-inner");
      }
    });

    var screen = wrap.querySelector(".v3-screen");
    if (screen && screen.firstElementChild) screen.firstElementChild.classList.add("v3-screen-stack");
  }

  function getDeck() {
    if (deck && deck.isConnected) return deck;
    deck = document.createElement("div");
    deck.className = "v2-control-deck";
    deck.setAttribute("aria-label", "Display controls");
    deck.appendChild(tool("Toggle light and dark theme", "theme"));
    deck.appendChild(tool("Hide financial amounts", "privacy"));
    deck.addEventListener("click", function (event) {
      var button = event.target.closest("[data-v2-tool]");
      if (!button) return;
      if (button.dataset.v2Tool === "theme") setTheme(currentTheme() === "dark" ? "light" : "dark", true);
      if (button.dataset.v2Tool === "privacy") setPrivacy(!privacyOn());
      haptic(8);
    });
    refreshDeck();
    return deck;
  }

  function refreshDeck() {
    if (!deck) return;
    var dark = currentTheme() === "dark";
    var hidden = privacyOn();
    var themeButton = deck.querySelector('[data-v2-tool="theme"]');
    var privacyButton = deck.querySelector('[data-v2-tool="privacy"]');
    if (themeButton) {
      themeButton.innerHTML = icon(dark ? "sun" : "moon");
      themeButton.setAttribute("aria-label", dark ? "Use light theme" : "Use dark theme");
    }
    if (privacyButton) {
      privacyButton.innerHTML = icon(hidden ? "eye" : "eyeoff");
      privacyButton.setAttribute("aria-label", hidden ? "Show financial amounts" : "Hide financial amounts");
      privacyButton.setAttribute("aria-pressed", hidden ? "true" : "false");
    }
  }

  function mountDeck() {
    var controls = getDeck();
    var target = document.querySelector(".x97-top-actions") || document.querySelector(".v3-appbar-inner");
    if (target) {
      controls.classList.remove("v2-floating");
      if (controls.parentElement !== target) {
        if (target.classList.contains("v3-appbar-inner") && target.lastElementChild) target.insertBefore(controls, target.lastElementChild);
        else target.insertBefore(controls, target.firstChild);
      }
    } else if (document.body && !controls.isConnected) {
      controls.classList.add("v2-floating");
      document.body.appendChild(controls);
    }
  }

  function haptic(duration) {
    try {
      if (navigator.vibrate && document.visibilityState === "visible") navigator.vibrate(duration || 6);
    } catch (_) {}
  }

  function stripCopilot() {
    try { localStorage.removeItem(AI_KEY); } catch (_) {}

    document.querySelectorAll(".navitem").forEach(function (item) {
      var text = (item.textContent || "").replace(/\s+/g, " ").trim();
      if (/copilot|assistant/i.test(text) || /^archive$/i.test(text)) item.remove();
    });

    document.querySelectorAll(".composer").forEach(function (item) {
      if (/copilot|api key|assistant|ask archive/i.test(item.textContent || "")) item.remove();
    });

    document.querySelectorAll(".card,.x97-card").forEach(function (card) {
      var text = (card.textContent || "").replace(/\s+/g, " ").trim();
      if (/AI Assistant|97 Copilot|Anthropic API key|Archived module|97 Archive|disabled provider API key|console\.anthropic\.com/i.test(text)) card.remove();
    });

    document.querySelectorAll("button,span,div").forEach(function (node) {
      if (node.children.length) return;
      var text = (node.textContent || "").trim();
      if (text === "Smart suggestions") node.textContent = "Financial signals";
      if (text === "Ask Copilot") node.textContent = "View Incoming";
    });

    var nav = document.querySelector(".navin");
    if (nav) {
      var count = nav.querySelectorAll(".navitem").length;
      if (count) nav.style.gridTemplateColumns = "repeat(" + count + ",minmax(0,1fr))";
    }
  }

  function countNumber(element) {
    if (!element || element.dataset.v2Counted === "1") return;
    element.dataset.v2Counted = "1";
    element.classList.add("v2-number-enter");
    if (reduceMotion || privacyOn()) return;

    var finalText = element.textContent || "";
    var match = finalText.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
    if (!match) return;
    var finalValue = Number(match[0].replace(/,/g, ""));
    if (!isFinite(finalValue) || finalValue === 0) return;

    var prefix = finalText.slice(0, match.index);
    var suffix = finalText.slice((match.index || 0) + match[0].length);
    var decimalMatch = match[0].match(/\.(\d+)$/);
    var decimals = decimalMatch ? decimalMatch[1].length : 0;
    var duration = 760;
    var start = performance.now();
    element.setAttribute("aria-label", finalText);

    function step(now) {
      if (!element.isConnected || privacyOn()) {
        element.textContent = finalText;
        return;
      }
      var progress = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - progress, 4);
      var value = finalValue * eased;
      element.textContent = prefix + value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }) + suffix;
      if (progress < 1) requestAnimationFrame(step);
      else element.textContent = finalText;
    }

    requestAnimationFrame(step);
  }

  function animateNumbers() {
    document.querySelectorAll(".x97-hero-value,.x97-summary .v,.x97-collection-total").forEach(countNumber);
  }

  function sliderKey(rail) {
    return rail.dataset.v2Slider || "items";
  }

  function closestSlide(rail) {
    var children = Array.prototype.slice.call(rail.children);
    if (!children.length) return 0;
    var left = rail.scrollLeft;
    var best = 0;
    var distance = Infinity;
    children.forEach(function (child, index) {
      var next = Math.abs(child.offsetLeft - rail.offsetLeft - left);
      if (next < distance) { distance = next; best = index; }
    });
    return best;
  }

  function paintDots(rail, dots) {
    var active = closestSlide(rail);
    dots.querySelectorAll(".v2-slider-dot").forEach(function (dot, index) {
      dot.setAttribute("aria-current", index === active ? "true" : "false");
    });
  }

  function enhanceSlider(rail) {
    var children = Array.prototype.slice.call(rail.children);
    if (!children.length) return;
    var key = sliderKey(rail);
    var next = rail.nextElementSibling;
    var dots = next && next.classList.contains("v2-slider-dots") ? next : null;

    if (!dots) {
      dots = document.createElement("div");
      dots.className = "v2-slider-dots";
      dots.dataset.v2For = key;
      dots.setAttribute("role", "navigation");
      dots.setAttribute("aria-label", key + " slider pages");
      rail.insertAdjacentElement("afterend", dots);
      if (rail.parentElement) rail.parentElement.classList.add("v2-slider-shell");
    }

    if (Number(dots.dataset.v2Count || 0) !== children.length) {
      dots.replaceChildren();
      children.forEach(function (child, index) {
        child.setAttribute("data-v2-slide", String(index + 1));
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "v2-slider-dot";
        dot.setAttribute("aria-label", "Show " + key + " item " + (index + 1));
        dot.addEventListener("click", function () {
          var left = child.offsetLeft - rail.offsetLeft;
          rail.scrollTo({ left: left, behavior: reduceMotion ? "auto" : "smooth" });
          haptic(5);
        });
        dots.appendChild(dot);
      });
      dots.dataset.v2Count = String(children.length);
    }

    if (rail.dataset.v2Wired !== "1") {
      rail.dataset.v2Wired = "1";
      var scheduled = 0;
      rail.addEventListener("scroll", function () {
        if (scheduled) return;
        scheduled = requestAnimationFrame(function () {
          scheduled = 0;
          paintDots(rail, dots);
        });
      }, { passive: true });
    }
    paintDots(rail, dots);
  }

  function enhanceSliders() {
    document.querySelectorAll("[data-v2-slider]").forEach(enhanceSlider);
  }

  function ensureStyleLast() {
    var link = document.querySelector('link[data-v2-premium="true"]');
    if (link && link !== document.head.lastElementChild) document.head.appendChild(link);
  }

  function enhance() {
    frame = 0;
    stripCopilot();
    markClassicUI();
    mountDeck();
    setPrivacy(privacyOn());
    animateNumbers();
    enhanceSliders();
    ensureStyleLast();
    document.documentElement.classList.add("v2-ready");
  }

  var nativeFetch = window.fetch && window.fetch.bind(window);
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (/^https:\/\/api\.anthropic\.com\//i.test(url)) {
        return Promise.reject(new Error("Copilot has been removed from 97 Live Finance V2."));
      }
      return nativeFetch(input, init);
    };
  }

  setTheme(currentTheme(), false);

  function boot() {
    enhance();
    document.addEventListener("click", function (event) {
      if (event.target.closest("button,.press,.navitem,.x97-card-action")) haptic(5);
    }, true);
    new MutationObserver(function () {
      if (!frame) frame = requestAnimationFrame(enhance);
    }).observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", function () {
      if (!frame) frame = requestAnimationFrame(enhanceSliders);
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
