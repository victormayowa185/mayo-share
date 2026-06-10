import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import os from 'os';

let mainWindow: BrowserWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Dev vs Prod loading
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../frontend/index.html'));
  }
}

// ===== IPC HANDLERS - these fix your crash =====
ipcMain.handle('get-platform', () => {
  return process.platform; // 'win32', 'darwin', 'linux'
});

ipcMain.handle('get-local-ip', () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' &&!iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
});

ipcMain.handle('get-wifi-ssid', async () => {
  // For now return null. Later we can add wifi-name package
  return null;
});

ipcMain.handle('check-hotspot-status', async () => {
  // Basic version for now
  return { active: false, ip: null };
});

// Stub handlers so your app doesn't crash on other calls
ipcMain.handle('get-activity', () => []);
ipcMain.handle('get-language', () => 'en');
ipcMain.handle('set-language', () => {});
ipcMain.handle('get-save-path', () => os.homedir());
ipcMain.handle('ping', () => 'pong');

// ===== App lifecycle =====
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform!== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});