import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  powerSaveBlocker,
} from "electron";
import path from "path";
import { execFile } from "child_process";
import { FileServer } from "./fileServer";
import http from "http";
import { open, close, read, appendFileSync } from "fs";
import { DiscoveryManager } from "./discovery";
import { UploadServer, setReceiveDir } from "./uploadServer";
import { saveRating } from "./firebase";
import { startHotspot, stopHotspot, configureHotspot } from "./hotspot-mac";
import { HOTSPOT_IP } from "./hotspot-mac";
import { statSync } from "fs";

import fs from "fs";
import os from "os";

let mainWindow: BrowserWindow | null = null;
let powerSaveBlockerId: number | null = null;
let currentHotspotIP = "192.168.137.1";

const STOP_HOTSPOT_SCRIPT = `
  $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*KM-TEST*" -or $_.InterfaceDescription -like "*Loopback*" } | Select-Object -First 1
  if (-not $adapter) { exit 0 }
  $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetConnectionProfiles() | Where-Object { $_.ProfileName -eq $adapter.Name }
  if (-not $profile) { exit 0 }
  $tetherManager = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
  $tetherManager.StopTetheringAsync() | Out-Null
  Write-Output "Hotspot stopped"
`;

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

async function getBestIP(): Promise<string> {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (
        addr.family === "IPv4" &&
        !addr.internal &&
        !addr.address.startsWith("192.168.137.") &&
        !addr.address.startsWith("192.168.2.") &&
        !addr.address.startsWith("169.254.")
      ) {
        return addr.address;
      }
    }
  }
  return currentHotspotIP;
}

const defaultSaveDir = process.platform === "win32"
  ? "C:\\mayo-received"
  : path.join(os.homedir(), "mayo-received");
let currentSavePath = defaultSaveDir;

function getActivityLogPath() {
  return path.join(currentSavePath, "activity.json");
}

function getDeviceName(): string {
  try {
    const settingsPath = path.join(currentSavePath, "mayo-settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.deviceName) return settings.deviceName;
    }
  } catch { }
  return os.hostname();
}

function addActivity(entry: {
  type: "sent" | "received";
  fileName: string;
  timestamp: string;
}) {
  let log: any[] = [];
  const logPath = getActivityLogPath();
  try {
    const raw = fs.readFileSync(logPath, "utf-8");
    log = JSON.parse(raw);
  } catch { }
  log.unshift(entry);
  if (log.length > 200) log = log.slice(0, 200);
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
  mainWindow?.webContents.send("activity-updated", entry);
}

const fileServer = new FileServer();
const uploadServer = new UploadServer();
const discoveryManager = new DiscoveryManager();

function stopWindowsHotspot() {
  const tempScriptPath = path.join(
    os.tmpdir(),
    `mayo-stop-hotspot-${Date.now()}.ps1`,
  );
  fs.writeFileSync(tempScriptPath, STOP_HOTSPOT_SCRIPT, "utf8");
  execFile(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScriptPath],
    { timeout: 10000 },
    (error, stdout, stderr) => {
      try {
        fs.unlinkSync(tempScriptPath);
      } catch { }
      if (error) {
        console.error("Failed to stop hotspot:", stderr || error.message);
      } else {
        console.log("Hotspot stopped:", stdout);
      }
    },
  );
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(
    path.join(__dirname, "..", "..", "dist", "renderer", "index.html"),
  );

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });
}

const LOCALES_DIR = path.join(__dirname, '../locales');
let currentLanguage = "en";

const translationsCache: Record<string, any> = {};
function loadAllTranslations() {
  const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const lang = path.basename(file, ".json");
    try {
      const raw = fs.readFileSync(path.join(LOCALES_DIR, file), "utf-8");
      translationsCache[lang] = JSON.parse(raw);
    } catch { }
  }
}
loadAllTranslations();

ipcMain.handle("get-translations", async (_event, lang: string) => {
  return translationsCache[lang] || translationsCache["en"] || {};
});

ipcMain.handle("get-language", async () => {
  return currentLanguage;
});

ipcMain.handle("set-language", async (_event, lang: string) => {
  if (translationsCache[lang]) {
    currentLanguage = lang;
    const settingsPath = path.join(currentSavePath, "mayo-settings.json");
    try {
      const settings = JSON.parse(
        fs.readFileSync(settingsPath, "utf-8") || "{}",
      );
      settings.language = lang;
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2),
        "utf-8",
      );
    } catch { }
  }
});

