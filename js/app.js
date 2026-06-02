// =============================================================
// メインアプリ (SPA / View切替 / イベント結線)
// =============================================================

(function () {
  'use strict';

  const D = window.WMP_DATA;
  const IMD = window.WMP_IMD;
  const AUTO = window.WMP_AUTO;
  const VIS = window.WMP_VIS;
  const EXP = window.WMP_EXPORT;
  const ST = window.WMP_STORE;

  // 旧バージョンの保存データの正規化
  //   - 受信機(RX) は本アプリでは扱わないため除去
  //   - 廃止モデル名 (WX-RB400 / WX-TB840 / UTX-B40 (UWP-D21)) は最新の主要3機種に自動マイグレーション
  //   - mode/occupiedWidth の補完
  // ※ State の初期化 (下) より前に宣言する必要がある (TDZ 回避)
  const LEGACY_MODEL_MAP = {
    'WX-RB400': 'WX-TB841',
    'WX-TB840': 'WX-TB841',
    'UTX-B40 (UWP-D21)': 'UTX-B40'
  };
  function migrateInventory(inv) {
    if (!inv) return null;
    return inv
      .filter((d) => d.type !== 'RX')
      .map((d) => {
        const newModel = LEGACY_MODEL_MAP[d.model] || d.model;
        const sp = D.MODELS[newModel];
        // 旧モデル名で自動命名された機材 (例: "WX-TB840 #1") は新モデル名にプレフィクスを付け替え
        // ユーザが付け替えたカスタム名 (例: "司会1") はそのまま維持
        let newName = d.name || newModel;
        if (newModel !== d.model && d.name && d.name.indexOf(d.model) === 0) {
          newName = newModel + d.name.slice(d.model.length);
        }
        return Object.assign({}, d, {
          model: newModel,
          maker: (sp && sp.maker) || d.maker,
          type: 'TX',
          mode: (sp && sp.mode) || d.mode || 'analog',
          occupiedWidth: (sp && sp.occupiedWidth) || d.occupiedWidth || 0.110,
          name: newName
        });
      });
  }

  // ----- State -----
  let inventory = migrateInventory(ST.loadInventory()) || D.buildDefaultInventory();
  let presets = ST.loadPresets() || [];
  let settings = Object.assign({ imdTolerance: 0.025, adjacentLimit: 0.250 }, ST.loadSettings());

  function persistAll() {
    ST.saveInventory(inventory);
    ST.savePresets(presets);
    ST.saveSettings(settings);
  }

  // ----- View switching -----
  const views = ['inventory', 'assign', 'quick', 'map', 'menu'];
  function showView(name) {
    views.forEach((v) => {
      const el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('active', v === name);
      const btn = document.querySelector(`.nav-btn[data-view="${v}"]`);
      if (btn) btn.classList.toggle('active', v === name);
    });
    if (name === 'inventory') renderInventory();
    if (name === 'assign') renderAssign();
    if (name === 'quick') renderQuick();
    if (name === 'map') renderMap();
    if (name === 'menu') renderMenu();
  }

  // ----- クイック設計の状態 (in-memory: 永続化はしない、別途プリセット保存できる)
  let quick = {
    analogCount: 6,
    digitalCount: 0,
    blocked: [],  // [{freq:Number, mode:'analog'|'digital'}]
    fixed: [],    // [{freq:Number, mode:'analog'|'digital'}] (最大2)
    result: null  // 計算結果 {assignments, issues, success, usedGroup}
  };

  // ----- helpers -----
  function freqOf(d) {
    if (!d.assignedCh) return null;
    const ch = D.getChannelByNumber(d.assignedCh);
    return ch ? ch.freq : null;
  }
  function txAssignments() {
    return inventory
      .filter((d) => d.type === 'TX')
      .map((d) => ({
        id: d.id,
        name: d.name,
        freq: freqOf(d),
        mode: d.mode || (D.MODELS[d.model] && D.MODELS[d.model].mode) || 'analog',
        occupiedWidth: d.occupiedWidth || (D.MODELS[d.model] && D.MODELS[d.model].occupiedWidth) || 0.110
      }))
      .filter((a) => a.freq != null);
  }
  function newId() {
    return 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  // ===================================================
  // インベントリ画面
  //   - 上部: 主要機種ごとの本数カウンタ (+/- で増減)
  //   - 下部: 自動連番リスト (WX-DT135 #1, WX-DT135 #2, ...)
  // ===================================================
  function renderInventory() {
    const root = document.getElementById('view-inventory');
    const tx = inventory.filter((d) => d.type === 'TX');
    const ana = tx.filter((d) => (d.mode || 'analog') === 'analog').length;
    const dig = tx.filter((d) => d.mode === 'digital').length;
    const preferred = D.preferredModels();
    const customDevices = tx.filter((d) => !D.MODELS[d.model] || !D.MODELS[d.model].preferred);

    root.innerHTML = `
      <div class="page-head">
        <h2>送信機インベントリ</h2>
        <div class="head-actions">
          <button class="btn btn-ghost" id="btn-reset-inventory" title="初期構成に戻す">初期化</button>
        </div>
      </div>

      <div class="hint">
        使う機種の本数を <strong>＋ / −</strong> で設定してください。下に <code>機種名 #1, #2, ...</code> の連番で自動的にリスト化されます。
      </div>

      <div class="model-counters">
        ${preferred.map(modelCounterRow).join('')}
        ${customDevices.length > 0 ? `
          <div class="counter-row custom-row">
            <div class="counter-label">
              <span class="mode-pill ${customDevices[0].mode === 'digital' ? 'digital' : 'analog'}">その他</span>
              <strong>カスタム機材</strong>
              <small>${customDevices.length} 台</small>
            </div>
            <small style="color:#94a3b8">編集は下のリストから</small>
          </div>
        ` : ''}
        <button class="btn btn-add-row" id="btn-add-custom">＋ 別機種を追加 (カスタム入力)</button>
      </div>

      <div class="counts" style="margin-top:14px">
        <span class="chip">合計 <strong>${tx.length}</strong> 台</span>
        <span class="chip"><span class="mode-pill analog">アナログ</span>${ana}</span>
        <span class="chip"><span class="mode-pill digital">デジタル</span>${dig}</span>
      </div>

      <h3 class="sub" style="margin-top:14px">機材一覧</h3>
      <div class="card-list" id="tx-list">
        ${tx.map(deviceCard).join('') || '<div class="empty">送信機がありません。上のカウンタで本数を設定してください。</div>'}
      </div>
    `;

    document.getElementById('btn-reset-inventory').onclick = () => {
      if (!confirm('インベントリを初期構成 (WX-DT135×2 / WX-TB841×6 / UTX-B40×3) に戻します。\n現在の割当は失われます。よろしいですか？')) return;
      inventory = D.buildDefaultInventory();
      persistAll();
      renderInventory();
    };
    document.getElementById('btn-add-custom').onclick = openAddDeviceDialog;

    // カウンタ行の +/- イベント
    root.querySelectorAll('[data-counter-model]').forEach((el) => {
      const model = el.dataset.counterModel;
      const act = el.dataset.act;
      el.onclick = () => {
        if (act === 'inc') addOneOf(model);
        else if (act === 'dec') removeLastOf(model);
      };
    });

    root.querySelectorAll('[data-act="edit"]').forEach((b) => b.onclick = () => openEditDeviceDialog(b.dataset.id));
    root.querySelectorAll('[data-act="del"]').forEach((b) => b.onclick = () => deleteDevice(b.dataset.id));
  }

  function modelCounterRow(model) {
    const sp = D.MODELS[model];
    if (!sp) return '';
    const count = inventory.filter((d) => d.type === 'TX' && d.model === model).length;
    const modePill = sp.mode === 'digital'
      ? '<span class="mode-pill digital">デジタル</span>'
      : '<span class="mode-pill analog">アナログ</span>';
    return `
      <div class="counter-row">
        <div class="counter-label">
          ${modePill}
          <strong>${escape(model)}</strong>
          <small>${escape(sp.maker)}</small>
        </div>
        <div class="counter">
          <button data-counter-model="${escape(model)}" data-act="dec" ${count === 0 ? 'disabled' : ''}>−</button>
          <span class="val">${count}</span>
          <button data-counter-model="${escape(model)}" data-act="inc">＋</button>
        </div>
      </div>
    `;
  }

  // 指定モデルの送信機を1台追加 (連番は既存の最大値+1)
  function addOneOf(model) {
    const sp = D.MODELS[model];
    if (!sp) return;
    const existing = inventory.filter((d) => d.type === 'TX' && d.model === model);
    // 既存の "MODEL #N" 形式から最大Nを取得し、その+1を採番
    let maxNum = 0;
    const re = new RegExp('^' + model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*#(\\d+)\\s*$');
    existing.forEach((d) => {
      const m = re.exec(d.name || '');
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    const nextNum = Math.max(maxNum + 1, existing.length + 1);
    inventory.push({
      id: newId(),
      model,
      maker: sp.maker,
      type: 'TX',
      mode: sp.mode || 'analog',
      occupiedWidth: sp.occupiedWidth || (sp.mode === 'digital' ? 0.192 : 0.110),
      name: model + ' #' + nextNum,
      assignedCh: null,
      linkedTo: null
    });
    persistAll();
    renderInventory();
  }

  // 指定モデルの送信機のうち、最大番号 (= 最後に追加したもの) を1台削除
  function removeLastOf(model) {
    const indices = [];
    inventory.forEach((d, i) => {
      if (d.type === 'TX' && d.model === model) indices.push(i);
    });
    if (indices.length === 0) return;
    // 末尾 (最後にpushしたもの) を削除
    inventory.splice(indices[indices.length - 1], 1);
    persistAll();
    renderInventory();
  }

  function deviceCard(d) {
    const mode = d.mode || (D.MODELS[d.model] && D.MODELS[d.model].mode) || 'analog';
    const ch = d.assignedCh ? D.getChannelByNumber(d.assignedCh) : null;
    const chBadge = ch
      ? `<span class="ch-badge">${D.labelOf(ch, mode)}<small>${ch.freq.toFixed(3)}</small></span>`
      : '<span class="ch-badge unassigned">未割当</span>';
    const modePill = mode === 'digital'
      ? '<span class="mode-pill digital">デジタル</span>'
      : '<span class="mode-pill analog">アナログ</span>';
    return `
      <div class="dev-card type-tx mode-${mode}">
        <div class="dev-main">
          <div class="dev-title">
            ${modePill}
            <strong>${escape(d.name)}</strong>
          </div>
          <div class="dev-sub">${escape(d.maker)} / ${escape(d.model)}</div>
        </div>
        <div class="dev-right">
          ${chBadge}
          <div class="dev-actions">
            <button class="icon-btn" data-act="edit" data-id="${d.id}" title="編集">✎</button>
            <button class="icon-btn danger" data-act="del" data-id="${d.id}" title="削除">×</button>
          </div>
        </div>
      </div>
    `;
  }

  function deleteDevice(id) {
    const d = inventory.find((x) => x.id === id);
    if (!d) return;
    if (!confirm(`${d.name} を削除しますか？`)) return;
    inventory = inventory.filter((x) => x.id !== id);
    persistAll();
    renderInventory();
  }

  function openAddDeviceDialog() {
    openDeviceDialog(null);
  }
  function openEditDeviceDialog(id) {
    const d = inventory.find((x) => x.id === id);
    if (!d) return;
    openDeviceDialog(d);
  }

  function openDeviceDialog(existing) {
    const isEdit = !!existing;
    // 送信機(TX)のみ選択可
    const modelOptions = Object.keys(D.MODELS)
      .filter((m) => D.MODELS[m].type === 'TX')
      .map((m) => {
        const sp = D.MODELS[m];
        const sel = existing && existing.model === m ? 'selected' : '';
        const modeLabel = sp.mode === 'digital' ? 'デジタル' : 'アナログ';
        return `<option value="${escape(m)}" ${sel}>${escape(m)} — ${sp.maker} / ${modeLabel}</option>`;
      }).join('');

    showModal(`
      <h3>${isEdit ? '送信機を編集' : '送信機を追加'}</h3>
      <label class="field">
        <span>モデル</span>
        <select id="dev-model">
          ${modelOptions}
          <option value="__custom__">— カスタム入力 —</option>
        </select>
      </label>
      <div id="custom-fields" style="display:none">
        <label class="field"><span>メーカー</span><input id="dev-maker" type="text" value="${escape(existing && existing.maker || '')}" /></label>
        <label class="field"><span>モデル名(自由記述)</span><input id="dev-customModel" type="text" value="${escape(existing && (D.MODELS[existing.model] ? '' : existing.model) || '')}" /></label>
        <label class="field">
          <span>方式 (アナログ / デジタル)</span>
          <select id="dev-mode">
            <option value="analog" ${(!existing || existing.mode !== 'digital') ? 'selected' : ''}>アナログB帯 (占有110kHz)</option>
            <option value="digital" ${existing && existing.mode === 'digital' ? 'selected' : ''}>デジタルB帯 (占有192kHz)</option>
          </select>
        </label>
      </div>
      <label class="field"><span>名称（任意・現場での識別用）</span><input id="dev-name" type="text" value="${escape(existing && existing.name || '')}" placeholder="例: 司会1, 講演者A …" /></label>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-modal-close>キャンセル</button>
        <button class="btn btn-primary" id="btn-save-device">${isEdit ? '保存' : '追加'}</button>
      </div>
    `);

    const modelSel = document.getElementById('dev-model');
    const customWrap = document.getElementById('custom-fields');
    function syncCustom() {
      customWrap.style.display = modelSel.value === '__custom__' ? '' : 'none';
    }
    modelSel.onchange = syncCustom;
    if (isEdit && !D.MODELS[existing.model]) {
      modelSel.value = '__custom__';
    }
    syncCustom();

    document.getElementById('btn-save-device').onclick = () => {
      const m = modelSel.value;
      let model, maker, mode, occupiedWidth;
      if (m === '__custom__') {
        maker = document.getElementById('dev-maker').value.trim() || 'その他';
        model = document.getElementById('dev-customModel').value.trim() || 'カスタム送信機';
        mode = document.getElementById('dev-mode').value;
        occupiedWidth = mode === 'digital' ? 0.192 : 0.110;
      } else {
        const sp = D.MODELS[m];
        model = m;
        maker = sp.maker;
        mode = sp.mode || 'analog';
        occupiedWidth = sp.occupiedWidth || (mode === 'digital' ? 0.192 : 0.110);
      }
      const name = document.getElementById('dev-name').value.trim() || model;
      if (isEdit) {
        existing.model = model;
        existing.maker = maker;
        existing.type = 'TX';
        existing.mode = mode;
        existing.occupiedWidth = occupiedWidth;
        existing.name = name;
      } else {
        inventory.push({ id: newId(), model, maker, type: 'TX', mode, occupiedWidth, name, assignedCh: null, linkedTo: null });
      }
      persistAll();
      closeModal();
      renderInventory();
    };
  }

  // ===================================================
  // 割当画面
  // ===================================================
  function renderAssign() {
    const root = document.getElementById('view-assign');
    const txs = inventory.filter((d) => d.type === 'TX');
    const issues = IMD.analyze(txAssignments(), settings);
    const errIds = new Set();
    const warnIds = new Set();
    issues.forEach((iss) => iss.victims.forEach((v) => (iss.severity === 'error' ? errIds : warnIds).add(v)));

    root.innerHTML = `
      <div class="page-head">
        <h2>チャンネル割当</h2>
        <div class="head-actions">
          <button class="btn btn-primary" id="btn-auto">⚡ 自動割当</button>
          <button class="btn btn-ghost" id="btn-clear-all">全クリア</button>
        </div>
      </div>

      <div class="hint">
        送信機ごとに使用するチャンネルを選択してください。<br>
        ・アナログ機: 同じグループ <strong>B-1〜B-7</strong> で揃えると混信が起きにくい<br>
        ・デジタル機(RAMSA): 同じグループ <strong>31 / 32 / 33</strong> で揃えると 375kHz間隔で最大10波運用可能
      </div>

      <div class="assign-grid">
        ${txs.length === 0 ? '<div class="empty">送信機がありません。インベントリ画面から追加してください。</div>' : ''}
        ${txs.map((d) => assignRow(d, errIds.has(d.id), warnIds.has(d.id))).join('')}
      </div>

      <div class="issues">
        <h3>診断結果</h3>
        ${issues.length === 0 ? '<div class="ok">✓ 混信・IMDは検出されませんでした</div>' : ''}
        ${issues.map(issueLine).join('')}
        ${interferenceHelpHTML()}
      </div>
    `;

    document.getElementById('btn-auto').onclick = autoAssignAll;
    document.getElementById('btn-clear-all').onclick = () => {
      if (!confirm('すべての送信機の割当をクリアします。よろしいですか？')) return;
      inventory.forEach((d) => { if (d.type === 'TX') d.assignedCh = null; });
      persistAll();
      renderAssign();
    };
    root.querySelectorAll('select.ch-select').forEach((sel) => {
      sel.onchange = () => {
        const id = sel.dataset.id;
        const d = inventory.find((x) => x.id === id);
        if (!d) return;
        const v = sel.value;
        d.assignedCh = v ? parseInt(v, 10) : null;
        persistAll();
        renderAssign();
      };
    });
  }

  // 割当用プルダウンの選択肢を「グループ別 → チャンネル順」で組み立てる。
  //   analog: B-1, B-2, ... B-6, B-7(Sony), B-8(Sony), RAMSA「7」, (任意: 未所属)
  //   digital: 31, 32, 33
  // 同じ周波数が複数グループに属する場合 (例: B11 は B-1 と B-7) は、両方の optgroup に出す。
  function buildChannelOptgroups(mode, assignedCh) {
    if (mode === 'digital') {
      const order = ['31', '32', '33'];
      return order.map((g) => {
        const chs = D.CHANNELS.filter((c) => (c.digitalGroups || []).includes(g));
        // デジタルラベルのスロット番号で昇順
        chs.sort((a, b) => (D.digitalSlot(a) || 0) - (D.digitalSlot(b) || 0));
        const inner = chs.map((c) => {
          const sel = assignedCh === c.n ? ' selected' : '';
          const lbl = D.digitalFullLabel(c) || D.labelOf(c, 'digital');
          return `<option value="${c.n}"${sel}>${lbl} — ${c.freq.toFixed(3)} MHz</option>`;
        }).join('');
        return `<optgroup label="グループ ${g} (RAMSAデジタル)">${inner}</optgroup>`;
      }).join('');
    }

    // analog
    const groupOrder = ['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8'];
    const groupTitle = {
      'B-1': 'B-1 (標準 6波)',
      'B-2': 'B-2 (標準 6波)',
      'B-3': 'B-3 (標準 6波)',
      'B-4': 'B-4 (標準 5波)',
      'B-5': 'B-5 (標準 5波)',
      'B-6': 'B-6 (標準 1波)',
      'B-7': 'B-7 (Sony推奨 7波)',
      'B-8': 'B-8 (Sony推奨 7波)'
    };
    let html = groupOrder.map((g) => {
      const chs = D.CHANNELS.filter((c) => (c.groups || []).includes(g));
      // チャンネル名(B11等)で昇順 → 数値部分を抽出してソート
      chs.sort((a, b) => parseInt(a.label.replace(/\D/g, ''), 10) - parseInt(b.label.replace(/\D/g, ''), 10));
      if (chs.length === 0) return '';
      const inner = chs.map((c) => {
        const sel = assignedCh === c.n ? ' selected' : '';
        const others = (c.groups || []).filter((x) => x !== g);
        const xtra = others.length > 0 ? ` 〔${others.join('/')}〕` : '';
        return `<option value="${c.n}"${sel}>${c.label} — ${c.freq.toFixed(3)} MHz${xtra}</option>`;
      }).join('');
      return `<optgroup label="${groupTitle[g] || g}">${inner}</optgroup>`;
    }).join('');

    // RAMSA「7」グループ (1〜6Gから選定された7波の参照表記)
    const r7 = D.CHANNELS.filter((c) => c.ramsaG7);
    r7.sort((a, b) => parseInt(a.ramsaG7.replace(/\D/g, ''), 10) - parseInt(b.ramsaG7.replace(/\D/g, ''), 10));
    if (r7.length > 0) {
      const inner = r7.map((c) => {
        const sel = assignedCh === c.n ? ' selected' : '';
        return `<option value="${c.n}"${sel}>${c.ramsaG7} (=${c.label}) — ${c.freq.toFixed(3)} MHz</option>`;
      }).join('');
      html += `<optgroup label="RAMSA「7」グループ (WX-TB841等 7波)">${inner}</optgroup>`;
    }
    return html;
  }

  function assignRow(d, isErr, isWarn) {
    const mode = d.mode || (D.MODELS[d.model] && D.MODELS[d.model].mode) || 'analog';
    const opts = '<option value="">未割当</option>' + buildChannelOptgroups(mode, d.assignedCh);
    const cls = isErr ? 'has-error' : isWarn ? 'has-warn' : '';
    const modePill = mode === 'digital'
      ? '<span class="mode-pill digital">デジタル</span>'
      : '<span class="mode-pill analog">アナログ</span>';
    return `
      <div class="assign-row ${cls}">
        <div class="ar-name">
          <div>${modePill}<strong>${escape(d.name)}</strong></div>
          <small>${escape(d.maker)} ${escape(d.model)}</small>
        </div>
        <select class="ch-select" data-id="${d.id}">${opts}</select>
      </div>
    `;
  }

  // 診断種別 (kind) の日本語化マップ
  const KIND_LABEL = {
    'collision':         '重複',
    'spectrum-overlap':  'スペクトル重なり',
    'adjacent':          '隣接(アナログ)',
    'adjacent-digital':  '隣接(デジタル)',
    'imd3-2tone':        'IMD3次(2波)',
    'imd3-3tone':        'IMD3次(3波)',
    'no-solution':       '解なし'
  };
  function issueLine(iss) {
    const kindLabel = KIND_LABEL[iss.kind] || iss.kind;
    return `<div class="issue ${iss.severity}">
      <span class="badge">${iss.severity === 'error' ? 'エラー' : '警告'}</span>
      <span class="kind">${escape(kindLabel)}</span>
      <span class="msg">${escape(iss.message)}</span>
    </div>`;
  }

  // 干渉種別の解説 (診断結果の下に折りたたみで表示)
  function interferenceHelpHTML() {
    return `
      <details class="imd-help">
        <summary>用語解説 (重複 / 隣接 / IMD とは？)</summary>
        <ul>
          <li><strong>重複</strong>: 2つの送信機が <em>同じ周波数</em> を使っている状態。確実に混信します。</li>
          <li><strong>スペクトル重なり</strong>: 2波の <em>占有帯域 (アナログ110kHz / デジタル192kHz)</em> 同士が物理的に重なる距離まで近接した状態。確実に干渉。</li>
          <li><strong>隣接(アナログ)</strong>: アナログ機同士の間隔が推奨最小 <strong>250 kHz</strong> より近い。隣接妨害や混変調が起きやすい。</li>
          <li><strong>隣接(デジタル)</strong>: デジタル機を含むペアで推奨最小 (デジタル↔デジタル <strong>375 kHz</strong> / 混在 250 kHz) より近い。</li>
          <li><strong>IMD = Intermodulation Distortion (相互変調歪)</strong> — 複数の電波が同じ空間に存在すると、お互いが「混ざって」<em>新しい妨害波</em> を発生させます。送信機の数が多いほど発生確率が上がります。</li>
          <li><strong>IMD3次(2波)</strong>: 2台の送信機 (周波数 f1, f2) が出す3次相互変調波 <code>2×f1 − f2</code>。3台目の送信機が偶然この周波数を使っていると干渉。<em>エラー</em> 扱い。</li>
          <li><strong>IMD3次(3波)</strong>: 3台の送信機 (f1, f2, f3) から発生する <code>f1 + f2 − f3</code>。4台目の送信機がそこを使っていると干渉。発生強度は2波より弱いため <em>警告</em> 扱い。</li>
        </ul>
        <p class="hint small">
          ※ 自動割当はこれらすべての妨害が起きない組合せを自動探索します。手動割当時はマップ画面で視覚的に確認できます。
        </p>
      </details>
    `;
  }

  function autoAssignAll() {
    const txs = inventory.filter((d) => d.type === 'TX');
    if (txs.length === 0) { alert('送信機がありません'); return; }
    const params = txs.map((t) => ({
      id: t.id,
      name: t.name,
      freq: null,
      locked: false,
      mode: t.mode || (D.MODELS[t.model] && D.MODELS[t.model].mode) || 'analog',
      occupiedWidth: t.occupiedWidth || (D.MODELS[t.model] && D.MODELS[t.model].occupiedWidth) || 0.110
    }));
    const res = AUTO.autoAssign(params, settings);
    if (!res.success && res.assignments.length === 0) {
      alert('混信回避できる組合せが見つかりませんでした。台数を減らすか、設定の許容値を見直してください。');
      return;
    }
    res.assignments.forEach((a) => {
      const d = inventory.find((x) => x.id === a.id);
      if (d) {
        const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
        d.assignedCh = ch ? ch.n : null;
      }
    });
    persistAll();
    renderAssign();
    let msg = res.success ? '✓ 自動割当 完了' : '⚠ 一部のみ割当（IMD警告あり）';
    if (res.usedGroup) msg += `（グループ: ${res.usedGroup}）`;
    showToast(msg);
  }

  // ===================================================
  // クイック設計画面
  //   - 必要な波数 (アナログ・デジタル) を指定
  //   - 会場で既に使われているチャンネルを「使用中」として除外
  //   - 固定したいチャンネルを最大2つ指定
  //   - 残りを自動割当
  // ===================================================
  function renderQuick() {
    const root = document.getElementById('view-quick');
    const total = quick.analogCount + quick.digitalCount;
    const totalWithFixed = quick.fixed.length;
    const freeNeeded = total - totalWithFixed;

    root.innerHTML = `
      <div class="page-head">
        <h2>⚡ クイック設計</h2>
      </div>
      <div class="hint">
        ホールやスタジアム等、現場で必要な波数を指定して自動割当します。会場で既に使用中のチャンネルや、固定したいチャンネルがあれば指定できます。
      </div>

      <div class="q-section">
        <h3>1. 必要な送信機の本数</h3>
        <div class="counter-row">
          <span class="counter-label"><span class="badge analog">アナログ</span>アナログB帯</span>
          <div class="counter">
            <button data-act="dec-ana">−</button>
            <span class="val" id="q-ana-val">${quick.analogCount}</span>
            <button data-act="inc-ana">＋</button>
          </div>
        </div>
        <div class="counter-row">
          <span class="counter-label"><span class="badge digital">デジタル</span>デジタルB帯</span>
          <div class="counter">
            <button data-act="dec-dig">−</button>
            <span class="val" id="q-dig-val">${quick.digitalCount}</span>
            <button data-act="inc-dig">＋</button>
          </div>
        </div>
        <div class="q-total">
          <span>合計</span>
          <span><strong>${total}</strong> 波</span>
        </div>
      </div>

      <div class="q-section">
        <h3>2. 会場で既に使われているチャンネル <small style="font-weight:400;color:#94a3b8">(任意)</small></h3>
        <div class="desc">他団体が使用中のチャンネル等。これらの周波数とその近傍/IMD干渉する組合せを避けて割当します。</div>
        <div class="row-list" id="q-blocked-list">
          ${quick.blocked.map((b, i) => blockedRow(b, i)).join('') || '<div class="empty-cells">指定なし</div>'}
        </div>
        <button class="btn btn-add-row" id="q-add-blocked">＋ 使用中チャンネルを追加</button>
      </div>

      <div class="q-section">
        <h3>3. 固定したいチャンネル <small style="font-weight:400;color:#94a3b8">(最大 2 つ)</small></h3>
        <div class="desc">既に決めたチャンネルがあれば固定できます。残りを自動で埋めます。</div>
        <div class="row-list" id="q-fixed-list">
          ${quick.fixed.map((f, i) => fixedRow(f, i)).join('') || '<div class="empty-cells">指定なし</div>'}
        </div>
        ${quick.fixed.length < 2 ? '<button class="btn btn-add-row" id="q-add-fixed">＋ 固定チャンネルを追加</button>' : ''}
      </div>

      <button class="btn btn-primary btn-calc" id="q-calc">⚡ 自動割当を計算 (アナログ${quick.analogCount}波 + デジタル${quick.digitalCount}波)</button>

      ${quick.result ? quickResultHTML() : ''}
    `;

    // counter buttons
    root.querySelector('[data-act="dec-ana"]').onclick = () => { if (quick.analogCount > 0) quick.analogCount--; renderQuick(); };
    root.querySelector('[data-act="inc-ana"]').onclick = () => { if (quick.analogCount < 30) quick.analogCount++; renderQuick(); };
    root.querySelector('[data-act="dec-dig"]').onclick = () => { if (quick.digitalCount > 0) quick.digitalCount--; renderQuick(); };
    root.querySelector('[data-act="inc-dig"]').onclick = () => { if (quick.digitalCount < 30) quick.digitalCount++; renderQuick(); };

    // add buttons
    const addBlk = document.getElementById('q-add-blocked');
    if (addBlk) addBlk.onclick = () => {
      quick.blocked.push({ freq: D.CHANNELS[0].freq, mode: 'analog' });
      renderQuick();
    };
    const addFix = document.getElementById('q-add-fixed');
    if (addFix) addFix.onclick = () => {
      if (quick.fixed.length >= 2) return;
      quick.fixed.push({ freq: D.CHANNELS[0].freq, mode: 'analog' });
      renderQuick();
    };

    // row event delegation
    root.querySelectorAll('[data-blk-idx]').forEach((el) => {
      const idx = parseInt(el.dataset.blkIdx, 10);
      if (el.dataset.act === 'del') {
        el.onclick = () => { quick.blocked.splice(idx, 1); renderQuick(); };
      } else if (el.dataset.act === 'ch') {
        el.onchange = () => { quick.blocked[idx].freq = parseFloat(el.value); renderQuick(); };
      } else if (el.dataset.act === 'mode') {
        el.onchange = () => { quick.blocked[idx].mode = el.value; renderQuick(); };
      }
    });
    root.querySelectorAll('[data-fix-idx]').forEach((el) => {
      const idx = parseInt(el.dataset.fixIdx, 10);
      if (el.dataset.act === 'del') {
        el.onclick = () => { quick.fixed.splice(idx, 1); renderQuick(); };
      } else if (el.dataset.act === 'ch') {
        el.onchange = () => { quick.fixed[idx].freq = parseFloat(el.value); renderQuick(); };
      } else if (el.dataset.act === 'mode') {
        el.onchange = () => { quick.fixed[idx].mode = el.value; renderQuick(); };
      }
    });

    // calc
    document.getElementById('q-calc').onclick = quickCalculate;

    // 結果 SVG
    const svg = document.getElementById('q-vis-svg');
    if (svg && quick.result) {
      // 表示用: blocked は 'blocked' 専用のモードでビジュアライズ
      const visList = quick.result.assignments.filter((a) => !a._blocked);
      const blkList = quick.result.assignments.filter((a) => a._blocked);
      VIS.render(svg, visList.concat(blkList), settings);
    }
  }

  // モードに合わせたチャンネル選択肢を「グループ別」optgroupで組む。value は freq (クイック設計仕様)。
  function chOptionsFor(mode, currentFreq) {
    const isSel = (c) => Math.abs(c.freq - currentFreq) < 1e-6;
    if (mode === 'digital') {
      return ['31', '32', '33'].map((g) => {
        const chs = D.CHANNELS.filter((c) => (c.digitalGroups || []).includes(g))
          .sort((a, b) => (D.digitalSlot(a) || 0) - (D.digitalSlot(b) || 0));
        const inner = chs.map((c) => {
          const lbl = D.digitalFullLabel(c) || D.labelOf(c, 'digital');
          return `<option value="${c.freq}"${isSel(c) ? ' selected' : ''}>${lbl} — ${c.freq.toFixed(3)} MHz</option>`;
        }).join('');
        return `<optgroup label="グループ ${g} (RAMSAデジタル)">${inner}</optgroup>`;
      }).join('');
    }
    const groupOrder = ['B-1', 'B-2', 'B-3', 'B-4', 'B-5', 'B-6', 'B-7', 'B-8'];
    const groupTitle = {
      'B-1': 'B-1 (標準)', 'B-2': 'B-2 (標準)', 'B-3': 'B-3 (標準)',
      'B-4': 'B-4 (標準)', 'B-5': 'B-5 (標準)', 'B-6': 'B-6 (標準)',
      'B-7': 'B-7 (Sony推奨 7波)', 'B-8': 'B-8 (Sony推奨 7波)'
    };
    let html = groupOrder.map((g) => {
      const chs = D.CHANNELS.filter((c) => (c.groups || []).includes(g))
        .sort((a, b) => parseInt(a.label.replace(/\D/g, ''), 10) - parseInt(b.label.replace(/\D/g, ''), 10));
      if (chs.length === 0) return '';
      const inner = chs.map((c) => {
        const others = (c.groups || []).filter((x) => x !== g);
        const xtra = others.length > 0 ? ` 〔${others.join('/')}〕` : '';
        return `<option value="${c.freq}"${isSel(c) ? ' selected' : ''}>${c.label} — ${c.freq.toFixed(3)} MHz${xtra}</option>`;
      }).join('');
      return `<optgroup label="${groupTitle[g] || g}">${inner}</optgroup>`;
    }).join('');
    const r7 = D.CHANNELS.filter((c) => c.ramsaG7)
      .sort((a, b) => parseInt(a.ramsaG7.replace(/\D/g, ''), 10) - parseInt(b.ramsaG7.replace(/\D/g, ''), 10));
    if (r7.length > 0) {
      const inner = r7.map((c) => `<option value="${c.freq}"${isSel(c) ? ' selected' : ''}>${c.ramsaG7} (=${c.label}) — ${c.freq.toFixed(3)} MHz</option>`).join('');
      html += `<optgroup label="RAMSA「7」グループ (WX-TB841等)">${inner}</optgroup>`;
    }
    return html;
  }

  function blockedRow(b, idx) {
    return `
      <div class="row-item">
        <span class="label-pill blocked">使用中</span>
        <div class="row-grid">
          <select data-blk-idx="${idx}" data-act="ch">${chOptionsFor(b.mode, b.freq)}</select>
          <select data-blk-idx="${idx}" data-act="mode">
            <option value="analog" ${b.mode === 'analog' ? 'selected' : ''}>アナログ</option>
            <option value="digital" ${b.mode === 'digital' ? 'selected' : ''}>デジタル</option>
          </select>
        </div>
        <button class="icon-btn" data-blk-idx="${idx}" data-act="del" title="削除">×</button>
      </div>
    `;
  }

  function fixedRow(f, idx) {
    return `
      <div class="row-item">
        <span class="label-pill fixed">固定</span>
        <div class="row-grid">
          <select data-fix-idx="${idx}" data-act="ch">${chOptionsFor(f.mode, f.freq)}</select>
          <select data-fix-idx="${idx}" data-act="mode">
            <option value="analog" ${f.mode === 'analog' ? 'selected' : ''}>アナログ</option>
            <option value="digital" ${f.mode === 'digital' ? 'selected' : ''}>デジタル</option>
          </select>
        </div>
        <button class="icon-btn" data-fix-idx="${idx}" data-act="del" title="削除">×</button>
      </div>
    `;
  }

  function quickResultHTML() {
    const r = quick.result;
    const visible = r.assignments.filter((a) => !a._blocked);
    const blocked = r.assignments.filter((a) => a._blocked);
    visible.sort((a, b) => a.freq - b.freq);

    return `
      <div class="q-section">
        <h3>結果</h3>
        ${r.success
          ? '<div class="ok" style="color:#34d399;padding:6px 0">✓ 混信・IMDなしの組合せが見つかりました' + (r.usedGroup ? ` (グループ: <strong>${r.usedGroup}</strong>)` : '') + '</div>'
          : '<div style="color:#fbbf24;padding:6px 0">⚠ クリーンな組合せは見つかりませんでした。最善の候補を表示します（警告あり）。</div>'}
        <div class="svg-wrap" style="margin-top:8px">
          <svg id="q-vis-svg" viewBox="0 0 800 240" preserveAspectRatio="xMidYMid meet"></svg>
        </div>
        <div class="legend" style="margin-top:6px">
          <span><span class="lg ok"></span>正常</span>
          <span><span class="lg warn"></span>警告</span>
          <span><span class="lg err"></span>エラー</span>
        </div>

        <h4 class="sub" style="margin:14px 0 6px">割当結果 (${visible.length} 波)</h4>
        <div class="row-list">
          ${visible.map((a) => {
            const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
            const isFixed = a._kind === 'fixed';
            const modeBadge = a.mode === 'digital'
              ? '<span class="mode-pill digital">デジタル</span>'
              : '<span class="mode-pill analog">アナログ</span>';
            const lbl = ch ? D.labelOf(ch, a.mode) : '';
            return `<div class="q-result-row ${isFixed ? 'fixed' : ''}">
              <span class="label-pill ${isFixed ? 'fixed' : 'auto'}">${isFixed ? '固定' : '自動'}</span>
              <div>${modeBadge}<strong>${lbl}</strong> — ${a.freq.toFixed(3)} MHz</div>
              <small>${escape(a.name)}</small>
            </div>`;
          }).join('')}
        </div>

        ${blocked.length > 0 ? `
          <h4 class="sub" style="margin:14px 0 6px">使用中（参考表示）</h4>
          <div class="row-list">
            ${blocked.map((a) => {
              const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
              const lbl = ch ? D.labelOf(ch, a.mode) : '';
              return `<div class="q-result-row blocked">
                <span class="label-pill blocked">使用中</span>
                <div><strong>${lbl}</strong> — ${a.freq.toFixed(3)} MHz (${a.mode === 'digital' ? 'デジタル' : 'アナログ'})</div>
                <small>会場側</small>
              </div>`;
            }).join('')}
          </div>
        ` : ''}

        <h4 class="sub" style="margin:14px 0 6px">診断</h4>
        <div class="issues">
          ${r.issues.length === 0 ? '<div class="ok">✓ 問題なし</div>' : r.issues.map(issueLine).join('')}
          ${interferenceHelpHTML()}
        </div>

        <div class="row" style="margin-top:14px">
          <button class="btn btn-ghost" id="q-clear-result">結果をクリア</button>
          <button class="btn" id="q-apply-inv">この結果を機材インベントリに反映</button>
        </div>
      </div>
    `;
  }

  function quickCalculate() {
    const txs = [];
    let bId = 0;
    quick.blocked.forEach((b) => {
      txs.push({
        id: 'blk' + (bId++),
        name: '会場使用中',
        freq: b.freq,
        mode: b.mode,
        occupiedWidth: b.mode === 'digital' ? 0.192 : 0.110,
        locked: true,
        _blocked: true
      });
    });
    let fId = 0;
    quick.fixed.forEach((f) => {
      txs.push({
        id: 'fix' + (fId++),
        name: '固定 ' + (fId),
        freq: f.freq,
        mode: f.mode,
        occupiedWidth: f.mode === 'digital' ? 0.192 : 0.110,
        locked: true,
        _kind: 'fixed'
      });
    });
    for (let i = 0; i < quick.analogCount; i++) {
      txs.push({
        id: 'a' + i,
        name: 'アナログ #' + (i + 1),
        freq: null,
        mode: 'analog',
        occupiedWidth: 0.110,
        locked: false,
        _kind: 'auto'
      });
    }
    for (let i = 0; i < quick.digitalCount; i++) {
      txs.push({
        id: 'd' + i,
        name: 'デジタル #' + (i + 1),
        freq: null,
        mode: 'digital',
        occupiedWidth: 0.192,
        locked: false,
        _kind: 'auto'
      });
    }

    if (txs.filter((t) => !t._blocked).length === 0) {
      alert('割当する送信機がありません。アナログまたはデジタル波数を指定してください。');
      return;
    }

    showToast('計算中...');
    // 重い計算は次のティックに回す（UIの即時反映のため）
    setTimeout(() => {
      const res = AUTO.autoAssign(txs, settings);

      // 元の txs にあったメタ情報 (_blocked, _kind, name, mode) を結果にマージ
      const enriched = res.assignments.map((a) => {
        const orig = txs.find((t) => t.id === a.id);
        return Object.assign({}, a, {
          _blocked: orig && orig._blocked,
          _kind: orig && orig._kind,
          name: (orig && orig.name) || a.name,
          mode: (orig && orig.mode) || a.mode || 'analog',
          occupiedWidth: (orig && orig.occupiedWidth) || a.occupiedWidth
        });
      });

      quick.result = {
        success: res.success,
        usedGroup: res.usedGroup,
        assignments: enriched,
        issues: res.issues
      };
      renderQuick();

      // 「結果をクリア」「機材に反映」ボタンの結線
      const clr = document.getElementById('q-clear-result');
      if (clr) clr.onclick = () => { quick.result = null; renderQuick(); };
      const apply = document.getElementById('q-apply-inv');
      if (apply) apply.onclick = applyQuickToInventory;

      showToast(res.success ? '✓ 計算完了' : '⚠ 警告ありの結果');
    }, 50);
  }

  // クイック設計の結果を送信機インベントリに「上書き反映」する
  // モード別にデフォルト機種 (デジタル: WX-DT135 / アナログ: WX-TB841) を割り当てて連番命名
  function applyQuickToInventory() {
    if (!quick.result) return;
    if (!confirm('クイック設計の結果を送信機インベントリに上書きします（既存の送信機は置き換わります）。よろしいですか？')) return;
    const visible = quick.result.assignments.filter((a) => !a._blocked);
    let digCount = 0, anaCount = 0;
    inventory = visible.map((a) => {
      const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
      const isDig = a.mode === 'digital';
      const model = isDig ? 'WX-DT135' : 'WX-TB841';
      const num = isDig ? (++digCount) : (++anaCount);
      const sp = D.MODELS[model];
      return {
        id: newId(),
        model,
        maker: sp.maker,
        type: 'TX',
        mode: sp.mode,
        occupiedWidth: sp.occupiedWidth,
        name: model + ' #' + num,
        assignedCh: ch ? ch.n : null,
        linkedTo: null
      };
    });
    persistAll();
    showToast('インベントリに反映しました');
    showView('inventory');
  }

  // ===================================================
  // 周波数マップ画面
  // ===================================================
  function renderMap() {
    const root = document.getElementById('view-map');
    const invList = txAssignments();
    // クイック設計で計算済みだが「インベントリに反映」されていない結果がある場合、
    // マップにはそれを優先的に表示する (バナーでユーザーに通知)。
    const quickList = (quick.result && Array.isArray(quick.result.assignments))
      ? quick.result.assignments.filter((a) => !a._blocked && typeof a.freq === 'number')
      : [];
    const useQuick = quickList.length > 0 && invList.length === 0;
    const list = useQuick ? quickList : invList;
    const sourceBanner = useQuick
      ? `<div class="hint" style="border-left:3px solid #fbbf24;background:rgba(251,191,36,0.08);padding:8px 10px;margin:6px 0;">
           ⚡ クイック設計の計算結果を表示しています（インベントリ未反映）。
           保存するには <strong>クイック画面 → 「この結果を機材インベントリに反映」</strong> を押してください。
         </div>`
      : (quickList.length > 0
          ? `<div class="hint" style="border-left:3px solid #22d3ee;background:rgba(34,211,238,0.08);padding:8px 10px;margin:6px 0;">
               ℹ クイック設計に未保存の計算結果があります（現在は機材インベントリの割当を表示中）。
             </div>`
          : '');
    const issues = IMD.analyze(list, settings);

    root.innerHTML = `
      <div class="page-head">
        <h2>周波数マップ</h2>
      </div>
      ${sourceBanner}
      <div class="hint">B帯 806.000〜810.000 MHz / 縦バーは送信機の割当周波数を表します。赤=エラー、橙=警告。</div>
      <div class="svg-wrap">
        <svg id="vis-svg" viewBox="0 0 800 280" preserveAspectRatio="xMidYMid meet"></svg>
      </div>
      <div class="legend">
        <span class="lg ok"></span> 正常
        <span class="lg warn"></span> 警告 (隣接/IMD3次3波)
        <span class="lg err"></span> エラー (重複/IMD3次2波)
      </div>
      <h3 class="sub">割当一覧</h3>
      <div class="map-list">
        ${list.length === 0 ? '<div class="empty">割当がありません</div>' : ''}
        ${list.sort((a,b)=>a.freq-b.freq).map((a) => {
          const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
          const lbl = ch ? D.labelOf(ch, a.mode) : '';
          const modePill = a.mode === 'digital'
            ? '<span class="mode-pill digital">デジタル</span>'
            : '<span class="mode-pill analog">アナログ</span>';
          return `<div class="map-row">${modePill}<span class="ch-tag">${lbl}</span> <strong>${a.freq.toFixed(3)} MHz</strong> — ${escape(a.name)}</div>`;
        }).join('')}
      </div>

      ${renderFrequencyTable(list, issues)}

      <h3 class="sub">診断</h3>
      <div class="issues">
        ${issues.length === 0 ? '<div class="ok">✓ 問題なし</div>' : issues.map(issueLine).join('')}
        ${interferenceHelpHTML()}
      </div>
    `;

    const svg = document.getElementById('vis-svg');
    VIS.render(svg, list, settings);
  }

  // 周波数表 (B帯 30波の一覧)。現在割当中のチャンネルを色付きで表示。
  // 凡例:
  //   水色 (アナログ使用中) / 紫 (デジタル使用中) / 黄 (警告) / 赤 (エラー) / 灰 (未使用)
  function renderFrequencyTable(list, issues) {
    const errIds = new Set();
    const warnIds = new Set();
    issues.forEach((iss) => iss.victims.forEach((v) => (iss.severity === 'error' ? errIds : warnIds).add(v)));

    // ch.n → { tx: [...], severity }
    const byCh = {};
    D.CHANNELS.forEach((c) => { byCh[c.n] = { tx: [], severity: null }; });
    list.forEach((a) => {
      const ch = D.CHANNELS.find((c) => Math.abs(c.freq - a.freq) < 1e-6);
      if (!ch) return;
      byCh[ch.n].tx.push(a);
      if (errIds.has(a.id)) byCh[ch.n].severity = 'error';
      else if (warnIds.has(a.id) && byCh[ch.n].severity !== 'error') byCh[ch.n].severity = 'warn';
    });

    function row(c) {
      const info = byCh[c.n];
      const used = info.tx.length > 0;
      const sev = info.severity;
      const hasAna = info.tx.some((t) => (t.mode || 'analog') === 'analog');
      const hasDig = info.tx.some((t) => t.mode === 'digital');
      const modeCls = hasDig && hasAna ? 'mixed' : hasDig ? 'digital' : hasAna ? 'analog' : '';
      const sevCls = sev === 'error' ? 'err' : sev === 'warn' ? 'warn' : (used ? 'used' : 'free');
      const dlbl = D.digitalFullLabel(c) || '';
      const dgrp = (c.digitalGroups && c.digitalGroups[0]) || '';
      const r7 = c.ramsaG7 || '';
      const txList = info.tx.map((t) => escape(t.name)).join(' / ');
      const status = used
        ? `<strong>${txList}</strong>`
        : '<span class="free-mark">—</span>';
      return `<tr class="freq-row ${sevCls} ${modeCls}">
        <td class="ch-n">${c.n}</td>
        <td class="freq">${c.freq.toFixed(3)}</td>
        <td class="ch-label">${c.label}</td>
        <td class="grp"><small>${c.groups.join(' / ')}</small></td>
        <td class="ch-label ramsa-g7-cell">${r7 ? `<strong>${r7}</strong>` : '<span class="dim">—</span>'}</td>
        <td class="ch-label digital-cell">${escape(dlbl)}</td>
        <td class="grp"><small>${dgrp}</small></td>
        <td class="status">${status}</td>
      </tr>`;
    }

    return `
      <h3 class="sub">周波数表 (30波・使用中チャンネル色表示)</h3>
      <div class="freq-legend">
        <span class="lg-item"><span class="lg-swatch analog"></span>アナログ使用中</span>
        <span class="lg-item"><span class="lg-swatch digital"></span>デジタル使用中</span>
        <span class="lg-item"><span class="lg-swatch warn"></span>警告</span>
        <span class="lg-item"><span class="lg-swatch err"></span>エラー</span>
        <span class="lg-item"><span class="lg-swatch free"></span>未使用</span>
      </div>
      <div class="freq-table-wrap">
        <table class="freq-table">
          <thead>
            <tr>
              <th>#</th>
              <th>周波数<small>(MHz)</small></th>
              <th>アナログ<small>呼称</small></th>
              <th>アナロググループ</th>
              <th>RAMSA<small>「7」G(B71〜B77)</small></th>
              <th>RAMSAデジタル<small>呼称(G/CH)</small></th>
              <th>デジタル<small>グループ</small></th>
              <th>使用状況</th>
            </tr>
          </thead>
          <tbody>
            ${D.CHANNELS.map(row).join('')}
          </tbody>
        </table>
      </div>
      <p class="hint small" style="margin-top:6px">
        ※ 同じ周波数を <strong>アナログ呼称(B11等)</strong> / <strong>RAMSA「7」グループ呼称(B71〜B77)</strong> /
        <strong>RAMSAデジタル呼称(BF1 (31/01)等)</strong> で並列表記しています。<br>
        ※ <strong>RAMSA「7」グループ</strong>は WX-TB841/WX-TB840 取説準拠の7波運用 (1〜6Gから選定)。
        Sony B-7/B-8 とは別仕様で、<strong>送信機間の距離に十分注意</strong>が必要 (5mW: 0.5m / 10mW: 1.0m 以上)。
      </p>
    `;
  }

  // ===================================================
  // メニュー画面 (プリセット, エクスポート, 設定, ヘルプ)
  // ===================================================
  function renderMenu() {
    const root = document.getElementById('view-menu');
    root.innerHTML = `
      <div class="page-head"><h2>メニュー</h2></div>

      <div class="card">
        <h3>プリセット</h3>
        <p class="hint">現在のチャンネル割当に名前を付けて保存できます。</p>
        <div class="row">
          <input id="preset-name" type="text" placeholder="プリセット名 (例: ホール本番1)" />
          <button class="btn btn-primary" id="btn-save-preset">現在の割当を保存</button>
        </div>
        <div id="preset-list" class="preset-list"></div>
      </div>

      <div class="card">
        <h3>エクスポート</h3>
        <p class="hint">運用シートとして印刷したり、CSVで保存できます。</p>
        <div class="row">
          <button class="btn btn-primary" id="btn-print">PDF出力 (印刷)</button>
          <button class="btn" id="btn-csv">CSVダウンロード</button>
          <button class="btn btn-ghost" id="btn-copy">クリップボードにCSVコピー</button>
        </div>
      </div>

      <div class="card">
        <h3>設定</h3>
        <label class="field">
          <span>IMD許容差 (MHz) — 既定 0.025 (25 kHz)</span>
          <input id="set-imd" type="number" step="0.005" min="0" max="0.2" value="${settings.imdTolerance}" />
        </label>
        <label class="field">
          <span>隣接警告距離 (MHz) — 既定 0.250</span>
          <input id="set-adj" type="number" step="0.025" min="0" max="1.0" value="${settings.adjacentLimit}" />
        </label>
        <button class="btn btn-primary" id="btn-save-settings">設定を保存</button>
      </div>

      <div class="card">
        <h3>ヘルプ・参考</h3>
        <ul class="help">
          <li><strong>B帯:</strong> 806.125〜809.750 MHz、125 kHz間隔、計30波。免許不要 (技適マーク必須)。</li>
          <li><strong>アナログ チャンネル呼称:</strong> <code>B11〜B46</code>。標準グループは <strong>B-1〜B-4</strong> (各6波) / <strong>B-5</strong> (5波) / <strong>B-6</strong> (1波) / <strong>B-7</strong>・<strong>B-8</strong> (各7波・択一) 。Sony 周波数リスト 4-530-738-01 準拠。</li>
          <li><strong>RAMSAデジタル チャンネル呼称:</strong> <code>BF1, BE1, BD1, BC1, BB1, BA1, BF2, ...</code> (B + A〜F + 連番)。グループ <strong>31 / 32 / 33</strong> の3グループ、各 <strong>10波・375kHz等間隔</strong>。</li>
          <li><strong>デジタル運用:</strong> 同じグループ内のチャンネルを使えば 375kHz 間隔でクリーンに最大10波運用可能 (Panasonic 公式 周波数表参照)。</li>
          <li><strong>アナログB帯:</strong> 占有帯域 約110kHz。同時運用は通常 6〜7波まで (B-1〜B-7 グループ参照)。</li>
          <li><strong>デジタルB帯:</strong> 占有帯域 約192kHz。アナログより干渉耐性が高く、375kHz等間隔運用で最大10波程度。</li>
          <li><strong>アナログ・デジタル混在運用:</strong> 占有帯域幅が異なるため隣接距離の確認が必要。本アプリでは方式が異なるペアの隣接距離も自動チェック。</li>
          <li><strong>IMD (相互変調歪) 3次:</strong> 2×f1−f2 や f1+f2−f3 で生成される妨害波。本アプリで自動チェック。</li>
          <li><strong>このアプリのデータはブラウザの LocalStorage に保存されます。</strong> 機種変更・キャッシュ削除で消えるため、重要なプリセットはCSV保存をおすすめします。</li>
        </ul>
        <p class="hint small">※ 周波数表・占有帯域幅は公開資料 (JVC WT-900, Panasonic WX-TB841/WX-DT135 取説, Panasonic WX-DR131 周波数表(800MHz帯) PGQW1833ZAJ1, Sony UWP-D21 仕様書, デジタルB帯の解説記事等) を参考に作成しています。実機運用時は各機の取扱説明書で最終確認してください。</p>
      </div>
    `;

    renderPresetList();

    document.getElementById('btn-save-preset').onclick = () => {
      const name = document.getElementById('preset-name').value.trim();
      if (!name) { alert('プリセット名を入力してください'); return; }
      const snap = inventory.map((d) => ({ id: d.id, model: d.model, maker: d.maker, type: d.type, name: d.name, assignedCh: d.assignedCh }));
      presets.push({ id: newId(), name, savedAt: new Date().toISOString(), inventory: snap });
      persistAll();
      document.getElementById('preset-name').value = '';
      renderPresetList();
      showToast('プリセットを保存しました');
    };

    document.getElementById('btn-print').onclick = () => {
      const list = txAssignments();
      const issues = IMD.analyze(list, settings);
      EXP.printPDF(inventory, issues);
    };
    document.getElementById('btn-csv').onclick = () => {
      const list = txAssignments();
      const issues = IMD.analyze(list, settings);
      EXP.downloadCSV(null, inventory, issues);
      showToast('CSVを出力しました');
    };
    document.getElementById('btn-copy').onclick = async () => {
      const list = txAssignments();
      const issues = IMD.analyze(list, settings);
      const csv = EXP.toCSV(inventory, issues);
      try {
        await navigator.clipboard.writeText(csv);
        showToast('CSVをクリップボードにコピーしました');
      } catch (e) {
        alert('クリップボードへのコピーに失敗しました: ' + e.message);
      }
    };

    document.getElementById('btn-save-settings').onclick = () => {
      settings.imdTolerance = parseFloat(document.getElementById('set-imd').value) || 0.025;
      settings.adjacentLimit = parseFloat(document.getElementById('set-adj').value) || 0.250;
      persistAll();
      showToast('設定を保存しました');
    };
  }

  function renderPresetList() {
    const wrap = document.getElementById('preset-list');
    if (!wrap) return;
    if (presets.length === 0) {
      wrap.innerHTML = '<div class="empty">保存されたプリセットはありません</div>';
      return;
    }
    wrap.innerHTML = presets.map((p) => `
      <div class="preset-row">
        <div>
          <strong>${escape(p.name)}</strong>
          <small>${new Date(p.savedAt).toLocaleString('ja-JP')} / 機材${p.inventory.length}</small>
        </div>
        <div>
          <button class="btn" data-act="load" data-id="${p.id}">読込</button>
          <button class="btn btn-ghost" data-act="delp" data-id="${p.id}">削除</button>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-act="load"]').forEach((b) => b.onclick = () => {
      const p = presets.find((x) => x.id === b.dataset.id);
      if (!p) return;
      if (!confirm(`プリセット「${p.name}」を読み込みます。現在のインベントリは置き換えられます。よろしいですか？`)) return;
      inventory = JSON.parse(JSON.stringify(p.inventory));
      persistAll();
      showToast('プリセットを読み込みました');
      showView('inventory');
    });
    wrap.querySelectorAll('[data-act="delp"]').forEach((b) => b.onclick = () => {
      const p = presets.find((x) => x.id === b.dataset.id);
      if (!p) return;
      if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return;
      presets = presets.filter((x) => x.id !== p.id);
      persistAll();
      renderPresetList();
    });
  }

  // ===================================================
  // モーダル / トースト
  // ===================================================
  function showModal(html) {
    const overlay = document.getElementById('modal-overlay');
    const body = document.getElementById('modal-body');
    body.innerHTML = html;
    overlay.classList.add('active');
    body.querySelectorAll('[data-modal-close]').forEach((b) => b.onclick = closeModal);
  }
  function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
  }
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ===================================================
  // 起動
  // ===================================================
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.onclick = () => showView(b.dataset.view);
    });
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') closeModal();
    });
    showView('inventory');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
  });
})();
