'use strict';

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain } = require('electron');
const path  = require('path');
const http  = require('http');
const isDev = process.argv.includes('--dev');
const PORT  = 3737;
const CLOUD_URL = 'https://fiscobot.onrender.com';
const USE_CLOUD = true; // Altere para false para usar o servidor local do seu PC

// ── Single instance lock ──────────────────────────
// Se já existe uma instância rodando, foca ela e encerra esta
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let tray       = null;

// ── Inicia o servidor Express interno ─────────────
function startServer() {
  return new Promise((resolve, reject) => {
    process.env.FISCOBOT_ELECTRON = '1';
    require('./server.js');

    let attempts = 0;
    const MAX_ATTEMPTS = 75; // 15 segundos máximo (75 × 200ms)

    const check = setInterval(() => {
      attempts++;
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(check);
        reject(new Error('Servidor não iniciou em 15 segundos.'));
        return;
      }
      http.get(`http://127.0.0.1:${PORT}`, (res) => {
        if (res.statusCode < 500) {
          clearInterval(check);
          resolve();
        }
      }).on('error', () => {});
    }, 200);
  });
}

// ── Cria a janela principal ───────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width:           1280,
    height:          800,
    minWidth:        900,
    minHeight:       600,
    title:           'FiscoBot Pro',
    icon:            iconPath,
    backgroundColor: '#070d1a',
    show:            false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.js'),
    },
  });

  // Remove menu padrão (F10, Alt etc.)
  Menu.setApplicationMenu(null);

  // Carrega o app via Servidor na Nuvem ou Local conforme configurado acima
  const targetURL = USE_CLOUD ? `${CLOUD_URL}/login` : `http://127.0.0.1:${PORT}`;
  mainWindow.loadURL(targetURL);

  // Mostra a janela após carregar
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  // Minimiza para bandeja ao clicar em fechar
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Links externos abrem no navegador do sistema
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Ícone na bandeja do sistema ───────────────────
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();

  tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    { label: '⚡ FiscoBot Pro', enabled: false },
    { type: 'separator' },
    {
      label: '📋 Abrir FiscoBot',
      click: () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        else createWindow();
      },
    },
    {
      label: '🌐 Abrir no navegador',
      click: () => shell.openExternal(`http://localhost:${PORT}`),
    },
    { type: 'separator' },
    {
      label: '🚪 Sair do FiscoBot',
      click: () => { app.isQuiting = true; app.quit(); },
    },
  ]);

  tray.setToolTip('FiscoBot Pro — Automação Fiscal');
  tray.setContextMenu(menu);

  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    else createWindow();
  });
}

// ── IPC handlers ──────────────────────────────────
ipcMain.handle('app:version',     () => app.getVersion());
ipcMain.handle('app:quit',        () => { app.isQuiting = true; app.quit(); });
ipcMain.handle('app:minimize',    () => mainWindow?.minimize());
ipcMain.handle('app:maximize',    () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.handle('app:hide',        () => mainWindow?.hide());
ipcMain.handle('app:openDataDir', (_, dir) => shell.openPath(dir));

// ── Lifecycle ─────────────────────────────────────
app.whenReady().then(async () => {
  // Segunda instância tenta abrir → foca a janela principal existente
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  try {
    await startServer();
  } catch(e) {
    const { dialog } = require('electron');
    dialog.showErrorBox('FiscoBot — Erro de Inicialização',
      `O servidor interno não conseguiu iniciar.\n\n${e.message}\n\nVerifique se outra aplicação está usando a porta ${PORT}.`);
    app.quit();
    return;
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') app.quit();
  // Windows/Linux: fica na bandeja
});

app.on('before-quit', () => { app.isQuiting = true; });