ipcMain.handle("start-hotspot", async (): Promise<string> => {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const tempScriptPath = path.join(
        os.tmpdir(),
        `mayo-hotspot-${Date.now()}.ps1`,
      );

      try {
        fs.writeFileSync(tempScriptPath, HOTSPOT_SCRIPT, "utf8");
      } catch (err) {
        resolve(`ERROR: Could not write temp script: ${err}`);
        return;
      }

      execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempScriptPath],
        { timeout: 60000 },
        (error, stdout, stderr) => {
          try {
            fs.unlinkSync(tempScriptPath);
          } catch { }

          let output = stdout || "";
          if (stderr && !stdout) output += stderr;
          if (error) output += "\n[EXIT CODE]: " + error.message;

          const ipMatch = output.match(
            /Hotspot IP \(for sharing\):\s*([\d.]+)/,
          );
          if (ipMatch && ipMatch[1]) {
            currentHotspotIP = ipMatch[1];
          }

          resolve(output || "Script produced no output");
        },
      );
    });
  } else if (process.platform === "darwin") {
    try {
      await configureHotspot();
    } catch (err) {
      throw new Error(`Hotspot setup failed: ${err}`);
    }
    const ip = await startHotspot();
    currentHotspotIP = ip;
    return `Hotspot started at ${ip}`;
  } else {
    throw new Error("Unsupported platform");
  }
});

ipcMain.handle("submit-rating", async (_event, ratingData) => {
  try {
    await saveRating(ratingData);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("select-file", async (): Promise<string[] | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "Select files to share",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

ipcMain.handle(
  "start-file-server",
  async (
    _event,
    files: (string | { absolute: string; relative: string })[],
    ip?: string,
  ): Promise<string> => {
    try {
      const filePaths = files.map((f) =>
        typeof f === "string" ? f : f.absolute,
      );
      const relativePaths = files.map((f) =>
        typeof f === "string" ? undefined : f.relative,
      );
      const serverIP = ip || (await getBestIP());
      const url = await fileServer.start(
        filePaths,
        relativePaths,
        undefined,
        serverIP,
      );
      return url;
    } catch (err) {
      throw new Error(`Could not start server: ${err}`);
    }
  },
);

ipcMain.handle("stop-file-server", async (): Promise<void> => {
  fileServer.stop();
});

ipcMain.handle(
  "start-upload-server",
  async (_event, ip?: string): Promise<string> => {
    try {
      const serverIP = ip || (await getBestIP());
      const url = await uploadServer.start(serverIP);
      return url;
    } catch (err) {
      throw new Error(`Could not start upload server: ${err}`);
    }
  },
);

ipcMain.handle("stop-upload-server", async (): Promise<void> => {
  uploadServer.stop();
});

ipcMain.handle("approve-sender", async (_event, sessionId: string) => {
  uploadServer.approveSender(sessionId);
});

ipcMain.handle("decline-sender", async (_event, sessionId: string) => {
  uploadServer.declineSender(sessionId);
});

ipcMain.handle(
  "get-file-size",
  async (_event, filePath: string): Promise<number> => {
    // lstatSync returns size of the file/shortcut itself,
    // NOT the target it points to. Fixes .lnk (1.2MB shortcut)
    // showing as 0B because statSync was following the link to the 200MB exe.
    const stats = fs.lstatSync(filePath);
    return stats.size;
  },
);

uploadServer.on("file-received", (fileName: string) => {
  mainWindow?.webContents.send("upload-update", {
    event: "received",
    fileName,
  });
  addActivity({
    type: "received",
    fileName,
    timestamp: new Date().toISOString(),
  });
});

uploadServer.on(
  "sender-connected",
  (sessionId: string, senderName: string, deviceType: string) => {
    mainWindow?.webContents.send("sender-connected", {
      sessionId,
      senderName,
      deviceType,
    });
  },
);

ipcMain.handle(
  "check-hotspot-status",
  async (): Promise<{ active: boolean; ip: string }> => {
    if (process.platform === "win32") {
      return new Promise((resolve) => {
        const script = `
          try {
            $adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*KM-TEST*" -or $_.InterfaceDescription -like "*Loopback*" } | Select-Object -First 1
            if (-not $adapter) { Write-Output "OFF"; exit 0 }
            $profile = [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]::GetConnectionProfiles() | Where-Object { $_.ProfileName -eq $adapter.Name }
            if (-not $profile) { Write-Output "OFF"; exit 0 }
            $tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime]::CreateFromConnectionProfile($profile)
            $state = $tm.TetheringOperationalState
            if ($state -eq [Windows.Networking.NetworkOperators.TetheringOperationalState]::On) {
              Write-Output "ON:${currentHotspotIP}"
            } else {
              Write-Output "OFF"
            }
          } catch {
            Write-Output "OFF"
          }
        `;
        const tempPath = path.join(os.tmpdir(), `mayo-check-${Date.now()}.ps1`);
        try {
          fs.writeFileSync(tempPath, script, "utf8");
        } catch {
          resolve({ active: false, ip: "" });
          return;
        }
        execFile(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempPath],
          { timeout: 8000 },
          (error, stdout) => {
            try {
              fs.unlinkSync(tempPath);
            } catch { }
            const out = (stdout || "").trim();
            if (out.startsWith("ON")) {
              resolve({ active: true, ip: currentHotspotIP });
            } else {
              resolve({ active: false, ip: "" });
            }
          },
        );
      });
    } else if (process.platform === "darwin") {
      return new Promise((resolve) => {
        execFile(
          "launchctl",
          ["list", "com.apple.InternetSharing"],
          { timeout: 5000 },
          (error, stdout) => {
            if (error) {
              resolve({ active: false, ip: "" });
            } else {
              const isActive = (stdout || "").includes("PID");
              resolve({
                active: isActive,
                ip: isActive ? HOTSPOT_IP : "",
              });
            }
          },
        );
      });
    } else {
      return { active: false, ip: "" };
    }
  },
);

ipcMain.handle("get-hostname", async () => {
  try {
    const settingsPath = path.join(currentSavePath, "mayo-settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.deviceName) return settings.deviceName;
    }
  } catch { }
  return os.hostname();
});

ipcMain.handle("get-local-ip", async (): Promise<string | null> => {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (
        addr.family === "IPv4" &&
        !addr.internal &&
        !addr.address.startsWith("192.168.137.") &&
        !addr.address.startsWith("192.168.2.") &&
        !addr.address.startsWith("169.254.")
      ) {
        return addr.address;
      }
    }
  }
  return null;
});

ipcMain.handle("get-wifi-ssid", async (): Promise<string | null> => {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile(
        "netsh",
        ["wlan", "show", "interfaces"],
        { timeout: 5000 },
        (error, stdout) => {
          if (error) return resolve(null);
          const match = stdout.match(/^\s*SSID\s*:\s*(.+)$/m);
          resolve(match ? match[1].trim() : null);
        },
      );
    });
  } else if (process.platform === "darwin") {
    return new Promise((resolve) => {
      execFile(
        "networksetup",
        ["-getairportnetwork", "en0"],
        { timeout: 5000 },
        (error, stdout) => {
          if (error) return resolve(null);
          const match = stdout.match(/Current Wi-Fi Network: (.+)/);
          resolve(match ? match[1].trim() : null);
        },
      );
    });
  }
  return null;
});

