'use strict';

/**
 * electron/main.cjs — Chassis Workbench Desktop Application
 *
 * Responsibilities:
 *  1. Spawn Python FastAPI backend (uvicorn) as a child process
 *  2. Wait for backend to be ready (health-check polling)
 *  3. Create the main BrowserWindow and load the built React app
 *  4. Provide a native application menu
 *  5. Handle IPC calls from the renderer (file dialogs, file I/O)
 *  6. Kill the Python backend cleanly on app quit
 */

const { app, BrowserWindow, shell, ipcMain, dialog, Menu } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn, execSync } = require('child_process');

// ─── Paths ───────────────────────────────────────────────────────────────────

const DIST_DIR      = path.join(__dirname, '..', 'dist');
const PROJECT_ROOT  = path.join(__dirname, '..', '..'); // /Moter_bike
const PYTHON_BIN    = findPython();
const API_PORT      = 8770;   // 8000/8765 occupied by other projects (BatteryOS/WarrantyLens/drone_inspector)
const API_BASE      = `http://localhost:${API_PORT}`;

function findPython() {
  const candidates = [
    '/home/dikshant/miniconda3/bin/python3',
    '/usr/bin/python3',
    'python3',
    'python',
  ];
  for (const p of candidates) {
    try {
      execSync(`${p} --version`, { stdio: 'ignore' });
      return p;
    } catch { /* try next */ }
  }
  return 'python3'; // fallback
}

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow    = null;
let pythonProcess = null;
let backendReady  = false;

// ─── Python backend ───────────────────────────────────────────────────────────

function startPythonBackend() {
  console.log(`[electron] Spawning Python backend (${PYTHON_BIN}) …`);

  pythonProcess = spawn(
    PYTHON_BIN,
    ['-m', 'uvicorn', 'api.main:app', '--port', String(API_PORT), '--log-level', 'warning'],
    {
      cwd:   PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Strip ROS2 paths from PYTHONPATH — they cause uvicorn startup warnings
      // and can interfere with package resolution on systems with ROS Humble.
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONPATH: (process.env.PYTHONPATH || '')
          .split(':').filter(p => !p.includes('/opt/ros')).join(':'),
      },
    }
  );

  pythonProcess.stdout.on('data', d => console.log(`[uvicorn] ${d.toString().trim()}`));
  pythonProcess.stderr.on('data', d => console.log(`[uvicorn] ${d.toString().trim()}`));

  pythonProcess.on('exit', (code, sig) => {
    console.log(`[electron] Python backend exited (code=${code} sig=${sig})`);
    pythonProcess = null;
  });

  pythonProcess.on('error', err => {
    console.error('[electron] Failed to start Python backend:', err.message);
  });
}

function killPythonBackend() {
  if (!pythonProcess) return;
  console.log('[electron] Stopping Python backend …');
  pythonProcess.kill('SIGTERM');
  pythonProcess = null;
}

/**
 * Poll /api/health until the backend responds or timeout is reached.
 * Resolves true on success, false on timeout.
 */
function waitForBackend(timeoutMs = 15000) {
  return new Promise(resolve => {
    const start    = Date.now();
    const interval = setInterval(() => {
      http.get(`${API_BASE}/api/health`, res => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          backendReady = true;
          console.log('[electron] Python backend is ready.');
          resolve(true);
        }
      }).on('error', () => {
        // not ready yet — keep polling
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          console.warn('[electron] Python backend did not start in time. Continuing without it.');
          resolve(false);
        }
      });
    }, 500);
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1600,
    height:          960,
    minWidth:        1200,
    minHeight:       750,
    title:           'Chassis Workbench',
    backgroundColor: '#0d1117',
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration:    false,
      contextIsolation:   true,
      preload:            path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.loadFile(path.join(DIST_DIR, 'index.html'));

  // Open external links in real browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Application menu ─────────────────────────────────────────────────────────

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Config…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { filePaths } = await dialog.showOpenDialog(mainWindow, {
              title:      'Open Workbench Config',
              filters:    [{ name: 'JSON Config', extensions: ['json'] }],
              properties: ['openFile'],
            });
            if (filePaths[0]) {
              const data = fs.readFileSync(filePaths[0], 'utf-8');
              mainWindow.webContents.send('config:load', JSON.parse(data));
            }
          },
        },
        {
          label: 'Save Config…',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('config:save-request'),
        },
        { type: 'separator' },
        {
          label: 'Export CSV…',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow.webContents.send('export:csv'),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Toggle DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow && mainWindow.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Chassis Workbench',
          click: () => dialog.showMessageBox(mainWindow, {
            type:    'info',
            title:   'Chassis Workbench',
            message: 'Chassis Workbench',
            detail:  [
              'Professional Motorcycle Dynamics Simulation',
              'Physics: Cossalter (2006) + Foale (2006)',
              `Version: ${app.getVersion()}`,
              `Python backend: ${backendReady ? 'running' : 'offline'}`,
              `API: ${API_BASE}`,
            ].join('\n'),
          }),
        },
        {
          label: 'Reload App',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  // Renderer asks for backend status
  ipcMain.handle('backend:status', () => ({
    ready:   backendReady,
    apiBase: API_BASE,
  }));

  // Open file dialog
  ipcMain.handle('dialog:openFile', async (_, filters = []) => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters,
    });
    if (canceled || !filePaths[0]) return null;
    return filePaths[0];
  });

  // Save file dialog
  ipcMain.handle('dialog:saveFile', async (_, filters = [], defaultPath = '') => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      filters,
    });
    if (canceled || !filePath) return null;
    return filePath;
  });

  // Read file from disk
  ipcMain.handle('fs:readFile', async (_, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return null;
    }
  });

  // Write file to disk
  ipcMain.handle('fs:writeFile', async (_, filePath, content) => {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return true;
    } catch (e) {
      return false;
    }
  });

  // Save config (renderer sends data, main writes it via dialog)
  ipcMain.on('config:save', async (_, data) => {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: 'chassis-config.json',
      filters: [{ name: 'JSON Config', extensions: ['json'] }],
    });
    if (!canceled && filePath) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
  });

  // App info
  ipcMain.handle('app:info', () => ({
    version:     app.getVersion(),
    platform:    process.platform,
    pythonBin:   PYTHON_BIN,
    projectRoot: PROJECT_ROOT,
    backendReady,
    apiBase:     API_BASE,
  }));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerIPC();
  buildMenu();

  // Start Python backend in background, don't block window creation
  startPythonBackend();

  // Create window immediately — app works offline (client-side TS engine)
  createWindow();

  // Wait for backend in background and notify renderer when ready
  waitForBackend().then(ready => {
    if (mainWindow && ready) {
      mainWindow.webContents.send('backend:ready', { apiBase: API_BASE });
    }
  });
});

app.on('window-all-closed', () => {
  killPythonBackend();
  app.quit();
});

app.on('before-quit', () => {
  killPythonBackend();
});

// macOS: re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
