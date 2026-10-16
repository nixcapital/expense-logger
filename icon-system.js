/* Expense Logger — file-based category & UI icons (icons/*.svg).
   Placeholder artwork until Canva exports replace files (same filenames). */
(function (global) {
  'use strict';

  var ICON_BASE = 'icons/';
  var LETTER_ID = 'letter';
  var ICON_ANIM_MS = 480;
  var svgCache = {};
  var iconsReady = false;
  var revealSeen = {};
  var revealObserver = null;

  var DEFAULT_ICON_BY_CAT = {
    groceries: 'shopping-cart',
    dining: 'utensils',
    gas: 'fuel',
    bills: 'receipt',
    fun: 'ticket',
    other: 'circle-dot'
  };

  var PICKER_ICON_IDS = [
    'shopping-cart', 'utensils', 'fuel', 'receipt', 'ticket', 'circle-dot',
    'car', 'bag', 'coffee', 'home', 'heart', 'plane', 'gift', 'phone',
    'wrench', 'gamepad', 'book'
  ];

  var KNOWN = {};
  PICKER_ICON_IDS.forEach(function (id) { KNOWN[id] = true; });
  Object.keys(DEFAULT_ICON_BY_CAT).forEach(function (k) {
    KNOWN[DEFAULT_ICON_BY_CAT[k]] = true;
  });
  [
    'ui-note', 'ui-calendar', 'ui-camera', 'ui-repeat', 'ui-search', 'ui-sparkles',
    'ui-insight', 'ui-trend-up', 'ui-trend-down', 'ui-trend-flat', 'ui-alert'
  ].forEach(function (id) { KNOWN[id] = true; });

  function isKnownIcon(id) {
    return id && KNOWN[id];
  }

  function resolveIconId(cat) {
    if (!cat) return 'circle-dot';
    if (cat.icon === LETTER_ID) return LETTER_ID;
    if (cat.icon && isKnownIcon(cat.icon)) return cat.icon;
    if (DEFAULT_ICON_BY_CAT[cat.id]) return DEFAULT_ICON_BY_CAT[cat.id];
    return LETTER_ID;
  }

  function letterFor(cat) {
    var n = (cat && cat.name) ? String(cat.name).trim() : '';
    if (!n) return '?';
    return n.charAt(0).toUpperCase();
  }

  function iconAssetUrl(iconId) {
    return ICON_BASE + iconId + '.svg';
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseSvgInner(svgText) {
    var m = svgText.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
    return m ? m[1].trim() : '';
  }

  function inlineArtMarkup(iconId) {
    var inner = svgCache[iconId];
    if (!inner) return '';
    return '<svg class="icon-art icon-art--' + escHtml(iconId) + '" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
      + inner + '</svg>';
  }

  function badgeSizeClass(size) {
    return size ? ' cat-badge--' + size : ' cat-badge--md';
  }

  function badgeStyle(color) {
    var c = color || '#adb5bd';
    return 'background:color-mix(in srgb,' + c + ' 18%, transparent);--badge-fg:' + c + ';';
  }

  function badgeHTML(cat, opts) {
    opts = opts || {};
    var id = resolveIconId(cat);
    var color = (cat && cat.color) || '#adb5bd';
    var cls = 'cat-badge' + badgeSizeClass(opts.size || 'md');
    var style = badgeStyle(color);
    var dataId = ' data-icon-id="' + escHtml(id) + '"';
    if (id === LETTER_ID) {
      return '<span class="' + cls + ' cat-badge--letter"' + dataId + ' style="' + style + '" aria-hidden="true">'
        + '<span class="cat-badge-letter">' + escHtml(letterFor(cat)) + '</span></span>';
    }
    var art = inlineArtMarkup(id);
    if (!art) {
      var url = escHtml(iconAssetUrl(id));
      return '<span class="' + cls + '"' + dataId + ' style="' + style + '" aria-hidden="true">'
        + '<span class="cat-badge-icon" style="-webkit-mask-image:url(\'' + url + '\');mask-image:url(\'' + url + '\')"></span></span>';
    }
    return '<span class="' + cls + '"' + dataId + ' style="' + style + '" aria-hidden="true">' + art + '</span>';
  }

  function uiIconHTML(iconId, opts) {
    opts = opts || {};
    if (!isKnownIcon(iconId)) iconId = 'circle-dot';
    var url = escHtml(iconAssetUrl(iconId));
    var cls = 'ui-icon' + (opts.size ? ' ui-icon--' + opts.size : ' ui-icon--md');
    return '<span class="' + cls + '" aria-hidden="true">'
      + '<span class="ui-icon-glyph" style="-webkit-mask-image:url(\'' + url + '\');mask-image:url(\'' + url + '\')"></span></span>';
  }

  function hydrateUiIcons(root) {
    var scope = root || document;
    if (!scope.querySelectorAll) return;
    Array.prototype.forEach.call(scope.querySelectorAll('[data-ui-icon]'), function (el) {
      var id = el.getAttribute('data-ui-icon');
      var size = el.getAttribute('data-ui-icon-size') || 'row';
      el.innerHTML = uiIconHTML(id, { size: size });
    });
  }

  function categoryLabelHTML(cat, withName) {
    var name = cat ? cat.name : '';
    if (!withName) return badgeHTML(cat, { size: 'sm' });
    return badgeHTML(cat, { size: 'sm' }) + '<span class="cat-label-name">' + escHtml(name) + '</span>';
  }

  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function playIconAnimation(node) {
    var badge = node && node.classList && node.classList.contains('cat-badge')
      ? node
      : (node && node.closest ? node.closest('.cat-badge') : null);
    if (!badge) return;
    if (prefersReducedMotion()) {
      badge.classList.remove('icon-anim-reduced');
      void badge.offsetWidth;
      badge.classList.add('icon-anim-reduced');
      setTimeout(function () { badge.classList.remove('icon-anim-reduced'); }, 220);
      return;
    }
    badge.classList.remove('icon-anim-play');
    void badge.offsetWidth;
    badge.classList.add('icon-anim-play');
    if (badge._iconAnimT) clearTimeout(badge._iconAnimT);
    badge._iconAnimT = setTimeout(function () {
      badge.classList.remove('icon-anim-play');
      badge._iconAnimT = null;
    }, ICON_ANIM_MS);
  }

  function ensureRevealObserver() {
    if (revealObserver || !global.IntersectionObserver) return;
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (ent) {
        if (!ent.isIntersecting || ent.intersectionRatio < 0.45) return;
        var badge = ent.target;
        var id = badge.getAttribute('data-icon-id');
        if (!id || revealSeen[id]) {
          revealObserver.unobserve(badge);
          return;
        }
        revealSeen[id] = true;
        playIconAnimation(badge);
        revealObserver.unobserve(badge);
      });
    }, { threshold: [0.45, 0.6], rootMargin: '0px' });
  }

  function scanBadgesForReveal(root) {
    ensureRevealObserver();
    if (!revealObserver) return;
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll('.cat-badge[data-icon-id]'), function (badge) {
      var id = badge.getAttribute('data-icon-id');
      if (!id || revealSeen[id]) return;
      if (badge.getAttribute('data-reveal-armed') === '1') return;
      badge.setAttribute('data-reveal-armed', '1');
      revealObserver.observe(badge);
    });
  }

  function iconsToPreload() {
    var ids = {};
    PICKER_ICON_IDS.forEach(function (id) { ids[id] = true; });
    Object.keys(DEFAULT_ICON_BY_CAT).forEach(function (k) { ids[DEFAULT_ICON_BY_CAT[k]] = true; });
    return Object.keys(ids);
  }

  function preloadIcons(done) {
    var list = iconsToPreload();
    var pending = list.length;
    if (pending === 0) {
      iconsReady = true;
      if (done) done();
      return;
    }
    list.forEach(function (id) {
      fetch(iconAssetUrl(id), { cache: 'force-cache' }).then(function (res) {
        if (!res.ok) throw new Error('icon ' + id);
        return res.text();
      }).then(function (text) {
        svgCache[id] = parseSvgInner(text);
      }).catch(function () {
        svgCache[id] = '';
      }).then(function () {
        pending -= 1;
        if (pending === 0) {
          iconsReady = true;
          if (done) done();
        }
      });
    });
  }

  global.ExpenseIcons = {
    LETTER_ID: LETTER_ID,
    ICON_BASE: ICON_BASE,
    DEFAULT_ICON_BY_CAT: DEFAULT_ICON_BY_CAT,
    PICKER_ICON_IDS: PICKER_ICON_IDS,
    isKnownIcon: isKnownIcon,
    resolveIconId: resolveIconId,
    letterFor: letterFor,
    iconAssetUrl: iconAssetUrl,
    badgeHTML: badgeHTML,
    uiIconHTML: uiIconHTML,
    hydrateUiIcons: hydrateUiIcons,
    categoryLabelHTML: categoryLabelHTML,
    escHtml: escHtml,
    preloadIcons: preloadIcons,
    playIconAnimation: playIconAnimation,
    scanBadgesForReveal: scanBadgesForReveal,
    prefersReducedMotion: prefersReducedMotion,
    iconsReady: function () { return iconsReady; }
  };
})(typeof window !== 'undefined' ? window : global);