interface FolderFile {
  absolute: string;
  relative: string;
}

ipcMain.handle("select-folder", async (): Promise<FolderFile[] | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select a folder to share",
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const folderRoot = result.filePaths[0];
  const allFiles: FolderFile[] = [];

  const walk = async (dir: string, relativeDir: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else {
        allFiles.push({ absolute: fullPath, relative: relPath });
      }
    }
  };

  const folderName = path.basename(folderRoot);
  await walk(folderRoot, folderName);
  return allFiles.length > 0 ? allFiles : null;
});

ipcMain.handle(
  "read-file-chunk",
  async (
    _event,
    filePath: string,
    start: number,
    size: number,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      open(filePath, "r", (err, fd) => {
        if (err) return reject(err);
        const buf = Buffer.alloc(size);
        read(fd, buf, 0, size, start, (err, bytesRead) => {
          close(fd, () => { });
          if (err) return reject(err);
          resolve(buf.slice(0, bytesRead).toString("base64"));
        });
      });
    });
  },
);

ipcMain.handle(
  "save-resume-state",
  async (
    _event,
    transferId: string,
    offset: number,
    filePath: string,
  ): Promise<void> => {
    const resumePath = path.join(os.tmpdir(), `mayo-resume-${transferId}.json`);
    await fs.promises.writeFile(
      resumePath,
      JSON.stringify({ offset, filePath }),
      "utf8",
    );
  },
);

