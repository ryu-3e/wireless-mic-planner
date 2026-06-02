// =============================================================
// 周波数軸 可視化 (SVG ベースのバーチャート)
//   B帯 806.000〜810.000 MHz をスケールにとり、各送信機の割当を縦バーで表示
//   IMD/collision/adjacent の警告がある周波数は色分け
// =============================================================

(function (global) {
  'use strict';

  const D = global.WMP_DATA;
  const IMD = global.WMP_IMD;

  // 描画範囲の余白を含めた表示帯域 (MHz)
  const VIS_MIN = 806.000;
  const VIS_MAX = 810.000;

  function render(svg, assignments, options) {
    options = options || {};
    const showAllChs = options.showAllChs !== false;
    const issues = IMD.analyze(assignments, options);

    const W = svg.viewBox.baseVal.width || 800;
    const H = svg.viewBox.baseVal.height || 300;
    const padL = 36, padR = 16, padT = 18, padB = 36;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    function xOf(f) {
      return padL + ((f - VIS_MIN) / (VIS_MAX - VIS_MIN)) * plotW;
    }

    // クリア
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // 背景
    const bg = svgEl('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: '#0f172a', rx: 6 });
    svg.appendChild(bg);

    // X軸目盛
    for (let f = 806.0; f <= 810.0 + 1e-6; f += 0.5) {
      const x = xOf(f);
      const tick = svgEl('line', { x1: x, x2: x, y1: padT + plotH, y2: padT + plotH + 4, stroke: '#64748b' });
      svg.appendChild(tick);
      const label = svgEl('text', { x: x, y: padT + plotH + 18, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': 11 });
      label.textContent = f.toFixed(2);
      svg.appendChild(label);
    }
    const xAxisLabel = svgEl('text', { x: W - padR, y: H - 4, 'text-anchor': 'end', fill: '#64748b', 'font-size': 10 });
    xAxisLabel.textContent = 'MHz';
    svg.appendChild(xAxisLabel);

    // 全30chの薄いマーカー
    if (showAllChs) {
      D.CHANNELS.forEach((c) => {
        const x = xOf(c.freq);
        const line = svgEl('line', {
          x1: x, x2: x, y1: padT + plotH - 6, y2: padT + plotH,
          stroke: '#475569', 'stroke-width': 1
        });
        svg.appendChild(line);
      });
    }

    // 警告の被害 id 集合
    const errorIds = new Set();
    const warnIds = new Set();
    issues.forEach((iss) => {
      iss.victims.forEach((v) => {
        if (iss.severity === 'error') errorIds.add(v);
        else warnIds.add(v);
      });
    });

    // 割当バー
    const list = assignments.filter((a) => typeof a.freq === 'number');
    list.sort((a, b) => a.freq - b.freq);

    list.forEach((a, idx) => {
      const x = xOf(a.freq);
      const isErr = errorIds.has(a.id);
      const isWarn = warnIds.has(a.id);
      const isBlocked = !!a._blocked;
      const okColor = isBlocked ? '#64748b' : (a.mode === 'digital' ? '#a78bfa' : '#22d3ee');
      const color = isErr ? '#ef4444' : isWarn ? '#f59e0b' : okColor;

      // 占有帯域幅を半透明矩形で表示
      const w = a.occupiedWidth || (a.mode === 'digital' ? 0.192 : 0.110);
      const halfX = (w / (VIS_MAX - VIS_MIN)) * plotW / 2;
      const barTop = padT + 8;
      const barBottom = padT + plotH - 2;
      const widthRect = svgEl('rect', {
        x: x - halfX, y: barTop, width: halfX * 2, height: barBottom - barTop,
        fill: color, 'fill-opacity': 0.18, rx: 2
      });
      svg.appendChild(widthRect);

      // 中心線
      const bar = svgEl('line', {
        x1: x, x2: x, y1: barTop, y2: barBottom,
        stroke: color, 'stroke-width': 2.5
      });
      svg.appendChild(bar);

      // 上端の丸
      const dot = svgEl('circle', { cx: x, cy: barTop, r: 4, fill: color });
      svg.appendChild(dot);

      // ラベル（互い違いに上下）
      const labelY = idx % 2 === 0 ? padT + 4 : padT + plotH - 24;
      const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
      const modeMark = isBlocked ? '✕' : (a.mode === 'digital' ? '⬢' : '○');
      // SVGはスペース制約があるため短縮版 (BF1 / B11) を使用
      const lbl = ch ? D.labelShort(ch, a.mode) : a.freq.toFixed(3);
      const labelText = modeMark + ' ' + lbl + ' / ' + a.name;
      const label = svgEl('text', {
        x: x + 5, y: labelY + 12, fill: '#e2e8f0', 'font-size': 10
      });
      label.textContent = labelText;
      svg.appendChild(label);
    });

    return issues;
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  global.WMP_VIS = { render };
})(typeof window !== 'undefined' ? window : globalThis);
