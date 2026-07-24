/* ============================================================
   Intent Scoring Engine
   Tracks visitor behavior across pages, accumulates a 0-100
   intent score, and renders a live widget. State persists in
   localStorage so it survives navigation and repeat visits.
   ============================================================ */
(function () {
  "use strict";

  var STORE_KEY = "intent_v1";

  // --- Scoring model -------------------------------------------------
  // Weight of visiting each page (high-intent pages score more).
  var PAGE_WEIGHTS = { home: 5, solutions: 12, pricing: 28, resources: 15, contact: 18 };
  var SCROLL_BONUS = 6;      // per page scrolled past 75%
  var TIME_PER_UNIT = 20;    // seconds per +1 time point
  var TIME_CAP = 12;         // max points from time on site
  var REPEAT_BONUS = 15;     // returning visitor (new session)
  var CTA_POINTS = 8;        // per high-intent CTA click
  var CTA_CAP = 24;

  var page = (document.body.getAttribute("data-page") || "home").toLowerCase();

  // --- State ---------------------------------------------------------
  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && typeof s === "object") return s;
    } catch (e) {}
    return null;
  }
  function saveState(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }

  var now = Date.now();
  var state = loadState();
  var newSession = false;

  if (!state) {
    state = { firstSeen: now, lastSeen: now, sessions: 1, pages: {}, deepScroll: {}, seconds: 0, cta: 0, utm: {} };
    newSession = true;
  } else {
    // A gap > 30 min counts as a new (returning) session.
    if (now - (state.lastSeen || now) > 30 * 60 * 1000) { state.sessions = (state.sessions || 1) + 1; newSession = true; }
    state.lastSeen = now;
  }

  // First-touch UTM attribution — capture once, never overwrite.
  (function captureUtm() {
    var p = new URLSearchParams(window.location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term"].forEach(function (k) {
      var v = p.get(k);
      if (v && !state.utm[k]) state.utm[k] = v;
    });
  })();

  // Mark this page visited.
  state.pages[page] = true;
  saveState(state);

  // --- Score calculation --------------------------------------------
  function computeScore(s) {
    var breakdown = { pages: 0, scroll: 0, time: 0, repeat: 0, cta: 0 };
    Object.keys(s.pages || {}).forEach(function (p) { breakdown.pages += PAGE_WEIGHTS[p] || 5; });
    Object.keys(s.deepScroll || {}).forEach(function (p) { if (s.deepScroll[p]) breakdown.scroll += SCROLL_BONUS; });
    breakdown.time = Math.min(Math.floor((s.seconds || 0) / TIME_PER_UNIT), TIME_CAP);
    breakdown.repeat = (s.sessions || 1) > 1 ? REPEAT_BONUS : 0;
    breakdown.cta = Math.min((s.cta || 0) * CTA_POINTS, CTA_CAP);
    var total = breakdown.pages + breakdown.scroll + breakdown.time + breakdown.repeat + breakdown.cta;
    return { total: Math.min(total, 100), breakdown: breakdown };
  }

  function band(score) {
    if (score >= 65) return { key: "hot", label: "🔥 Hot", color: "var(--hot)" };
    if (score >= 35) return { key: "warm", label: "🌤 Warm", color: "var(--warm)" };
    return { key: "cold", label: "❄ Cold", color: "var(--cold)" };
  }

  // --- Widget rendering ---------------------------------------------
  var widget = document.createElement("div");
  widget.id = "intent-widget";
  document.body.appendChild(widget);

  var collapsed = localStorage.getItem("intent_widget_collapsed") === "1";
  if (collapsed) widget.classList.add("collapsed");

  function pageList(s) {
    var order = ["home", "solutions", "pricing", "resources", "contact"];
    return order.filter(function (p) { return s.pages[p]; }).map(function (p) { return p[0].toUpperCase() + p.slice(1); }).join(", ") || "—";
  }

  function render() {
    var r = computeScore(state);
    var b = band(r.total);
    widget.innerHTML =
      '<div class="iw-head" id="iw-head">' +
        '<span class="title">📊 Visitor Intent <span class="badge ' + b.key + '">' + b.label + '</span></span>' +
        '<span class="iw-toggle">' + (widget.classList.contains("collapsed") ? "▸" : "▾") + '</span>' +
      '</div>' +
      '<div class="iw-body">' +
        '<div class="score-row"><span class="score-num" style="color:' + b.color + '">' + r.total + '</span><span class="score-max">/ 100</span></div>' +
        '<div class="bar"><i style="width:' + r.total + '%;background:' + b.color + '"></i></div>' +
        '<ul class="signals">' +
          '<li><span>Pages viewed</span><b>' + r.breakdown.pages + '</b></li>' +
          '<li><span>Deep scrolls</span><b>' + r.breakdown.scroll + '</b></li>' +
          '<li><span>Time on site</span><b>' + r.breakdown.time + '</b></li>' +
          '<li><span>CTA clicks</span><b>' + r.breakdown.cta + '</b></li>' +
          '<li><span>Repeat visit</span><b>' + r.breakdown.repeat + '</b></li>' +
        '</ul>' +
        '<div class="iw-note">Path: ' + pageList(state) + '<br>Source: ' + (state.utm.utm_source || "direct") + '</div>' +
      '</div>';
    document.getElementById("iw-head").addEventListener("click", function () {
      widget.classList.toggle("collapsed");
      localStorage.setItem("intent_widget_collapsed", widget.classList.contains("collapsed") ? "1" : "0");
      render();
    });
  }
  render();

  // --- Live tracking -------------------------------------------------
  // Time on site: tick while the tab is visible.
  setInterval(function () {
    if (document.visibilityState === "visible") {
      state.seconds = (state.seconds || 0) + 2;
      saveState(state);
      render();
    }
  }, 2000);

  // Deep scroll: flag once the visitor passes 75% of the page.
  window.addEventListener("scroll", function () {
    var h = document.documentElement;
    var pct = (h.scrollTop + window.innerHeight) / h.scrollHeight;
    if (pct >= 0.75 && !state.deepScroll[page]) {
      state.deepScroll[page] = true;
      saveState(state);
      render();
    }
  }, { passive: true });

  // CTA clicks: any element with [data-cta].
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-cta]");
    if (el) { state.cta = (state.cta || 0) + 1; saveState(state); render(); }
  });

  // --- Public API (used by the Contact page to enrich the form) ------
  window.IntentEngine = {
    get: function () {
      var r = computeScore(state);
      return {
        score: r.total,
        band: band(r.total).key,
        pages: pageList(state),
        sessions: state.sessions || 1,
        utm: state.utm
      };
    }
  };
})();