ipcMain.handle(
  "get-resume-state",
  async (
    _event,
    transferId: string,
  ): Promise<{ offset: number; filePath: string } | null> => {
    const resumePath = path.join(os.tmpdir(), `mayo-resume-${transferId}.json`);
    try {
      const raw = await fs.promises.readFile(resumePath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
);

ipcMain.handle(
  "clear-resume-state",
  async (_event, transferId: string): Promise<void> => {
    const resumePath = path.join(os.tmpdir(), `mayo-resume-${transferId}.json`);
    try {
      await fs.promises.unlink(resumePath);
    } catch { }
  },
);

ipcMain.handle(
  "create-receive-file",
  async (_event, filePath: string): Promise<void> => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, "");
  },
);

ipcMain.handle(
  "append-receive-chunk",
  async (_event, filePath: string, base64Data: string): Promise<void> => {
    const buf = Buffer.from(base64Data, "base64");
    appendFileSync(filePath, buf);
  },
);

fileServer.on("download-started", (_index: number, fileName: string) => {
  mainWindow?.webContents.send("download-update", {
    event: "started",
    fileName,
  });
});

fileServer.on("download-completed", (_index: number, fileName: string, clientIp: string) => {
  mainWindow?.webContents.send("download-update", {
    event: "completed",
    fileName,
    clientIp,
  });
  addActivity({
    type: "sent",
    fileName,
    timestamp: new Date().toISOString(),
  });
});

ipcMain.handle(
  "get-clipboard-files",
  async (): Promise<{ paths: string[]; type: "files" | "none" }> => {
    const { clipboard } = await import("electron");
    try {
      const rawFilenames = clipboard.read("FileNameW");
      if (rawFilenames && rawFilenames.length > 0) {
        const paths: string[] = rawFilenames
          .split("\0")
          .map((p) => p.trim())
          .filter((p) => {
            if (p.length === 0) return false;
            // Use lstatSync so .lnk, .url, and other shortcut/special files
            // are included as-is rather than being resolved to their target.
            // fs.existsSync follows symlinks (and on Windows, shortcuts),
            // which can return false for .lnk when the target doesn't exist.
            try {
              fs.lstatSync(p);
              return true;
            } catch {
              return false;
            }
          });
        if (paths.length > 0) return { paths, type: "files" };
      }
    } catch {
      /* not available */
    }
    return { paths: [], type: "none" };
  },
);

ipcMain.handle(
  "save-temp-file",
  async (_event, fileName: string, base64Data: string): Promise<string> => {
    const tempDir = path.join(os.tmpdir(), "mayo-share-temp");
    await fs.promises.mkdir(tempDir, { recursive: true });
    const filePath = path.join(tempDir, fileName);
    const buf = Buffer.from(base64Data, "base64");
    await fs.promises.writeFile(filePath, buf);
    return filePath;
  },
);

ipcMain.handle(
  "fix-firewall",
  async (): Promise<{ success: boolean; output?: string; error?: string }> => {
    return new Promise((resolve) => {
      const cmd = `netsh advfirewall firewall add rule name="MAYO Share" dir=in action=allow protocol=TCP localport=3000,3001,3004`;
      execFile(
        "powershell.exe",
        ["-Command", cmd],
        { timeout: 15000 },
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message });
          } else {
            resolve({
              success: true,
              output: stdout || "Rule added successfully.",
            });
          }
        },
      );
    });
  },
);

ipcMain.handle("diagnose-network", async (): Promise<any> => {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const psScript = `
        $ssid = (netsh wlan show interfaces | Select-String "SSID" | Select-String -NotMatch "BSSID" | Select-Object -First 1).ToString().Split(':')[1].Trim()
        $profile = Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" } | Select-Object -ExpandProperty NetworkCategory
        $loopback = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like "*KM-TEST*" } | Select-Object -First 1
        $port3001 = netstat -ano | Select-String ":3001" | Select-String "LISTENING"
        Write-Host $ssid
        Write-Host $profile
        Write-Host ($loopback -ne $null)
        Write-Host ($port3001 -ne $null)
      `;
      execFile(
        "powershell.exe",
        ["-NoProfile", "-Command", psScript],
        { timeout: 10000 },
        (error, stdout, stderr) => {
          if (error)
            return resolve({
              ssid: null,
              profileCategory: null,
              loopbackAdapterPresent: false,
              port3001Listening: false,
            });
          const lines = (stdout || "").trim().split("\n");
          resolve({
            ssid: lines[0]?.trim() || null,
            profileCategory: lines[1]?.trim() || null,
            loopbackAdapterPresent: lines[2]?.trim() === "True",
            port3001Listening: lines[3]?.trim() === "True",
          });
        },
      );
    });
  } else if (process.platform === "darwin") {
    return new Promise((resolve) => {
      execFile("lsof", ["-i", ":3001"], { timeout: 5000 }, (error, stdout) => {
        const portListening = stdout && stdout.includes("LISTEN");
        resolve({
          ssid: null,
          profileCategory: null,
          loopbackAdapterPresent: false,
          port3001Listening: portListening,
        });
      });
    });
  }
  return {
    ssid: null,
    profileCategory: null,
    loopbackAdapterPresent: false,
    port3001Listening: false,
  };
});

