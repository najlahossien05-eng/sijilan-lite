// Builds the calculation report as a real-text A4 PDF (jsPDF + an Arabic TTF font:
// Sakkal Majalla when the user provides it, otherwise Noto Sans Arabic).
//
// jsPDF shapes Arabic correctly only when a string is pure Arabic, so every line
// is split into words and laid out right-to-left here, one word at a time.
// Numbers are always drawn as their own pieces, so they never get reordered.
(function () {
  'use strict';

  var PAGE_W = 210;
  var PAGE_H = 297;
  var MARGIN = 14;
  var RIGHT = PAGE_W - MARGIN;
  var CONTENT_W = PAGE_W - MARGIN * 2;
  var BOTTOM = PAGE_H - 18;

  var COLOR = {
    ink: [15, 23, 42], muted: [100, 116, 139], line: [226, 232, 240], zebra: [248, 250, 252],
    head: [30, 41, 59], red: [225, 29, 46], green: [5, 150, 105], group: [238, 242, 255],
    total: [254, 242, 242], white: [255, 255, 255],
  };

  // ---------- fonts ----------
  var fontCache = null;
  function toBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
  // Report font, in order of preference:
  // 1. Sakkal Majalla picked from this device in Settings (kept in localStorage).
  // 2. Sakkal Majalla placed next to the app as fonts/majalla.ttf + fonts/majallab.ttf.
  // 3. The bundled Noto Sans Arabic.
  var STORED_FONT_KEY = 'sijilan_lite_report_font';

  function readStoredFont() {
    try {
      var stored = JSON.parse(localStorage.getItem(STORED_FONT_KEY) || 'null');
      return stored && stored.regular ? stored : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchBase64(file) {
    var response = await fetch(file);
    if (!response.ok) throw new Error('missing ' + file);
    return toBase64(await response.arrayBuffer());
  }

  async function loadFonts() {
    var stored = readStoredFont();
    if (stored) {
      // Majalla runs small (scale 1.3); another font picked by the user is drawn at normal size.
      var isMajalla = !stored.fileName || /majalla/i.test(stored.fileName);
      return {
        name: isMajalla ? 'Sakkal Majalla' : stored.fileName,
        regular: stored.regular, bold: stored.bold || stored.regular,
        scale: isMajalla ? 1.3 : 1, fullCoverage: true,
      };
    }
    if (fontCache) return fontCache;
    try {
      var majalla = await Promise.all([fetchBase64('fonts/majalla.ttf'), fetchBase64('fonts/majallab.ttf').catch(function () { return null; })]);
      fontCache = { name: 'Sakkal Majalla', regular: majalla[0], bold: majalla[1] || majalla[0], scale: 1.3, fullCoverage: true };
    } catch (e) {
      var noto = await Promise.all([fetchBase64('fonts/NotoSansArabic-Regular.ttf'), fetchBase64('fonts/NotoSansArabic-Bold.ttf')]);
      fontCache = { name: 'Noto Sans Arabic', regular: noto[0], bold: noto[1], scale: 1, fullCoverage: false };
    }
    return fontCache;
  }

  // Saves a font picked by the user (regular and optional bold, as ArrayBuffers).
  function saveStoredFont(regularBuffer, boldBuffer, fileName) {
    var value = { regular: toBase64(regularBuffer), bold: boldBuffer ? toBase64(boldBuffer) : null, fileName: fileName || '', savedAt: new Date().toISOString() };
    localStorage.setItem(STORED_FONT_KEY, JSON.stringify(value));
  }
  function clearStoredFont() {
    try { localStorage.removeItem(STORED_FONT_KEY); } catch (e) { /* ignore */ }
  }
  async function activeFontName() {
    try { return (await loadFonts()).name; } catch (e) { return 'Noto Sans Arabic'; }
  }

  // ---------- text layout ----------
  // Sakkal Majalla runs small, so it is drawn larger; it also covers Latin and symbols.
  var fontScale = 1;
  var fullCoverage = false;
  // Characters Noto Sans Arabic can draw. Anything else (Latin letters, %, brackets)
  // falls back to Helvetica for that word.
  var ARABIC_FONT_OK = /^[؀-ۿﭐ-﷿ﹰ-﻿0-9.,:\-٪]*$/;
  var HAS_ARABIC = /[؀-ۿ]/;

  function setSize(doc, size) {
    doc.setFontSize(size * fontScale);
  }

  function setFont(doc, word, bold) {
    if (fullCoverage || ARABIC_FONT_OK.test(word)) doc.setFont('ReportFont', bold ? 'bold' : 'normal');
    else doc.setFont('helvetica', bold ? 'bold' : 'normal');
  }

  function wordWidth(doc, word, bold) {
    setFont(doc, word, bold);
    var shaped = HAS_ARABIC.test(word) ? doc.processArabic(word) : word;
    return doc.getStringUnitWidth(shaped) * doc.getFontSize() / doc.internal.scaleFactor;
  }

  // Brackets would need mirroring inside Arabic text; they are replaced by spaces.
  function clean(text) {
    return String(text == null ? '' : text).replace(/[()[\]{}<>]/g, ' ');
  }

  function lineWidth(doc, text, bold, size) {
    if (size) setSize(doc, size);
    var words = clean(text).split(/\s+/).filter(Boolean);
    var space = wordWidth(doc, ' ', bold);
    return words.reduce(function (w, word) { return w + wordWidth(doc, word, bold); }, 0) + space * Math.max(0, words.length - 1);
  }

  // Draws text right-to-left with its right edge at xRight.
  function rtl(doc, text, xRight, y, opts) {
    var o = opts || {};
    setSize(doc, o.size || 10.5);
    doc.setTextColor.apply(doc, o.color || COLOR.ink);
    var words = clean(text).split(/\s+/).filter(Boolean);
    var space = wordWidth(doc, ' ', o.bold);
    var x = xRight;
    if (o.align === 'center' && o.width) x = xRight - (o.width - lineWidth(doc, text, o.bold)) / 2;
    if (o.align === 'left' && o.width) x = xRight - o.width + lineWidth(doc, text, o.bold);
    words.forEach(function (word) {
      var w = wordWidth(doc, word, o.bold);
      setFont(doc, word, o.bold);
      doc.text(word, x - w, y);
      x -= w + space;
    });
  }

  // ---------- tables ----------
  // columns: [{ title, width, align }], first column is the right-most one.
  function tableHeader(doc, columns, y) {
    var h = 8.5;
    doc.setFillColor.apply(doc, COLOR.head);
    doc.rect(MARGIN, y, CONTENT_W, h, 'F');
    var x = RIGHT;
    columns.forEach(function (col) {
      rtl(doc, col.title, x - 3, y + 5.8, { size: 9.5, bold: true, color: COLOR.white, align: col.align, width: col.width - 6 });
      x -= col.width;
    });
    return y + h;
  }

  function drawTable(doc, state, columns, rows) {
    var rowH = 8;
    state.y = ensureSpace(doc, state, rowH * 2, columns);
    state.y = tableHeader(doc, columns, state.y);
    rows.forEach(function (row, index) {
      if (state.y + rowH > BOTTOM) {
        newPage(doc, state);
        state.y = tableHeader(doc, columns, state.y);
      }
      var y = state.y;
      if (row.group) {
        doc.setFillColor.apply(doc, COLOR.group);
        doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
        rtl(doc, row.group, RIGHT - 3, y + 5.5, { size: 10, bold: true, color: COLOR.head });
      } else {
        var fill = row.total ? COLOR.total : (index % 2 ? COLOR.zebra : COLOR.white);
        doc.setFillColor.apply(doc, fill);
        doc.rect(MARGIN, y, CONTENT_W, rowH, 'F');
        var x = RIGHT;
        columns.forEach(function (col, i) {
          var cell = row.cells[i];
          var value = cell && typeof cell === 'object' ? cell.text : cell;
          var tone = cell && typeof cell === 'object' ? cell.tone : null;
          var color = tone === 'neg' ? COLOR.red : tone === 'pos' ? COLOR.green : (i === 0 && !row.total ? COLOR.muted : COLOR.ink);
          rtl(doc, value, x - 3, y + 5.5, { size: 10, bold: row.total || i > 0, color: color, align: col.align, width: col.width - 6 });
          x -= col.width;
        });
      }
      doc.setDrawColor.apply(doc, COLOR.line);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y + rowH, RIGHT, y + rowH);
      state.y += rowH;
    });
    doc.setDrawColor.apply(doc, COLOR.line);
    state.y += 4;
  }

  function newPage(doc, state) {
    doc.addPage();
    state.y = MARGIN + 4;
  }

  function ensureSpace(doc, state, needed) {
    if (state.y + needed > BOTTOM) newPage(doc, state);
    return state.y;
  }

  function sectionTitle(doc, state, text) {
    ensureSpace(doc, state, 24);
    doc.setFillColor.apply(doc, COLOR.red);
    doc.rect(RIGHT - 1.4, state.y, 1.4, 7, 'F');
    rtl(doc, text, RIGHT - 4, state.y + 5.3, { size: 13, bold: true });
    state.y += 11;
  }

  // ---------- formatting ----------
  function num(n) {
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(n) {
    return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '٪';
  }
  function dateParts(iso) {
    var d = new Date(iso);
    var pad = function (v) { return String(v).padStart(2, '0'); };
    return {
      date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      time: pad(d.getHours()) + ':' + pad(d.getMinutes()),
    };
  }

  // ---------- report ----------
  async function createReportPdf(report) {
    if (!window.jspdf) throw new Error('مكتبة PDF غير محمّلة.');
    var fonts = await loadFonts();
    var r = report.result;
    var n = report.names;
    var rates = r.rates;
    var when = dateParts(report.createdAt || new Date().toISOString());

    var doc = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    doc.addFileToVFS('report-regular.ttf', fonts.regular);
    doc.addFileToVFS('report-bold.ttf', fonts.bold);
    doc.addFont('report-regular.ttf', 'ReportFont', 'normal');
    doc.addFont('report-bold.ttf', 'ReportFont', 'bold');
    doc.setProperties({ title: 'تقرير عملية حساب', creator: 'حاسبة سجلان' });
    fontScale = fonts.scale || 1;
    fullCoverage = Boolean(fonts.fullCoverage);

    var state = { y: MARGIN };

    // Header
    rtl(doc, 'تقرير عملية حساب', RIGHT, state.y + 8, { size: 20, bold: true });
    rtl(doc, 'حاسبة سجلان - توزيع الحصص', RIGHT, state.y + 15, { size: 10, color: COLOR.muted });
    doc.setFont('ReportFont', 'normal');
    setSize(doc, 10);
    doc.setTextColor.apply(doc, COLOR.muted);
    doc.text(when.date + '   ' + when.time, MARGIN, state.y + 8);
    if (report.note) {
      var noteWidth = Math.min(lineWidth(doc, report.note, true, 10), CONTENT_W / 2);
      rtl(doc, report.note, MARGIN + noteWidth, state.y + 15, { size: 10, bold: true });
    }
    state.y += 20;
    doc.setFillColor.apply(doc, COLOR.red);
    doc.rect(MARGIN, state.y, CONTENT_W, 0.9, 'F');
    state.y += 6;

    // Amount to transfer
    doc.setFillColor.apply(doc, COLOR.red);
    doc.roundedRect(MARGIN, state.y, CONTENT_W, 18, 3, 3, 'F');
    rtl(doc, 'المبلغ المستحق للتحويل', RIGHT - 6, state.y + 11, { size: 12, bold: true, color: COLOR.white });
    var amountText = num(r.transfer) + ' ريال';
    rtl(doc, amountText, MARGIN + 6 + lineWidth(doc, amountText, true, 17), state.y + 11.5, { size: 17, bold: true, color: COLOR.white });
    state.y += 26;

    // Summary
    sectionTitle(doc, state, 'الملخص');
    drawTable(doc, state, [
      { title: 'البيان', width: CONTENT_W - 60 },
      { title: 'المبلغ ريال', width: 60 },
    ], [
      { cells: ['إجمالي المدخلات', num(r.total)] },
      { cells: ['مبلغ ' + n.nameA, num(r.a)] },
      { cells: ['مبلغ ' + n.nameB, num(r.b)] },
      { cells: ['مجموع الاستقطاعات - صندوق النسب', num(r.pool)] },
      { cells: ['مجموع العمولات البنكية', num(r.commTotal)] },
      { cells: ['حصة ' + n.nameD, num(r.asim)] },
      { cells: ['حصة ' + n.nameC, r.applyC ? num(r.shareC) : 'غير مفعّلة'] },
      { cells: ['صافي ' + n.nameA, { text: num(r.finalA), tone: 'pos' }] },
      { cells: ['صافي ' + n.nameB, { text: num(r.finalB), tone: 'pos' }] },
      { total: true, cells: ['المبلغ المستحق للتحويل', num(r.transfer)] },
    ]);

    // Step by step
    sectionTitle(doc, state, 'تسلسل العملية');
    var stepRows = [
      { group: '1 - المدخلات' },
      { cells: ['مبلغ ' + n.nameA, '', '', num(r.a)] },
      { cells: ['مبلغ ' + n.nameB, '', '', num(r.b)] },
      { total: true, cells: ['الإجمالي', '', '', num(r.total)] },

      { group: '2 - استقطاع النسب إلى صندوق الشراكة' },
      { cells: ['استقطاع من ' + n.nameA, num(r.a), pct(rates.pctA), { text: num(r.discA), tone: 'neg' }] },
      { cells: ['استقطاع من ' + n.nameB, num(r.b), pct(rates.pctB), { text: num(r.discB), tone: 'neg' }] },
      { total: true, cells: ['مجموع الصندوق', '', '', num(r.pool)] },

      { group: '3 - حصة ' + n.nameC },
    ];
    if (r.applyC) {
      stepRows.push(
        { cells: ['تُخصم من الصندوق', num(r.pool), '', { text: num(r.shareC), tone: 'neg' }] },
        { total: true, cells: ['المتبقي في الصندوق', '', '', num(r.poolAfterC)] }
      );
    } else {
      stepRows.push({ cells: ['غير مفعّلة في هذه العملية', '', '', num(0)] });
    }
    stepRows.push(
      { group: '4 - توزيع الصندوق مناصفة' },
      { cells: ['نصيب ' + n.nameA, num(r.poolAfterC), pct(50), { text: num(r.halfA), tone: 'pos' }] },
      { cells: ['نصيب ' + n.nameD, num(r.poolAfterC), pct(50), num(r.asim)] },

      { group: '5 - العمولة البنكية' },
      { cells: ['عمولة ' + n.nameA + ' بعد الاستقطاع', num(r.remainingA), pct(rates.comm), { text: num(r.commA), tone: 'neg' }] },
      { cells: ['عمولة ' + n.nameB + ' بعد الاستقطاع', num(r.remainingB), pct(rates.comm), { text: num(r.commB), tone: 'neg' }] },
      { total: true, cells: ['مجموع العمولات', '', '', num(r.commTotal)] },

      { group: '6 - الصافي والمستحق للتحويل' },
      { cells: ['صافي ' + n.nameA + ' = بعد الاستقطاع + نصيبه - العمولة', '', '', { text: num(r.finalA), tone: 'pos' }] },
      { cells: ['صافي ' + n.nameB + ' = بعد الاستقطاع - العمولة', '', '', { text: num(r.finalB), tone: 'pos' }] },
      { total: true, cells: ['المبلغ المستحق للتحويل', '', '', num(r.transfer)] }
    );
    drawTable(doc, state, [
      { title: 'البيان', width: CONTENT_W - 98 },
      { title: 'الأساس ريال', width: 36 },
      { title: 'النسبة', width: 24, align: 'center' },
      { title: 'المبلغ ريال', width: 38 },
    ], stepRows);

    // Balance check: every riyal entered is accounted for.
    var distributed = Math.round((r.finalA + r.finalB + r.asim + r.shareC + r.commTotal) * 100) / 100;
    var balanced = Math.abs(distributed - r.total) < 0.01;
    sectionTitle(doc, state, 'التحقق من التوازن');
    drawTable(doc, state, [
      { title: 'البيان', width: CONTENT_W - 60 },
      { title: 'المبلغ ريال', width: 60 },
    ], [
      { cells: ['صافي ' + n.nameA + ' + صافي ' + n.nameB, num(r.finalA + r.finalB)] },
      { cells: ['حصة ' + n.nameD + ' + حصة ' + n.nameC, num(r.asim + r.shareC)] },
      { cells: ['العمولات البنكية', num(r.commTotal)] },
      { total: true, cells: ['المجموع - يساوي إجمالي المدخلات', { text: num(distributed), tone: balanced ? 'pos' : 'neg' }] },
      { cells: ['النتيجة', { text: balanced ? 'مطابق' : 'غير مطابق', tone: balanced ? 'pos' : 'neg' }] },
    ]);

    // Rates used
    ensureSpace(doc, state, 10);
    rtl(doc, 'النسب المستخدمة - استقطاع ' + n.nameA + ' ' + pct(rates.pctA) + ' - استقطاع ' + n.nameB + ' ' + pct(rates.pctB) +
      ' - العمولة البنكية ' + pct(rates.comm) + ' - حصة ' + n.nameC + ' ' + num(rates.amountC) + ' ريال', RIGHT, state.y + 4, { size: 9, color: COLOR.muted });

    // Footer on every page
    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor.apply(doc, COLOR.line);
      doc.line(MARGIN, PAGE_H - 12, RIGHT, PAGE_H - 12);
      rtl(doc, 'حاسبة سجلان', RIGHT, PAGE_H - 7, { size: 8.5, color: COLOR.muted });
      rtl(doc, 'صفحة ' + p + ' من ' + pages, MARGIN + lineWidth(doc, 'صفحة ' + p + ' من ' + pages, false, 8.5), PAGE_H - 7, { size: 8.5, color: COLOR.muted });
    }

    return doc.output('blob');
  }

  function download(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // Share the PDF with the phone's share sheet (WhatsApp, Telegram...).
  // Returns 'shared', 'cancelled' or 'unsupported'.
  async function share(blob, fileName, title, text) {
    var file = new File([blob], fileName, { type: 'application/pdf' });
    if (!navigator.canShare || !navigator.canShare({ files: [file] })) return 'unsupported';
    try {
      await navigator.share({ files: [file], title: title, text: text });
      return 'shared';
    } catch (error) {
      return error && error.name === 'AbortError' ? 'cancelled' : 'unsupported';
    }
  }

  window.SijilanPdf = {
    createReportPdf: createReportPdf,
    download: download,
    share: share,
    saveStoredFont: saveStoredFont,
    clearStoredFont: clearStoredFont,
    activeFontName: activeFontName,
    hasStoredFont: function () { return Boolean(readStoredFont()); },
  };
})();
