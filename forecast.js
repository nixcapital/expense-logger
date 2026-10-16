/* Expense Logger — cash-flow forecast (pure logic, no DOM) */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExpenseForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MS_DAY = 86400000;
  var holidayCache = {};

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function validMs(ts) {
    return typeof ts === 'number' && isFinite(ts);
  }

  function startOfDay(ts) {
    if (!validMs(ts)) return NaN;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return NaN;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function forecastWarn(msg, detail) {
    try {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[ExpenseForecast] ' + msg, detail != null ? detail : '');
      }
    } catch (e) {}
  }

  /** Calendar-day step (local TZ). Avoids DST 24h-ms stalls. */
  function addDays(ts, n) {
    var sod = startOfDay(ts);
    if (!validMs(sod) || !isFinite(n)) return NaN;
    var d = new Date(sod);
    d.setDate(d.getDate() + n);
    return startOfDay(d.getTime());
  }

  function stepDays(ts, n, context) {
    var cur = startOfDay(ts);
    if (!validMs(cur)) {
      forecastWarn('stepDays invalid current', { context: context, ts: ts, n: n });
      return null;
    }
    var next = addDays(cur, n);
    if (!validMs(next)) {
      forecastWarn('stepDays invalid result', { context: context, ts: cur, n: n });
      return null;
    }
    if (n > 0 && next <= cur) {
      forecastWarn('stepDays not forward', { context: context, ts: cur, n: n, next: next });
      return null;
    }
    if (n < 0 && next >= cur) {
      forecastWarn('stepDays not backward', { context: context, ts: cur, n: n, next: next });
      return null;
    }
    return next;
  }

  function dayKey(ts) {
    if (!validMs(ts)) return 'invalid';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return 'invalid';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function dateMs(y, m, d) {
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return NaN;
    return startOfDay(new Date(y, m, d).getTime());
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
    if (!validMs(asOf)) asOf = startOfDay(nowMs);
    if (!validMs(asOf)) return null;
    var today = startOfDay(nowMs);
    if (!validMs(today)) today = asOf;
    var paired = pairedEntryIds(transferPairs);
    var net = 0;
    (entries || []).forEach(function (e) {
      if (!e || e.accountId !== checkingId) return;
      if (!validMs(e.ts)) return;
      var entryDay = startOfDay(e.ts);
      if (!validMs(entryDay) || entryDay <= asOf || entryDay > today) return;
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

  function mode(nums) {
    if (!nums.length) return nums[0];
    var counts = {};
    var best = nums[0];
    var bestN = 0;
    nums.forEach(function (n) {
      counts[n] = (counts[n] || 0) + 1;
      if (counts[n] > bestN) { bestN = counts[n]; best = n; }
    });
    return best;
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

  function amountTolerance(amt) {
    return Math.max(5, amt * 0.10);
  }

  function pickScheduleCluster(list) {
    if (!list || list.length < 2) return null;
    var sorted = list.slice().sort(function (a, b) { return a.ts - b.ts; });
    var recent = sorted.slice(-Math.min(3, sorted.length));
    var recentMed = median(recent.map(function (e) { return e.amount; }));
    var cluster = sorted.filter(function (e) {
      return Math.abs(e.amount - recentMed) <= amountTolerance(recentMed);
    });
    if (cluster.length < 2) {
      var bestCluster = [];
      sorted.forEach(function (seed) {
        var group = sorted.filter(function (e) {
          return Math.abs(e.amount - seed.amount) <= amountTolerance(seed.amount);
        });
        if (group.length > bestCluster.length) bestCluster = group;
      });
      cluster = bestCluster;
    }
    if (cluster.length < 2) return null;
    cluster.sort(function (a, b) { return a.ts - b.ts; });
    return {
      cluster: cluster,
      projectedAmount: cluster[cluster.length - 1].amount
    };
  }

  function scheduleStale(lastTs, nowMs, scheduleType) {
    if (!validMs(lastTs) || !validMs(nowMs)) return true;
    var gap = nowMs - startOfDay(lastTs);
    var maxGap;
    if (scheduleType === 'weekly') maxGap = 14 * MS_DAY;
    else if (scheduleType === 'biweekly') maxGap = 28 * MS_DAY;
    else if (scheduleType === 'semimonthly') maxGap = 35 * MS_DAY;
    else if (scheduleType === 'quarterly') maxGap = 200 * MS_DAY;
    else if (scheduleType === 'semiannual') maxGap = 400 * MS_DAY;
    else maxGap = 62 * MS_DAY;
    return gap > maxGap;
  }

  function addCalendarMonths(y, m, add) {
    var total = y * 12 + m + add;
    return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
  }

  function isUnpairedCheckingTransfer(entry, paired) {
    if (!entry || entry.isTransfer === false) return false;
    if (isDepositEntry(entry)) return false;
    if (isOtherAccountTransfer(entry)) return false;
    if (paired && paired[entry.id]) return false;
    return true;
  }

  function hasCheckingIncome(entries, checkingId, sinceMs, nowMs) {
    var found = false;
    (entries || []).forEach(function (e) {
      if (found) return;
      if (e.accountId !== checkingId) return;
      if (!isDepositEntry(e) || e.isTransfer) return;
      if (sinceMs != null && e.ts < sinceMs) return;
      if (nowMs != null && startOfDay(e.ts) > nowMs) return;
      found = true;
    });
    return found;
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function weekdayName(dow) {
    return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow] || '';
  }

  function observeFixedHoliday(year, month, day) {
    var ts = dateMs(year, month, day);
    var dow = new Date(ts).getDay();
    if (dow === 6) return addDays(ts, -1);
    if (dow === 0) return addDays(ts, 1);
    return ts;
  }

  function nthWeekdayOfMonth(year, month, weekday, n) {
    var count = 0;
    var dim = new Date(year, month + 1, 0).getDate();
    for (var d = 1; d <= dim; d++) {
      var ts = dateMs(year, month, d);
      if (new Date(ts).getDay() === weekday) {
        count++;
        if (count === n) return ts;
      }
    }
    return dateMs(year, month, 1);
  }

  function lastWeekdayOfMonth(year, month, weekday) {
    var dim = new Date(year, month + 1, 0).getDate();
    for (var d = dim; d >= 1; d--) {
      var ts = dateMs(year, month, d);
      if (new Date(ts).getDay() === weekday) return ts;
    }
    return dateMs(year, month, 1);
  }

  function bankHolidayKeysForYear(year) {
    if (holidayCache[year]) return holidayCache[year];
    var keys = {};
    function add(ts) { keys[dayKey(ts)] = true; }
    add(observeFixedHoliday(year, 0, 1));
    add(nthWeekdayOfMonth(year, 0, 1, 3));
    add(nthWeekdayOfMonth(year, 1, 1, 3));
    add(lastWeekdayOfMonth(year, 4, 1));
    add(observeFixedHoliday(year, 5, 19));
    add(observeFixedHoliday(year, 6, 4));
    add(nthWeekdayOfMonth(year, 8, 1, 1));
    add(nthWeekdayOfMonth(year, 9, 1, 2));
    add(observeFixedHoliday(year, 10, 11));
    add(nthWeekdayOfMonth(year, 10, 4, 4));
    add(observeFixedHoliday(year, 11, 25));
    holidayCache[year] = keys;
    return keys;
  }

  function isWeekend(ts) {
    if (!validMs(ts)) return false;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return false;
    var dow = d.getDay();
    return dow === 0 || dow === 6;
  }

  function isBankHoliday(ts) {
    if (!validMs(ts)) return false;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return false;
    var y = d.getFullYear();
    if (!isFinite(y)) return false;
    try {
      return !!bankHolidayKeysForYear(y)[dayKey(ts)];
    } catch (e) {
      return false;
    }
  }

  function isBusinessDay(ts) {
    return !isWeekend(ts) && !isBankHoliday(ts);
  }

  function nextBusinessDay(ts) {
    var c = addDays(ts, 1);
    if (!validMs(c)) return ts;
    var guard = 0;
    while (!isBusinessDay(c) && guard < 14) {
      var nxt = stepDays(c, 1, 'nextBusinessDay');
      if (nxt == null) break;
      c = nxt;
      guard++;
    }
    return c;
  }

  function prevBusinessDay(ts) {
    var c = addDays(ts, -1);
    if (!validMs(c)) return ts;
    var guard = 0;
    while (!isBusinessDay(c) && guard < 14) {
      var prv = stepDays(c, -1, 'prevBusinessDay');
      if (prv == null) break;
      c = prv;
      guard++;
    }
    return c;
  }

  function adjustToBusinessDay(nominalTs, shiftRule) {
    if (isBusinessDay(nominalTs)) return nominalTs;
    if (shiftRule === 'prev') return prevBusinessDay(nominalTs);
    return nextBusinessDay(nominalTs);
  }

  function shiftHint(shiftRule) {
    if (shiftRule === 'prev') return ' \u00B7 prior business day on weekends/holidays';
    if (shiftRule === 'next') return ' \u00B7 moves to next business day on weekends/holidays';
    return '';
  }

  function learnShiftRule(actualTsList, nominalForActual) {
    var nextVotes = 0;
    var prevVotes = 0;
    actualTsList.forEach(function (actual) {
      var d = new Date(actual);
      var nominal = nominalForActual(d.getFullYear(), d.getMonth(), actual);
      if (nominal == null) return;
      nominal = startOfDay(nominal);
      actual = startOfDay(actual);
      if (isBusinessDay(nominal)) return;
      var nxt = nextBusinessDay(nominal);
      var prv = prevBusinessDay(nominal);
      if (actual === nxt) nextVotes++;
      else if (actual === prv) prevVotes++;
    });
    if (nextVotes === 0 && prevVotes === 0) return 'next';
    if (prevVotes > nextVotes) return 'prev';
    return 'next';
  }

  function weekOfMonth(ts) {
    var d = new Date(ts);
    return Math.floor((d.getDate() - 1) / 7) + 1;
  }

  function fitSchedule(timestamps, isInflow) {
    if (!timestamps || timestamps.length < 2) return null;
    var ts = timestamps.map(startOfDay).sort(function (a, b) { return a - b; });
    if (ts.length === 2) {
      var gapOnly = Math.round((ts[1] - ts[0]) / MS_DAY);
      if (gapOnly >= 27 && gapOnly <= 35) {
        var domOnly = Math.round(median(ts.map(function (t) { return new Date(t).getDate(); })));
        var shiftOnly = learnShiftRule(ts, function (y, m) {
          var dim = new Date(y, m + 1, 0).getDate();
          return dateMs(y, m, Math.min(domOnly, dim));
        });
        return {
          scheduleType: 'monthly_dom',
          dayOfMonth: domOnly,
          shiftRule: shiftOnly || (isInflow ? 'prev' : 'next'),
          inferenceDetail: 'Usually around the ' + ordinal(domOnly) + ' (2 posts — lower confidence)' + shiftHint(shiftOnly || (isInflow ? 'prev' : 'next')),
          lastTs: ts[1],
          confidence: 'low'
        };
      }
      if (gapOnly >= 12 && gapOnly <= 18) {
        return {
          scheduleType: 'biweekly',
          anchorMs: ts[0],
          shiftRule: isInflow ? 'prev' : 'next',
          inferenceDetail: 'Every 2 weeks (2 posts — lower confidence)' + shiftHint(isInflow ? 'prev' : 'next'),
          lastTs: ts[1],
          confidence: 'low'
        };
      }
      return null;
    }
    var gaps = [];
    for (var i = 1; i < ts.length; i++) gaps.push(Math.round((ts[i] - ts[i - 1]) / MS_DAY));
    var medGap = median(gaps);

    var doms = ts.map(function (t) { return new Date(t).getDate(); });
    var domMode = mode(doms);

    var early = doms.filter(function (d) { return d <= 8; });
    var mid = doms.filter(function (d) { return d >= 12 && d <= 18; });
    if (ts.length >= 4 && early.length >= 2 && mid.length >= 2) {
      var d1 = Math.round(median(early));
      var d2 = Math.round(median(mid));
      var days = d1 < d2 ? [d1, d2] : [d2, d1];
      var shift = learnShiftRule(ts, function (y, m, actual) {
        var dim = new Date(y, m + 1, 0).getDate();
        var ad = new Date(actual).getDate();
        var pick = ad <= 10 ? days[0] : days[1];
        return dateMs(y, m, Math.min(pick, dim));
      });
      if (!shift) shift = isInflow ? 'prev' : 'next';
      return {
        scheduleType: 'semimonthly',
        daysOfMonth: days,
        shiftRule: shift,
        inferenceDetail: 'Usually on the ' + ordinal(days[0]) + ' and ' + ordinal(days[1]) + shiftHint(shift),
        lastTs: ts[ts.length - 1]
      };
    }

    if (medGap >= 12 && medGap <= 17 && gaps.every(function (g) { return g >= 11 && g <= 18; })) {
      var anchor = ts[0];
      var shiftB = isInflow ? 'prev' : 'next';
      return {
        scheduleType: 'biweekly',
        anchorMs: anchor,
        shiftRule: shiftB,
        inferenceDetail: 'Every 2 weeks from ' + new Date(anchor).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + shiftHint(shiftB),
        lastTs: ts[ts.length - 1]
      };
    }

    if (medGap >= 6 && medGap <= 8) {
      var dow = new Date(ts[0]).getDay();
      if (ts.every(function (t) { return new Date(t).getDay() === dow; })) {
        return {
          scheduleType: 'weekly',
          anchorMs: ts[0],
          weekday: dow,
          shiftRule: isInflow ? 'prev' : 'next',
          inferenceDetail: 'Every ' + weekdayName(dow) + shiftHint(isInflow ? 'prev' : 'next'),
          lastTs: ts[ts.length - 1]
        };
      }
    }

    if (medGap >= 27 && medGap <= 33 && doms.every(function (d) { return d === domMode; })) {
      var domFixed = domMode;
      var shiftFixed = learnShiftRule(ts, function (y, m) {
        var dim = new Date(y, m + 1, 0).getDate();
        return dateMs(y, m, Math.min(domFixed, dim));
      });
      return {
        scheduleType: 'monthly_dom',
        dayOfMonth: domFixed,
        shiftRule: shiftFixed,
        inferenceDetail: 'Usually on the ' + ordinal(domFixed) + shiftHint(shiftFixed),
        lastTs: ts[ts.length - 1]
      };
    }

    var dows = ts.map(function (t) { return new Date(t).getDay(); });
    var woms = ts.map(weekOfMonth);
    if (mode(dows) === dows[0] && mode(woms) === woms[0] && medGap >= 25 && medGap <= 35) {
      var n = mode(woms);
      var wd = mode(dows);
      var shiftN = learnShiftRule(ts, function (y, m) {
        return nthWeekdayOfMonth(y, m, wd, n);
      });
      return {
        scheduleType: 'monthly_nth_weekday',
        weekday: wd,
        nth: n,
        shiftRule: shiftN,
        inferenceDetail: ordinal(n) + ' ' + weekdayName(wd) + ' of the month' + shiftHint(shiftN),
        lastTs: ts[ts.length - 1]
      };
    }

    if (medGap >= 27 && medGap <= 33) {
      var dom = Math.round(median(doms));
      var shiftM = learnShiftRule(ts, function (y, m) {
        var dim = new Date(y, m + 1, 0).getDate();
        return dateMs(y, m, Math.min(dom, dim));
      });
      return {
        scheduleType: 'monthly_dom',
        dayOfMonth: dom,
        shiftRule: shiftM,
        inferenceDetail: 'Usually on the ' + ordinal(dom) + shiftHint(shiftM),
        lastTs: ts[ts.length - 1]
      };
    }

    if (medGap >= 80 && medGap <= 100) {
      var domQ = Math.round(median(doms));
      var shiftQ = learnShiftRule(ts, function (y, m) {
        var dim = new Date(y, m + 1, 0).getDate();
        return dateMs(y, m, Math.min(domQ, dim));
      });
      return {
        scheduleType: 'quarterly',
        dayOfMonth: domQ,
        anchorMs: ts[0],
        shiftRule: shiftQ,
        inferenceDetail: 'About every 3 months on the ' + ordinal(domQ) + shiftHint(shiftQ),
        lastTs: ts[ts.length - 1]
      };
    }

    if (medGap >= 170 && medGap <= 200) {
      var domS = Math.round(median(doms));
      var shiftS = learnShiftRule(ts, function (y, m) {
        var dim = new Date(y, m + 1, 0).getDate();
        return dateMs(y, m, Math.min(domS, dim));
      });
      return {
        scheduleType: 'semiannual',
        dayOfMonth: domS,
        anchorMs: ts[0],
        shiftRule: shiftS,
        inferenceDetail: 'About every 6 months on the ' + ordinal(domS) + shiftHint(shiftS),
        lastTs: ts[ts.length - 1]
      };
    }

    return null;
  }

  function detectRecurringSchedules(entries, opts) {
    opts = opts || {};
    var checkingId = opts.checkingId;
    var sinceMs = opts.sinceMs || 0;
    var kind = opts.kind || 'any';
    var nowMs = opts.nowMs != null ? startOfDay(opts.nowMs) : null;
    var paired = pairedEntryIds(opts.transferPairs);
    var groups = {};
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (e.ts < sinceMs) return;
      if (nowMs != null && startOfDay(e.ts) > nowMs) return;
      if (kind === 'transfer-other') {
        if (!isOtherAccountTransfer(e)) return;
      } else if (isOtherAccountTransfer(e)) return;
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
      if (list.length < 2) return;
      var picked = pickScheduleCluster(list);
      if (!picked) return;
      var cluster = picked.cluster;
      var sample = cluster[cluster.length - 1];
      var projAmt = picked.projectedAmount;
      var isIn = isDepositEntry(sample);
      if (kind === 'inflow' && !isIn) return;
      if (kind === 'outflow' && isIn) return;
      if (kind === 'transfer-other' && !isOtherAccountTransfer(sample)) return;
      if (kind === 'outflow' && projAmt < 25) return;
      if (kind === 'transfer-other' && projAmt < 25) return;

      var fit = fitSchedule(cluster.map(function (e) { return e.ts; }), isIn);
      if (!fit) return;
      if (nowMs != null && scheduleStale(fit.lastTs, nowMs, fit.scheduleType)) return;

      out.push({
        itemKey: key,
        label: (sample.note || key).slice(0, 48),
        amount: Math.round(projAmt * 100) / 100,
        kind: isOtherAccountTransfer(sample) ? 'transfer-other' : (isIn ? 'inflow' : 'outflow'),
        inflow: !!isIn,
        categoryId: sample.categoryId,
        scheduleType: fit.scheduleType,
        dayOfMonth: fit.dayOfMonth,
        daysOfMonth: fit.daysOfMonth,
        anchorMs: fit.anchorMs,
        weekday: fit.weekday,
        nth: fit.nth,
        shiftRule: fit.shiftRule,
        inferenceDetail: fit.inferenceDetail,
        lastTs: fit.lastTs,
        confidence: fit.confidence || 'high',
        merchantKey: key
      });
    });
    return out;
  }

  function detectUnpairedTransferSchedules(entries, opts) {
    opts = opts || {};
    var checkingId = opts.checkingId;
    var sinceMs = opts.sinceMs || 0;
    var nowMs = opts.nowMs != null ? startOfDay(opts.nowMs) : null;
    var paired = pairedEntryIds(opts.transferPairs);
    var groups = {};
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (e.ts < sinceMs) return;
      if (nowMs != null && startOfDay(e.ts) > nowMs) return;
      if (!isUnpairedCheckingTransfer(e, paired)) return;
      var key = descriptionKey(e.note || '');
      if (!key) return;
      if (!groups[key]) groups[key] = [];
      groups[key].push(e);
    });

    var out = [];
    Object.keys(groups).forEach(function (key) {
      var list = groups[key].sort(function (a, b) { return a.ts - b.ts; });
      if (list.length < 2) return;
      var picked = pickScheduleCluster(list);
      if (!picked) return;
      var cluster = picked.cluster;
      var sample = cluster[cluster.length - 1];
      var projAmt = picked.projectedAmount;
      if (projAmt < 25) return;
      var fit = fitSchedule(cluster.map(function (e) { return e.ts; }), false);
      if (!fit) return;
      if (nowMs != null && scheduleStale(fit.lastTs, nowMs, fit.scheduleType)) return;
      out.push({
        itemKey: key,
        label: (sample.note || key).slice(0, 48),
        amount: Math.round(projAmt * 100) / 100,
        kind: 'outflow',
        inflow: false,
        categoryId: sample.categoryId,
        scheduleType: fit.scheduleType,
        dayOfMonth: fit.dayOfMonth,
        daysOfMonth: fit.daysOfMonth,
        anchorMs: fit.anchorMs,
        weekday: fit.weekday,
        nth: fit.nth,
        shiftRule: fit.shiftRule,
        inferenceDetail: (fit.inferenceDetail || 'Recurring payment') + ' (to another account)',
        lastTs: fit.lastTs,
        confidence: fit.confidence || 'high',
        merchantKey: key
      });
    });
    return out;
  }

  function detectRecurrences(entries, opts) {
    return detectRecurringSchedules(entries, opts).map(function (s) {
      var interval = s.scheduleType === 'weekly' ? 'weekly'
        : s.scheduleType === 'biweekly' ? 'biweekly'
        : s.scheduleType === 'semimonthly' ? 'semimonthly'
        : 'monthly';
      return {
        key: s.itemKey,
        label: s.label,
        amount: s.amount,
        interval: interval,
        lastTs: s.lastTs,
        isInflow: s.inflow,
        isOtherTransfer: s.kind === 'transfer-other',
        categoryId: s.categoryId,
        sampleNote: s.label,
        schedule: s
      };
    });
  }

  function generateNominalDates(schedule, afterMs, untilMs) {
    var out = [];
    var guard = 0;
    if (schedule.scheduleType === 'biweekly') {
      var cursor = startOfDay(schedule.anchorMs || schedule.lastTs);
      while (validMs(cursor) && cursor <= afterMs && guard < 200) {
        var advB = stepDays(cursor, 14, 'biweekly-catchup');
        if (advB == null) break;
        cursor = advB;
        guard++;
      }
      while (validMs(cursor) && cursor <= untilMs && guard < 200) {
        out.push(cursor);
        var advB2 = stepDays(cursor, 14, 'biweekly-expand');
        if (advB2 == null) break;
        cursor = advB2;
        guard++;
      }
      return out;
    }
    if (schedule.scheduleType === 'weekly') {
      var c2 = startOfDay(schedule.anchorMs || schedule.lastTs);
      while (validMs(c2) && c2 <= afterMs && guard < 200) {
        var advW = stepDays(c2, 7, 'weekly-catchup');
        if (advW == null) break;
        c2 = advW;
        guard++;
      }
      while (validMs(c2) && c2 <= untilMs && guard < 200) {
        out.push(c2);
        var advW2 = stepDays(c2, 7, 'weekly-expand');
        if (advW2 == null) break;
        c2 = advW2;
        guard++;
      }
      return out;
    }
    if (schedule.scheduleType === 'quarterly' || schedule.scheduleType === 'semiannual') {
      return generateQuarterlySemiannualDates(schedule, afterMs, untilMs);
    }

    var start = new Date(afterMs);
    var y = start.getFullYear();
    var m = start.getMonth();
    for (var mi = 0; mi < 18 && guard < 200; mi++) {
      var ym = y + Math.floor((m + mi) / 12);
      var mo = (m + mi) % 12;
      var dim = new Date(ym, mo + 1, 0).getDate();
      var nominals = [];
      if (schedule.scheduleType === 'semimonthly' && schedule.daysOfMonth) {
        schedule.daysOfMonth.forEach(function (dom) {
          nominals.push(dateMs(ym, mo, Math.min(dom, dim)));
        });
      } else if (schedule.scheduleType === 'monthly_nth_weekday') {
        nominals.push(nthWeekdayOfMonth(ym, mo, schedule.weekday, schedule.nth));
      } else if (schedule.scheduleType === 'monthly_dom') {
        nominals.push(dateMs(ym, mo, Math.min(schedule.dayOfMonth || 1, dim)));
      }
      nominals.forEach(function (nom) {
        if (nom > afterMs && nom <= untilMs) out.push(nom);
      });
      guard++;
    }
    return out;
  }

  function generateQuarterlySemiannualDates(schedule, afterMs, untilMs) {
    var out = [];
    var stepMo = schedule.scheduleType === 'semiannual' ? 6 : 3;
    var anchor = startOfDay(schedule.anchorMs || schedule.lastTs);
    if (!validMs(anchor)) return out;
    var dom = schedule.dayOfMonth || new Date(anchor).getDate();
    var cur = { y: new Date(anchor).getFullYear(), m: new Date(anchor).getMonth() };
    var guard = 0;
    while (guard < 80) {
      var dim = new Date(cur.y, cur.m + 1, 0).getDate();
      var nom = dateMs(cur.y, cur.m, Math.min(dom, dim));
      if (validMs(nom) && nom > afterMs && nom <= untilMs) out.push(nom);
      if (validMs(nom) && nom > untilMs) break;
      cur = addCalendarMonths(cur.y, cur.m, stepMo);
      guard++;
    }
    return out;
  }

  function expandSchedule(schedule, afterMs, untilMs) {
    var nominals = generateNominalDates(schedule, afterMs, untilMs);
    var events = [];
    nominals.forEach(function (nom) {
      var ts = adjustToBusinessDay(nom, schedule.shiftRule || 'next');
      if (ts <= afterMs || ts > untilMs) return;
      events.push({
        ts: ts,
        amount: schedule.amount,
        kind: schedule.kind,
        inflow: !!schedule.inflow,
        label: schedule.label,
        categoryId: schedule.categoryId,
        itemKey: schedule.itemKey,
        recurringKey: schedule.itemKey
      });
    });
    return events;
  }

  function applyForecastOverrides(events, overrides, afterMs) {
    if (!overrides) return events;
    var out = events.slice();
    Object.keys(overrides).forEach(function (key) {
      var o = overrides[key];
      if (!o) return;
      var idx = -1;
      if (typeof o.applyFromTs === 'number') {
        var fromTs = startOfDay(o.applyFromTs);
        for (var j = 0; j < out.length; j++) {
          if (out[j].itemKey === key && startOfDay(out[j].ts) === fromTs) { idx = j; break; }
        }
      }
      if (idx < 0) {
        for (var i = 0; i < out.length; i++) {
          if (out[i].itemKey === key && out[i].ts > afterMs) { idx = i; break; }
        }
      }
      if (idx >= 0) {
        if (typeof o.amount === 'number') out[idx].amount = o.amount;
        if (typeof o.nextTs === 'number') out[idx].ts = startOfDay(o.nextTs);
      } else if (typeof o.nextTs === 'number' && o.nextTs > afterMs) {
        out.push({
          ts: startOfDay(o.nextTs),
          amount: typeof o.amount === 'number' ? o.amount : 0,
          kind: o.kind || 'outflow',
          inflow: o.kind === 'inflow',
          label: o.label || key,
          categoryId: o.categoryId || null,
          itemKey: key,
          recurringKey: key
        });
      }
    });
    return out.sort(function (a, b) { return a.ts - b.ts; });
  }

  function estimateDailySpend(entries, checkingId, transferPairs, nowMs, schedules) {
    var windowDays = 75;
    var since = addDays(nowMs, -windowDays);
    var paired = pairedEntryIds(transferPairs);
    var recurringKeys = {};
    (schedules || []).forEach(function (s) {
      if (s.merchantKey) recurringKeys[s.merchantKey] = true;
      recurringKeys[s.itemKey] = true;
    });
    var eligible = [];
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (e.ts < since || e.ts > nowMs) return;
      if (isDepositEntry(e) || isOtherAccountTransfer(e)) return;
      if (e.isTransfer) return;
      var mk = descriptionKey(e.note || '');
      if (recurringKeys[mk]) return;
      eligible.push(e);
    });
    if (eligible.length < 7) return 0;
    var rowMed = median(eligible.map(function (e) { return e.amount; }));
    var total = 0;
    eligible.forEach(function (e) {
      var thresh = Math.max(300, rowMed * 5);
      if (e.amount > thresh) {
        var repeats = 0;
        for (var i = 0; i < eligible.length; i++) {
          if (eligible[i] === e) continue;
          if (Math.abs(eligible[i].amount - e.amount) <= Math.max(5, e.amount * 0.05)) repeats++;
        }
        if (repeats === 0) return;
      }
      total += e.amount;
    });
    return Math.round((total / windowDays) * 100) / 100;
  }

  function detectCardPaymentSchedule(entries, transferPairs, checkingId) {
    var paired = pairedEntryIds(transferPairs);
    var debits = [];
    (entries || []).forEach(function (e) {
      if (e.accountId !== checkingId) return;
      if (!e.isTransfer || !paired[e.id]) return;
      debits.push({ ts: e.ts, amount: e.amount });
    });
    debits.sort(function (a, b) { return a.ts - b.ts; });
    if (debits.length < 1) return null;
    var doms = debits.map(function (d) { return new Date(d.ts).getDate(); });
    var dom = mode(doms);
    var amounts = debits.map(function (d) { return d.amount; });
    var shift = debits.length >= 2
      ? learnShiftRule(debits.map(function (d) { return d.ts; }), function (y, m) {
        var dim = new Date(y, m + 1, 0).getDate();
        return dateMs(y, m, Math.min(dom, dim));
      })
      : 'next';
    var confNote = debits.length < 2 ? ' (1 post — lower confidence)' : '';
    var recentAmt = debits[debits.length - 1].amount;
    return {
      itemKey: 'card-payment|chase',
      label: 'Chase card payment',
      amount: Math.round(recentAmt * 100) / 100,
      kind: 'card-payment',
      inflow: false,
      categoryId: null,
      scheduleType: 'monthly_dom',
      dayOfMonth: dom,
      shiftRule: shift,
      inferenceDetail: 'Usually on the ' + ordinal(dom) + ' (from checking autopay)' + confNote + shiftHint(shift),
      lastTs: debits[debits.length - 1].ts,
      confidence: debits.length >= 2 ? 'high' : 'low'
    };
  }

  function estimateCardPayment(entries, transferPairs, checkingId, chaseId, nowMs) {
    var sched = detectCardPaymentSchedule(entries, transferPairs, checkingId);
    if (sched) {
      return {
        amount: sched.amount,
        dayOfMonth: sched.dayOfMonth,
        shiftRule: sched.shiftRule,
        lastTs: sched.lastTs,
        source: 'paired',
        schedule: sched
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
      dayOfMonth: 28,
      shiftRule: 'next',
      lastTs: nowMs,
      source: 'card-spend'
    };
  }

  function buildScheduledEvents(input) {
    var nowMs = startOfDay(input.nowMs || Date.now());
    var untilMs = addDays(nowMs, input.maxLookaheadDays || 365);
    var checkingId = input.checkingId;
    var schedules = [];
    var events = [];

    ['inflow', 'outflow', 'transfer-other'].forEach(function (kind) {
      detectRecurringSchedules(input.entries, {
        checkingId: checkingId,
        sinceMs: addDays(nowMs, -400),
        nowMs: nowMs,
        kind: kind,
        transferPairs: input.transferPairs
      }).forEach(function (s) {
        schedules.push(s);
        events = events.concat(expandSchedule(s, nowMs, untilMs));
      });
    });

    detectUnpairedTransferSchedules(input.entries, {
      checkingId: checkingId,
      sinceMs: addDays(nowMs, -400),
      nowMs: nowMs,
      transferPairs: input.transferPairs
    }).forEach(function (s) {
      var dup = schedules.some(function (x) { return x.itemKey === s.itemKey; });
      if (dup) return;
      schedules.push(s);
      events = events.concat(expandSchedule(s, nowMs, untilMs));
    });

    var cardSched = detectCardPaymentSchedule(input.entries, input.transferPairs, checkingId);
    if (cardSched) {
      schedules.push(cardSched);
      events = events.concat(expandSchedule(cardSched, nowMs, untilMs));
    } else {
      var cardEst = estimateCardPayment(input.entries, input.transferPairs, checkingId, input.chaseId, nowMs);
      if (cardEst && cardEst.amount > 0) {
        var fallback = {
          itemKey: 'card-payment|chase',
          label: 'Chase card payment',
          amount: cardEst.amount,
          kind: 'card-payment',
          scheduleType: 'monthly_dom',
          dayOfMonth: cardEst.dayOfMonth || 28,
          shiftRule: cardEst.shiftRule || 'next',
          inferenceDetail: 'Estimated from recent card spend',
          lastTs: cardEst.lastTs
        };
        schedules.push(fallback);
        events = events.concat(expandSchedule(fallback, nowMs, untilMs));
      }
    }

    (input.recurringItems || []).forEach(function (item) {
      if (!item || !item.amount) return;
      var acct = item.accountId || checkingId;
      if (acct !== checkingId) return;
      var dom = item.dayOfMonth || 1;
      var s = {
        itemKey: 'recurring-' + item.id,
        label: item.note || 'Recurring',
        amount: item.amount,
        kind: 'outflow',
        scheduleType: 'monthly_dom',
        dayOfMonth: dom,
        shiftRule: 'next',
        inferenceDetail: 'Recurring expense on day ' + dom,
        lastTs: nowMs
      };
      schedules.push(s);
      events = events.concat(expandSchedule(s, nowMs, untilMs));
    });

    events = applyForecastOverrides(events, input.overrides, nowMs);

    var daily = input.dailySpend != null ? input.dailySpend
      : estimateDailySpend(input.entries, checkingId, input.transferPairs, nowMs, schedules);
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
          daily: true,
          itemKey: 'daily-spend'
        });
      }
    }
    return { events: events, dailySpend: daily, schedules: schedules };
  }

  function simulateBalanceTimeline(input) {
    var nowMs = startOfDay(input.nowMs || Date.now());
    if (!validMs(nowMs)) nowMs = startOfDay(Date.now());
    if (!validMs(nowMs)) return { ok: false, reason: 'bad-date' };
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
    var partialTimeline = false;
    var histCap = Math.max(1, historyDays) + 10;
    var histGuard = 0;
    while (dayCursor >= histStart && histGuard < histCap) {
      histPoints.unshift({ ts: dayCursor, balance: running, actual: true });
      if (dayCursor === histStart) break;
      var prevDay = stepDays(dayCursor, -1, 'history-back');
      if (prevDay == null) {
        partialTimeline = true;
        break;
      }
      var dayDelta = 0;
      (input.entries || []).forEach(function (e) {
        if (e.accountId !== input.checkingId) return;
        if (startOfDay(e.ts) !== dayCursor) return;
        dayDelta += entryCheckingDelta(e, input.checkingId, paired);
      });
      running = Math.round((running - dayDelta) * 100) / 100;
      dayCursor = prevDay;
      histGuard++;
    }
    if (dayCursor > histStart && histGuard >= histCap) {
      forecastWarn('history iteration cap', { histGuard: histGuard, histStart: histStart });
      partialTimeline = true;
    }

    var futurePoints = [{ ts: nowMs, balance: bal, today: true }];
    var upcoming = [];
    var lowest = { balance: bal, ts: nowMs };
    var lowestInWindow = { balance: bal, ts: nowMs };
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

    var dayEventOrder = { inflow: 0, 'transfer-other': 1, 'card-payment': 2, outflow: 3, daily: 4 };
    var lastSolventDay = bal >= 0 ? nowMs : null;
    var simDay = addDays(nowMs, 1);
    var maxLook = input.maxLookaheadDays || 365;
    var simCap = maxLook + 10;
    var simGuard = 0;
    while (validMs(simDay) && simDay <= lookaheadEnd && simGuard < simCap) {
      var list = (byDay[dayKey(simDay)] || []).slice().sort(function (a, b) {
        return (dayEventOrder[a.kind] || 9) - (dayEventOrder[b.kind] || 9);
      });
      var dayUpcoming = [];
      list.forEach(function (ev) {
        var delta;
        if (ev.kind === 'inflow') delta = ev.amount;
        else if (ev.kind === 'transfer-other') delta = ev.inflow ? ev.amount : -ev.amount;
        else delta = -ev.amount;
        bal = Math.round((bal + delta) * 100) / 100;
        dayUpcoming.push({
          ts: ev.ts,
          kind: ev.kind,
          label: ev.label,
          amount: ev.amount,
          delta: delta,
          balanceAfter: bal,
          categoryId: ev.categoryId,
          daily: !!ev.daily,
          itemKey: ev.itemKey
        });
      });
      var eodBal = bal;
      dayUpcoming.forEach(function (u) { u.balanceAfter = eodBal; });
      upcoming = upcoming.concat(dayUpcoming);
      if (eodBal >= 0) lastSolventDay = simDay;
      else if (lastsUntil == null && lastSolventDay != null) lastsUntil = lastSolventDay;
      if (eodBal < lowest.balance) lowest = { balance: eodBal, ts: simDay };
      if (simDay <= chartEnd && eodBal < lowestInWindow.balance) lowestInWindow = { balance: eodBal, ts: simDay };
      if (simDay <= chartEnd) futurePoints.push({ ts: simDay, balance: eodBal });
      var nextSimDay = stepDays(simDay, 1, 'simulate-forward');
      if (nextSimDay == null) {
        partialTimeline = true;
        break;
      }
      simDay = nextSimDay;
      simGuard++;
    }
    if (validMs(simDay) && simDay <= lookaheadEnd && simGuard >= simCap) {
      forecastWarn('simulate forward iteration cap', { simGuard: simGuard, maxLook: maxLook });
      partialTimeline = true;
    }
    histPoints.forEach(function (p) {
      if (p.ts > chartEnd) return;
      if (p.balance < lowestInWindow.balance) lowestInWindow = { balance: p.balance, ts: p.ts };
    });

    var neverRunsOut = lastsUntil == null;
    var daysAway = lastsUntil != null ? Math.round((lastsUntil - nowMs) / MS_DAY) : null;

    var peekPastWindow = null;
    events.forEach(function (ev) {
      if (ev.daily || ev.kind === 'inflow') return;
      if (ev.ts <= chartEnd || ev.ts > lookaheadEnd) return;
      if (ev.amount < 500) return;
      if (!peekPastWindow || ev.ts < peekPastWindow.ts) {
        peekPastWindow = {
          ts: ev.ts,
          amount: ev.amount,
          label: ev.label,
          kind: ev.kind,
          itemKey: ev.itemKey,
          categoryId: ev.categoryId
        };
      }
    });

    return {
      ok: true,
      startingBalance: startBal,
      points: histPoints.concat(futurePoints),
      upcoming: upcoming.filter(function (u) { return u.ts <= chartEnd && !u.daily; }),
      lowest: lowest,
      lowestInWindow: lowestInWindow,
      lastsUntil: neverRunsOut ? null : lastsUntil,
      neverRunsOut: neverRunsOut,
      daysAway: daysAway,
      dailySpend: scheduled.dailySpend,
      cushion: cushion,
      schedules: scheduled.schedules,
      partialTimeline: partialTimeline,
      peekPastWindow: peekPastWindow,
      chartDays: horizon
    };
  }

  var CHART_Y_LABEL_MIN_GAP_PX = 18;
  var CHART_Y_CUSHION_TICK_GAP_PX = 14;
  var CHART_Y_MAX_TICKS = 5;

  function pickNiceStep(rough) {
    if (!isFinite(rough) || rough <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var f = rough / mag;
    var nf;
    if (f <= 1) nf = 1;
    else if (f <= 2) nf = 2;
    else if (f <= 2.5) nf = 2.5;
    else if (f <= 5) nf = 5;
    else nf = 10;
    return nf * mag;
  }

  function niceStepUp(step) {
    var mag = Math.pow(10, Math.floor(Math.log10(step)));
    var n = step / mag;
    if (n < 2) return 2 * mag;
    if (n < 2.5) return 2.5 * mag;
    if (n < 5) return 5 * mag;
    if (n < 10) return 10 * mag;
    return step * 2;
  }

  function axisTickCount(minBal, maxBal, step) {
    if (step <= 0) return 1;
    return Math.round((maxBal - minBal) / step) + 1;
  }

  function forecastChartAxisStep(span) {
    return pickNiceStep(span / Math.max(1, CHART_Y_MAX_TICKS - 1));
  }

  function forecastChartNiceStep(range, maxLabels) {
    maxLabels = maxLabels || CHART_Y_MAX_TICKS;
    return pickNiceStep(range / Math.max(1, maxLabels - 1));
  }

  function computeForecastChartYScale(dataMin, dataMax, opts) {
    opts = opts || {};
    var cushion = opts.cushion != null ? opts.cushion : 600;
    var span = Math.max(80, dataMax - dataMin);
    var cushionNear = cushion >= dataMin - span * 0.25 && cushion <= dataMax + span * 0.2;
    var dMin = dataMin;
    var dMax = dataMax;
    if (cushionNear) {
      dMin = Math.min(dMin, cushion);
      dMax = Math.max(dMax, cushion);
    }
    var pad = Math.max(80, dMax - dMin) * 0.08;
    var step = forecastChartNiceStep(dMax - dMin + pad * 2, CHART_Y_MAX_TICKS);
    var minBal = Math.floor((dMin - pad) / step) * step;
    var maxBal = Math.ceil((dMax + pad) / step) * step;
    if (maxBal - minBal < step * 2) maxBal = minBal + step * 2;
    var crossesZero = dataMin < 0 && dataMax > 0;
    if (!crossesZero && dataMin >= 0 && minBal < 0) minBal = 0;
    if (crossesZero) {
      minBal = Math.min(minBal, 0);
      maxBal = Math.max(maxBal, 0);
    }
    while (axisTickCount(minBal, maxBal, step) > CHART_Y_MAX_TICKS) {
      step = niceStepUp(step);
    }
    return {
      minBal: minBal,
      maxBal: maxBal,
      step: step,
      cushionNear: cushionNear,
      crossesZero: crossesZero
    };
  }

  function buildAxisTickValues(minBal, maxBal, step, crossesZero) {
    var ticks = [];
    var guard = 0;
    for (var t = minBal; t <= maxBal + step * 0.001 && guard < 32; t += step) {
      ticks.push(Math.round(t * 100) / 100);
      guard++;
    }
    if (crossesZero && ticks.indexOf(0) === -1) {
      ticks.push(0);
      ticks.sort(function (a, b) { return a - b; });
      if (ticks.length > CHART_Y_MAX_TICKS) {
        var bestIdx = 1;
        var bestDist = Infinity;
        for (var i = 0; i < ticks.length; i++) {
          if (ticks[i] === 0) continue;
          var d = Math.abs(ticks[i]);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        ticks.splice(bestIdx, 1);
      }
    }
    while (ticks.length > CHART_Y_MAX_TICKS) {
      var drop = 0;
      var dropScore = -1;
      for (var j = 0; j < ticks.length; j++) {
        if (ticks[j] === 0 && crossesZero) continue;
        var score = Math.min(Math.abs(ticks[j] - minBal), Math.abs(ticks[j] - maxBal));
        if (score > dropScore) { dropScore = score; drop = j; }
      }
      ticks.splice(drop, 1);
    }
    return ticks;
  }

  function forecastChartYAt(bal, minBal, maxBal, padT, innerH) {
    return padT + innerH - ((bal - minBal) / (maxBal - minBal || 1)) * innerH;
  }

  function planForecastChartYAxisLabels(opts) {
    opts = opts || {};
    var minBal = opts.minBal;
    var maxBal = opts.maxBal;
    var step = opts.step;
    var cushion = opts.cushion;
    var cushionNear = !!opts.cushionNear;
    var crossesZero = !!opts.crossesZero;
    var padT = opts.padT != null ? opts.padT : 12;
    var innerH = opts.innerH != null ? opts.innerH : 162;
    var baselineNudge = opts.baselineNudge != null ? opts.baselineNudge : 4;

    function yAt(bal) {
      return forecastChartYAt(bal, minBal, maxBal, padT, innerH) + baselineNudge;
    }

    var tickVals = buildAxisTickValues(minBal, maxBal, step, crossesZero);
    var cushionLabelY = cushionNear ? yAt(cushion) : padT + 10;
    var zeroY = crossesZero ? yAt(0) : null;
    var cushionOnAxis = cushionNear;
    if (cushionNear && crossesZero && zeroY != null
      && Math.abs(cushionLabelY - zeroY) < CHART_Y_LABEL_MIN_GAP_PX) {
      cushionOnAxis = false;
    }
    var labels = [];
    var hidden = [];

    tickVals.forEach(function (bal) {
      if (cushionOnAxis && bal === cushion) return;
      var y = yAt(bal);
      if (cushionOnAxis && Math.abs(y - cushionLabelY) < CHART_Y_CUSHION_TICK_GAP_PX) {
        hidden.push({ bal: bal, reason: 'near-cushion-y' });
        return;
      }
      labels.push({ bal: bal, isCushion: false, y: y });
    });

    if (crossesZero && !labels.some(function (l) { return l.bal === 0; })) {
      labels.push({ bal: 0, isCushion: false, y: zeroY });
    }

    if (cushionOnAxis) {
      labels.push({ bal: cushion, isCushion: true, y: cushionLabelY });
    }

    labels.sort(function (a, b) { return a.y - b.y; });
    var priority = labels.filter(function (lb) {
      return lb.isCushion || (crossesZero && lb.bal === 0);
    });
    var rest = labels.filter(function (lb) {
      return !lb.isCushion && !(crossesZero && lb.bal === 0);
    });
    var filtered = priority.slice();
    rest.forEach(function (lb) {
      var clash = filtered.some(function (f) {
        return Math.abs(f.y - lb.y) < CHART_Y_LABEL_MIN_GAP_PX;
      });
      if (!clash) filtered.push(lb);
      else hidden.push({ bal: lb.bal, reason: 'label-spacing' });
    });
    labels = filtered.sort(function (a, b) { return a.y - b.y; });

    return {
      labels: labels,
      hidden: hidden,
      cushionLabelY: cushionLabelY,
      cushionNear: cushionNear,
      showCushionNote: !cushionNear || !cushionOnAxis,
      minGapPx: CHART_Y_LABEL_MIN_GAP_PX,
      cushionGapPx: CHART_Y_CUSHION_TICK_GAP_PX,
      tickValues: tickVals,
      step: step,
      cushionOnAxis: cushionOnAxis
    };
  }

  function yAxisLabelsCollide(plan) {
    if (!plan || !plan.labels) return false;
    var ys = plan.labels.map(function (lb) { return lb.y; });
    for (var i = 0; i < ys.length; i++) {
      for (var j = i + 1; j < ys.length; j++) {
        if (Math.abs(ys[i] - ys[j]) < plan.minGapPx) return true;
      }
    }
    return false;
  }

  function runForecastCore(input) {
    input = input || {};
    var nowMs = startOfDay(input.nowMs || Date.now());
    if (!validMs(nowMs)) nowMs = startOfDay(Date.now());
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
      dailySpend: input.dailySpend,
      overrides: input.overrides
    });
    if (!sim.ok) return sim;
    var incomeSince = addDays(nowMs, -400);
    var noIncomeDetected = !hasCheckingIncome(input.entries, checkingId, incomeSince, nowMs);
    return {
      ok: true,
      startingBalance: startBal,
      points: sim.points,
      upcoming: sim.upcoming,
      lowest: sim.lowest,
      lastsUntil: sim.lastsUntil,
      neverRunsOut: sim.neverRunsOut,
      daysAway: sim.daysAway,
      dailySpend: sim.dailySpend,
      schedules: sim.schedules,
      noIncomeDetected: noIncomeDetected,
      peekPastWindow: sim.peekPastWindow
    };
  }

  function runForecast(input) {
    try {
      return runForecastCore(input);
    } catch (err) {
      return { ok: false, reason: 'forecast-error' };
    }
  }

  return {
    MS_DAY: MS_DAY,
    startOfDay: startOfDay,
    addDays: addDays,
    dayKey: dayKey,
    dateMs: dateMs,
    normalizeTransferPattern: normalizeTransferPattern,
    patternMatches: patternMatches,
    isOtherAccountTransfer: isOtherAccountTransfer,
    isDepositEntry: isDepositEntry,
    entryCheckingDelta: entryCheckingDelta,
    projectedStartingBalance: projectedStartingBalance,
    detectRecurrences: detectRecurrences,
    detectRecurringSchedules: detectRecurringSchedules,
    detectCardPaymentSchedule: detectCardPaymentSchedule,
    detectUnpairedTransferSchedules: detectUnpairedTransferSchedules,
    isBusinessDay: isBusinessDay,
    isBankHoliday: isBankHoliday,
    adjustToBusinessDay: adjustToBusinessDay,
    learnShiftRule: learnShiftRule,
    fitSchedule: fitSchedule,
    expandSchedule: expandSchedule,
    applyForecastOverrides: applyForecastOverrides,
    estimateDailySpend: estimateDailySpend,
    estimateCardPayment: estimateCardPayment,
    buildScheduledEvents: buildScheduledEvents,
    simulateBalanceTimeline: simulateBalanceTimeline,
    runForecast: runForecast,
    bankHolidayKeysForYear: bankHolidayKeysForYear,
    forecastChartAxisStep: forecastChartAxisStep,
    forecastChartNiceStep: forecastChartNiceStep,
    computeForecastChartYScale: computeForecastChartYScale,
    forecastChartYAt: forecastChartYAt,
    planForecastChartYAxisLabels: planForecastChartYAxisLabels,
    yAxisLabelsCollide: yAxisLabelsCollide,
    CHART_Y_LABEL_MIN_GAP_PX: CHART_Y_LABEL_MIN_GAP_PX,
    CHART_Y_CUSHION_TICK_GAP_PX: CHART_Y_CUSHION_TICK_GAP_PX
  };
});
