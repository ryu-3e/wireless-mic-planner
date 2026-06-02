// =============================================================
// 自動チャンネル割当
//   要件: 送信機(TX)に対して、混信しないチャンネルを提案する
//   戦略:
//     1) 既存固定割当(ロック)を尊重
//     2) 6波以下なら同一グループ(B-1〜B-6, B-7) のうち余裕のあるものを選ぶ
//     3) 7波の場合は B-7 グループを優先
//     4) それでも収まらない/IMD警告が残る場合は、グループ枠を超えて
//        IMD/隣接チェックを通る組合せを Greedy + バックトラックで探索
// =============================================================

(function (global) {
  'use strict';

  const D = global.WMP_DATA;
  const IMD = global.WMP_IMD;

  // 計算量が爆発する構成 (例: 多波 + 厳しい固定) で UI がフリーズしないよう
  // バックトラックの探索ノード上限を設ける。超えたら諦めて次戦略へ落とす。
  const MAX_ITER_PER_PHASE = 200000;
  let _iterCount = 0;

  // tx: [{ id, name, freq?(固定なら値), locked?: bool }]
  // 戻り値: { success, assignments: [{id, name, freq}], usedGroup: string|null, issues: [...] }
  function autoAssign(transmitters, options) {
    options = options || {};
    const tolerance = options.imdTolerance != null ? options.imdTolerance : 0.025;
    const adjacentLimit = options.adjacentLimit != null ? options.adjacentLimit : 0.250;
    const opts = { imdTolerance: tolerance, adjacentLimit };

    const fixed = transmitters.filter((t) => t.locked && typeof t.freq === 'number');
    // 制約の厳しい順 (digital → analog) に並べ替えて探索効率を上げる
    const free = transmitters.filter((t) => !(t.locked && typeof t.freq === 'number'))
      .slice()
      .sort((a, b) => {
        const ord = (m) => (m === 'digital' ? 0 : 1);
        return ord(a.mode) - ord(b.mode);
      });

    const need = free.length;
    if (need === 0) {
      return { success: true, assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })), usedGroup: null, issues: IMD.analyze(fixed, opts) };
    }

    const allAnalog = transmitters.every((t) => (t.mode || 'analog') === 'analog');
    const allDigital = transmitters.every((t) => t.mode === 'digital');

    // ----- 戦略 A1: 単一グループでまかなう (アナログ専用 / B-1〜B-8) -----
    // B-1〜B-4 (各6波) を最優先 → 5波運用なら B-5 → 7波運用なら B-7 か B-8 → 最後に B-6 (1波)
    const analogGroupOrder = ['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-7', 'B-8', 'B-6'];
    if (allAnalog) for (const g of analogGroupOrder) {
      const groupChs = D.channelsInGroup(g);
      if (groupChs.length < need) continue;
      const usableChs = groupChs.filter((c) => !fixed.some((f) => Math.abs(f.freq - c.freq) < 1e-6));
      if (usableChs.length < need) continue;
      const result = tryAssignFromList(free, usableChs, fixed, opts);
      if (result) {
        return {
          success: true,
          assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })).concat(result),
          usedGroup: g,
          issues: IMD.analyze(fixed.concat(result), opts)
        };
      }
    }

    // ----- 戦略 A2: 単一グループでまかなう (RAMSAデジタル専用 / 31, 32, 33) -----
    // 各グループは 10波・375kHz等間隔。デジタル運用はこの中で完結させるのが推奨。
    const digitalGroupOrder = ['31', '32', '33'];
    if (allDigital) for (const g of digitalGroupOrder) {
      const groupChs = D.channelsInGroup(g);
      if (groupChs.length < need) continue;
      const usableChs = groupChs.filter((c) => !fixed.some((f) => Math.abs(f.freq - c.freq) < 1e-6));
      if (usableChs.length < need) continue;
      const result = tryAssignFromList(free, usableChs, fixed, opts);
      if (result) {
        return {
          success: true,
          assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })).concat(result),
          usedGroup: g,
          issues: IMD.analyze(fixed.concat(result), opts)
        };
      }
    }

    // ----- 戦略 A3: 混在運用 (アナログをB-Nで、デジタルを31/32/33で同時に) -----
    // 各組合せを総当たりで試す。デジタルは1グループに10波まで、アナログは多くて7波。
    if (!allAnalog && !allDigital) {
      const anaTx = free.filter((t) => (t.mode || 'analog') === 'analog');
      const digTx = free.filter((t) => t.mode === 'digital');
      for (const ag of analogGroupOrder) {
        const aChs = D.channelsInGroup(ag).filter((c) => !fixed.some((f) => Math.abs(f.freq - c.freq) < 1e-6));
        if (aChs.length < anaTx.length) continue;
        for (const dg of digitalGroupOrder) {
          const dChs = D.channelsInGroup(dg).filter((c) => !fixed.some((f) => Math.abs(f.freq - c.freq) < 1e-6));
          if (dChs.length < digTx.length) continue;
          // 異なるグループのチャンネルを統合した候補集合で割当
          const merged = aChs.concat(dChs);
          const result = tryAssignFromList(free, merged, fixed, opts);
          if (result) {
            return {
              success: true,
              assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })).concat(result),
              usedGroup: ag + ' + ' + dg,
              issues: IMD.analyze(fixed.concat(result), opts)
            };
          }
        }
      }
    }

    // ----- 戦略 B: 全30波からバックトラック探索 (IMD回避) -----
    const allChs = D.CHANNELS.filter((c) => !fixed.some((f) => Math.abs(f.freq - c.freq) < 1e-6));
    const result = tryAssignFromList(free, allChs, fixed, opts);
    if (result) {
      return {
        success: true,
        assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })).concat(result),
        usedGroup: null,
        issues: IMD.analyze(fixed.concat(result), opts)
      };
    }

    // ----- 戦略 C: 失敗。IMD許容して collision/adjacent のみ回避 -----
    const relax = tryAssignRelaxed(free, allChs, fixed);
    if (relax) {
      return {
        success: false,
        assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })).concat(relax),
        usedGroup: null,
        issues: IMD.analyze(fixed.concat(relax), opts)
      };
    }

    return { success: false, assignments: fixed.map((t) => ({ id: t.id, name: t.name, freq: t.freq })), usedGroup: null, issues: [{ severity: 'error', kind: 'no-solution', message: '割当可能な組合せが見つかりません', victims: [] }] };
  }

  // 既存割当からの「最小距離」を計算 (バンド分散の指標)
  function minDistTo(freq, list) {
    if (list.length === 0) return Infinity;
    let m = Infinity;
    for (const l of list) {
      const d = Math.abs(l.freq - freq);
      if (d < m) m = d;
    }
    return m;
  }

  // バックトラック: free 各送信機にチャンネルを割当てる
  // チャンネル選択は「既存割当から最も遠い候補を先に試す (maxmin-distance)」順で行うことで
  // バンド全体に均等分散した解を優先的に発見する。
  function tryAssignFromList(free, channels, fixed, opts) {
    const used = new Set();
    const stack = []; // [{id,name,freq,mode,occupiedWidth}]
    _iterCount = 0;

    function backtrack(idx) {
      if (_iterCount++ > MAX_ITER_PER_PHASE) return false; // タイムアウト相当
      if (idx === free.length) return true;
      const existing = fixed.concat(stack);
      // 既存から遠い順 (同距離は周波数昇順で安定化)
      const candidates = channels.filter((c) => !used.has(c.n)).slice().sort((a, b) => {
        if (existing.length === 0) {
          // 初回はバンド中央 (808.0 MHz 付近) から試す
          return Math.abs(a.freq - 808.0) - Math.abs(b.freq - 808.0);
        }
        const da = minDistTo(a.freq, existing);
        const db = minDistTo(b.freq, existing);
        if (db !== da) return db - da; // 遠い順
        return a.freq - b.freq;
      });
      for (const ch of candidates) {
        const candidate = {
          id: free[idx].id,
          name: free[idx].name,
          freq: ch.freq,
          mode: free[idx].mode,
          occupiedWidth: free[idx].occupiedWidth
        };
        const issues = IMD.probe(existing, candidate, opts);
        if (issues.length > 0) continue;
        used.add(ch.n);
        stack.push(candidate);
        if (backtrack(idx + 1)) return true;
        stack.pop();
        used.delete(ch.n);
      }
      return false;
    }

    return backtrack(0) ? stack.slice() : null;
  }

  // collision/adjacent のみ回避（IMD許容）するゆるい割当
  // こちらも maxmin-distance 順で候補を試し、警告ありでも分散した結果を返す。
  function tryAssignRelaxed(free, channels, fixed) {
    const used = new Set();
    const stack = [];
    _iterCount = 0;
    function backtrack(idx) {
      if (_iterCount++ > MAX_ITER_PER_PHASE) return false;
      if (idx === free.length) return true;
      const existing = fixed.concat(stack);
      const candidates = channels.filter((c) => !used.has(c.n)).slice().sort((a, b) => {
        if (existing.length === 0) {
          return Math.abs(a.freq - 808.0) - Math.abs(b.freq - 808.0);
        }
        const da = minDistTo(a.freq, existing);
        const db = minDistTo(b.freq, existing);
        if (db !== da) return db - da;
        return a.freq - b.freq;
      });
      for (const ch of candidates) {
        const candidate = {
          id: free[idx].id,
          name: free[idx].name,
          freq: ch.freq,
          mode: free[idx].mode,
          occupiedWidth: free[idx].occupiedWidth
        };
        const candWidth = candidate.occupiedWidth || (candidate.mode === 'digital' ? 0.192 : 0.110);
        let bad = false;
        for (const b of existing) {
          const diff = Math.abs(b.freq - candidate.freq);
          const baseWidth = b.occupiedWidth || (b.mode === 'digital' ? 0.192 : 0.110);
          const overlap = (candWidth + baseWidth) / 2;
          // スペクトル重なりは絶対回避 (緩和モードでも)
          if (diff < overlap - 1e-9) { bad = true; break; }
        }
        if (bad) continue;
        used.add(ch.n);
        stack.push(candidate);
        if (backtrack(idx + 1)) return true;
        stack.pop();
        used.delete(ch.n);
      }
      return false;
    }
    return backtrack(0) ? stack.slice() : null;
  }

  global.WMP_AUTO = { autoAssign };
})(typeof window !== 'undefined' ? window : globalThis);
