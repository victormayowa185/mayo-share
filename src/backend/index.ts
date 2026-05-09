import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import { FileServer } from './fileServer';
import { open, close, read, writeFile, appendFileSync } from 'fs';
import { statSync } from 'fs';
import fs from 'fs';
import os from 'os';

let mainWindow: BrowserWindow | null = null;
let currentHotspotIP = '192.168.137.1';   // default fallback

const HOTSPOT_SCRIPT = `
  \$staticIP       = "192.168.137.1"
  \$prefixLength   = 24

  function Log { param(\$msg) Write-Output "[\$(Get-Date -Format 'HH:mm:ss')] \$msg" }

  Log "=== Offline Hotspot Setup ==="

  if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
      Log "ERROR: Not running as Administrator"
      exit 1
  }

  \$adapter = Get-NetAdapter | Where-Object { \$_.InterfaceDescription -like "*KM-TEST*" -or \$_.InterfaceDescription -like "*Loopback*" } | Select-Object -First 1
  if (-not \$adapter) {
      Log "ERROR: Loopback adapter not found"
      exit 1
  }

  \$adapterName = \$adapter.Name
  Log "Using adapter: \$adapterName"

  if (\$adapter.Status -ne "Up") {
      Log "Enabling adapter..."
      Enable-NetAdapter -Name \$adapterName -Confirm:\$false
      Start-Sleep -Seconds 2
  }

  Log "Setting IP \$staticIP/\$prefixLength on '\$adapterName'..."
  Get-NetIPAddress -InterfaceAlias \$adapterName -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:\$false
  try {
      New-NetIPAddress -InterfaceAlias \$adapterName -IPAddress \$staticIP -PrefixLength \$prefixLength -ErrorAction Stop | Out-Null
      Log "Static IP configured."
  } catch {
      Log "WARNING: Could not set IP. \$_"
  }

  \$existingProfile = Get-NetConnectionProfile -InterfaceAlias \$adapterName -ErrorAction SilentlyContinue
  if (-not \$existingProfile) {
      Log "Creating network profile for \$adapterName..."
      try {
          New-NetConnectionProfile -InterfaceAlias \$adapterName -Name \$adapterName -NetworkCategory Private | Out-Null
          Log "Profile created. Waiting 2 seconds..."
          Start-Sleep -Seconds 2
      } catch {
          Log "ERROR: Could not create profile. \$_"
          exit 1
      }
  }

  \$profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetConnectionProfiles() | Where-Object { \$_.ProfileName -eq \$adapterName }
  if (-not \$profile) {
      Log "ERROR: Network profile not found"
      exit 1
  }
  Log "Found network profile: \$(\$profile.ProfileName)"

  Log "Starting mobile hotspot..."
  \$tetherManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile(\$profile)
  \$tetherManager.StartTetheringAsync()

  \$timeout = 15
  \$elapsed = 0
  do {
      Start-Sleep -Seconds 1
      \$elapsed++
      \$state = \$tetherManager.TetheringOperationalState
  } until (\$state -eq [Windows.Networking.NetworkOperators.TetheringOperationalState]::On -or \$elapsed -ge \$timeout)

  if (\$state -ne [Windows.Networking.NetworkOperators.TetheringOperationalState]::On) {
      Log "ERROR: Hotspot did not turn on. Final state: \$state"
      exit 1
  }

  # ----- FIND THE ACTUAL HOTSPOT IP (the one phones will use) -----
  \$hotspotAdapter = Get-NetAdapter -Name "*Local Area Connection*" -ErrorAction SilentlyContinue | Where-Object { \$_.InterfaceDescription -like "*Microsoft Wi-Fi Direct Virtual Adapter*" -or \$_.Name -like "*Local Area Connection*" }
  if (-not \$hotspotAdapter) {
      \$hotspotAdapter = Get-NetAdapter | Where-Object { \$_.Status -eq "Up" -and \$_.Name -ne \$adapterName -and \$_.InterfaceDescription -ne \$adapter.InterfaceDescription } | Select-Object -First 1
  }
  if (\$hotspotAdapter) {
      \$hotspotIP = Get-NetIPAddress -InterfaceAlias \$hotspotAdapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { \$_.IPAddress -ne \$staticIP } | Select-Object -ExpandProperty IPAddress -First 1
      if (-not \$hotspotIP) {
          \$hotspotIP = \$staticIP
      }
  } else {
      \$hotspotIP = \$staticIP
  }

  Log "Hotspot IP (for sharing): \$hotspotIP"
  Log "SUCCESS: Hotspot is ON"
  exit 0
  `;


