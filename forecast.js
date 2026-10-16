/* Expense Logger — cash-flow forecast (pure logic, no DOM) */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MS_DAY = 86400000;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function startOfDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function addDays(ts, n) {
    return startOfDay(ts) + n * MS_DAY;
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function normText(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function compactText(s) {
    return normText(s).replace(/[^a-z0-9]/g, '');
  }

  function normalizeTransferPattern(desc) {
    var n = normText(desc);
    if (!n) return '';
    n = n.replace(/\d{3,}/g, '');
    n = n.replace(/\s+/g, ' ').trim();
    if (n.length > 48) n = n.slice(0, 48).trim();
    return n;
  }

  function patternMatches(desc, pattern) {
    if (!pattern) return false;
    var key = compactText(desc);
    var pat = compactText(pattern);
    if (!pat || pat.length < 4) return false;
    return key.indexOf(pat) === 0 || key.indexOf(pat) !== -1;
  }

  function isOtherAccountTransfer(entry) {
    return !!(entry && entry.isTransfer && entry.transferKind === 'other');
  }

  function isDepositEntry(entry) {
    return !!(entry && entry.isDeposit);
  }

  function pairedEntryIds(transferPairs) {
    var set = {};
    (transferPairs || []).forEach(function (p) {
      if (!p || p.unlinked) return;
      set[p.entryIds[0]] = true;
      set[p.entryIds[1]] = true;
    });
    return set;
  }

  function entryCheckingDelta(entry, checkingId, pairedIds) {
    if (!entry || entry.accountId !== checkingId) return 0;
    var amt = typeof entry.amount === 'number' ? entry.amount : 0;
    if (amt <= 0) return 0;
    if (isOtherAccountTransfer(entry)) {
      return isDepositEntry(entry) ? amt : -amt;
    }
    if (entry.isTransfer) {
      if (pairedIds[entry.id]) return -amt;
      return 0;
    }
    if (isDepositEntry(entry)) return amt;
    return -amt;
  }

  function projectedStartingBalance(balance, balanceAsOfMs, entries, checkingId, transferPairs, nowMs) {
    if (balance == null || isNaN(balance)) return null;
    var asOf = balanceAsOfMs != null ? startOfDay(balanceAsOfMs) : startOfDay(nowMs);
    var paired = pairedEntryIds(transferPairs);
    var net = 0;
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (startOfDay(e.ts) <= asOf) return;
      net += entryCheckingDelta(e, checkingId, paired);
    });
    return Math.round((balance + net) * 100) / 100;
  }

  function descriptionKey(note) {
    var c = compactText(note);
    if (c.length < 4) return c;
    return c.slice(0, 24);
  }

  function median(nums) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    if (s.length % 2) return s[mid];
    return (s[mid - 1] + s[mid]) / 2;
  }

  function trimmedMean(nums, trimFrac) {
    if (!nums.length) return 0;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var trim = Math.floor(s.length * (trimFrac || 0.1));
    var slice = s.slice(trim, s.length - trim);
    if (!slice.length) slice = s;
    var sum = 0;
    for (var i = 0; i < slice.length; i++) sum += slice[i];
    return sum / slice.length;
  }

  function classifyInterval(days) {
    if (days >= 6 && days <= 8) return 'weekly';
    if (days >= 13 && days <= 16) return 'biweekly';
    if (days >= 14 && days <= 17) return 'semimonthly';
    if (days >= 27 && days <= 33) return 'monthly';
    if (days >= 12 && days <= 18) return 'biweekly';
    return null;
  }

  function detectRecurrences(entries, opts) {
    opts = opts || {};
    var checkingId = opts.checkingId;
    var sinceMs = opts.sinceMs || 0;
    var kind = opts.kind || 'any';
    var paired = pairedEntryIds(opts.transferPairs);
    var groups = {};
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (e.ts < sinceMs) return;
      if (kind === 'transfer-other') {
        if (!isOtherAccountTransfer(e)) return;
      } else if (isOtherAccountTransfer(e)) {
        return;
      }
      if (kind === 'inflow') {
        if (!isDepositEntry(e)) return;
        if (e.isTransfer) return;
      }
      if (kind === 'outflow') {
        if (isDepositEntry(e)) return;
        if (e.isTransfer) return;
        if (paired[e.id]) return;
      }
      var key = descriptionKey(e.note || '');
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });

    var out = [];
    Object.keys(groups).forEach(function (key) {
      var list = groups[key].sort(function (a, b) { return a.ts - b.ts; });
      if (list.length < 3) return;
      var amounts = list.map(function (e) { return e.amount; });
      var medAmt = median(amounts);
      var similar = list.filter(function (e) {
        return Math.abs(e.amount - medAmt) <= Math.max(5, medAmt * 0.08);
      });
      if (similar.length < 3) return;
      var gaps = [];
      for (var i = 1; i < similar.length; i++) {
        gaps.push(Math.round((startOfDay(similar[i].ts) - startOfDay(similar[i - 1].ts)) / MS_DAY));
      }
      var medGap = median(gaps);
      var interval = classifyInterval(medGap);
      if (!interval) return;
      var last = similar[similar.length - 1];
      var sample = similar[0];
      var isIn = isDepositEntry(sample);
      if (kind === 'inflow' && !isIn) return;
      if (kind === 'outflow' && isIn) return;
      if (kind === 'transfer-other' && !isOtherAccountTransfer(sample)) return;

      out.push({
        key: key,
        label: (sample.note || key).slice(0, 48),
        amount: Math.round(medAmt * 100) / 100,
        interval: interval,
        medianGapDays: medGap,
        lastTs: last.ts,
        isInflow: isIn,
        isOtherTransfer: isOtherAccountTransfer(sample),
        categoryId: sample.categoryId,
        sampleNote: sample.note || ''
      });
    });
    return out;
  }

  function nextOccurrenceAfter(lastTs, interval, afterMs) {
    var cursor = startOfDay(lastTs);
    var guard = 0;
    while (cursor <= afterMs && guard < 500) {
      if (interval === 'weekly') cursor = addDays(cursor, 7);
      else if (interval === 'biweekly') cursor = addDays(cursor, 14);
      else if (interval === 'semimonthly') {
        var d = new Date(cursor);
        if (d.getDate() < 15) cursor = new Date(d.getFullYear(), d.getMonth(), 15).getTime();
        else cursor = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      } else if (interval === 'monthly') {
        var dm = new Date(cursor);
        cursor = new Date(dm.getFullYear(), dm.getMonth() + 1, dm.getDate()).getTime();
      } else cursor = addDays(cursor, 30);
      guard++;
    }
    return cursor;
  }

  function expandRecurrenceSeries(rec, untilMs, afterMs) {
    var events = [];
    var next = nextOccurrenceAfter(rec.lastTs, rec.interval, afterMs);
    var guard = 0;
    while (next <= untilMs && guard < 200) {
      events.push({
        ts: next,
        amount: rec.amount,
        kind: rec.isOtherTransfer ? 'transfer-other' : (rec.isInflow ? 'inflow' : 'outflow'),
        inflow: !!rec.isInflow,
        label: rec.label,
        categoryId: rec.categoryId,
        recurringKey: rec.key
      });
      next = nextOccurrenceAfter(next, rec.interval, next);
      guard++;
    }
    return events;
  }

  function estimateDailySpend(entries, checkingId, transferPairs, nowMs) {
    var since = addDays(nowMs, -75);
    var paired = pairedEntryIds(transferPairs);
    var recurringKeys = {};
    detectRecurrences(entries, { checkingId: checkingId, sinceMs: since, kind: 'outflow', transferPairs: transferPairs })
      .forEach(function (r) { recurringKeys[r.key] = true; });
    var byDay = {};
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (e.ts < since || e.ts > nowMs) return;
      if (isDepositEntry(e) || isOtherAccountTransfer(e)) return;
      if (e.isTransfer) return;
      if (recurringKeys[descriptionKey(e.note || '')]) return;
      var dk = dayKey(e.ts);
      byDay[dk] = (byDay[dk] || 0) + e.amount;
    });
    var days = Object.keys(byDay).map(function (k) { return byDay[k]; });
    if (days.length < 7) return 0;
    return Math.round(trimmedMean(days, 0.1) * 100) / 100;
  }

  function estimateCardPayment(entries, transferPairs, checkingId, chaseId, nowMs) {
    var paired = pairedEntryIds(transferPairs);
    var debits = [];
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (!e.isTransfer || !paired[e.id]) return;
      debits.push({ ts: e.ts, amount: e.amount });
    });
    debits.sort(function (a, b) { return a.ts - b.ts; });
    if (debits.length >= 2) {
      var gaps = [];
      for (var i = 1; i < debits.length; i++) {
        gaps.push((startOfDay(debits[i].ts) - startOfDay(debits[i - 1].ts)) / MS_DAY);
      }
      var medGap = median(gaps);
      var medAmt = median(debits.map(function (d) { return d.amount; }));
      var last = debits[debits.length - 1];
      return {
        amount: Math.round(medAmt * 100) / 100,
        intervalDays: medGap,
        lastTs: last.ts,
        source: 'paired'
      };
    }
    if (!chaseId) return null;
    var since = addDays(nowMs, -35);
    var spend = 0;
    (entries || []).forEach(function (e) {
      if (e.accountId !== chaseId) return;
      if (e.ts < since) return;
      if (e.isTransfer) return;
      if (!e.excluded && e.amount > 0) spend += e.amount;
    });
    if (spend <= 0) return null;
    return {
      amount: Math.round(spend * 100) / 100,
      intervalDays: 30,
      lastTs: nowMs,
      source: 'card-spend'
    };
  }

  function buildScheduledEvents(input) {
    var nowMs = startOfDay(input.nowMs || Date.now());
    var untilMs = addDays(nowMs, input.maxLookaheadDays || 365);
    var checkingId = input.checkingId;
    var events = [];
    var recIn = detectRecurrences(input.entries, {
      checkingId: checkingId, sinceMs: addDays(nowMs, -120), kind: 'inflow', transferPairs: input.transferPairs
    });
    var recOut = detectRecurrences(input.entries, {
      checkingId: checkingId, sinceMs: addDays(nowMs, -120), kind: 'outflow', transferPairs: input.transferPairs
    });
    var recXfer = detectRecurrences(input.entries, {
      checkingId: checkingId, sinceMs: addDays(nowMs, -120), kind: 'transfer-other', transferPairs: input.transferPairs
    });
    recIn.concat(recOut).concat(recXfer).forEach(function (r) {
      events = events.concat(expandRecurrenceSeries(r, untilMs, nowMs));
    });

    (input.recurringItems || []).forEach(function (item) {
      if (!item || !item.amount) return;
      var acct = item.accountId || checkingId;
      if (acct !== checkingId) return;
      var d = item.dayOfMonth || 1;
      var cursor = new Date(nowMs);
      for (var m = 0; m < 14; m++) {
        var y = cursor.getFullYear();
        var mo = cursor.getMonth() + m;
        var dt = new Date(y, mo, Math.min(d, 28));
        var ts = startOfDay(dt.getTime());
        if (ts > nowMs && ts <= untilMs) {
          events.push({
            ts: ts,
            amount: item.amount,
            kind: 'outflow',
            label: item.note || 'Recurring',
            categoryId: item.categoryId,
            recurringKey: 'recurring-' + item.id
          });
        }
      }
    });

    var cardEst = estimateCardPayment(input.entries, input.transferPairs, checkingId, input.chaseId, nowMs);
    if (cardEst && cardEst.amount > 0) {
      var nextCard = addDays(cardEst.lastTs, Math.round(cardEst.intervalDays || 30));
      var guard = 0;
      while (nextCard <= untilMs && guard < 24) {
        if (nextCard > nowMs) {
          events.push({
            ts: nextCard,
            amount: cardEst.amount,
            kind: 'card-payment',
            label: 'Chase card payment',
            categoryId: null
          });
        }
        nextCard = addDays(nextCard, Math.round(cardEst.intervalDays || 30));
        guard++;
      }
    }

    var daily = input.dailySpend != null ? input.dailySpend : estimateDailySpend(input.entries, checkingId, input.transferPairs, nowMs);
    if (daily > 0) {
      for (var day = 1; day <= (input.maxLookaheadDays || 365); day++) {
        var ts = addDays(nowMs, day);
        if (ts > untilMs) break;
        events.push({
          ts: ts,
          amount: daily,
          kind: 'daily',
          label: 'Typical spending',
          categoryId: null,
          daily: true
        });
      }
    }
    return { events: events, dailySpend: daily, cardEst: cardEst };
  }

  function applyEventDelta(ev) {
    if (ev.kind === 'inflow') return ev.amount;
    if (ev.kind === 'transfer-other') return ev.amount; // signed later
    if (ev.kind === 'daily' || ev.kind === 'outflow' || ev.kind === 'card-payment') return -ev.amount;
    return 0;
  }

  function eventDisplayAmount(ev) {
    if (ev.kind === 'inflow') return ev.amount;
    if (ev.kind === 'transfer-other') return ev.amount;
    return ev.amount;
  }

  function simulateBalanceTimeline(input) {
    var nowMs = startOfDay(input.nowMs || Date.now());
    var startBal = input.startingBalance;
    if (startBal == null || isNaN(startBal)) {
      return { ok: false, reason: 'no-balance' };
    }
    var horizon = input.chartDays || 60;
    var historyDays = input.historyDays || 5;
    var cushion = input.cushion != null ? input.cushion : 600;
    var scheduled = buildScheduledEvents(input);
    var events = scheduled.events.slice().sort(function (a, b) {
      if (a.ts !== b.ts) return a.ts - b.ts;
      var order = { inflow: 0, 'transfer-other': 1, 'card-payment': 2, outflow: 3, daily: 4 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });

    var paired = pairedEntryIds(input.transferPairs);
    var histStart = addDays(nowMs, -historyDays);
    var histPoints = [];
    var todayDelta = 0;
    (input.entries || []).forEach(function (e) {
      if (e.accountId !== input.checkingId) return;
      if (startOfDay(e.ts) !== nowMs) return;
      todayDelta += entryCheckingDelta(e, input.checkingId, paired);
    });
    var bal = Math.round((startBal + todayDelta) * 100) / 100;
    var running = bal;
    var dayCursor = nowMs;
    while (dayCursor >= histStart) {
      histPoints.unshift({ ts: dayCursor, balance: running, actual: true });
      if (dayCursor === histStart) break;
      var prevDay = addDays(dayCursor, -1);
      var dayDelta = 0;
      (input.entries || []).forEach(function (e) {
        if (e.accountId !== input.checkingId) return;
        if (startOfDay(e.ts) !== dayCursor) return;
        dayDelta += entryCheckingDelta(e, input.checkingId, paired);
      });
      running = Math.round((running - dayDelta) * 100) / 100;
      dayCursor = prevDay;
    }

    var futurePoints = [{ ts: nowMs, balance: bal, today: true }];
    var upcoming = [];
    var lowest = { balance: bal, ts: nowMs };
    var lastsUntil = null;
    var lookaheadEnd = addDays(nowMs, input.maxLookaheadDays || 365);
    var chartEnd = addDays(nowMs, horizon);

    var byDay = {};
    events.forEach(function (ev) {
      if (ev.ts <= nowMs) return;
      var dk = dayKey(ev.ts);
      if (!byDay[dk]) byDay[dk] = [];
      byDay[dk].push(ev);
    });

    var simDay = addDays(nowMs, 1);
    while (simDay <= lookaheadEnd) {
      var list = byDay[dayKey(simDay)] || [];
      list.forEach(function (ev) {
        var delta;
        if (ev.kind === 'inflow') delta = ev.amount;
        else if (ev.kind === 'transfer-other') delta = ev.inflow ? ev.amount : -ev.amount;
        else delta = -ev.amount;
        bal = Math.round((bal + delta) * 100) / 100;
        upcoming.push({
          ts: ev.ts,
          kind: ev.kind,
          label: ev.label,
          amount: ev.amount,
          delta: delta,
          balanceAfter: bal,
          categoryId: ev.categoryId,
          daily: !!ev.daily
        });
      });
      if (bal < lowest.balance) lowest = { balance: bal, ts: simDay };
      if (lastsUntil == null && bal < 0) lastsUntil = simDay;
      if (simDay <= chartEnd) {
        futurePoints.push({ ts: simDay, balance: bal });
      }
      simDay = addDays(simDay, 1);
    }

    var neverRunsOut = lastsUntil == null;
    var daysAway = lastsUntil != null ? Math.round((lastsUntil - nowMs) / MS_DAY) : null;

    return {
      ok: true,
      startingBalance: startBal,
      points: histPoints.concat(futurePoints),
      upcoming: upcoming.filter(function (u) { return u.ts <= chartEnd && !u.daily; }),
      lowest: lowest,
      lastsUntil: neverRunsOut ? null : lastsUntil,
      neverRunsOut: neverRunsOut,
      daysAway: daysAway,
      dailySpend: scheduled.dailySpend,
      cushion: cushion
    };
  }

  function runForecast(input) {
    input = input || {};
    var nowMs = input.nowMs || Date.now();
    var checkingId = input.checkingId;
    var startBal = projectedStartingBalance(
      input.balance,
      input.balanceAsOfMs,
      input.entries,
      checkingId,
      input.transferPairs,
      nowMs
    );
    if (startBal == null) {
      return { ok: false, reason: 'no-balance' };
    }
    var sim = simulateBalanceTimeline({
      nowMs: nowMs,
      startingBalance: startBal,
      entries: input.entries,
      checkingId: checkingId,
      chaseId: input.chaseId,
      transferPairs: input.transferPairs,
      recurringItems: input.recurringItems,
      chartDays: input.chartDays || 60,
      maxLookaheadDays: input.maxLookaheadDays || 365,
      cushion: input.cushion,
      dailySpend: input.dailySpend
    });
    if (!sim.ok) return sim;
    return {
      ok: true,
      startingBalance: startBal,
      points: sim.points,
      upcoming: sim.upcoming,
      lowest: sim.lowest,
      lastsUntil: sim.lastsUntil,
      neverRunsOut: sim.neverRunsOut,
      daysAway: sim.daysAway,
      dailySpend: sim.dailySpend
    };
  }

  return {
    MS_DAY: MS_DAY,
    startOfDay: startOfDay,
    addDays: addDays,
    dayKey: dayKey,
    normalizeTransferPattern: normalizeTransferPattern,
    patternMatches: patternMatches,
    isOtherAccountTransfer: isOtherAccountTransfer,
    isDepositEntry: isDepositEntry,
    entryCheckingDelta: entryCheckingDelta,
    projectedStartingBalance: projectedStartingBalance,
    detectRecurrences: detectRecurrences,
    estimateDailySpend: estimateDailySpend,
    estimateCardPayment: estimateCardPayment,
    buildScheduledEvents: buildScheduledEvents,
    simulateBalanceTimeline: simulateBalanceTimeline,
    runForecast: runForecast
  };
});
