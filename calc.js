// Calculation rules for Sijilan's distribution. Same formulas as the full app
// (money abdalalm/src/utils/finance.js) so both give identical numbers.
(function (root) {
  'use strict';

  var ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

  function round2(value) {
    var n = Number(value) || 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // "1,500 + 2300 - 200" -> [1500, 2300, -200]. Accepts Arabic digits and the
  // Arabic decimal mark. Returns null when the text is not a valid sum.
  function splitAmounts(text) {
    var clean = String(text == null ? '' : text)
      .replace(/[٠-٩۰-۹]/g, function (d) { return ARABIC_DIGITS[d]; })
      .replace(/٫/g, '.')
      .replace(/[,٬\s]/g, '')
      .replace(/[−–]/g, '-');
    if (clean === '') return [];
    if (!/^[+-]?\d*\.?\d+([+-]\d*\.?\d+)*$/.test(clean)) return null;
    return (clean.match(/[+-]?\d*\.?\d+/g) || []).map(parseFloat);
  }

  // "1,500 + 2300 - 200" -> 3600, or null when the text is not a valid sum.
  function parseAmount(text) {
    var parts = splitAmounts(text);
    if (parts === null) return null;
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i];
    return round2(total);
  }

  function rates(settings) {
    var s = settings || {};
    return {
      pctA: Number(s.pctA) || 0,
      pctB: Number(s.pctB) || 0,
      comm: Number(s.comm) || 0,
      amountC: Number(s.amountC) || 0,
    };
  }

  // Main distribution:
  // 1. Take pctA% from A and pctB% from B into a shared pool.
  // 2. If C's share is on, take the fixed amount out of the pool.
  // 3. Split what is left of the pool in half: one half to A, one half to Asim.
  // 4. Take the bank commission from A's and B's amounts after step 1.
  // Amount to transfer = A's net + B's net.
  function calculate(input, settings) {
    var r = rates(settings);
    var a = Number(input && input.a) || 0;
    var b = Number(input && input.b) || 0;
    var applyC = Boolean(input && input.applyC);

    var discA = a * r.pctA / 100;
    var discB = b * r.pctB / 100;
    var remainingA = a - discA;
    var remainingB = b - discB;
    var pool = discA + discB;
    var shareC = applyC ? r.amountC : 0;
    var poolAfterC = pool - shareC;
    var half = poolAfterC / 2;
    var commA = remainingA * r.comm / 100;
    var commB = remainingB * r.comm / 100;
    var finalA = remainingA + half - commA;
    var finalB = remainingB - commB;

    return {
      rates: r,
      a: round2(a), b: round2(b), applyC: applyC,
      total: round2(a + b),
      discA: round2(discA), discB: round2(discB),
      remainingA: round2(remainingA), remainingB: round2(remainingB),
      pool: round2(pool), shareC: round2(shareC), poolAfterC: round2(poolAfterC),
      halfA: round2(half), asim: round2(half),
      commA: round2(commA), commB: round2(commB), commTotal: round2(commA + commB),
      finalA: round2(finalA), finalB: round2(finalB),
      transfer: round2(finalA + finalB),
      poolShort: applyC && pool < r.amountC,
    };
  }

  // One person's amount: pctB% deduction, then the bank commission on the rest.
  function calculateIndividual(amount, settings) {
    var r = rates(settings);
    var gross = Number(amount) || 0;
    var disc = gross * r.pctB / 100;
    var remaining = gross - disc;
    var comm = remaining * r.comm / 100;
    return {
      rates: r,
      amount: round2(gross),
      disc: round2(disc),
      remaining: round2(remaining),
      comm: round2(comm),
      net: round2(remaining - comm),
    };
  }

  // Totals across saved operations.
  var SUM_KEYS = ['a', 'b', 'total', 'discA', 'discB', 'pool', 'shareC', 'asim', 'halfA', 'commA', 'commB', 'commTotal', 'finalA', 'finalB', 'transfer'];
  function sumResults(results) {
    var sum = { count: 0 };
    SUM_KEYS.forEach(function (k) { sum[k] = 0; });
    (results || []).forEach(function (res) {
      sum.count += 1;
      SUM_KEYS.forEach(function (k) { sum[k] += Number(res && res[k]) || 0; });
    });
    SUM_KEYS.forEach(function (k) { sum[k] = round2(sum[k]); });
    return sum;
  }

  var api = { round2: round2, splitAmounts: splitAmounts, parseAmount: parseAmount, calculate: calculate, calculateIndividual: calculateIndividual, sumResults: sumResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SijilanCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