const fileServer = new FileServer();

// ---------- Window ----------
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
}

// ---------- Hotspot ----------
ipcMain.handle('start-hotspot', async (): Promise<string> => {
  return new Promise((resolve) => {
    const tempScriptPath = path.join(os.tmpdir(), `mayo-hotspot-${Date.now()}.ps1`);

    try {
      fs.writeFileSync(tempScriptPath, HOTSPOT_SCRIPT, 'utf8');
    } catch (err) {
      resolve(`ERROR: Could not write temp script: ${err}`);
      return;
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempScriptPath],
      { timeout: 60000 },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tempScriptPath); } catch { }

        let output = stdout || '';
        if (stderr && !stdout) output += stderr;
        if (error) output += '\n[EXIT CODE]: ' + error.message;

        // Extract the hotspot IP from the script's output
        const ipMatch = output.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
        if (ipMatch && ipMatch[1]) {
          currentHotspotIP = ipMatch[1];
        }

        resolve(output || 'Script produced no output');
      }
    );
  });
});

// ---------- File selection ----------
ipcMain.handle('select-file', async (): Promise<string[] | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select files to share',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

// ---------- File server ----------
ipcMain.handle('start-file-server', async (_event, filePath: string): Promise<string> => {
  try {
    // Pass the detected hotspot IP and let the server listen on all interfaces
    const url = await fileServer.start(filePath, undefined, currentHotspotIP);
    return url;
  } catch (err) {
    throw new Error(`Could not start server: ${err}`);
  }
});

ipcMain.handle('stop-file-server', async (): Promise<void> => {
  fileServer.stop();
});

ipcMain.handle('get-file-size', async (_event, filePath: string): Promise<number> => {
  const stats = statSync(filePath);
  return stats.size;
});


// ---------- File chunking (for P2P) ----------

ipcMain.handle('read-file-chunk', async (_event, filePath: string, start: number, size: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Open file, read chunk, return as base64
    open(filePath, 'r', (err, fd) => {
      if (err) return reject(err);
      const buf = Buffer.alloc(size);
      read(fd, buf, 0, size, start, (err, bytesRead) => {
        close(fd, () => { });
        if (err) return reject(err);
        resolve(buf.slice(0, bytesRead).toString('base64'));
      });
    });
  });
});

// for file resume

ipcMain.handle('save-resume-state', async (_event, transferId: string, offset: number, filePath: string): Promise<void> => {
  const resumePath = path.join(os.tmpdir(), `mayo-resume-${transferId}.json`);
  await fs.promises.writeFile(resumePath, JSON.stringify({ offset, filePath }), 'utf8');
});

ipcMain.handle('get-resume-state', async (_event, transferId: string): Promise<{ offset: number; filePath: string } | null> => {
  const resumePath = path.join(os.tmpdir(), `mayo-resume-${transferId}.json`);
  try {
    const raw = await fs.promises.readFile(resumePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
});

ipcMain.handle('clear-resume-state', async (_event, transferId: string): Promise<void> => {
  const resumePath = path.join(os.tmpdir(), `mayo-resume-${transferId}.json`);
  try { await fs.promises.unlink(resumePath); } catch { }
});



ipcMain.handle('create-receive-file', async (_event, filePath: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, '');
});

ipcMain.handle('append-receive-chunk', async (_event, filePath: string, base64Data: string): Promise<void> => {
  const buf = Buffer.from(base64Data, 'base64');
  appendFileSync(filePath, buf);
});


fileServer.on('download-started', () => {
  mainWindow?.webContents.send('download-update', 'started');
});
fileServer.on('download-completed', () => {
  mainWindow?.webContents.send('download-update', 'completed');
});


ipcMain.handle('compress-sdp', async (_event, sdp: string): Promise<string> => {
  return Buffer.from(sdp, 'utf-8').toString('base64');
});

ipcMain.handle('decompress-sdp', async (_event, compact: string): Promise<string> => {
  return Buffer.from(compact, 'base64').toString('utf-8');
});

ipcMain.handle('ping', async () => 'pong');

// ---------- App startup ----------
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});