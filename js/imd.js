// =============================================================
// IMD (相互変調歪) 検出エンジン
//   3次相互変調 (3rd-order intermodulation) のみを対象
//     2-tone : 2*f1 - f2  (および 2*f2 - f1)
//     3-tone : f1 + f2 - f3 (符号違いの順列を含む)
//   検出範囲: B帯内 (806.125〜809.750 MHz) かつ既存割当周波数の近傍
//   近傍判定: ±tolerance MHz (デフォルト 0.025 MHz = 25 kHz)
//
// 同時に以下のチェックも行う:
//   - 同一周波数の重複 (collision)
//   - 隣接周波数 (≤ adjacentLimit MHz、デフォルト 0.250 MHz) の警告
// =============================================================

(function (global) {
  'use strict';

  const D = global.WMP_DATA;

  function nearlyEqual(a, b, tol) {
    return Math.abs(a - b) <= tol + 1e-9;
  }

  function inBand(f) {
    return f >= D.BAND_MIN - 1e-9 && f <= D.BAND_MAX + 1e-9;
  }

  // 周波数のリスト [{ id, name, freq, mode? }] を受け取り、警告のリストを返す
  // mode: 'analog' | 'digital' (省略時は 'analog')
  // 戻り値: [{ severity: 'error'|'warn', kind, message, victims: [id...] }]
  function analyze(assignments, options) {
    options = options || {};
    const imdTolerance = options.imdTolerance != null ? options.imdTolerance : 0.025; // 25 kHz
    const adjacentLimit = options.adjacentLimit != null ? options.adjacentLimit : 0.250; // 250 kHz
    const issues = [];

    // 周波数が割り当てられているもののみ
    const list = assignments.filter((a) => typeof a.freq === 'number' && !isNaN(a.freq));

    // 1) 同一周波数 (collision)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (Math.abs(list[i].freq - list[j].freq) < 1e-6) {
          issues.push({
            severity: 'error',
            kind: 'collision',
            message: `${list[i].name} と ${list[j].name} が同一周波数 (${list[i].freq.toFixed(3)} MHz)`,
            victims: [list[i].id, list[j].id]
          });
        }
      }
    }

    // 2) 隣接周波数チェック
    //    - モード別の推奨最小間隔 (デジタル↔デジタル=375kHz, それ以外=250kHz)
    //    - さらに「占有帯域幅の重なり」(stronger error) も検出
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const diff = Math.abs(list[i].freq - list[j].freq);
        if (diff < 1e-6) continue;
        const a = list[i], b = list[j];
        const recMin = D && D.minSpacing ? D.minSpacing(a.mode, b.mode) : adjacentLimit;
        const wA = a.occupiedWidth || (a.mode === 'digital' ? 0.192 : 0.110);
        const wB = b.occupiedWidth || (b.mode === 'digital' ? 0.192 : 0.110);
        const spectralOverlap = (wA + wB) / 2; // 中心間隔がこれ以下だとスペクトル重なり

        if (diff < spectralOverlap - 1e-9) {
          issues.push({
            severity: 'error',
            kind: 'spectrum-overlap',
            message: `${a.name}(${a.mode === 'digital' ? 'デジタル' : 'アナログ'}, ${a.freq.toFixed(3)}) と ${b.name}(${b.mode === 'digital' ? 'デジタル' : 'アナログ'}, ${b.freq.toFixed(3)}) は占有帯域 (${(spectralOverlap*1000).toFixed(0)} kHz) より近接 — 確実に干渉`,
            victims: [a.id, b.id]
          });
        } else if (diff < recMin - 1e-9) {
          const isDigPair = a.mode === 'digital' && b.mode === 'digital';
          issues.push({
            severity: 'warn',
            kind: isDigPair ? 'adjacent-digital' : 'adjacent',
            message: `${a.name}(${a.freq.toFixed(3)}) と ${b.name}(${b.freq.toFixed(3)}) は ${(diff*1000).toFixed(0)} kHz / 推奨最小 ${(recMin*1000).toFixed(0)} kHz`,
            victims: [a.id, b.id]
          });
        }
      }
    }

    // 3) 3次 IMD (2-tone): 2*f1 - f2
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const imd = 2 * list[i].freq - list[j].freq;
        if (!inBand(imd)) continue;
        // この imd 周波数が他の被害者(victim)割当と一致するか
        for (let k = 0; k < list.length; k++) {
          if (k === i || k === j) continue;
          if (nearlyEqual(imd, list[k].freq, imdTolerance)) {
            issues.push({
              severity: 'error',
              kind: 'imd3-2tone',
              message: `IMD3次(2波): 2×${list[i].name}(${list[i].freq.toFixed(3)}) − ${list[j].name}(${list[j].freq.toFixed(3)}) = ${imd.toFixed(3)} MHz が ${list[k].name}(${list[k].freq.toFixed(3)}) に干渉`,
              victims: [list[i].id, list[j].id, list[k].id]
            });
          }
        }
      }
    }

    // 4) 3次 IMD (3-tone): f1 + f2 - f3
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        for (let k = 0; k < list.length; k++) {
          if (k === i || k === j) continue;
          const imd = list[i].freq + list[j].freq - list[k].freq;
          if (!inBand(imd)) continue;
          for (let m = 0; m < list.length; m++) {
            if (m === i || m === j || m === k) continue;
            if (nearlyEqual(imd, list[m].freq, imdTolerance)) {
              issues.push({
                severity: 'warn',
                kind: 'imd3-3tone',
                message: `IMD3次(3波): ${list[i].name}+${list[j].name}−${list[k].name} = ${imd.toFixed(3)} MHz が ${list[m].name}(${list[m].freq.toFixed(3)}) に干渉`,
                victims: [list[i].id, list[j].id, list[k].id, list[m].id]
              });
            }
          }
        }
      }
    }

    return dedup(issues);
  }

  // 同等の警告を重複排除（被害者集合とkindで判定）
  function dedup(issues) {
    const seen = new Set();
    const out = [];
    for (const it of issues) {
      const key = it.kind + '|' + [...it.victims].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
    return out;
  }

  // 候補周波数 candidate を、既存 list に追加した場合に新たな問題が発生するか
  // 高速版: list が既にクリーンであることを前提に、candidate を含む新規 issue のみを直接判定
  // 戻り値: 発生した問題リスト（空なら安全）
  function probe(list, candidate, options) {
    options = options || {};
    const tol = options.imdTolerance != null ? options.imdTolerance : 0.025;
    const adj = options.adjacentLimit != null ? options.adjacentLimit : 0.250;
    const issues = [];
    const cf = candidate.freq;

    // 1) collision / spectrum-overlap / adjacent: candidate vs base
    const candWidth = candidate.occupiedWidth || (candidate.mode === 'digital' ? 0.192 : 0.110);
    for (let i = 0; i < list.length; i++) {
      const diff = Math.abs(list[i].freq - cf);
      if (diff < 1e-6) {
        issues.push({ severity: 'error', kind: 'collision', message: 'collision', victims: [list[i].id, candidate.id] });
        return issues;
      }
      const baseWidth = list[i].occupiedWidth || (list[i].mode === 'digital' ? 0.192 : 0.110);
      const overlap = (candWidth + baseWidth) / 2;
      if (diff < overlap - 1e-9) {
        issues.push({ severity: 'error', kind: 'spectrum-overlap', message: 'spectrum-overlap', victims: [list[i].id, candidate.id] });
        return issues;
      }
      const recMin = D && D.minSpacing ? D.minSpacing(candidate.mode, list[i].mode) : adj;
      if (diff < recMin - 1e-9) {
        issues.push({ severity: 'warn', kind: 'adjacent', message: 'adjacent', victims: [list[i].id, candidate.id] });
        return issues;
      }
    }

    // 2) IMD3 2-tone を含むパターン
    //    (a) 2*candidate - b ≈ c  (b,c in list)
    //    (b) 2*b - candidate ≈ c  (b,c in list)
    //    (c) 2*b - c ≈ candidate  (b,c in list)
    for (let i = 0; i < list.length; i++) {
      const fi = list[i].freq;
      // (a)
      const aImd = 2 * cf - fi;
      if (inBand(aImd)) {
        for (let k = 0; k < list.length; k++) {
          if (k === i) continue;
          if (nearlyEqual(aImd, list[k].freq, tol)) {
            issues.push({ severity: 'error', kind: 'imd3-2tone', message: 'imd3-2tone', victims: [candidate.id, list[i].id, list[k].id] });
            return issues;
          }
        }
      }
      // (b)
      const bImd = 2 * fi - cf;
      if (inBand(bImd)) {
        for (let k = 0; k < list.length; k++) {
          if (k === i) continue;
          if (nearlyEqual(bImd, list[k].freq, tol)) {
            issues.push({ severity: 'error', kind: 'imd3-2tone', message: 'imd3-2tone', victims: [list[i].id, candidate.id, list[k].id] });
            return issues;
          }
        }
      }
      // (c)
      for (let j = 0; j < list.length; j++) {
        if (j === i) continue;
        const cImd = 2 * fi - list[j].freq;
        if (!inBand(cImd)) continue;
        if (nearlyEqual(cImd, cf, tol)) {
          issues.push({ severity: 'error', kind: 'imd3-2tone', message: 'imd3-2tone', victims: [list[i].id, list[j].id, candidate.id] });
          return issues;
        }
      }
    }

    // 3) IMD3 3-tone を含むパターン (candidate を含む組合せのみ)
    //    候補 cf と base 2要素の組合せで生成される f1+f2-f3 が他の周波数 (base or cand) に当たるか
    //    パターン:
    //      (a) cf + b - c  ≈ d  (b,c,d in list, distinct)
    //      (b) b  + c - cf ≈ d  (b,c,d in list, distinct)
    //      (c) b  + c - d  ≈ cf (b,c,d in list, distinct)
    //      (d) cf + b - d  ≈ c  --- (a) と同一 (対称)
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const fi = list[i].freq, fj = list[j].freq;
        // (a) cf + fi - fj
        let v = cf + fi - fj;
        if (inBand(v)) {
          for (let k = 0; k < list.length; k++) {
            if (k === i || k === j) continue;
            if (nearlyEqual(v, list[k].freq, tol)) {
              issues.push({ severity: 'warn', kind: 'imd3-3tone', message: 'imd3-3tone', victims: [candidate.id, list[i].id, list[j].id, list[k].id] });
              return issues;
            }
          }
        }
        // (a') cf + fj - fi
        v = cf + fj - fi;
        if (inBand(v)) {
          for (let k = 0; k < list.length; k++) {
            if (k === i || k === j) continue;
            if (nearlyEqual(v, list[k].freq, tol)) {
              issues.push({ severity: 'warn', kind: 'imd3-3tone', message: 'imd3-3tone', victims: [candidate.id, list[i].id, list[j].id, list[k].id] });
              return issues;
            }
          }
        }
        // (b) fi + fj - cf
        v = fi + fj - cf;
        if (inBand(v)) {
          for (let k = 0; k < list.length; k++) {
            if (k === i || k === j) continue;
            if (nearlyEqual(v, list[k].freq, tol)) {
              issues.push({ severity: 'warn', kind: 'imd3-3tone', message: 'imd3-3tone', victims: [candidate.id, list[i].id, list[j].id, list[k].id] });
              return issues;
            }
          }
        }
        // (c) fi + fj - fk ≈ cf
        for (let k = 0; k < list.length; k++) {
          if (k === i || k === j) continue;
          v = fi + fj - list[k].freq;
          if (!inBand(v)) continue;
          if (nearlyEqual(v, cf, tol)) {
            issues.push({ severity: 'warn', kind: 'imd3-3tone', message: 'imd3-3tone', victims: [candidate.id, list[i].id, list[j].id, list[k].id] });
            return issues;
          }
        }
      }
    }

    return issues;
  }

  global.WMP_IMD = {
    analyze,
    probe
  };
})(typeof window !== 'undefined' ? window : globalThis);
