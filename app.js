(function () {
  'use strict';

  var Calc = window.SijilanCalc;
  var KEYS = { settings: 'sijilan_lite_settings', ops: 'sijilan_lite_ops', draft: 'sijilan_lite_draft' };
  var DEFAULT_SETTINGS = { nameA: 'عبدالعالم', nameB: 'الإخوة', nameC: 'مريم', nameD: 'عاصم', pctA: 5, pctB: 15, comm: 2, amountC: 500 };

  // ---------- storage (every access guarded: private mode can throw) ----------
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      toast('تعذر الحفظ على هذا الجهاز (المساحة ممتلئة أو التصفح الخاص).');
      return false;
    }
  }

  var settings = Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {}));
  var ops = load(KEYS.ops, []);
  if (!Array.isArray(ops)) ops = [];
  var period = 'month';

  // ---------- helpers ----------
  var $ = function (id) { return document.getElementById(id); };
  function fmt(n) {
    return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  // Keep numbers, signs and % in left-to-right order inside Arabic text.
  function ltr(s) { return '⁦' + s + '⁩'; }
  function money(n) { return ltr(fmt(n)) + ' ريال'; }
  function minus(n) { return ltr('− ' + fmt(n)) + ' ريال'; }
  function plus(n) { return ltr('+ ' + fmt(n)) + ' ريال'; }
  function pct(p) { return ltr(fmt(p) + '%'); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k === 'style') node.setAttribute('style', attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function formatDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' });
  }

  var toastTimer = null;
  function toast(message) {
    var t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function copyText(text, okMessage) {
    function fallback() {
      var area = el('textarea', { style: 'position:fixed;opacity:0' });
      area.value = text;
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      area.remove();
      toast(ok ? okMessage : 'تعذر النسخ.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMessage); }, fallback);
    } else {
      fallback();
    }
  }

  // ---------- breakdown: one description used for the screen and the text report ----------
  function buildSteps(r, names) {
    var steps = [
      {
        title: 'المدخلات', color: 'var(--muted)',
        rows: [
          ['مبلغ ' + names.nameA, money(r.a)],
          ['مبلغ ' + names.nameB, money(r.b)],
          ['الإجمالي', money(r.total), 'total'],
        ],
      },
      {
        title: 'استقطاع النسب (صندوق الشراكة)', color: 'var(--indigo)',
        rows: [
          [pct(r.rates.pctA) + ' من ' + names.nameA, minus(r.discA), 'neg'],
          [pct(r.rates.pctB) + ' من ' + names.nameB, minus(r.discB), 'neg'],
          ['مجموع الصندوق', money(r.pool), 'total'],
        ],
      },
      r.applyC
        ? {
          title: 'حصة ' + names.nameC, color: 'var(--pink)',
          rows: [
            ['تُخصم من الصندوق', minus(r.shareC), 'neg'],
            ['المتبقي في الصندوق', money(r.poolAfterC), 'total'],
          ],
        }
        : { title: 'حصة ' + names.nameC, color: 'var(--pink)', rows: [['غير مفعّلة في هذه العملية', '0']] },
      {
        title: 'توزيع الصندوق مناصفة', color: 'var(--purple)',
        rows: [
          ['نصف لـ ' + names.nameA, plus(r.halfA), 'pos'],
          ['نصف لـ ' + names.nameD, money(r.asim)],
        ],
      },
      {
        title: 'العمولة البنكية ' + pct(r.rates.comm) + '', color: 'var(--amber)',
        rows: [
          ['على ' + names.nameA + ' بعد الاستقطاع (' + fmt(r.remainingA) + ')', minus(r.commA), 'neg'],
          ['على ' + names.nameB + ' بعد الاستقطاع (' + fmt(r.remainingB) + ')', minus(r.commB), 'neg'],
          ['مجموع العمولات', money(r.commTotal), 'total'],
        ],
      },
      {
        title: 'الصافي والمستحق للتحويل', color: 'var(--green)',
        rows: [
          ['صافي ' + names.nameA, money(r.finalA)],
          ['صافي ' + names.nameB, money(r.finalB)],
          ['المبلغ المستحق للتحويل', money(r.transfer), 'total'],
        ],
      },
    ];
    return steps;
  }

  function renderSteps(container, steps) {
    container.textContent = '';
    steps.forEach(function (step) {
      var rows = step.rows.map(function (row) {
        return el('div', { class: 'row' + (row[2] === 'total' ? ' total' : '') }, [
          el('span', { text: row[0] }),
          el('span', { text: row[1], class: row[2] === 'neg' ? 'neg' : row[2] === 'pos' ? 'pos' : '' }),
        ]);
      });
      container.appendChild(el('li', { class: 'step', style: '--c:' + step.color }, [el('h3', { text: step.title })].concat(rows)));
    });
  }

  function stepsToText(header, steps, extraLines) {
    var lines = [header, '━━━━━━━━━━━━━━'];
    steps.forEach(function (step) {
      lines.push('▪️ *' + step.title + '*');
      step.rows.forEach(function (row) { lines.push('   ' + row[0] + ': ' + row[1]); });
    });
    lines.push('━━━━━━━━━━━━━━');
    (extraLines || []).forEach(function (l) { lines.push(l); });
    return lines.join('\n');
  }

  function namesOf(source) {
    return { nameA: source.nameA || 'الطرف الأول', nameB: source.nameB || 'الطرف الثاني', nameC: source.nameC || 'الطرف الثالث', nameD: source.nameD || 'عاصم' };
  }

  // ---------- main calculator ----------
  var applyC = false;
  var draft = load(KEYS.draft, {});
  $('in-a').value = draft.a || '';
  $('in-b').value = draft.b || '';
  $('in-note').value = draft.note || '';
  applyC = Boolean(draft.applyC);

  function readInput(input) {
    var value = Calc.parseAmount(input.value);
    input.setAttribute('aria-invalid', value === null ? 'true' : 'false');
    input.style.borderColor = value === null ? 'var(--primary)' : '';
    return value === null ? 0 : value;
  }

  var current = null;
  function updateCalc() {
    var a = readInput($('in-a'));
    var b = readInput($('in-b'));
    current = Calc.calculate({ a: a, b: b, applyC: applyC }, settings);
    var names = namesOf(settings);

    $('tg-c').setAttribute('aria-checked', String(applyC));
    $('out-transfer').firstChild.nodeValue = fmt(current.transfer) + ' ';
    $('out-transfer-sub').textContent = 'صافي ' + names.nameA + ' + صافي ' + names.nameB + ' · من إجمالي ' + money(current.total);
    $('out-a').textContent = fmt(current.finalA);
    $('out-b').textContent = fmt(current.finalB);
    $('out-asim').textContent = fmt(current.asim);
    $('out-c').textContent = fmt(current.shareC);

    var alertBox = $('calc-alert');
    if (current.poolShort && current.total > 0) {
      alertBox.hidden = false;
      alertBox.textContent = 'الصندوق فيه ' + money(current.pool) + ' فقط، وهو أقل من حصة ' + names.nameC +
        ' (' + money(current.rates.amountC) + '). سيتحمّل ' + names.nameA + ' و' + names.nameD + ' الفرق.';
    } else {
      alertBox.hidden = true;
    }

    renderSteps($('calc-steps'), buildSteps(current, names));
    save(KEYS.draft, { a: $('in-a').value, b: $('in-b').value, note: $('in-note').value, applyC: applyC });
  }

  ['in-a', 'in-b', 'in-note'].forEach(function (id) { $(id).addEventListener('input', updateCalc); });
  $('tg-c').addEventListener('click', function () { applyC = !applyC; updateCalc(); });

  $('btn-save').addEventListener('click', function () {
    updateCalc();
    if (!current || current.total <= 0) {
      toast('أدخل مبلغًا أولًا.');
      return;
    }
    if (Calc.parseAmount($('in-a').value) === null || Calc.parseAmount($('in-b').value) === null) {
      toast('في أحد المبالغ خطأ في الكتابة.');
      return;
    }
    var op = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      createdAt: new Date().toISOString(),
      note: $('in-note').value.trim(),
      rawA: $('in-a').value.trim(),
      rawB: $('in-b').value.trim(),
      names: namesOf(settings),
      result: current,
    };
    ops.unshift(op);
    if (!save(KEYS.ops, ops)) { ops.shift(); return; }
    clearCalc();
    renderLog();
    toast('تم حفظ العملية: ' + money(op.result.transfer) + ' للتحويل');
  });

  // ---------- reports ----------
  // Short report: only the amounts that matter.
  function basicReport(result, names, note, when) {
    return [
      '📊 *تقرير الحساب*',
      '📅 ' + when,
      note ? '📝 ' + note : '',
      '━━━━━━━━━━━━━━',
      '💰 إجمالي المدخلات: ' + money(result.total),
      '👤 صافي ' + names.nameA + ': ' + money(result.finalA),
      '👥 صافي ' + names.nameB + ': ' + money(result.finalB),
      '👤 حصة ' + names.nameD + ': ' + money(result.asim),
      result.applyC ? '❤️ حصة ' + names.nameC + ': ' + money(result.shareC) : '',
      '━━━━━━━━━━━━━━',
      '🏦 *المستحق للتحويل: ' + money(result.transfer) + '*',
    ].filter(Boolean).join('\n');
  }

  // Full sequence: inputs, deductions, shares, commissions, net.
  function stepsReport(result, names, note, when) {
    var header = '🧾 *تسلسل العملية*\n📅 ' + when + (note ? '\n📝 ' + note : '');
    return stepsToText(header, buildSteps(result, names));
  }

  var pdfBusy = false;
  async function exportPdf(result, names, note, when, mode, button, createdAt) {
    if (pdfBusy) return;
    if (!result || result.total <= 0) { toast('أدخل مبلغًا أولًا.'); return; }
    pdfBusy = true;
    var label = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'جارٍ التجهيز...'; }
    try {
      var blob = await window.SijilanPdf.createReportPdf({ result: result, names: names, note: note, createdAt: createdAt || new Date().toISOString() });
      var name = 'تقرير-سجلان-' + new Date().toISOString().slice(0, 10) + '.pdf';
      if (mode === 'share') {
        var outcome = await window.SijilanPdf.share(blob, name, 'تقرير الحساب', basicReport(result, names, note, when));
        if (outcome === 'unsupported') {
          window.SijilanPdf.download(blob, name);
          toast('المشاركة غير مدعومة هنا، فنزّلنا الملف بدلًا منها.');
        }
      } else {
        window.SijilanPdf.download(blob, name);
        toast('تم تنزيل التقرير PDF.');
      }
    } catch (error) {
      toast('تعذر إنشاء PDF: ' + (error && error.message ? error.message : 'خطأ غير معروف'));
    } finally {
      pdfBusy = false;
      if (button) { button.disabled = false; button.textContent = label; }
    }
  }

  function currentReportArgs() {
    updateCalc();
    return [current, namesOf(settings), $('in-note').value.trim(), formatDate(new Date().toISOString())];
  }

  $('btn-copy').addEventListener('click', function () {
    copyText(basicReport.apply(null, currentReportArgs()), 'تم نسخ التقرير.');
  });
  $('btn-copy-steps').addEventListener('click', function () {
    copyText(stepsReport.apply(null, currentReportArgs()), 'تم نسخ تسلسل العملية.');
  });
  $('btn-pdf').addEventListener('click', function () {
    exportPdf.apply(null, currentReportArgs().concat(['download', $('btn-pdf')]));
  });
  $('btn-share').addEventListener('click', function () {
    exportPdf.apply(null, currentReportArgs().concat(['share', $('btn-share')]));
  });

  function clearCalc() {
    $('in-a').value = '';
    $('in-b').value = '';
    $('in-note').value = '';
    applyC = false;
    updateCalc();
  }
  $('btn-clear').addEventListener('click', clearCalc);

  // ---------- individual calculator ----------
  var currentInd = null;
  function updateInd() {
    var amount = readInput($('in-ind'));
    currentInd = Calc.calculateIndividual(amount, settings);
    $('out-ind').firstChild.nodeValue = fmt(currentInd.net) + ' ';
    var steps = [
      { title: 'المبلغ', color: 'var(--muted)', rows: [['المبلغ المدخل', money(currentInd.amount)]] },
      {
        title: 'الاستقطاع ' + pct(currentInd.rates.pctB), color: 'var(--indigo)',
        rows: [['الخصم', minus(currentInd.disc), 'neg'], ['بعد الخصم', money(currentInd.remaining), 'total']],
      },
      {
        title: 'العمولة البنكية ' + pct(currentInd.rates.comm), color: 'var(--amber)',
        rows: [['العمولة', minus(currentInd.comm), 'neg']],
      },
      { title: 'الصافي', color: 'var(--green)', rows: [['الصافي المستحق', money(currentInd.net), 'total']] },
    ];
    renderSteps($('ind-steps'), steps);
    return steps;
  }
  $('in-ind').addEventListener('input', updateInd);
  $('btn-copy-ind').addEventListener('click', function () {
    var steps = updateInd();
    copyText(stepsToText('🧮 *حاسبة الأفراد*\n📅 ' + formatDate(new Date().toISOString()), steps, ['✅ *الصافي: ' + money(currentInd.net) + '*']), 'تم نسخ التقرير.');
  });

  // ---------- saved operations ----------
  function inPeriod(op) {
    if (period === 'all') return true;
    var d = new Date(op.createdAt);
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  function summaryRows(sum, names) {
    return [
      ['عدد العمليات', String(sum.count)],
      ['إجمالي المدخلات', money(sum.total)],
      ['مجموع مبالغ ' + names.nameA, money(sum.a)],
      ['مجموع مبالغ ' + names.nameB, money(sum.b)],
      ['مجموع الاستقطاعات (الصندوق)', money(sum.pool)],
      ['مجموع حصص ' + names.nameC, money(sum.shareC)],
      ['مجموع حصة ' + names.nameD, money(sum.asim)],
      ['مجموع العمولات البنكية', money(sum.commTotal)],
      ['صافي ' + names.nameA, money(sum.finalA)],
      ['صافي ' + names.nameB, money(sum.finalB)],
      ['المجموع المستحق للتحويل', money(sum.transfer), 'total'],
    ];
  }

  // Amount with a smaller, muted currency label.
  function amountNode(n, cls) {
    return el('span', { class: 'amt' + (cls ? ' ' + cls : '') }, [
      el('bdi', { text: fmt(n) }),
      el('small', { text: ' ريال' }),
    ]);
  }

  function sumLine(label, value, color) {
    return el('div', { class: 'sum-line' }, [
      el('span', { class: 'sum-label' }, [el('i', { style: 'background:' + color }), el('span', { text: label })]),
      amountNode(value),
    ]);
  }

  // Accumulated totals, grouped: what goes out (nets), what came in, what was taken.
  function renderSummary(box, sum, names) {
    box.textContent = '';
    var shareA = sum.total > 0 ? Math.round((sum.a / sum.total) * 100) : 0;

    box.appendChild(el('div', { class: 'grid2' }, [
      el('div', { class: 'sum-net', style: '--c:var(--blue)' }, [el('span', { text: 'صافي ' + names.nameA }), amountNode(sum.finalA)]),
      el('div', { class: 'sum-net', style: '--c:var(--green)' }, [el('span', { text: 'صافي ' + names.nameB }), amountNode(sum.finalB)]),
    ]));

    box.appendChild(el('div', { class: 'card sum-card' }, [
      el('div', { class: 'sum-head' }, [el('h3', { text: 'المدخلات' }), amountNode(sum.total, 'strong')]),
      el('div', { class: 'split', 'aria-hidden': 'true' }, [
        el('span', { style: 'width:' + shareA + '%;background:var(--blue)' }),
        el('span', { style: 'width:' + (100 - shareA) + '%;background:var(--green)' }),
      ]),
      sumLine(names.nameA + (sum.total > 0 ? ' (' + shareA + '%)' : ''), sum.a, 'var(--blue)'),
      sumLine(names.nameB + (sum.total > 0 ? ' (' + (100 - shareA) + '%)' : ''), sum.b, 'var(--green)'),
    ]));

    var taken = Calc.round2(sum.pool + sum.commTotal);
    box.appendChild(el('div', { class: 'card sum-card' }, [
      el('div', { class: 'sum-head' }, [el('h3', { text: 'الاستقطاعات والحصص' }), amountNode(taken, 'strong')]),
      sumLine('صندوق النسب', sum.pool, 'var(--indigo)'),
      el('div', { class: 'sum-sub' }, [
        sumLine('حصة ' + names.nameD, sum.asim, 'var(--purple)'),
        sumLine('نصيب ' + names.nameA + ' من الصندوق', sum.halfA, 'var(--blue)'),
        sumLine('حصة ' + names.nameC, sum.shareC, 'var(--pink)'),
      ]),
      sumLine('العمولات البنكية', sum.commTotal, 'var(--amber)'),
    ]));
  }

  function renderLog() {
    var visible = ops.filter(inPeriod);
    var sum = Calc.sumResults(visible.map(function (op) { return op.result; }));
    var names = namesOf(settings);

    $('sum-transfer').firstChild.nodeValue = fmt(sum.transfer) + ' ';
    $('sum-count').textContent = sum.count + ' عملية · ' + (period === 'month' ? 'هذا الشهر' : 'كل الفترات');

    renderSummary($('sum-rows'), sum, names);

    var list = $('ops-list');
    list.textContent = '';
    if (visible.length === 0) {
      list.appendChild(el('p', { class: 'empty', text: period === 'month' ? 'لا توجد عمليات محفوظة هذا الشهر.' : 'لا توجد عمليات محفوظة بعد.' }));
      return;
    }

    visible.forEach(function (op) {
      var body = el('div', { class: 'op-body', hidden: '' });
      var stepsList = el('ol', { class: 'steps' });
      var copyBtn = el('button', { class: 'btn ghost', type: 'button', text: 'نسخ التقرير' });
      var pdfBtn = el('button', { class: 'btn ghost', type: 'button', text: 'PDF' });
      var delBtn = el('button', { class: 'btn danger', type: 'button', text: 'حذف' });
      body.appendChild(stepsList);
      body.appendChild(el('div', { class: 'op-actions' }, [copyBtn, pdfBtn, delBtn]));

      var head = el('button', { class: 'op-head', type: 'button', 'aria-expanded': 'false' }, [
        el('span', {}, [
          el('span', { class: 'note', text: op.note || ('عملية ' + money(op.result.total)), style: 'display:block' }),
          el('span', { class: 'when', text: formatDate(op.createdAt), style: 'display:block' }),
        ]),
        el('span', { class: 'money', text: fmt(op.result.transfer) }),
      ]);
      head.addEventListener('click', function () {
        var open = body.hasAttribute('hidden');
        if (open) {
          renderSteps(stepsList, buildSteps(op.result, op.names || names));
          body.removeAttribute('hidden');
        } else {
          body.setAttribute('hidden', '');
        }
        head.setAttribute('aria-expanded', String(open));
      });
      copyBtn.addEventListener('click', function () {
        copyText(basicReport(op.result, op.names || names, op.note, formatDate(op.createdAt)), 'تم نسخ تقرير العملية.');
      });
      pdfBtn.addEventListener('click', function () {
        exportPdf(op.result, namesOf(op.names || names), op.note, formatDate(op.createdAt), 'download', pdfBtn, op.createdAt);
      });
      delBtn.addEventListener('click', function () {
        if (!window.confirm('حذف هذه العملية (' + money(op.result.transfer) + ')؟')) return;
        ops = ops.filter(function (o) { return o.id !== op.id; });
        save(KEYS.ops, ops);
        renderLog();
        toast('تم حذف العملية.');
      });

      list.appendChild(el('article', { class: 'op' }, [head, body]));
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-period]'), function (chip) {
    chip.addEventListener('click', function () {
      period = chip.getAttribute('data-period');
      Array.prototype.forEach.call(document.querySelectorAll('.chip[data-period]'), function (c) {
        c.setAttribute('aria-pressed', String(c === chip));
      });
      renderLog();
    });
  });

  $('btn-copy-sum').addEventListener('click', function () {
    var visible = ops.filter(inPeriod);
    var sum = Calc.sumResults(visible.map(function (op) { return op.result; }));
    var names = namesOf(settings);
    var lines = ['📊 *التقرير المجمّع* (' + (period === 'month' ? 'هذا الشهر' : 'كل الفترات') + ')', '━━━━━━━━━━━━━━'];
    summaryRows(sum, names).forEach(function (row) { lines.push(row[0] + ': ' + row[1]); });
    lines.push('━━━━━━━━━━━━━━');
    visible.forEach(function (op, i) {
      lines.push((i + 1) + '. ' + formatDate(op.createdAt) + (op.note ? ' — ' + op.note : '') + ': ' + money(op.result.transfer));
    });
    copyText(lines.join('\n'), 'تم نسخ التقرير المجمّع.');
  });

  // ---------- backup ----------
  function exportBackup() {
    var data = { app: 'sijilan-lite', version: 1, exportedAt: new Date().toISOString(), settings: settings, ops: ops };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: 'sijilan-lite-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('تم تنزيل النسخة الاحتياطية.');
  }
  $('btn-export').addEventListener('click', exportBackup);
  $('btn-export-2').addEventListener('click', exportBackup);

  $('btn-import').addEventListener('click', function () { $('file-import').click(); });
  $('file-import').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      if (!data || data.app !== 'sijilan-lite' || !Array.isArray(data.ops)) {
        toast('هذا الملف ليس نسخة احتياطية من الحاسبة.');
        return;
      }
      var known = {};
      ops.forEach(function (o) { known[o.id] = true; });
      var added = data.ops.filter(function (o) { return o && o.id && o.result && !known[o.id]; });
      if (!window.confirm('سيُضاف ' + added.length + ' عملية من النسخة الاحتياطية (العمليات الموجودة تبقى كما هي). متابعة؟')) return;
      ops = ops.concat(added).sort(function (x, y) { return new Date(y.createdAt) - new Date(x.createdAt); });
      save(KEYS.ops, ops);
      renderLog();
      toast('تمت استعادة ' + added.length + ' عملية.');
    };
    reader.readAsText(file);
  });

  $('btn-wipe').addEventListener('click', function () {
    if (ops.length === 0) { toast('لا توجد عمليات محفوظة.'); return; }
    if (!window.confirm('سيُحذف ' + ops.length + ' عملية نهائيًا من هذا الجهاز. ننصح بتنزيل نسخة احتياطية أولًا. هل تريد الحذف؟')) return;
    ops = [];
    save(KEYS.ops, ops);
    renderLog();
    toast('تم حذف كل العمليات.');
  });

  // ---------- report font ----------
  function refreshFontStatus() {
    window.SijilanPdf.activeFontName().then(function (name) {
      $('font-name').textContent = name;
      $('btn-font-reset').hidden = !window.SijilanPdf.hasStoredFont();
    });
  }

  function readFileBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function isTrueType(buffer) {
    var b = new Uint8Array(buffer, 0, 4);
    var tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
    return (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || tag === 'true';
  }

  $('btn-font').addEventListener('click', function () { $('file-font').click(); });
  $('file-font').addEventListener('change', async function (event) {
    var files = Array.prototype.slice.call(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;
    // The bold file is majallab.ttf (or any name containing "bold").
    var isBold = function (f) { return /majallab|bold/i.test(f.name); };
    var regularFile = files.filter(function (f) { return !isBold(f); })[0];
    var boldFile = files.filter(isBold)[0];
    if (!regularFile) { regularFile = boldFile; boldFile = null; }
    try {
      var regular = await readFileBuffer(regularFile);
      var bold = boldFile ? await readFileBuffer(boldFile) : null;
      if (!isTrueType(regular) || (bold && !isTrueType(bold))) {
        toast('اختر ملف خط بصيغة TTF.');
        return;
      }
      window.SijilanPdf.saveStoredFont(regular, bold, regularFile.name);
      refreshFontStatus();
      toast(bold ? 'تم حفظ الخط العادي والعريض للتقارير.' : 'تم حفظ الخط. أضف majallab.ttf أيضًا للعناوين العريضة.');
    } catch (error) {
      toast('تعذر حفظ الخط على هذا الجهاز (قد تكون المساحة ممتلئة).');
    }
  });
  $('btn-font-reset').addEventListener('click', function () {
    window.SijilanPdf.clearStoredFont();
    refreshFontStatus();
    toast('رجع التقرير إلى الخط الافتراضي.');
  });
  refreshFontStatus();

  // ---------- settings ----------
  var SETTING_FIELDS = { 's-nameA': 'nameA', 's-nameB': 'nameB', 's-nameC': 'nameC', 's-nameD': 'nameD', 's-pctA': 'pctA', 's-pctB': 'pctB', 's-comm': 'comm', 's-amountC': 'amountC' };
  var NUMERIC = { pctA: true, pctB: true, comm: true, amountC: true };

  function applyNames() {
    var n = namesOf(settings);
    $('lbl-a').textContent = 'مبلغ ' + n.nameA;
    $('lbl-b').textContent = 'مبلغ ' + n.nameB;
    $('lbl-c').textContent = 'حصة ' + n.nameC + ' (' + money(settings.amountC) + ')';
    $('t-a').textContent = 'صافي ' + n.nameA;
    $('t-b').textContent = 'صافي ' + n.nameB;
    $('t-c').textContent = 'حصة ' + n.nameC;
    $('t-d').textContent = 'حصة ' + n.nameD;
    $('s-lbl-a').textContent = 'نسبة استقطاع ' + n.nameA + ' (%)';
    $('s-lbl-b').textContent = 'نسبة استقطاع ' + n.nameB + ' والأفراد (%)';
    $('s-lbl-c').textContent = 'حصة ' + n.nameC + ' الثابتة (ريال)';
  }

  Object.keys(SETTING_FIELDS).forEach(function (id) {
    var key = SETTING_FIELDS[id];
    var input = $(id);
    input.value = settings[key];
    input.addEventListener('input', function () {
      if (NUMERIC[key]) {
        var v = Calc.parseAmount(input.value);
        input.style.borderColor = v === null ? 'var(--primary)' : '';
        if (v === null) return;
        settings[key] = v;
      } else {
        settings[key] = input.value.trim();
      }
      save(KEYS.settings, settings);
      applyNames();
      updateCalc();
      updateInd();
      renderLog();
    });
  });

  // ---------- tabs ----------
  Array.prototype.forEach.call(document.querySelectorAll('nav.tabs button'), function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-view');
      Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) { v.classList.toggle('active', v.id === target); });
      Array.prototype.forEach.call(document.querySelectorAll('nav.tabs button'), function (b) {
        if (b === btn) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      window.scrollTo(0, 0);
      if (target === 'view-log') renderLog();
    });
  });

  // ---------- summing calculator sheet ----------
  // Each "+ إضافة" adds the typed amount to a list; "اعتماد المجموع" writes the
  // list back into the field as "1500+2300-200", so the parts stay visible.
  var sheet = { target: null, items: [], current: '' };

  function renderSheet() {
    var box = $('calc-items');
    box.textContent = '';
    if (sheet.items.length === 0) {
      box.appendChild(el('span', { class: 'empty-hint', text: 'اكتب مبلغًا ثم اضغط «+ إضافة»' }));
    }
    sheet.items.forEach(function (value, index) {
      var remove = el('button', { type: 'button', 'aria-label': 'حذف ' + fmt(Math.abs(value)), text: '×' });
      remove.addEventListener('click', function () { sheet.items.splice(index, 1); renderSheet(); });
      box.appendChild(el('span', { class: 'calc-item' + (value < 0 ? ' neg' : '') }, [
        el('span', { text: (value < 0 ? '− ' : '') + fmt(Math.abs(value)) }), remove,
      ]));
    });
    $('calc-current').textContent = sheet.current || '0';
    var total = sheet.items.reduce(function (s, v) { return s + v; }, 0) + (parseFloat(sheet.current) || 0);
    $('calc-total').textContent = money(Calc.round2(total));
  }

  function pushCurrent(sign) {
    var value = parseFloat(sheet.current);
    if (!sheet.current || !isFinite(value) || value === 0) return false;
    sheet.items.push(sign * value);
    sheet.current = '';
    return true;
  }

  function openSheet(targetId) {
    var input = $(targetId);
    var parts = Calc.splitAmounts(input.value);
    sheet.target = input;
    sheet.items = (parts || []).filter(function (v) { return v !== 0; });
    sheet.current = '';
    var label = input.closest('label');
    var labelText = label && label.querySelector('span') ? label.querySelector('span').textContent : 'المبالغ';
    $('calc-title').textContent = 'جمع: ' + labelText;
    renderSheet();
    document.body.classList.add('sheet-open');
    $('calc-sheet').setAttribute('aria-hidden', 'false');
    setTimeout(function () { $('calc-close').focus(); }, 50);
  }

  function closeSheet() {
    document.body.classList.remove('sheet-open');
    $('calc-sheet').setAttribute('aria-hidden', 'true');
    if (sheet.target) sheet.target.focus();
    sheet.target = null;
  }

  function applySheet() {
    pushCurrent(1);
    var expr = sheet.items.map(function (v, i) {
      var abs = String(Calc.round2(Math.abs(v)));
      return (v < 0 ? '-' : (i === 0 ? '' : '+')) + abs;
    }).join('');
    var input = sheet.target;
    input.value = expr;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    closeSheet();
    toast('المجموع: ' + money(Calc.parseAmount(expr) || 0));
  }

  function pressKey(key) {
    if (/^\d$/.test(key) || key === '000') {
      if (key === '000' && !sheet.current) return;
      if (sheet.current.replace('.', '').length >= 12) return;
      sheet.current = (sheet.current === '0' ? '' : sheet.current) + key;
    } else if (key === '.') {
      if (sheet.current.indexOf('.') === -1) sheet.current = (sheet.current || '0') + '.';
    } else if (key === 'back') {
      if (sheet.current) sheet.current = sheet.current.slice(0, -1);
      else if (sheet.items.length) sheet.items.pop();
    } else if (key === 'clear') {
      sheet.items = [];
      sheet.current = '';
    } else if (key === 'plus') {
      pushCurrent(1);
    } else if (key === 'minus') {
      pushCurrent(-1);
    } else if (key === 'done') {
      applySheet();
      return;
    }
    renderSheet();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.calc-btn'), function (btn) {
    btn.addEventListener('click', function (event) {
      event.preventDefault();
      openSheet(btn.getAttribute('data-calc-for'));
    });
  });
  $('calc-keypad').addEventListener('click', function (event) {
    var btn = event.target.closest('button[data-k]');
    if (btn) pressKey(btn.getAttribute('data-k'));
  });
  $('calc-close').addEventListener('click', closeSheet);
  $('calc-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (event) {
    if (!document.body.classList.contains('sheet-open')) return;
    var map = { '+': 'plus', '-': 'minus', Backspace: 'back', Enter: 'done', Delete: 'clear', '.': '.' };
    if (event.key === 'Escape') { closeSheet(); return; }
    var key = /^\d$/.test(event.key) ? event.key : map[event.key];
    if (key) { event.preventDefault(); pressKey(key); }
  });

  // Remember whether the breakdown is folded (closed by default).
  var fold = $('calc-fold');
  fold.open = load('sijilan_lite_fold_open', false) === true;
  fold.addEventListener('toggle', function () { save('sijilan_lite_fold_open', fold.open); });

  applyNames();
  updateCalc();
  updateInd();
  renderLog();

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* offline install is optional */ });
  }
})();
