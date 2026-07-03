'use strict';

/**
 * electron/preload.cjs — Secure IPC bridge
 *
 * Exposes a controlled `window.electronAPI` object to the renderer.
 * contextIsolation=true ensures no direct Node.js access from the React app.
 *
 * API surface:
 *   window.electronAPI.isElectron        — always true in desktop app
 *   window.electronAPI.getInfo()         — app version, platform, backend status
 *   window.electronAPI.backendStatus()   — { ready, apiBase }
 *   window.electronAPI.openFile(filters) — native open-file dialog → path string
 *   window.electronAPI.saveFile(filters, defaultName) → path string
 *   window.electronAPI.readFile(path)    → file content string
 *   window.electronAPI.writeFile(path, content) → boolean
 *   window.electronAPI.saveConfig(data)  — save workbench config via dialog
 *   window.electronAPI.onConfigLoad(cb)  — receive config loaded from File menu
 *   window.electronAPI.onConfigSaveRequest(cb) — File > Save triggers this
 *   window.electronAPI.onExportCSV(cb)   — File > Export CSV triggers this
 *   window.electronAPI.onBackendReady(cb) — called when Python backend is up
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Identity ──────────────────────────────────────────────────────────────
  isElectron: true,

  // ── App info ──────────────────────────────────────────────────────────────
  getInfo: () => ipcRenderer.invoke('app:info'),

  // ── Backend status ────────────────────────────────────────────────────────
  backendStatus: () => ipcRenderer.invoke('backend:status'),

  // ── File dialogs ──────────────────────────────────────────────────────────
  /**
   * @param {Array<{name:string, extensions:string[]}>} filters
   * @returns {Promise<string|null>} absolute file path or null if cancelled
   */
  openFile: (filters = []) => ipcRenderer.invoke('dialog:openFile', filters),

  /**
   * @param {Array<{name:string, extensions:string[]}>} filters
   * @param {string} defaultPath
   * @returns {Promise<string|null>} absolute file path or null if cancelled
   */
  saveFile: (filters = [], defaultPath = '') =>
    ipcRenderer.invoke('dialog:saveFile', filters, defaultPath),

  // ── File I/O ──────────────────────────────────────────────────────────────
  /**
   * @param {string} filePath
   * @returns {Promise<string|null>} file content or null on error
   */
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),

  /**
   * @param {string} filePath
   * @param {string} content
   * @returns {Promise<boolean>} true on success
   */
  writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),

  // ── Config save (triggered from renderer, dialog in main) ─────────────────
  saveConfig: (data) => ipcRenderer.send('config:save', data),

  // ── Event subscriptions (main → renderer) ─────────────────────────────────
  onConfigLoad: (callback) => {
    ipcRenderer.on('config:load', (_, data) => callback(data));
  },

  onConfigSaveRequest: (callback) => {
    ipcRenderer.on('config:save-request', () => callback());
  },

  onExportCSV: (callback) => {
    ipcRenderer.on('export:csv', () => callback());
  },

  onBackendReady: (callback) => {
    ipcRenderer.on('backend:ready', (_, info) => callback(info));
  },

  // ── Cleanup (remove listeners) ────────────────────────────────────────────
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