ipcMain.handle(
  "launch-hardware-wizard",
  async (): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      execFile(
        "rundll32.exe",
        ["shell32.dll,Control_RunDLL", "hdwwiz.cpl"],
        { timeout: 10000 },
        (error) => {
          if (error) {
            resolve({ success: false, error: error.message });
          } else {
            resolve({ success: true });
          }
        },
      );
    });
  },
);

ipcMain.handle(
  "read-text-file",
  async (_event, filePath: string): Promise<string> => {
    return fs.promises.readFile(filePath, "utf-8");
  },
);

ipcMain.handle(
  "write-text-file",
  async (_event, filePath: string, content: string): Promise<void> => {
    await fs.promises.writeFile(filePath, content, "utf-8");
  },
);

ipcMain.handle("get-activity", async (): Promise<any[]> => {
  try {
    const raw = fs.readFileSync(getActivityLogPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
});

ipcMain.handle("clear-activity", async (): Promise<void> => {
  try {
    fs.writeFileSync(getActivityLogPath(), "[]", "utf-8");
    mainWindow?.webContents.send("activity-cleared");
  } catch (err) {
    console.error("Failed to clear activity log:", err);
  }
});

ipcMain.handle("compress-sdp", async (_event, sdp: string): Promise<string> => {
  return Buffer.from(sdp, "utf-8").toString("base64");
});

ipcMain.handle(
  "decompress-sdp",
  async (_event, compact: string): Promise<string> => {
    return Buffer.from(compact, "base64").toString("utf-8");
  },
);

// ==================== NEW ADDITIONS FOR P2P ACTIVITY & FOLDER PASTE ====================
ipcMain.handle("log-p2p-activity", async (_event, type: "sent" | "received", fileName: string) => {
  addActivity({ type, fileName, timestamp: new Date().toISOString() });
});

ipcMain.handle("is-directory", async (_event, filePath: string): Promise<boolean> => {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isDirectory();
  } catch {
    return false;
  }
});

ipcMain.handle("walk-directory", async (_event, dirPath: string): Promise<{ absolute: string; relative: string }[]> => {
  const result: { absolute: string; relative: string }[] = [];
  const folderName = path.basename(dirPath);
  const walk = async (dir: string, rel: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, relative);
      } else {
        result.push({ absolute: full, relative });
      }
    }
  };
  await walk(dirPath, folderName);
  return result;
});
// ==================== END NEW ADDITIONS ====================

// ---------- 4-Digit Code Signaling ----------
let signalingServer: http.Server | null = null;
let storedOfferSDP = "";
let activeCode = "";

function generateCode(): string {
  const arr = new Uint32Array(1);
  require("crypto").randomFillSync(arr);
  return String(1000 + (arr[0] % 9000));
}

ipcMain.handle("generate-code", async (_event, sdpOffer: string): Promise<string> => {
  storedOfferSDP = sdpOffer;
  activeCode = generateCode();

  const PORT = 3004;
  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
  }

  signalingServer = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method === "GET" && req.url?.startsWith("/sdp")) {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const code = url.searchParams.get("code");
        if (code !== activeCode) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "wrong_code" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(storedOfferSDP);
        return;
      }

      if (req.method === "POST" && req.url?.startsWith("/answer")) {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        const code = url.searchParams.get("code");
        if (code !== activeCode) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "wrong_code" }));
          return;
        }
        let body = "";
        req.on("data", (chunk: string) => (body += chunk));
        req.on("end", () => {
          mainWindow?.webContents.send("answer-received", body);
          res.writeHead(200);
          res.end("OK");
        });
        return;
      }

      res.writeHead(404);
      res.end();
    },
  );

  await new Promise<void>((resolve, reject) => {
    signalingServer!.on("error", reject);
    signalingServer!.listen(PORT, "0.0.0.0", resolve);
  });

  return activeCode;
});

