// =============================================================
// B帯（800MHz帯）ワイヤレスマイク 周波数表 + 機材マスタ
// 出典:
//   - アナログ: Sony 周波数リスト 4-530-738-01 (B型 全30CH / グループ ALL, B-1〜B-8) /
//               JVC WT-900 周波数一覧表 / Panasonic WX-TB841 取扱説明書
//   - デジタル: Panasonic WX-DR131 周波数表(800MHz帯) PGQW1833ZAJ1
//
// アナログB帯:
//   806.125 MHz 〜 809.750 MHz, 125 kHz 間隔, 計 30 波
//   グループ B-1 〜 B-4 : 各 6 波同時運用 (Sony / Panasonic 共通の標準グループ)
//   グループ B-5       : 5 波同時運用
//   グループ B-6       : 1 波 (B61 のみ)
//   グループ B-7 / B-8 : 各 7 波同時運用 (Sony 公式の拡張グループ)
//                       同一エリアでは B-7 か B-8 のどちらか一方を選択して使う
//
// RAMSA デジタルB帯 (WX-DT135 等):
//   同じ 30 波の周波数グリッドを使用するが、独自のチャンネル呼称とグループ:
//     CH呼称: B□△ (□ = A,B,C,D,E,F、△ = 1〜5)
//     グループ: 31, 32, 33  (各10波、375 kHz 等間隔)
//
// 注: デジタル機種を運用する場合はデジタル側の呼称・グループを使う。アナログ機種運用時は B11〜B46 の呼称を使う。
// =============================================================

