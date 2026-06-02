// =============================================================
// CSV / PDF (印刷経由) エクスポート
// =============================================================

(function (global) {
  'use strict';

  const D = global.WMP_DATA;

  function toCSV(inventory, issues) {
    const rows = [];
    rows.push(['#', 'メーカー', 'モデル', '方式', '占有帯域(kHz)', '名称', 'CH番号', 'CHラベル', '周波数(MHz)', 'グループ']);
    // 送信機(TX)のみ出力
    inventory.filter((d) => d.type === 'TX').forEach((d, i) => {
      const ch = d.assignedCh ? D.getChannelByNumber(d.assignedCh) : null;
      const mode = d.mode || (D.MODELS[d.model] && D.MODELS[d.model].mode) || 'analog';
      const w = d.occupiedWidth || (D.MODELS[d.model] && D.MODELS[d.model].occupiedWidth) || (mode === 'digital' ? 0.192 : 0.110);
      rows.push([
        i + 1,
        d.maker || '',
        d.model || '',
        mode === 'digital' ? 'デジタル' : 'アナログ',
        Math.round(w * 1000),
        d.name || '',
        ch ? ch.n : '',
        ch ? D.labelOf(ch, mode) : '',
        ch ? ch.freq.toFixed(3) : '',
        ch ? D.groupsOf(ch, mode).join('/') : ''
      ]);
    });
    if (issues && issues.length) {
      rows.push([]);
      rows.push(['【警告/エラー】']);
      issues.forEach((iss) => {
        rows.push([iss.severity, iss.kind, iss.message]);
      });
    }
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    return '\uFEFF' + csv; // BOM 付きで Excel でも文字化けしない
  }

  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCSV(filename, inventory, issues) {
    const csv = toCSV(inventory, issues);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || ('ch-plan-' + dateStr() + '.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function dateStr() {
    const d = new Date();
    const z = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes());
  }

  // PDF: 印刷ダイアログ経由 (ユーザーが「PDFとして保存」を選択)
  // 専用の印刷向け HTML を一時的に生成して印刷
  function printPDF(inventory, issues) {
    const win = window.open('', '_blank');
    if (!win) {
      alert('ポップアップがブロックされました。ブラウザの設定で許可してください。');
      return;
    }
    const html = buildPrintHTML(inventory, issues);
    win.document.open();
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
      try { win.focus(); win.print(); } catch (e) {}
    }, 300);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function buildPrintHTML(inventory, issues) {
    // 送信機(TX)のみを対象とする
    const tx = inventory.filter((d) => d.type === 'TX');
    const now = new Date();
    const title = 'B帯 ワイヤレスマイク チャンネルプラン';
    const date = now.toLocaleString('ja-JP');

    function row(d, idx) {
      const ch = d.assignedCh ? D.getChannelByNumber(d.assignedCh) : null;
      const mode = d.mode || (D.MODELS[d.model] && D.MODELS[d.model].mode) || 'analog';
      const lbl = ch ? D.labelOf(ch, mode) : '-';
      const grps = ch ? D.groupsOf(ch, mode).join('/') : '-';
      return `<tr>
        <td>${idx + 1}</td>
        <td>${escapeHTML(d.maker)}</td>
        <td>${escapeHTML(d.model)}</td>
        <td>${mode === 'digital' ? 'デジタル' : 'アナログ'}</td>
        <td>${escapeHTML(d.name)}</td>
        <td>${ch ? ch.n : '-'}</td>
        <td>${lbl}</td>
        <td>${ch ? ch.freq.toFixed(3) : '-'}</td>
        <td>${grps}</td>
      </tr>`;
    }

    const txRows = tx.map(row).join('');

    const issueRows = (issues || []).map((iss) => `
      <tr class="iss-${iss.severity}">
        <td>${iss.severity === 'error' ? 'エラー' : '警告'}</td>
        <td>${escapeHTML(iss.kind)}</td>
        <td>${escapeHTML(iss.message)}</td>
      </tr>`).join('');

    return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>${escapeHTML(title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif; color: #111; }
    h1 { font-size: 18pt; margin: 0 0 6pt; }
    .meta { font-size: 10pt; color: #555; margin-bottom: 14pt; }
    h2 { font-size: 12pt; margin: 14pt 0 4pt; border-left: 4px solid #2563eb; padding-left: 6px; }
    table { border-collapse: collapse; width: 100%; font-size: 10pt; margin-bottom: 8pt; }
    th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
    th { background: #e5e7eb; }
    .iss-error td { background: #fee2e2; }
    .iss-warn td { background: #fef3c7; }
    .footer { font-size: 9pt; color: #666; margin-top: 16pt; }
  </style>
</head>
<body>
  <h1>${escapeHTML(title)}</h1>
  <div class="meta">出力日時: ${escapeHTML(date)}</div>

  <h2>送信機 割当</h2>
  <table>
    <thead><tr><th>#</th><th>メーカー</th><th>モデル</th><th>方式</th><th>名称</th><th>CH#</th><th>CH呼称</th><th>周波数(MHz)</th><th>グループ</th></tr></thead>
    <tbody>${txRows || '<tr><td colspan="9">なし</td></tr>'}</tbody>
  </table>

  ${issueRows ? `<h2>警告・エラー</h2>
  <table>
    <thead><tr><th>区分</th><th>種類</th><th>内容</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>` : ''}

  <div class="footer">B帯: 806.125〜809.750 MHz / 30波 / 125kHz間隔 — Wireless Mic Planner / アナログ呼称(B11等) ・ RAMSAデジタル呼称(BF1等/グループ31〜33)</div>
</body>
</html>`;
  }

  global.WMP_EXPORT = { downloadCSV, printPDF, toCSV };
})(typeof window !== 'undefined' ? window : globalThis);