ipcMain.handle(
  "join-by-code",
  async (_event, senderIP: string, code: string): Promise<string> => {
    const PORT = 3004;
    const sdp = await new Promise<string>((resolve, reject) => {
      const req = require("http").get(
        `http://${senderIP}:${PORT}/sdp?code=${code}`,
        (res: http.IncomingMessage) => {
          if (res.statusCode === 403) {
            reject(new Error("wrong_code"));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => resolve(data));
        },
      );
      req.on("error", reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
    });
    return sdp;
  },
);

ipcMain.handle(
  "submit-answer",
  async (_event, senderIP: string, code: string, answerSDP: string): Promise<void> => {
    const PORT = 3004;
    await new Promise<void>((resolve, reject) => {
      const body = Buffer.from(answerSDP, "utf8");
      const options = {
        hostname: senderIP,
        port: PORT,
        path: `/answer?code=${code}`,
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "Content-Length": body.length,
        },
      };
      const req = require("http").request(options, (res: http.IncomingMessage) => {
        if (res.statusCode === 403) {
          reject(new Error("wrong_code"));
          return;
        }
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.write(body);
      req.end();
    });
  },
);

ipcMain.handle("stop-signaling", async (): Promise<void> => {
  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
  }
  activeCode = "";
  storedOfferSDP = "";
});

discoveryManager.on("answer-received", (answerSDP: string) => {
  mainWindow?.webContents.send("answer-received", answerSDP);
});

async function loadSettings() {
  try {
    const settingsPath = path.join(currentSavePath, "mayo-settings.json");
    const raw = await fs.promises.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    if (settings.savePath) {
      currentLanguage = settings.language;
      currentSavePath = settings.savePath;
      setReceiveDir(currentSavePath);
    }
  } catch { }
}

ipcMain.handle("get-save-path", async (): Promise<string> => {
  return currentSavePath;
});

// Disk space for the drive that holds the receive/save folder.
// Used by the status-bar storage indicator and the receive-space pre-check.
ipcMain.handle(
  "get-disk-space",
  async (): Promise<{ free: number; total: number }> => {
    const probe = async (target: string) => {
      const stats = await fs.promises.statfs(target);
      const blockSize = stats.bsize;
      return {
        free: stats.bavail * blockSize,
        total: stats.blocks * blockSize,
      };
    };
    try {
      return await probe(currentSavePath);
    } catch {
      try {
        return await probe(os.homedir());
      } catch {
        return { free: 0, total: 0 };
      }
    }
  },
);

ipcMain.handle(
  "set-save-path",
  async (_event, newPath: string): Promise<void> => {
    if (newPath && newPath.trim().length > 0) {
      currentSavePath = newPath.trim();
      setReceiveDir(currentSavePath);
      try {
        await fs.promises.mkdir(path.dirname(currentSavePath), {
          recursive: true,
        });
        await fs.promises.writeFile(
          path.join(currentSavePath, "mayo-settings.json"),
          JSON.stringify({ savePath: currentSavePath }),
          "utf-8",
        );
      } catch { }
    }
  },
);

ipcMain.handle(
  "set-device-name",
  async (_event, name: string): Promise<void> => {
    if (name && name.trim().length > 0) {
      try {
        const settingsPath = path.join(currentSavePath, "mayo-settings.json");
        let settings: any = {};
        if (fs.existsSync(settingsPath)) {
          const raw = fs.readFileSync(settingsPath, "utf-8");
          settings = JSON.parse(raw);
        }
        settings.deviceName = name.trim();
        fs.writeFileSync(
          settingsPath,
          JSON.stringify(settings, null, 2),
          "utf-8",
        );
        mainWindow?.webContents.send("device-name-changed", name.trim());
      } catch { }
    }
  },
);

ipcMain.handle("select-save-folder", async (): Promise<string | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select where to save received files",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("ping", async () => "pong");
ipcMain.handle("get-platform", async (): Promise<string> => {
  return process.platform;
});

app.whenReady().then(async () => {
  await loadSettings();
  powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  createWindow();
});

app.on("before-quit", () => {
  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
  }
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    powerSaveBlockerId = null;
  }
  uploadServer.stop();
  fileServer.stop();
  if (process.platform === "win32") {
    stopWindowsHotspot();
  } else if (process.platform === "darwin") {
    stopHotspot().catch(() => { });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});