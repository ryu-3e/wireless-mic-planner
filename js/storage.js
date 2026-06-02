// =============================================================
// LocalStorage ラッパー（インベントリ + プリセット保存）
// =============================================================

(function (global) {
  'use strict';

  const KEY_INVENTORY = 'wmp.inventory.v1';
  const KEY_PRESETS = 'wmp.presets.v1';
  const KEY_SETTINGS = 'wmp.settings.v1';

  function loadInventory() {
    try {
      const raw = localStorage.getItem(KEY_INVENTORY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function saveInventory(inv) {
    localStorage.setItem(KEY_INVENTORY, JSON.stringify(inv));
  }

  function loadPresets() {
    try {
      const raw = localStorage.getItem(KEY_PRESETS);
      if (!raw) return [];
      return JSON.parse(raw) || [];
    } catch (e) { return []; }
  }
  function savePresets(arr) {
    localStorage.setItem(KEY_PRESETS, JSON.stringify(arr));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(KEY_SETTINGS);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) { return {}; }
  }
  function saveSettings(s) {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
  }

  global.WMP_STORE = {
    loadInventory, saveInventory,
    loadPresets, savePresets,
    loadSettings, saveSettings
  };
})(typeof window !== 'undefined' ? window : globalThis);
