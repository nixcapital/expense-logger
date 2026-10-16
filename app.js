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
  var META_KEY            = 'expenseLogger.meta.v1';
  var ACCOUNTS_KEY        = 'expenseLogger.accounts.v1';
  var TRANSFER_PAIRS_KEY  = 'expenseLogger.transferPairs.v1';
  var TRANSFER_UNLINK_KEY = 'expenseLogger.transferUnlink.v1';
  var IMPORT_ACCOUNT_PREFS_KEY = 'expenseLogger.importAccountPrefs.v1';
  var TRANSFER_PATTERNS_KEY = 'expenseLogger.transferPatterns.v1';
  var FORECAST_OVERRIDES_KEY = 'expenseLogger.forecastOverrides.v1';

  var APP_VERSION = '1.7.0';
  var BACKUP_FORMAT = 2;
  var BACKUP_FORMAT_LEGACY = 1;
  var DEFAULT_ACCOUNT_CHECKING = 'acct-checking';
  var DEFAULT_ACCOUNT_CHASE = 'acct-chase';
  var MS_DAY = 86400000;
  var BACKUP_NUDGE_AFTER_DAYS = 30;
  var BACKUP_NUDGE_MIN_ENTRIES = 50;
  var BACKUP_NUDGE_HIDE_DAYS = 14;
  var EI = window.ExpenseIcons;

  function iconBadge(cat, size) {
    return EI ? EI.badgeHTML(cat, { size: size || 'md' }) : '';
  }
  function uiIcon(id, size) {
    return EI ? EI.uiIconHTML(id, { size: size || 'md' }) : '';
  }
  function escHtml(s) {
    return EI ? EI.escHtml(s) : String(s);
  }
  function catPillHTML(cat) {
    return '<span class="cat-pill cat-pill--icon" style="color:' + cat.color + '; border-color:' + cat.color + '55;">'
      + iconBadge(cat, 'xs') + '<span>' + escHtml(cat.name) + '</span></span>';
  }
  var lastSavedEntryId = null;
  function playCatIcon(node) {
    if (EI && EI.playIconAnimation) EI.playIconAnimation(node);
  }
  function refreshIconObservers(root) {
    if (EI && EI.scanBadgesForReveal) EI.scanBadgesForReveal(root || document);
  }

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
    { id: 'groceries', name: 'Groceries', emoji: '🛒', icon: 'shopping-cart', color: '#4dabf7' },
    { id: 'dining',    name: 'Dining',    emoji: '🍽️', icon: 'utensils', color: '#ff922b' },
    { id: 'gas',       name: 'Gas',       emoji: '⛽', icon: 'fuel', color: '#51cf66' },
    { id: 'bills',     name: 'Bills',     emoji: '📄', icon: 'receipt', color: '#cc5de8' },
    { id: 'fun',       name: 'Fun',       emoji: '🎉', icon: 'ticket', color: '#f783ac' },
    { id: 'other',     name: 'Other',     emoji: '📦', icon: 'boxes', color: '#878e96' },
    { id: 'income',    name: 'Income',    emoji: '💵', icon: 'circle-dot', color: '#34C77B' }
  ];

  var INCOME_CATEGORY_ID = 'income';

  // ---------- State ----------
  var entries = [];
  var categories = [];
  var budgets = {};
  var recurringItems = [];
  var selectedCat = null;
  var currentTab = 'summary';
  var tabBeforeAdd = 'summary';
  var addEntryDate = null;
  var pendingDelete = null;
  var pendingRestoreUndo = null;
  var pendingBackupRestore = null;
  var undoTimer = null;
  var storagePersistStatus = 'unknown';
  var editingCategoryId = null;
  var selectedIconId = 'boxes';
  var selectedColor = '#adb5bd';
  var pendingReceiptBlob = null; // { id, blob } not yet attached
  var editingEntryId = null;     // id of entry being edited (modal)
  var importRules = [];
  var importSettings = { countCardPayments: false };
  var pendingImport = null;      // { batchId, rows, fileName, accountId, layout }
  var pendingImportAccount = null; // pre-review: { batchId, rows, fileName, layout, rowCount }
  var accounts = [];
  var transferPairs = [];
  var transferUnlinkKeys = [];
  var importAccountPrefs = {};
  var selectedAddAccountId = '';
  var newAccountType = 'bank';
  var importAccountPickId = null;
  var viewingTransferPairId = null;
  var transferPatterns = [];
  var forecastChartDays = 60;
  var lastForecastSim = null;
  var forecastScreenOpen = false;
  var balanceSheetAccountId = null;
  var viewingOtherTransferEntryId = null;
  var forecastOverrides = {};
  var lastForecastSchedules = [];
  var editingForecastItemKey = null;
  var editingForecastItemMeta = null;
  var editingForecastOccurrenceTs = null;
  var FC = window.ExpenseForecast;

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
  var $filterType = $('filterType');
  var $filterSort = $('filterSort');
  var $activityFilterBtn = $('activityFilterBtn');
  var $activityFilterModal = $('activityFilterModal');
  var $activityFilterDoneBtn = $('activityFilterDoneBtn');
  var $activitySummaryRange = $('activitySummaryRange');
  var $activitySummaryTotal = $('activitySummaryTotal');
  var $activitySummaryCount = $('activitySummaryCount');
  var $activitySummaryAvg = $('activitySummaryAvg');
  var $activityAccountSegments = $('activityAccountSegments');
  var $importAccountModal = $('importAccountModal');
  var $importAccountList = $('importAccountList');
  var $importAccountFileMeta = $('importAccountFileMeta');
  var $importAccountHint = $('importAccountHint');
  var $importAccountContinueBtn = $('importAccountContinueBtn');
  var $addAccountModal = $('addAccountModal');
  var $newAccountName = $('newAccountName');
  var $addAccountCancelBtn = $('addAccountCancelBtn');
  var $addAccountSaveBtn = $('addAccountSaveBtn');
  var $addAccountRow = $('addAccountRow');
  var $addAccountPreview = $('addAccountPreview');
  var $addAccountRowIcon = $('addAccountRowIcon');
  var $addAccountSelect = $('addAccountSelect');
  var $editAccount = $('editAccount');
  var $transferDetailView = $('transferDetailView');
  var $transferDetailBody = $('transferDetailBody');
  var $transferDetailBackBtn = $('transferDetailBackBtn');

  var ACTIVITY_RANGE_IDS = ['this-month', 'last-month', '3-months', 'year', 'all'];

  var $tabBar = $('tabBar');
  var $budgetModal = $('budgetModal');
  var $catModal = $('catModal');
  var $catModalTitle = $('catModalTitle');
  var $catNameInput = $('catNameInput');
  var $iconPicker = $('iconPicker');
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
  var $storageStatusLine = $('storageStatusLine');
  var $lastBackupLine = $('lastBackupLine');
  var $backupReminderLine = $('backupReminderLine');
  var $homeBackupNudge = $('homeBackupNudge');
  var $backupRestoreModal = $('backupRestoreModal');
  var $backupRestoreSummary = $('backupRestoreSummary');
  var $backupRestoreCancelBtn = $('backupRestoreCancelBtn');
  var $backupRestoreConfirmBtn = $('backupRestoreConfirmBtn');
  var $importFileInput = $('importFileInput');
  var $importModal = $('importModal');
  var $importSummary = $('importSummary');
  var $importRowList = $('importRowList');
  var $importConfirmBtn = $('importConfirmBtn');
  var $importCancelBtn = $('importCancelBtn');
  var $importRulesList = $('importRulesList');

  var $splashScreen = $('splashScreen');
  var $addSheet = $('addSheet');
  var $addCancelBtn = $('addCancelBtn');
  var $addDate = $('addDate');
  var $addDatePreview = $('addDatePreview');
  var $addNoteRow = $('addNoteRow');
  var $addNotePreview = $('addNotePreview');
  var $addDateRow = $('addDateRow');
  var $heroBudgetWrap = $('heroBudgetWrap');
  var $heroBudgetFill = $('heroBudgetFill');
  var $heroBudgetPct = $('heroBudgetPct');
  var $heroBudgetMeta = $('heroBudgetMeta');
  var $heroBudgetPace = $('heroBudgetPace');
  var $summaryMonthPillLabel = $('summaryMonthPillLabel');
  var $reportMonthPillLabel = $('reportMonthPillLabel');
  var $homeRecapCard = $('homeRecapCard');
  var $homeRecapBtn = $('homeRecapBtn');
  var $homeRecapText = $('homeRecapText');
  var $wrappedModal = $('wrappedModal');
  var $wrappedStories = $('wrappedStories');
  var $wrappedEmpty = $('wrappedEmpty');
  var $wrappedCloseBtn = $('wrappedCloseBtn');
  var $wrappedShareBtn = $('wrappedShareBtn');
  var $wrappedDoneBtn = $('wrappedDoneBtn');
  var $wrappedSlides = $('wrappedSlides');
  var $wrappedProgress = $('wrappedProgress');
  var $wrappedTopTitle = $('wrappedTopTitle');
  var $wrappedFooterHint = $('wrappedFooterHint');
  var $wrappedSummaryActions = $('wrappedSummaryActions');
  var $wrappedShareNote = $('wrappedShareNote');
  var $wrappedTapBack = $('wrappedTapBack');
  var $wrappedTapNext = $('wrappedTapNext');
  var $wrappedTapZones = $('wrappedTapZones');
  var EW = window.ExpenseWrapped;
  var $openWrappedBtn = $('openWrappedBtn');

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
  function hexDarken(hex, amt) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6) return hex;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
    return 'rgb(' + Math.round(r * (1 - amt)) + ',' + Math.round(g * (1 - amt)) + ',' + Math.round(b * (1 - amt)) + ')';
  }

  function donutSegmentColor(hex) {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return hexDarken(hex, 0.28);
    }
    return hex;
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
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        tab: currentTab === 'add' ? tabBeforeAdd : currentTab,
        dismissedWrapped: uiState.dismissedWrapped || {},
        reportChartMonths: uiState.reportChartMonths === 12 ? 12 : 6,
        reportTxSort: uiState.reportTxSort || 'latest',
        activityRange: normalizeActivityRangeId(uiState.activityRange),
        activityAccountId: uiState.activityAccountId || ''
      }));
    } catch (e) {}
  }
  var uiState = { dismissedWrapped: {}, reportChartMonths: 6, reportTxSort: 'latest', activityRange: 'this-month', activityAccountId: '' };
  function normalizeActivityRangeId(id) {
    if (ACTIVITY_RANGE_IDS.indexOf(id) !== -1) return id;
    return 'this-month';
  }
  function loadUI() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (raw) {
        var p = JSON.parse(raw) || {};
        if (p.dismissedWrapped) uiState.dismissedWrapped = p.dismissedWrapped;
        if (p.reportChartMonths === 12) uiState.reportChartMonths = 12;
        else if (p.reportChartMonths === 6) uiState.reportChartMonths = 6;
        if (p.reportTxSort === 'latest' || p.reportTxSort === 'largest' || p.reportTxSort === 'recurring') {
          uiState.reportTxSort = p.reportTxSort;
        }
        uiState.activityRange = normalizeActivityRangeId(p.activityRange);
        if (typeof p.activityAccountId === 'string') uiState.activityAccountId = p.activityAccountId;
        return p;
      }
    } catch (e) {}
    return {};
  }

  function loadMetaObj() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch (e) {}
    return {};
  }
  function saveMetaObj(obj) {
    try { localStorage.setItem(META_KEY, JSON.stringify(obj || {})); } catch (e) {}
  }

  var DEFAULT_ACCOUNTS = [
    { id: DEFAULT_ACCOUNT_CHECKING, name: 'Checking', type: 'bank', color: '#20C997' },
    { id: DEFAULT_ACCOUNT_CHASE, name: 'Chase card', type: 'credit_card', color: '#748FFC' }
  ];

  function ensureDefaultAccounts() {
    if (accounts.length > 0) return;
    accounts = DEFAULT_ACCOUNTS.slice();
    saveAccounts();
  }

  function ensureIncomeCategory() {
    var found = false;
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === INCOME_CATEGORY_ID) { found = true; break; }
    }
    if (!found) {
      categories.push(DEFAULT_CATEGORIES.filter(function (c) { return c.id === INCOME_CATEGORY_ID; })[0]);
      saveCategories();
    }
  }

  function isPaycheckDeposit(note) {
    var n = normText(note || '');
    return /\bpayroll\b/.test(n) || /\bdirect\s*dep/.test(n) || /\bsalary\b/.test(n) || /\bpaycheck\b/.test(n);
  }

  function incomeCategoryIdForDeposit(note) {
    return isPaycheckDeposit(note) ? INCOME_CATEGORY_ID : null;
  }

  function loadAccounts() {
    try {
      var raw = localStorage.getItem(ACCOUNTS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p) && p.length > 0) {
          return p.filter(function (a) {
            return a && a.id && a.name && (a.type === 'bank' || a.type === 'credit_card');
          });
        }
      }
    } catch (e) {}
    return [];
  }

  function saveAccounts() {
    try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts)); } catch (e) {}
  }

  function loadTransferPatterns() {
    try {
      var raw = localStorage.getItem(TRANSFER_PATTERNS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p)) {
          return p.filter(function (x) {
            return x && x.id && x.pattern && typeof x.pattern === 'string';
          });
        }
      }
    } catch (e) {}
    return [];
  }

  function saveTransferPatterns() {
    try { localStorage.setItem(TRANSFER_PATTERNS_KEY, JSON.stringify(transferPatterns)); } catch (e) {}
  }

  function loadForecastOverrides() {
    try {
      var raw = localStorage.getItem(FORECAST_OVERRIDES_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch (e) {}
    return {};
  }

  function saveForecastOverrides() {
    try { localStorage.setItem(FORECAST_OVERRIDES_KEY, JSON.stringify(forecastOverrides)); } catch (e) {}
  }

  function normalizeTransferPattern(desc) {
    return FC ? FC.normalizeTransferPattern(desc) : String(desc || '').toLowerCase().trim();
  }

  function findTransferPatternForNote(note) {
    var n = note || '';
    for (var i = transferPatterns.length - 1; i >= 0; i--) {
      var pat = transferPatterns[i].pattern;
      if (FC && FC.patternMatches(n, pat)) return transferPatterns[i];
      if (!FC && n.toLowerCase().indexOf(pat.toLowerCase()) !== -1) return transferPatterns[i];
    }
    return null;
  }

  function isOtherAccountTransferEntry(e) {
    return !!(e && e.isTransfer && e.transferKind === 'other');
  }

  function isDepositEntry(e) {
    return !!(e && e.isDeposit);
  }

  function getForecastCushion() {
    var meta = loadMetaObj();
    var v = meta.forecastCushion;
    if (typeof v === 'number' && v >= 0) return v;
    return 600;
  }

  function setForecastCushion(val) {
    var meta = loadMetaObj();
    meta.forecastCushion = val;
    saveMetaObj(meta);
  }

  function accountBalanceAsOfMs(acct) {
    if (!acct || !acct.balanceAsOf) return null;
    var parts = String(acct.balanceAsOf).split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m, d).getTime();
  }

  function formatBalanceAsOfLabel(asOfStr) {
    if (!asOfStr) return 'today';
    var today = localDateStamp();
    if (asOfStr === today) {
      return 'Today, ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return new Date(asOfStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function parseMoneyInput(raw) {
    var s = String(raw || '').replace(/[^0-9.\-]/g, '');
    var v = parseFloat(s);
    if (isNaN(v)) return NaN;
    return Math.round(v * 100) / 100;
  }

  function loadTransferPairs() {
    try {
      var raw = localStorage.getItem(TRANSFER_PAIRS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p)) {
          return p.filter(function (x) {
            return x && x.id && Array.isArray(x.entryIds) && x.entryIds.length === 2;
          });
        }
      }
    } catch (e) {}
    return [];
  }

  function saveTransferPairs() {
    try { localStorage.setItem(TRANSFER_PAIRS_KEY, JSON.stringify(transferPairs)); } catch (e) {}
  }

  function loadTransferUnlinkKeys() {
    try {
      var raw = localStorage.getItem(TRANSFER_UNLINK_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p)) return p.filter(function (k) { return typeof k === 'string' && k; });
      }
    } catch (e) {}
    return [];
  }

  function saveTransferUnlinkKeys() {
    try { localStorage.setItem(TRANSFER_UNLINK_KEY, JSON.stringify(transferUnlinkKeys)); } catch (e) {}
  }

  function loadImportAccountPrefs() {
    try {
      var raw = localStorage.getItem(IMPORT_ACCOUNT_PREFS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') return p;
      }
    } catch (e) {}
    return {};
  }

  function saveImportAccountPrefs() {
    try { localStorage.setItem(IMPORT_ACCOUNT_PREFS_KEY, JSON.stringify(importAccountPrefs)); } catch (e) {}
  }

  function getAccount(id) {
    if (!id) return null;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].id === id) return accounts[i];
    }
    return null;
  }

  function accountShortName(acct) {
    if (!acct) return '';
    var n = String(acct.name || '').trim();
    if (/chase/i.test(n)) return 'Chase';
    if (acct.type === 'bank' && /checking/i.test(n)) return 'Checking';
    var parts = n.split(/\s+/);
    return parts[0] || n;
  }

  function accountIconSvg(type) {
    if (type === 'credit_card') {
      return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.25"/><path d="M1.5 6.5h13" stroke="currentColor" stroke-width="1.25"/></svg>';
    }
    return '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 6.5V12a1 1 0 001 1h9a1 1 0 001-1V6.5" stroke="currentColor" stroke-width="1.25"/><path d="M1.5 5.5h13v2H1.5v-2z" stroke="currentColor" stroke-width="1.25"/><path d="M5.5 10.5h5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>';
  }

  function accountMiniIconHTML(acct) {
    if (!acct) return '';
    return '<span class="account-mini-icon" style="background:' + acct.color + '22;color:' + acct.color + '">' + accountIconSvg(acct.type) + '</span>';
  }

  function accountTagHTML(acct) {
    if (!acct) return '';
    return '<span class="account-tag">' + accountMiniIconHTML(acct) + escHtml(accountShortName(acct)) + '</span>';
  }

  function transferPairBlockKey(idA, idB) {
    var ids = [idA, idB].sort();
    return ids[0] + '|' + ids[1];
  }

  function isTransferPairBlocked(idA, idB) {
    var k = transferPairBlockKey(idA, idB);
    return transferUnlinkKeys.indexOf(k) !== -1;
  }

  function getEntryById(id) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  function getActivePairForEntry(entryId) {
    for (var i = 0; i < transferPairs.length; i++) {
      var p = transferPairs[i];
      if (p.unlinked) continue;
      if (p.entryIds[0] === entryId || p.entryIds[1] === entryId) return p;
    }
    return null;
  }

  function importRowMatchKey(ts, amount, note) {
    return dayKey(ts) + '|' + fmtMoney(amount) + '|' + descriptionMatchKey(note);
  }

  function buildExistingEntryByMatchKey() {
    var map = {};
    entries.forEach(function (e) {
      var k = importRowMatchKey(e.ts, e.amount, e.note || '');
      if (!map[k]) map[k] = e;
    });
    return map;
  }

  function suggestImportAccountId(layout) {
    ensureDefaultAccounts();
    if (layout === 'card') return importAccountPrefs.card || DEFAULT_ACCOUNT_CHASE;
    if (layout === 'bank') return importAccountPrefs.bank || DEFAULT_ACCOUNT_CHECKING;
    return importAccountPrefs[layout] || accounts[0].id;
  }

  function importAccountHintText(layout, suggestedId) {
    var acct = getAccount(suggestedId);
    if (layout === 'card' && acct && acct.type === 'credit_card') {
      return 'Suggested because the columns match a Chase credit card export. Every imported row will be tagged with this account.';
    }
    if (layout === 'bank') {
      return 'Suggested because the columns match your bank checking export. Every imported row will be tagged with this account.';
    }
    return 'Every imported row will be tagged with this account.';
  }

  function isCardPaymentCreditEntry(e) {
    if (!e || !e.isTransfer) return false;
    var acct = getAccount(e.accountId);
    if (!acct || acct.type !== 'credit_card') return false;
    var n = normText(e.note || '');
    if (CARD_PAYMENT_TYPES[normText(e.typeVal || '')]) return true;
    if (/\bpayment\b/.test(n) && (/\bthank\b/.test(n) || /\byou\b/.test(n))) return true;
    if (CARD_ISSUER_RE.test(n) && /\bpayment\b/.test(n)) return true;
    return false;
  }

  function isBankCardPaymentDebit(e) {
    if (!e || !e.isTransfer) return false;
    var acct = getAccount(e.accountId);
    if (!acct || acct.type !== 'bank') return false;
    return isCardBillAutopayTransfer(e.note || '');
  }

  function entryQualifiesForTransferPair(e) {
    if (!e || !e.isTransfer || !e.accountId) return false;
    if (isOtherAccountTransferEntry(e)) return false;
    var acct = getAccount(e.accountId);
    if (!acct) return false;
    if (acct.type === 'bank') return isBankCardPaymentDebit(e) || isCardBillAutopayTransfer(e.note || '');
    if (acct.type === 'credit_card') return true;
    return false;
  }

  function autoPairTransfers() {
    var used = {};
    transferPairs.forEach(function (p) {
      if (!p.unlinked) {
        used[p.entryIds[0]] = true;
        used[p.entryIds[1]] = true;
      }
    });
    var bank = [];
    var cards = [];
    entries.forEach(function (e) {
      if (used[e.id] || getActivePairForEntry(e.id)) return;
      if (!entryQualifiesForTransferPair(e)) return;
      var acct = getAccount(e.accountId);
      if (!acct) return;
      if (acct.type === 'bank') bank.push(e);
      else if (acct.type === 'credit_card') cards.push(e);
    });
    bank.forEach(function (b) {
      if (used[b.id]) return;
      var best = null;
      var bestGap = Infinity;
      cards.forEach(function (c) {
        if (used[c.id]) return;
        if (Math.abs(b.amount - c.amount) > 0.001) return;
        if (isTransferPairBlocked(b.id, c.id)) return;
        var gap = Math.abs(b.ts - c.ts);
        if (gap > MS_DAY * 5) return;
        if (!best || gap < bestGap) { best = c; bestGap = gap; }
      });
      if (!best) return;
      transferPairs.push({
        id: uid(),
        entryIds: [b.id, best.id],
        auto: true,
        unlinked: false,
        createdAt: Date.now()
      });
      used[b.id] = true;
      used[best.id] = true;
    });
    saveTransferPairs();
  }

  function unlinkTransferPair(pairId) {
    for (var i = 0; i < transferPairs.length; i++) {
      if (transferPairs[i].id !== pairId) continue;
      var p = transferPairs[i];
      p.unlinked = true;
      var block = transferPairBlockKey(p.entryIds[0], p.entryIds[1]);
      if (transferUnlinkKeys.indexOf(block) === -1) transferUnlinkKeys.push(block);
      saveTransferPairs();
      saveTransferUnlinkKeys();
      return true;
    }
    return false;
  }

  function pairedTransferTitle(creditAcct) {
    if (creditAcct && /chase/i.test(creditAcct.name)) return 'Chase card payment';
    if (creditAcct) return creditAcct.name + ' payment';
    return 'Card payment';
  }

  function collectExpenseLoggerKeys() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('expenseLogger.') === 0) out[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return out;
  }

  /** Resolved in-memory state merged into backups (defaults not yet written to localStorage). */
  function buildBackupStorageSnapshot() {
    var storage = collectExpenseLoggerKeys();
    storage[STORAGE_KEY] = JSON.stringify(entries);
    storage[CATS_KEY] = JSON.stringify(categories);
    storage[BUDGETS_KEY] = JSON.stringify(budgets);
    storage[RECURRING_KEY] = JSON.stringify(recurringItems);
    storage[IMPORT_RULES_KEY] = JSON.stringify(importRules);
    storage[IMPORT_SETTINGS_KEY] = JSON.stringify(importSettings);
    storage[ACCOUNTS_KEY] = JSON.stringify(accounts);
    storage[TRANSFER_PAIRS_KEY] = JSON.stringify(transferPairs);
    storage[TRANSFER_UNLINK_KEY] = JSON.stringify(transferUnlinkKeys);
    storage[IMPORT_ACCOUNT_PREFS_KEY] = JSON.stringify(importAccountPrefs);
    storage[TRANSFER_PATTERNS_KEY] = JSON.stringify(transferPatterns);
    storage[FORECAST_OVERRIDES_KEY] = JSON.stringify(forecastOverrides);
    var meta = loadMetaObj();
    if (meta && meta.forecastCushion != null) storage[META_KEY] = JSON.stringify(meta);
    storage[UI_KEY] = JSON.stringify({
      tab: currentTab === 'add' ? tabBeforeAdd : currentTab,
      dismissedWrapped: uiState.dismissedWrapped || {},
      reportChartMonths: uiState.reportChartMonths === 12 ? 12 : 6,
      reportTxSort: uiState.reportTxSort || 'latest',
      activityRange: normalizeActivityRangeId(uiState.activityRange),
      activityAccountId: uiState.activityAccountId || ''
    });
    return storage;
  }

  function buildBackupDocument() {
    return {
      backupFormat: BACKUP_FORMAT,
      appVersion: APP_VERSION,
      createdAt: new Date().toISOString(),
      storage: buildBackupStorageSnapshot()
    };
  }

  function pickDeviceBackupMeta(meta) {
    var out = {};
    if (meta && meta.lastBackupAt) out.lastBackupAt = meta.lastBackupAt;
    if (meta && meta.backupNudgeHiddenUntil) out.backupNudgeHiddenUntil = meta.backupNudgeHiddenUntil;
    return out;
  }

  function mergeDeviceBackupMeta(deviceFields) {
    if (!deviceFields || typeof deviceFields !== 'object') return;
    var meta = loadMetaObj();
    if (deviceFields.lastBackupAt) meta.lastBackupAt = deviceFields.lastBackupAt;
    else delete meta.lastBackupAt;
    if (deviceFields.backupNudgeHiddenUntil) meta.backupNudgeHiddenUntil = deviceFields.backupNudgeHiddenUntil;
    else delete meta.backupNudgeHiddenUntil;
    saveMetaObj(meta);
  }

  function applyBackupStorageReplacingAppData(backupStorage, deviceMetaKeep) {
    var filtered = {};
    Object.keys(backupStorage || {}).forEach(function (k) {
      if (k.indexOf('expenseLogger.') === 0 && k !== META_KEY) {
        filtered[k] = backupStorage[k];
      }
    });
    applyStorageSnapshot(filtered);
    mergeDeviceBackupMeta(deviceMetaKeep);
  }

  function summarizeBackupStorage(storage) {
    var entryCount = 0;
    var catCount = 0;
    var hasCategoriesInBackup = false;
    var minTs = null;
    var maxTs = null;
    try {
      var entriesRaw = storage[STORAGE_KEY];
      if (entriesRaw) {
        var list = JSON.parse(entriesRaw);
        if (Array.isArray(list)) {
          entryCount = list.length;
          list.forEach(function (e) {
            if (e && typeof e.ts === 'number') {
              if (minTs === null || e.ts < minTs) minTs = e.ts;
              if (maxTs === null || e.ts > maxTs) maxTs = e.ts;
            }
          });
        }
      }
      if (Object.prototype.hasOwnProperty.call(storage, CATS_KEY)) {
        hasCategoriesInBackup = true;
        var catsRaw = storage[CATS_KEY];
        if (catsRaw) {
          var cats = JSON.parse(catsRaw);
          if (Array.isArray(cats)) catCount = cats.length;
        }
      }
    } catch (e) {}
    return {
      entryCount: entryCount,
      catCount: catCount,
      hasCategoriesInBackup: hasCategoriesInBackup,
      minTs: minTs,
      maxTs: maxTs
    };
  }

  function formatCategorySummaryLabel(summary) {
    if (summary.hasCategoriesInBackup && summary.catCount > 0) {
      return String(summary.catCount);
    }
    return 'Default categories';
  }

  function validateBackupDocument(data) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Invalid backup format' };
    if (data.backupFormat !== BACKUP_FORMAT && data.backupFormat !== BACKUP_FORMAT_LEGACY) {
      return { ok: false, error: 'Unsupported backup version' };
    }
    if (!data.storage || typeof data.storage !== 'object') return { ok: false, error: 'Missing storage data' };
    var hasKey = false;
    Object.keys(data.storage).forEach(function (k) {
      if (k.indexOf('expenseLogger.') === 0) hasKey = true;
    });
    if (!hasKey) return { ok: false, error: 'No app data in backup' };
    if (data.storage[STORAGE_KEY] !== undefined) {
      try {
        var parsed = JSON.parse(data.storage[STORAGE_KEY]);
        if (!Array.isArray(parsed)) return { ok: false, error: 'Corrupt entries data' };
      } catch (e) {
        return { ok: false, error: 'Corrupt entries data' };
      }
    }
    if (data.storage[CATS_KEY] !== undefined) {
      try {
        var cats = JSON.parse(data.storage[CATS_KEY]);
        if (!Array.isArray(cats)) return { ok: false, error: 'Corrupt categories data' };
      } catch (e) {
        return { ok: false, error: 'Corrupt categories data' };
      }
    }
    return { ok: true, summary: summarizeBackupStorage(data.storage) };
  }

  function applyStorageSnapshot(storage) {
    var remove = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('expenseLogger.') === 0) remove.push(k);
      }
    } catch (e) {}
    remove.forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    Object.keys(storage).forEach(function (k) {
      if (k.indexOf('expenseLogger.') === 0 && storage[k] != null) {
        try { localStorage.setItem(k, storage[k]); } catch (e) {}
      }
    });
  }

  function reloadAllStateFromStorage() {
    categories = loadCategories();
    budgets = loadBudgets();
    recurringItems = loadRecurring();
    importRules = loadImportRules();
    importSettings = loadImportSettings();
    accounts = loadAccounts();
    transferPairs = loadTransferPairs();
    transferUnlinkKeys = loadTransferUnlinkKeys();
    importAccountPrefs = loadImportAccountPrefs();
    transferPatterns = loadTransferPatterns();
    forecastOverrides = loadForecastOverrides();
    ensureDefaultAccounts();
    ensureIncomeCategory();
    entries = loadEntries();
    if ($countCardPayments) $countCardPayments.checked = importSettings.countCardPayments;
  }

  function storageStatusLabel() {
    if (storagePersistStatus === 'protected') return 'Storage: protected';
    if (storagePersistStatus === 'volatile') return 'Storage: may be cleared by iOS';
    return 'Storage: standard';
  }

  function renderDataMetaLines() {
    if ($storageStatusLine) $storageStatusLine.textContent = storageStatusLabel();
    if (!$lastBackupLine) return;
    var meta = loadMetaObj();
    if (meta.lastBackupAt) {
      var d = new Date(meta.lastBackupAt);
      $lastBackupLine.hidden = false;
      $lastBackupLine.textContent = 'Last backup: ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
      $lastBackupLine.hidden = true;
      $lastBackupLine.textContent = '';
    }
  }

  function daysSinceBackup() {
    var meta = loadMetaObj();
    if (!meta.lastBackupAt) return null;
    var t = Date.parse(meta.lastBackupAt);
    if (isNaN(t)) return null;
    return Math.floor((Date.now() - t) / MS_DAY);
  }

  function shouldShowBackupNudge() {
    var meta = loadMetaObj();
    if (meta.backupNudgeHiddenUntil && Date.now() < meta.backupNudgeHiddenUntil) return false;
    var days = daysSinceBackup();
    if (days !== null && days > BACKUP_NUDGE_AFTER_DAYS) return true;
    if (days === null && entries.length >= BACKUP_NUDGE_MIN_ENTRIES) return true;
    return false;
  }

  function backupNudgeMessage() {
    var days = daysSinceBackup();
    if (days !== null && days > BACKUP_NUDGE_AFTER_DAYS) {
      return 'Last backup ' + days + ' days ago';
    }
    return 'Consider backing up your data';
  }

  function renderBackupReminder() {
    var show = shouldShowBackupNudge();
    var msg = backupNudgeMessage();
    if ($backupReminderLine) {
      $backupReminderLine.hidden = !show;
      var textEl = $backupReminderLine.querySelector('[data-backup-nudge-text]');
      if (textEl) textEl.textContent = msg;
    }
    if ($homeBackupNudge) {
      $homeBackupNudge.hidden = !show;
      var homeText = $homeBackupNudge.querySelector('[data-backup-nudge-text]');
      if (homeText) homeText.textContent = msg;
    }
  }

  function dismissBackupNudge() {
    var meta = loadMetaObj();
    meta.backupNudgeHiddenUntil = Date.now() + BACKUP_NUDGE_HIDE_DAYS * MS_DAY;
    saveMetaObj(meta);
    renderBackupReminder();
  }

  function recordBackupTime() {
    var meta = loadMetaObj();
    meta.lastBackupAt = new Date().toISOString();
    saveMetaObj(meta);
    renderDataMetaLines();
    renderBackupReminder();
  }

  function initPersistentStorage() {
    var storage = navigator.storage;
    if (!storage || typeof storage.persist !== 'function') {
      storagePersistStatus = 'unknown';
      renderDataMetaLines();
      return;
    }
    function afterPersist(granted) {
      storagePersistStatus = granted ? 'protected' : 'volatile';
      renderDataMetaLines();
    }
    if (typeof storage.persisted === 'function') {
      storage.persisted().then(function (already) {
        if (already) {
          storagePersistStatus = 'protected';
          renderDataMetaLines();
          return;
        }
        storage.persist().then(afterPersist).catch(function () {
          storagePersistStatus = 'volatile';
          renderDataMetaLines();
        });
      }).catch(function () {
        storagePersistStatus = 'volatile';
        renderDataMetaLines();
      });
      return;
    }
    storage.persist().then(afterPersist).catch(function () {
      storagePersistStatus = 'volatile';
      renderDataMetaLines();
    });
  }

  function runBackupExport() {
    var doc = buildBackupDocument();
    var json = JSON.stringify(doc);
    var blob = new Blob([json], { type: 'application/json' });
    var filename = 'expense-logger-backup-' + localDateStamp() + '.json';
    shareOrDownload(blob, filename, 'application/json');
    recordBackupTime();
  }

  function formatBackupDateRange(minTs, maxTs) {
    if (minTs === null || maxTs === null) return 'No dated entries';
    var a = new Date(minTs);
    var b = new Date(maxTs);
    var fmt = function (d) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    };
    if (fmt(a) === fmt(b)) return fmt(a);
    return fmt(a) + ' – ' + fmt(b);
  }

  function showRestoreUndoToast() {
    if (undoTimer) clearTimeout(undoTimer);
    pendingDelete = null;
    $undoText.textContent = 'Restored from backup — Undo';
    $undoToast.classList.add('show');
    undoTimer = setTimeout(function () {
      $undoToast.classList.remove('show');
      pendingRestoreUndo = null;
    }, 12000);
  }

  function commitBackupRestore(doc) {
    return idbAll().then(function (receipts) {
      var deviceMetaKeep = pickDeviceBackupMeta(loadMetaObj());
      pendingRestoreUndo = {
        storage: collectExpenseLoggerKeys(),
        receipts: receipts || []
      };
      applyBackupStorageReplacingAppData(doc.storage, deviceMetaKeep);
      reloadAllStateFromStorage();
      idbClear().catch(function () {});
      buildCategoryButtons();
      rebuildFilterDropdowns();
      renderAll();
      renderCategoryList();
      renderBudgetSettings();
      renderRecurringList();
      renderImportRulesList();
      buildYearSelect(true);
      renderReport();
      renderDataMetaLines();
      renderBackupReminder();
      if ($backupRestoreModal) $backupRestoreModal.classList.remove('show');
      pendingBackupRestore = null;
      toast('Data restored from backup');
      showRestoreUndoToast();
    }).catch(function () {
      toast('Could not finish restore');
    });
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
    categories.forEach(function (c) {
      if (c.id === 'other' && (c.color === '#adb5bd' || c.color === '#ADB5BD')) {
        c.color = '#878e96';
        changed = true;
      }
    });
    if (changed) saveCategories();
    ensureIncomeCategory();
    entries.forEach(function (e) {
      if (isDepositEntry(e) && isPaycheckDeposit(e.note) && e.categoryId !== INCOME_CATEGORY_ID) {
        e.categoryId = INCOME_CATEGORY_ID;
        changed = true;
      }
    });
    if (changed) saveEntries();
    ensureDefaultAccounts();
    entries.forEach(function (e) {
      if (e.isTransfer && !e.accountId) {
        if (e.importSource === 'card') e.accountId = DEFAULT_ACCOUNT_CHASE;
        else if (e.importSource === 'bank') e.accountId = DEFAULT_ACCOUNT_CHECKING;
      }
    });
    autoPairTransfers();
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
      btn.innerHTML = iconBadge(c, 'lg') + '<span></span>';
      btn.lastChild.textContent = c.name;
      btn.style.setProperty('--cat-ring', c.color);
      btn.addEventListener('click', function () {
        selectedCat = c.id;
        Array.prototype.forEach.call($cats.children, function (el) {
          el.classList.toggle('selected', el.dataset.id === c.id);
        });
        playCatIcon(btn.querySelector('.cat-badge'));
        updateSaveState();
      });
      $cats.appendChild(btn);
    });
    refreshIconObservers($cats);
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
    pill.className = 'cat-pill cat-pill--icon';
    pill.style.color = cat.color;
    pill.style.borderColor = cat.color + '55';
    pill.innerHTML = iconBadge(cat, 'xs') + '<span>' + escHtml(cat.name) + '</span>';
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
    var recent = entries.filter(function (e) { return entryCountsAsSpending(e); })
      .sort(function (a, b) { return b.ts - a.ts; }).slice(0, 5);
    if (recent.length === 0) {
      $recentEl.innerHTML = '<div class="empty">No expenses yet.<br>Add your first one above ↑</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    recent.forEach(function (e) { frag.appendChild(createEntryRow(e)); });
    $recentEl.innerHTML = '';
    $recentEl.appendChild(frag);
    refreshIconObservers($recentEl);
  }

  function entryCountsAsSpending(e) {
    if (!e || typeof e.amount !== 'number') return false;
    if (isDepositEntry(e)) return false;
    if (e.isTransfer) return false;
    if (e.excluded) return false;
    if (e.countAsSpending === false) return false;
    return true;
  }

  function entrySpendingAmount(e) {
    return entryCountsAsSpending(e) ? e.amount : 0;
  }

  function endOfLocalDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  }

  function getActivityRangeBounds(rangeId, now) {
    now = now || new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var y = today.getFullYear();
    var m = today.getMonth();
    var id = normalizeActivityRangeId(rangeId);

    if (id === 'all') {
      return {
        id: id,
        startMs: null,
        endMs: endOfLocalDay(today.getTime()),
        multiMonth: true,
        label: 'All time'
      };
    }
    if (id === 'this-month') {
      return {
        id: id,
        startMs: new Date(y, m, 1).getTime(),
        endMs: endOfLocalDay(today.getTime()),
        multiMonth: false,
        label: null
      };
    }
    if (id === 'last-month') {
      var lm = m - 1;
      var ly = y;
      if (lm < 0) { lm = 11; ly -= 1; }
      var lastDay = daysInMonth(ly, lm);
      return {
        id: id,
        startMs: new Date(ly, lm, 1).getTime(),
        endMs: endOfLocalDay(new Date(ly, lm, lastDay).getTime()),
        multiMonth: false,
        label: null
      };
    }
    if (id === '3-months') {
      var sm = m - 2;
      var sy = y;
      while (sm < 0) { sm += 12; sy -= 1; }
      return {
        id: id,
        startMs: new Date(sy, sm, 1).getTime(),
        endMs: endOfLocalDay(today.getTime()),
        multiMonth: true,
        label: null
      };
    }
    if (id === 'year') {
      return {
        id: id,
        startMs: new Date(y, 0, 1).getTime(),
        endMs: endOfLocalDay(today.getTime()),
        multiMonth: true,
        label: null
      };
    }
    return getActivityRangeBounds('this-month', now);
  }

  function entryInActivityRange(ts, bounds) {
    if (!bounds || bounds.id === 'all' || bounds.startMs == null) return true;
    return ts >= bounds.startMs && ts <= bounds.endMs;
  }

  function formatActivityRangePart(d) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatActivityRangeLabel(bounds) {
    if (!bounds) return '';
    if (bounds.label) return bounds.label;
    var start = new Date(bounds.startMs);
    var end = new Date(bounds.endMs);
    var startStr = formatActivityRangePart(start);
    var endStr = formatActivityRangePart(end);
    if (start.getFullYear() !== end.getFullYear()) {
      startStr += ', ' + start.getFullYear();
    }
    return startStr + ' \u2013 ' + endStr + ', ' + end.getFullYear();
  }

  function inclusiveRangeDayCount(bounds, entriesForSpan) {
    if (!bounds) return 1;
    var end = new Date(bounds.endMs);
    var endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    var startDay;
    if (bounds.startMs == null) {
      var minTs = null;
      (entriesForSpan || []).forEach(function (e) {
        if (minTs === null || e.ts < minTs) minTs = e.ts;
      });
      if (minTs == null) startDay = endDay;
      else {
        var md = new Date(minTs);
        startDay = new Date(md.getFullYear(), md.getMonth(), md.getDate()).getTime();
      }
    } else {
      var sd = new Date(bounds.startMs);
      startDay = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()).getTime();
    }
    return Math.max(1, Math.round((endDay - startDay) / MS_DAY) + 1);
  }

  function sumSpending(list) {
    return list.reduce(function (s, e) { return s + entrySpendingAmount(e); }, 0);
  }

  function buildActivityDisplayItems(list) {
    var hidden = {};
    var items = [];
    transferPairs.forEach(function (p) {
      if (p.unlinked) return;
      var a = null;
      var b = null;
      list.forEach(function (e) {
        if (e.id === p.entryIds[0]) a = e;
        if (e.id === p.entryIds[1]) b = e;
      });
      if (!a || !b) return;
      hidden[a.id] = true;
      hidden[b.id] = true;
      var acctA = getAccount(a.accountId);
      var acctB = getAccount(b.accountId);
      var bankE = acctA && acctA.type === 'bank' ? a : b;
      var cardE = acctA && acctA.type === 'credit_card' ? a : b;
      if (getAccount(bankE.accountId).type !== 'bank') {
        bankE = b;
        cardE = a;
      }
      var creditAcct = getAccount(cardE.accountId);
      items.push({
        kind: 'paired-transfer',
        pairId: p.id,
        pair: p,
        ts: Math.max(bankE.ts, cardE.ts),
        amount: bankE.amount,
        bankEntry: bankE,
        cardEntry: cardE,
        title: pairedTransferTitle(creditAcct),
        bankAcct: getAccount(bankE.accountId),
        cardAcct: creditAcct
      });
    });
    list.forEach(function (e) {
      if (hidden[e.id]) return;
      items.push({ kind: 'entry', entry: e, ts: e.ts });
    });
    return items;
  }

  function computeActivitySummary(displayItems, bounds) {
    var total = 0;
    var expenseCount = 0;
    var transferCount = 0;
    displayItems.forEach(function (it) {
      if (it.kind === 'paired-transfer') {
        transferCount++;
        return;
      }
      if (it.entry.isTransfer) transferCount++;
      else if (entryCountsAsSpending(it.entry)) {
        expenseCount++;
        total += it.entry.amount;
      }
    });
    var days = inclusiveRangeDayCount(bounds, displayItems.map(function (it) {
      return it.kind === 'entry' ? it.entry : { ts: it.ts, amount: it.amount };
    }));
    return {
      total: total,
      expenseCount: expenseCount,
      transferCount: transferCount,
      count: expenseCount + transferCount,
      avgPerDay: total / days,
      rangeLabel: formatActivityRangeLabel(bounds)
    };
  }

  function monthGroupKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function parseMonthGroupKey(key) {
    var p = key.split('-');
    return { y: parseInt(p[0], 10), m: parseInt(p[1], 10) - 1 };
  }

  function getFilteredEntries() {
    var q = ($searchInput.value || '').toLowerCase().trim();
    var catFilter = $filterCategory.value;
    var typeFilter = $filterType.value;
    var sort = $filterSort.value;
    var bounds = getActivityRangeBounds(uiState.activityRange);

    var list = entries.slice();

    list = list.filter(function (e) { return entryInActivityRange(e.ts, bounds); });

    if (q) {
      list = list.filter(function (e) {
        var cat = getCat(e.categoryId);
        return (e.note && e.note.toLowerCase().indexOf(q) !== -1)
            || cat.name.toLowerCase().indexOf(q) !== -1;
      });
    }
    if (catFilter) list = list.filter(function (e) { return e.categoryId === catFilter; });
    if (uiState.activityAccountId) {
      var acctId = uiState.activityAccountId;
      list = list.filter(function (e) {
        if (e.accountId === acctId) return true;
        var pair = getActivePairForEntry(e.id);
        if (!pair) return false;
        var otherId = pair.entryIds[0] === e.id ? pair.entryIds[1] : pair.entryIds[0];
        var other = getEntryById(otherId);
        return other && other.accountId === acctId;
      });
    }
    if (typeFilter === 'recurring') list = list.filter(function (e) { return !!e.recurringId; });
    else if (typeFilter === 'one-time') list = list.filter(function (e) { return !e.recurringId; });
    else if (typeFilter === 'with-receipt') list = list.filter(function (e) { return !!e.hasReceipt; });

    return sortEntriesList(list, sort);
  }

  function dayGroupTitle(ts) {
    var d = new Date(ts);
    var today = new Date();
    var yest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()) {
      return 'Today';
    }
    if (d.getFullYear() === yest.getFullYear() && d.getMonth() === yest.getMonth() && d.getDate() === yest.getDate()) {
      return 'Yesterday';
    }
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function parseActivityNoteForRow(noteRaw, catName) {
    var note = String(noteRaw || '').trim();
    if (!note) return { title: catName, noteTag: null };
    var parts = note.split(/\s*\u00B7\s*|\s*\u2022\s*/);
    if (parts.length >= 2) {
      return {
        title: parts[0].trim(),
        noteTag: parts.slice(1).join(' \u00B7 ').trim()
      };
    }
    return { title: note, noteTag: note };
  }

  function activitySubtitleLine(catName, titleText, noteTag) {
    catName = String(catName || '').trim();
    titleText = String(titleText || '').trim();
    var tag = noteTag != null ? String(noteTag).trim() : '';
    if (!tag) return catName;
    if (tag.toLowerCase() === titleText.toLowerCase()) return catName;
    return catName + ' \u00B7 ' + tag;
  }

  function createActivityRow(e) {
    var cat = getCat(e.categoryId);
    var row = document.createElement('div');
    row.className = 'activity-row';
    row.dataset.id = e.id;
    row.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('button')) return;
      if (isOtherAccountTransferEntry(e)) openOtherTransferSheet(e.id);
      else openEntryEditor(e.id);
    });
    if (e.isTransfer) row.classList.add('is-transfer-row');
    var chip = document.createElement('span');
    chip.className = 'cat-chip cat-chip--badge' + (e.isTransfer ? ' transfer-chip' : '');
    chip.innerHTML = e.isTransfer
      ? '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 7h9.5M13.5 7L11 4.5M13.5 7L11 9.5M16 13H6.5M6.5 13L9 10.5M6.5 13L9 15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : iconBadge(cat, 'sm');
    var main = document.createElement('div');
    main.className = 'row-main';
    var title = document.createElement('div');
    title.className = 'row-title';
    var noteRaw = String(e.note || '').trim();
    var hasNote = !!noteRaw;
    var subBits = [];
    if (isOtherAccountTransferEntry(e)) {
      title.textContent = noteRaw || 'Transfer';
      subBits.push('Transfer \u00B7 Other account');
    } else if (isDepositEntry(e) && (e.categoryId === INCOME_CATEGORY_ID || isPaycheckDeposit(noteRaw))) {
      title.textContent = noteRaw || 'Paycheck';
      subBits.push('Income \u00B7 Paycheck');
    } else if (hasNote) {
      var parsed = parseActivityNoteForRow(noteRaw, cat.name);
      title.textContent = parsed.title;
      subBits.push(activitySubtitleLine(cat.name, parsed.title, parsed.noteTag));
    } else {
      title.textContent = cat.name;
    }
    if (e.recurringId) subBits.push('Recurring');
    if (e.hasReceipt) subBits.push(uiIcon('ui-camera', 'xs'));
    main.appendChild(title);
    if (subBits.length || e.accountId) {
      var sub = document.createElement('div');
      sub.className = 'row-sub';
      var textSpan = document.createElement('span');
      textSpan.className = 'row-sub-text';
      textSpan.innerHTML = subBits.join(' · ');
      sub.appendChild(textSpan);
      if (e.accountId && !e.isTransfer) {
        var acct = getAccount(e.accountId);
        if (acct) {
          var tagSlot = document.createElement('span');
          tagSlot.innerHTML = accountTagHTML(acct);
          if (tagSlot.firstChild) sub.appendChild(tagSlot.firstChild);
        }
      }
      main.appendChild(sub);
    }
    var amt = document.createElement('span');
    amt.className = 'row-amt' + (isDepositEntry(e) ? ' row-amt-in' : '');
    if (isOtherAccountTransferEntry(e) && !isDepositEntry(e)) {
      amt.textContent = fmtMoneyDisplay(e.amount);
    } else if (isDepositEntry(e)) {
      amt.textContent = '+' + fmtMoneyDisplay(e.amount);
    } else {
      amt.textContent = fmtMoneyDisplay(e.amount);
    }
    row.appendChild(chip);
    row.appendChild(main);
    row.appendChild(amt);
    return row;
  }

  function createPairedTransferActivityRow(item) {
    var row = document.createElement('div');
    row.className = 'activity-row is-transfer-row';
    row.dataset.pairId = item.pairId;
    row.addEventListener('click', function (ev) {
      if (ev.target.closest && ev.target.closest('button')) return;
      openTransferDetail(item.pairId);
    });
    var chip = document.createElement('span');
    chip.className = 'cat-chip transfer-chip';
    chip.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 7h9.5M13.5 7L11 4.5M13.5 7L11 9.5M16 13H6.5M6.5 13L9 10.5M6.5 13L9 15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var main = document.createElement('div');
    main.className = 'row-main';
    var title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = item.title;
    var sub = document.createElement('div');
    sub.className = 'row-sub';
    var fromName = item.bankAcct ? item.bankAcct.name : 'Bank';
    var toName = item.cardAcct ? item.cardAcct.name : 'Card';
    var fromShort = item.bankAcct ? accountShortName(item.bankAcct) : 'Bank';
    var toShort = item.cardAcct ? accountShortName(item.cardAcct) : 'Card';
    sub.textContent = 'Transfer \u00B7 ' + fromShort + ' \u2192 ' + toShort;
    main.appendChild(title);
    main.appendChild(sub);
    var right = document.createElement('div');
    right.className = 'row-amt-wrap';
    var amt = document.createElement('span');
    amt.className = 'row-amt';
    amt.textContent = fmtMoneyDisplay(item.amount);
    var linked = document.createElement('span');
    linked.className = 'row-linked';
    linked.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style="vertical-align:-1px;margin-right:4px"><path d="M4.5 6.5l1 1 3-3M5 2.5h-.5A2.5 2.5 0 002 5v.5M7 9.5h.5A2.5 2.5 0 0010 7V6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>Linked';
    right.appendChild(amt);
    right.appendChild(linked);
    row.appendChild(chip);
    row.appendChild(main);
    row.appendChild(right);
    return row;
  }

  function appendActivityDisplayRow(parent, item) {
    if (item.kind === 'paired-transfer') parent.appendChild(createPairedTransferActivityRow(item));
    else parent.appendChild(createActivityRow(item.entry));
  }

  function sortEntriesList(list, sort) {
    var out = list.slice();
    if (sort === 'newest') {
      out.sort(function (a, b) { return b.ts - a.ts; });
    } else if (sort === 'oldest') {
      out.sort(function (a, b) { return a.ts - b.ts; });
    } else if (sort === 'highest') {
      out.sort(function (a, b) {
        if (b.amount !== a.amount) return b.amount - a.amount;
        return b.ts - a.ts;
      });
    } else if (sort === 'lowest') {
      out.sort(function (a, b) {
        if (a.amount !== b.amount) return a.amount - b.amount;
        return b.ts - a.ts;
      });
    }
    return out;
  }

  function syncActivityRangeChips() {
    var id = normalizeActivityRangeId(uiState.activityRange);
    Array.prototype.forEach.call(document.querySelectorAll('.activity-range-chip'), function (btn) {
      var on = btn.dataset.activityRange === id;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function updateActivityFilterBtnState() {
    if (!$activityFilterBtn) return;
    var active = !!($filterCategory && $filterCategory.value)
      || ($filterType && $filterType.value !== 'all')
      || ($filterSort && $filterSort.value !== 'newest');
    $activityFilterBtn.classList.toggle('is-active', active);
  }

  function renderActivitySummary(displayItems) {
    if (!$activitySummaryRange) return;
    var bounds = getActivityRangeBounds(uiState.activityRange);
    var summary = computeActivitySummary(displayItems, bounds);
    $activitySummaryRange.textContent = summary.rangeLabel;
    $activitySummaryTotal.textContent = fmtMoneyDisplay(summary.total);
    if (summary.transferCount > 0) {
      $activitySummaryCount.textContent = summary.expenseCount + ' expense' + (summary.expenseCount === 1 ? '' : 's')
        + ' \u00B7 ' + summary.transferCount + ' transfer' + (summary.transferCount === 1 ? '' : 's');
    } else {
      $activitySummaryCount.textContent = summary.expenseCount + ' transaction' + (summary.expenseCount === 1 ? '' : 's');
    }
    $activitySummaryAvg.innerHTML = 'avg <span class="avg-amt">' + fmtMoneyDisplay(summary.avgPerDay) + '</span>/day';
  }

  function renderActivityAccountSegments() {
    if (!$activityAccountSegments) return;
    ensureDefaultAccounts();
    var selected = uiState.activityAccountId || '';
    var html = '<button type="button" class="activity-account-segment" data-account-id="" aria-pressed="' + (selected ? 'false' : 'true') + '">All accounts</button>';
    accounts.forEach(function (a) {
      var on = selected === a.id;
      html += '<button type="button" class="activity-account-segment" data-account-id="' + escHtml(a.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
        + accountMiniIconHTML(a) + escHtml(a.name) + '</button>';
    });
    $activityAccountSegments.innerHTML = html;
    Array.prototype.forEach.call($activityAccountSegments.querySelectorAll('.activity-account-segment'), function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.dataset.accountId || '';
        if (uiState.activityAccountId === next) return;
        uiState.activityAccountId = next;
        saveUI();
        renderActivityAccountSegments();
        renderEntries();
      });
    });
  }

  function appendActivityDayGroup(parent, dayKey, dayItems) {
    var dayTotal = dayItems.reduce(function (s, it) {
      if (it.kind === 'paired-transfer') return s;
      return s + entrySpendingAmount(it.entry);
    }, 0);
    var block = document.createElement('div');
    block.className = 'activity-day-block';
    var hdr = document.createElement('div');
    hdr.className = 'activity-day-header';
    hdr.innerHTML = '<span>' + dayGroupTitle(dayKey) + '</span><span class="day-total">' + fmtMoneyDisplay(dayTotal) + '</span>';
    block.appendChild(hdr);
    var group = document.createElement('div');
    group.className = 'activity-group';
    var rowsWrap = document.createElement('div');
    rowsWrap.className = 'activity-day-rows';
    dayItems.forEach(function (it) { appendActivityDisplayRow(rowsWrap, it); });
    group.appendChild(rowsWrap);
    block.appendChild(group);
    parent.appendChild(block);
  }

  function sortDisplayItems(items, sort) {
    var out = items.slice();
    if (sort === 'newest') {
      out.sort(function (a, b) { return b.ts - a.ts; });
    } else if (sort === 'oldest') {
      out.sort(function (a, b) { return a.ts - b.ts; });
    } else if (sort === 'highest') {
      out.sort(function (a, b) {
        var aa = a.kind === 'paired-transfer' ? a.amount : a.entry.amount;
        var bb = b.kind === 'paired-transfer' ? b.amount : b.entry.amount;
        if (bb !== aa) return bb - aa;
        return b.ts - a.ts;
      });
    } else if (sort === 'lowest') {
      out.sort(function (a, b) {
        var aa = a.kind === 'paired-transfer' ? a.amount : a.entry.amount;
        var bb = b.kind === 'paired-transfer' ? b.amount : b.entry.amount;
        if (aa !== bb) return aa - bb;
        return b.ts - a.ts;
      });
    }
    return out;
  }

  function renderEntries() {
    syncActivityRangeChips();
    renderActivityAccountSegments();
    updateActivityFilterBtnState();
    var sort = $filterSort ? $filterSort.value : 'newest';
    var list = getFilteredEntries();
    var displayItems = sortDisplayItems(buildActivityDisplayItems(list), sort);
    var bounds = getActivityRangeBounds(uiState.activityRange);
    renderActivitySummary(displayItems);
    if ($entriesCt) $entriesCt.textContent = list.length === 1 ? '1 item' : list.length + ' items';
    if (displayItems.length === 0) {
      $entriesEl.innerHTML = '<div class="empty">No matching expenses.<br>Try changing filters.</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    var useDayGroups = sort === 'newest' || sort === 'oldest';

    if (!useDayGroups) {
      var flat = document.createElement('div');
      flat.className = 'activity-group activity-flat';
      var flatRows = document.createElement('div');
      flatRows.className = 'activity-day-rows';
      displayItems.forEach(function (it) { appendActivityDisplayRow(flatRows, it); });
      flat.appendChild(flatRows);
      frag.appendChild(flat);
      $entriesEl.innerHTML = '';
      $entriesEl.appendChild(frag);
      if (lastSavedEntryId) {
        var savedRow = $entriesEl.querySelector('.activity-row[data-id="' + lastSavedEntryId + '"]');
        if (savedRow) playCatIcon(savedRow.querySelector('.cat-badge'));
        lastSavedEntryId = null;
      }
      refreshIconObservers($entriesEl);
      return;
    }

    if (bounds.multiMonth) {
      var monthMap = {};
      var monthOrder = [];
      displayItems.forEach(function (it) {
        var mk = monthGroupKey(it.ts);
        if (!monthMap[mk]) { monthMap[mk] = []; monthOrder.push(mk); }
        monthMap[mk].push(it);
      });
      if (sort === 'oldest') monthOrder.reverse();
      monthOrder.forEach(function (mk) {
        var monthItems = monthMap[mk];
        var mp = parseMonthGroupKey(mk);
        var block = document.createElement('div');
        block.className = 'activity-month-block';
        var monthHdr = document.createElement('div');
        monthHdr.className = 'activity-month-header';
        var monthTotal = monthItems.reduce(function (s, it) {
          if (it.kind === 'paired-transfer') return s;
          return s + entrySpendingAmount(it.entry);
        }, 0);
        monthHdr.innerHTML = '<div class="activity-month-left"><div class="activity-month-title">'
          + escHtml(monthName(new Date(mp.y, mp.m, 1)))
          + '</div><div class="activity-month-meta">'
          + monthItems.length + ' transaction' + (monthItems.length === 1 ? '' : 's')
          + '</div></div><div class="activity-month-total">' + fmtMoneyDisplay(monthTotal) + '</div>';
        block.appendChild(monthHdr);

        var dayGroups = {};
        var dayOrder = [];
        monthItems.forEach(function (it) {
          var dk = startOfDay(it.ts);
          if (!dayGroups[dk]) { dayGroups[dk] = []; dayOrder.push(dk); }
          dayGroups[dk].push(it);
        });
        if (sort === 'oldest') dayOrder.reverse();
        dayOrder.forEach(function (dk) {
          appendActivityDayGroup(block, dk, dayGroups[dk]);
        });
        frag.appendChild(block);
      });
    } else {
      var groups = {};
      var order = [];
      displayItems.forEach(function (it) {
        var k = startOfDay(it.ts);
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(it);
      });
      order.forEach(function (k) {
        appendActivityDayGroup(frag, k, groups[k]);
      });
    }

    $entriesEl.innerHTML = '';
    $entriesEl.appendChild(frag);
    if (lastSavedEntryId) {
      var savedRow2 = $entriesEl.querySelector('.activity-row[data-id="' + lastSavedEntryId + '"]');
      if (savedRow2) playCatIcon(savedRow2.querySelector('.cat-badge'));
      lastSavedEntryId = null;
    }
    refreshIconObservers($entriesEl);
  }

  function closeTransferDetail() {
    viewingTransferPairId = null;
    if ($transferDetailView) $transferDetailView.hidden = true;
    if ($entriesEl) $entriesEl.hidden = false;
    var card = $('activitySummaryCard');
    if (card) card.hidden = false;
    if ($activityAccountSegments) $activityAccountSegments.hidden = false;
    var chips = document.querySelector('.activity-range-chips');
    if (chips) chips.hidden = false;
  }

  function openTransferDetail(pairId) {
    var pair = null;
    for (var i = 0; i < transferPairs.length; i++) {
      if (transferPairs[i].id === pairId) { pair = transferPairs[i]; break; }
    }
    if (!pair || pair.unlinked) return;
    viewingTransferPairId = pairId;
    renderTransferDetail(pair);
    if ($entriesEl) $entriesEl.hidden = true;
    var card = $('activitySummaryCard');
    if (card) card.hidden = true;
    if ($activityAccountSegments) $activityAccountSegments.hidden = true;
    var chips = document.querySelector('.activity-range-chips');
    if (chips) chips.hidden = true;
    if ($transferDetailView) $transferDetailView.hidden = false;
  }

  function renderTransferDetail(pair) {
    if (!$transferDetailBody || !pair) return;
    var a = getEntryById(pair.entryIds[0]);
    var b = getEntryById(pair.entryIds[1]);
    if (!a || !b) return;
    var acctA = getAccount(a.accountId);
    var acctB = getAccount(b.accountId);
    var bankE = acctA && acctA.type === 'bank' ? a : b;
    var cardE = acctA && acctA.type === 'credit_card' ? a : b;
    if (getAccount(bankE.accountId).type !== 'bank') {
      bankE = b;
      cardE = a;
    }
    var bankAcct = getAccount(bankE.accountId);
    var cardAcct = getAccount(cardE.accountId);
    var title = pairedTransferTitle(cardAcct);
    var html = '';
    html += '<div class="transfer-detail-hero">';
    html += '<div class="transfer-detail-icon"><svg width="28" height="28" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 7h9.5M13.5 7L11 4.5M13.5 7L11 9.5M16 13H6.5M6.5 13L9 10.5M6.5 13L9 15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
    html += '<div class="transfer-detail-title">' + escHtml(title) + '</div>';
    html += '<div class="transfer-detail-amount">' + fmtMoneyDisplay(bankE.amount) + '</div>';
    html += '<div class="transfer-detail-direction">' + escHtml(bankAcct ? bankAcct.name : 'Bank') + ' \u2192 ' + escHtml(cardAcct ? cardAcct.name : 'Card') + '</div>';
    html += '<div class="transfer-not-spending"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3.5 7.2l2.2 2.2 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Not counted as spending</div>';
    html += '</div>';
    html += '<div class="transfer-section-label"><span>Matched pair</span><span style="color:var(--accent);font-size:13px;text-transform:none;letter-spacing:0;font-weight:600"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" style="vertical-align:-1px;margin-right:4px"><path d="M4.5 6.5l1 1 3-3M5 2.5h-.5A2.5 2.5 0 002 5v.5M7 9.5h.5A2.5 2.5 0 0010 7V6.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>Linked</span></div>';
    html += '<div class="transfer-pair-card">';
    html += '<div class="transfer-pair-row">' + accountMiniIconHTML(bankAcct) + '<div class="transfer-pair-row-main"><div class="transfer-pair-row-title">' + escHtml(bankAcct ? bankAcct.name : 'Bank') + '</div><div class="transfer-pair-row-sub">Debit \u00B7 ' + escHtml(bankE.note || 'Payment') + '</div></div><div><div class="transfer-pair-row-amt">-' + fmtMoneyDisplay(bankE.amount) + '</div><div class="transfer-pair-row-date">' + new Date(bankE.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '</div></div></div>';
    html += '<div class="transfer-pair-row">' + accountMiniIconHTML(cardAcct) + '<div class="transfer-pair-row-main"><div class="transfer-pair-row-title">' + escHtml(cardAcct ? cardAcct.name : 'Card') + '</div><div class="transfer-pair-row-sub">Payment credit \u00B7 ' + escHtml(cardE.note || 'Thank you') + '</div></div><div><div class="transfer-pair-row-amt">+' + fmtMoneyDisplay(cardE.amount) + '</div><div class="transfer-pair-row-date">' + new Date(cardE.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + '</div></div></div>';
    html += '</div>';
    if (pair.auto) {
      html += '<p class="transfer-auto-note"><span aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor"/><path d="M8 7v4M8 5.2h.01" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg></span><span>Matched automatically: same amount, '
        + Math.max(1, Math.round(Math.abs(bankE.ts - cardE.ts) / MS_DAY)) + ' day' + (Math.abs(bankE.ts - cardE.ts) >= MS_DAY * 2 ? 's' : '') + ' apart, from your '
        + escHtml(bankAcct ? bankAcct.name : 'bank') + ' export and ' + escHtml(cardAcct ? cardAcct.name : 'card') + ' CSV.</span></p>';
    }
    html += '<div class="transfer-section-label">Details</div>';
    html += '<div class="transfer-details-card">';
    html += '<div class="transfer-details-row"><span>Type</span><span>Transfer</span></div>';
    html += '<div class="transfer-details-row"><span>Date</span><span>' + new Date(Math.min(bankE.ts, cardE.ts)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      + ' \u2013 ' + new Date(Math.max(bankE.ts, cardE.ts)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + '</span></div>';
    html += '<div class="transfer-details-row"><span>Sources</span><span>2 imports</span></div>';
    html += '</div>';
    html += '<button type="button" class="transfer-unlink-btn" id="transferUnlinkBtn">Unlink pair</button>';
    $transferDetailBody.innerHTML = html;
    var unlinkBtn = document.getElementById('transferUnlinkBtn');
    if (unlinkBtn) {
      unlinkBtn.addEventListener('click', function () {
        if (unlinkTransferPair(pair.id)) {
          saveEntries();
          closeTransferDetail();
          renderAll();
          toast('Transfer unlinked');
        }
      });
    }
  }

  function rebuildEditAccountSelect(selectedId) {
    if (!$editAccount) return;
    ensureDefaultAccounts();
    var html = '<option value="">None</option>';
    accounts.forEach(function (a) {
      html += '<option value="' + escHtml(a.id) + '"' + (selectedId === a.id ? ' selected' : '') + '>' + escHtml(a.name) + '</option>';
    });
    $editAccount.innerHTML = html;
  }

  function rebuildAddAccountSelect() {
    if (!$addAccountSelect) return;
    ensureDefaultAccounts();
    var html = '<option value="">None</option>';
    accounts.forEach(function (a) {
      html += '<option value="' + escHtml(a.id) + '">' + escHtml(a.name) + '</option>';
    });
    $addAccountSelect.innerHTML = html;
    $addAccountSelect.value = selectedAddAccountId || '';
  }

  function updateAddAccountPreview() {
    if (!$addAccountPreview) return;
    if (!selectedAddAccountId) {
      $addAccountPreview.textContent = 'None';
      if ($addAccountRowIcon) $addAccountRowIcon.innerHTML = '';
      return;
    }
    var acct = getAccount(selectedAddAccountId);
    if (!acct) {
      $addAccountPreview.textContent = 'None';
      return;
    }
    $addAccountPreview.textContent = acct.name;
    if ($addAccountRowIcon) $addAccountRowIcon.innerHTML = accountMiniIconHTML(acct);
  }

  function createAccountRecord(name, type) {
    var id = 'acct-' + uid().slice(0, 8);
    var color = type === 'credit_card' ? '#748FFC' : '#20C997';
    accounts.push({ id: id, name: name, type: type, color: color });
    saveAccounts();
    return id;
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
    updateActivityStickyTop();
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
    pendingRestoreUndo = null;
  }
  $undoBtn.addEventListener('click', function () {
    if (pendingRestoreUndo) {
      applyStorageSnapshot(pendingRestoreUndo.storage);
      reloadAllStateFromStorage();
      var receiptList = pendingRestoreUndo.receipts || [];
      idbClear().then(function () {
        var chain = Promise.resolve();
        receiptList.forEach(function (r) {
          if (r && r.id) chain = chain.then(function () { return idbPut(r); });
        });
        return chain;
      }).then(function () {
        buildCategoryButtons();
        rebuildFilterDropdowns();
        renderAll();
        renderCategoryList();
        renderBudgetSettings();
        renderRecurringList();
        renderImportRulesList();
        buildYearSelect(true);
        renderReport();
        renderDataMetaLines();
        renderBackupReminder();
        toast('Previous data restored');
      }).catch(function () {
        toast('Undo partially failed');
      });
      pendingRestoreUndo = null;
      hideUndo();
      return;
    }
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
    var monthEntries = entries.filter(function (e) {
      return isSameMonth(e.ts, y, m) && entryCountsAsSpending(e);
    });
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
      .filter(function (e) { return isSameMonth(e.ts, y, m) && entryCountsAsSpending(e); })
      .reduce(function (s, e) { return s + e.amount; }, 0);
  }

  function reportMonthKey(y, m) {
    return y + '-' + pad2(m + 1);
  }

  function ymToIndex(y, m) {
    return y * 12 + m;
  }

  function indexToYm(idx) {
    var y = Math.floor(idx / 12);
    var m = idx - y * 12;
    if (m < 0) { m += 12; y -= 1; }
    return { y: y, m: m };
  }

  function addMonthsYM(y, m, delta) {
    return indexToYm(ymToIndex(y, m) + delta);
  }

  function compareYM(y1, m1, y2, m2) {
    return ymToIndex(y1, m1) - ymToIndex(y2, m2);
  }

  function earliestMonthWithData() {
    var minIdx = null;
    entries.forEach(function (e) {
      var d = new Date(e.ts);
      var idx = ymToIndex(d.getFullYear(), d.getMonth());
      if (minIdx === null || idx < minIdx) minIdx = idx;
    });
    return minIdx === null ? null : indexToYm(minIdx);
  }

  function computeReportChartWindow(selY, selM, count, now) {
    var curY = now.getFullYear();
    var curM = now.getMonth();
    if (compareYM(selY, selM, curY, curM) > 0) {
      selY = curY;
      selM = curM;
    }
    var before = count === 6 ? 3 : 6;
    var after = count === 6 ? 2 : 5;
    var selIdx = ymToIndex(selY, selM);
    var curIdx = ymToIndex(curY, curM);
    var monthsAfterSel = curIdx - selIdx;
    var startIdx;
    var endIdx;

    if (monthsAfterSel <= after) {
      endIdx = curIdx;
      startIdx = endIdx - (count - 1);
    } else {
      startIdx = selIdx - before;
      endIdx = selIdx + after;
      if (endIdx > curIdx) {
        endIdx = curIdx;
        startIdx = endIdx - (count - 1);
      }
    }

    var earliest = earliestMonthWithData();
    if (earliest) {
      var minStart = ymToIndex(earliest.y, earliest.m) - 2;
      if (startIdx < minStart) startIdx = minStart;
      endIdx = startIdx + (count - 1);
      if (endIdx > curIdx) {
        endIdx = curIdx;
        startIdx = endIdx - (count - 1);
      }
    }

    var slots = [];
    for (var i = 0; i < count; i++) {
      var ym = indexToYm(startIdx + i);
      slots.push({ y: ym.y, m: ym.m });
    }
    return slots;
  }

  function buildReportMonthSeries(selY, selM, count, now) {
    return computeReportChartWindow(selY, selM, count, now).map(function (slot) {
      var data = getSummaryData(slot.y, slot.m);
      return {
        y: slot.y,
        m: slot.m,
        key: reportMonthKey(slot.y, slot.m),
        total: data.total,
        byCat: data.byCat,
        entries: data.entries
      };
    });
  }

  function reportStackSegments(byCat) {
    var segs = categories.map(function (c) {
      return { cat: c, amt: byCat[c.id] || 0 };
    }).filter(function (s) { return s.amt > 0; });
    segs.sort(function (a, b) { return a.amt - b.amt; });
    return segs;
  }

  function reportChartCompareText(months, selY, selM) {
    if (!months.length) return '';
    var idx = -1;
    for (var i = 0; i < months.length; i++) {
      if (months[i].y === selY && months[i].m === selM) { idx = i; break; }
    }
    if (idx < 0) idx = months.length - 1;
    var cur = months[idx];
    var label = monthName(new Date(cur.y, cur.m, 1));
    var withSpend = months.filter(function (mo) { return mo.total > 0; });
    var avg = 0;
    if (withSpend.length) {
      avg = withSpend.reduce(function (s, mo) { return s + mo.total; }, 0) / withSpend.length;
    }
    var parts = [];
    if (idx > 0) {
      var prev = months[idx - 1].total;
      var diff = cur.total - prev;
      if (cur.total === 0 && prev === 0) {
        parts.push('No spending in ' + label + ' or the prior month.');
      } else {
        var pct = prev > 0 ? Math.round((diff / prev) * 100) : (cur.total > 0 ? 100 : 0);
        var arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        var tone = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
        parts.push('<span class="trend-pill ' + tone + '">' + arrow + ' ' + fmtMoneyDisplay(Math.abs(diff))
          + (prev > 0 ? ' (' + (diff >= 0 ? '+' : '') + pct + '%)' : '')
          + '</span> <span class="trend-words">' + label + ' vs prior month</span>');
      }
    } else if (months.length === 1) {
      parts.push(cur.total > 0
        ? 'First month in view — ' + fmtMoneyDisplay(cur.total) + ' total.'
        : 'No spending in ' + label + ' yet.');
    }
    if (avg > 0 && withSpend.length > 1) {
      parts.push('<span class="report-avg-chip">Avg ' + fmtMoneyDisplay(avg) + ' across months with spending</span>');
    }
    return parts.join(' · ');
  }

  var reportChartAnimGen = 0;
  var lastReportChartWindowStart = null;
  var reportChartPickLockUntil = 0;
  var reportChartLastPickAt = 0;
  var reportChartLastPickKey = '';
  var reportChartBlockClickUntil = 0;

  function reportChartLayout(monthCount, containerW) {
    var padL = 10;
    var padR = 10;
    var padT = 10;
    var padB = 28;
    var chartH = 196;
    var barGap = monthCount > 6 ? 4 : 6;
    var cw = Math.max(260, containerW || 300);
    var barW = Math.floor((cw - padL - padR - barGap * (monthCount - 1)) / monthCount);
    barW = Math.max(22, barW);
    if (monthCount <= 6) barW = Math.min(40, barW);
    var chartW = padL + padR + monthCount * barW + barGap * (monthCount - 1);
    var fits = chartW <= cw + 1;
    if (fits && chartW < cw) chartW = cw;
    return { padL: padL, padR: padR, padT: padT, padB: padB, chartH: chartH, barGap: barGap, barW: barW, chartW: chartW, fits: fits };
  }

  function buildReportChartSvg(months, selY, selM, progress, layout) {
    var n = months.length;
    if (!n || !layout) return '';
    var chartW = layout.chartW;
    var chartH = layout.chartH;
    var padT = layout.padT;
    var padB = layout.padB;
    var padL = layout.padL;
    var padR = layout.padR;
    var plotH = chartH - padT - padB;
    var max = Math.max.apply(null, months.map(function (mo) { return mo.total; }));
    if (!max || max <= 0) max = 1;
    var withSpend = months.filter(function (mo) { return mo.total > 0; });
    var avg = withSpend.length
      ? withSpend.reduce(function (s, mo) { return s + mo.total; }, 0) / withSpend.length
      : 0;
    var barGap = layout.barGap;
    var barW = layout.barW;
    var p = Math.max(0, Math.min(1, progress));
    var svgClass = 'report-chart-svg' + (layout.fits ? ' report-chart-svg--fit' : '');
    var svg = '<svg class="' + svgClass + '" viewBox="0 0 ' + chartW + ' ' + chartH
      + '" role="img" aria-label="Monthly spending by category" preserveAspectRatio="xMinYMid meet">';
    if (avg > 0) {
      var avgY = padT + plotH - (avg / max) * plotH;
      svg += '<line class="report-avg-line" x1="' + padL + '" y1="' + avgY + '" x2="' + (chartW - padR)
        + '" y2="' + avgY + '" stroke-dasharray="4 4" />';
      svg += '<text class="report-avg-label" x="' + (chartW - padR - 2) + '" y="' + (avgY - 5) + '" text-anchor="end">Avg</text>';
    }
    months.forEach(function (mo, i) {
      var x = padL + i * (barW + barGap);
      var baseY = padT + plotH;
      var isSel = mo.y === selY && mo.m === selM;
      svg += '<rect class="report-bar-track" x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + plotH + '" rx="4" />';
      var yTop = baseY;
      reportStackSegments(mo.byCat).forEach(function (seg) {
        var h = (seg.amt / max) * plotH * p;
        if (h < 0.5) return;
        yTop -= h;
        svg += '<rect class="report-bar-seg" fill="' + seg.cat.color + '" x="' + x + '" y="' + yTop
          + '" width="' + barW + '" height="' + h + '" rx="2" />';
      });
      svg += '<rect class="report-bar-hit" tabindex="0" role="button" aria-label="' + escHtml(monthName(new Date(mo.y, mo.m, 1)))
        + '" data-report-month="' + mo.key + '" x="' + x + '" y="' + padT + '" width="' + barW + '" height="' + plotH + '" fill="transparent" />';
      if (isSel) {
        svg += '<rect class="report-bar-outline" x="' + (x - 1) + '" y="' + (padT - 1) + '" width="' + (barW + 2)
          + '" height="' + (plotH + 2) + '" rx="5" fill="none" />';
      }
      svg += '<text class="report-bar-label' + (isSel ? ' is-sel' : '') + '" x="' + (x + barW / 2) + '" y="' + (padT + plotH + 16)
        + '" text-anchor="middle">' + escHtml(monthShort(new Date(mo.y, mo.m, 1))) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  function runReportChartWindowAnim(wrap, dir) {
    if (!wrap || !dir || prefersReducedMotion()) return;
    wrap.classList.remove('report-chart-window-anim', 'report-chart-window-left', 'report-chart-window-right');
    wrap.classList.add('report-chart-window-anim', dir > 0 ? 'report-chart-window-right' : 'report-chart-window-left');
    window.setTimeout(function () {
      wrap.classList.remove('report-chart-window-anim', 'report-chart-window-left', 'report-chart-window-right');
    }, 180);
  }

  function animateReportChart(months, selY, selM, scrollEl, windowAnimDir) {
    var wrap = document.getElementById('reportChartSvgWrap');
    if (!wrap) return;
    var containerW = scrollEl ? scrollEl.clientWidth : 300;
    var layout = reportChartLayout(months.length, containerW);
    reportChartAnimGen += 1;
    var gen = reportChartAnimGen;
    runReportChartWindowAnim(wrap, windowAnimDir);
    function afterDraw() {
      if (scrollEl) scrollEl.scrollLeft = 0;
    }
    runChartAnim(420, function (t) {
      if (gen !== reportChartAnimGen) return;
      wrap.innerHTML = buildReportChartSvg(months, selY, selM, t, layout);
    }, afterDraw);
  }

  function selectReportMonthFromChart(monthKey) {
    var now = Date.now();
    if (now < reportChartPickLockUntil) return;
    if (monthKey === reportChartLastPickKey && now - reportChartLastPickAt < 450) return;
    if ($reportMonth.value === monthKey) return;
    reportChartPickLockUntil = now + 450;
    reportChartBlockClickUntil = now + 650;
    reportChartLastPickKey = monthKey;
    reportChartLastPickAt = now;
    $reportMonth.value = monthKey;
    updateMonthPillLabels();
    renderReport();
  }

  function sortReportTransactions(list, sort) {
    var out = list.slice();
    if (sort === 'largest') {
      out.sort(function (a, b) {
        if (b.amount !== a.amount) return b.amount - a.amount;
        return b.ts - a.ts;
      });
    } else if (sort === 'latest') {
      out.sort(function (a, b) { return b.ts - a.ts; });
    } else {
      out.sort(function (a, b) { return b.ts - a.ts; });
    }
    return out;
  }

  function recurringGroupLabel(g) {
    var best = null;
    Object.keys(g.labels).forEach(function (k) {
      if (!best || g.labels[k] > best.count) best = { text: k, count: g.labels[k] };
    });
    if (best) return best.text;
    return g.entries.length ? (g.entries[0].note || '').trim() : 'Purchase';
  }

  function groupRecurringEntries(list) {
    var groups = {};
    var order = [];
    list.forEach(function (e) {
      var key = descriptionMatchKey(e.note || '');
      if (!key) key = '__solo:' + (e.id || e.ts);
      if (!groups[key]) {
        groups[key] = { key: key, labels: {}, entries: [], total: 0 };
        order.push(key);
      }
      var raw = (e.note || '').trim();
      if (raw) groups[key].labels[raw] = (groups[key].labels[raw] || 0) + 1;
      groups[key].entries.push(e);
      groups[key].total += e.amount;
    });
    return order.map(function (k) {
      var g = groups[k];
      g.count = g.entries.length;
      g.label = recurringGroupLabel(g);
      g.entries.sort(function (a, b) { return b.ts - a.ts; });
      return g;
    }).sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      return b.total - a.total;
    });
  }

  function splitRecurringGroups(groups) {
    var multi = [];
    var oneTime = [];
    groups.forEach(function (g) {
      if (g.count >= 2) multi.push(g);
      else oneTime.push(g);
    });
    return { multi: multi, oneTime: oneTime };
  }

  function renderReportTxRow(e) {
    var d = new Date(e.ts);
    var cat = getCat(e.categoryId);
    var day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    var text = escHtml(cat.name) + (e.note ? ' — ' + escHtml(e.note) : '');
    return '<tr><td class="report-tx-date">' + day + '</td><td class="report-cat-cell">'
      + '<span class="report-tx-label">' + iconBadge(cat, 'xs')
      + '<span class="report-tx-label-text">' + text + '</span></span></td>'
      + '<td class="report-tx-amt">' + fmtMoneyDisplay(e.amount) + '</td></tr>';
  }

  function renderRecurringGroupsHtml(groups) {
    var split = splitRecurringGroups(groups);
    var html = '<div class="report-recur-list">';
    split.multi.forEach(function (g) {
      html += '<details class="report-recur-group">';
      html += '<summary class="report-recur-summary">';
      html += '<span class="report-recur-title">' + escHtml(g.label) + '</span>';
      html += '<span class="report-recur-meta">';
      html += '<span class="report-recur-count">' + g.count + '×</span>';
      html += '<span class="report-recur-total">' + fmtMoneyDisplay(g.total) + '</span>';
      html += '</span></summary>';
      html += '<table class="report-table report-tx-table report-recur-table"><tbody>';
      g.entries.forEach(function (e) { html += renderReportTxRow(e); });
      html += '</tbody></table></details>';
    });
    if (split.oneTime.length) {
      var otEntries = [];
      var otTotal = 0;
      split.oneTime.forEach(function (g) {
        g.entries.forEach(function (e) {
          otEntries.push(e);
          otTotal += e.amount;
        });
      });
      otEntries.sort(function (a, b) { return b.ts - a.ts; });
      html += '<details class="report-recur-onetime">';
      html += '<summary class="report-recur-onetime-summary">';
      html += '<span class="report-recur-onetime-label">One-time</span>';
      html += '<span class="report-recur-meta report-recur-onetime-meta">';
      html += otEntries.length + ' charge' + (otEntries.length === 1 ? '' : 's');
      html += ' · ' + fmtMoneyDisplay(otTotal);
      html += '</span></summary>';
      html += '<table class="report-table report-tx-table report-recur-table"><tbody>';
      otEntries.forEach(function (e) { html += renderReportTxRow(e); });
      html += '</tbody></table></details>';
    }
    html += '</div>';
    return html;
  }

  function segButton(dataAttr, value, label, active) {
    return '<button type="button" class="seg-btn' + (active ? ' is-active' : '') + '" ' + dataAttr + '="' + value + '">' + label + '</button>';
  }

  var reportBodyWired = false;
  function wireReportBody() {
    if (reportBodyWired || !$reportBody) return;
    reportBodyWired = true;
    $reportBody.addEventListener('pointerup', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      var monthHit = e.target.closest('[data-report-month]');
      if (!monthHit || !monthHit.dataset.reportMonth) return;
      e.preventDefault();
      e.stopPropagation();
      selectReportMonthFromChart(monthHit.dataset.reportMonth);
    }, true);
    $reportBody.addEventListener('click', function (e) {
      if (Date.now() < reportChartBlockClickUntil && e.target.closest('[data-report-month]')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      var rangeBtn = e.target.closest('[data-report-range]');
      if (rangeBtn) {
        var n = parseInt(rangeBtn.dataset.reportRange, 10);
        if (n === 6 || n === 12) {
          uiState.reportChartMonths = n;
          saveUI();
          renderReport();
        }
        return;
      }
      var sortBtn = e.target.closest('[data-report-sort]');
      if (sortBtn) {
        var s = sortBtn.dataset.reportSort;
        if (s === 'latest' || s === 'largest' || s === 'recurring') {
          uiState.reportTxSort = s;
          saveUI();
          renderReport();
        }
      }
    });
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

  function prefersLightScheme() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  var summaryAnimId = null;
  var totalAnimId = null;
  var summaryAnimGen = 0;
  var selectedLegendCatId = null;
  var displayedTotal = 0;
  var lastDonutData = null;
  var homeDonutIntroDone = false;

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

  var DONUT_VIEW = 220;
  var DONUT_R_OUTER = 92;
  var DONUT_R_INNER = 58;
  var donutMeasureCanvas = null;
  var donutMeasureCtx = null;

  function measureDonutTextWidth(text, fontSizePx, fontWeight) {
    if (!donutMeasureCanvas) {
      donutMeasureCanvas = document.createElement('canvas');
      donutMeasureCtx = donutMeasureCanvas.getContext('2d');
    }
    if (!donutMeasureCtx) return String(text || '').length * fontSizePx * 0.56;
    donutMeasureCtx.font = (fontWeight || 400) + ' ' + fontSizePx
      + 'px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    return donutMeasureCtx.measureText(String(text || '')).width;
  }

  function layoutDonutCenter() {
    var wrap = $('donutWrap');
    if (!wrap || !$donutCenterValue || !$donutCenterLabel || !$donutCenterSub) return;
    var wrapW = wrap.getBoundingClientRect().width;
    if (wrapW < 8) return;

    var innerD = wrapW * ((DONUT_R_INNER * 2) / DONUT_VIEW);
    var box = innerD * 0.76;
    wrap.style.setProperty('--donut-inner-box', Math.round(box) + 'px');

    var valueText = ($donutCenterValue.textContent || '').trim();
    var minVal = 11;
    var maxVal = 22;
    var valueSize = maxVal;
    var fitWidth = box * 0.96;

    while (valueSize > minVal && measureDonutTextWidth(valueText, valueSize, 700) > fitWidth) {
      valueSize -= 0.5;
    }

    var labelSize = Math.min(13, Math.max(10, Math.round(valueSize * 0.59)));
    var subSize = Math.min(12, Math.max(9, Math.round(valueSize * 0.55)));
    wrap.style.setProperty('--donut-center-value-size', valueSize.toFixed(2) + 'px');
    wrap.style.setProperty('--donut-center-label-size', labelSize + 'px');
    wrap.style.setProperty('--donut-center-sub-size', subSize + 'px');

    var labelWrap = $donutCenterLabel.querySelector('.donut-center-label-wrap');
    var nameSpan = $donutCenterLabel.querySelector('.donut-center-cat-name');
    if (nameSpan) nameSpan.style.maxWidth = '';

    if (nameSpan && labelWrap) {
      var catName = (nameSpan.textContent || '').trim();
      var minLabel = 9;
      var ls = labelSize;
      while (ls > minLabel && measureDonutTextWidth(catName, ls, 600) > fitWidth) {
        ls -= 0.5;
      }
      labelSize = ls;
      wrap.style.setProperty('--donut-center-label-size', ls.toFixed(2) + 'px');
      var labelShrink = 0;
      while (labelShrink < 10 && labelWrap.scrollWidth > box + 1 && ls > minLabel) {
        ls = Math.max(minLabel, ls - 0.5);
        wrap.style.setProperty('--donut-center-label-size', ls.toFixed(2) + 'px');
        labelShrink += 1;
      }
    }

    var stack = $('donutCenterStack');
    var maxH = box * 1.02;
    var vert = 0;
    while (stack && stack.scrollHeight > maxH && valueSize > minVal && vert < 14) {
      valueSize = Math.max(minVal, valueSize - 0.75);
      labelSize = Math.min(13, Math.max(9, Math.round(valueSize * 0.59)));
      subSize = Math.min(12, Math.max(9, Math.round(valueSize * 0.55)));
      wrap.style.setProperty('--donut-center-value-size', valueSize.toFixed(2) + 'px');
      wrap.style.setProperty('--donut-center-label-size', labelSize + 'px');
      wrap.style.setProperty('--donut-center-sub-size', subSize + 'px');
      vert += 1;
    }
  }

  function updateDonutCenter(catId, total, byCat) {
    if (!$donutCenterLabel || !$donutCenterValue || !$donutCenterSub) return;
    if (catId && byCat[catId] > 0) {
      var c = getCat(catId);
      var amt = byCat[catId];
      var pct = total > 0 ? Math.round((amt / total) * 100) : 0;
      $donutCenterLabel.innerHTML = '<span class="donut-center-label-wrap donut-center-label-wrap--stacked">' + iconBadge(c, 'xs') + '<span class="donut-center-cat-name">' + escHtml(c.name) + '</span></span>';
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
    layoutDonutCenter();
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
    var cx = DONUT_VIEW / 2;
    var cy = DONUT_VIEW / 2;
    var rOuter = DONUT_R_OUTER;
    var rInner = DONUT_R_INNER;
    var rows = categories
      .map(function (c) { return { c: c, amt: byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });

    if (total === 0 || rows.length === 0) {
      if ($donutChart) {
        $donutChart.innerHTML = '<circle cx="' + cx + '" cy="' + cy + '" r="' + rOuter + '" fill="none" stroke="' + cssVar('--raised', '#1F222B') + '" stroke-width="' + (rOuter - rInner) + '"/>';
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
      var strokeW = highlightId === r.c.id ? 3 : (prefersLightScheme() ? 1.5 : 0);
      html += '<path class="donut-seg" data-cat="' + r.c.id + '" d="' + path + '" fill="' + donutSegmentColor(r.c.color) + '"'
        + ' opacity="' + opacity + '" stroke="' + cssVar('--bg', '#0B0C10') + '" stroke-width="' + strokeW + '"/>';
      angle = end;
    });
    $donutChart.innerHTML = html;
  }

  function playHomeDonutIntro() {
    var wrap = $('donutWrap');
    if (!wrap || homeDonutIntroDone) return;
    homeDonutIntroDone = true;
    if (prefersReducedMotion()) return;
    wrap.classList.add('donut-wrap--fade-in');
    function onEnd(ev) {
      if (ev.animationName !== 'donut-wrap-fade-in') return;
      wrap.classList.remove('donut-wrap--fade-in');
      wrap.removeEventListener('animationend', onEnd);
    }
    wrap.addEventListener('animationend', onEnd);
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
      var budgetLimit = budgets[r.c.id] || 0;
      var budgetPct = budgetLimit > 0 ? Math.min(100, (r.amt / budgetLimit) * 100) : 0;
      var budgetBar = '';
      if (budgetLimit > 0) {
        var bColor = r.amt > budgetLimit ? cssVar('--danger', '#FF5A5F') : r.c.color;
        budgetBar = '<div class="legend-budget-bar"><div class="legend-budget-fill" style="width:' + budgetPct + '%;background:' + bColor + '"></div></div>';
      }
      row.innerHTML = '<span class="name">' + iconBadge(r.c, 'sm') + ' '
        + escHtml(r.c.name) + ' <span class="pct">· ' + pct + '%</span></span>'
        + '<span class="amt">' + fmtMoneyDisplay(r.amt) + '</span>' + budgetBar;
      row.addEventListener('click', function () {
        selectedLegendCatId = selectedLegendCatId === r.c.id ? null : r.c.id;
        renderLegendInteractive(byCat, total);
        var activeRow = $legendEl.querySelector('.legend-row.active');
        if (activeRow) playCatIcon(activeRow.querySelector('.cat-badge'));
        drawDonutFrame(byCat, total, 1, selectedLegendCatId);
        updateDonutCenter(selectedLegendCatId, total, byCat);
      });
      $legendEl.appendChild(row);
    });
    refreshIconObservers($legendEl);
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
      $insightsList.innerHTML = '<div class="insight-chip"><p class="insight-kicker">Insight</p>'
        + '<p class="insight-text">Log expenses to see personalized insights here.</p></div>';
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
        kickerIcon: 'category',
        cat: topCat.c,
        title: 'Top category',
        text: topCat.c.name + ' leads at $' + fmtMoney(topCat.amt) + ' (' + share + '% of the month).'
      });
    }

    if (prevTotal > 0 || data.total > 0) {
      var diff = data.total - prevTotal;
      var dir = diff > 0 ? 'more' : diff < 0 ? 'less' : 'the same as';
      var pctTxt = prevTotal > 0 ? ' (' + (diff >= 0 ? '+' : '') + Math.round((diff / prevTotal) * 100) + '%)' : '';
      items.push({
        kickerIcon: diff > 0 ? 'ui-trend-up' : diff < 0 ? 'ui-trend-down' : 'ui-trend-flat',
        title: 'Vs last month',
        text: diff === 0
          ? 'Spending matches last month at $' + fmtMoney(data.total) + '.'
          : 'You spent $' + fmtMoney(Math.abs(diff)) + ' ' + dir + ' than last month' + pctTxt + '.'
      });
    }

    var merchant = topMerchantNote(data.entries);
    if (merchant) {
      items.push({
        kickerIcon: 'ui-note',
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
          kickerIcon: 'ui-insight',
          title: 'Month-end forecast',
          text: 'At today\'s pace you\'ll land around $' + fmtMoney(projected) + ' by the ' + monthShort(new Date(y, m, 1)) + ' close.'
        });
      }
    } else if (!isCurrent && data.total > 0) {
      items.push({
        kickerIcon: 'ui-calendar',
        title: 'Month closed',
        text: 'You spent $' + fmtMoney(data.total) + ' across ' + data.entries.length + ' transaction'
          + (data.entries.length === 1 ? '' : 's') + '.'
      });
    }

    categories.forEach(function (c) {
      var cur = data.byCat[c.id] || 0;
      var prev = entries.filter(function (e) { return isSameMonth(e.ts, prevY, prevM) && e.categoryId === c.id; })
        .reduce(function (s, e) { return s + e.amount; }, 0);
      if (cur > 0 && prev > 0) {
        var pctCh = Math.round(((cur - prev) / prev) * 100);
        if (Math.abs(pctCh) >= 8) {
          items.unshift({
            kickerIcon: 'category',
            cat: c,
            title: 'Insight',
            text: c.name + ' is ' + (pctCh > 0 ? 'up' : 'down') + ' ' + Math.abs(pctCh) + '% vs last month'
          });
        }
      }
    });

    function insightKicker(it) {
      var lead = '';
      if (it.kickerIcon === 'category' && it.cat) lead = iconBadge(it.cat, 'xs');
      else if (it.kickerIcon) lead = uiIcon(it.kickerIcon, 'xs');
      return '<span class="insight-kicker-inner">' + lead + '<span>' + escHtml(it.title) + '</span></span>';
    }

    var html = '';
    items.slice(0, 8).forEach(function (it) {
      html += '<div class="insight-chip" role="listitem">'
        + '<p class="insight-kicker">' + insightKicker(it) + '</p>'
        + '<p class="insight-text">' + escHtml(it.text) + '</p></div>';
    });
    $insightsList.innerHTML = html;
  }

  function renderHeroBudget(y, m, total) {
    if (!$heroBudgetWrap) return;
    var budget = getTotalBudgetLimit();
    if (budget <= 0) {
      $heroBudgetWrap.hidden = true;
      return;
    }
    $heroBudgetWrap.hidden = false;
    var pct = Math.min(100, Math.round((total / budget) * 100));
    var left = Math.max(0, budget - total);
    var now = new Date();
    var isCurrent = y === now.getFullYear() && m === now.getMonth();
    var dim = daysInMonth(y, m);
    var daysLeft = isCurrent ? Math.max(0, dim - now.getDate()) : 0;
    var fillColor = pct >= 100 ? cssVar('--danger', '#FF5A5F') : pct >= 80 ? cssVar('--warn', '#F5A524') : cssVar('--accent', '#5B8CFF');
    $heroBudgetFill.style.width = pct + '%';
    $heroBudgetFill.style.background = fillColor;
    if ($heroBudgetPct) {
      $heroBudgetPct.textContent = pct + '%';
      $heroBudgetPct.style.color = fillColor;
    }
    var meta = fmtMoneyDisplay(left) + ' left of ' + fmtMoneyDisplay(budget);
    if (isCurrent && daysLeft > 0) meta += ' · ' + daysLeft + ' days to go';
    if ($heroBudgetMeta) $heroBudgetMeta.textContent = meta;
    if ($heroBudgetPace && isCurrent && dim > 0) {
      var expectedPct = Math.min(100, (now.getDate() / dim) * 100);
      $heroBudgetPace.hidden = false;
      $heroBudgetPace.style.left = expectedPct + '%';
    } else if ($heroBudgetPace) {
      $heroBudgetPace.hidden = true;
    }
  }

  function updateMonthPillLabels() {
    if ($summaryMonth && $summaryMonthPillLabel && $summaryMonth.value) {
      var p = $summaryMonth.value.split('-');
      $summaryMonthPillLabel.textContent = monthName(new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, 1));
    }
    if ($reportMonth && $reportMonthPillLabel && $reportMonth.value) {
      var rp = $reportMonth.value.split('-');
      $reportMonthPillLabel.textContent = monthName(new Date(parseInt(rp[0], 10), parseInt(rp[1], 10) - 1, 1));
    }
  }

  function shiftMonthInput(input, delta) {
    if (!input || !input.value) return;
    var p = input.value.split('-');
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1 + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    input.value = y + '-' + pad2(m + 1);
    input.dispatchEvent(new Event('change'));
    updateMonthPillLabels();
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
    if ($monthLbl) $monthLbl.textContent = '· ' + monthName(new Date(y, m, 1));
    updateMonthPillLabels();
    renderHeroBudget(y, m, data.total);
    updateHomeRecapTeaser();
    animateTotalDisplay(data.total);
    prepareDonutChart(data.byCat, data.total);
    renderLegendInteractive(data.byCat, data.total);
    var trendMonths = prepareTrendChart(y, m);
    var dailyTotals = prepareDailyChart(y, m);
    renderInsights(y, m);
    renderHomeForecastCard();
    renderBudgets(data.byCat);
    if ($donutChart) {
      drawDonutFrame(data.byCat, data.total, 1, selectedLegendCatId);
      playHomeDonutIntro();
    }
    if ($trendChart || $dailyChart) {
      runChartAnim(750, function (p) {
        drawTrendFrame(trendMonths, p, y, m);
        drawDailyFrame(dailyTotals, y, m, p);
      }, function () {
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
        + '<span class="amounts' + (over ? ' over' : '') + '">' + fmtMoneyDisplay(spent) + ' / ' + fmtMoneyDisplay(limit)
        + (over ? ' ' + uiIcon('ui-alert', 'xs') : '') + '</span>'
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
      html += '<div class="summary-row"><span class="label">Largest expense</span><span class="value summary-value-icon">'
        + fmtMoneyDisplay(largest.amount) + ' ' + iconBadge(lcat, 'xs') + '</span></div>';
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

  // ---------- Spending Wrapped (1.7 story slides) ----------
  function buildWrappedPayload(y, m) {
    if (!EW) return { y: y, m: m, empty: true, slides: [] };
    return EW.buildWrappedData({
      entries: entries,
      categories: categories,
      budgets: budgets,
      recurringItems: recurringItems,
      accounts: accounts,
      y: y,
      m: m
    });
  }

  function computeRecapData(y, m) {
    var data = getSummaryData(y, m);
    var wrapped = buildWrappedPayload(y, m);
    return {
      y: y,
      m: m,
      total: data.total,
      entryCount: data.entries.length,
      wrapped: wrapped
    };
  }

  var wrappedMonth = null;
  var wrappedPayload = null;
  var wrappedSlideIndex = 0;
  var wrappedSlideVisitKey = '';

  function wrappedMonthTitle(y, m) {
    return 'Spending Wrapped · ' + monthShort(new Date(y, m, 1)) + ' ' + y;
  }

  function wrappedTrendArrow(diff) {
    if (diff > 0) return '↗';
    if (diff < 0) return '↘';
    return '→';
  }

  function wrappedPctLabel(n) {
    if (n == null || isNaN(n)) return '';
    return (n > 0 ? '+' : '') + n + '%';
  }

  function renderWrappedSlideHtml(slideId, d, parts) {
    if (slideId === 'total') {
      var cmp = d.compare && d.vsLast;
      var cmpLine = '';
      if (cmp) {
        var less = d.vsLast.diff < 0;
        cmpLine = '<p class="wrapped-hero-sub">'
          + wrappedTrendArrow(d.vsLast.diff) + ' '
          + fmtMoneyDisplay(Math.abs(d.vsLast.diff)) + (less ? ' less' : ' more') + ' than '
          + monthShort(new Date(d.bars[d.bars.length - 2].y, d.bars[d.bars.length - 2].m, 1))
          + '</p>';
      }
      var maxBar = 0;
      d.bars.forEach(function (b) { if (b.total > maxBar) maxBar = b.total; });
      var barsHtml = d.bars.map(function (b, i) {
        var h = maxBar > 0 ? Math.max(8, Math.round((b.total / maxBar) * 72)) : 8;
        var cls = b.isCurrent ? ' wrapped-bar-current' : '';
        return '<div class="wrapped-mini-bar' + cls + '" style="--h:' + h + 'px" data-bar-idx="' + i + '">'
          + '<span class="wrapped-mini-bar-val">' + fmtMoneyDisplay(b.total) + '</span>'
          + '<span class="wrapped-mini-bar-fill"></span>'
          + '<span class="wrapped-mini-bar-label">' + escHtml(b.label) + '</span></div>';
      }).join('');
      var vsLeft = '';
      var vsRight = '';
      if (d.compare && d.vsLast) {
        vsLeft = '<div class="wrapped-split-stat"><span class="wrapped-kicker">Vs. ' + monthShort(new Date(d.bars[d.bars.length - 2].y, d.bars[d.bars.length - 2].m, 1)) + '</span>'
          + '<span class="wrapped-stat-lg wrapped-good" data-count="' + d.vsLast.pct + '" data-count-suffix="%" data-count-decimals="0">' + wrappedPctLabel(d.vsLast.pct) + '</span>'
          + '<span class="wrapped-stat-sub">was ' + fmtMoneyDisplay(d.vsLast.prevTotal) + '</span></div>';
      }
      if (d.vsAvg3) {
        vsRight = '<div class="wrapped-split-stat"><span class="wrapped-kicker">Vs. 3-month avg</span>'
          + '<span class="wrapped-stat-lg wrapped-good" data-count="' + d.vsAvg3.diff + '" data-count-prefix="$" data-count-decimals="0">' + (d.vsAvg3.diff < 0 ? '-' : '+') + fmtMoneyDisplay(Math.abs(d.vsAvg3.diff)) + '</span>'
          + '<span class="wrapped-stat-sub">avg ' + fmtMoneyDisplay(d.vsAvg3.avg) + '</span></div>';
      }
      var splitHtml = (vsLeft || vsRight)
        ? '<div class="wrapped-card wrapped-card--dim wrapped-split">' + vsLeft + (vsLeft && vsRight ? '<div class="wrapped-split-divider"></div>' : '') + vsRight + '</div>' : '';
      return '<div class="wrapped-slide" data-slide="total">'
        + '<div class="wrapped-card wrapped-hero wrapped-hero--blue">'
        + '<span class="wrapped-kicker">' + monthShort(new Date(parts.y, parts.m, 1)).toUpperCase() + ' ' + parts.y + '</span>'
        + '<h2 class="wrapped-hero-title">Your month, wrapped.</h2>'
        + '<p class="wrapped-hero-lead">You spent</p>'
        + '<p class="wrapped-hero-num" data-count="' + d.total + '" data-count-prefix="$" data-count-decimals="2">' + fmtMoneyDisplay(d.total) + '</p>'
        + cmpLine
        + '<div class="wrapped-mini-bars">' + barsHtml + '</div></div>'
        + splitHtml
        + '<div class="wrapped-card wrapped-card--dim wrapped-row-card">'
        + '<span class="wrapped-row-icon">' + uiIcon('receipt', 'sm') + '</span>'
        + '<div><strong>' + d.purchaseCount + ' purchases logged</strong>'
        + '<p class="wrapped-stat-sub">Transfers and card payments left out</p></div></div></div>';
    }
    if (slideId === 'topCategory') {
      var top = d.top;
      var stack = d.categories.map(function (row) {
        return '<span class="wrapped-stack-seg" style="width:' + row.sharePct + '%;background:' + row.cat.color + '"></span>';
      }).join('');
      var rows = d.categories.map(function (row) {
        return '<div class="wrapped-cat-row"><span class="wrapped-cat-icon">' + iconBadge(row.cat, 'sm') + '</span>'
          + '<span class="wrapped-cat-name">' + escHtml(row.cat.name) + '</span>'
          + '<span class="wrapped-cat-pct">' + row.sharePct + '%</span>'
          + '<span class="wrapped-cat-amt">' + fmtMoneyDisplay(row.amount) + '</span></div>';
      }).join('');
      var chLine = '';
      if (top.changeFromLast != null) {
        chLine = wrappedTrendArrow(top.changeFromLast) + ' '
          + (top.changeFromLast >= 0 ? 'Up ' : 'Down ') + fmtMoneyDisplay(Math.abs(top.changeFromLast))
          + ' from last month · ' + top.sharePct + '% of your month';
      } else {
        chLine = top.sharePct + '% of your month';
      }
      return '<div class="wrapped-slide" data-slide="topCategory">'
        + '<div class="wrapped-card wrapped-hero wrapped-hero--orange">'
        + '<span class="wrapped-kicker">Top category</span>'
        + '<span class="wrapped-hero-icon">' + iconBadge(top.cat, 'md') + '</span>'
        + '<h2 class="wrapped-hero-title">' + escHtml(top.cat.name) + ' took the lead.</h2>'
        + '<p class="wrapped-hero-num" data-count="' + top.amount + '" data-count-prefix="$" data-count-decimals="2">' + fmtMoneyDisplay(top.amount) + '</p>'
        + '<p class="wrapped-hero-sub">' + escHtml(chLine) + '</p></div>'
        + '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">Where it all went</span>'
        + '<div class="wrapped-stack-bar" data-animate-stack>' + stack + '</div>'
        + '<div class="wrapped-cat-list">' + rows + '</div></div></div>';
    }
    if (slideId === 'regulars') {
      var hero = '';
      if (d.regular) {
        hero = '<div class="wrapped-card wrapped-hero wrapped-hero--gold">'
          + '<span class="wrapped-kicker">Your regular</span>'
          + '<span class="wrapped-hero-icon">' + uiIcon('coffee', 'md') + '</span>'
          + '<h2 class="wrapped-hero-title">' + escHtml(d.regular.name) + ' knows your order.</h2>'
          + '<p class="wrapped-hero-num" data-count="' + d.regular.visits + '" data-count-suffix=" visits" data-count-decimals="0">' + d.regular.visits + ' visits</p>'
          + '<p class="wrapped-hero-sub">' + fmtMoneyDisplay(d.regular.total) + ' total · about '
          + fmtMoneyDisplay(d.regular.avg) + ' a visit</p></div>';
      }
      var fun = '';
      if (d.fun) {
        fun = '<div class="wrapped-card wrapped-card--dim wrapped-row-card">'
          + '<span class="wrapped-row-icon">' + uiIcon('coffee', 'sm') + '</span>'
          + '<div><span class="wrapped-kicker">Fun stat</span><strong>' + d.fun.count + ' ' + d.fun.label + '</strong>'
          + '<p class="wrapped-stat-sub">One every ' + (Math.round(d.fun.daysBetween * 10) / 10) + ' days · '
          + fmtMoneyDisplay(d.fun.total) + '</p></div></div>';
      }
      var chips = '';
      if (d.newPlaces && d.newPlaces.length) {
        chips = '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">' + d.newPlaces.length + ' new places this month</span>'
          + '<div class="wrapped-chips">' + d.newPlaces.map(function (n) {
            return '<span class="wrapped-chip" data-chip>' + escHtml(n) + '</span>';
          }).join('') + '</div>'
          + '<p class="wrapped-stat-sub">First time they\'ve shown up in your history.</p></div>';
      }
      return '<div class="wrapped-slide" data-slide="regulars">' + hero + fun + chips + '</div>';
    }
    if (slideId === 'bigMoments') {
      var day = d.biggestDay;
      var dayLabel = new Date(day.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      var wk = d.weekday;
      var wkMax = 0;
      wk.totals.forEach(function (v) { if (v > wkMax) wkMax = v; });
      var wkBars = wk.totals.map(function (v, i) {
        var h = wkMax > 0 ? Math.max(6, Math.round((v / wkMax) * 64)) : 6;
        var cls = i === wk.topIndex ? ' wrapped-bar-current wrapped-bar-pink' : '';
        return '<span class="wrapped-wday-bar' + cls + '" style="--h:' + h + 'px" data-bar-idx="' + i + '"></span>';
      }).join('');
      var wkLabels = wk.labels.map(function (l, i) {
        return '<span' + (i === wk.topIndex ? ' class="wrapped-wday-active"' : '') + '>' + l + '</span>';
      }).join('');
      return '<div class="wrapped-slide" data-slide="bigMoments">'
        + '<div class="wrapped-card wrapped-hero wrapped-hero--pink">'
        + '<span class="wrapped-kicker">Big moments</span>'
        + '<h2 class="wrapped-hero-title">Your biggest day</h2>'
        + '<p class="wrapped-hero-num wrapped-hero-num--text">' + escHtml(dayLabel) + '</p>'
        + '<p class="wrapped-hero-sub">' + fmtMoneyDisplay(day.total) + ' across ' + day.stops + ' stops</p>'
        + '<p class="wrapped-hero-detail">' + escHtml(day.merchants.join(' · ')) + '</p></div>'
        + '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">Biggest single purchase</span>'
        + '<div class="wrapped-purchase-row"><span class="wrapped-row-icon">' + iconBadge(d.biggestPurchase.cat, 'sm') + '</span>'
        + '<div><strong>' + escHtml(d.biggestPurchase.merchant) + '</strong>'
        + '<p class="wrapped-stat-sub">' + escHtml(d.biggestPurchase.cat.name) + ' · '
        + new Date(d.biggestPurchase.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + '</p></div>'
        + '<span class="wrapped-cat-amt">' + fmtMoneyDisplay(d.biggestPurchase.amount) + '</span></div></div>'
        + '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">' + wk.topName + 's are your day</span>'
        + '<div class="wrapped-wday-chart">' + wkBars + '</div>'
        + '<div class="wrapped-wday-labels">' + wkLabels + '</div>'
        + '<p class="wrapped-stat-sub">' + wk.topSharePct + '% of your spending happened on a ' + wk.topName + '.</p></div></div>';
    }
    if (slideId === 'recurring') {
      var worth = d.worthLook.map(function (w) {
        var badge = w.type === 'new' ? '<span class="wrapped-badge wrapped-badge--new">New</span>'
          : w.type === 'priceUp' ? '<span class="wrapped-badge wrapped-badge--up">Price up</span>' : '';
        var sub = w.type === 'new'
          ? escHtml(w.item.cat.name) + ' · first charge ' + new Date(w.item.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : escHtml(w.item.cat.name) + (w.prevAmount ? ' · was ' + fmtMoneyDisplay(w.prevAmount) + ' last month' : '');
        return '<div class="wrapped-purchase-row"><span class="wrapped-row-icon">' + uiIcon('ticket', 'sm') + '</span>'
          + '<div><strong>' + escHtml(w.item.name) + ' ' + badge + '</strong><p class="wrapped-stat-sub">' + sub + '</p></div>'
          + '<span class="wrapped-cat-amt">' + fmtMoneyDisplay(w.item.amount) + '</span></div>';
      }).join('');
      var steadyNames = d.steady.names.join(', ');
      if (d.steady.count > d.steady.names.length) steadyNames += ' + ' + (d.steady.count - d.steady.names.length) + ' more';
      return '<div class="wrapped-slide" data-slide="recurring">'
        + '<div class="wrapped-card wrapped-hero wrapped-hero--purple">'
        + '<span class="wrapped-kicker">On repeat</span>'
        + '<span class="wrapped-hero-icon">' + uiIcon('ui-repeat', 'md') + '</span>'
        + '<h2 class="wrapped-hero-title">Your recurring charges.</h2>'
        + '<p class="wrapped-hero-num" data-count="' + d.total + '" data-count-prefix="$" data-count-decimals="2">' + fmtMoneyDisplay(d.total) + '</p>'
        + '<p class="wrapped-hero-sub">' + d.count + ' charges · ' + d.sharePct + '% of your month</p></div>'
        + (worth ? '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">Worth a look</span>' + worth + '</div>' : '')
        + '<div class="wrapped-card wrapped-card--dim wrapped-row-card"><span class="wrapped-row-icon wrapped-row-icon--ok">' + uiIcon('ui-trend-down', 'sm') + '</span>'
        + '<div><strong>' + d.steady.count + ' steady, same as last month</strong>'
        + '<p class="wrapped-stat-sub">' + escHtml(steadyNames) + '</p></div>'
        + '<span class="wrapped-cat-amt">' + fmtMoneyDisplay(d.steady.total) + '</span></div></div>';
    }
    if (slideId === 'budgets') {
      var rows = d.rows.map(function (r) {
        var status = r.over ? fmtMoneyDisplay(r.spent - r.limit) + ' over' : fmtMoneyDisplay(r.delta) + ' left';
        var cls = r.over ? 'wrapped-budget-over' : 'wrapped-budget-ok';
        return '<div class="wrapped-budget-row"><div class="wrapped-budget-head">'
          + '<span class="wrapped-cat-icon">' + iconBadge(r.cat, 'sm') + '</span>'
          + '<span class="wrapped-cat-name">' + escHtml(r.cat.name) + '</span>'
          + '<span class="wrapped-budget-ratio">' + fmtMoneyDisplay(r.spent) + ' / ' + fmtMoneyDisplay(r.limit) + '</span>'
          + '<span class="wrapped-budget-status ' + cls + '">' + status + '</span></div>'
          + '<div class="wrapped-budget-track"><div class="wrapped-budget-fill ' + cls + '" style="width:' + r.pct + '%" data-bar-pct="' + r.pct + '"></div></div></div>';
      }).join('');
      var under = d.totalDelta >= 0;
      return '<div class="wrapped-slide" data-slide="budgets">'
        + '<div class="wrapped-card wrapped-hero wrapped-hero--green">'
        + '<span class="wrapped-kicker">Budgets</span>'
        + '<h2 class="wrapped-hero-title">You stayed on budget in</h2>'
        + '<p class="wrapped-hero-num" data-count="' + d.onTrack + '" data-count-suffix=" of ' + d.totalCategories + '" data-count-decimals="0">' + d.onTrack + ' of ' + d.totalCategories + '</p>'
        + '<p class="wrapped-hero-sub">' + fmtMoneyDisplay(Math.abs(d.totalDelta)) + (under ? ' under' : ' over') + ' your ' + fmtMoneyDisplay(d.totalLimit) + ' total</p></div>'
        + '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">Category budgets</span>' + rows + '</div></div>';
    }
    if (slideId === 'winsAccounts') {
      var winHero = '';
      if (d.win) {
        winHero = '<div class="wrapped-card wrapped-hero wrapped-hero--teal">'
          + '<span class="wrapped-kicker">Nice work</span>'
          + '<span class="wrapped-hero-icon">' + iconBadge(d.win.cat, 'md') + '</span>'
          + '<h2 class="wrapped-hero-title">' + escHtml(d.win.cat.name) + ' spending dropped.</h2>'
          + '<p class="wrapped-hero-num" data-count="' + d.win.pct + '" data-count-suffix="%" data-count-decimals="0">' + d.win.pct + '%</p>'
          + '<p class="wrapped-hero-sub">' + fmtMoneyDisplay(d.win.cur) + ' vs ' + fmtMoneyDisplay(d.win.prev) + ' last month</p></div>';
      }
      var stack = d.accounts.map(function (a) {
        return '<span class="wrapped-stack-seg" style="width:' + a.sharePct + '%;background:' + a.color + '"></span>';
      }).join('');
      var acctRows = d.accounts.map(function (a) {
        return '<div class="wrapped-purchase-row"><span class="wrapped-row-icon" style="background:' + a.color + '33">'
          + uiIcon(a.id.indexOf('checking') >= 0 ? 'home' : 'receipt', 'sm') + '</span>'
          + '<div><strong>' + escHtml(a.name) + '</strong><p class="wrapped-stat-sub">' + a.sharePct + '% · ' + a.count + ' purchases</p></div>'
          + '<span class="wrapped-cat-amt">' + fmtMoneyDisplay(a.amount) + '</span></div>';
      }).join('');
      var xfer = d.transferSkipped
        ? '<div class="wrapped-card wrapped-card--dim wrapped-row-card"><span class="wrapped-row-icon">' + uiIcon('ui-repeat', 'sm') + '</span>'
          + '<div><strong>' + fmtMoneyDisplay(d.transferSkipped) + ' card payment skipped</strong>'
          + '<p class="wrapped-stat-sub">Transfers aren\'t spending, so we left it out.</p></div></div>' : '';
      return '<div class="wrapped-slide" data-slide="winsAccounts">' + winHero
        + '<div class="wrapped-card wrapped-card--dim"><span class="wrapped-kicker">How you paid</span>'
        + '<div class="wrapped-stack-bar" data-animate-stack>' + stack + '</div>' + acctRows + '</div>'
        + xfer + '</div>';
    }
    if (slideId === 'summary') {
      var tiles = d.tiles.map(function (t) {
        if (!t) return '';
        return '<div class="wrapped-summary-tile"><span class="wrapped-kicker">' + escHtml(t.label) + '</span>'
          + '<strong>' + escHtml(t.title) + '</strong><span class="wrapped-stat-sub">' + escHtml(t.sub) + '</span></div>';
      }).join('');
      var cmp = '';
      if (d.compare && d.vsLastPct != null) {
        cmp = '<p class="wrapped-summary-cmp">' + wrappedTrendArrow(d.vsLastPct) + ' '
          + Math.abs(d.vsLastPct) + '% ' + (d.vsLastPct <= 0 ? 'less' : 'more') + ' than last month</p>';
      }
      return '<div class="wrapped-slide wrapped-slide--summary" data-slide="summary" id="wrappedSummaryCard">'
        + '<div class="wrapped-summary-card">'
        + '<p class="wrapped-summary-head"><span data-ui-icon="ui-sparkles" data-ui-icon-size="sm"></span> My '
        + monthShort(new Date(parts.y, parts.m, 1)) + ', wrapped</p>'
        + '<p class="wrapped-summary-total" data-count="' + d.total + '" data-count-prefix="$" data-count-decimals="2">' + fmtMoneyDisplay(d.total) + '</p>'
        + cmp
        + '<div class="wrapped-summary-grid">' + tiles + '</div>'
        + '<div class="wrapped-summary-foot"><span>Expense Logger</span><span>'
        + monthShort(new Date(parts.y, parts.m, 1)) + ' ' + parts.y + '</span></div></div></div>';
    }
    return '';
  }

  function renderWrappedStories(payload, slideIdx) {
    if (!$wrappedSlides || !payload || payload.empty) {
      if ($wrappedStories) $wrappedStories.hidden = true;
      if ($wrappedEmpty) $wrappedEmpty.hidden = false;
      return;
    }
    if ($wrappedEmpty) $wrappedEmpty.hidden = true;
    if ($wrappedStories) $wrappedStories.hidden = false;
    wrappedPayload = payload;
    wrappedSlideIndex = typeof slideIdx === 'number' ? slideIdx : 0;
    if (wrappedSlideIndex >= payload.slides.length) wrappedSlideIndex = payload.slides.length - 1;
    if (wrappedSlideIndex < 0) wrappedSlideIndex = 0;

    if ($wrappedTopTitle) $wrappedTopTitle.textContent = wrappedMonthTitle(payload.y, payload.m);

    var progHtml = '';
    payload.slides.forEach(function (s, i) {
      progHtml += '<span class="wrapped-progress-seg' + (i <= wrappedSlideIndex ? ' is-on' : '') + (i === wrappedSlideIndex ? ' is-current' : '') + '"></span>';
    });
    if ($wrappedProgress) $wrappedProgress.innerHTML = progHtml;

    var active = payload.slides[wrappedSlideIndex];
    var html = renderWrappedSlideHtml(active.id, active.data, payload);
    $wrappedSlides.innerHTML = html;

    var isSummary = active.id === 'summary';
    if ($wrappedFooterHint) {
      $wrappedFooterHint.hidden = isSummary;
      if (!isSummary && wrappedSlideIndex === 0) {
        $wrappedFooterHint.textContent = 'Tap to see where it went ›';
      } else if (!isSummary) {
        $wrappedFooterHint.textContent = 'Tap to continue ›';
      }
    }
    if ($wrappedSummaryActions) $wrappedSummaryActions.hidden = !isSummary;
    if ($wrappedShareNote) $wrappedShareNote.hidden = !isSummary;
    if ($wrappedTapZones) $wrappedTapZones.style.pointerEvents = isSummary ? 'none' : 'auto';

    if (EI && EI.hydrateUiIcons) EI.hydrateUiIcons($wrappedSlides);
    refreshIconObservers($wrappedSlides);
    runWrappedSlideMotion($wrappedSlides.querySelector('.wrapped-slide'));
  }

  function runWrappedSlideMotion(slideEl) {
    if (!slideEl) return;
    var key = wrappedMonth.y + '-' + wrappedMonth.m + ':' + wrappedSlideIndex;
    if (wrappedSlideVisitKey === key) return;
    wrappedSlideVisitKey = key;
    var reduced = prefersReducedMotion();
    var fadeMs = reduced ? 100 : 250;
    slideEl.style.opacity = '0';
    requestAnimationFrame(function () {
      slideEl.style.transition = 'opacity ' + fadeMs + 'ms ease';
      slideEl.style.opacity = '1';
    });

    slideEl.querySelectorAll('[data-count]').forEach(function (el) {
      var end = parseFloat(el.getAttribute('data-count'), 10);
      if (isNaN(end)) return;
      var prefix = el.getAttribute('data-count-prefix') || '';
      var suffix = el.getAttribute('data-count-suffix') || '';
      var dec = parseInt(el.getAttribute('data-count-decimals') || '0', 10);
      if (reduced) {
        el.textContent = prefix + (dec ? end.toFixed(dec) : String(Math.round(end))) + suffix;
        return;
      }
      var start = 0;
      var dur = 450;
      var t0 = performance.now();
      function tick(now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = start + (end - start) * eased;
        el.textContent = prefix + (dec ? val.toFixed(dec) : String(Math.round(val))) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });

    var barDelay = reduced ? 0 : 40;
    var barDur = reduced ? 0 : 400;
    slideEl.querySelectorAll('[data-bar-idx], .wrapped-budget-fill, .wrapped-stack-bar .wrapped-stack-seg').forEach(function (el, i) {
      if (el.classList.contains('wrapped-stack-seg')) {
        el.style.transform = reduced ? 'scaleX(1)' : 'scaleX(0)';
        el.style.transformOrigin = 'left center';
        setTimeout(function () {
          el.style.transition = 'transform ' + barDur + 'ms ease-out';
          el.style.transform = 'scaleX(1)';
        }, i * barDelay);
        return;
      }
      if (el.classList.contains('wrapped-budget-fill')) {
        var pct = el.getAttribute('data-bar-pct') || el.style.width;
        el.style.width = reduced ? pct : '0%';
        setTimeout(function () {
          el.style.transition = 'width ' + barDur + 'ms ease-out';
          el.style.width = pct;
        }, i * barDelay);
        return;
      }
      var h = el.style.getPropertyValue('--h');
      if (h) {
        el.style.setProperty('--h-anim', reduced ? h : '0px');
        setTimeout(function () {
          el.style.transition = 'height ' + barDur + 'ms ease-out, --h-anim ' + barDur + 'ms ease-out';
          el.style.setProperty('--h-anim', h);
        }, i * barDelay);
      }
    });

    slideEl.querySelectorAll('[data-chip]').forEach(function (chip, i) {
      if (reduced) {
        chip.style.opacity = '1';
        chip.style.transform = 'none';
        return;
      }
      chip.style.opacity = '0';
      chip.style.transform = 'translateY(8px)';
      setTimeout(function () {
        chip.style.transition = 'opacity 200ms ease, transform 200ms ease';
        chip.style.opacity = '1';
        chip.style.transform = 'translateY(0)';
      }, 80 + i * 50);
    });
  }

  function wrappedGo(delta) {
    if (!wrappedPayload || wrappedPayload.empty) return;
    var next = wrappedSlideIndex + delta;
    if (next < 0 || next >= wrappedPayload.slides.length) return;
    wrappedSlideIndex = next;
    renderWrappedStories(wrappedPayload, wrappedSlideIndex);
  }

  function openWrappedModal(y, m) {
    wrappedMonth = { y: y, m: m };
    wrappedSlideVisitKey = '';
    var payload = buildWrappedPayload(y, m);
    if (payload.empty) {
      if ($wrappedStories) $wrappedStories.hidden = true;
      if ($wrappedEmpty) $wrappedEmpty.hidden = false;
    } else {
      renderWrappedStories(payload, 0);
    }
    if ($wrappedModal) {
      $wrappedModal.classList.add('show');
      $wrappedModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeWrappedModal() {
    if ($wrappedModal) {
      $wrappedModal.classList.remove('show');
      $wrappedModal.setAttribute('aria-hidden', 'true');
    }
  }

  function drawWrappedToCanvas(payload, cb) {
    var summary = payload && payload.parts && payload.parts.summary;
    if (!summary) { cb(null); return; }
    var w = 390;
    var h = 680;
    var canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    var ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5B8CFF');
    g.addColorStop(1, '#9B6BFF');
    ctx.fillStyle = g;
    roundRect(ctx, 16, 16, w - 32, h - 32, 28);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '600 15px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText('My ' + monthShort(new Date(payload.y, payload.m, 1)) + ', wrapped', 36, 56);
    ctx.font = '700 44px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(fmtMoneyDisplay(summary.total), 36, 108);
    if (summary.compare && summary.vsLastPct != null) {
      ctx.font = '500 14px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(Math.abs(summary.vsLastPct) + '% ' + (summary.vsLastPct <= 0 ? 'less' : 'more') + ' than last month', 36, 132);
    }

    var tiles = summary.tiles;
    var tx = 36;
    var ty = 156;
    var tw = (w - 72 - 12) / 2;
    var th = 72;
    tiles.forEach(function (t, i) {
      if (!t) return;
      var col = i % 2;
      var row = Math.floor(i / 2);
      var x = tx + col * (tw + 12);
      var y = ty + row * (th + 10);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      roundRect(ctx, x, y, tw, th, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '500 10px -apple-system, sans-serif';
      ctx.fillText(t.label.toUpperCase(), x + 12, y + 22);
      ctx.fillStyle = '#fff';
      ctx.font = '700 15px -apple-system, sans-serif';
      ctx.fillText(t.title, x + 12, y + 42);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '500 12px -apple-system, sans-serif';
      ctx.fillText(t.sub, x + 12, y + 60);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '600 13px -apple-system, sans-serif';
    ctx.fillText('Expense Logger', 36, h - 48);
    ctx.textAlign = 'right';
    ctx.fillText(monthShort(new Date(payload.y, payload.m, 1)) + ' ' + payload.y, w - 36, h - 48);
    ctx.textAlign = 'left';

    canvas.toBlob(function (blob) { cb(blob); }, 'image/png');
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shareWrapped() {
    if (!wrappedMonth || !wrappedPayload) return;
    if (wrappedPayload.empty) { toast('Nothing to share'); return; }
    drawWrappedToCanvas(wrappedPayload, function (blob) {
      if (!blob) { toast('Could not create image'); return; }
      var file = new File([blob], 'expense-wrapped.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Spending Wrapped' }).catch(function () {});
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'expense-wrapped.png';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
        toast('Image saved');
      }
    });
  }

  function updateHomeRecapTeaser() {
    if (!$homeRecapCard) return;
    var now = new Date();
    if (now.getDate() > 7) { $homeRecapCard.hidden = true; return; }
    var pm = now.getMonth() - 1, py = now.getFullYear();
    if (pm < 0) { pm = 11; py -= 1; }
    var key = py + '-' + pm;
    if (uiState.dismissedWrapped && uiState.dismissedWrapped[key]) {
      $homeRecapCard.hidden = true;
      return;
    }
    var recap = computeRecapData(py, pm);
    if (recap.entryCount === 0) { $homeRecapCard.hidden = true; return; }
    $homeRecapCard.hidden = false;
    if ($homeRecapText) {
      $homeRecapText.textContent = 'Spending Wrapped · ' + monthShort(new Date(py, pm, 1)) + ' — ' + fmtMoneyDisplay(recap.total);
    }
  }

  function dismissSplash() {
    if (!$splashScreen) return;
    $splashScreen.style.pointerEvents = 'none';
    $splashScreen.classList.add('hide');
    setTimeout(function () {
      $splashScreen.style.display = 'none';
    }, prefersReducedMotion() ? 50 : 350);
  }

  function updateActivityStickyTop() {
    var wrap = document.querySelector('#tab-history:not([hidden]) .screen-header-wrap')
      || document.querySelector('.screen-header-wrap');
    if (wrap) {
      var h = wrap.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--activity-day-sticky-top', Math.max(44, Math.round(h)) + 'px');
    }
    var tab = $('tabBar');
    if (tab) {
      var tabTop = tab.getBoundingClientRect().top;
      var offset = Math.max(56, Math.ceil(window.innerHeight - tabTop) + 8);
      document.documentElement.style.setProperty('--tab-bar-offset', offset + 'px');
    }
  }

  function initScreenTitleObservers() {
    Array.prototype.forEach.call(document.querySelectorAll('.screen-header-wrap'), function (wrap) {
      var sentinel = wrap.querySelector('.title-sentinel');
      if (!sentinel || !window.IntersectionObserver) return;
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          wrap.classList.toggle('compact', !en.isIntersecting);
          updateActivityStickyTop();
        });
      }, { root: null, threshold: 0, rootMargin: '-1px 0px 0px 0px' }).observe(sentinel);
    });
    updateActivityStickyTop();
    window.addEventListener('resize', function () {
      updateActivityStickyTop();
      layoutDonutCenter();
    });
  }

  function setActivityRange(rangeId) {
    var next = normalizeActivityRangeId(rangeId);
    if (uiState.activityRange === next) return;
    uiState.activityRange = next;
    saveUI();
    renderEntries();
  }

  function wireActivityFilters() {
    Array.prototype.forEach.call(document.querySelectorAll('.activity-range-chip'), function (btn) {
      btn.addEventListener('click', function () {
        setActivityRange(btn.dataset.activityRange);
      });
    });
    if ($activityFilterBtn && $activityFilterModal) {
      $activityFilterBtn.addEventListener('click', function () {
        $activityFilterModal.classList.add('show');
      });
    }
    if ($activityFilterDoneBtn && $activityFilterModal) {
      $activityFilterDoneBtn.addEventListener('click', function () {
        $activityFilterModal.classList.remove('show');
      });
      $activityFilterModal.addEventListener('click', function (ev) {
        if (ev.target === $activityFilterModal) $activityFilterModal.classList.remove('show');
      });
    }
  }

  // ---------- Report view ----------
  function renderReport() {
    wireReportBody();
    var val = $reportMonth.value;
    var y, m;
    if (val) { var p = val.split('-'); y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; }
    else { var now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
    var data = getSummaryData(y, m);
    var rangeMonths = uiState.reportChartMonths === 12 ? 12 : 6;
    var nowDt = new Date();
    var series = buildReportMonthSeries(y, m, rangeMonths, nowDt);
    var txSort = uiState.reportTxSort || 'latest';
    var windowStartIdx = series.length ? ymToIndex(series[0].y, series[0].m) : null;
    var windowAnimDir = 0;
    if (lastReportChartWindowStart !== null && windowStartIdx !== null && lastReportChartWindowStart !== windowStartIdx) {
      windowAnimDir = windowStartIdx > lastReportChartWindowStart ? 1 : -1;
    }
    if (windowStartIdx !== null) lastReportChartWindowStart = windowStartIdx;

    var html = '';
    html += '<div class="card report-chart-card">';
    html += '<div class="report-chart-head">';
    html += '<h2 class="card-title">Spending over time</h2>';
    html += '<div class="seg-control report-chart-toolbar no-print" role="group" aria-label="Chart range">';
    html += segButton('data-report-range', '6', '6 mo', rangeMonths === 6);
    html += segButton('data-report-range', '12', '12 mo', rangeMonths === 12);
    html += '</div></div>';
    html += '<p class="chart-subtitle report-chart-compare">' + reportChartCompareText(series, y, m) + '</p>';
    html += '<div class="report-chart-scroll" id="reportChartScroll">';
    html += '<div id="reportChartSvgWrap"></div>';
    html += '</div></div>';

    html += '<div class="card">';
    html += '<div class="report-header">';
    html += '<h2>' + monthName(new Date(y, m, 1)) + '</h2>';
    html += '<div class="report-total">' + fmtMoneyDisplay(data.total) + '</div>';
    html += '<div class="hint">' + data.entries.length + ' transaction' + (data.entries.length === 1 ? '' : 's') + '</div>';
    html += '</div>';

    var rows = categories
      .map(function (c) { return { c: c, amt: data.byCat[c.id] || 0 }; })
      .filter(function (r) { return r.amt > 0; })
      .sort(function (a, b) { return b.amt - a.amt; });

    if (rows.length > 0) {
      html += '<div class="report-section">';
      html += '<h3>By category</h3>';
      html += '<table class="report-table"><thead><tr><th>Category</th><th>Share</th><th>Amount</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr><td class="report-cat-cell">' + iconBadge(r.c, 'xs') + ' ' + escHtml(r.c.name) + '</td><td>' + pctLabel(r.amt, data.total) + '</td><td>' + fmtMoneyDisplay(r.amt) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    var budgetRows = categories.filter(function (c) { return budgets[c.id] && budgets[c.id] > 0; });
    if (budgetRows.length > 0) {
      html += '<div class="report-section">';
      html += '<h3>Budget status</h3>';
      html += '<table class="report-table"><thead><tr><th>Category</th><th>Limit</th><th>Spent</th></tr></thead><tbody>';
      budgetRows.forEach(function (c) {
        var spent = data.byCat[c.id] || 0;
        var over = spent > budgets[c.id];
        html += '<tr><td class="report-cat-cell">' + iconBadge(c, 'xs') + ' ' + escHtml(c.name)
          + (over ? ' ' + uiIcon('ui-alert', 'xs') : '') + '</td><td>' + fmtMoneyDisplay(budgets[c.id]) + '</td><td style="color:' + (over ? 'var(--danger)' : 'inherit') + '">' + fmtMoneyDisplay(spent) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<div class="report-section">';
    html += '<div class="report-section-head">';
    html += '<h3>Transactions</h3>';
    html += '<div class="seg-control report-sort-seg no-print" role="group" aria-label="Sort transactions">';
    html += segButton('data-report-sort', 'latest', 'Latest', txSort === 'latest');
    html += segButton('data-report-sort', 'largest', 'Largest', txSort === 'largest');
    html += segButton('data-report-sort', 'recurring', 'Recurring', txSort === 'recurring');
    html += '</div></div>';

    if (data.entries.length > 0) {
      if (txSort === 'recurring') {
        html += renderRecurringGroupsHtml(groupRecurringEntries(data.entries));
      } else {
        var sortedEntries = sortReportTransactions(data.entries, txSort);
        html += '<table class="report-table report-tx-table"><thead><tr><th>Date</th><th>Category / Note</th><th>Amount</th></tr></thead><tbody>';
        sortedEntries.forEach(function (e) { html += renderReportTxRow(e); });
        html += '</tbody></table>';
      }
    } else {
      html += '<div class="empty">No transactions this month.</div>';
    }
    html += '</div>';

    html += '</div>';
    $reportBody.innerHTML = html;
    var scrollEl = document.getElementById('reportChartScroll');
    animateReportChart(series, y, m, scrollEl, windowAnimDir);
    refreshIconObservers($reportBody);
  }

  // ---------- Category management ----------
  var COLOR_OPTIONS = ['#4dabf7','#ff922b','#51cf66','#cc5de8','#f783ac','#adb5bd','#ff6b6b','#20c997','#fcc419','#845ef7','#339af0','#e599f7'];

  function pickerPreviewCat(iconId) {
    return {
      id: 'picker',
      name: ($catNameInput && $catNameInput.value.trim()) || 'Category',
      icon: iconId,
      color: selectedColor
    };
  }

  function renderIconPicker() {
    if (!$iconPicker || !EI) return;
    $iconPicker.innerHTML = '';
    var ids = EI.PICKER_ICON_IDS.concat([EI.LETTER_ID]);
    ids.forEach(function (iconId) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-picker-option' + (iconId === selectedIconId ? ' selected' : '');
      btn.dataset.iconId = iconId;
      btn.setAttribute('aria-label', iconId === EI.LETTER_ID ? 'Letter icon' : iconId.replace(/-/g, ' '));
      btn.innerHTML = iconBadge(pickerPreviewCat(iconId), 'picker');
      btn.addEventListener('click', function () {
        selectedIconId = iconId;
        Array.prototype.forEach.call($iconPicker.children, function (b) {
          b.classList.toggle('selected', b.dataset.iconId === iconId);
        });
      });
      $iconPicker.appendChild(btn);
    });
  }

  function renderCategoryList() {
    var html = '';
    categories.forEach(function (c) {
      html += '<div class="entry settings-inset-entry">'
        + '<div class="entry-info"><div class="top">'
        + iconBadge(c, 'sm')
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
    refreshIconObservers($categoryList);
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
      selectedIconId = cat.icon || (EI ? EI.resolveIconId(cat) : 'boxes');
      selectedColor = cat.color;
    } else {
      $catModalTitle.textContent = 'Add Category';
      $catNameInput.value = '';
      selectedIconId = 'boxes';
      selectedColor = '#adb5bd';
    }
    renderIconPicker();
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
        renderIconPicker();
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
      if (cat) { cat.name = name; cat.icon = selectedIconId; cat.color = selectedColor; }
    } else {
      var newId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
      if (categories.some(function (c) { return c.id === newId; })) newId = newId + '-' + uid().slice(0, 4);
      categories.push({ id: newId, name: name, emoji: '📦', icon: selectedIconId, color: selectedColor });
    }
    saveCategories();
    $catModal.classList.remove('show');
    buildCategoryButtons(); rebuildFilterDropdowns();
    renderCategoryList(); renderBudgetSettings(); renderAll();
    toast(editingCategoryId ? 'Category updated' : 'Category added');
  });

  // ---------- Budgets ----------
  function budgetInputHTML(catId, value, attr) {
    return '<div class="field budget-settings-field">'
      + '<label style="display:flex; align-items:center; gap:6px; text-transform:none; letter-spacing:0; font-size:14px; color:var(--text);">'
      + iconBadge(getCat(catId), 'xs') + ' ' + escHtml(getCat(catId).name) + '</label>'
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
      html += '<div class="entry settings-inset-entry">'
        + '<div class="entry-info"><div class="top">'
        + catPillHTML(cat)
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

    var ts = Date.now();
    if ($addDate && $addDate.value) {
      var parts = $addDate.value.split('-');
      if (parts.length === 3) {
        var ny = parseInt(parts[0], 10), nm = parseInt(parts[1], 10) - 1, nd = parseInt(parts[2], 10);
        if (!isNaN(ny) && !isNaN(nm) && !isNaN(nd)) {
          var now = new Date();
          ts = new Date(ny, nm, nd, now.getHours(), now.getMinutes(), now.getSeconds(), 0).getTime();
        }
      }
    }
    var entry = {
      id: uid(),
      amount: Math.round(v * 100) / 100,
      categoryId: selectedCat,
      note: $note.value.trim(),
      ts: ts
    };
    if (selectedAddAccountId) entry.accountId = selectedAddAccountId;

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
      lastSavedEntryId = entry.id;
      $amount.value = '';
      $note.value = '';
      $recurring.checked = false;
      selectedCat = null;
      Array.prototype.forEach.call($cats.children, function (el) { el.classList.remove('selected'); });
      updateSaveState();
      renderAll();
      closeAddSheet();
      switchTab(tabBeforeAdd || 'summary');
      toast('Saved ' + fmtMoneyDisplay(entry.amount));
      $amount.blur(); $note.blur();
      addEntryDate = localDateStamp();
      if ($addDate) $addDate.value = addEntryDate;
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
        escHtml(c.name) + '</option>';
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
    rebuildEditAccountSelect(entry.accountId || '');

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
    if ($editAccount) {
      var acctVal = $editAccount.value;
      if (acctVal) entry.accountId = acctVal;
      else delete entry.accountId;
    }

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
    $receiptModal.classList.remove('show');
    editingEntryId = null;
    softDeleteEntry(id);
    buildYearSelect(true);
    if (currentTab === 'report') renderReport();
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
    if (/payroll|direct\s*dep|salary|paycheck/.test(n)) return INCOME_CATEGORY_ID;
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
    if (/e-?payment/.test(c) && (/web/.test(c) || /(crd|card|credit|autopay)/.test(c) || CARD_ISSUER_RE.test(n))) return true;
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

  function looksLikeOtherAccountTransfer(desc) {
    var note = normText(desc);
    if (!note) return false;
    if (/\bvenmo\b/.test(note)) return false;
    if (isCardBillAutopayTransfer(desc)) return false;
    if (/\btransfer\s*to\s*savings\b/.test(note)) return true;
    if (/\bonline\s*transfer\s*to\b/.test(note)) return true;
    if (/\btransfer\s*from\b/.test(note)) return true;
    if (/\bxfer\b/.test(note) && !/\b(card|credit|crd)\b/.test(note)) return true;
    return false;
  }

  function isBuiltInTransfer(desc, type, layout) {
    var t = normText(type);
    if (layout === 'card') {
      if (CARD_PAYMENT_TYPES[t] && !importSettings.countCardPayments) return true;
    }
    if (layout === 'bank' && isCardBillAutopayTransfer(desc)) return true;
    if (layout === 'bank' && looksLikeOtherAccountTransfer(desc)) return true;
    if (findTransferPatternForNote(desc)) return true;
    var note = normText(desc);
    if (!note) return false;
    if (/\bvenmo\b/.test(note)) return false;
    if (/\bonline\s*payment\b/.test(note) && /\b(credit|card|crd)\b/.test(note)) return true;
    if (/\bpayment\s*thank\s*you\b/.test(note)) return true;
    return false;
  }

  function importRowTransferKind(desc, layout, isTransfer) {
    if (!isTransfer) return null;
    if (layout === 'bank' && isCardBillAutopayTransfer(desc)) return null;
    if (layout === 'bank' && (looksLikeOtherAccountTransfer(desc) || findTransferPatternForNote(desc))) return 'other';
    return null;
  }

  function buildExistingContentCounts(layout) {
    var counts = {};
    var srcWanted = importSourceKind(layout);
    entries.forEach(function (e) {
      if (layout !== 'app-export' && e.importSource && e.importSource !== srcWanted) return;
      var ck = importContentKey(layout, e.ts, e.amount, e.note || '', e.categoryId);
      counts[ck] = (counts[ck] || 0) + 1;
    });
    return counts;
  }

  function rowsFromTable(dataRows, headerRow, layout, batchId) {
    var contentCounts = buildExistingContentCounts(layout);
    var existingByMatch = buildExistingEntryByMatchKey();
    var fileRowCounts = {};
    var transferFileCounts = {};
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
      var descRaw = String(desc || '');
      var note = layout === 'app-export' ? descRaw.trim() : cleanImportNote(descRaw);
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
          var patHit = findTransferPatternForNote(note);
          var otherIn = patHit || looksLikeOtherAccountTransfer(descRaw);
          if (otherIn) {
            out.push({
              status: 'transfer', reason: 'Transfer · Other account', note: note, amount: credit, ts: ts,
              categoryId: categoryForImportRow('bank', catIdx !== -1 ? cols[catIdx] : '', note),
              isTransfer: true, transferKind: 'other', isDeposit: true, include: true, layout: 'bank',
              initialIsTransfer: true, userSetCategory: false, userSetTransfer: false, autoOtherAccount: !!patHit,
              typeVal: typeVal, bankText: descRaw
            });
            continue;
          }
          var depCat = incomeCategoryIdForDeposit(note) || categoryForImportRow('bank', catIdx !== -1 ? cols[catIdx] : '', note);
          out.push({
            status: 'import', reason: 'Deposit / paycheck', note: note, amount: credit, ts: ts,
            categoryId: depCat,
            isTransfer: false, isDeposit: true, include: true, layout: 'bank',
            initialIsTransfer: false, initialIsDeposit: true, userSetCategory: false, userSetTransfer: false,
            typeVal: typeVal, bankText: descRaw
          });
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
      var patRule = !isCardBillAutopayTransfer(descRaw) && findTransferPatternForNote(note);
      var isTransfer = (rule && rule.isTransfer) || !!patRule;
      if (rule && rule.countAsSpending) isTransfer = false;
      if (!rule && !patRule && isBuiltInTransfer(descRaw, typeVal, layout)) isTransfer = true;
      var transferKind = isTransfer ? importRowTransferKind(descRaw, layout, isTransfer) : null;
      if (rule && rule.categoryId && !rule.isTransfer) {
        // category from rule applied later
      }

      var postDate = postIdx !== -1 && postIdx !== dateIdx ? String(cols[postIdx] || '') : '';
      var rowKey = importRowKey([layout, dayKey(ts), fmtMoney(amount), descriptionMatchKey(note), normText(typeVal), postDate, String(ri)]);

      var catId = appExportCatId || categoryForImportRow(layout, catIdx !== -1 ? cols[catIdx] : '', note);
      if (rule && rule.categoryId && !rule.isTransfer) catId = rule.categoryId;

      var contentKey = importContentKey(layout, ts, amount, note, catId);

      var matchKey = importRowMatchKey(ts, amount, note);
      var matchedEntry = existingByMatch[matchKey];

      if (isTransfer) {
        var xferKey = contentKey;
        transferFileCounts[xferKey] = (transferFileCounts[xferKey] || 0) + 1;
        if (transferFileCounts[xferKey] > 1) {
          out.push({
            status: 'duplicate',
            reason: 'Duplicate transfer in file',
            note: note, amount: amount, ts: ts, contentKey: contentKey,
            existingEntryId: matchedEntry ? matchedEntry.id : null
          });
          continue;
        }
        if (matchedEntry) {
          out.push({
            status: 'duplicate',
            reason: 'Already in your log (overlapping statement)',
            note: note, amount: amount, ts: ts, contentKey: contentKey,
            existingEntryId: matchedEntry.id,
            wasTransfer: true
          });
          continue;
        }
        out.push({
          status: 'transfer', reason: transferKind === 'other' ? 'Transfer · Other account' : 'Transfer between accounts',
          note: note, amount: amount, ts: ts,
          categoryId: catId, importRowKey: rowKey, isTransfer: true, transferKind: transferKind, include: true,
          layout: layout, suggestedCategoryId: catId, initialCategoryId: catId,
          initialIsTransfer: true, initialTransferKind: transferKind, userSetCategory: false, userSetTransfer: false,
          typeVal: typeVal, bankText: descRaw, autoOtherAccount: transferKind === 'other' && !!patRule
        });
        continue;
      }

      fileRowCounts[contentKey] = (fileRowCounts[contentKey] || 0) + 1;
      var occurrence = fileRowCounts[contentKey];
      var existingN = contentCounts[contentKey] || 0;
      if (occurrence <= existingN || matchedEntry) {
        out.push({
          status: 'duplicate',
          reason: 'Already in your log (overlapping statement)',
          note: note, amount: amount, ts: ts, contentKey: contentKey,
          existingEntryId: matchedEntry ? matchedEntry.id : null
        });
        continue;
      }
      contentCounts[contentKey] = existingN + 1;

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

  function importRowXferMode(row) {
    if (row.isDeposit && !row.isTransfer) return 'income';
    if (!row.isTransfer) return 'expense';
    if (row.transferKind === 'other') return 'other';
    return 'paired';
  }

  function setImportRowXferMode(row, mode) {
    if (mode === 'income') {
      row.isTransfer = false;
      row.transferKind = null;
      row.isDeposit = true;
      row.status = 'import';
      var inc = incomeCategoryIdForDeposit(row.note) || INCOME_CATEGORY_ID;
      row.categoryId = inc;
    } else if (mode === 'expense') {
      row.isTransfer = false;
      row.transferKind = null;
      row.isDeposit = false;
      row.status = 'import';
    } else if (mode === 'other') {
      row.isTransfer = true;
      row.transferKind = 'other';
      row.isDeposit = false;
      row.status = 'transfer';
    } else {
      row.isTransfer = true;
      row.isDeposit = false;
      row.transferKind = importRowTransferKind(row.bankText || row.note, row.layout, true);
      row.status = 'transfer';
    }
    row.include = true;
    row.userSetTransfer = row.isTransfer !== row.initialIsTransfer
      || (row.transferKind || null) !== (row.initialTransferKind || null)
      || !!row.isDeposit !== !!row.initialIsDeposit;
  }

  function renderImportReview() {
    if (!pendingImport) return;
    var rows = pendingImport.rows;
    var counts = summarizeImportRows(rows);
    var html = '<div class="import-stats">';
    html += '<div class="import-stat"><strong>' + counts.import + '</strong><span> to import</span></div>';
    html += '<div class="import-stat"><strong>' + counts.duplicate + '</strong><span> duplicates</span></div>';
    html += '<div class="import-stat"><strong>' + counts.transfer + '</strong><span> transfers</span></div>';
    html += '<div class="import-stat"><strong>' + counts.credit + '</strong><span> credits skipped</span></div>';
    html += '<div class="import-stat"><strong>' + counts.pending + '</strong><span> pending</span></div>';
    html += '<div class="import-stat"><strong>' + counts.unreadable + '</strong><span> unreadable</span></div>';
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
        catOpts += '<option value="' + c.id + '"' + (c.id === r.categoryId ? ' selected' : '') + '>' + escHtml(c.name) + '</option>';
      });
      listHtml += '<div class="import-row' + (r.status === 'transfer' ? ' is-transfer' : '') + '" data-idx="' + i + '">';
      listHtml += '<div class="import-row-top"><span class="import-row-date">' + d + '</span>';
      listHtml += '<span class="import-row-amt">' + fmtMoneyDisplay(r.amount) + '</span></div>';
      listHtml += '<div class="import-row-note">' + (r.note || '(no description)') + '</div>';
      listHtml += '<div class="import-row-actions">';
      listHtml += '<select class="import-cat-select" data-idx="' + i + '">' + catOpts + '</select>';
      if (r.autoOtherAccount) listHtml += '<span class="import-other-tag">Auto</span>';
      var rowMode = importRowXferMode(r);
      if (!r.initialIsDeposit && (r.isDeposit || r.categoryId === INCOME_CATEGORY_ID || incomeCategoryIdForDeposit(r.note))) {
        r.initialIsDeposit = !!r.isDeposit;
      }
      listHtml += '<div class="seg-control import-xfer-seg import-xfer-seg--4" role="group" aria-label="Row type" data-idx="' + i + '">';
      listHtml += '<button type="button" class="seg-btn' + (rowMode === 'expense' ? ' is-active' : '') + '" data-mode="expense">Expense</button>';
      listHtml += '<button type="button" class="seg-btn' + (rowMode === 'income' ? ' is-active' : '') + '" data-mode="income">Income</button>';
      listHtml += '<button type="button" class="seg-btn' + (rowMode === 'paired' ? ' is-active' : '') + '" data-mode="paired">Transfer</button>';
      listHtml += '<button type="button" class="seg-btn' + (rowMode === 'other' ? ' is-active' : '') + '" data-mode="other">Other</button>';
      listHtml += '</div>';
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
    Array.prototype.forEach.call($importRowList.querySelectorAll('.import-xfer-seg'), function (seg) {
      var idx = parseInt(seg.dataset.idx, 10);
      Array.prototype.forEach.call(seg.querySelectorAll('.seg-btn'), function (btn) {
        btn.addEventListener('click', function () {
          var row = pendingImport.rows[idx];
          setImportRowXferMode(row, btn.dataset.mode);
          Array.prototype.forEach.call(seg.querySelectorAll('.seg-btn'), function (b) {
            b.classList.toggle('is-active', b === btn);
          });
          seg.closest('.import-row').classList.toggle('is-transfer', row.isTransfer);
        });
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

  function backfillEntryAccount(entryId, accountId) {
    if (!entryId || !accountId) return false;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === entryId) {
        if (entries[i].accountId) return false;
        entries[i].accountId = accountId;
        return true;
      }
    }
    return false;
  }

  function pushImportedEntry(r, batchId, accountId) {
    var entry = {
      id: uid(),
      amount: r.amount,
      categoryId: r.categoryId,
      note: r.note || '',
      ts: r.ts,
      importBatchId: batchId,
      importRowKey: r.importRowKey,
      importSource: importSourceKind(r.layout),
      accountId: accountId,
      isTransfer: !!r.isTransfer,
      typeVal: r.typeVal || ''
    };
    if (r.transferKind) entry.transferKind = r.transferKind;
    if (r.isDeposit) {
      entry.isDeposit = true;
      var inc = incomeCategoryIdForDeposit(r.note);
      if (inc) entry.categoryId = inc;
    }
    if (r.bankText) entry.bankText = r.bankText;
    entries.push(entry);
  }

  function commitImport() {
    if (!pendingImport) return;
    var batchId = pendingImport.batchId;
    var rows = pendingImport.rows;
    var accountId = pendingImport.accountId || '';
    var layout = pendingImport.layout || 'generic';
    var added = 0;
    var dup = 0;
    var tagged = 0;
    var skippedTransfer = 0;
    var skippedCredit = 0;
    var skippedPending = 0;
    var skippedBad = 0;
    rows.forEach(function (r) {
      if (r.status === 'duplicate') {
        dup++;
        if (r.existingEntryId && accountId && backfillEntryAccount(r.existingEntryId, accountId)) tagged++;
        return;
      }
      if (r.status === 'credit') { skippedCredit++; return; }
      if (r.status === 'pending') { skippedPending++; return; }
      if (r.status === 'unreadable') { skippedBad++; return; }
      if (r.status === 'transfer' || r.isTransfer) {
        if (r.userSetTransfer || r.userSetCategory) learnFromImportRow(r);
        pushImportedEntry(r, batchId, accountId);
        added++;
        return;
      }
      if (r.status !== 'import' || !r.include) return;
      if (r.userSetTransfer || r.userSetCategory) learnFromImportRow(r);
      pushImportedEntry(r, batchId, accountId);
      added++;
    });
    if (layout && accountId) {
      importAccountPrefs[layout === 'app-export' ? 'app' : layout] = accountId;
      saveImportAccountPrefs();
    }
    saveEntries();
    saveCategories();
    autoPairTransfers();
    renderAll(); rebuildFilterDropdowns();
    renderCategoryList(); buildYearSelect(true); renderReport();
    $importModal.classList.remove('show');
    pendingImport = null;
    renderImportRulesList();
    var parts = [added + ' new'];
    if (tagged) parts.push(tagged + ' already there, tagged');
    if (dup > tagged) parts.push((dup - tagged) + ' skipped');
    else if (dup && !tagged) parts.push(dup + ' duplicates');
    if (skippedTransfer) parts.push(skippedTransfer + ' transfers');
    if (skippedCredit) parts.push(skippedCredit + ' credits');
    if (skippedPending) parts.push(skippedPending + ' pending');
    if (skippedBad) parts.push(skippedBad + ' unreadable');
    toast('Imported ' + parts.join(', '));
  }

  function modalTransitionMs() {
    return prefersReducedMotion() ? 0 : 300;
  }

  function closeOverlayThen(overlay, cb) {
    if (!overlay) {
      if (cb) cb();
      return;
    }
    overlay.classList.remove('show');
    if (cb) setTimeout(cb, modalTransitionMs());
  }

  function renderImportAccountSheet() {
    if (!pendingImportAccount) return;
    if ($importModal) $importModal.classList.remove('show');
    ensureDefaultAccounts();
    var layout = pendingImportAccount.layout;
    var suggested = suggestImportAccountId(layout);
    importAccountPickId = importAccountPickId || suggested;
    var rowCount = pendingImportAccount.rows.length;
    var fname = pendingImportAccount.fileName || 'Import file';
    $importAccountFileMeta.innerHTML = '<span class="file-doc-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M6 2.5h5.5L15 6v11.5a1 1 0 01-1 1H6a1 1 0 01-1-1v-13a1 1 0 011-1z" stroke="currentColor" stroke-width="1.25"/><path d="M11.5 2.5V6H15" stroke="currentColor" stroke-width="1.25"/></svg></span><span>'
      + escHtml(fname) + ' \u00B7 ' + rowCount + ' row' + (rowCount === 1 ? '' : 's') + '</span>';
    var html = '';
    accounts.forEach(function (a) {
      var checked = importAccountPickId === a.id;
      var sub = a.type === 'bank' ? 'Bank account' : 'Credit card';
      html += '<button type="button" class="import-account-option" role="radio" aria-checked="' + (checked ? 'true' : 'false') + '" data-account-pick="' + escHtml(a.id) + '">';
      html += accountMiniIconHTML(a);
      html += '<div class="import-account-option-main"><div class="import-account-option-name">' + escHtml(a.name);
      if (a.id === suggested) html += ' <span class="import-account-suggested"><span data-ui-icon="ui-sparkles" data-ui-icon-size="xs" aria-hidden="true"></span> Suggested</span>';
      html += '</div><div class="import-account-option-sub">' + sub + '</div></div>';
      html += '<span class="import-account-radio" aria-hidden="true"></span></button>';
    });
    html += '<button type="button" class="import-account-option import-account-add" id="importAccountAddBtn"><span class="account-mini-icon" style="background:var(--raised);color:var(--text-dim)"><svg viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span class="import-account-option-main"><div class="import-account-option-name">Add account</div></div></button>';
    $importAccountList.innerHTML = html;
    if ($importAccountHint) {
      $importAccountHint.hidden = false;
      $importAccountHint.innerHTML = '<span class="hint-info-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor"/><path d="M8 7v4M8 5.2h.01" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg></span><span>'
        + escHtml(importAccountHintText(layout, suggested)) + '</span>';
    }
    if (EI && EI.hydrateUiIcons) EI.hydrateUiIcons($importAccountList);
    Array.prototype.forEach.call($importAccountList.querySelectorAll('[data-account-pick]'), function (btn) {
      btn.addEventListener('click', function () {
        importAccountPickId = btn.dataset.accountPick;
        renderImportAccountSheet();
      });
    });
    var addBtn = document.getElementById('importAccountAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        pendingAddAccountFromImport = true;
        $newAccountName.value = '';
        newAccountType = 'bank';
        Array.prototype.forEach.call(document.querySelectorAll('.account-type-btn'), function (b) {
          b.setAttribute('aria-pressed', b.dataset.accountType === newAccountType ? 'true' : 'false');
        });
        $addAccountModal.classList.add('show');
      });
    }
    $importAccountModal.classList.add('show');
  }

  var pendingAddAccountFromImport = false;

  function continueImportAccountSheet() {
    if (!pendingImportAccount || !importAccountPickId) { toast('Choose an account'); return; }
    var payload = pendingImportAccount;
    pendingImportAccount = null;
    var accountId = importAccountPickId;
    importAccountPickId = null;
    closeOverlayThen($importAccountModal, function () {
      pendingImport = {
        batchId: payload.batchId,
        rows: payload.rows,
        fileName: payload.fileName,
        layout: payload.layout,
        accountId: accountId
      };
      renderImportReview();
    });
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
    pendingImportAccount = { batchId: batchId, rows: rows, fileName: fileName, layout: layout };
    importAccountPickId = suggestImportAccountId(layout);
    renderImportAccountSheet();
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
  var $backupDataBtn = $('backupDataBtn');
  if ($backupDataBtn) $backupDataBtn.addEventListener('click', runBackupExport);
  var $backupFileInput = $('backupFileInput');
  if ($backupFileInput) {
    $backupFileInput.addEventListener('change', function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        var data;
        try { data = JSON.parse(e.target.result); }
        catch (err) { toast('Invalid backup file'); return; }
        var check = validateBackupDocument(data);
        if (!check.ok) { toast(check.error || 'Invalid backup'); return; }
        pendingBackupRestore = data;
        if ($backupRestoreSummary && check.summary) {
          var s = check.summary;
          $backupRestoreSummary.innerHTML =
            '<p class="hint">This will replace all data on this device.</p>'
            + '<div class="summary-row"><span class="label">Entries</span><span class="value">' + s.entryCount + '</span></div>'
            + '<div class="summary-row"><span class="label">Date range</span><span class="value">' + formatBackupDateRange(s.minTs, s.maxTs) + '</span></div>'
            + '<div class="summary-row"><span class="label">Categories</span><span class="value">' + formatCategorySummaryLabel(s) + '</span></div>';
        }
        if ($backupRestoreModal) $backupRestoreModal.classList.add('show');
      };
      reader.readAsText(f);
    });
  }
  if ($backupRestoreCancelBtn) {
    $backupRestoreCancelBtn.addEventListener('click', function () {
      pendingBackupRestore = null;
      if ($backupRestoreModal) $backupRestoreModal.classList.remove('show');
    });
  }
  if ($backupRestoreConfirmBtn) {
    $backupRestoreConfirmBtn.addEventListener('click', function () {
      if (!pendingBackupRestore) return;
      commitBackupRestore(pendingBackupRestore);
    });
  }
  var $backupNudgeDismiss = $('backupNudgeDismiss');
  if ($backupNudgeDismiss) $backupNudgeDismiss.addEventListener('click', dismissBackupNudge);
  var $homeBackupNudgeDismiss = $('homeBackupNudgeDismiss');
  if ($homeBackupNudgeDismiss) {
    $homeBackupNudgeDismiss.addEventListener('click', function (ev) {
      ev.stopPropagation();
      dismissBackupNudge();
    });
  }
  var $homeBackupNudgeBtn = $('homeBackupNudgeBtn');
  if ($homeBackupNudgeBtn) {
    $homeBackupNudgeBtn.addEventListener('click', function () {
      switchTab('settings');
    });
  }
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
      html += '<option value="' + c.id + '">' + escHtml(c.name) + '</option>';
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

  function openAddSheet() {
    if (!$addSheet) return;
    if (!addEntryDate) addEntryDate = localDateStamp();
    if ($addDate) $addDate.value = addEntryDate;
    updateAddDatePreview();
    updateAddNotePreview();
    if ($receiptClearBtn) $receiptClearBtn.hidden = true;
    if ($receiptPreview) {
      $receiptPreview.hidden = true;
      if ($receiptPreview.src && $receiptPreview.src.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL($receiptPreview.src); } catch (e) {}
      }
      $receiptPreview.removeAttribute('src');
    }
    pendingReceiptBlob = null;
    rebuildAddAccountSelect();
    updateAddAccountPreview();
    $addSheet.classList.add('show');
    setTimeout(function () { if ($amount) $amount.focus(); }, prefersReducedMotion() ? 0 : 280);
  }
  function closeAddSheet() {
    if ($addSheet) $addSheet.classList.remove('show');
    var noteWrap = $('addNoteField');
    if (noteWrap) noteWrap.hidden = true;
    if ($note) {
      $note.classList.add('visually-hidden-input');
      $note.setAttribute('tabindex', '-1');
    }
  }
  function updateAddDatePreview() {
    if (!$addDatePreview || !$addDate) return;
    var v = $addDate.value;
    if (!v) { $addDatePreview.textContent = 'Today'; return; }
    var today = localDateStamp();
    if (v === today) $addDatePreview.textContent = 'Today, ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    else $addDatePreview.textContent = new Date(v + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function updateAddNotePreview() {
    if ($addNotePreview && $note) {
      $addNotePreview.textContent = ($note.value || '').trim() || 'Add note';
    }
  }

  function getCheckingAccount() {
    ensureDefaultAccounts();
    var acct = getAccount(DEFAULT_ACCOUNT_CHECKING);
    if (acct) return acct;
    for (var i = 0; i < accounts.length; i++) {
      if (accounts[i].type === 'bank') return accounts[i];
    }
    return accounts[0] || null;
  }

  function buildForecastPayload(chartDays) {
    if (!FC) return null;
    var checking = getCheckingAccount();
    if (!checking) return null;
    var asOfMs = accountBalanceAsOfMs(checking);
    var nowMs = Date.now();
    return {
      nowMs: nowMs,
      checkingId: checking.id,
      chaseId: DEFAULT_ACCOUNT_CHASE,
      balance: typeof checking.currentBalance === 'number' ? checking.currentBalance : null,
      balanceAsOfMs: asOfMs,
      cushion: getForecastCushion(),
      entries: entries,
      recurringItems: recurringItems,
      transferPairs: transferPairs,
      overrides: forecastOverrides,
      chartDays: chartDays || forecastChartDays,
      maxLookaheadDays: 365
    };
  }

  function formatForecastDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatForecastShortDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function fmtForecastMoneyShort(n) {
    var v = Math.round(n);
    if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return '$' + v;
  }

  function renderHomeForecastCard() {
    var card = $('homeForecastCard');
    if (!card) return;
    var checking = getCheckingAccount();
    if (!checking || typeof checking.currentBalance !== 'number') {
      card.hidden = true;
      return;
    }
    var payload = buildForecastPayload(60);
    var result = payload && FC ? FC.runForecast(payload) : null;
    if (!result || !result.ok) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    var dateEl = $('homeForecastDate');
    var daysEl = $('homeForecastDays');
    var balEl = $('homeForecastBalanceVal');
    if (result.neverRunsOut) {
      if (dateEl) {
        dateEl.textContent = 'Stays positive for a year+';
        dateEl.classList.add('is-long');
      }
      if (daysEl) daysEl.textContent = '';
    } else {
      if (dateEl) dateEl.classList.remove('is-long');
      if (dateEl) dateEl.textContent = formatForecastDate(result.lastsUntil);
      if (daysEl) daysEl.textContent = result.daysAway + ' days away';
    }
    if (balEl) balEl.textContent = fmtMoneyDisplay(result.startingBalance);
  }

  function closeForecastScreen() {
    forecastScreenOpen = false;
    var fs = $('tab-forecast');
    if (fs) fs.hidden = true;
    if ($('tab-summary')) $('tab-summary').hidden = currentTab !== 'summary';
  }

  function openForecastScreen() {
    forecastScreenOpen = true;
    if ($('tab-summary')) $('tab-summary').hidden = true;
    var fs = $('tab-forecast');
    if (fs) fs.hidden = false;
    renderForecastScreen();
    window.scrollTo(0, 0);
  }

  function renderForecastScreen() {
    var checking = getCheckingAccount();
    var empty = $('forecastEmptyState');
    var main = $('forecastMain');
    if (!checking || typeof checking.currentBalance !== 'number') {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      if ($('forecastEmptyTitle')) $('forecastEmptyTitle').textContent = 'Set your checking balance';
      if ($('forecastEmptyText')) $('forecastEmptyText').textContent = 'Add the balance from your bank app so we can project cash flow.';
      return;
    }
    var checkingEntries = entries.filter(function (e) { return e.accountId === checking.id; });
    if (checkingEntries.length < 3) {
      if (empty) empty.hidden = false;
      if (main) main.hidden = true;
      if ($('forecastEmptyTitle')) $('forecastEmptyTitle').textContent = 'Need more checking history';
      if ($('forecastEmptyText')) $('forecastEmptyText').textContent = 'Import a few weeks of checking transactions so we can detect bills, paychecks, and spending pace.';
      return;
    }
    if (empty) empty.hidden = true;
    if (main) main.hidden = false;

    var payload = buildForecastPayload(forecastChartDays);
    var result = FC.runForecast(payload);
    if (!result.ok) return;

    var chip = $('forecastAccountChip');
    if (chip) chip.innerHTML = accountMiniIconHTML(checking) + '<span>' + escHtml(accountShortName(checking)) + '</span>';

    var lastsEl = $('forecastLastsDate');
    var daysEl = $('forecastDaysAway');
    if (result.neverRunsOut) {
      if (lastsEl) {
        lastsEl.textContent = 'Stays positive for a year+';
        lastsEl.classList.add('is-long');
      }
      if (daysEl) daysEl.textContent = '';
    } else {
      if (lastsEl) lastsEl.classList.remove('is-long');
      if (lastsEl) lastsEl.textContent = formatForecastDate(result.lastsUntil);
      if (daysEl) daysEl.textContent = result.daysAway + ' days away';
    }
    if ($('forecastBalanceVal')) $('forecastBalanceVal').textContent = fmtMoneyDisplay(result.startingBalance);
    if ($('forecastBalanceLabel')) {
      $('forecastBalanceLabel').textContent = checking.name + ' balance \u00B7 as of today';
    }
    if ($('forecastUpcomingWindow')) $('forecastUpcomingWindow').textContent = 'Next ' + forecastChartDays + ' days';
    if ($('forecastUpcomingLabel')) $('forecastUpcomingLabel').textContent = 'Upcoming \u00B7 ' + accountShortName(checking);

    var sim = FC.simulateBalanceTimeline({
      nowMs: payload.nowMs,
      startingBalance: result.startingBalance,
      entries: entries,
      checkingId: checking.id,
      chaseId: DEFAULT_ACCOUNT_CHASE,
      transferPairs: transferPairs,
      recurringItems: recurringItems,
      overrides: forecastOverrides,
      chartDays: forecastChartDays,
      maxLookaheadDays: 365,
      cushion: getForecastCushion()
    });
    if (sim.schedules) lastForecastSchedules = sim.schedules;
    lastForecastSim = sim;
    if (sim.ok && $('forecastLowestSub')) {
      var lowPt = sim.lowestInWindow || sim.lowest;
      $('forecastLowestSub').textContent = 'Lowest ' + fmtMoneyDisplay(lowPt.balance) + ' on ' + formatForecastShortDate(lowPt.ts);
    }
    drawForecastChart(sim, getForecastCushion());
    renderForecastUpcoming(sim, getForecastCushion());
  }

  function drawForecastChart(sim, cushion) {
    var canvas = $('forecastChart');
    var wrap = $('forecastChartWrap');
    if (!canvas || !sim || !sim.ok) return;
    var todayMs = FC.startOfDay(Date.now());
    var horizon = FC.addDays(todayMs, forecastChartDays);
    var points = sim.points.filter(function (p) { return p.ts <= horizon; });
    if (!points.length) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = canvas.clientWidth || 360;
    var cssH = 200;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var padL = 8;
    var padR = 44;
    var padT = 12;
    var padB = 26;
    var w = cssW - padL - padR;
    var h = cssH - padT - padB;
    var dataMin = points[0].balance;
    var dataMax = points[0].balance;
    points.forEach(function (p) {
      if (p.balance < dataMin) dataMin = p.balance;
      if (p.balance > dataMax) dataMax = p.balance;
    });
    var span = Math.max(80, dataMax - dataMin);
    var cushionNear = cushion >= dataMin - span * 0.25 && cushion <= dataMax + span * 0.2;
    if (cushionNear) {
      dataMin = Math.min(dataMin, cushion);
      dataMax = Math.max(dataMax, cushion);
    }
    var step = FC.forecastChartAxisStep(dataMax - dataMin);
    var minBal = Math.floor((dataMin - step * 0.35) / step) * step;
    var maxBal = Math.ceil((dataMax + step * 0.35) / step) * step;
    if (maxBal - minBal < step * 2) maxBal = minBal + step * 2;
    if (minBal < 0 && dataMin >= 0) minBal = 0;
    var t0 = points[0].ts;
    var t1 = points[points.length - 1].ts;
    function xAt(ts) { return padL + ((ts - t0) / (t1 - t0 || 1)) * w; }
    function yAt(bal) { return padT + h - ((bal - minBal) / (maxBal - minBal)) * h; }
    var gridColor = cssVar('--text-dim', '#8A91A3');
    var lineColor = cssVar('--accent', '#5B8CFF');
    var histColor = cssVar('--text-secondary', '#6B7280');
    var warnColor = cssVar('--warn', '#F5A524');
    ctx.clearRect(0, 0, cssW, cssH);
    var cy = cushionNear ? yAt(cushion) : null;
    if (cushionNear && cy >= padT && cy <= padT + h) {
      ctx.fillStyle = 'rgba(245, 165, 36, 0.14)';
      ctx.fillRect(padL, cy, w, padT + h - cy);
      ctx.strokeStyle = warnColor;
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, cy);
      ctx.lineTo(padL + w, cy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    function strokeBalanceSegment(seg, color, width) {
      if (!seg.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      seg.forEach(function (p, i) {
        var x = xAt(p.ts);
        var y = yAt(p.balance);
        if (i === 0) ctx.moveTo(x, y);
        else {
          var px = xAt(seg[i - 1].ts);
          ctx.lineTo(px, y);
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }
    var hist = [];
    var future = [];
    points.forEach(function (p) {
      if (p.ts <= todayMs) hist.push(p);
      else future.push(p);
    });
    if (hist.length) strokeBalanceSegment(hist, histColor, 2);
    if (future.length) {
      if (hist.length) future.unshift(hist[hist.length - 1]);
      strokeBalanceSegment(future, lineColor, 2.5);
    }
    ctx.strokeStyle = gridColor;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    var tx = xAt(todayMs);
    ctx.moveTo(tx, padT);
    ctx.lineTo(tx, padT + h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = lineColor;
    points.forEach(function (p) {
      if (!p.today) return;
      ctx.beginPath();
      ctx.arc(xAt(p.ts), yAt(p.balance), 4, 0, Math.PI * 2);
      ctx.fill();
    });
    var axisPlan = FC.planForecastChartYAxisLabels({
      minBal: minBal,
      maxBal: maxBal,
      step: step,
      cushion: cushion,
      cushionNear: cushionNear,
      padT: padT,
      innerH: h,
      baselineNudge: 4
    });
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    axisPlan.labels.forEach(function (lb) {
      ctx.fillStyle = lb.isCushion ? warnColor : gridColor;
      ctx.font = lb.isCushion ? '600 11px system-ui, sans-serif' : '11px system-ui, sans-serif';
      ctx.fillText(fmtForecastMoneyShort(lb.bal), padL + w + padR - 4, lb.y);
    });
    if (axisPlan.showCushionNote) {
      ctx.textAlign = 'left';
      ctx.fillStyle = warnColor;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText('Cushion ' + fmtForecastMoneyShort(cushion), padL, axisPlan.cushionLabelY);
    }
    if (typeof window !== 'undefined') {
      window.__forecastChartAxisDebug = {
        chartDays: forecastChartDays,
        colorScheme: window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
        cushionNear: cushionNear,
        plan: axisPlan,
        collides: FC.yAxisLabelsCollide(axisPlan)
      };
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = gridColor;
    var labels = [
      { ts: todayMs, text: 'Today' },
      { ts: FC.addDays(todayMs, Math.round(forecastChartDays * 0.35)), text: null },
      { ts: FC.addDays(todayMs, Math.round(forecastChartDays * 0.65)), text: null },
      { ts: FC.addDays(todayMs, forecastChartDays), text: null }
    ];
    labels.forEach(function (lb, idx) {
      if (idx > 0) {
        var d = new Date(lb.ts);
        lb.text = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      }
      ctx.fillText(lb.text, xAt(lb.ts), cssH - 6);
    });
    if (wrap && !prefersReducedMotion()) {
      wrap.classList.add('is-loading');
      requestAnimationFrame(function () {
        wrap.classList.remove('is-loading');
      });
    }
  }

  function formatForecastEditAmount(n) {
    var v = Math.round(n * 100) / 100;
    return v.toFixed(2);
  }

  function openForecastItemEditor(itemKey, label, amount, ts, kind, categoryId) {
    if (!itemKey || itemKey === 'daily-spend') return;
    editingForecastItemKey = itemKey;
    editingForecastOccurrenceTs = ts;
    editingForecastItemMeta = { label: label, kind: kind, categoryId: categoryId };
    var title = $('forecastItemEditTitle');
    if (title) title.textContent = label || 'Upcoming item';
    var amtIn = $('forecastItemAmountInput');
    if (amtIn) amtIn.value = formatForecastEditAmount(amount);
    var dateIn = $('forecastItemDateInput');
    if (dateIn) {
      var d = new Date(ts);
      dateIn.value = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    var m = $('forecastItemEditModal');
    if (m) m.classList.add('show');
  }

  function saveForecastItemOverride() {
    if (!editingForecastItemKey) return;
    var amt = parseFloat($('forecastItemAmountInput') && $('forecastItemAmountInput').value);
    var dateVal = $('forecastItemDateInput') && $('forecastItemDateInput').value;
    if (isNaN(amt) || amt <= 0) { toast('Enter a valid amount'); return; }
    if (!dateVal) { toast('Pick a date'); return; }
    var parts = dateVal.split('-');
    var nextTs = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)).getTime();
    var meta = editingForecastItemMeta || {};
    forecastOverrides[editingForecastItemKey] = {
      amount: Math.round(amt * 100) / 100,
      nextTs: nextTs,
      applyFromTs: editingForecastOccurrenceTs,
      label: meta.label,
      kind: meta.kind,
      categoryId: meta.categoryId
    };
    saveForecastOverrides();
    editingForecastItemKey = null;
    editingForecastOccurrenceTs = null;
    var m = $('forecastItemEditModal');
    if (m) m.classList.remove('show');
    renderHomeForecastCard();
    if (forecastScreenOpen) renderForecastScreen();
    toast('Forecast updated');
  }

  function renderForecastUpcoming(sim, cushion) {
    var list = $('forecastUpcomingList');
    if (!list || !sim) return;
    var html = '';
    var items = sim.upcoming.slice().sort(function (a, b) {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.ts - b.ts;
    });
    var majorAmt = 250;
    var majorKeys = {};
    items.forEach(function (u) {
      if (u.amount >= majorAmt && u.itemKey) majorKeys[u.itemKey] = true;
    });
    items = items.sort(function (a, b) { return a.ts - b.ts; }).slice(0, 14);
    if (!items.length) {
      list.innerHTML = '<div class="empty" style="padding:16px">No scheduled items in this window.</div>';
      return;
    }
    items.forEach(function (u) {
      var cat = u.categoryId ? getCat(u.categoryId) : null;
      var iconBg = '#cc5de822';
      var iconColor = '#cc5de8';
      var iconSvg = iconBadge(cat || { icon: 'receipt', color: '#cc5de8' }, 'sm');
      var sub = formatForecastShortDate(u.ts);
      if (u.kind === 'inflow') {
        iconBg = '#34C77B22'; iconColor = '#34C77B';
        iconSvg = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 9h10M10 5l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        sub += ' \u00B7 Paycheck';
      } else if (u.kind === 'card-payment') {
        iconBg = '#748FFC22'; iconColor = '#748FFC';
        iconSvg = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="4" width="14" height="10" rx="1.5" stroke="currentColor"/><path d="M2 7h14" stroke="currentColor"/></svg>';
        sub += ' \u00B7 Card bill';
      } else if (u.kind === 'transfer-other') {
        iconBg = 'var(--raised)'; iconColor = 'var(--text-secondary)';
        iconSvg = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 7h8M9 5l3 2-3 2M15 11H7M9 13l-3-2 3-2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        sub += ' \u00B7 Transfer';
      } else if (cat) {
        sub += ' \u00B7 ' + cat.name;
        if (/duke|energy/i.test(u.label)) sub += ' \u00B7 Autopay';
        if (/rent|apts/i.test(u.label)) sub += ' \u00B7 Rent';
      }
      var amtClass = 'forecast-up-amt';
      var amtTxt = '';
      if (u.kind === 'inflow') {
        amtClass += ' is-in';
        amtTxt = '+' + fmtMoneyDisplay(u.amount);
      } else if (u.kind === 'transfer-other') {
        amtClass += ' is-xfer';
        amtTxt = fmtMoneyDisplay(u.amount);
      } else {
        amtTxt = '-' + fmtMoneyDisplay(u.amount);
      }
      var rowClass = 'forecast-up-row';
      if ((u.amount >= majorAmt || majorKeys[u.itemKey]) && u.itemKey && u.itemKey !== 'daily-spend') {
        rowClass += ' forecast-up-row--major';
      }
      var tap = '';
      if (u.itemKey && u.itemKey !== 'daily-spend') {
        tap = ' data-forecast-item="' + escHtml(u.itemKey) + '" data-forecast-ts="' + u.ts + '"';
      }
      html += '<button type="button" class="' + rowClass + '"' + tap + '>';
      html += '<div class="forecast-up-icon" style="background:' + iconBg + ';color:' + iconColor + '">' + iconSvg + '</div>';
      html += '<div><p class="forecast-up-title">' + escHtml(u.label) + '</p><p class="forecast-up-sub">' + escHtml(sub) + '</p></div>';
      html += '<div class="forecast-up-amt-col"><div class="' + amtClass + '">' + amtTxt + '</div>';
      html += '<div class="forecast-up-run">\u2192 ' + fmtForecastMoneyShort(u.balanceAfter) + '</div>';
      if (u.balanceAfter < cushion) {
        html += '<div class="forecast-cushion-chip"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2.2v4M6 8.2h.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M2.2 9.2h7.6L10.2 6 6 2.2 1.8 6l.4 3.2z" stroke="currentColor" stroke-width="1"/></svg>';
        html += 'Below ' + fmtForecastMoneyShort(cushion) + ' \u00B7 ' + fmtForecastMoneyShort(u.balanceAfter) + '</div>';
      }
      html += '</div></button>';
    });
    list.innerHTML = html;
    Array.prototype.forEach.call(list.querySelectorAll('[data-forecast-item]'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-forecast-item');
        var occTs = parseInt(btn.getAttribute('data-forecast-ts'), 10);
        var match = null;
        items.forEach(function (u) {
          if (u.itemKey === key && u.ts === occTs) match = u;
        });
        if (match) openForecastItemEditor(key, match.label, match.amount, match.ts, match.kind, match.categoryId);
      });
    });
  }

  function renderForecastScheduleInfo() {
    var el = $('forecastScheduleList');
    if (!el) return;
    if (!lastForecastSchedules.length) {
      el.innerHTML = '<p class="hint">No recurring patterns detected yet.</p>';
      return;
    }
    var html = '<div class="forecast-schedule-list">';
    lastForecastSchedules.forEach(function (s) {
      html += '<div class="forecast-schedule-row"><div class="forecast-schedule-name">' + escHtml(s.label) + '</div>';
      html += '<div class="forecast-schedule-detail">' + escHtml(s.inferenceDetail || '') + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  }

  function openBalanceSheet(accountId) {
    var acct = getAccount(accountId) || getCheckingAccount();
    if (!acct) return;
    balanceSheetAccountId = acct.id;
    var sheet = $('balanceSheet');
    var acctRow = $('balanceSheetAccount');
    if (acctRow) {
      acctRow.innerHTML = accountMiniIconHTML(acct) + '<div><div class="settings-account-name">' + escHtml(acct.name) + '</div><div class="settings-account-sub">Bank account</div></div>';
    }
    var inp = $('balanceAmountInput');
    if (inp) inp.value = typeof acct.currentBalance === 'number' ? fmtMoneyDisplay(acct.currentBalance) : '';
    var asOf = acct.balanceAsOf || localDateStamp();
    if ($('balanceAsOfInput')) $('balanceAsOfInput').value = asOf;
    if ($('balanceAsOfPreview')) $('balanceAsOfPreview').textContent = formatBalanceAsOfLabel(asOf);
    var foot = $('balanceSheetFoot');
    if (foot) {
      var hist = acct.balanceHistory;
      if (hist && hist.amount != null && hist.asOf) {
        foot.textContent = acct.name + ' transactions dated after ' + formatBalanceAsOfLabel(asOf).split(',')[0].replace('Today', 'today')
          + ' adjust it automatically. Last set: ' + fmtMoneyDisplay(hist.amount) + ' on ' + formatForecastShortDate(new Date(hist.asOf + 'T12:00:00').getTime()) + '.';
      } else {
        foot.textContent = acct.name + ' transactions dated after ' + formatBalanceAsOfLabel(asOf).split(',')[0].replace('Today', 'today') + ' adjust it automatically.';
      }
    }
    if (sheet) sheet.classList.add('show');
    if (EI && EI.hydrateUiIcons) EI.hydrateUiIcons(sheet);
  }

  function saveBalanceSheet() {
    var acct = getAccount(balanceSheetAccountId);
    if (!acct) return;
    var val = parseMoneyInput($('balanceAmountInput') && $('balanceAmountInput').value);
    if (isNaN(val)) { toast('Enter a valid balance'); return; }
    var asOf = ($('balanceAsOfInput') && $('balanceAsOfInput').value) || localDateStamp();
    if (typeof acct.currentBalance === 'number' && acct.balanceAsOf) {
      acct.balanceHistory = { amount: acct.currentBalance, asOf: acct.balanceAsOf };
    }
    acct.currentBalance = val;
    acct.balanceAsOf = asOf;
    saveAccounts();
    var sheet = $('balanceSheet');
    if (sheet) sheet.classList.remove('show');
    renderHomeForecastCard();
    if (forecastScreenOpen) renderForecastScreen();
    renderSettingsAccounts();
    toast('Balance saved');
  }

  function renderSettingsAccounts() {
    var el = $('settingsAccountsList');
    if (!el) return;
    ensureDefaultAccounts();
    var html = '';
    accounts.forEach(function (a) {
      html += '<div class="settings-account-row">';
      html += '<div class="settings-account-main">' + accountMiniIconHTML(a) + '<div><div class="settings-account-name">' + escHtml(a.name) + '</div>';
      html += '<div class="settings-account-sub">' + (a.type === 'bank' ? 'Bank account' : 'Credit card') + '</div></div></div>';
      if (a.type === 'bank') {
        html += '<button type="button" class="settings-account-action" data-balance-acct="' + escHtml(a.id) + '">Balance</button>';
      } else {
        html += '<span class="settings-account-sub">—</span>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
    Array.prototype.forEach.call(el.querySelectorAll('[data-balance-acct]'), function (btn) {
      btn.addEventListener('click', function () { openBalanceSheet(btn.dataset.balanceAcct); });
    });
  }

  function otherTransferPatternEnabled(entry) {
    var pat = normalizeTransferPattern(entry.bankText || entry.note || '');
    if (!pat) return false;
    for (var i = 0; i < transferPatterns.length; i++) {
      if (transferPatterns[i].pattern === pat) return true;
    }
    return false;
  }

  function setOtherTransferPattern(entry, enabled) {
    var pat = normalizeTransferPattern(entry.bankText || entry.note || '');
    if (!pat) return;
    var idx = -1;
    for (var i = 0; i < transferPatterns.length; i++) {
      if (transferPatterns[i].pattern === pat) { idx = i; break; }
    }
    if (enabled && idx === -1) {
      transferPatterns.push({ id: uid(), pattern: pat, createdAt: Date.now() });
      saveTransferPatterns();
    } else if (!enabled && idx !== -1) {
      transferPatterns.splice(idx, 1);
      saveTransferPatterns();
    }
  }

  function openOtherTransferSheet(entryId) {
    viewingOtherTransferEntryId = entryId;
    var entry = getEntryById(entryId);
    if (!entry) return;
    var checking = getAccount(entry.accountId);
    var body = $('otherTransferSheetBody');
    if (!body) return;
    var title = (entry.note || 'Transfer').trim();
    var bankText = entry.bankText || entry.note || '';
    var pairedMap = {};
    transferPairs.forEach(function (p) {
      if (!p || p.unlinked) return;
      pairedMap[p.entryIds[0]] = true;
      pairedMap[p.entryIds[1]] = true;
    });
    var delta = FC ? FC.entryCheckingDelta(entry, entry.accountId, pairedMap) : (isDepositEntry(entry) ? entry.amount : -entry.amount);
    var html = '';
    html += '<div class="other-transfer-hero">';
    html += '<div class="other-transfer-icon"><svg width="24" height="24" viewBox="0 0 20 20" fill="none"><path d="M4 7h9.5M13.5 7L11 4.5M13.5 7L11 9.5M16 13H6.5M6.5 13L9 10.5M6.5 13L9 15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>';
    html += '<div><h3 class="other-transfer-title">' + escHtml(title) + '</h3>';
    html += '<p class="other-transfer-sub">' + escHtml(checking ? checking.name : 'Checking') + ' \u2192 Other account</p></div>';
    html += '<div class="other-transfer-amt">' + fmtMoneyDisplay(entry.amount) + '</div></div>';
    html += '<div class="other-transfer-chip"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 7.2l2.2 2.2 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Not counted as spending or income</div>';
    html += '<div class="transfer-section-label">Details</div>';
    html += '<div class="transfer-details-card">';
    html += '<div class="transfer-details-row"><span>Type</span><span>Transfer \u00B7 Other account</span></div>';
    html += '<div class="transfer-details-row"><span>Date</span><span>' + new Date(entry.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + '</span></div>';
    html += '<div class="transfer-details-row"><span>Balance effect</span><span>' + (delta >= 0 ? '+' : '') + fmtMoneyDisplay(Math.abs(delta)) + ' ' + escHtml(checking ? checking.name : 'Checking') + '</span></div>';
    html += '<div class="transfer-details-row"><span>Bank text</span><span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;text-align:right;max-width:58%">' + escHtml(bankText) + '</span></div>';
    html += '</div>';
    var patOn = otherTransferPatternEnabled(entry);
    html += '<div class="other-transfer-toggle-card"><div><p>Treat future matches as transfers</p><span>Remembers &ldquo;' + escHtml(normalizeTransferPattern(bankText).slice(0, 28)) + '&rdquo;</span></div>';
    html += '<button type="button" class="toggle-switch' + (patOn ? ' is-on' : '') + '" id="otherTransferPatternToggle" role="switch" aria-checked="' + (patOn ? 'true' : 'false') + '" aria-label="Treat future matches as transfers"></button></div>';
    html += '<p class="other-transfer-foot"><span aria-hidden="true"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor"/><path d="M7 6.2v3.6M7 4.4h.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span><span>Moves your Checking balance and the forecast, but never counts as income or spending.</span></p>';
    body.innerHTML = html;
    var toggle = document.getElementById('otherTransferPatternToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var on = !toggle.classList.contains('is-on');
        toggle.classList.toggle('is-on', on);
        toggle.setAttribute('aria-checked', on ? 'true' : 'false');
        setOtherTransferPattern(entry, on);
      });
    }
    var sheet = $('otherTransferSheet');
    if (sheet) sheet.classList.add('show');
  }

  function closeOtherTransferSheet() {
    viewingOtherTransferEntryId = null;
    var sheet = $('otherTransferSheet');
    if (sheet) sheet.classList.remove('show');
  }

  function switchTab(tab) {
    closeForecastScreen();
    closeOtherTransferSheet();
    closeTransferDetail();
    if (tab === 'add') {
      tabBeforeAdd = currentTab === 'add' ? tabBeforeAdd : currentTab;
      openAddSheet();
      Array.prototype.forEach.call($tabBar.querySelectorAll('.tab-btn'), function (b) {
        b.classList.toggle('active', b.dataset.tab === tabBeforeAdd);
        b.setAttribute('aria-selected', b.dataset.tab === tabBeforeAdd ? 'true' : 'false');
      });
      return;
    }
    closeAddSheet();
    currentTab = tab;
    saveUI();
    Array.prototype.forEach.call($tabBar.querySelectorAll('.tab-btn'), function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if ($('tab-add')) $('tab-add').hidden = true;
    $('tab-summary').hidden = tab !== 'summary';
    $('tab-report').hidden = tab !== 'report';
    $('tab-history').hidden = tab !== 'history';
    $('tab-settings').hidden = tab !== 'settings';
    if (tab === 'summary') {
      renderTotals(); renderMonthlySummary(); renderRecent(); renderBackupReminder();
      renderHomeForecastCard();
      requestAnimationFrame(layoutDonutCenter);
    }
    if (tab === 'history') { renderEntries(); updateActivityStickyTop(); }
    if (tab === 'report') renderReport();
    if (tab === 'settings') {
      renderCategoryList(); renderBudgetSettings(); renderRecurringList();
      renderImportRulesList(); renderSettingsAccounts();
      if ($countCardPayments) $countCardPayments.checked = importSettings.countCardPayments;
      renderDataMetaLines();
      renderBackupReminder();
      $versionLine.textContent = 'Version ' + APP_VERSION;
    }
    window.scrollTo(0, 0);
  }

  $('viewAllBtn').addEventListener('click', function () { switchTab('history'); });
  if ($addCancelBtn) $addCancelBtn.addEventListener('click', function () {
    closeAddSheet();
    switchTab(tabBeforeAdd || 'summary');
  });
  function openAddNoteField() {
    if (!$note) return;
    var wrap = $('addNoteField');
    if (wrap) wrap.hidden = false;
    $note.classList.remove('visually-hidden-input');
    $note.removeAttribute('tabindex');
    requestAnimationFrame(function () {
      try { $note.focus({ preventScroll: true }); } catch (e) { $note.focus(); }
    });
  }
  if ($addNoteRow) $addNoteRow.addEventListener('click', openAddNoteField);
  if ($addDateRow) $addDateRow.addEventListener('click', function () {
    if ($addDate && $addDate.showPicker) try { $addDate.showPicker(); } catch (e) { $addDate.focus(); }
    else if ($addDate) $addDate.focus();
  });
  if ($addDate) $addDate.addEventListener('change', function () { addEntryDate = $addDate.value; updateAddDatePreview(); });
  if ($note) $note.addEventListener('input', updateAddNotePreview);
  if ($openWrappedBtn) $openWrappedBtn.addEventListener('click', function () {
    var val = $reportMonth.value;
    var y, m;
    if (val) { var p = val.split('-'); y = parseInt(p[0], 10); m = parseInt(p[1], 10) - 1; }
    else { var n = new Date(); y = n.getFullYear(); m = n.getMonth(); }
    openWrappedModal(y, m);
  });
  if ($homeRecapBtn) $homeRecapBtn.addEventListener('click', function () {
    var now = new Date();
    var pm = now.getMonth() - 1, py = now.getFullYear();
    if (pm < 0) { pm = 11; py -= 1; }
    openWrappedModal(py, pm);
    if (!uiState.dismissedWrapped) uiState.dismissedWrapped = {};
    uiState.dismissedWrapped[py + '-' + pm] = true;
    saveUI();
    updateHomeRecapTeaser();
  });
  if ($wrappedCloseBtn) $wrappedCloseBtn.addEventListener('click', closeWrappedModal);
  if ($wrappedDoneBtn) $wrappedDoneBtn.addEventListener('click', closeWrappedModal);
  var $homeForecastCard = $('homeForecastCard');
  if ($homeForecastCard) $homeForecastCard.addEventListener('click', openForecastScreen);
  var $forecastBackBtn = $('forecastBackBtn');
  if ($forecastBackBtn) $forecastBackBtn.addEventListener('click', closeForecastScreen);
  var $forecastUpdateBtn = $('forecastUpdateBtn');
  if ($forecastUpdateBtn) $forecastUpdateBtn.addEventListener('click', function () {
    var c = getCheckingAccount();
    if (c) openBalanceSheet(c.id);
  });
  var $forecastEmptySetBtn = $('forecastEmptySetBtn');
  if ($forecastEmptySetBtn) $forecastEmptySetBtn.addEventListener('click', function () {
    var c = getCheckingAccount();
    if (c) openBalanceSheet(c.id);
  });
  var $forecastInfoBtn = $('forecastInfoBtn');
  if ($forecastInfoBtn) $forecastInfoBtn.addEventListener('click', function () {
    var inp = $('forecastCushionInput');
    if (inp) inp.value = String(getForecastCushion());
    var note = $('forecastInfoDailyNote');
    var payload = buildForecastPayload(60);
    if (note && payload && FC) {
      var r = FC.runForecast(payload);
      if (r.ok && r.dailySpend > 0) note.textContent = 'Includes ~' + fmtMoneyDisplay(r.dailySpend) + '/day typical checking spending.';
      else note.textContent = '';
      if (r.schedules) lastForecastSchedules = r.schedules;
    }
    renderForecastScheduleInfo();
    var m = $('forecastInfoModal');
    if (m) m.classList.add('show');
  });
  if ($('forecastInfoCloseBtn')) $('forecastInfoCloseBtn').addEventListener('click', function () {
    var m = $('forecastInfoModal');
    if (m) m.classList.remove('show');
  });
  if ($('forecastCushionInput')) $('forecastCushionInput').addEventListener('change', function () {
    var v = parseFloat($('forecastCushionInput').value);
    if (!isNaN(v) && v >= 0) {
      setForecastCushion(v);
      renderHomeForecastCard();
      if (forecastScreenOpen) renderForecastScreen();
    }
  });
  if (typeof window !== 'undefined' && window.matchMedia) {
    var chartSchemeMq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChartSchemeChange = function () {
      if (forecastScreenOpen && lastForecastSim) {
        drawForecastChart(lastForecastSim, getForecastCushion());
      }
    };
    if (chartSchemeMq.addEventListener) chartSchemeMq.addEventListener('change', onChartSchemeChange);
    else if (chartSchemeMq.addListener) chartSchemeMq.addListener(onChartSchemeChange);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.forecast-range-btn'), function (btn) {
    btn.addEventListener('click', function () {
      var days = parseInt(btn.dataset.forecastDays, 10);
      if (!days) return;
      forecastChartDays = days;
      Array.prototype.forEach.call(document.querySelectorAll('.forecast-range-btn'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
      if (forecastScreenOpen) renderForecastScreen();
    });
  });
  if ($('balanceSheetClose')) $('balanceSheetClose').addEventListener('click', function () {
    var s = $('balanceSheet');
    if (s) s.classList.remove('show');
  });
  if ($('balanceSaveBtn')) $('balanceSaveBtn').addEventListener('click', saveBalanceSheet);
  if ($('balanceAsOfRow')) $('balanceAsOfRow').addEventListener('click', function () {
    var inp = $('balanceAsOfInput');
    if (inp && inp.showPicker) try { inp.showPicker(); } catch (e) { inp.focus(); }
    else if (inp) inp.focus();
  });
  if ($('balanceAsOfInput')) $('balanceAsOfInput').addEventListener('change', function () {
    if ($('balanceAsOfPreview')) $('balanceAsOfPreview').textContent = formatBalanceAsOfLabel($('balanceAsOfInput').value);
  });
  if ($('forecastItemEditCancelBtn')) $('forecastItemEditCancelBtn').addEventListener('click', function () {
    editingForecastItemKey = null;
    editingForecastOccurrenceTs = null;
    var m = $('forecastItemEditModal');
    if (m) m.classList.remove('show');
  });
  if ($('forecastItemEditSaveBtn')) $('forecastItemEditSaveBtn').addEventListener('click', saveForecastItemOverride);
  if ($('otherTransferSheet')) $('otherTransferSheet').addEventListener('click', function (ev) {
    if (ev.target === $('otherTransferSheet')) closeOtherTransferSheet();
  });
  if ($wrappedShareBtn) $wrappedShareBtn.addEventListener('click', shareWrapped);
  if ($wrappedTapBack) $wrappedTapBack.addEventListener('click', function () { wrappedGo(-1); });
  if ($wrappedTapNext) $wrappedTapNext.addEventListener('click', function () { wrappedGo(1); });
  var $summaryMonthPrev = $('summaryMonthPrev');
  var $summaryMonthNext = $('summaryMonthNext');
  var $reportMonthPrev = $('reportMonthPrev');
  var $reportMonthNext = $('reportMonthNext');
  if ($summaryMonthPrev) $summaryMonthPrev.addEventListener('click', function () { shiftMonthInput($summaryMonth, -1); });
  if ($summaryMonthNext) $summaryMonthNext.addEventListener('click', function () { shiftMonthInput($summaryMonth, 1); });
  if ($reportMonthPrev) $reportMonthPrev.addEventListener('click', function () { shiftMonthInput($reportMonth, -1); });
  if ($reportMonthNext) $reportMonthNext.addEventListener('click', function () { shiftMonthInput($reportMonth, 1); });
  if ($addSheet) $addSheet.addEventListener('click', function (e) {
    if (e.target === $addSheet) {
      closeAddSheet();
      switchTab(tabBeforeAdd || 'summary');
    }
  });

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
  $filterType.addEventListener('change', renderEntries);
  $filterSort.addEventListener('change', renderEntries);

  $summaryMonth.addEventListener('change', function () { renderTotals(); renderMonthlySummary(); });
  $reportMonth.addEventListener('change', renderReport);
  (function () {
    var backdrop = $('reportMonthBackdrop');
    if (!$reportMonth || !backdrop) return;
    function showBackdrop() { backdrop.hidden = false; }
    function hideBackdrop() {
      window.setTimeout(function () { backdrop.hidden = true; }, 200);
    }
    $reportMonth.addEventListener('focus', showBackdrop);
    $reportMonth.addEventListener('blur', hideBackdrop);
  })();
  $reportExportPdfBtn.addEventListener('click', function () { window.print(); });

  $yearSelect.addEventListener('change', function () {
    renderYearlySummary(parseInt($yearSelect.value, 10));
  });

  // Close modals on backdrop tap
  if ($importAccountContinueBtn) {
    $importAccountContinueBtn.addEventListener('click', continueImportAccountSheet);
  }
  if ($transferDetailBackBtn) {
    $transferDetailBackBtn.addEventListener('click', closeTransferDetail);
  }
  if ($addAccountRow && $addAccountSelect) {
    $addAccountRow.addEventListener('click', function () {
      rebuildAddAccountSelect();
      if ($addAccountSelect.showPicker) $addAccountSelect.showPicker();
      else $addAccountSelect.focus();
    });
    $addAccountSelect.addEventListener('change', function () {
      selectedAddAccountId = $addAccountSelect.value || '';
      updateAddAccountPreview();
    });
  }
  if ($addAccountCancelBtn) {
    $addAccountCancelBtn.addEventListener('click', function () {
      $addAccountModal.classList.remove('show');
      pendingAddAccountFromImport = false;
    });
  }
  if ($addAccountSaveBtn) {
    $addAccountSaveBtn.addEventListener('click', function () {
      var name = ($newAccountName && $newAccountName.value || '').trim();
      if (!name) { toast('Enter a name'); return; }
      var id = createAccountRecord(name, newAccountType);
      if (pendingAddAccountFromImport) {
        importAccountPickId = id;
        pendingAddAccountFromImport = false;
        $addAccountModal.classList.remove('show');
        renderImportAccountSheet();
      } else {
        selectedAddAccountId = id;
        $addAccountModal.classList.remove('show');
        rebuildAddAccountSelect();
        updateAddAccountPreview();
      }
      renderActivityAccountSegments();
      toast('Account added');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.account-type-btn'), function (btn) {
    btn.addEventListener('click', function () {
      newAccountType = btn.dataset.accountType === 'credit_card' ? 'credit_card' : 'bank';
      Array.prototype.forEach.call(document.querySelectorAll('.account-type-btn'), function (b) {
        b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
      });
    });
  });

  [$budgetModal, $catModal, $receiptModal, $pinModal, $importModal, $importAccountModal, $addAccountModal, $wrappedModal, $backupRestoreModal].forEach(function (ov) {
    if (!ov) return;
    ov.addEventListener('click', function (e) {
      if (e.target === ov) {
        ov.classList.remove('show');
        if (ov === $receiptModal) editingEntryId = null;
        if (ov === $importModal) pendingImport = null;
        if (ov === $importAccountModal) pendingImportAccount = null;
        if (ov === $backupRestoreModal) pendingBackupRestore = null;
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
    var mqHandler = function () {
      if (currentTab === 'summary') renderTotals();
      else if (lastDonutData) drawDonutFrame(lastDonutData.byCat, lastDonutData.total, 1, selectedLegendCatId);
    };
    if (mq.addEventListener) mq.addEventListener('change', mqHandler);
    else if (mq.addListener) mq.addListener(mqHandler);
  }

  // ---------- Render all ----------
  function renderAll() {
    renderRecent();
    renderEntries();
    renderTotals();
    renderMonthlySummary();
    renderBackupReminder();
    if (currentTab === 'report') renderReport();
    if (currentTab === 'settings') buildYearSelect();
  }

  function refreshCategorySurfacesAfterIcons() {
    buildCategoryButtons();
    rebuildFilterDropdowns();
    renderCategoryList();
    renderAll();
    renderReport();
    if ($wrappedModal && $wrappedModal.classList.contains('show') && wrappedMonth) {
      var p = buildWrappedPayload(wrappedMonth.y, wrappedMonth.m);
      if (!p.empty) renderWrappedStories(p, wrappedSlideIndex);
    }
    if (EI && EI.hydrateUiIcons) EI.hydrateUiIcons(document);
    refreshIconObservers(document);
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

  function bootApp() {
  // ---------- Boot ----------
  initPersistentStorage();
  categories = loadCategories();
  budgets = loadBudgets();
  recurringItems = loadRecurring();
  importRules = loadImportRules();
  importSettings = loadImportSettings();
  accounts = loadAccounts();
  transferPairs = loadTransferPairs();
  transferUnlinkKeys = loadTransferUnlinkKeys();
  importAccountPrefs = loadImportAccountPrefs();
  transferPatterns = loadTransferPatterns();
  forecastOverrides = loadForecastOverrides();
  ensureDefaultAccounts();
  ensureIncomeCategory();
  if ($countCardPayments) $countCardPayments.checked = importSettings.countCardPayments;
  entries = loadEntries();

  var ui = loadUI();
  currentTab = ui.tab || 'summary';
  if (currentTab === 'add') currentTab = 'summary';
  tabBeforeAdd = currentTab;

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
  renderDataMetaLines();
  renderBackupReminder();

  // Passcode label derived from stored state
  $togglePinBtn.textContent = getStoredPin() ? 'On' : 'Off';

  if (getStoredPin()) showLock();
  else showApp();

  initScreenTitleObservers();
  wireActivityFilters();
  syncActivityRangeChips();
  updateMonthPillLabels();
  addEntryDate = localDateStamp();
  if ($addDate) $addDate.value = addEntryDate;
  updateAddDatePreview();

  switchTab(currentTab);

  if (EI && EI.hydrateUiIcons) EI.hydrateUiIcons(document);
  refreshIconObservers(document);
  setTimeout(dismissSplash, prefersReducedMotion() ? 80 : 400);
  }

  bootApp();
  if (EI && EI.preloadIcons) {
    EI.preloadIcons(function () {
      refreshCategorySurfacesAfterIcons();
    });
  }

  window.ExpenseLoggerBackup = {
    buildBackupDocument: buildBackupDocument,
    buildBackupStorageSnapshot: buildBackupStorageSnapshot,
    validateBackupDocument: validateBackupDocument,
    applyStorageSnapshot: applyStorageSnapshot,
    applyBackupStorageReplacingAppData: applyBackupStorageReplacingAppData,
    collectExpenseLoggerKeys: collectExpenseLoggerKeys,
    summarizeBackupStorage: summarizeBackupStorage,
    formatCategorySummaryLabel: formatCategorySummaryLabel,
    pickDeviceBackupMeta: pickDeviceBackupMeta,
    commitBackupRestore: commitBackupRestore
  };

  window.ExpenseLoggerTest = {
    APP_VERSION: APP_VERSION,
    BACKUP_FORMAT: BACKUP_FORMAT,
    suggestImportAccountId: suggestImportAccountId,
    importRowMatchKey: importRowMatchKey,
    descriptionMatchKey: descriptionMatchKey,
    dayKey: dayKey,
    fmtMoney: fmtMoney,
    rowsFromTable: rowsFromTable,
    detectImportLayout: detectImportLayout,
    autoPairTransfers: autoPairTransfers,
    unlinkTransferPair: unlinkTransferPair,
    isTransferPairBlocked: isTransferPairBlocked,
    transferPairBlockKey: transferPairBlockKey,
    entryCountsAsSpending: entryCountsAsSpending,
    entryQualifiesForTransferPair: entryQualifiesForTransferPair,
    buildActivityDisplayItems: buildActivityDisplayItems,
    computeActivitySummary: computeActivitySummary,
    getActivityRangeBounds: getActivityRangeBounds,
    backfillEntryAccount: backfillEntryAccount,
    getAccount: getAccount,
    getEntryById: getEntryById,
    getActivePairForEntry: getActivePairForEntry,
    accountShortName: accountShortName,
    ensureDefaultAccounts: ensureDefaultAccounts,
    DEFAULT_ACCOUNT_CHECKING: DEFAULT_ACCOUNT_CHECKING,
    DEFAULT_ACCOUNT_CHASE: DEFAULT_ACCOUNT_CHASE,
    getState: function () {
      return {
        entries: entries,
        accounts: accounts,
        transferPairs: transferPairs,
        transferUnlinkKeys: transferUnlinkKeys,
        importAccountPrefs: importAccountPrefs
      };
    },
    setState: function (patch) {
      if (patch.entries) entries = patch.entries;
      if (patch.accounts) accounts = patch.accounts;
      if (patch.transferPairs) transferPairs = patch.transferPairs;
      if (patch.transferUnlinkKeys) transferUnlinkKeys = patch.transferUnlinkKeys;
      if (patch.importAccountPrefs) importAccountPrefs = patch.importAccountPrefs;
    },
    persist: function () {
      saveEntries();
      saveAccounts();
      saveTransferPairs();
      saveTransferUnlinkKeys();
      saveImportAccountPrefs();
    },
    reloadFromStorage: reloadAllStateFromStorage,
    buildWrappedPayload: buildWrappedPayload,
    drawWrappedToCanvas: drawWrappedToCanvas,
    openWrappedModal: openWrappedModal,
    updateHomeRecapTeaser: updateHomeRecapTeaser,
    ExpenseForecast: FC,
    normalizeTransferPattern: normalizeTransferPattern,
    isOtherAccountTransferEntry: isOtherAccountTransferEntry,
    projectedStartingBalance: function (balance, asOfMs) {
      var checking = getCheckingAccount();
      if (!checking || !FC) return null;
      return FC.projectedStartingBalance(balance, asOfMs, entries, checking.id, transferPairs, Date.now());
    },
    runForecast: function (opts) {
      var p = buildForecastPayload(opts && opts.chartDays);
      if (!p) return { ok: false };
      return FC.runForecast(p);
    },
    getTransferPatterns: function () { return transferPatterns; },
    setTransferPatterns: function (p) { transferPatterns = p; saveTransferPatterns(); }
  };

})();