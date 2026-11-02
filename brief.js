/* Expense Logger — agent brief (pure functions, no DOM or storage).
   In the browser, load forecast.js and wrapped.js before this file. */
(function (root, factory) {
  var FC = root && root.ExpenseForecast;
  var EW = root && root.ExpenseWrapped;
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    if (!FC) { try { FC = require('./forecast.js'); } catch (e1) { FC = null; } }
    if (!EW) { try { EW = require('./wrapped.js'); } catch (e2) { EW = null; } }
  }
  var api = factory(FC, EW);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseBrief = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FC, EW) {
  'use strict';

  var SCHEMA = 1;
  var CHECKING_ID = 'acct-checking';
  var CHASE_ID = 'acct-chase';
  var TOP_N = 5;

  function roundMoney(n) {
    return Math.round(n * 100) / 100;
  }

  /** Nearest $100, halves away from zero. Non-finite input becomes null. */
  function roundToNearest100(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    var sign = n < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(n) / 100) * 100;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function monthKey(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function balanceAsOfMs(acct) {
    if (!acct || !acct.balanceAsOf || !FC || !FC.dateMs) return null;
    var parts = String(acct.balanceAsOf).split('-');
    if (parts.length < 3) return null;
    var y = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var d = parseInt(parts[2], 10);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
    var t = FC.dateMs(y, m, d);
    return isFinite(t) ? t : null;
  }

  function accountById(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function accountByType(list, type) {
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].type === type) return list[i];
    }
    return null;
  }

  function checkingAccount(input) {
    var list = input.accounts || [];
    return accountById(list, input.checkingId || CHECKING_ID)
      || accountByType(list, 'bank')
      || list[0]
      || null;
  }

  function chaseAccount(input) {
    var list = input.accounts || [];
    var named = accountById(list, input.chaseId || CHASE_ID);
    if (named && named.type === 'credit_card') return named;
    return accountByType(list, 'credit_card');
  }

  function creditIds(accounts) {
    var set = {};
    (accounts || []).forEach(function (a) {
      if (a && a.type === 'credit_card' && a.id) set[a.id] = true;
    });
    return set;
  }

  function countsAsSpending(e) {
    if (EW && EW.entryCountsAsSpending) return EW.entryCountsAsSpending(e);
    if (!e || typeof e.amount !== 'number') return false;
    if (e.isDeposit || e.isTransfer || e.excluded || e.countAsSpending === false) return false;
    return true;
  }

  /* Card deposits are refunds, not income. Card payments are transfers, not spend. */
  function countsAsIncome(e, cards) {
    if (!e || typeof e.amount !== 'number' || !(e.amount > 0)) return false;
    if (e.isTransfer || e.excluded || !e.isDeposit) return false;
    if (e.accountId && cards[e.accountId]) return false;
    return true;
  }

  function categoryName(categories, id) {
    var list = categories || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i].name || id || 'Other';
    }
    return id || 'Other';
  }

  function savingsRate(income, spend) {
    if (!(income > 0)) return null;
    return Math.round(((income - spend) / income) * 100) / 100;
  }

  function buildMonths(input, cards, nowMs) {
    var current = monthKey(nowMs);
    var buckets = {};
    (input.entries || []).forEach(function (e) {
      if (!e || typeof e.ts !== 'number') return;
      var key = monthKey(e.ts);
      if (!key || (current && key > current)) return;
      var spend = countsAsSpending(e) ? e.amount : 0;
      var income = countsAsIncome(e, cards) ? e.amount : 0;
      if (!spend && !income) return;
      if (!buckets[key]) buckets[key] = { income: 0, spend: 0, cats: {} };
      buckets[key].income += income;
      buckets[key].spend += spend;
      if (!spend || e.categoryId === 'income') return;
      var name = categoryName(input.categories, e.categoryId);
      buckets[key].cats[name] = (buckets[key].cats[name] || 0) + spend;
    });
    return Object.keys(buckets).sort().map(function (key) {
      var b = buckets[key];
      var byCategory = {};
      Object.keys(b.cats).sort().forEach(function (name) {
        var total = roundMoney(b.cats[name]);
        if (total) byCategory[name] = total;
      });
      var income = roundMoney(b.income);
      var spend = roundMoney(b.spend);
      return {
        month: key,
        income: income,
        spend: spend,
        savingsRate: savingsRate(income, spend),
        byCategory: byCategory
      };
    }).filter(function (row) { return row.income || row.spend; });
  }

  function forecastPayload(input, checking, chase, owed, nowMs) {
    var balance = checking && typeof checking.currentBalance === 'number' ? checking.currentBalance : null;
    return {
      nowMs: nowMs,
      checkingId: checking && checking.id,
      chaseId: chase && chase.id,
      balance: balance,
      balanceAsOfMs: balanceAsOfMs(checking),
      cardBalanceOwed: owed,
      entries: input.entries || [],
      recurringItems: input.recurringItems || [],
      transferPairs: input.transferPairs || [],
      overrides: input.overrides,
      countedOneOffs: input.countedOneOffs,
      cushion: input.cushion,
      chartDays: input.chartDays,
      maxLookaheadDays: input.maxLookaheadDays
    };
  }

  function chaseOwedRaw(chase, entries, nowMs) {
    if (!FC || !FC.computeCardBalanceOwed || !chase) return null;
    if (typeof chase.currentBalance !== 'number' || !chase.balanceAsOf) return null;
    var snap = FC.computeCardBalanceOwed({
      anchorAmount: chase.currentBalance,
      anchorAsOfMs: balanceAsOfMs(chase),
      entries: entries || [],
      chaseId: chase.id,
      nowMs: nowMs
    });
    return snap && snap.ok && typeof snap.owed === 'number' ? snap.owed : null;
  }

  function buildForecast(input, checking, chase, owed, nowMs) {
    var empty = { lowPointDate: null, lowPointAmount: null, runwayDays: null, checkingRaw: null };
    if (!FC || !FC.runForecast || !checking) return empty;
    var result = FC.runForecast(forecastPayload(input, checking, chase, owed, nowMs));
    if (!result || !result.ok) return empty;
    var low = result.lowest;
    var date = low && FC.dayKey ? FC.dayKey(low.ts) : null;
    if (date === 'invalid') date = null;
    return {
      lowPointDate: date,
      lowPointAmount: low && typeof low.balance === 'number' ? roundMoney(low.balance) : null,
      // Null when checking does not hit zero inside the forecast lookahead.
      runwayDays: result.daysAway == null ? null : result.daysAway,
      checkingRaw: typeof result.startingBalance === 'number' ? result.startingBalance : null
    };
  }

  function isCalendarDate(raw) {
    var t = String(raw || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return true;
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(t)) return true;
    return false;
  }

  /* Phones are 7 or more digits, with spaces, dashes, dots, or parentheses.
     Calendar dates and store numbers under 7 digits stay. */
  function stripPhonesAndEmail(s) {
    s = s.replace(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/ig, ' ');
    s = s.replace(/(?:\+\s*)?(?:\(?\d+\)?(?:[\s.\-]+\(?\d+\)?)*)/g, function (raw) {
      var digits = raw.replace(/\D/g, '');
      if (digits.length < 7 || isCalendarDate(raw)) return raw;
      return ' ';
    });
    return s;
  }

  function cleanName(label) {
    var s = stripPhonesAndEmail(String(label == null ? '' : label));
    s = s.replace(/\s+/g, ' ')
      .replace(/(?:\*{2,}|\u2022{2,}|x{2,})\s*\d{2,}/ig, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.\-–,;:|/]+|[\s.\-–,;:|/]+$/g, '')
      .trim()
      .slice(0, 80);
    if (!/[A-Za-z]/.test(s)) return '';
    return s;
  }

  function leaksBankText(label, entries) {
    var s = String(label || '');
    if (!s) return false;
    for (var i = 0; i < (entries || []).length; i++) {
      var bt = entries[i] && entries[i].bankText;
      if (bt && s.indexOf(String(bt)) !== -1) return true;
    }
    return false;
  }

  function addBill(list, seen, label, amount, due, entries) {
    if (leaksBankText(label, entries)) return;
    var name = cleanName(label);
    if (!name || !due || due === 'invalid' || !(amount > 0)) return;
    var amt = roundMoney(amount);
    var key = name.toLowerCase() + '|' + amt + '|' + due;
    if (seen[key]) return;
    seen[key] = true;
    list.push({ name: name, amount: amt, dueDate: due });
  }

  function upcomingBills(input, checking, chase, owed, nowMs) {
    var list = [];
    var seen = {};
    if (!FC || !FC.buildScheduledEvents || !FC.startOfDay || !checking) return list;
    var today = FC.startOfDay(nowMs);
    var payload = forecastPayload(input, checking, chase, owed, nowMs);
    payload.dailySpend = 0;
    var scheduled = FC.buildScheduledEvents(payload);
    var nextByItem = {};
    (scheduled.events || []).forEach(function (ev) {
      if (!ev || ev.kind !== 'outflow' || !(ev.ts > today)) return;
      var key = ev.itemKey || ev.label;
      if (!nextByItem[key] || ev.ts < nextByItem[key].ts) nextByItem[key] = ev;
    });
    Object.keys(nextByItem).forEach(function (key) {
      var ev = nextByItem[key];
      addBill(list, seen, ev.label, ev.amount, FC.dayKey(ev.ts), input.entries);
    });
    if (chase && FC.detectRecurringSchedules && FC.nextProjectedOccurrence) {
      FC.detectRecurringSchedules(input.entries || [], {
        checkingId: chase.id,
        sinceMs: FC.addDays(today, -400),
        nowMs: today,
        kind: 'outflow',
        transferPairs: input.transferPairs || []
      }).forEach(function (s) {
        var next = FC.nextProjectedOccurrence(s, today, input.entries || [], chase.id);
        if (!next) return;
        addBill(list, seen, s.label, next.amount, FC.dayKey(next.ts), input.entries);
      });
    }
    list.sort(function (a, b) {
      if (a.dueDate < b.dueDate) return -1;
      if (a.dueDate > b.dueDate) return 1;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return 0;
    });
    return list;
  }

  function topMerchants(input) {
    var groups = {};
    (input.entries || []).forEach(function (e) {
      if (!countsAsSpending(e)) return;
      var note = e.note || '';
      if (e.bankText && note.indexOf(String(e.bankText)) !== -1) return;
      var key = EW && EW.merchantKey ? EW.merchantKey(note) : String(note).toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key) return;
      var name = cleanName(EW && EW.normalizeMerchantName ? EW.normalizeMerchantName(note) : note);
      if (!name) return;
      var cat = categoryName(input.categories, e.categoryId);
      if (e.categoryId === 'income') return;
      if (!groups[cat]) groups[cat] = {};
      if (!groups[cat][key]) groups[cat][key] = { name: name, total: 0 };
      else if (name.length < groups[cat][key].name.length) groups[cat][key].name = name;
      groups[cat][key].total += e.amount;
    });
    var out = {};
    Object.keys(groups).sort().forEach(function (cat) {
      var rows = Object.keys(groups[cat]).map(function (k) {
        return { name: groups[cat][k].name, total: roundMoney(groups[cat][k].total) };
      });
      rows.sort(function (a, b) {
        if (b.total !== a.total) return b.total - a.total;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      out[cat] = rows.slice(0, TOP_N);
    });
    return out;
  }

  function buildAgentBrief(input) {
    input = input || {};
    var level = input.level === 'L1' ? 'L1' : 'L0';
    var nowMs = typeof input.nowMs === 'number' && isFinite(input.nowMs) ? input.nowMs : Date.now();
    var cards = creditIds(input.accounts);
    var checking = checkingAccount(input);
    var chase = chaseAccount(input);
    var owed = chaseOwedRaw(chase, input.entries, nowMs);
    var forecast = buildForecast(input, checking, chase, owed, nowMs);
    var generated = typeof input.generatedAt === 'string' && input.generatedAt
      ? input.generatedAt
      : new Date(nowMs).toISOString();
    var brief = {
      schema: SCHEMA,
      level: level,
      generatedAt: generated,
      months: buildMonths(input, cards, nowMs),
      forecast: {
        lowPointDate: forecast.lowPointDate,
        lowPointAmount: forecast.lowPointAmount,
        runwayDays: forecast.runwayDays
      },
      balances: {
        checking: roundToNearest100(forecast.checkingRaw),
        chaseOwed: roundToNearest100(owed)
      }
    };
    if (level === 'L1') {
      brief.upcomingBills = upcomingBills(input, checking, chase, owed, nowMs);
      brief.topMerchants = topMerchants(input);
    }
    return brief;
  }

  return {
    SCHEMA: SCHEMA,
    roundToNearest100: roundToNearest100,
    buildAgentBrief: buildAgentBrief
  };
});
