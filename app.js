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
  var IMPORT_RULES_KEY    = 'expenseLogger.importRules.v1';
  var IMPORT_SETTINGS_KEY = 'expenseLogger.importSettings.v1';

  var APP_VERSION = '1.2.0';

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
  var editingEntryId = null;     // id of entry being edited (modal)
  var importRules = [];
  var importSettings = { countCardPayments: false };
  var pendingImport = null;      // { batchId, rows, fileName }

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
  var $saveHint = $('saveHint');
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
  var $insightsList = $('insightsList');
  var $donutChart = $('donutChart');
  var $donutCenterLabel = $('donutCenterLabel');
  var $donutCenterValue = $('donutCenterValue');
  var $donutCenterSub = $('donutCenterSub');
  var $trendChart = $('trendChart');
  var $trendCompare = $('trendCompare');
  var $dailyChart = $('dailyChart');
  var $dailyMonthLabel = $('dailyMonthLabel');
  var $dailySubtitle = $('dailySubtitle');
  var $dailyLegend = $('dailyLegend');
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
  var $editAmount = $('editAmount');
  var $editCategory = $('editCategory');
  var $editDate = $('editDate');
  var $editNote = $('editNote');
  var $editSaveBtn = $('editSaveBtn');
  var $editDeleteBtn = $('editDeleteBtn');

  var $pinModal = $('pinModal');
  var $pinModalTitle = $('pinModalTitle');
  var $pinInput1 = $('pinInput1');
  var $pinInput2 = $('pinInput2');
  var $pinCancelBtn = $('pinCancelBtn');
  var $pinSaveBtn = $('pinSaveBtn');
  var $togglePinBtn = $('togglePinBtn');
  var $forgotPinBtn = $('forgotPinBtn');

  var $versionLine = $('versionLine');
  var $importFileInput = $('importFileInput');
  var $importModal = $('importModal');
  var $importSummary = $('importSummary');
  var $importRowList = $('importRowList');
  var $importConfirmBtn = $('importConfirmBtn');
  var $importCancelBtn = $('importCancelBtn');
  var $importRulesList = $('importRulesList');

  // ---------- Utilities ----------
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  // Raw 2-decimal string (for math / CSV)
  function fmtMoney(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }
  // Display with thousands separators + $
  var _usdFmt = null;
  function fmtMoneyDisplay(n) {
    if (n == null || isNaN(n)) n = 0;
    try {
      if (!_usdFmt) {
        _usdFmt = new Intl.NumberFormat('en-US', {
          style: 'currency', currency: 'USD',
          minimumFractionDigits: 2, maximumFractionDigits: 2
        });
      }
      return _usdFmt.format(n);
    } catch (e) {
      return '$' + fmtMoney(n);
    }
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function localDateStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
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
  // Normalize text for dedupe keys
  function normText(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }
  // Dedupe key: prefer id; else date+amount+cat+note
  function entryDedupeKey(e) {
    if (e && e.id) return 'id:' + e.id;
    if (!e) return '';
    var d = new Date(e.ts || 0);
    var dateStr = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    return 'k:' + dateStr + '|' + (Math.round((e.amount || 0) * 100) / 100) + '|' +
      (e.categoryId || '') + '|' + normText(e.note);
  }
  function fnv1a(str) {
    var h = 0x811c9dc5;
    var s = String(str);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }
  function importBatchIdFromBytes(bufOrText) {
    return 'b:' + fnv1a(bufOrText);
  }
  function importRowKey(parts) {
    return 'r:' + fnv1a(parts.join('|'));
  }
  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function cleanImportNote(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+\d{8,}\s*$/g, '').trim();
    s = s.replace(/\s+WEB\s+\d+\s*$/i, '').trim();
    return s.slice(0, 80);
  }
  function descriptionMatchKey(note) {
    var s = normText(cleanImportNote(note));
    s = s.replace(/\b\d{6,}\b/g, '#');
    return s;
  }
  function pctLabel(amt, total) {
    if (total <= 0 || amt <= 0) return '0%';
    var p = (amt / total) * 100;
    if (p > 0 && p < 1) return '<1%';
    if (Math.abs(amt - total) < 0.001) return '100%';
    if (p > 99 && p < 100) return '>99%';
    return Math.round(p) + '%';
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
  function loadImportRules() {
    try {
      var raw = localStorage.getItem(IMPORT_RULES_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p)) {
          return p.filter(function (r) {
            return r && r.id && r.pattern;
          });
        }
      }
    } catch (e) {}
    return [];
  }
  function saveImportRules() {
    try { localStorage.setItem(IMPORT_RULES_KEY, JSON.stringify(importRules)); } catch (e) {}
  }
  function loadImportSettings() {
    try {
      var raw = localStorage.getItem(IMPORT_SETTINGS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') return { countCardPayments: !!p.countCardPayments };
      }
    } catch (e) {}
    return { countCardPayments: false };
  }
  function saveImportSettings() {
    try { localStorage.setItem(IMPORT_SETTINGS_KEY, JSON.stringify(importSettings)); } catch (e) {}
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
    var hasAmount = !isNaN(v) && v > 0;
    var hasCat = selectedCat !== null;
    var ok = hasAmount && hasCat;
    $saveBtn.disabled = !ok;
    if ($saveHint) {
      if (!hasAmount && !hasCat) $saveHint.textContent = 'Enter an amount and pick a category';
      else if (!hasAmount) $saveHint.textContent = 'Enter an amount';
      else if (!hasCat) $saveHint.textContent = 'Pick a category';
      else $saveHint.textContent = '';
    }
  }

  // ---------- Entry row rendering ----------
  function createEntryRow(e) {
    var cat = getCat(e.categoryId);
    var row = document.createElement('div');
    row.className = 'entry';
    row.dataset.id = e.id;

    // Click row (except buttons) to edit
    row.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('button')) return;
      openEntryEditor(e.id);
    });

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
      thumb.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openReceipt(e.id);
      });
      idbGet('receipt:' + e.id).then(function (rec) {
        if (rec && rec.dataURL) thumb.src = rec.dataURL;
      }).catch(function () {});
      right.appendChild(thumb);
    }

    var amt = document.createElement('span');
    amt.className = 'entry-amt';
    amt.textContent = fmtMoneyDisplay(e.amount);
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
    $undoText.textContent = 'Deleted ' + fmtMoneyDisplay(entry.amount) + ' — ' + getCat(entry.categoryId).name;
    $undoToast.classList.add('show');
    undoTimer = setTimeout(function () {
      $undoToast.classList.remove('show');
      pendingDelete = null;
    }, 9000);
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

  function getMonthTotal(y, m) {
    return entries
      .filter(function (e) { return isSameMonth(e.ts, y, m); })
      .reduce(function (s, e) { return s + e.amount; }, 0);
  }

  function getTotalBudgetLimit() {
    var sum = 0;
    categories.forEach(function (c) {
      if (budgets[c.id] && budgets[c.id] > 0) sum += budgets[c.id];
    });
    return sum;
  }

  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) ? v.trim() : fallback;
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  var summaryAnimId = null;
  var totalAnimId = null;
  var summaryAnimGen = 0;
  var selectedLegendCatId = null;
  var displayedTotal = 0;
  var lastDonutData = null;

  function cancelSummaryAnim() {
    if (summaryAnimId) {
      cancelAnimationFrame(summaryAnimId);
      summaryAnimId = null;
    }
  }

  function runChartAnim(duration, onFrame, onDone) {
    cancelSummaryAnim();
    var gen = ++summaryAnimGen;
    if (prefersReducedMotion()) {
      onFrame(1);
      if (onDone) onDone();
      return;
    }
    var start = null;
    function frame(ts) {
      if (gen !== summaryAnimGen) return;
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / duration);
      onFrame(easeOutCubic(p));
      if (p < 1) summaryAnimId = requestAnimationFrame(frame);
      else {
        summaryAnimId = null;
        if (onDone) onDone();
      }
    }
    summaryAnimId = requestAnimationFrame(frame);
  }

  function animateTotalDisplay(target) {
    if (totalAnimId) cancelAnimationFrame(totalAnimId);
    var from = displayedTotal;
    if (prefersReducedMotion()) {
      if ($totalVal) $totalVal.textContent = fmtMoneyDisplay(target);
      displayedTotal = target;
      return;
    }
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / 650);
      var e = easeOutCubic(p);
      if ($totalVal) $totalVal.textContent = fmtMoneyDisplay(from + (target - from) * e);
      if (p < 1) totalAnimId = requestAnimationFrame(frame);
      else {
        totalAnimId = null;
        displayedTotal = target;
      }
    }
    totalAnimId = requestAnimationFrame(frame);
  }

  function updateDonutCenter(catId, total, byCat) {
    if (!$donutCenterLabel || !$donutCenterValue || !$donutCenterSub) return;
    if (catId && byCat[catId] > 0) {
      var c = getCat(catId);
      var amt = byCat[catId];
      var pct = total > 0 ? Math.round((amt / total) * 100) : 0;
      $donutCenterLabel.textContent = c.emoji + ' ' + c.name;
      $donutCenterValue.textContent = fmtMoneyDisplay(amt);
      $donutCenterSub.textContent = pct + '% of spending';
    } else if (total === 0) {
      $donutCenterLabel.textContent = 'Total';
      $donutCenterValue.textContent = fmtMoneyDisplay(0);
      $donutCenterSub.textContent = 'No spending this month';
    } else {
      $donutCenterLabel.textContent = 'Total';
      $donutCenterValue.textContent = fmtMoneyDisplay(total);
      $donutCenterSub.textContent = 'Tap a slice or category';
    }
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeDonutArc(cx, cy, rOuter, rInner, startAngle, endAngle) {
    if (endAngle - startAngle >= 359.99) endAngle = startAngle + 359.99;
    var startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
    var endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
    var startInner = polarToCartesian(cx, cy, rInner, endAngle);
    var endInner = polarToCartesian(cx, cy, rInner, startAngle);
    var large = endAngle - startAngle <= 180 ? '0' : '1';
    return [
      'M', startOuter.x, startOuter.y,
      'A', rOuter, rOuter, 0, large, 0, endOuter.x, endOuter.y,
      'L', endInner.x, endInner.y,
      'A', rInner, rInner, 0, large, 1, startInner.x, startInner.y,
      'Z'
    ].join(' ');
  }

  function drawDonutFrame(byCat, total, progress, highlightId) {
    if (!$donutChart) return;
    var cx = 110, cy = 110, rOuter = 92, rInner = 58;
    var rows = categories
      .map(function (c) { return { c: c, amt: byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });

    if (total === 0 || rows.length === 0) {
      if ($donutChart) {
        $donutChart.innerHTML = '<circle cx="110" cy="110" r="92" fill="none" stroke="' + cssVar('--card-2', '#1f232e') + '" stroke-width="34"/>';
      }
      return;
    }

    var html = '';
    var angle = 0;
    var dimOpacity = highlightId ? 0.35 : 1;
    rows.forEach(function (r) {
      var slice = (r.amt / total) * 360 * progress;
      if (slice < 0.05) return;
      var end = angle + slice;
      var path = describeDonutArc(cx, cy, rOuter, rInner, angle, end);
      var opacity = highlightId && highlightId !== r.c.id ? dimOpacity : 1;
      var strokeW = highlightId === r.c.id ? 3 : 0;
      html += '<path class="donut-seg" data-cat="' + r.c.id + '" d="' + path + '" fill="' + r.c.color + '"'
        + ' opacity="' + opacity + '" stroke="' + cssVar('--bg', '#0f1117') + '" stroke-width="' + strokeW + '"/>';
      angle = end;
    });
    $donutChart.innerHTML = html;
  }

  if ($donutChart) $donutChart.addEventListener('click', function (e) {
    var path = e.target.closest ? e.target.closest('.donut-seg') : null;
    if (!path || !lastDonutData) return;
    var id = path.getAttribute('data-cat');
    var byCat = lastDonutData.byCat;
    var total = lastDonutData.total;
    selectedLegendCatId = selectedLegendCatId === id ? null : id;
    renderLegendInteractive(byCat, total);
    drawDonutFrame(byCat, total, 1, selectedLegendCatId);
    updateDonutCenter(selectedLegendCatId, total, byCat);
  });

  var lastSummaryYm = '';

  function prepareDonutChart(byCat, total) {
    lastDonutData = { byCat: byCat, total: total };
    updateDonutCenter(selectedLegendCatId, total, byCat);
  }

  function renderLegendInteractive(byCat, total) {
    if (!$legendEl) return;
    if (total === 0) {
      $legendEl.innerHTML = '<div class="empty chart-empty">Add expenses to see your category breakdown.</div>';
      return;
    }
    var rows = categories
      .map(function (c) { return { c: c, amt: byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });
    $legendEl.innerHTML = '';
    rows.forEach(function (r) {
      var pct = total > 0 ? Math.round((r.amt / total) * 100) : 0;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'legend-row legend-btn' + (selectedLegendCatId === r.c.id ? ' active' : '');
      row.innerHTML = '<span class="name"><span class="dot" style="background:' + r.c.color + '"></span>'
        + r.c.emoji + ' ' + r.c.name + ' <span class="pct">· ' + pctLabel(r.amt, total) + '</span></span>'
        + '<span class="amt">' + fmtMoneyDisplay(r.amt) + '</span>';
      row.addEventListener('click', function () {
        selectedLegendCatId = selectedLegendCatId === r.c.id ? null : r.c.id;
        renderLegendInteractive(byCat, total);
        drawDonutFrame(byCat, total, 1, selectedLegendCatId);
        updateDonutCenter(selectedLegendCatId, total, byCat);
      });
      $legendEl.appendChild(row);
    });
  }

  var trendCtx = null;
  var dailyCtx = null;
  var chartDpr = Math.min(window.devicePixelRatio || 1, 2);

  function getTrendCtx() {
    if (!$trendChart) return null;
    if (!trendCtx) trendCtx = $trendChart.getContext('2d');
    return trendCtx;
  }
  function getDailyCtx() {
    if (!$dailyChart) return null;
    if (!dailyCtx) dailyCtx = $dailyChart.getContext('2d');
    return dailyCtx;
  }

  function sizeChartCanvas(canvas, ctx, cssH) {
    if (!canvas || !ctx) return { W: 0, H: 0 };
    var cssW = canvas.clientWidth || canvas.parentNode.clientWidth || 320;
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * chartDpr);
    canvas.height = Math.round(cssH * chartDpr);
    ctx.setTransform(chartDpr, 0, 0, chartDpr, 0, 0);
    return { W: cssW, H: cssH };
  }

  function getTrendMonths(endY, endM, count) {
    var list = [];
    var y = endY, m = endM;
    for (var i = 0; i < count; i++) {
      list.unshift({ y: y, m: m, total: getMonthTotal(y, m) });
      m -= 1;
      if (m < 0) { m = 11; y -= 1; }
    }
    return list;
  }

  function renderTrendCompare(endY, endM, months) {
    if (months.length < 2) {
      $trendCompare.textContent = '';
      return;
    }
    var cur = months[months.length - 1].total;
    var prev = months[months.length - 2].total;
    var now = new Date();
    var isCurrent = endY === now.getFullYear() && endM === now.getMonth();
    var label = isCurrent ? 'This month' : monthShort(new Date(endY, endM, 1));
    if (cur === 0 && prev === 0) {
      $trendCompare.textContent = 'No spending in recent months yet.';
      return;
    }
    var diff = cur - prev;
    var pct = prev > 0 ? Math.round((diff / prev) * 100) : (cur > 0 ? 100 : 0);
    var arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
    var tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    $trendCompare.innerHTML = '<span class="trend-pill ' + tone + '">' + arrow + ' ' + fmtMoneyDisplay(Math.abs(diff))
      + (prev > 0 ? ' (' + (diff >= 0 ? '+' : '') + pct + '%)' : '')
      + '</span> <span class="trend-words">' + label + ' vs last month</span>';
  }

  function drawTrendFrame(months, progress, endY, endM) {
    var tctx = getTrendCtx();
    if (!tctx || !$trendChart) return;
    var dim = sizeChartCanvas($trendChart, tctx, 168);
    var W = dim.W, H = dim.H;
    tctx.clearRect(0, 0, W, H);
    var hasData = months.some(function (mo) { return mo.total > 0; });
    if (!hasData) {
      tctx.fillStyle = cssVar('--text-dim', '#8b93a7');
      tctx.font = '14px -apple-system, sans-serif';
      tctx.textAlign = 'center';
      tctx.textBaseline = 'middle';
      tctx.fillText('Trend appears as you log more months', W / 2, H / 2);
      return;
    }
    var padL = 8, padR = 8, padT = 12, padB = 28;
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;
    var max = Math.max.apply(null, months.map(function (mo) { return mo.total; })) || 1;
    var barGap = 6;
    var barW = (chartW - barGap * (months.length - 1)) / months.length;
    var now = new Date();

    months.forEach(function (mo, i) {
      var x = padL + i * (barW + barGap);
      var targetH = (mo.total / max) * chartH;
      var h = Math.max(0, targetH * progress);
      var y = padT + chartH - h;
      var isSel = mo.y === endY && mo.m === endM;
      var isNow = mo.y === now.getFullYear() && mo.m === now.getMonth();
      tctx.fillStyle = cssVar('--card-2', '#1f232e');
      roundRect(tctx, x, padT, barW, chartH, 4);
      tctx.fill();
      if (mo.total > 0 && h >= 1) {
        var grad = tctx.createLinearGradient(0, y, 0, padT + chartH);
        grad.addColorStop(0, isSel || isNow ? cssVar('--accent', '#4dabf7') : hexLighten(cssVar('--accent', '#4dabf7'), 0.15));
        grad.addColorStop(1, isSel || isNow ? hexLighten(cssVar('--accent', '#4dabf7'), 0.15) : cssVar('--card-2', '#1f232e'));
        tctx.fillStyle = grad;
        roundRect(tctx, x, y, barW, h, 4);
        tctx.fill();
      }
      if (isSel || isNow) {
        tctx.strokeStyle = cssVar('--accent', '#4dabf7');
        tctx.lineWidth = 2;
        roundRect(tctx, x - 1, padT - 1, barW + 2, chartH + 2, 5);
        tctx.stroke();
      }
      tctx.fillStyle = cssVar('--text-dim', '#8b93a7');
      tctx.font = '600 10px -apple-system, sans-serif';
      tctx.textAlign = 'center';
      tctx.textBaseline = 'top';
      tctx.fillText(monthShort(new Date(mo.y, mo.m, 1)), x + barW / 2, padT + chartH + 6);
    });
  }

  function prepareTrendChart(endY, endM) {
    var months = getTrendMonths(endY, endM, 12);
    renderTrendCompare(endY, endM, months);
    return months;
  }

  function getDailyTotals(y, m) {
    var days = daysInMonth(y, m);
    var arr = [];
    for (var d = 1; d <= days; d++) arr.push(0);
    entries.forEach(function (e) {
      var dt = new Date(e.ts);
      if (dt.getFullYear() === y && dt.getMonth() === m) {
        arr[dt.getDate() - 1] += e.amount;
      }
    });
    return arr;
  }

  function drawDailyFrame(daily, y, m, progress) {
    var dctx = getDailyCtx();
    if (!dctx || !$dailyChart) return;
    var dim = sizeChartCanvas($dailyChart, dctx, 200);
    var W = dim.W, H = dim.H;
    dctx.clearRect(0, 0, W, H);
    var total = daily.reduce(function (s, v) { return s + v; }, 0);
    $dailyMonthLabel.textContent = '· ' + monthShort(new Date(y, m, 1));
    var budget = getTotalBudgetLimit();
    var now = new Date();
    var isCurrentMonth = y === now.getFullYear() && m === now.getMonth();
    var dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth(y, m);

    if (total === 0) {
      dctx.fillStyle = cssVar('--text-dim', '#8b93a7');
      dctx.font = '14px -apple-system, sans-serif';
      dctx.textAlign = 'center';
      dctx.textBaseline = 'middle';
      dctx.fillText('No daily spending this month', W / 2, H / 2);
      if ($dailySubtitle) $dailySubtitle.textContent = budget > 0 ? 'Monthly budget: $' + fmtMoney(budget) : 'Log expenses to see your daily rhythm.';
      if ($dailyLegend) $dailyLegend.innerHTML = '';
      return;
    }

    var cum = [];
    var run = 0;
    daily.forEach(function (v) { run += v; cum.push(run); });
    var lastCumDayIdx = isCurrentMonth ? Math.max(0, dayOfMonth - 1) : daily.length - 1;
    var cumAtEnd = cum[lastCumDayIdx] || 0;
    var maxY = Math.max(cumAtEnd, budget || 0, total) * 1.08 || 1;

    if (isCurrentMonth && dayOfMonth > 0) {
      var pace = (total / dayOfMonth) * daysInMonth(y, m);
      $dailySubtitle.textContent = 'On pace for ~$' + fmtMoney(pace) + ' by month end'
        + (budget > 0 ? ' (budget $' + fmtMoney(budget) + ')' : '');
    } else {
      $dailySubtitle.textContent = 'Total $' + fmtMoney(total)
        + (budget > 0 ? ' · budget $' + fmtMoney(budget) : '');
    }

    var padR = 8, padT = 10, padB = 22;
    dctx.font = '10px -apple-system, sans-serif';
    var yAxisTop = fmtMoneyDisplay(maxY);
    var padL = Math.max(48, Math.ceil(dctx.measureText(yAxisTop).width) + 10);
    var chartW = W - padL - padR;
    var chartH = H - padT - padB;
    var n = daily.length;
    var gap = 2;
    var barW = Math.max(2, (chartW - gap * (n - 1)) / n);

    dctx.strokeStyle = cssVar('--border', '#2a2f3d');
    dctx.lineWidth = 1;
    dctx.beginPath();
    dctx.moveTo(padL, padT + chartH);
    dctx.lineTo(padL + chartW, padT + chartH);
    dctx.stroke();

    daily.forEach(function (v, i) {
      var x = padL + i * (barW + gap);
      var h = Math.max(0, (v / maxY) * chartH * progress);
      var yBar = padT + chartH - h;
      dctx.fillStyle = cssVar('--card-2', '#1f232e');
      dctx.fillRect(x, padT + chartH - 1, barW, 1);
      if (v > 0 && h >= 1) {
        dctx.fillStyle = cssVar('--accent', '#4dabf7');
        dctx.globalAlpha = 0.85;
        roundRect(dctx, x, yBar, barW, h, 2);
        dctx.fill();
        dctx.globalAlpha = 1;
      }
    });

    if (budget > 0) {
      dctx.setLineDash([4, 4]);
      dctx.strokeStyle = cssVar('--success', '#51cf66');
      dctx.lineWidth = 1.5;
      dctx.beginPath();
      for (var d = 1; d <= n; d++) {
        var bx = padL + (d - 0.5) * (barW + gap);
        var by = padT + chartH - (budget * (d / n) / maxY) * chartH;
        if (d === 1) dctx.moveTo(bx, by);
        else dctx.lineTo(bx, by);
      }
      dctx.stroke();
      dctx.setLineDash([]);
    }

    dctx.strokeStyle = cssVar('--text', '#e8ecf3');
    dctx.lineWidth = 2;
    dctx.lineJoin = 'round';
    dctx.beginPath();
    var lastX = 0, lastY = 0;
    cum.forEach(function (c, i) {
      if (i > lastCumDayIdx) return;
      var cx = padL + (i + 0.5) * (barW + gap);
      var cy = padT + chartH - (c / maxY) * chartH * progress;
      if (i === 0) dctx.moveTo(cx, cy);
      else dctx.lineTo(cx, cy);
      lastX = cx; lastY = cy;
    });
    dctx.stroke();
    if (progress > 0.9 && isCurrentMonth && lastCumDayIdx >= 0) {
      dctx.fillStyle = cssVar('--accent', '#4dabf7');
      dctx.beginPath();
      dctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      dctx.fill();
    }

    dctx.fillStyle = cssVar('--text-dim', '#8b93a7');
    dctx.font = '10px -apple-system, sans-serif';
    dctx.textAlign = 'left';
    dctx.textBaseline = 'middle';
    dctx.fillText(yAxisTop, 2, padT + 8);
    dctx.fillText(fmtMoneyDisplay(0), 2, padT + chartH);

    var leg = '';
    if (budget > 0) {
      leg += '<span class="mini-leg"><span class="swatch dash green"></span>Budget pace</span>';
    }
    leg += '<span class="mini-leg"><span class="swatch line"></span>Cumulative</span>';
    leg += '<span class="mini-leg"><span class="swatch bar"></span>Daily</span>';
    if ($dailyLegend) $dailyLegend.innerHTML = leg;
  }

  function prepareDailyChart(y, m) {
    return getDailyTotals(y, m);
  }

  function topMerchantNote(monthEntries) {
    var byNote = {};
    monthEntries.forEach(function (e) {
      var n = (e.note || '').trim();
      if (!n) return;
      if (!byNote[n]) byNote[n] = { sum: 0, count: 0 };
      byNote[n].sum += e.amount;
      byNote[n].count += 1;
    });
    var best = null;
    Object.keys(byNote).forEach(function (k) {
      var o = byNote[k];
      if (!best || o.sum > best.sum) best = { note: k, sum: o.sum, count: o.count };
    });
    return best;
  }

  function renderInsights(y, m) {
    if (!$insightsList) return;
    var data = getSummaryData(y, m);
    var now = new Date();
    var isCurrent = y === now.getFullYear() && m === now.getMonth();
    var prevM = m - 1, prevY = y;
    if (prevM < 0) { prevM = 11; prevY -= 1; }
    var prevTotal = getMonthTotal(prevY, prevM);
    var items = [];

    if (data.total === 0 && prevTotal === 0) {
      $insightsList.innerHTML = '<div class="insight-empty"><span class="insight-icon">✨</span>'
        + '<p>Your insights will light up once you start logging expenses.</p></div>';
      return;
    }

    var topCat = null;
    categories.forEach(function (c) {
      var amt = data.byCat[c.id] || 0;
      if (amt > 0 && (!topCat || amt > topCat.amt)) topCat = { c: c, amt: amt };
    });
    if (topCat) {
      var share = Math.round((topCat.amt / data.total) * 100);
      items.push({
        icon: topCat.c.emoji,
        title: 'Top category',
        text: topCat.c.name + ' leads at $' + fmtMoney(topCat.amt) + ' (' + share + '% of the month).'
      });
    }

    if (prevTotal > 0 || data.total > 0) {
      var diff = data.total - prevTotal;
      var dir = diff > 0 ? 'more' : diff < 0 ? 'less' : 'the same as';
      var pctTxt = prevTotal > 0 ? ' (' + (diff >= 0 ? '+' : '') + Math.round((diff / prevTotal) * 100) + '%)' : '';
      items.push({
        icon: diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️',
        title: 'Vs last month',
        text: diff === 0
          ? 'Spending matches last month at $' + fmtMoney(data.total) + '.'
          : 'You spent $' + fmtMoney(Math.abs(diff)) + ' ' + dir + ' than last month' + pctTxt + '.'
      });
    }

    var merchant = topMerchantNote(data.entries);
    if (merchant) {
      items.push({
        icon: '🏷️',
        title: 'Top note',
        text: '"' + merchant.note + '" — $' + fmtMoney(merchant.sum)
          + (merchant.count > 1 ? ' across ' + merchant.count + ' entries' : '') + '.'
      });
    }

    if (isCurrent && data.total > 0) {
      var dom = now.getDate();
      var dim = daysInMonth(y, m);
      if (dom > 0) {
        var projected = (data.total / dom) * dim;
        items.push({
          icon: '🔮',
          title: 'Month-end forecast',
          text: 'At today\'s pace you\'ll land around $' + fmtMoney(projected) + ' by the ' + monthShort(new Date(y, m, 1)) + ' close.'
        });
      }
    } else if (!isCurrent && data.total > 0) {
      items.push({
        icon: '📅',
        title: 'Month closed',
        text: 'You spent $' + fmtMoney(data.total) + ' across ' + data.entries.length + ' transaction'
          + (data.entries.length === 1 ? '' : 's') + '.'
      });
    }

    var html = '';
    items.forEach(function (it) {
      html += '<div class="insight-item" role="listitem">'
        + '<span class="insight-icon" aria-hidden="true">' + it.icon + '</span>'
        + '<div class="insight-body"><div class="insight-title">' + it.title + '</div>'
        + '<div class="insight-text">' + it.text + '</div></div></div>';
    });
    $insightsList.innerHTML = html;
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
    var ymKey = y + '-' + m;
    if (ymKey !== lastSummaryYm) {
      selectedLegendCatId = null;
      lastSummaryYm = ymKey;
    }
    $monthLbl.textContent = '· ' + monthName(new Date(y, m, 1));
    animateTotalDisplay(data.total);
    prepareDonutChart(data.byCat, data.total);
    renderLegendInteractive(data.byCat, data.total);
    var trendMonths = prepareTrendChart(y, m);
    var dailyTotals = prepareDailyChart(y, m);
    renderInsights(y, m);
    renderBudgets(data.byCat);
    if ($donutChart || $trendChart || $dailyChart) {
      runChartAnim(750, function (p) {
        drawDonutFrame(data.byCat, data.total, p, selectedLegendCatId);
        drawTrendFrame(trendMonths, p, y, m);
        drawDailyFrame(dailyTotals, y, m, p);
      }, function () {
        drawDonutFrame(data.byCat, data.total, 1, selectedLegendCatId);
        drawTrendFrame(trendMonths, 1, y, m);
        drawDailyFrame(dailyTotals, y, m, 1);
      });
    }
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
        + '<span class="amounts' + (over ? ' over' : '') + '">' + fmtMoneyDisplay(spent) + ' / ' + fmtMoneyDisplay(limit) + (over ? ' ⚠️' : '') + '</span>'
        + '</div>'
        + '<div class="budget-bar-bg"><div class="budget-bar-fill' + (over ? ' over' : '') + '" style="width:' + pct + '%; background:' + barColor + ';"></div></div>'
        + '</div>';
    });
    $budgetList.innerHTML = html;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (w <= 0 || h <= 0) return;
    if (w < r * 2) r = w / 2;
    if (h < r * 2) r = h / 2;
    if (r <= 0) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- Monthly / yearly summary ----------
  function renderMonthlySummary() {
    var val = $summaryMonth.value;
    var y, m;
    if (val) { var p = val.split('-'); y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; }
    else { var now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
    var data = getSummaryData(y, m);

    // Daily average: for current month use days elapsed so far
    var now = new Date();
    var isCurrentMonth = (now.getFullYear() === y && now.getMonth() === m);
    var denom;
    if (isCurrentMonth) denom = Math.max(1, now.getDate());
    else denom = daysInMonth(y, m);
    var avgPerDay = denom > 0 ? data.total / denom : 0;

    var largest = data.entries.length > 0 ? data.entries.reduce(function (mx, e) { return e.amount > mx.amount ? e : mx; }, data.entries[0]) : null;
    var count = data.entries.length;
    var html = '';
    html += '<div class="summary-row"><span class="label">Transactions</span><span class="value">' + count + '</span></div>';
    html += '<div class="summary-row"><span class="label">Total spent</span><span class="value">' + fmtMoneyDisplay(data.total) + '</span></div>';
    html += '<div class="summary-row"><span class="label">Daily average' + (isCurrentMonth ? ' (so far)' : '') + '</span><span class="value">' + fmtMoneyDisplay(avgPerDay) + '</span></div>';
    if (largest) {
      var lcat = getCat(largest.categoryId);
      html += '<div class="summary-row"><span class="label">Largest expense</span><span class="value">' + fmtMoneyDisplay(largest.amount) + ' (' + lcat.emoji + ')</span></div>';
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
    html += '<div class="summary-row total"><span class="label">Year total</span><span class="value">' + fmtMoneyDisplay(yearTotal) + '</span></div>';
    html += '<div class="summary-row"><span class="label">Monthly average</span><span class="value">' + fmtMoneyDisplay(avgMonth) + '</span></div>';
    if (best && best.total > 0) {
      html += '<div class="summary-row"><span class="label">Highest month</span><span class="value">' + monthShort(new Date(year, best.month, 1)) + ' (' + fmtMoneyDisplay(best.total) + ')</span></div>';
    }
    html += '<div style="margin-top:12px;">';
    months.forEach(function (mo) {
      if (mo.total === 0) return;
      var pct = (mo.total / maxMonth) * 100;
      html += '<div class="month-bar-row">'
        + '<span class="month-name">' + monthShort(new Date(year, mo.month, 1)) + '</span>'
        + '<div class="bar-wrap"><div class="bar-fill" style="width:' + pct + '%;"></div></div>'
        + '<span class="month-amt">' + fmtMoneyDisplay(mo.total) + '</span></div>';
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
    html += '<div class="report-total">' + fmtMoneyDisplay(data.total) + '</div>';
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
        html += '<tr><td>' + r.c.emoji + ' ' + r.c.name + '</td><td>' + pctLabel(r.amt, data.total) + '</td><td>' + fmtMoneyDisplay(r.amt) + '</td></tr>';
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
        html += '<tr><td>' + c.emoji + ' ' + c.name + (over ? ' ⚠️' : '') + '</td><td>' + fmtMoneyDisplay(budgets[c.id]) + '</td><td style="color:' + (over ? 'var(--danger)' : 'inherit') + '">' + fmtMoneyDisplay(spent) + '</td></tr>';
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
        html += '<tr><td>' + day + '</td><td>' + label + '</td><td>' + fmtMoneyDisplay(e.amount) + '</td></tr>';
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
        + (budgets[c.id] ? fmtMoneyDisplay(budgets[c.id]) + '/mo' : 'No budget') + '</span>'
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
        + '<span class="entry-amt">' + fmtMoneyDisplay(r.amount) + '</span>'
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
      toast('Saved ' + fmtMoneyDisplay(entry.amount));
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

  // ---------- Entry editor (modal) ----------
  function toDateInputValue(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function fromDateInputValue(v, originalTs) {
    // Preserve original time-of-day; only change Y/M/D
    var parts = (v || '').split('-');
    if (parts.length !== 3) return originalTs;
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return originalTs;
    var orig = new Date(originalTs);
    var out = new Date(y, m, d, orig.getHours(), orig.getMinutes(), orig.getSeconds(), 0);
    return out.getTime();
  }

  function buildEditCategorySelect(selectedId) {
    var html = '';
    categories.forEach(function (c) {
      html += '<option value="' + c.id + '"' + (c.id === selectedId ? ' selected' : '') + '>' +
        c.emoji + ' ' + c.name + '</option>';
    });
    $editCategory.innerHTML = html;
  }

  function openEntryEditor(entryId) {
    var entry = null;
    for (var i = 0; i < entries.length; i++) if (entries[i].id === entryId) { entry = entries[i]; break; }
    if (!entry) return;
    editingEntryId = entryId;

    $editAmount.value = (Math.round(entry.amount * 100) / 100).toString();
    $editNote.value = entry.note || '';
    $editDate.value = toDateInputValue(entry.ts);
    buildEditCategorySelect(entry.categoryId);

    // Receipt preview
    idbGet('receipt:' + entryId).then(function (rec) {
      if (rec && rec.dataURL) {
        $receiptModalImg.src = rec.dataURL;
        $receiptModalImg.hidden = false;
        $receiptModalDelete.hidden = false;
      } else {
        $receiptModalImg.removeAttribute('src');
        $receiptModalImg.hidden = true;
        $receiptModalDelete.hidden = true;
      }
    }).catch(function () {
      $receiptModalImg.removeAttribute('src');
      $receiptModalImg.hidden = true;
      $receiptModalDelete.hidden = true;
    });

    $receiptModal.classList.add('show');
  }

  function saveEntryEdit() {
    if (!editingEntryId) return;
    var entry = null;
    for (var i = 0; i < entries.length; i++) if (entries[i].id === editingEntryId) { entry = entries[i]; break; }
    if (!entry) { $receiptModal.classList.remove('show'); return; }

    var v = parseFloat($editAmount.value);
    if (isNaN(v) || v <= 0) { toast('Enter a valid amount'); return; }
    var catId = $editCategory.value;
    if (!catId) { toast('Pick a category'); return; }

    entry.amount = Math.round(v * 100) / 100;
    entry.categoryId = catId;
    entry.note = $editNote.value.trim();
    entry.ts = fromDateInputValue($editDate.value, entry.ts);

    saveEntries();
    renderAll();
    buildYearSelect(true);
    if (currentTab === 'report') renderReport();
    $receiptModal.classList.remove('show');
    editingEntryId = null;
    toast('Changes saved');
  }

  function deleteEntryFromEditor() {
    if (!editingEntryId) return;
    var id = editingEntryId;
    if (!window.confirm('Delete this expense?')) return;
    idbDelete('receipt:' + id).catch(function () {});
    var idx = -1;
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) { idx = i; break; }
    if (idx !== -1) entries.splice(idx, 1);
    saveEntries();
    renderAll();
    buildYearSelect(true);
    if (currentTab === 'report') renderReport();
    $receiptModal.classList.remove('show');
    editingEntryId = null;
    toast('Expense deleted');
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

  // ---------- Receipt viewer / editor modal ----------
  var currentReceiptEntryId = null;
  function openReceipt(entryId) {
    // Open the full editor (which also shows the receipt)
    openEntryEditor(entryId);
  }
  $receiptModalClose.addEventListener('click', function () {
    $receiptModal.classList.remove('show');
    editingEntryId = null;
  });
  $receiptModalDelete.addEventListener('click', function () {
    if (!editingEntryId) return;
    var id = editingEntryId;
    if (!window.confirm('Delete this receipt?')) return;
    idbDelete('receipt:' + id).then(function () {
      var e = null;
      for (var i = 0; i < entries.length; i++) if (entries[i].id === id) { e = entries[i]; break; }
      if (e) { delete e.hasReceipt; saveEntries(); }
      renderAll();
      $receiptModalImg.removeAttribute('src');
      $receiptModalImg.hidden = true;
      $receiptModalDelete.hidden = true;
      toast('Receipt deleted');
    });
  });
  if ($editSaveBtn) $editSaveBtn.addEventListener('click', saveEntryEdit);
  if ($editDeleteBtn) $editDeleteBtn.addEventListener('click', deleteEntryFromEditor);

  // ---------- Bank / card import (CSV + XLSX) ----------
  var CARD_ISSUER_RE = /(chase|amex|americanexpress|discover|capital\s*one|citi|citibank|barclays|wells\s*fargo|bank\s*of\s*america|usbank|synchrony|apple\s*card)/i;
  var LOAN_SPENDING_RE = /(mortgage|home\s*loan|heloc|student\s*loan|tuition|school\s*pay|nelnet|sallie|fedloan|loan\s*pymt|loan\s*payment|auto\s*loan|car\s*loan)/i;
  var CARD_PAYMENT_TYPES = { payment: true, 'online payment': true };
  var CARD_CREDIT_TYPES = { return: true, refund: true, 'credit': true };
  var CATEGORY_ALIASES = {
    'food & drink': 'dining', 'food and drink': 'dining', 'restaurants': 'dining',
    'dining': 'dining', 'groceries': 'groceries', 'grocery': 'groceries',
    'gas': 'gas', 'gasoline': 'gas', 'fuel': 'gas',
    'shopping': 'other', 'bills': 'bills', 'utilities': 'bills',
    'entertainment': 'fun', 'fun': 'fun'
  };

  function normHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  }
  function findCol(headers, names) {
    var norm = headers.map(normHeader);
    for (var n = 0; n < names.length; n++) {
      var want = normHeader(names[n]);
      for (var i = 0; i < norm.length; i++) {
        if (norm[i] === want) return i;
      }
    }
    for (var n2 = 0; n2 < names.length; n2++) {
      var w = normHeader(names[n2]);
      for (var j = 0; j < norm.length; j++) {
        if (norm[j].indexOf(w) !== -1 || w.indexOf(norm[j]) !== -1) return j;
      }
    }
    return -1;
  }
  function parseUsDate(str) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      var dt = new Date(parseInt(m[3], 10), parseInt(m[1], 10) - 1, parseInt(m[2], 10), 12, 0, 0, 0);
      return isNaN(dt.getTime()) ? null : dt.getTime();
    }
    var iso = new Date(s.indexOf('T') === -1 ? s + 'T12:00:00' : s);
    return isNaN(iso.getTime()) ? null : iso.getTime();
  }
  function excelSerialToTs(serial) {
    var n = parseFloat(serial);
    if (isNaN(n)) return null;
    var ms = (n - 25569) * 86400000;
    var d = new Date(ms);
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  }
  function parseAmountCell(v) {
    if (v == null || v === '') return NaN;
    var s = String(v).replace(/[$,\s]/g, '');
    return parseFloat(s);
  }
  function isRowEmpty(cells) {
    if (!cells || !cells.length) return true;
    for (var i = 0; i < cells.length; i++) {
      if (String(cells[i] || '').trim()) return false;
    }
    return true;
  }

  function readU32(dv, off) { return dv.getUint32(off, true); }
  function readU16(dv, off) { return dv.getUint16(off, true); }

  function parseZipDirectory(buf) {
    var dv = new DataView(buf);
    var len = buf.byteLength;
    var eocd = -1;
    for (var i = len - 22; i >= 0; i--) {
      if (readU32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid XLSX (zip)');
    var cdCount = readU16(dv, eocd + 10);
    var cdOffset = readU32(dv, eocd + 16);
    var files = {};
    var pos = cdOffset;
    for (var c = 0; c < cdCount; c++) {
      if (readU32(dv, pos) !== 0x02014b50) break;
      var comp = readU16(dv, pos + 10);
      var compSize = readU32(dv, pos + 20);
      var uncompSize = readU32(dv, pos + 24);
      var nameLen = readU16(dv, pos + 28);
      var extraLen = readU16(dv, pos + 30);
      var commentLen = readU16(dv, pos + 32);
      var localOff = readU32(dv, pos + 42);
      var name = '';
      for (var ni = 0; ni < nameLen; ni++) name += String.fromCharCode(dv.getUint8(pos + 46 + ni));
      pos += 46 + nameLen + extraLen + commentLen;
      if (readU32(dv, localOff) !== 0x04034b50) continue;
      var locMethod = readU16(dv, localOff + 8);
      var locCompSize = readU32(dv, localOff + 18);
      var locNameLen = readU16(dv, localOff + 26);
      var locExtra = readU16(dv, localOff + 28);
      var dataStart = localOff + 30 + locNameLen + locExtra;
      var size = compSize > 0 ? compSize : locCompSize;
      if (dataStart + size > len) size = Math.max(0, len - dataStart);
      var payload = new Uint8Array(buf, dataStart, size);
      comp = locMethod || comp;
      var out;
      if (comp === 0) {
        out = payload;
      } else if (comp === 8) {
        out = null; // filled async
      } else {
        throw new Error('Unsupported zip compression in XLSX');
      }
      files[name] = { comp: comp, payload: payload, uncompSize: uncompSize };
    }
    return files;
  }

  function inflateRaw(deflated) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error('XLSX requires a browser with DecompressionStream (iOS 16.4+)'));
    }
    var input = deflated instanceof Uint8Array ? deflated : new Uint8Array(deflated);
    return new Promise(function (resolve, reject) {
      var ds = new DecompressionStream('deflate-raw');
      var reader = ds.readable.getReader();
      var chunks = [];
      function readPump() {
        reader.read().then(function (step) {
          if (step.done) {
            var total = 0;
            chunks.forEach(function (c) { total += c.length; });
            var out = new Uint8Array(total);
            var off = 0;
            chunks.forEach(function (c) { out.set(c, off); off += c.length; });
            resolve(out.buffer);
            return;
          }
          chunks.push(step.value);
          readPump();
        }).catch(reject);
      }
      readPump();
      var writer = ds.writable.getWriter();
      writer.write(input).then(function () { return writer.close(); }).catch(reject);
    });
  }

  function unzipXlsx(buf) {
    var meta = parseZipDirectory(buf);
    var names = Object.keys(meta);
    var promises = names.map(function (name) {
      var f = meta[name];
      if (f.comp === 0) return Promise.resolve({ name: name, data: f.payload });
      return inflateRaw(f.payload).then(function (ab) {
        return { name: name, data: new Uint8Array(ab) };
      });
    });
    return Promise.all(promises).then(function (parts) {
      var map = {};
      parts.forEach(function (p) { map[p.name] = p.data; });
      return map;
    });
  }

  function decodeXmlText(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  }
  function parseSharedStrings(xml) {
    var list = [];
    var re = /<si>([\s\S]*?)<\/si>/g;
    var m;
    while ((m = re.exec(xml))) {
      var chunk = m[1];
      var texts = chunk.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      var combined = '';
      texts.forEach(function (t) {
        var inner = t.replace(/<t[^>]*>/, '').replace(/<\/t>$/, '');
        combined += decodeXmlText(inner);
      });
      list.push(combined);
    }
    return list;
  }
  function colLettersToIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }
  function parseSheetXml(xml, shared) {
    var rows = [];
    var rowRe = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    var rm;
    while ((rm = rowRe.exec(xml))) {
      var rowNum = parseInt(rm[1], 10);
      var rowBody = rm[2];
      var cells = {};
      var cellRe = /<c[^>]*r="([A-Z]+)(\d+)"([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g;
      var cm;
      while ((cm = cellRe.exec(rowBody))) {
        var col = colLettersToIndex(cm[1]);
        var attrs = cm[3];
        var inner = cm[5] || '';
        var tAttr = (attrs.match(/\bt="([^"]+)"/) || [])[1];
        var vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        var val = vMatch ? decodeXmlText(vMatch[1]) : '';
        if (tAttr === 's') val = shared[parseInt(val, 10)] || '';
        else if (tAttr === 'inlineStr') {
          var t = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
          val = t ? decodeXmlText(t[1]) : '';
        }
        cells[col] = val;
      }
      var maxCol = -1;
      Object.keys(cells).forEach(function (k) { maxCol = Math.max(maxCol, parseInt(k, 10)); });
      var arr = [];
      for (var c = 0; c <= maxCol; c++) arr.push(cells[c] != null ? cells[c] : '');
      rows[rowNum - 1] = arr;
    }
    var dense = [];
    for (var r = 0; r < rows.length; r++) {
      if (rows[r]) dense.push(rows[r]);
      else if (r < rows.length) dense.push([]);
    }
    return dense.filter(function (row) { return !isRowEmpty(row); });
  }

  function parseXlsxBuffer(buf) {
    return unzipXlsx(buf).then(function (files) {
      var sheetPath = 'xl/worksheets/sheet1.xml';
      if (!files[sheetPath]) {
        var alt = Object.keys(files).filter(function (k) { return k.indexOf('xl/worksheets/') === 0 && k.endsWith('.xml'); })[0];
        if (!alt) throw new Error('No worksheet found in XLSX');
        sheetPath = alt;
      }
      var shared = [];
      if (files['xl/sharedStrings.xml']) {
        var xml = new TextDecoder().decode(files['xl/sharedStrings.xml']);
        shared = parseSharedStrings(xml);
      }
      var sheetXml = new TextDecoder().decode(files[sheetPath]);
      return parseSheetXml(sheetXml, shared);
    });
  }

  function detectImportLayout(headerRow) {
    var h = headerRow.map(normHeader);
    var hasDebit = findCol(headerRow, ['debit']) !== -1;
    var hasCredit = findCol(headerRow, ['credit']) !== -1;
    var hasType = findCol(headerRow, ['type']) !== -1;
    var hasAmt = findCol(headerRow, ['amount']) !== -1;
    var hasCat = findCol(headerRow, ['category']) !== -1;
    var hasTime = findCol(headerRow, ['time']) !== -1;
    if (hasDebit && hasCredit) return 'bank';
    if (hasType && hasAmt && findCol(headerRow, ['description']) !== -1) return 'card';
    if (hasAmt && hasCat && findCol(headerRow, ['date']) !== -1 && hasTime) return 'app-export';
    if (hasAmt && findCol(headerRow, ['date']) !== -1) return 'generic';
    return 'unknown';
  }

  function ensureCategoryId(id, name, emoji, color) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return id;
    }
    categories.push({ id: id, name: name, emoji: emoji || '📦', color: color || '#adb5bd' });
    return id;
  }
  function defaultImportCategoryId(layout) {
    ensureCategoryId('other', 'Other', '📦', '#adb5bd');
    return 'other';
  }
  function mapExternalCategory(extName, layout) {
    if (!extName) return defaultImportCategoryId(layout);
    var key = normText(extName);
    if (CATEGORY_ALIASES[key]) return CATEGORY_ALIASES[key];
    for (var i = 0; i < categories.length; i++) {
      if (normText(categories[i].name) === key) return categories[i].id;
    }
    for (var j = 0; j < categories.length; j++) {
      if (key.indexOf(normText(categories[j].name)) !== -1) return categories[j].id;
    }
    return defaultImportCategoryId(layout);
  }
  function mapAppExportCategoryName(catName) {
    if (!catName) return defaultImportCategoryId('app-export');
    var key = normText(catName);
    for (var i = 0; i < categories.length; i++) {
      if (normText(categories[i].name) === key) return categories[i].id;
    }
    return mapExternalCategory(catName, 'app-export');
  }
  function guessCategoryFromBankDescription(note) {
    var n = normText(note);
    var compact = n.replace(/\s+/g, '');
    if (/service\s*charge|overdraft|atm\s*fee|monthly\s*fee|maintenance\s*fee/.test(n)) return 'bills';
    if (LOAN_SPENDING_RE.test(n) || LOAN_SPENDING_RE.test(compact)) return 'bills';
    if (/mortgage|rent\b|hoa\b|property\s*tax/.test(n)) return 'bills';
    if (/tuition|university|college|school/.test(n)) return 'bills';
    if (/verizon|at&t|att|t-?mobile|comcast|xfinity|spectrum|utility|electric|water\s*bill|pg&e|coned/.test(n)) return 'bills';
    if (/payroll|direct\s*dep|salary/.test(n)) return defaultImportCategoryId('bank');
    return defaultImportCategoryId('bank');
  }
  function categoryForImportRow(layout, extCatName, note) {
    if (layout === 'bank') {
      var guess = guessCategoryFromBankDescription(note);
      if (guess !== defaultImportCategoryId('bank') || !extCatName) return guess;
      return defaultImportCategoryId('bank');
    }
    if (layout === 'card') return mapExternalCategory(extCatName, layout);
    return mapExternalCategory(extCatName, layout);
  }
  function compactTransferText(desc) {
    return normText(desc).replace(/\s+/g, '');
  }
  function isLoanOrMortgageSpending(desc) {
    var n = normText(desc);
    var c = compactTransferText(desc);
    if (LOAN_SPENDING_RE.test(n)) return true;
    if (/studentloan|mortgagepymt|homeloan|autoloan|carloan/.test(c)) return true;
    return false;
  }
  function isCardBillAutopayTransfer(desc) {
    if (!desc) return false;
    if (isLoanOrMortgageSpending(desc)) return false;
    var n = normText(desc);
    var c = compactTransferText(desc);
    if (/\bvenmo\b/.test(n)) return false;
    if (/epayment|e-?payment/.test(c) && /(crd|card|credit|chase|amex|visa|discover|autopay)/.test(c)) return true;
    if (/autopay/.test(c) && (/(crd|card|credit)/.test(c) || CARD_ISSUER_RE.test(n))) return true;
    if (/crdautopay|creditautopay|creditcrd|cardpymt|cardpayment|cardpmt|ccpayment|ccpmt|creditcardpymt/.test(c)) return true;
    if (/(crd|card).*(autopay|pymt|pmt|payment)/.test(c) || /(autopay|pymt|pmt).*(crd|card)/.test(c)) return true;
    if (CARD_ISSUER_RE.test(n) && /(autopay|epayment|e-?payment|crdpymt|crdpmt|creditcrd)/.test(c)) return true;
    if (/\bpayment\b/.test(n) && /\b(credit|crd|card)\b/.test(n) && CARD_ISSUER_RE.test(n)) return true;
    return false;
  }
  function importSourceKind(layout) {
    if (layout === 'card') return 'card';
    if (layout === 'bank') return 'bank';
    if (layout === 'app-export') return 'app';
    return layout || 'generic';
  }
  function importContentKey(layout, ts, amount, note, categoryId) {
    if (layout === 'app-export') {
      return 'app|' + entryDedupeKey({ id: null, ts: ts, amount: amount, categoryId: categoryId, note: note || '' });
    }
    return importSourceKind(layout) + '|' + dayKey(ts) + '|' + fmtMoney(amount) + '|' + descriptionMatchKey(note);
  }

  function findImportRule(note) {
    var key = descriptionMatchKey(note);
    for (var i = importRules.length - 1; i >= 0; i--) {
      var r = importRules[i];
      if (!r.pattern) continue;
      if (key.indexOf(r.pattern) !== -1 || r.pattern.indexOf(key) !== -1) return r;
    }
    return null;
  }

  function isBuiltInTransfer(desc, type, layout) {
    var t = normText(type);
    if (layout === 'card') {
      if (CARD_PAYMENT_TYPES[t] && !importSettings.countCardPayments) return true;
    }
    if (layout === 'bank' && isCardBillAutopayTransfer(desc)) return true;
    var note = normText(desc);
    if (!note) return false;
    if (/\bvenmo\b/.test(note)) return false;
    if (/\btransfer\s*to\s*savings\b/.test(note) || /\bxfer\b/.test(note)) return true;
    if (/\bonline\s*payment\b/.test(note) && /\b(credit|card|crd)\b/.test(note)) return true;
    if (/\bpayment\s*thank\s*you\b/.test(note)) return true;
    return false;
  }

  function buildExistingContentCounts(layout) {
    var counts = {};
    entries.forEach(function (e) {
      var ck = importContentKey(layout, e.ts, e.amount, e.note || '', e.categoryId);
      counts[ck] = (counts[ck] || 0) + 1;
    });
    return counts;
  }

  function rowsFromTable(dataRows, headerRow, layout, batchId) {
    var contentCounts = buildExistingContentCounts(layout);
    var fileRowCounts = {};
    var out = [];
    var dateIdx = findCol(headerRow, ['transaction date', 'post date', 'date']);
    var postIdx = findCol(headerRow, ['post date']);
    var descIdx = findCol(headerRow, ['description', 'payee', 'merchant', 'note']);
    var amtIdx = findCol(headerRow, ['amount']);
    var typeIdx = findCol(headerRow, ['type']);
    var catIdx = findCol(headerRow, ['category']);
    var timeIdx = findCol(headerRow, ['time']);
    var debitIdx = findCol(headerRow, ['debit']);
    var creditIdx = findCol(headerRow, ['credit']);
    var statusIdx = findCol(headerRow, ['status']);

    for (var ri = 0; ri < dataRows.length; ri++) {
      var cols = dataRows[ri];
      if (isRowEmpty(cols)) continue;
      var first = normText(cols[0]);
      if (first === 'total' || first === 'subtotal') continue;

      var status = statusIdx !== -1 ? normText(cols[statusIdx]) : '';
      if (status === 'pending') {
        out.push({ status: 'pending', reason: 'Pending (not posted yet)', raw: cols });
        continue;
      }

      var desc = descIdx !== -1 ? cols[descIdx] : '';
      var note = layout === 'app-export' ? String(desc || '').trim() : cleanImportNote(desc);
      var typeVal = typeIdx !== -1 ? cols[typeIdx] : '';
      var ts = null;
      var amount = NaN;
      var skipReason = null;
      var rowStatus = 'import';

      if (layout === 'bank') {
        var dateCell = postIdx !== -1 ? cols[postIdx] : (dateIdx !== -1 ? cols[dateIdx] : '');
        ts = /^\d+(\.\d+)?$/.test(String(dateCell).trim()) ? excelSerialToTs(dateCell) : parseUsDate(dateCell);
        var debit = debitIdx !== -1 ? parseAmountCell(cols[debitIdx]) : NaN;
        var credit = creditIdx !== -1 ? parseAmountCell(cols[creditIdx]) : NaN;
        if (!isNaN(debit) && debit > 0) amount = debit;
        else if (!isNaN(credit) && credit > 0) {
          out.push({ status: 'credit', reason: 'Credit / deposit (not spending)', note: note, amount: credit, ts: ts });
          continue;
        } else {
          out.push({ status: 'unreadable', reason: 'No debit amount', raw: cols });
          continue;
        }
      } else if (layout === 'card') {
        var dcell = dateIdx !== -1 ? cols[dateIdx] : '';
        ts = parseUsDate(dcell);
        var rawAmt = amtIdx !== -1 ? parseAmountCell(cols[amtIdx]) : NaN;
        var tnorm = normText(typeVal);
        if (CARD_PAYMENT_TYPES[tnorm] && !importSettings.countCardPayments) {
          var payAmt = Math.abs(rawAmt);
          if (!isNaN(payAmt) && payAmt > 0) {
            out.push({
              status: 'transfer', reason: 'Card bill payment', note: note, amount: payAmt, ts: ts,
              categoryId: categoryForImportRow('card', catIdx !== -1 ? cols[catIdx] : '', note),
              isTransfer: true, include: false, layout: 'card',
              initialIsTransfer: true, userSetCategory: false, userSetTransfer: false
            });
            continue;
          }
        }
        if (tnorm === 'return' || tnorm === 'refund') {
          out.push({ status: 'credit', reason: 'Card refund/return (not spending)', note: note, amount: Math.abs(rawAmt), ts: ts });
          continue;
        }
        if (!isNaN(rawAmt) && rawAmt > 0 && tnorm !== 'sale' && tnorm !== 'fee' && tnorm !== 'adjustment') {
          out.push({ status: 'credit', reason: 'Credit/adjustment on card', note: note, amount: rawAmt, ts: ts });
          continue;
        }
        if (isNaN(rawAmt)) {
          out.push({ status: 'unreadable', reason: 'Missing amount', raw: cols });
          continue;
        }
        amount = Math.abs(rawAmt);
        if (rawAmt > 0 && tnorm === 'sale') {
          out.push({ status: 'unreadable', reason: 'Unexpected positive sale amount', raw: cols });
          continue;
        }
      } else {
        ts = dateIdx !== -1 ? parseUsDate(cols[dateIdx]) : null;
        if (dateIdx !== -1 && timeIdx !== -1 && cols[dateIdx] && cols[timeIdx]) {
          var dt = new Date(cols[dateIdx] + 'T' + cols[timeIdx] + ':00');
          if (!isNaN(dt.getTime())) ts = dt.getTime();
        }
        amount = amtIdx !== -1 ? parseAmountCell(cols[amtIdx]) : NaN;
        if (isNaN(amount) || amount <= 0) {
          out.push({ status: 'unreadable', reason: 'Invalid or non-positive amount', raw: cols });
          continue;
        }
      }

      var appExportCatId = null;
      if (layout === 'app-export' && catIdx !== -1) {
        appExportCatId = mapAppExportCategoryName((cols[catIdx] || '').trim());
      }

      if (!ts) {
        out.push({ status: 'unreadable', reason: 'Could not parse date', note: note });
        continue;
      }
      if (isNaN(amount) || amount <= 0) {
        out.push({ status: 'unreadable', reason: 'Invalid amount', note: note });
        continue;
      }
      amount = Math.round(amount * 100) / 100;

      var rule = findImportRule(note);
      var isTransfer = rule && rule.isTransfer;
      if (rule && rule.countAsSpending) isTransfer = false;
      if (!rule && isBuiltInTransfer(note, typeVal, layout)) isTransfer = true;
      if (rule && rule.categoryId && !rule.isTransfer) {
        // category from rule applied later
      }

      var postDate = postIdx !== -1 && postIdx !== dateIdx ? String(cols[postIdx] || '') : '';
      var rowKey = importRowKey([layout, dayKey(ts), fmtMoney(amount), descriptionMatchKey(note), normText(typeVal), postDate, String(ri)]);

      var catId = appExportCatId || categoryForImportRow(layout, catIdx !== -1 ? cols[catIdx] : '', note);
      if (rule && rule.categoryId && !rule.isTransfer) catId = rule.categoryId;

      var contentKey = importContentKey(layout, ts, amount, note, catId);
      fileRowCounts[contentKey] = (fileRowCounts[contentKey] || 0) + 1;
      var occurrence = fileRowCounts[contentKey];
      var existingN = contentCounts[contentKey] || 0;
      if (occurrence <= existingN) {
        out.push({
          status: 'duplicate',
          reason: 'Already in your log (overlapping statement)',
          note: note, amount: amount, ts: ts, contentKey: contentKey
        });
        continue;
      }
      contentCounts[contentKey] = existingN + 1;

      if (isTransfer) {
        out.push({
          status: 'transfer', reason: 'Transfer between accounts', note: note, amount: amount, ts: ts,
          categoryId: catId, importRowKey: rowKey, isTransfer: true, include: false,
          layout: layout, suggestedCategoryId: catId, initialCategoryId: catId,
          initialIsTransfer: true, userSetCategory: false, userSetTransfer: false
        });
        continue;
      }

      out.push({
        status: 'import', note: note, amount: amount, ts: ts, categoryId: catId,
        importRowKey: rowKey, isTransfer: false, include: true,
        typeVal: typeVal, layout: layout, contentKey: contentKey,
        suggestedCategoryId: catId, initialCategoryId: catId, initialIsTransfer: false,
        userSetCategory: false, userSetTransfer: false
      });
    }
    return out;
  }

  function summarizeImportRows(rows) {
    var counts = { import: 0, duplicate: 0, transfer: 0, credit: 0, pending: 0, unreadable: 0 };
    rows.forEach(function (r) { if (counts[r.status] != null) counts[r.status]++; });
    return counts;
  }

  function renderImportReview() {
    if (!pendingImport) return;
    var rows = pendingImport.rows;
    var counts = summarizeImportRows(rows);
    var html = '<div class="import-stats">';
    html += '<div class="import-stat"><strong>' + counts.import + '</strong><span>to import</span></div>';
    html += '<div class="import-stat"><strong>' + counts.duplicate + '</strong><span>duplicates</span></div>';
    html += '<div class="import-stat"><strong>' + counts.transfer + '</strong><span>transfers</span></div>';
    html += '<div class="import-stat"><strong>' + counts.credit + '</strong><span>credits skipped</span></div>';
    html += '<div class="import-stat"><strong>' + counts.pending + '</strong><span>pending</span></div>';
    html += '<div class="import-stat"><strong>' + counts.unreadable + '</strong><span>unreadable</span></div>';
    html += '</div>';
    html += '<p class="hint">Transfers are payments between your accounts (e.g. card autopay). Toggle per row or change category — we remember your choices.</p>';
    $importSummary.innerHTML = html;

    var listHtml = '';
    var importIdx = 0;
    rows.forEach(function (r, i) {
      if (r.status !== 'import' && r.status !== 'transfer') return;
      importIdx++;
      var d = r.ts ? new Date(r.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
      var catOpts = '';
      categories.forEach(function (c) {
        catOpts += '<option value="' + c.id + '"' + (c.id === r.categoryId ? ' selected' : '') + '>' + c.emoji + ' ' + c.name + '</option>';
      });
      listHtml += '<div class="import-row' + (r.status === 'transfer' ? ' is-transfer' : '') + '" data-idx="' + i + '">';
      listHtml += '<div class="import-row-top"><span class="import-row-date">' + d + '</span>';
      listHtml += '<span class="import-row-amt">' + fmtMoneyDisplay(r.amount) + '</span></div>';
      listHtml += '<div class="import-row-note">' + (r.note || '(no description)') + '</div>';
      listHtml += '<div class="import-row-actions">';
      listHtml += '<select class="import-cat-select" data-idx="' + i + '">' + catOpts + '</select>';
      listHtml += '<label class="check-row import-transfer-toggle"><input type="checkbox" data-transfer="' + i + '"' + (r.isTransfer ? ' checked' : '') + '><span>Transfer</span></label>';
      listHtml += '</div></div>';
    });
    if (!listHtml) listHtml = '<div class="empty">No rows to import. Skipped items are counted above.</div>';
    $importRowList.innerHTML = listHtml;

    Array.prototype.forEach.call($importRowList.querySelectorAll('.import-cat-select'), function (sel) {
      sel.addEventListener('change', function () {
        var idx = parseInt(sel.dataset.idx, 10);
        var row = pendingImport.rows[idx];
        row.categoryId = sel.value;
        row.userSetCategory = sel.value !== row.initialCategoryId;
      });
    });
    Array.prototype.forEach.call($importRowList.querySelectorAll('[data-transfer]'), function (cb) {
      cb.addEventListener('change', function () {
        var idx = parseInt(cb.dataset.transfer, 10);
        var row = pendingImport.rows[idx];
        row.isTransfer = cb.checked;
        row.status = cb.checked ? 'transfer' : 'import';
        row.include = !cb.checked;
        row.userSetTransfer = cb.checked !== row.initialIsTransfer;
        cb.closest('.import-row').classList.toggle('is-transfer', cb.checked);
      });
    });
    $importModal.classList.add('show');
  }

  function learnFromImportRow(row) {
    if (!row.userSetCategory && !row.userSetTransfer) return;
    if (!row.note) return;
    var pattern = descriptionMatchKey(row.note);
    if (!pattern || pattern.length < 4) return;
    var existing = null;
    for (var i = 0; i < importRules.length; i++) {
      if (importRules[i].pattern === pattern) { existing = importRules[i]; break; }
    }
    var rule = existing || { id: uid(), pattern: pattern };
    rule.categoryId = row.categoryId;
    rule.isTransfer = !!row.isTransfer;
    rule.countAsSpending = row.isTransfer ? false : !!rule.countAsSpending;
    if (!existing) importRules.push(rule);
    saveImportRules();
  }

  function commitImport() {
    if (!pendingImport) return;
    var batchId = pendingImport.batchId;
    var rows = pendingImport.rows;
    var added = 0;
    var dup = 0;
    var skippedTransfer = 0;
    var skippedCredit = 0;
    var skippedPending = 0;
    var skippedBad = 0;
    rows.forEach(function (r) {
      if (r.status === 'duplicate') { dup++; return; }
      if (r.status === 'credit') { skippedCredit++; return; }
      if (r.status === 'pending') { skippedPending++; return; }
      if (r.status === 'unreadable') { skippedBad++; return; }
      if (r.status === 'transfer' || (r.isTransfer && !r.include)) {
        skippedTransfer++;
        if (r.userSetTransfer || r.userSetCategory) learnFromImportRow(r);
        return;
      }
      if (r.status !== 'import' || !r.include) return;
      if (r.userSetTransfer || r.userSetCategory) learnFromImportRow(r);
      entries.push({
        id: uid(),
        amount: r.amount,
        categoryId: r.categoryId,
        note: r.note || '',
        ts: r.ts,
        importBatchId: batchId,
        importRowKey: r.importRowKey,
        importSource: importSourceKind(r.layout)
      });
      added++;
    });
    saveEntries();
    saveCategories();
    renderAll(); rebuildFilterDropdowns();
    renderCategoryList(); buildYearSelect(true); renderReport();
    $importModal.classList.remove('show');
    pendingImport = null;
    var parts = [added + ' new'];
    if (dup) parts.push(dup + ' duplicates');
    if (skippedTransfer) parts.push(skippedTransfer + ' transfers');
    if (skippedCredit) parts.push(skippedCredit + ' credits');
    if (skippedPending) parts.push(skippedPending + ' pending');
    if (skippedBad) parts.push(skippedBad + ' unreadable');
    toast('Imported ' + parts.join(', '));
  }

  function startImportReview(rows, batchId, fileName) {
    pendingImport = { batchId: batchId, rows: rows, fileName: fileName };
    renderImportReview();
  }

  function parseTableFromCsvText(text) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    if (lines.length < 2) throw new Error('File appears empty');
    var table = lines.map(function (line) { return parseCSVLine(line); });
    return table;
  }

  function processImportTable(table, batchId, fileName) {
    var header = table[0];
    var layout = detectImportLayout(header);
    if (layout === 'unknown') {
      toast('Unrecognized file layout — check column headers');
      return;
    }
    var dataRows = table.slice(1);
    var rows = rowsFromTable(dataRows, header, layout, batchId);
    startImportReview(rows, batchId, fileName);
  }

  function handleImportFile(file) {
    if (!file) return;
    var name = (file.name || '').toLowerCase();
    if (name.endsWith('.xls')) {
      toast('.xls files are not supported — export as .xlsx or CSV from your bank');
      return;
    }
    if (name.endsWith('.xlsx')) {
      file.arrayBuffer().then(function (buf) {
        var batchId = importBatchIdFromBytes(new Uint8Array(buf));
        return parseXlsxBuffer(buf).then(function (table) {
          if (table.length < 2) { toast('Spreadsheet appears empty'); return; }
          processImportTable(table, batchId, file.name);
        });
      }).catch(function (err) {
        toast(err.message || 'Could not read Excel file');
      });
      return;
    }
    if (name.endsWith('.csv') || file.type.indexOf('csv') !== -1 || file.type.indexOf('text') !== -1) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var text = e.target.result;
          var batchId = importBatchIdFromBytes(text);
          var table = parseTableFromCsvText(text);
          processImportTable(table, batchId, file.name);
        } catch (err) {
          toast(err.message || 'Error parsing CSV');
        }
      };
      reader.readAsText(file);
      return;
    }
    toast('Use a .csv or .xlsx file');
  }

  function renderImportRulesList() {
    if (!$importRulesList) return;
    if (importRules.length === 0) {
      $importRulesList.innerHTML = '<div class="empty">No import rules yet. Change a category or mark a transfer during import to create one.</div>';
      return;
    }
    var html = '';
    importRules.forEach(function (r) {
      var cat = r.categoryId ? getCat(r.categoryId).name : '—';
      html += '<div class="entry import-rule" style="padding:10px 0;">';
      html += '<div class="entry-info"><div class="top"><span style="font-weight:600;font-size:13px;">' + r.pattern + '</span></div>';
      html += '<div class="note">' + (r.isTransfer ? 'Transfer' : cat) + '</div></div>';
      html += '<button class="del-btn" type="button" data-del-rule="' + r.id + '">✕</button></div>';
    });
    $importRulesList.innerHTML = html;
    Array.prototype.forEach.call($importRulesList.querySelectorAll('[data-del-rule]'), function (btn) {
      btn.addEventListener('click', function () {
        importRules = importRules.filter(function (x) { return x.id !== btn.dataset.delRule; });
        saveImportRules();
        renderImportRulesList();
      });
    });
  }

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
    var filename = 'expenses-' + localDateStamp() + '.csv';
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
      var filename = 'expense-backup-' + localDateStamp() + '.json';
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
  $('importCsvBtn').addEventListener('click', function () { $importFileInput.click(); });
  if ($importCancelBtn) {
    $importCancelBtn.addEventListener('click', function () {
      pendingImport = null;
      $importModal.classList.remove('show');
    });
  }
  if ($importConfirmBtn) {
    $importConfirmBtn.addEventListener('click', commitImport);
  }
  var $countCardPayments = $('countCardPayments');
  if ($countCardPayments) {
    $countCardPayments.addEventListener('change', function () {
      importSettings.countCardPayments = $countCardPayments.checked;
      saveImportSettings();
    });
  }

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
    var alreadyCount = 0;

    if (Array.isArray(data.categories) && data.categories.length > 0) {
      var ids = {};
      categories.forEach(function (c) { ids[c.id] = true; });
      data.categories.forEach(function (c) {
        if (c && c.id && c.name && !ids[c.id]) { categories.push(c); ids[c.id] = true; }
      });
    }

    if (Array.isArray(data.entries)) {
      // Build lookup of existing entries by id and by content key
      var existingById = {};
      var existingByKey = {};
      entries.forEach(function (e) {
        if (e.id) existingById[e.id] = true;
        existingByKey[entryDedupeKey(e)] = true;
      });
      data.entries.forEach(function (e) {
        if (!e || typeof e.amount !== 'number' || !e.categoryId) return;
        if (!categories.some(function (c) { return c.id === e.categoryId; })) {
          categories.push({ id: e.categoryId, name: e.categoryId, emoji: '📦', color: '#adb5bd' });
        }
        var dup = false;
        if (e.id && existingById[e.id]) dup = true;
        if (!dup) {
          // content key based on non-id fields
          var key = entryDedupeKey({ id: null, ts: e.ts, amount: e.amount, categoryId: e.categoryId, note: e.note });
          if (existingByKey[key]) dup = true;
        }
        if (dup) { alreadyCount++; return; }
        entries.push(e);
        if (e.id) existingById[e.id] = true;
        existingByKey[entryDedupeKey({ id: null, ts: e.ts, amount: e.amount, categoryId: e.categoryId, note: e.note })] = true;
        importedCount++;
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
                var e = null;
                for (var i = 0; i < entries.length; i++) if (entries[i].id === entryId) { e = entries[i]; break; }
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
      var msg = importedCount + ' new, ' + alreadyCount + ' already present';
      if (receiptCount) msg += ', ' + receiptCount + ' receipts';
      toast('Imported ' + msg);
    });
  }

  if ($importFileInput) {
    $importFileInput.addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (f) handleImportFile(f);
      ev.target.value = '';
    });
  }

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
      localStorage.removeItem(IMPORT_RULES_KEY);
      localStorage.removeItem(IMPORT_SETTINGS_KEY);
    } catch (e) {}
    importRules = [];
    importSettings = { countCardPayments: false };
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
      renderImportRulesList();
      if ($countCardPayments) $countCardPayments.checked = importSettings.countCardPayments;
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
    $togglePinBtn.textContent = 'Off';
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
  [$budgetModal, $catModal, $receiptModal, $pinModal, $importModal].forEach(function (ov) {
    if (!ov) return;
    ov.addEventListener('click', function (e) {
      if (e.target === ov) {
        ov.classList.remove('show');
        if (ov === $receiptModal) editingEntryId = null;
        if (ov === $importModal) pendingImport = null;
      }
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
  var swReloading = false;
  var SW_RELOAD_GUARD = 'expenseLogger.swReloadGuard';

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!navigator.serviceWorker.controller || swReloading) return;
      if (sessionStorage.getItem(SW_RELOAD_GUARD) === '1') {
        sessionStorage.removeItem(SW_RELOAD_GUARD);
        return;
      }
      swReloading = true;
      sessionStorage.setItem(SW_RELOAD_GUARD, '1');
      window.location.reload();
    });

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      if (reg.update) reg.update();
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage('SKIP_WAITING');
          }
        });
      });
      if (reg.waiting && navigator.serviceWorker.controller) {
        reg.waiting.postMessage('SKIP_WAITING');
      }
    }).catch(function () {});
  }

  registerSW();

  // ---------- Boot ----------
  categories = loadCategories();
  budgets = loadBudgets();
  recurringItems = loadRecurring();
  importRules = loadImportRules();
  importSettings = loadImportSettings();
  if ($countCardPayments) $countCardPayments.checked = importSettings.countCardPayments;
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

  // Passcode label derived from stored state
  $togglePinBtn.textContent = getStoredPin() ? 'On' : 'Off';

  if (getStoredPin()) showLock();
  else showApp();

  switchTab(currentTab);

})();