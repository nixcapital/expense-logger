/* ============================================================
   Expense Logger — app logic
   No libraries, no modules, ES5-friendly where it matters.
   ============================================================ */
(function () {
  'use strict';

  // ---------- Storage keys (DO NOT RENAME) ----------
  var STORAGE_KEY   = 'expenseLogger.entries.v1';
  var CATS_KEY      = 'expenseLogger.categories.v1';
  var BUDGETS_KEY   = 'expenseLogger.budgets.v1';
  var RECURRING_KEY = 'expenseLogger.recurring.v1';
  var UI_KEY        = 'expenseLogger.ui.v1';
  var PIN_KEY       = 'expenseLogger.pin.v1';

  var APP_VERSION = '1.0.0';

  // ---------- IndexedDB for receipts ----------
  var DB_NAME = 'expenseLogger';
  var DB_VERSION = 1;
  var STORE = 'receipts';
  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('no-idb')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function idbPut(record) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbGet(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).get(id);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function idbDelete(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbAll() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var r = tx.objectStore(STORE).getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function idbClear() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  // ---------- Defaults ----------
  var DEFAULT_CATEGORIES = [
    { id: 'groceries', name: 'Groceries', emoji: '🛒', color: '#4dabf7' },
    { id: 'dining',    name: 'Dining',    emoji: '🍽️', color: '#ff922b' },
    { id: 'gas',       name: 'Gas',       emoji: '⛽', color: '#51cf66' },
    { id: 'bills',     name: 'Bills',     emoji: '📄', color: '#cc5de8' },
    { id: 'fun',       name: 'Fun',       emoji: '🎉', color: '#f783ac' },
    { id: 'other',     name: 'Other',     emoji: '📦', color: '#adb5bd' }
  ];

  // ---------- State ----------
  var entries = [];
  var categories = [];
  var budgets = {};
  var recurringItems = [];
  var selectedCat = null;
  var currentTab = 'add';
  var pendingDelete = null;
  var undoTimer = null;
  var editingCategoryId = null;
  var selectedEmoji = '📦';
  var selectedColor = '#adb5bd';
  var pendingReceiptBlob = null; // { id, blob } not yet attached

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };

  var $app = $('app');
  var $lockScreen = $('lockScreen');
  var $pinDots = $('pinDots');
  var $pinPad = $('pinPad');

  var $amount = $('amount');
  var $note = $('note');
  var $recurring = $('recurring');
  var $cats = $('cats');
  var $saveBtn = $('saveBtn');
  var $receiptBtn = $('receiptBtn');
  var $receiptInput = $('receiptInput');
  var $receiptPreview = $('receiptPreview');
  var $receiptClearBtn = $('receiptClearBtn');

  var $totalVal = $('totalVal');
  var $monthLbl = $('summaryMonthLabel');
  var $entriesCt = $('entriesCount');
  var $entriesEl = $('entries');
  var $recentEl = $('recentEntries');
  var $legendEl = $('legend');
  var $chart = $('chart');
  var $exportBtn = $('exportBtn');
  var $toast = $('toast');
  var $undoToast = $('undoToast');
  var $undoText = $('undoText');
  var $undoBtn = $('undoBtn');

  var $budgetList = $('budgetList');
  var $budgetEditList = $('budgetEditList');
  var $budgetSettings = $('budgetSettings');
  var $categoryList = $('categoryList');
  var $recurringList = $('recurringList');
  var $monthlySummary = $('monthlySummary');
  var $yearlySummary = $('yearlySummary');
  var $yearSelect = $('yearSelect');
  var $summaryMonth = $('summaryMonth');
  var $yearLabel = $('yearLabel');

  var $reportMonth = $('reportMonth');
  var $reportBody = $('reportBody');
  var $reportExportPdfBtn = $('reportExportPdfBtn');

  var $searchInput = $('searchInput');
  var $filterCategory = $('filterCategory');
  var $filterMonth = $('filterMonth');
  var $filterType = $('filterType');
  var $filterSort = $('filterSort');

  var $tabBar = $('tabBar');
  var $budgetModal = $('budgetModal');
  var $catModal = $('catModal');
  var $catModalTitle = $('catModalTitle');
  var $catNameInput = $('catNameInput');
  var $emojiPicker = $('emojiPicker');
  var $colorSwatches = $('colorSwatches');

  var $receiptModal = $('receiptModal');
  var $receiptModalImg = $('receiptModalImg');
  var $receiptModalClose = $('receiptModalClose');
  var $receiptModalDelete = $('receiptModalDelete');

  var $pinModal = $('pinModal');
  var $pinModalTitle = $('pinModalTitle');
  var $pinInput1 = $('pinInput1');
  var $pinInput2 = $('pinInput2');
  var $pinCancelBtn = $('pinCancelBtn');
  var $pinSaveBtn = $('pinSaveBtn');
  var $togglePinBtn = $('togglePinBtn');
  var $forgotPinBtn = $('forgotPinBtn');

  var $versionLine = $('versionLine');

  // ---------- Utilities ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function fmtMoney(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
  function monthName(d) { return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
  function monthShort(d) { return d.toLocaleDateString(undefined, { month: 'short' }); }
  function isSameMonth(ts, y, m) {
    var d = new Date(ts);
    return d.getFullYear() === y && d.getMonth() === m;
  }
  function dateLabel(ts) {
    var d = new Date(ts);
    var today = new Date();
    var isToday = d.getFullYear() === today.getFullYear()
      && d.getMonth() === today.getMonth()
      && d.getDate() === today.getDate();
    var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (isToday) return 'Today, ' + time;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
  }
  function csvField(s) {
    s = String(s == null ? '' : s);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function getCat(id) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i];
    }
    return { id: id, name: id, emoji: '📦', color: '#adb5bd' };
  }
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { $toast.classList.remove('show'); }, 2000);
  }
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    return 'rgb(' + parseInt(h.slice(0,2),16) + ', ' + parseInt(h.slice(2,4),16) + ', ' + parseInt(h.slice(4,6),16) + ')';
  }
  function hexLighten(hex, amt) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    r = Math.min(255, Math.round(r + (255 - r) * amt));
    g = Math.min(255, Math.round(g + (255 - g) * amt));
    b = Math.min(255, Math.round(b + (255 - b) * amt));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function blobToDataURL(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }
  function dataURLToBlob(dataURL) {
    var parts = dataURL.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bin = atob(parts[1]);
    var len = bin.length;
    var arr = new Uint8Array(len);
    for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // ---------- Load / save (localStorage) ----------
  function loadCategories() {
    try {
      var raw = localStorage.getItem(CATS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          var valid = parsed.filter(function (c) {
            return c && typeof c.id === 'string' && typeof c.name === 'string';
          });
          if (valid.length > 0) return valid;
        }
      }
    } catch (e) {}
    return DEFAULT_CATEGORIES.slice();
  }
  function saveCategories() {
    try { localStorage.setItem(CATS_KEY, JSON.stringify(categories)); } catch (e) { toast('Could not save categories'); }
  }
  function loadBudgets() {
    try {
      var raw = localStorage.getItem(BUDGETS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch (e) {}
    return {};
  }
  function saveBudgets() {
    try { localStorage.setItem(BUDGETS_KEY, JSON.stringify(budgets)); } catch (e) {}
  }
  function loadRecurring() {
    try {
      var raw = localStorage.getItem(RECURRING_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p)) return p;
      }
    } catch (e) {}
    return [];
  }
  function saveRecurring() {
    try { localStorage.setItem(RECURRING_KEY, JSON.stringify(recurringItems)); } catch (e) {}
  }
  function loadEntries() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var p = JSON.parse(raw);
      if (!Array.isArray(p)) return [];
      return p.filter(function (e) { return e && typeof e.amount === 'number' && e.categoryId; });
    } catch (e) { return []; }
  }
  function saveEntries() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); return true; }
    catch (e) { toast('Could not save — storage full or blocked'); return false; }
  }
  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: currentTab })); } catch (e) {}
  }
  function loadUI() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (raw) return JSON.parse(raw) || {};
    } catch (e) {}
    return {};
  }

  // ---------- Recurring ----------
  function processRecurring() {
    if (recurringItems.length === 0) return;
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    var today = now.getDate();
    var added = false;

    recurringItems.forEach(function (rec) {
      var already = entries.some(function (e) {
        return e.recurringId === rec.id && isSameMonth(e.ts, y, m);
      });
      if (already) return;
      if (today >= rec.dayOfMonth) {
        var day = Math.min(rec.dayOfMonth, daysInMonth(y, m));
        var d = new Date(y, m, day, 12, 0, 0, 0);
        entries.push({
          id: uid(),
          amount: rec.amount,
          categoryId: rec.categoryId,
          note: rec.note || '',
          ts: d.getTime(),
          recurringId: rec.id
        });
        added = true;
      }
    });
    if (added) saveEntries();
  }

  // ---------- Migration ----------
  function migrate() {
    var catIds = {};
    categories.forEach(function (c) { catIds[c.id] = true; });
    var changed = false;
    entries.forEach(function (e) {
      if (!catIds[e.categoryId]) {
        var fallback = null;
        for (var i = 0; i < categories.length; i++) {
          if (categories[i].id === 'other') { fallback = categories[i]; break; }
        }
        if (!fallback) fallback = categories[0];
        if (fallback) {
          e.categoryId = fallback.id;
          changed = true;
        }
      }
    });
    if (changed) { saveEntries(); saveCategories(); }
    processRecurring();
  }

  // ---------- Category buttons ----------
  function buildCategoryButtons() {
    $cats.innerHTML = '';
    categories.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn';
      btn.dataset.id = c.id;
      btn.innerHTML = '<span class="emoji"></span><span></span>';
      btn.firstChild.textContent = c.emoji;
      btn.lastChild.textContent = c.name;
      btn.addEventListener('click', function () {
        selectedCat = c.id;
        Array.prototype.forEach.call($cats.children, function (el) {
          el.classList.toggle('selected', el.dataset.id === c.id);
        });
        updateSaveState();
      });
      $cats.appendChild(btn);
    });
    if (selectedCat && categories.some(function (c) { return c.id === selectedCat; })) {
      Array.prototype.forEach.call($cats.children, function (el) {
        el.classList.toggle('selected', el.dataset.id === selectedCat);
      });
    } else {
      selectedCat = null;
    }
  }

  function updateSaveState() {
    var v = parseFloat($amount.value);
    var ok = !isNaN(v) && v > 0 && selectedCat !== null;
    $saveBtn.disabled = !ok;
  }

  // ---------- Entry row rendering ----------
  function createEntryRow(e) {
    var cat = getCat(e.categoryId);
    var row = document.createElement('div');
    row.className = 'entry';

    var info = document.createElement('div');
    info.className = 'entry-info';

    var top = document.createElement('div');
    top.className = 'top';

    var pill = document.createElement('span');
    pill.className = 'cat-pill';
    pill.textContent = cat.emoji + ' ' + cat.name;
    pill.style.color = cat.color;
    pill.style.borderColor = cat.color + '55';
    top.appendChild(pill);

    if (e.recurringId) {
      var badge = document.createElement('span');
      badge.className = 'recurring-badge';
      badge.textContent = 'Recurring';
      top.appendChild(badge);
    }
    info.appendChild(top);

    if (e.note) {
      var note = document.createElement('div');
      note.className = 'note';
      note.textContent = e.note;
      info.appendChild(note);
    }
    var date = document.createElement('div');
    date.className = 'date';
    date.textContent = dateLabel(e.ts);
    info.appendChild(date);

    var right = document.createElement('div');
    right.className = 'entry-right';

    if (e.hasReceipt) {
      var thumb = document.createElement('img');
      thumb.className = 'receipt-thumb';
      thumb.alt = 'Receipt';
      thumb.loading = 'lazy';
      thumb.addEventListener('click', function () { openReceipt(e.id); });
      idbGet('receipt:' + e.id).then(function (rec) {
        if (rec && rec.dataURL) thumb.src = rec.dataURL;
      }).catch(function () {});
      right.appendChild(thumb);
    }

    var amt = document.createElement('span');
    amt.className = 'entry-amt';
    amt.textContent = '$' + fmtMoney(e.amount);
    right.appendChild(amt);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'del-btn';
    del.setAttribute('aria-label', 'Delete');
    del.textContent = '✕';
    del.addEventListener('click', function (ev) {
      ev.stopPropagation();
      softDeleteEntry(e.id);
    });
    right.appendChild(del);

    row.appendChild(info);
    row.appendChild(right);
    return row;
  }

  function renderRecent() {
    var recent = entries.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 5);
    if (recent.length === 0) {
      $recentEl.innerHTML = '<div class="empty">No expenses yet.<br>Add your first one above ↑</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    recent.forEach(function (e) { frag.appendChild(createEntryRow(e)); });
    $recentEl.innerHTML = '';
    $recentEl.appendChild(frag);
  }

  function getFilteredEntries() {
    var q = ($searchInput.value || '').toLowerCase().trim();
    var catFilter = $filterCategory.value;
    var monthFilter = $filterMonth.value;
    var typeFilter = $filterType.value;
    var sort = $filterSort.value;

    var list = entries.slice();

    if (q) {
      list = list.filter(function (e) {
        var cat = getCat(e.categoryId);
        return (e.note && e.note.toLowerCase().indexOf(q) !== -1)
            || cat.name.toLowerCase().indexOf(q) !== -1;
      });
    }
    if (catFilter) list = list.filter(function (e) { return e.categoryId === catFilter; });
    if (monthFilter) {
      var parts = monthFilter.split('-');
      var y = parseInt(parts[0], 10);
      var m = parseInt(parts[1], 10) - 1;
      list = list.filter(function (e) { return isSameMonth(e.ts, y, m); });
    }
    if (typeFilter === 'recurring') list = list.filter(function (e) { return !!e.recurringId; });
    else if (typeFilter === 'one-time') list = list.filter(function (e) { return !e.recurringId; });
    else if (typeFilter === 'with-receipt') list = list.filter(function (e) { return !!e.hasReceipt; });

    if (sort === 'newest') list.sort(function (a, b) { return b.ts - a.ts; });
    else if (sort === 'oldest') list.sort(function (a, b) { return a.ts - b.ts; });
    else if (sort === 'highest') list.sort(function (a, b) { return b.amount - a.amount; });
    else if (sort === 'lowest') list.sort(function (a, b) { return a.amount - b.amount; });

    return list;
  }

  function renderEntries() {
    var list = getFilteredEntries();
    $entriesCt.textContent = list.length === 1 ? '1 item' : list.length + ' items';
    if (list.length === 0) {
      $entriesEl.innerHTML = '<div class="empty">No matching expenses.<br>Try changing filters.</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    list.forEach(function (e) { frag.appendChild(createEntryRow(e)); });
    $entriesEl.innerHTML = '';
    $entriesEl.appendChild(frag);
  }

  // ---------- Undo ----------
  function softDeleteEntry(id) {
    var idx = -1;
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) { idx = i; break; }
    if (idx === -1) return;
    var entry = entries[idx];
    entries.splice(idx, 1);
    saveEntries();
    renderAll();

    pendingDelete = entry;
    if (undoTimer) clearTimeout(undoTimer);
    $undoText.textContent = 'Deleted $' + fmtMoney(entry.amount) + ' — ' + getCat(entry.categoryId).name;
    $undoToast.classList.add('show');
    undoTimer = setTimeout(function () {
      $undoToast.classList.remove('show');
      pendingDelete = null;
    }, 5000);
  }
  function hideUndo() {
    $undoToast.classList.remove('show');
    if (undoTimer) clearTimeout(undoTimer);
    pendingDelete = null;
  }
  $undoBtn.addEventListener('click', function () {
    if (pendingDelete) {
      entries.push(pendingDelete);
      saveEntries();
      renderAll();
      toast('Restored');
    }
    hideUndo();
  });

  // ---------- Summary / chart ----------
  function getSummaryData(y, m) {
    var monthEntries = entries.filter(function (e) { return isSameMonth(e.ts, y, m); });
    var total = 0;
    var byCat = {};
    categories.forEach(function (c) { byCat[c.id] = 0; });
    monthEntries.forEach(function (e) {
      total += e.amount;
      if (byCat[e.categoryId] === undefined) byCat[e.categoryId] = 0;
      byCat[e.categoryId] += e.amount;
    });
    return { entries: monthEntries, total: total, byCat: byCat };
  }

  function renderTotals() {
    var val = $summaryMonth.value;
    var y, m;
    if (val) {
      var p = val.split('-');
      y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1;
    } else {
      var now = new Date();
      y = now.getFullYear(); m = now.getMonth();
      $summaryMonth.value = y + '-' + pad2(m + 1);
    }
    var data = getSummaryData(y, m);
    $totalVal.textContent = fmtMoney(data.total);
    $monthLbl.textContent = '· ' + monthName(new Date(y, m, 1));
    drawChart(data.byCat, data.total);
    renderLegend(data.byCat, data.total);
    renderBudgets(data.byCat);
  }

  function renderLegend(byCat, total) {
    if (total === 0) { $legendEl.innerHTML = ''; return; }
    var rows = categories
      .map(function (c) { return { c: c, amt: byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });
    var html = '';
    rows.forEach(function (r) {
      var pct = total > 0 ? Math.round((r.amt / total) * 100) : 0;
      html += '<div class="legend-row">'
        + '<span class="name"><span class="dot" style="background:' + r.c.color + '"></span>'
        + r.c.name + ' <span style="opacity:0.6">· ' + pct + '%</span></span>'
        + '<span class="amt">$' + fmtMoney(r.amt) + '</span></div>';
    });
    $legendEl.innerHTML = html;
  }

  function renderBudgets(byCat) {
    var active = categories.filter(function (c) { return budgets[c.id] && budgets[c.id] > 0; });
    if (active.length === 0) {
      $budgetList.innerHTML = '<div class="empty">No budgets set.<br>Tap Edit to add one.</div>';
      return;
    }
    var html = '';
    active.forEach(function (c) {
      var spent = byCat[c.id] || 0;
      var limit = budgets[c.id];
      var pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
      var over = spent > limit;
      var barColor = over ? '#ff6b6b' : c.color;
      html += '<div class="budget-row">'
        + '<div class="budget-header">'
        + '<span class="cat-name"><span class="dot" style="background:' + c.color + '"></span>' + c.name + '</span>'
        + '<span class="amounts' + (over ? ' over' : '') + '">$' + fmtMoney(spent) + ' / $' + fmtMoney(limit) + (over ? ' ⚠️' : '') + '</span>'
        + '</div>'
        + '<div class="budget-bar-bg"><div class="budget-bar-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%; background:' + barColor + ';"></div></div>'
        + '</div>';
    });
    $budgetList.innerHTML = html;
  }

  // ---------- Canvas chart ----------
  var chartCtx = $chart.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  function sizeCanvas() {
    var cssW = $chart.clientWidth || $chart.parentNode.clientWidth || 320;
    var cssH = 180;
    $chart.style.height = cssH + 'px';
    $chart.width = Math.round(cssW * dpr);
    $chart.height = Math.round(cssH * dpr);
    chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { W: cssW, H: cssH };
  }
  function roundRect(ctx, x, y, w, h, r) {
    if (w < r * 2) r = w / 2;
    if (h < r * 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawChart(byCat, total) {
    var dim = sizeCanvas();
    var W = dim.W, H = dim.H;
    chartCtx.clearRect(0, 0, W, H);
    if (total === 0) {
      chartCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim') || '#4a5268';
      chartCtx.font = '14px -apple-system, sans-serif';
      chartCtx.textAlign = 'center';
      chartCtx.textBaseline = 'middle';
      chartCtx.fillText('No spending this month', W / 2, H / 2);
      return;
    }
    var rows = categories
      .map(function (c) { return { c: c, amt: byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });
    var padTop = 8, padBottom = 8;
    var rowH = Math.max(22, Math.floor((H - padTop - padBottom) / rows.length));
    var labelW = 92, valueW = 68;
    var barX = labelW;
    var barMaxW = W - labelW - valueW;
    var max = rows[0].amt || 1;
    chartCtx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    chartCtx.textBaseline = 'middle';
    rows.forEach(function (r, i) {
      var y = padTop + i * rowH;
      var barH = Math.min(rowH - 8, 18);
      var barY = y + (rowH - barH) / 2;
      chartCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() || '#8b93a7';
      chartCtx.textAlign = 'left';
      chartCtx.fillText(r.c.name, 6, y + rowH / 2);
      chartCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card-2').trim() || '#222836';
      roundRect(chartCtx, barX, barY, barMaxW, barH, 5);
      chartCtx.fill();
      var w = Math.max(3, (r.amt / max) * barMaxW);
      var grad = chartCtx.createLinearGradient(barX, 0, barX + w, 0);
      grad.addColorStop(0, r.c.color);
      grad.addColorStop(1, hexLighten(r.c.color, 0.18));
      chartCtx.fillStyle = grad;
      roundRect(chartCtx, barX, barY, w, barH, 5);
      chartCtx.fill();
      chartCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e8ecf3';
      chartCtx.textAlign = 'right';
      chartCtx.font = '600 13px -apple-system, BlinkMacSystemFont, sans-serif';
      chartCtx.fillText('$' + fmtMoney(r.amt), W - 6, y + rowH / 2);
      chartCtx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
    });
  }

  // ---------- Monthly / yearly summary ----------
  function renderMonthlySummary() {
    var val = $summaryMonth.value;
    var y, m;
    if (val) { var p = val.split('-'); y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; }
    else { var now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
    var data = getSummaryData(y, m);
    var days = daysInMonth(y, m);
    var avgPerDay = days > 0 ? data.total / days : 0;
    var largest = data.entries.length > 0 ? data.entries.reduce(function (mx, e) { return e.amount > mx.amount ? e : mx; }, data.entries[0]) : null;
    var count = data.entries.length;
    var html = '';
    html += '<div class="summary-row"><span class="label">Transactions</span><span class="value">' + count + '</span></div>';
    html += '<div class="summary-row"><span class="label">Total spent</span><span class="value">$' + fmtMoney(data.total) + '</span></div>';
    html += '<div class="summary-row"><span class="label">Daily average</span><span class="value">$' + fmtMoney(avgPerDay) + '</span></div>';
    if (largest) {
      var lcat = getCat(largest.categoryId);
      html += '<div class="summary-row"><span class="label">Largest expense</span><span class="value">$' + fmtMoney(largest.amount) + ' (' + lcat.emoji + ')</span></div>';
    }
    $monthlySummary.innerHTML = html;
    $yearLabel.textContent = '· ' + y;
    renderYearlySummary(y);
  }

  function renderYearlySummary(year) {
    var months = [];
    for (var m = 0; m < 12; m++) {
      var total = entries
        .filter(function (e) { return isSameMonth(e.ts, year, m); })
        .reduce(function (s, e) { return s + e.amount; }, 0);
      months.push({ month: m, total: total });
    }
    var yearTotal = months.reduce(function (s, mo) { return s + mo.total; }, 0);
    var maxMonth = Math.max.apply(null, months.map(function (mo) { return mo.total; })) || 1;
    var active = months.filter(function (mo) { return mo.total > 0; });
    var avgMonth = active.length > 0 ? yearTotal / active.length : 0;
    var best = months.reduce(function (b, mo) { return mo.total > b.total ? mo : b; }, months[0]);

    var html = '';
    html += '<div class="summary-row total"><span class="label">Year total</span><span class="value">$' + fmtMoney(yearTotal) + '</span></div>';
    html += '<div class="summary-row"><span class="label">Monthly average</span><span class="value">$' + fmtMoney(avgMonth) + '</span></div>';
    if (best && best.total > 0) {
      html += '<div class="summary-row"><span class="label">Highest month</span><span class="value">' + monthShort(new Date(year, best.month, 1)) + ' ($' + fmtMoney(best.total) + ')</span></div>';
    }
    html += '<div style="margin-top:12px;">';
    months.forEach(function (mo) {
      if (mo.total === 0) return;
      var pct = (mo.total / maxMonth) * 100;
      html += '<div class="month-bar-row">'
        + '<span class="month-name">' + monthShort(new Date(year, mo.month, 1)) + '</span>'
        + '<div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%;"></div></div>'
        + '<span class="month-amt">$' + fmtMoney(mo.total) + '</span></div>';
    });
    html += '</div>';
    $yearlySummary.innerHTML = html;
  }

  function buildYearSelect(force) {
    var years = {};
    entries.forEach(function (e) { years[new Date(e.ts).getFullYear()] = true; });
    years[new Date().getFullYear()] = true;
    var sorted = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    var current = sorted.join(',');
    if (!force && $yearSelect.dataset.years === current) return;
    $yearSelect.dataset.years = current;
    var prev = $yearSelect.value;
    var html = '';
    sorted.forEach(function (y) { html += '<option value="' + y + '">' + y + '</option>'; });
    $yearSelect.innerHTML = html;
    if (prev && sorted.indexOf(parseInt(prev, 10)) !== -1) $yearSelect.value = prev;
  }

  // ---------- Report view ----------
  function renderReport() {
    var val = $reportMonth.value;
    var y, m;
    if (val) { var p = val.split('-'); y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; }
    else { var now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
    var data = getSummaryData(y, m);

    var html = '';
    html += '<div class="card">';
    html += '<div class="report-header">';
    html += '<h2>' + monthName(new Date(y, m, 1)) + '</h2>';
    html += '<div class="report-total">$' + fmtMoney(data.total) + '</div>';
    html += '<div class="hint">' + data.entries.length + ' transactions</div>';
    html += '</div>';

    // Category breakdown
    var rows = categories
      .map(function (c) { return { c: c, amt: data.byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });

    if (rows.length > 0) {
      html += '<div class="report-section">';
      html += '<h3>By category</h3>';
      html += '<table class="report-table"><thead><tr><th>Category</th><th>Share</th><th>Amount</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var pct = data.total > 0 ? Math.round((r.amt / data.total) * 100) : 0;
        html += '<tr><td>' + r.c.emoji + ' ' + r.c.name + '</td><td>' + pct + '%</td><td>$' + fmtMoney(r.amt) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // Budget status
    var budgetRows = categories.filter(function (c) { return budgets[c.id] && budgets[c.id] > 0; });
    if (budgetRows.length > 0) {
      html += '<div class="report-section">';
      html += '<h3>Budget status</h3>';
      html += '<table class="report-table"><thead><tr><th>Category</th><th>Limit</th><th>Spent</th></tr></thead><tbody>';
      budgetRows.forEach(function (c) {
        var spent = data.byCat[c.id] || 0;
        var over = spent > budgets[c.id];
        html += '<tr><td>' + c.emoji + ' ' + c.name + (over ? ' ⚠️' : '') + '</td><td>$' + fmtMoney(budgets[c.id]) + '</td><td style="color:' + (over ? 'var(--danger)' : 'inherit') + '">$' + fmtMoney(spent) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    // All transactions
    if (data.entries.length > 0) {
      var sortedEntries = data.entries.slice().sort(function (a, b) { return a.ts - b.ts; });
      html += '<div class="report-section">';
      html += '<h3>Transactions</h3>';
      html += '<table class="report-table"><thead><tr><th>Date</th><th>Category / Note</th><th>Amount</th></tr></thead><tbody>';
      sortedEntries.forEach(function (e) {
        var d = new Date(e.ts);
        var cat = getCat(e.categoryId);
        var day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        var label = cat.emoji + ' ' + cat.name + (e.note ? ' — ' + e.note : '');
        html += '<tr><td>' + day + '</td><td>' + label + '</td><td>$' + fmtMoney(e.amount) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += '<div class="empty">No transactions this month.</div>';
    }

    html += '</div>';
    $reportBody.innerHTML = html;
  }

  // ---------- Category management ----------
  var EMOJI_OPTIONS = ['🛒','🍽️','⛽','📄','🎉','📦','🏠','🚗','👕','💊','🎬','✈️','🐾','🎁','📱','💡','☕','🍺','🎮','📚','🏋️','💄','🧾','🔧'];
  var COLOR_OPTIONS = ['#4dabf7','#ff922b','#51cf66','#cc5de8','#f783ac','#adb5bd','#ff6b6b','#20c997','#fcc419','#845ef7','#339af0','#e599f7'];

  function renderCategoryList() {
    var html = '';
    categories.forEach(function (c) {
      html += '<div class="entry" style="padding:10px 0;">'
        + '<div class="entry-info"><div class="top">'
        + '<span style="font-size:18px;">' + c.emoji + '</span>'
        + '<span style="font-weight:600;">' + c.name + '</span>'
        + '<span class="cat-pill" style="color:' + c.color + '; border-color:' + c.color + '55;">'
        + (budgets[c.id] ? '$' + fmtMoney(budgets[c.id]) + '/mo' : 'No budget') + '</span>'
        + '</div></div>'
        + '<div class="entry-right">'
        + '<button class="del-btn" style="color:var(--accent);" data-edit="' + c.id + '" type="button">✎</button>'
        + (categories.length > 1 ? '<button class="del-btn" data-del="' + c.id + '" type="button">✕</button>' : '')
        + '</div></div>';
    });
    $categoryList.innerHTML = html;
    Array.prototype.forEach.call($categoryList.querySelectorAll('[data-edit]'), function (btn) {
      btn.addEventListener('click', function () { openCategoryModal(btn.dataset.edit); });
    });
    Array.prototype.forEach.call($categoryList.querySelectorAll('[data-del]'), function (btn) {
      btn.addEventListener('click', function () { deleteCategory(btn.dataset.del); });
    });
  }

  function deleteCategory(id) {
    if (categories.length <= 1) { toast('Need at least one category'); return; }
    var cat = getCat(id);
    if (!window.confirm('Delete "' + cat.name + '"?\nExpenses in this category will be moved.')) return;
    var fallback = null;
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === 'other' && categories[i].id !== id) { fallback = categories[i]; break; }
    }
    if (!fallback) for (var j = 0; j < categories.length; j++) {
      if (categories[j].id !== id) { fallback = categories[j]; break; }
    }
    if (!fallback) return;
    entries.forEach(function (e) { if (e.categoryId === id) e.categoryId = fallback.id; });
    saveEntries();
    categories = categories.filter(function (c) { return c.id !== id; });
    delete budgets[id];
    saveCategories(); saveBudgets();
    recurringItems = recurringItems.filter(function (r) { return r.categoryId !== id; });
    saveRecurring();
    renderAll(); rebuildFilterDropdowns();
    renderCategoryList(); renderBudgetSettings(); renderRecurringList();
    toast('Category deleted');
  }

  function openCategoryModal(id) {
    editingCategoryId = id || null;
    if (id) {
      var cat = getCat(id);
      $catModalTitle.textContent = 'Edit Category';
      $catNameInput.value = cat.name;
      selectedEmoji = cat.emoji;
      selectedColor = cat.color;
    } else {
      $catModalTitle.textContent = 'Add Category';
      $catNameInput.value = '';
      selectedEmoji = '📦';
      selectedColor = '#adb5bd';
    }
    $emojiPicker.innerHTML = '';
    EMOJI_OPTIONS.forEach(function (em) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'emoji-option' + (em === selectedEmoji ? ' selected' : '');
      btn.textContent = em;
      btn.addEventListener('click', function () {
        selectedEmoji = em;
        Array.prototype.forEach.call($emojiPicker.children, function (b) {
          b.classList.toggle('selected', b.textContent === em);
        });
      });
      $emojiPicker.appendChild(btn);
    });
    $colorSwatches.innerHTML = '';
    COLOR_OPTIONS.forEach(function (col) {
      var sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'color-swatch' + (col === selectedColor ? ' selected' : '');
      sw.style.background = col;
      sw.dataset.color = col;
      sw.addEventListener('click', function () {
        selectedColor = col;
        Array.prototype.forEach.call($colorSwatches.children, function (s) {
          s.classList.toggle('selected', s.dataset.color === col);
        });
      });
      $colorSwatches.appendChild(sw);
    });
    $catModal.classList.add('show');
  }

  $('catCancelBtn').addEventListener('click', function () { $catModal.classList.remove('show'); });
  $('catSaveBtn').addEventListener('click', function () {
    var name = $catNameInput.value.trim();
    if (!name) { toast('Enter a category name'); return; }
    if (editingCategoryId) {
      var cat = null;
      for (var i = 0; i < categories.length; i++) if (categories[i].id === editingCategoryId) { cat = categories[i]; break; }
      if (cat) { cat.name = name; cat.emoji = selectedEmoji; cat.color = selectedColor; }
    } else {
      var newId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
      if (categories.some(function (c) { return c.id === newId; })) newId = newId + '-' + uid().slice(0, 4);
      categories.push({ id: newId, name: name, emoji: selectedEmoji, color: selectedColor });
    }
    saveCategories();
    $catModal.classList.remove('show');
    buildCategoryButtons(); rebuildFilterDropdowns();
    renderCategoryList(); renderBudgetSettings(); renderAll();
    toast(editingCategoryId ? 'Category updated' : 'Category added');
  });

  // ---------- Budgets ----------
  function budgetInputHTML(catId, value, attr) {
    return '<div class="field" style="margin-bottom:12px;">'
      + '<label style="display:flex; align-items:center; gap:6px; text-transform:none; letter-spacing:0; font-size:14px; color:var(--text);">'
      + '<span>' + getCat(catId).emoji + '</span> ' + getCat(catId).name + '</label>'
      + '<div class="amount-wrap"><span class="dollar">$</span>'
      + '<input type="number" inputmode="decimal" step="0.01" min="0" placeholder="No budget" '
      + attr + '="' + catId + '" value="' + (value || '') + '"></div></div>';
  }

  function renderBudgetSettings() {
    var html = '';
    categories.forEach(function (c) {
      html += budgetInputHTML(c.id, budgets[c.id], 'data-budget-cat');
    });
    $budgetSettings.innerHTML = html;
    Array.prototype.forEach.call($budgetSettings.querySelectorAll('[data-budget-cat]'), function (input) {
      input.addEventListener('change', function () {
        var catId = input.dataset.budgetCat;
        var v = parseFloat(input.value);
        if (isNaN(v) || v <= 0) delete budgets[catId];
        else budgets[catId] = Math.round(v * 100) / 100;
        saveBudgets();
        renderBudgets(getSummaryData(new Date().getFullYear(), new Date().getMonth()).byCat);
        renderCategoryList();
      });
    });
  }

  $('editBudgetsBtn').addEventListener('click', function () {
    var html = '';
    categories.forEach(function (c) { html += budgetInputHTML(c.id, budgets[c.id], 'data-modal-budget'); });
    $budgetEditList.innerHTML = html;
    $budgetModal.classList.add('show');
  });
  $('budgetCancelBtn').addEventListener('click', function () { $budgetModal.classList.remove('show'); });
  $('budgetSaveBtn').addEventListener('click', function () {
    Array.prototype.forEach.call($budgetEditList.querySelectorAll('[data-modal-budget]'), function (input) {
      var catId = input.dataset.modalBudget;
      var v = parseFloat(input.value);
      if (isNaN(v) || v <= 0) delete budgets[catId];
      else budgets[catId] = Math.round(v * 100) / 100;
    });
    saveBudgets();
    $budgetModal.classList.remove('show');
    renderAll(); renderBudgetSettings(); renderCategoryList();
    toast('Budgets saved');
  });

  // ---------- Recurring list ----------
  function renderRecurringList() {
    if (recurringItems.length === 0) {
      $recurringList.innerHTML = '<div class="empty">No recurring expenses set.</div>';
      return;
    }
    var html = '';
    recurringItems.forEach(function (r) {
      var cat = getCat(r.categoryId);
      html += '<div class="entry" style="padding:10px 0;">'
        + '<div class="entry-info"><div class="top">'
        + '<span class="cat-pill" style="color:' + cat.color + '; border-color:' + cat.color + '55;">' + cat.emoji + ' ' + cat.name + '</span>'
        + '<span class="recurring-badge">Day ' + r.dayOfMonth + '</span></div>'
        + (r.note ? '<div class="note">' + r.note + '</div>' : '')
        + '</div><div class="entry-right">'
        + '<span class="entry-amt">$' + fmtMoney(r.amount) + '</span>'
        + '<button class="del-btn" data-del-rec="' + r.id + '" type="button">✕</button>'
        + '</div></div>';
    });
    $recurringList.innerHTML = html;
    Array.prototype.forEach.call($recurringList.querySelectorAll('[data-del-rec]'), function (btn) {
      btn.addEventListener('click', function () {
        recurringItems = recurringItems.filter(function (r) { return r.id !== btn.dataset.delRec; });
        saveRecurring(); renderRecurringList();
        toast('Recurring expense removed');
      });
    });
  }

  // ---------- Add entry ----------
  function addEntry() {
    var v = parseFloat($amount.value);
    if (isNaN(v) || v <= 0) { toast('Enter a valid amount'); return; }
    if (!selectedCat) { toast('Pick a category'); return; }

    var entry = {
      id: uid(),
      amount: Math.round(v * 100) / 100,
      categoryId: selectedCat,
      note: $note.value.trim(),
      ts: Date.now()
    };

    if ($recurring.checked) {
      var rec = {
        id: uid(),
        amount: entry.amount,
        categoryId: entry.categoryId,
        note: entry.note,
        dayOfMonth: new Date().getDate()
      };
      recurringItems.push(rec);
      saveRecurring();
      entry.recurringId = rec.id;
      renderRecurringList();
    }

    var finish = function () {
      entries.push(entry);
      if (!saveEntries()) return;
      $amount.value = '';
      $note.value = '';
      $recurring.checked = false;
      selectedCat = null;
      Array.prototype.forEach.call($cats.children, function (el) { el.classList.remove('selected'); });
      updateSaveState();
      renderAll();
      toast('Saved $' + fmtMoney(entry.amount));
      $amount.blur(); $note.blur();
    };

    if (pendingReceiptBlob && pendingReceiptBlob.blob) {
      var blob = pendingReceiptBlob.blob;
      blobToDataURL(blob).then(function (dataURL) {
        entry.hasReceipt = true;
        return idbPut({ id: 'receipt:' + entry.id, dataURL: dataURL, ts: Date.now() });
      }).then(function () {
        clearReceiptPreview();
        finish();
      }).catch(function () {
        entry.hasReceipt = false;
        finish();
        toast('Receipt could not be saved');
      });
    } else {
      finish();
    }
  }

  // ---------- Receipt capture ----------
  $receiptBtn.addEventListener('click', function () { $receiptInput.click(); });
  $receiptInput.addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    // Downscale via canvas to keep IndexedDB small
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var maxDim = 1280;
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(function (blob) {
          pendingReceiptBlob = { blob: blob };
          $receiptPreview.src = URL.createObjectURL(blob);
          $receiptPreview.hidden = false;
          $receiptClearBtn.hidden = false;
        }, 'image/jpeg', 0.75);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
    ev.target.value = '';
  });
  $receiptClearBtn.addEventListener('click', clearReceiptPreview);
  function clearReceiptPreview() {
    if ($receiptPreview.src && $receiptPreview.src.indexOf('blob:') === 0) URL.revokeObjectURL($receiptPreview.src);
    $receiptPreview.hidden = true;
    $receiptPreview.removeAttribute('src');
    $receiptClearBtn.hidden = true;
    pendingReceiptBlob = null;
  }

  // ---------- Receipt viewer ----------
  var currentReceiptEntryId = null;
  function openReceipt(entryId) {
    currentReceiptEntryId = entryId;
    idbGet('receipt:' + entryId).then(function (rec) {
      if (rec && rec.dataURL) {
        $receiptModalImg.src = rec.dataURL;
        $receiptModal.classList.add('show');
      } else {
        toast('Receipt not found');
      }
    }).catch(function () { toast('Receipt not found'); });
  }
  $receiptModalClose.addEventListener('click', function () { $receiptModal.classList.remove('show'); });
  $receiptModalDelete.addEventListener('click', function () {
    if (!currentReceiptEntryId) return;
    var id = currentReceiptEntryId;
    if (!window.confirm('Delete this receipt?')) return;
    idbDelete('receipt:' + id).then(function () {
      var e = null;
      for (var i = 0; i < entries.length; i++) if (entries[i].id === id) { e = entries[i]; break; }
      if (e) { delete e.hasReceipt; saveEntries(); }
      renderAll();
      $receiptModal.classList.remove('show');
      toast('Receipt deleted');
    });
  });

  // ---------- Export / import ----------
  function exportCSV() {
    if (entries.length === 0) { toast('Nothing to export yet'); return; }
    var sorted = entries.slice().sort(function (a, b) { return a.ts - b.ts; });
    var lines = [];
    lines.push(['Date','Time','Category','Amount','Note','Recurring','Receipt'].join(','));
    sorted.forEach(function (e) {
      var d = new Date(e.ts);
      var dateStr = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      var timeStr = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
      var cat = getCat(e.categoryId);
      lines.push([
        dateStr, timeStr,
        csvField(cat.name), e.amount.toFixed(2),
        csvField(e.note || ''),
        e.recurringId ? 'Yes' : 'No',
        e.hasReceipt ? 'Yes' : 'No'
      ].join(','));
    });
    var total = sorted.reduce(function (s, e) { return s + e.amount; }, 0);
    lines.push('');
    lines.push(['TOTAL','','', total.toFixed(2), '', '', ''].join(','));
    var csv = lines.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var filename = 'expenses-' + new Date().toISOString().slice(0, 10) + '.csv';
    shareOrDownload(blob, filename, 'text/csv');
  }

  function exportJSON() {
    idbAll().then(function (receipts) {
      var receiptMap = {};
      receipts.forEach(function (r) {
        if (r && r.id && r.id.indexOf('receipt:') === 0) {
          receiptMap[r.id.slice(8)] = r.dataURL;
        }
      });
      var data = {
        version: APP_VERSION,
        exported: new Date().toISOString(),
        entries: entries,
        categories: categories,
        budgets: budgets,
        recurring: recurringItems,
        receipts: receiptMap
      };
      var json = JSON.stringify(data);
      var blob = new Blob([json], { type: 'application/json' });
      var filename = 'expense-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      shareOrDownload(blob, filename, 'application/json');
    }).catch(function () {
      toast('Could not read receipts');
    });
  }

  function shareOrDownload(blob, filename, mimeType) {
    var nav = window.navigator;
    var file = null;
    try { file = new File([blob], filename, { type: mimeType }); } catch (e) { file = null; }
    if (file && nav.canShare && nav.canShare({ files: [file] })) {
      nav.share({ files: [file], title: 'Expense Export', text: 'My expenses' }).catch(function () {
        downloadBlob(blob, filename);
      });
      return;
    }
    downloadBlob(blob, filename);
  }
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
    toast('Downloaded ' + filename);
  }

  $exportBtn.addEventListener('click', exportCSV);
  $('exportJsonBtn').addEventListener('click', exportJSON);
  $('importJsonBtn').addEventListener('click', function () { $('jsonFileInput').click(); });
  $('importCsvBtn').addEventListener('click', function () { $('csvFileInput').click(); });

  $('jsonFileInput').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try { importJSON(JSON.parse(e.target.result)); }
      catch (err) { toast('Invalid JSON file'); }
      ev.target.value = '';
    };
    reader.readAsText(f);
  });

  function importJSON(data) {
    if (!data || typeof data !== 'object') { toast('Invalid backup format'); return; }
    var importedCount = 0;

    if (Array.isArray(data.categories) && data.categories.length > 0) {
      var ids = {};
      categories.forEach(function (c) { ids[c.id] = true; });
      data.categories.forEach(function (c) {
        if (c && c.id && c.name && !ids[c.id]) { categories.push(c); ids[c.id] = true; }
      });
    }

    if (Array.isArray(data.entries)) {
      var eids = {};
      entries.forEach(function (e) { eids[e.id] = true; });
      data.entries.forEach(function (e) {
        if (e && typeof e.amount === 'number' && e.categoryId) {
          if (!categories.some(function (c) { return c.id === e.categoryId; })) {
            categories.push({ id: e.categoryId, name: e.categoryId, emoji: '📦', color: '#adb5bd' });
          }
          if (e.id && eids[e.id]) return;
          entries.push(e);
          importedCount++;
        }
      });
    }

    if (data.budgets && typeof data.budgets === 'object') {
      Object.keys(data.budgets).forEach(function (k) { budgets[k] = data.budgets[k]; });
    }

    if (Array.isArray(data.recurring)) {
      data.recurring.forEach(function (r) {
        if (r && typeof r.amount === 'number' && r.categoryId) recurringItems.push(r);
      });
    }

    var receiptCount = 0;
    var receiptPromises = [];
    if (data.receipts && typeof data.receipts === 'object') {
      Object.keys(data.receipts).forEach(function (entryId) {
        var dataURL = data.receipts[entryId];
        if (typeof dataURL === 'string' && dataURL.indexOf('data:') === 0) {
          receiptPromises.push(
            idbPut({ id: 'receipt:' + entryId, dataURL: dataURL, ts: Date.now() })
              .then(function () {
                var e = entries.find(function (x) { return x.id === entryId; });
                if (e) e.hasReceipt = true;
                receiptCount++;
              }).catch(function () {})
          );
        }
      });
    }

    Promise.all(receiptPromises).then(function () {
      saveEntries(); saveCategories(); saveBudgets(); saveRecurring();
      renderAll(); rebuildFilterDropdowns();
      renderCategoryList(); renderBudgetSettings(); renderRecurringList();
      buildYearSelect(true);
      renderReport();
      toast('Imported ' + importedCount + ' entries' + (receiptCount ? ', ' + receiptCount + ' receipts' : ''));
    });
  }

  $('csvFileInput').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      try { parseCSV(e.target.result); }
      catch (err) { toast('Error parsing CSV'); }
      ev.target.value = '';
    };
    reader.readAsText(f);
  });

  function parseCSVLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
          else inQuotes = false;
        } else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { result.push(current); current = ''; }
        else current += ch;
      }
    }
    result.push(current);
    return result;
  }

  function parseCSV(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) { toast('CSV appears empty'); return; }

    var header = parseCSVLine(lines[0]).map(function (h) { return h.trim().toLowerCase(); });
    var dateIdx = header.indexOf('date');
    var timeIdx = header.indexOf('time');
    var catIdx = header.indexOf('category');
    var amtIdx = header.indexOf('amount');
    var noteIdx = header.indexOf('note');

    if (amtIdx === -1) { toast('CSV must have an "Amount" column'); return; }

    var imported = 0;
    for (var i = 1; i < lines.length; i++) {
      var cols = parseCSVLine(lines[i]);
      if (cols.length < 2) continue;
      var amt = parseFloat(cols[amtIdx]);
      if (isNaN(amt) || amt <= 0) continue;

      var catName = catIdx !== -1 ? (cols[catIdx] || '').trim() : 'Other';
      var catId = null;
      if (catName) {
        var found = null;
        for (var k = 0; k < categories.length; k++) {
          if (categories[k].name.toLowerCase() === catName.toLowerCase()) { found = categories[k]; break; }
        }
        if (found) catId = found.id;
        else {
          catId = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
          if (categories.some(function (c) { return c.id === catId; })) catId += '-' + uid().slice(0, 4);
          categories.push({ id: catId, name: catName, emoji: '📦', color: '#adb5bd' });
        }
      } else catId = categories[0] ? categories[0].id : 'other';

      var ts = Date.now() - (lines.length - i) * 1000; // unique-ish fallback
      if (dateIdx !== -1 && cols[dateIdx]) {
        var dateStr = cols[dateIdx].trim();
        var timeStr = timeIdx !== -1 && cols[timeIdx] ? cols[timeIdx].trim() : '12:00';
        var dt = new Date(dateStr + 'T' + timeStr + ':00');
        if (!isNaN(dt.getTime())) ts = dt.getTime();
      }
      var note = noteIdx !== -1 ? (cols[noteIdx] || '').trim() : '';
      entries.push({ id: uid(), amount: Math.round(amt * 100) / 100, categoryId: catId, note: note, ts: ts });
      imported++;
    }

    saveEntries(); saveCategories();
    renderAll(); rebuildFilterDropdowns();
    renderCategoryList(); buildYearSelect(true); renderReport();
    toast('Imported ' + imported + ' entries');
  }

  // ---------- Clear all ----------
  $('clearAllBtn').addEventListener('click', function () {
    if (!window.confirm('Delete ALL data? This cannot be undone.')) return;
    if (!window.confirm('Really sure? Last chance.')) return;
    entries = []; budgets = {}; recurringItems = [];
    categories = DEFAULT_CATEGORIES.slice();
    selectedCat = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CATS_KEY);
      localStorage.removeItem(BUDGETS_KEY);
      localStorage.removeItem(RECURRING_KEY);
    } catch (e) {}
    idbClear().catch(function () {});
    buildCategoryButtons(); rebuildFilterDropdowns();
    renderAll(); renderCategoryList(); renderBudgetSettings(); renderRecurringList();
    buildYearSelect(true); renderReport();
    toast('All data cleared');
  });

  // ---------- Filters ----------
  function rebuildFilterDropdowns() {
    var currentVal = $filterCategory.value;
    var html = '<option value="">All categories</option>';
    categories.forEach(function (c) {
      html += '<option value="' + c.id + '">' + c.emoji + ' ' + c.name + '</option>';
    });
    $filterCategory.innerHTML = html;
    if (currentVal && categories.some(function (c) { return c.id === currentVal; })) $filterCategory.value = currentVal;
  }

  // ---------- Tabs ----------
  $tabBar.addEventListener('click', function (e) {
    var btn = e.target.closest('.tab-btn');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  function switchTab(tab) {
    currentTab = tab;
    saveUI();
    Array.prototype.forEach.call($tabBar.querySelectorAll('.tab-btn'), function (b) {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    $('tab-add').hidden = tab !== 'add';
    $('tab-summary').hidden = tab !== 'summary';
    $('tab-report').hidden = tab !== 'report';
    $('tab-history').hidden = tab !== 'history';
    $('tab-settings').hidden = tab !== 'settings';
    if (tab === 'summary') { renderTotals(); renderMonthlySummary(); }
    if (tab === 'history') renderEntries();
    if (tab === 'add') renderRecent();
    if (tab === 'report') renderReport();
    if (tab === 'settings') {
      renderCategoryList(); renderBudgetSettings(); renderRecurringList();
      $versionLine.textContent = 'Version ' + APP_VERSION;
    }
    window.scrollTo(0, 0);
  }

  $('viewAllBtn').addEventListener('click', function () { switchTab('history'); });

  // ---------- Passcode lock ----------
  var pinBuffer = '';
  var pinExpectedLength = 4;

  function hashPin(pin) {
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      var enc = new TextEncoder().encode('expenseLogger:' + pin);
      return crypto.subtle.digest('SHA-256', enc).then(function (buf) {
        var arr = Array.from(new Uint8Array(buf));
        return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    // Fallback: very weak, only used if SubtleCrypto unavailable
    var h = 0;
    var s = 'expenseLogger:' + pin;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return Promise.resolve('weak:' + h);
  }

  function getStoredPin() {
    try { return localStorage.getItem(PIN_KEY); } catch (e) { return null; }
  }
  function setStoredPin(hash) {
    try { localStorage.setItem(PIN_KEY, hash); } catch (e) {}
  }
  function clearStoredPin() {
    try { localStorage.removeItem(PIN_KEY); } catch (e) {}
  }

  function buildPinPad() {
    var layout = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
    $pinPad.innerHTML = '';
    layout.forEach(function (key) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pin-key' + (key === '' ? ' empty' : '');
      btn.textContent = key;
      if (key !== '') {
        btn.addEventListener('click', function () {
          if (key === '⌫') pinBuffer = pinBuffer.slice(0, -1);
          else if (pinBuffer.length < 8) pinBuffer += key;
          updatePinDots();
          if (pinBuffer.length >= pinExpectedLength) tryUnlock();
        });
      }
      $pinPad.appendChild(btn);
    });
  }

  function updatePinDots() {
    var stored = getStoredPin();
    // We don't know length; show dots for current buffer
    $pinDots.innerHTML = '';
    var len = Math.max(pinBuffer.length, 4);
    for (var i = 0; i < len; i++) {
      var d = document.createElement('span');
      d.className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '');
      $pinDots.appendChild(d);
    }
  }

  function tryUnlock() {
    var stored = getStoredPin();
    if (!stored) { showApp(); return; }
    hashPin(pinBuffer).then(function (h) {
      if (h === stored) {
        pinBuffer = '';
        showApp();
      } else {
        toast('Wrong passcode');
        pinBuffer = '';
        updatePinDots();
      }
    });
  }

  function showLock() {
    $app.hidden = true;
    $lockScreen.hidden = false;
    pinBuffer = '';
    updatePinDots();
    buildPinPad();
  }
  function showApp() {
    $lockScreen.hidden = true;
    $app.hidden = false;
  }

  $togglePinBtn.addEventListener('click', function () {
    if (getStoredPin()) {
      // Turn off
      if (!window.confirm('Remove passcode lock?')) return;
      clearStoredPin();
      $togglePinBtn.textContent = 'Off';
      toast('Passcode removed');
    } else {
      // Turn on
      $pinModalTitle.textContent = 'Set Passcode';
      $pinInput1.value = ''; $pinInput2.value = '';
      $pinModal.classList.add('show');
    }
  });

  $pinCancelBtn.addEventListener('click', function () { $pinModal.classList.remove('show'); });
  $pinSaveBtn.addEventListener('click', function () {
    var p1 = $pinInput1.value.trim();
    var p2 = $pinInput2.value.trim();
    if (!/^\d{4,8}$/.test(p1)) { toast('Passcode must be 4–8 digits'); return; }
    if (p1 !== p2) { toast('Passcodes do not match'); return; }
    hashPin(p1).then(function (h) {
      setStoredPin(h);
      $pinModal.classList.remove('show');
      $togglePinBtn.textContent = 'On';
      toast('Passcode set');
    });
  });

  $forgotPinBtn.addEventListener('click', function () {
    var msg = 'Forgot passcode?\n\nThis will erase all app data on this device (expenses, budgets, receipts) so you can start fresh. Backups you exported are not affected.';
    if (!window.confirm(msg)) return;
    if (!window.confirm('Really erase everything?')) return;
    entries = []; budgets = {}; recurringItems = [];
    categories = DEFAULT_CATEGORIES.slice();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CATS_KEY);
      localStorage.removeItem(BUDGETS_KEY);
      localStorage.removeItem(RECURRING_KEY);
      localStorage.removeItem(PIN_KEY);
    } catch (e) {}
    idbClear().catch(function () {});
    buildCategoryButtons(); rebuildFilterDropdowns();
    renderAll(); renderCategoryList(); renderBudgetSettings(); renderRecurringList();
    showApp();
    toast('Data erased. Passcode removed.');
  });

  // ---------- Event wiring ----------
  $amount.addEventListener('input', updateSaveState);
  $saveBtn.addEventListener('click', addEntry);
  $('addCategoryBtn').addEventListener('click', function () { openCategoryModal(null); });

  $note.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (!$saveBtn.disabled) addEntry(); }
  });
  $amount.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $note.focus(); }
  });

  var searchTimer = null;
  $searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderEntries, 200);
  });
  $filterCategory.addEventListener('change', renderEntries);
  $filterMonth.addEventListener('change', renderEntries);
  $filterType.addEventListener('change', renderEntries);
  $filterSort.addEventListener('change', renderEntries);

  $summaryMonth.addEventListener('change', function () { renderTotals(); renderMonthlySummary(); });
  $reportMonth.addEventListener('change', renderReport);
  $reportExportPdfBtn.addEventListener('click', function () { window.print(); });

  $yearSelect.addEventListener('change', function () {
    renderYearlySummary(parseInt($yearSelect.value, 10));
  });

  // Close modals on backdrop tap
  [$budgetModal, $catModal, $receiptModal, $pinModal].forEach(function (ov) {
    ov.addEventListener('click', function (e) {
      if (e.target === ov) ov.classList.remove('show');
    });
  });

  // Resize / orientation
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (currentTab === 'summary') renderTotals();
    }, 120);
  });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { if (currentTab === 'summary') renderTotals(); }, 200);
  });

  // Midnight / new-month rollover
  var lastDay = new Date().getDate();
  setInterval(function () {
    var d = new Date().getDate();
    if (d !== lastDay) {
      lastDay = d;
      processRecurring();
      renderAll();
      if (currentTab === 'report') renderReport();
    }
  }, 60000);

  // Follow system dark/light changes for the canvas chart
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var mqHandler = function () { if (currentTab === 'summary') renderTotals(); };
    if (mq.addEventListener) mq.addEventListener('change', mqHandler);
    else if (mq.addListener) mq.addListener(mqHandler);
  }

  // ---------- Render all ----------
  function renderAll() {
    renderRecent();
    renderEntries();
    renderTotals();
    renderMonthlySummary();
    if (currentTab === 'report') renderReport();
    if (currentTab === 'settings') buildYearSelect();
  }

  // ---------- Service worker ----------
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Update available — close and reopen the app');
          }
        });
      });
    }).catch(function () {});
  }

  // ---------- Boot ----------
  categories = loadCategories();
  budgets = loadBudgets();
  recurringItems = loadRecurring();
  entries = loadEntries();

  var ui = loadUI();
  currentTab = ui.tab || 'add';

  (function () {
    var now = new Date();
    var v = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
    $summaryMonth.value = v;
    $reportMonth.value = v;
  })();

  migrate();
  buildCategoryButtons();
  rebuildFilterDropdowns();
  renderAll();
  renderCategoryList();
  renderBudgetSettings();
  renderRecurringList();
  buildYearSelect(true);
  renderReport();
  updateSaveState();
  renderRecent();
  $versionLine.textContent = 'Version ' + APP_VERSION;

  if (getStoredPin()) showLock();
  else showApp();

  switchTab(currentTab);
  registerSW();

})();