/* Expense Logger — Spending Wrapped stats (pure functions). */
(function (global) {
  'use strict';

  var MS_DAY = 86400000;
  var COFFEE_KEYWORDS = /coffee|starbucks|espresso|latte|cappuccino|dunkin|peet|blue\s*bottle/i;
  var PROCESSOR_PREFIX = /^(SQ\s*\*|TST\*|PP\*|PAYPAL\s*\*|VENMO\s*\*)\s*/i;

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function isSameMonth(ts, y, m) {
    var d = new Date(ts);
    return d.getFullYear() === y && d.getMonth() === m;
  }

  function startOfDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function shiftMonth(y, m, delta) {
    var idx = y * 12 + m + delta;
    var ny = Math.floor(idx / 12);
    var nm = idx - ny * 12;
    if (nm < 0) { nm += 12; ny -= 1; }
    return { y: ny, m: nm };
  }

  function monthShort(y, m) {
    return new Date(y, m, 1).toLocaleDateString(undefined, { month: 'short' });
  }

  function entryCountsAsSpending(e) {
    if (!e || typeof e.amount !== 'number') return false;
    if (e.isTransfer) return false;
    if (e.excluded) return false;
    if (e.countAsSpending === false) return false;
    return true;
  }

  function cleanImportNote(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    s = s.replace(/\s+\d{8,}\s*$/g, '').trim();
    s = s.replace(/\s+WEB\s+\d+\s*$/i, '').trim();
    return s.slice(0, 120);
  }

  function normText(s) {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Tri-approved merchant normalization for Wrapped regulars / recurring. */
  function normalizeMerchantName(note) {
    var s = cleanImportNote(note);
    if (!s) return '';
    var parts = s.split(/\s*[·•]\s*/);
    s = parts[0].trim();
    s = s.replace(PROCESSOR_PREFIX, '');
    s = s.replace(/\s+#\d+.*$/g, '');
    s = s.replace(/\s+\*{0,1}\d{4,}.*$/g, '');
    s = s.replace(/\s+STORE\s*#?\s*\d+.*$/i, '');
    s = s.replace(/\s+ST\s*#?\s*\d+.*$/i, '');
    s = s.replace(/\s+\d{2,}\s*$/g, '');
    s = s.replace(/\s*,\s*[A-Z]{2}\s*$/g, '');
    s = s.replace(/\s+[A-Z]{2,4}\s*$/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    var titled = s.split(' ').map(function (word) {
      if (!word) return '';
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
    var canonWords = normText(titled).split(' ').filter(Boolean);
    while (canonWords.length > 1 && MERCHANT_GENERIC_SUFFIXES.indexOf(canonWords[canonWords.length - 1]) >= 0) {
      canonWords.pop();
    }
    if (canonWords.length && canonWords.length < normText(titled).split(' ').filter(Boolean).length) {
      return canonWords.map(function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }).join(' ');
    }
    return titled;
  }

  var MERCHANT_GENERIC_SUFFIXES = [
    'coffee', 'cafe', 'café', 'store', 'shop', 'inc', 'llc', 'co', 'corp', 'ltd', 'market'
  ];

  function canonicalMerchantKey(note) {
    var name = normalizeMerchantName(note);
    var words = normText(name).split(' ').filter(Boolean);
    while (words.length > 1 && MERCHANT_GENERIC_SUFFIXES.indexOf(words[words.length - 1]) >= 0) {
      words.pop();
    }
    return words.join(' ');
  }

  function merchantKey(note) {
    var key = canonicalMerchantKey(note);
    if (key) return key;
    return normText(normalizeMerchantName(note));
  }

  function pickMerchantDisplayName(a, b) {
    if (!a) return b || '';
    if (!b) return a;
    return a.length <= b.length ? a : b;
  }

  function filterSpending(entries) {
    return entries.filter(entryCountsAsSpending);
  }

  function monthEntries(entries, y, m) {
    return filterSpending(entries).filter(function (e) { return isSameMonth(e.ts, y, m); });
  }

  function monthTotal(entries, y, m) {
    return monthEntries(entries, y, m).reduce(function (s, e) { return s + e.amount; }, 0);
  }

  function monthByCategory(entries, categories, y, m) {
    var byCat = {};
    categories.forEach(function (c) { byCat[c.id] = 0; });
    monthEntries(entries, y, m).forEach(function (e) {
      if (byCat[e.categoryId] === undefined) byCat[e.categoryId] = 0;
      byCat[e.categoryId] += e.amount;
    });
    return byCat;
  }

  function earliestSpendingMonth(entries) {
    var best = null;
    filterSpending(entries).forEach(function (e) {
      var d = new Date(e.ts);
      var y = d.getFullYear();
      var m = d.getMonth();
      if (!best || y < best.y || (y === best.y && m < best.m)) best = { y: y, m: m };
    });
    return best;
  }

  function monthsOfHistory(entries, y, m) {
    var start = earliestSpendingMonth(entries);
    if (!start) return 0;
    return (y - start.y) * 12 + (m - start.m) + 1;
  }

  function hasPriorMonthData(entries, y, m) {
    var prev = shiftMonth(y, m, -1);
    return monthEntries(entries, prev.y, prev.m).length > 0;
  }

  function canCompareMonths(entries, y, m) {
    return monthsOfHistory(entries, y, m) >= 2 && hasPriorMonthData(entries, y, m);
  }

  function amountsClose(a, b) {
    if (a === b) return true;
    var tol = Math.max(0.5, Math.abs(a) * 0.08);
    return Math.abs(a - b) <= tol;
  }

  function groupByMerchant(entries) {
    var map = {};
    entries.forEach(function (e) {
      var key = merchantKey(e.note);
      if (!key) return;
      if (!map[key]) map[key] = { key: key, name: normalizeMerchantName(e.note), entries: [] };
      else map[key].name = pickMerchantDisplayName(map[key].name, normalizeMerchantName(e.note));
      map[key].entries.push(e);
    });
    return map;
  }

  function detectRecurringProfiles(allEntries) {
    var spending = filterSpending(allEntries);
    var byMerchant = groupByMerchant(spending);
    var profiles = {};
    Object.keys(byMerchant).forEach(function (k) {
      var g = byMerchant[k];
      var months = {};
      g.entries.forEach(function (e) {
        var d = new Date(e.ts);
        var mk = d.getFullYear() + '-' + pad2(d.getMonth() + 1);
        if (!months[mk]) months[mk] = [];
        months[mk].push(e);
      });
      var monthKeys = Object.keys(months).sort();
      if (monthKeys.length < 2) return;
      var amounts = [];
      monthKeys.forEach(function (mk) {
        var sum = months[mk].reduce(function (s, e) { return s + e.amount; }, 0);
        amounts.push(sum);
      });
      var avg = amounts.reduce(function (a, b) { return a + b; }, 0) / amounts.length;
      var stable = amounts.every(function (amt) { return amountsClose(amt, avg); });
      if (!stable && monthKeys.length < 3) return;
      if (!stable) {
        var perCharge = g.entries.map(function (e) { return e.amount; });
        avg = perCharge.reduce(function (a, b) { return a + b; }, 0) / perCharge.length;
        stable = perCharge.every(function (amt) { return amountsClose(amt, avg); });
      }
      if (!stable) return;
      profiles[k] = {
        key: k,
        name: g.name,
        typicalAmount: Math.round(avg * 100) / 100,
        monthCount: monthKeys.length
      };
    });
    return profiles;
  }

  function isRecurringEntry(e, profiles, recurringIds) {
    if (e.recurringId && recurringIds[e.recurringId]) return true;
    var k = merchantKey(e.note);
    return !!(k && profiles[k]);
  }

  function computeCoffeeFunStat(entries, y, m) {
    var list = monthEntries(entries, y, m).filter(function (e) {
      return COFFEE_KEYWORDS.test(e.note || '') || COFFEE_KEYWORDS.test(normalizeMerchantName(e.note));
    });
    if (list.length < 2) return null;
    var total = list.reduce(function (s, e) { return s + e.amount; }, 0);
    var dim = new Date(y, m + 1, 0).getDate();
    var daysBetween = dim / list.length;
    return {
      label: 'coffee runs',
      count: list.length,
      total: total,
      daysBetween: daysBetween
    };
  }

  function computeRegularSlide(entries, y, m) {
    var month = monthEntries(entries, y, m);
    var byMerch = groupByMerchant(month);
    var best = null;
    Object.keys(byMerch).forEach(function (k) {
      var g = byMerch[k];
      var visits = g.entries.length;
      if (visits < 2) return;
      var total = g.entries.reduce(function (s, e) { return s + e.amount; }, 0);
      if (!best || visits > best.visits || (visits === best.visits && total > best.total)) {
        best = {
          name: g.name,
          visits: visits,
          total: total,
          avg: total / visits
        };
      }
    });

    var priorKeys = {};
    filterSpending(entries).forEach(function (e) {
      var d = new Date(e.ts);
      if (d.getFullYear() > y || (d.getFullYear() === y && d.getMonth() >= m)) return;
      var k = merchantKey(e.note);
      if (k) priorKeys[k] = true;
    });
    var regularKey = best ? merchantKey(best.name) : null;
    var newPlaces = [];
    Object.keys(byMerch).forEach(function (k) {
      if (regularKey && k === regularKey) return;
      if (priorKeys[k]) return;
      newPlaces.push(byMerch[k].name);
    });
    newPlaces.sort();
    var newPlacesOverflow = 0;
    if (newPlaces.length > 6) {
      newPlacesOverflow = newPlaces.length - 6;
      newPlaces = newPlaces.slice(0, 6);
    }

    var fun = computeCoffeeFunStat(entries, y, m);

    if (!best && !fun && newPlaces.length === 0) return null;
    return {
      regular: best,
      fun: fun,
      newPlaces: newPlaces,
      newPlacesOverflow: newPlacesOverflow
    };
  }

  function computeTotalSlide(entries, y, m) {
    var month = monthEntries(entries, y, m);
    var total = month.reduce(function (s, e) { return s + e.amount; }, 0);
    if (month.length === 0) return null;

    var compare = canCompareMonths(entries, y, m);
    var prev = shiftMonth(y, m, -1);
    var prevTotal = compare ? monthTotal(entries, prev.y, prev.m) : null;
    var vsLast = null;
    if (compare && prevTotal !== null) {
      vsLast = {
        diff: total - prevTotal,
        pct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null,
        prevTotal: prevTotal
      };
    }

    var vsAvg3 = null;
    if (compare) {
      var sum = 0;
      var n = 0;
      for (var i = 1; i <= 3; i++) {
        var slot = shiftMonth(y, m, -i);
        var t = monthTotal(entries, slot.y, slot.m);
        if (t > 0 || monthEntries(entries, slot.y, slot.m).length > 0) {
          sum += t;
          n += 1;
        }
      }
      if (n === 3) {
        var avg = sum / 3;
        vsAvg3 = { avg: avg, diff: total - avg };
      }
    }

    var bars = [];
    for (var j = 3; j >= 0; j--) {
      var b = shiftMonth(y, m, -j);
      bars.push({
        y: b.y,
        m: b.m,
        label: monthShort(b.y, b.m),
        total: monthTotal(entries, b.y, b.m),
        isCurrent: j === 0
      });
    }

    return {
      total: total,
      purchaseCount: month.length,
      vsLast: vsLast,
      vsAvg3: vsAvg3,
      bars: bars,
      compare: compare
    };
  }

  function computeTopCategorySlide(entries, categories, y, m) {
    var byCat = monthByCategory(entries, categories, y, m);
    var total = monthTotal(entries, y, m);
    if (total <= 0) return null;
    var ranked = categories.map(function (c) {
      return { cat: c, amount: byCat[c.id] || 0 };
    }).filter(function (r) { return r.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
    if (!ranked.length) return null;
    var top = ranked[0];
    var compare = canCompareMonths(entries, y, m);
    var prev = shiftMonth(y, m, -1);
    var prevAmt = compare ? (monthByCategory(entries, categories, prev.y, prev.m)[top.cat.id] || 0) : null;
    var change = null;
    if (compare && prevAmt !== null) change = top.amount - prevAmt;

    return {
      top: {
        cat: top.cat,
        amount: top.amount,
        sharePct: Math.round((top.amount / total) * 100),
        changeFromLast: change
      },
      categories: ranked.map(function (r) {
        return {
          cat: r.cat,
          amount: r.amount,
          sharePct: Math.round((r.amount / total) * 100)
        };
      }),
      total: total
    };
  }

  function computeBigMomentsSlide(entries, categories, y, m) {
    var month = monthEntries(entries, y, m);
    if (!month.length) return null;
    var byDay = {};
    month.forEach(function (e) {
      var k = startOfDay(e.ts);
      if (!byDay[k]) byDay[k] = [];
      byDay[k].push(e);
    });
    var biggestDay = null;
    Object.keys(byDay).forEach(function (k) {
      var list = byDay[k];
      var sum = list.reduce(function (s, e) { return s + e.amount; }, 0);
      if (!biggestDay || sum > biggestDay.total) {
        var merchants = [];
        list.forEach(function (e) {
          var n = normalizeMerchantName(e.note) || 'Purchase';
          if (merchants.indexOf(n) === -1) merchants.push(n);
        });
        biggestDay = {
          ts: parseInt(k, 10),
          total: sum,
          stops: list.length,
          merchants: merchants.slice(0, 5)
        };
      }
    });

    var biggestPurchase = null;
    month.forEach(function (e) {
      if (!biggestPurchase || e.amount > biggestPurchase.amount) {
        var cat = categories.find(function (c) { return c.id === e.categoryId; }) || { id: e.categoryId, name: e.categoryId };
        biggestPurchase = {
          amount: e.amount,
          merchant: normalizeMerchantName(e.note) || 'Purchase',
          cat: cat,
          ts: e.ts
        };
      }
    });

    var weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
    month.forEach(function (e) {
      weekdayTotals[new Date(e.ts).getDay()] += e.amount;
    });
    var monthTotalAmt = month.reduce(function (s, e) { return s + e.amount; }, 0);
    var topDayIdx = 0;
    weekdayTotals.forEach(function (v, i) {
      if (v > weekdayTotals[topDayIdx]) topDayIdx = i;
    });
    var dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var shortLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    return {
      biggestDay: biggestDay,
      biggestPurchase: biggestPurchase,
      weekday: {
        totals: weekdayTotals,
        labels: shortLabels,
        topIndex: topDayIdx,
        topName: dayNames[topDayIdx],
        topSharePct: monthTotalAmt > 0 ? Math.round((weekdayTotals[topDayIdx] / monthTotalAmt) * 100) : 0
      },
      total: monthTotalAmt
    };
  }

  function getCategory(categories, id) {
    for (var i = 0; i < categories.length; i++) {
      if (categories[i].id === id) return categories[i];
    }
    return { id: id, name: id };
  }

  function merchantSeenBeforeMonth(entries, y, m, key, excludeId) {
    return filterSpending(entries).some(function (x) {
      if (excludeId && x.id === excludeId) return false;
      var d = new Date(x.ts);
      if (d.getFullYear() > y || (d.getFullYear() === y && d.getMonth() >= m)) return false;
      return merchantKey(x.note) === key;
    });
  }

  function looksLikeNewSubscription(e) {
    if (e.amount < 4.99 || e.amount > 99.99) return false;
    if (e.categoryId === 'bills' || e.categoryId === 'fun') return true;
    var n = normText(e.note);
    return /max|netflix|spotify|hulu|disney|subscription|apple|google|prime|adobe/.test(n);
  }

  function computeRecurringSlide(entries, categories, recurringItems, y, m) {
    var profiles = detectRecurringProfiles(entries);
    var recurringIds = {};
    (recurringItems || []).forEach(function (r) { if (r && r.id) recurringIds[r.id] = r; });

    var month = monthEntries(entries, y, m);
    var monthTotalAmt = month.reduce(function (s, e) { return s + e.amount; }, 0);
    if (monthTotalAmt <= 0) return null;

    var charges = month.filter(function (e) {
      return isRecurringEntry(e, profiles, recurringIds);
    });
    month.forEach(function (e) {
      var key = merchantKey(e.note);
      if (!key) return;
      var dup = charges.some(function (c) { return c.id === e.id; });
      if (dup) return;
      if (!merchantSeenBeforeMonth(entries, y, m, key, e.id) && looksLikeNewSubscription(e)) {
        charges.push(e);
      }
    });
    if (!charges.length) return null;

    var total = charges.reduce(function (s, e) { return s + e.amount; }, 0);
    var prev = shiftMonth(y, m, -1);
    var compare = canCompareMonths(entries, y, m);

    var worthLook = [];
    var steady = [];

    charges.forEach(function (e) {
      var name = normalizeMerchantName(e.note) || 'Recurring';
      var key = merchantKey(e.note) || ('rec:' + (e.recurringId || e.id));
      var cat = getCategory(categories, e.categoryId);

      var seenBefore = merchantSeenBeforeMonth(entries, y, m, key, e.id)
        || (e.recurringId && filterSpending(entries).some(function (x) {
          if (x.id === e.id) return false;
          var d = new Date(x.ts);
          if (d.getFullYear() > y || (d.getFullYear() === y && d.getMonth() >= m)) return false;
          return x.recurringId === e.recurringId;
        }));

      var prevCharge = null;
      if (compare) {
        filterSpending(entries).forEach(function (x) {
          if (!isSameMonth(x.ts, prev.y, prev.m)) return;
          if (merchantKey(x.note) === key || (e.recurringId && x.recurringId === e.recurringId)) {
            if (!prevCharge || x.ts > prevCharge.ts) prevCharge = x;
          }
        });
      }

      var item = {
        name: name,
        amount: e.amount,
        cat: cat,
        ts: e.ts,
        key: key
      };

      if (!seenBefore) {
        worthLook.push({ type: 'new', item: item });
      } else if (prevCharge && Math.abs(e.amount - prevCharge.amount) >= 0.02) {
        worthLook.push({
          type: e.amount > prevCharge.amount ? 'priceUp' : 'priceDown',
          item: item,
          prevAmount: prevCharge.amount
        });
      } else {
        steady.push(item);
      }
    });

    var steadyTotal = steady.reduce(function (s, it) { return s + it.amount; }, 0);
    var steadyNames = [];
    steady.forEach(function (it) {
      if (steadyNames.indexOf(it.name) === -1) steadyNames.push(it.name);
    });

    return {
      total: total,
      count: charges.length,
      sharePct: Math.round((total / monthTotalAmt) * 100),
      worthLook: worthLook,
      steady: {
        count: steady.length,
        total: steadyTotal,
        names: steadyNames.slice(0, 4)
      },
      monthTotal: monthTotalAmt
    };
  }

  function computeBudgetsSlide(entries, categories, budgets, y, m) {
    var active = categories.filter(function (c) { return budgets[c.id] && budgets[c.id] > 0; });
    if (!active.length) return null;
    var byCat = monthByCategory(entries, categories, y, m);
    var rows = active.map(function (c) {
      var limit = budgets[c.id];
      var spent = byCat[c.id] || 0;
      var delta = limit - spent;
      return {
        cat: c,
        limit: limit,
        spent: spent,
        delta: delta,
        over: spent > limit,
        pct: limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0
      };
    });
    var onTrack = rows.filter(function (r) { return !r.over; }).length;
    var totalLimit = rows.reduce(function (s, r) { return s + r.limit; }, 0);
    var totalSpent = rows.reduce(function (s, r) { return s + r.spent; }, 0);
    var totalDelta = totalLimit - totalSpent;
    return {
      onTrack: onTrack,
      totalCategories: rows.length,
      totalLimit: totalLimit,
      totalSpent: totalSpent,
      totalDelta: totalDelta,
      rows: rows
    };
  }

  function computeWinsAccountsSlide(entries, categories, accounts, y, m) {
    var month = monthEntries(entries, y, m);
    if (!month.length) return null;
    var compare = canCompareMonths(entries, y, m);
    var prev = shiftMonth(y, m, -1);
    var win = null;
    if (compare) {
      var bestDrop = null;
      categories.forEach(function (c) {
        var cur = monthByCategory(entries, categories, y, m)[c.id] || 0;
        var prevAmt = monthByCategory(entries, categories, prev.y, prev.m)[c.id] || 0;
        if (cur <= 0 || prevAmt <= 0) return;
        var pct = Math.round(((cur - prevAmt) / prevAmt) * 100);
        if (pct < 0 && (!bestDrop || pct < bestDrop.pct)) {
          bestDrop = { cat: c, pct: pct, cur: cur, prev: prevAmt };
        }
      });
      win = bestDrop;
    }

    var byAccount = {};
    month.forEach(function (e) {
      var aid = e.accountId || 'default';
      if (!byAccount[aid]) byAccount[aid] = { amount: 0, count: 0 };
      byAccount[aid].amount += e.amount;
      byAccount[aid].count += 1;
    });
    var monthTotalAmt = month.reduce(function (s, e) { return s + e.amount; }, 0);
    var accountRows = Object.keys(byAccount).map(function (aid) {
      var acc = (accounts || []).find(function (a) { return a.id === aid; });
      var name = acc ? acc.name : (aid === 'acct-checking' ? 'Checking' : aid === 'acct-chase' ? 'Chase card' : 'Account');
      var data = byAccount[aid];
      return {
        id: aid,
        name: name,
        amount: data.amount,
        count: data.count,
        sharePct: monthTotalAmt > 0 ? Math.round((data.amount / monthTotalAmt) * 100) : 0,
        color: acc && acc.color ? acc.color : '#748FFC'
      };
    }).sort(function (a, b) { return b.amount - a.amount; });

    var transferSkipped = entries.filter(function (e) {
      return e.isTransfer && isSameMonth(e.ts, y, m);
    }).reduce(function (s, e) { return s + Math.abs(e.amount); }, 0) / 2;

    if (!win && accountRows.length === 0) return null;
    return {
      win: win,
      accounts: accountRows,
      transferSkipped: transferSkipped > 0 ? transferSkipped : null,
      monthTotal: monthTotalAmt
    };
  }

  function buildSummarySlide(slides) {
    var total = slides.total;
    if (!total) return null;
    var tiles = [];
    if (slides.topCategory && slides.topCategory.top) {
      tiles.push({
        label: 'Top category',
        title: slides.topCategory.top.cat.name,
        sub: slides.topCategory.top.sharePct + '% · $' + roundMoney(slides.topCategory.top.amount)
      });
    }
    if (slides.regulars && slides.regulars.regular) {
      tiles.push({
        label: 'My regular',
        title: slides.regulars.regular.name,
        sub: slides.regulars.regular.visits + ' visits'
      });
    }
    if (slides.bigMoments && slides.bigMoments.biggestDay) {
      var d = new Date(slides.bigMoments.biggestDay.ts);
      tiles.push({
        label: 'Biggest day',
        title: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        sub: '$' + roundMoney(slides.bigMoments.biggestDay.total)
      });
    }
    if (slides.recurring) {
      tiles.push({
        label: 'On repeat',
        title: '$' + roundMoney(slides.recurring.total),
        sub: slides.recurring.count + ' charges'
      });
    }
    if (slides.budgets) {
      tiles.push({
        label: 'Budgets',
        title: slides.budgets.onTrack + ' of ' + slides.budgets.totalCategories,
        sub: 'on track'
      });
    }
    if (slides.regulars && slides.regulars.fun) {
      tiles.push({
        label: 'Coffee runs',
        title: String(slides.regulars.fun.count),
        sub: '$' + roundMoney(slides.regulars.fun.total) + ' total'
      });
    }
    while (tiles.length < 6) tiles.push(null);
    tiles = tiles.slice(0, 6);

    return {
      total: total.total,
      vsLastPct: total.vsLast && total.vsLast.pct != null ? total.vsLast.pct : null,
      compare: total.compare,
      tiles: tiles.filter(Boolean)
    };
  }

  function roundMoney(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function buildWrappedData(opts) {
    var entries = opts.entries || [];
    var categories = opts.categories || [];
    var budgets = opts.budgets || {};
    var recurringItems = opts.recurringItems || [];
    var accounts = opts.accounts || [];
    var y = opts.y;
    var m = opts.m;

    var total = computeTotalSlide(entries, y, m);
    if (!total) {
      return { y: y, m: m, empty: true, slides: [], slideOrder: [] };
    }

    var parts = {
      total: total,
      topCategory: computeTopCategorySlide(entries, categories, y, m),
      regulars: computeRegularSlide(entries, y, m),
      bigMoments: computeBigMomentsSlide(entries, categories, y, m),
      recurring: computeRecurringSlide(entries, categories, recurringItems, y, m),
      budgets: computeBudgetsSlide(entries, categories, budgets, y, m),
      winsAccounts: computeWinsAccountsSlide(entries, categories, accounts, y, m)
    };

    var summary = buildSummarySlide(parts);
    parts.summary = summary;

    var order = [
      { id: 'total', data: parts.total },
      { id: 'topCategory', data: parts.topCategory },
      { id: 'regulars', data: parts.regulars },
      { id: 'bigMoments', data: parts.bigMoments },
      { id: 'recurring', data: parts.recurring },
      { id: 'budgets', data: parts.budgets },
      { id: 'winsAccounts', data: parts.winsAccounts },
      { id: 'summary', data: parts.summary }
    ];

    var slides = order.filter(function (s) { return s.data != null; });

    return {
      y: y,
      m: m,
      empty: false,
      parts: parts,
      slides: slides,
      slideOrder: slides.map(function (s) { return s.id; })
    };
  }

  var api = {
    MS_DAY: MS_DAY,
    normalizeMerchantName: normalizeMerchantName,
    canonicalMerchantKey: canonicalMerchantKey,
    merchantKey: merchantKey,
    entryCountsAsSpending: entryCountsAsSpending,
    buildWrappedData: buildWrappedData,
    computeTotalSlide: computeTotalSlide,
    computeTopCategorySlide: computeTopCategorySlide,
    computeRegularSlide: computeRegularSlide,
    computeBigMomentsSlide: computeBigMomentsSlide,
    computeRecurringSlide: computeRecurringSlide,
    computeBudgetsSlide: computeBudgetsSlide,
    computeWinsAccountsSlide: computeWinsAccountsSlide,
    detectRecurringProfiles: detectRecurringProfiles,
    canCompareMonths: canCompareMonths,
    monthEntries: monthEntries,
    monthTotal: monthTotal
  };

  global.ExpenseWrapped = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