(function (global) {
  'use strict';

  // 30波の基本テーブル（番号は B帯連番 1〜30）
  // freq        : 周波数 [MHz]
  // label       : アナログ B帯のチャンネル呼称 (B11 等)
  // groups      : アナログのグループ (B-1〜B-7)
  // digitalLabel: RAMSA デジタル B帯のチャンネル呼称 (BF1 等)
  // digitalGroups: デジタルのグループ (31, 32, 33)
  // アナログ groups は Sony 公式 4-530-738-01 に準拠
  //   B-7 = { B11, B12, B33, B36, B52, B54, B55 }
  //   B-8 = { B21, B31, B13, B14, B25, B16, B46 }
  const CHANNELS = [
    { n: 1,  freq: 806.125, label: 'B11', groups: ['B-1', 'B-7'], digitalLabel: 'BF1', digitalGroups: ['31'], ramsaG7: 'B71' },
    { n: 2,  freq: 806.250, label: 'B21', groups: ['B-2', 'B-8'], digitalLabel: 'BD1', digitalGroups: ['32'] },
    { n: 3,  freq: 806.375, label: 'B12', groups: ['B-1', 'B-7'], digitalLabel: 'BB1', digitalGroups: ['33'], ramsaG7: 'B72' },
    { n: 4,  freq: 806.500, label: 'B22', groups: ['B-2'],        digitalLabel: 'BE1', digitalGroups: ['31'] },
    { n: 5,  freq: 806.625, label: 'B31', groups: ['B-3', 'B-8'], digitalLabel: 'BC1', digitalGroups: ['32'] },
    { n: 6,  freq: 806.750, label: 'B41', groups: ['B-4'],        digitalLabel: 'BA1', digitalGroups: ['33'] },
    { n: 7,  freq: 806.875, label: 'B32', groups: ['B-3'],        digitalLabel: 'BF2', digitalGroups: ['31'], ramsaG7: 'B73' },
    { n: 8,  freq: 807.000, label: 'B23', groups: ['B-2'],        digitalLabel: 'BD2', digitalGroups: ['32'] },
    { n: 9,  freq: 807.125, label: 'B13', groups: ['B-1', 'B-8'], digitalLabel: 'BB2', digitalGroups: ['33'] },
    { n: 10, freq: 807.250, label: 'B61', groups: ['B-6'],        digitalLabel: 'BE2', digitalGroups: ['31'] },
    { n: 11, freq: 807.375, label: 'B33', groups: ['B-3', 'B-7'], digitalLabel: 'BC2', digitalGroups: ['32'] },
    { n: 12, freq: 807.500, label: 'B42', groups: ['B-4'],        digitalLabel: 'BA2', digitalGroups: ['33'], ramsaG7: 'B74' },
    { n: 13, freq: 807.625, label: 'B51', groups: ['B-5'],        digitalLabel: 'BF3', digitalGroups: ['31'] },
    { n: 14, freq: 807.750, label: 'B14', groups: ['B-1', 'B-8'], digitalLabel: 'BD3', digitalGroups: ['32'] },
    { n: 15, freq: 807.875, label: 'B24', groups: ['B-2'],        digitalLabel: 'BB3', digitalGroups: ['33'] },
    { n: 16, freq: 808.000, label: 'B43', groups: ['B-4'],        digitalLabel: 'BE3', digitalGroups: ['31'] },
    { n: 17, freq: 808.125, label: 'B52', groups: ['B-5', 'B-7'], digitalLabel: 'BC3', digitalGroups: ['32'] },
    { n: 18, freq: 808.250, label: 'B34', groups: ['B-3'],        digitalLabel: 'BA3', digitalGroups: ['33'] },
    { n: 19, freq: 808.375, label: 'B53', groups: ['B-5'],        digitalLabel: 'BF4', digitalGroups: ['31'] },
    { n: 20, freq: 808.500, label: 'B25', groups: ['B-2', 'B-8'], digitalLabel: 'BD4', digitalGroups: ['32'], ramsaG7: 'B75' },
    { n: 21, freq: 808.625, label: 'B35', groups: ['B-3'],        digitalLabel: 'BB4', digitalGroups: ['33'] },
    { n: 22, freq: 808.750, label: 'B54', groups: ['B-5', 'B-7'], digitalLabel: 'BE4', digitalGroups: ['31'] },
    { n: 23, freq: 808.875, label: 'B26', groups: ['B-2'],        digitalLabel: 'BC4', digitalGroups: ['32'] },
    { n: 24, freq: 809.000, label: 'B15', groups: ['B-1'],        digitalLabel: 'BA4', digitalGroups: ['33'] },
    { n: 25, freq: 809.125, label: 'B44', groups: ['B-4'],        digitalLabel: 'BF5', digitalGroups: ['31'] },
    { n: 26, freq: 809.250, label: 'B36', groups: ['B-3', 'B-7'], digitalLabel: 'BD5', digitalGroups: ['32'] },
    { n: 27, freq: 809.375, label: 'B45', groups: ['B-4'],        digitalLabel: 'BB5', digitalGroups: ['33'], ramsaG7: 'B76' },
    { n: 28, freq: 809.500, label: 'B16', groups: ['B-1', 'B-8'], digitalLabel: 'BE5', digitalGroups: ['31'] },
    { n: 29, freq: 809.625, label: 'B55', groups: ['B-5', 'B-7'], digitalLabel: 'BC5', digitalGroups: ['32'] },
    { n: 30, freq: 809.750, label: 'B46', groups: ['B-4', 'B-8'], digitalLabel: 'BA5', digitalGroups: ['33'], ramsaG7: 'B77' }
  ];

  // RAMSA (Panasonic) アナログ「7」グループ (WX-TB841/WX-TB840 取扱説明書 準拠)
  // 1〜6グループから選定された7波。Sony B-7/B-8 とは別仕様 (送信機間距離に十分注意して運用)。
  //   出力 5mW : 送信機間 0.5m以上 / アンテナとの距離 5m以上
  //   出力 10mW: 送信機間 1.0m以上 / アンテナとの距離 10m以上
  // 構成: B71=B11, B72=B12, B73=B32, B74=B42, B75=B25, B76=B45, B77=B46

  // グループメタ情報
  const GROUPS = {
    // アナログB帯 (Sony 4-530-738-01 準拠)
    'B-1': { name: 'B-1', count: 6, color: '#ef4444', desc: '6波同時運用 (B11/B12/B13/B14/B15/B16)', domain: 'analog' },
    'B-2': { name: 'B-2', count: 6, color: '#f97316', desc: '6波同時運用 (B21〜B26)', domain: 'analog' },
    'B-3': { name: 'B-3', count: 6, color: '#eab308', desc: '6波同時運用 (B31〜B36)', domain: 'analog' },
    'B-4': { name: 'B-4', count: 6, color: '#22c55e', desc: '6波同時運用 (B41〜B46)', domain: 'analog' },
    'B-5': { name: 'B-5', count: 5, color: '#06b6d4', desc: '5波同時運用 (B51〜B55)', domain: 'analog' },
    'B-6': { name: 'B-6', count: 1, color: '#6366f1', desc: '1波 (B61)', domain: 'analog' },
    'B-7': { name: 'B-7', count: 7, color: '#a855f7', desc: '7波同時運用 (B11/B12/B33/B36/B52/B54/B55) — B-8と択一', domain: 'analog' },
    'B-8': { name: 'B-8', count: 7, color: '#ec4899', desc: '7波同時運用 (B21/B31/B13/B14/B25/B16/B46) — B-7と択一', domain: 'analog' },
    // RAMSA デジタル B帯 (375kHz 等間隔)
    '31':  { name: 'グループ31', count: 10, color: '#0ea5e9', desc: 'デジタル 10波 / 375kHz間隔 (BF1/BE1/BF2/BE2/BF3/BE3/BF4/BE4/BF5/BE5)', domain: 'digital' },
    '32':  { name: 'グループ32', count: 10, color: '#10b981', desc: 'デジタル 10波 / 375kHz間隔 (BD1/BC1/BD2/BC2/BD3/BC3/BD4/BC4/BD5/BC5)', domain: 'digital' },
    '33':  { name: 'グループ33', count: 10, color: '#d946ef', desc: 'デジタル 10波 / 375kHz間隔 (BB1/BA1/BB2/BA2/BB3/BA3/BB4/BA4/BB5/BA5)', domain: 'digital' }
  };

  // 機種マスタ (model -> spec)
  //   maker:          メーカー名 (将来別メーカー追加可)
  //   type:           'TX' (送信機/マイク) のみ運用 (受信機は本アプリでは扱わない)
  //   band:           使用周波数帯 (今回は B帯のみ運用前提)
  //   mode:           'analog' (アナログB帯) または 'digital' (デジタルB帯)
  //   occupiedWidth:  占有周波数帯幅 (MHz)。アナログ ≈ 0.110、デジタル ≈ 0.192
  //   channels:       使用可能チャンネル番号 (1〜30 のサブセット)。null = 全30波対応
  //   preferred:      true: インベントリ画面のカウンタ行に表示する主要機種
  //   displayOrder:   カウンタ行の並び順
  //
  // 別メーカーの送信機を追加する場合は、ここに同じ形式でエントリを追加して preferred:true をセットすればカウンタに自動表示される。
  const MODELS = {
    // ===== Panasonic / RAMSA =====
    'WX-DT135': {
      maker: 'Panasonic', type: 'TX', band: 'B',
      mode: 'digital', occupiedWidth: 0.192, channels: null,
      preferred: true, displayOrder: 1,
      note: 'RAMSA B帯 デジタル 2ピース型送信機 (占有帯域 192kHz)'
    },
    'WX-TB841': {
      maker: 'Panasonic', type: 'TX', band: 'B',
      mode: 'analog', occupiedWidth: 0.110, channels: null,
      preferred: true, displayOrder: 2,
      note: 'RAMSA B帯 アナログ ハンドヘルド送信機 (PLLシンセ)'
    },

    // ===== Sony =====
    'UTX-B40': {
      maker: 'Sony', type: 'TX', band: 'B',
      mode: 'analog', occupiedWidth: 0.110, channels: null,
      preferred: true, displayOrder: 3,
      note: 'Sony B帯 アナログ ボディパック送信機 (UWP-D21対応)'
    }
  };

  // カウンタ行に表示する主要機種の順序 (MODELS の displayOrder に従う)
  function preferredModels() {
    return Object.keys(MODELS)
      .filter((k) => MODELS[k].preferred)
      .sort((a, b) => (MODELS[a].displayOrder || 999) - (MODELS[b].displayOrder || 999));
  }

  // モード別の推奨最小間隔 (MHz)
  //   analog/analog : 0.250 (隣接警告) — 同一グループならOK扱い
  //   digital/digital: 0.375 (記事 / 主要メーカーの推奨等間隔)
  //   mixed (analog<->digital): 0.250 (占有幅の和の半分 + マージン)
  const SPACING_BY_MODE = {
    'analog/analog':   0.250,
    'analog/digital':  0.250,
    'digital/analog':  0.250,
    'digital/digital': 0.375
  };
  function minSpacing(modeA, modeB) {
    const key = (modeA || 'analog') + '/' + (modeB || 'analog');
    return SPACING_BY_MODE[key] != null ? SPACING_BY_MODE[key] : 0.250;
  }

  // 初回起動時にロードするデフォルト機材リスト
  // 主要3機種だけ。本数は後でカウンタで自由に変更できる。
  const DEFAULT_INVENTORY_TEMPLATE = [
    { model: 'WX-DT135', count: 2 },
    { model: 'WX-TB841', count: 6 },
    { model: 'UTX-B40',  count: 3 }
  ];

  function buildDefaultInventory() {
    const list = [];
    let idCounter = 1;
    DEFAULT_INVENTORY_TEMPLATE.forEach((entry) => {
      for (let i = 1; i <= entry.count; i++) {
        const spec = MODELS[entry.model];
        list.push({
          id: 'd' + (idCounter++),
          model: entry.model,
          maker: spec ? spec.maker : '',
          type: spec ? spec.type : 'TX',
          mode: spec ? spec.mode : 'analog',
          occupiedWidth: spec ? spec.occupiedWidth : 0.110,
          name: entry.model + ' #' + i, // 連番は常に付与 (#1, #2, ...)
          assignedCh: null,
          linkedTo: null
        });
      }
    });
    return list;
  }

  // チャンネル検索ヘルパー
  function getChannelByNumber(n) {
    return CHANNELS.find((c) => c.n === n) || null;
  }
  function getChannelByLabel(label) {
    // アナログ呼称・デジタル呼称どちらでも検索できる
    return (
      CHANNELS.find((c) => c.label === label) ||
      CHANNELS.find((c) => c.digitalLabel === label) ||
      null
    );
  }
  function channelsInGroup(group) {
    // アナロググループ(B-1〜B-7) にもデジタルグループ(31/32/33) にも対応
    return CHANNELS.filter((c) =>
      (c.groups && c.groups.includes(group)) ||
      (c.digitalGroups && c.digitalGroups.includes(group))
    );
  }

  // RAMSA デジタル B帯のグループ内スロット番号 (01〜10) を返す。
  //   B帯30波は周波数昇順に 31, 32, 33 と循環するため、
  //   slot = ceil(n / 3)  (n = 1..30)
  //   例: BF1(n=1) → 01, BE1(n=4) → 02, ..., BA5(n=30) → 10
  function digitalSlot(channel) {
    if (!channel || !channel.digitalLabel) return null;
    return Math.ceil(channel.n / 3);
  }
  // 'BF1 (31/01)' のように呼称とグループ/スロットを組合せた文字列を返す
  function digitalFullLabel(channel) {
    if (!channel || !channel.digitalLabel) return '';
    const slot = String(digitalSlot(channel)).padStart(2, '0');
    const group = (channel.digitalGroups && channel.digitalGroups[0]) || '';
    return channel.digitalLabel + ' (' + group + '/' + slot + ')';
  }

  // モードに応じたチャンネル呼称を返す。
  //   mode='analog'  → 'B11'           (アナログB帯のCH呼称)
  //   mode='digital' → 'BF1 (31/01)'   (CH呼称 + グループ/スロット)
  function labelOf(channel, mode) {
    if (!channel) return '';
    if (mode === 'digital' && channel.digitalLabel) return digitalFullLabel(channel);
    return channel.label;
  }
  // CH呼称のみ (短縮版) — SVG軸ラベル等のスペース制約がある場所向け
  function labelShort(channel, mode) {
    if (!channel) return '';
    if (mode === 'digital' && channel.digitalLabel) return channel.digitalLabel;
    return channel.label;
  }
  // 両表記を「BF1 / B11」で返す（中立コンテキスト用）
  function labelBoth(channel) {
    if (!channel) return '';
    if (channel.digitalLabel && channel.digitalLabel !== channel.label) {
      return channel.digitalLabel + ' / ' + channel.label;
    }
    return channel.label;
  }
  // モードに応じたグループ配列を返す
  function groupsOf(channel, mode) {
    if (!channel) return [];
    if (mode === 'digital') return channel.digitalGroups || [];
    return channel.groups || [];
  }

  // export
  global.WMP_DATA = {
    CHANNELS,
    GROUPS,
    MODELS,
    preferredModels,
    SPACING_BY_MODE,
    minSpacing,
    DEFAULT_INVENTORY_TEMPLATE,
    buildDefaultInventory,
    getChannelByNumber,
    getChannelByLabel,
    channelsInGroup,
    labelOf,
    labelShort,
    labelBoth,
    digitalSlot,
    digitalFullLabel,
    groupsOf,
    BAND_MIN: 806.125,
    BAND_MAX: 809.750,
    CH_SPACING: 0.125
  };
})(typeof window !== 'undefined' ? window : globalThis);
