import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import { execFile } from "child_process";
import { FileServer } from "./fileServer";
import http from "http";
import { open, close, read, writeFile, appendFileSync } from "fs";
import { UploadServer } from "./uploadServer";
import { DiscoveryManager } from "./discovery";
import { statSync } from "fs";
import fs from "fs";
import os from "os";

let mainWindow: BrowserWindow | null = null;
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
      } catch {}
      if (error) {
        console.error("Failed to stop hotspot:", stderr || error.message);
      } else {
        console.log("Hotspot stopped:", stdout);
      }
    },
  );
}

// ---------- Window ----------
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

// ---------- Hotspot ----------
ipcMain.handle("start-hotspot", async (): Promise<string> => {
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
        } catch {}

        let output = stdout || "";
        if (stderr && !stdout) output += stderr;
        if (error) output += "\n[EXIT CODE]: " + error.message;

        // Extract the hotspot IP from the script's output
        const ipMatch = output.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
        if (ipMatch && ipMatch[1]) {
          currentHotspotIP = ipMatch[1];
        }

        resolve(output || "Script produced no output");
      },
    );
  });
});

// ---------- File selection ----------
ipcMain.handle("select-file", async (): Promise<string[] | null> => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    title: "Select files to share",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

// ---------- File server ----------
// Accepts either plain paths (from file picks) or objects with relativePath (from folder picks)
ipcMain.handle(
  "start-file-server",
  async (
    _event,
    files: (string | { absolute: string; relative: string })[],
  ): Promise<string> => {
    try {
      const filePaths = files.map((f) =>
        typeof f === "string" ? f : f.absolute,
      );
      // relativePaths will be passed through later when we update fileServer
      const relativePaths = files.map((f) =>
        typeof f === "string" ? undefined : f.relative,
      );
      const url = await fileServer.start(
        filePaths,
        relativePaths,
        undefined,
        currentHotspotIP,
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

// ---------- Upload server (Receive from Browser) ----------
ipcMain.handle("start-upload-server", async (): Promise<string> => {
  try {
    const url = await uploadServer.start(currentHotspotIP);
    return url;
  } catch (err) {
    throw new Error(`Could not start upload server: ${err}`);
  }
});

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
    const stats = statSync(filePath);
    return stats.size;
  },
);

uploadServer.on("file-received", (fileName: string) => {
  mainWindow?.webContents.send("upload-update", {
    event: "received",
    fileName,
  });
});


// Forward sender-connected events to renderer
uploadServer.on("sender-connected", (sessionId: string, senderName: string) => {
  mainWindow?.webContents.send("sender-connected", { sessionId, senderName });
});


// ---------- Hotspot status check (for real-time status bar) ----------
ipcMain.handle(
  "check-hotspot-status",
  async (): Promise<{ active: boolean; ip: string }> => {
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
          } catch {}
          const out = (stdout || "").trim();
          if (out.startsWith("ON")) {
            resolve({ active: true, ip: currentHotspotIP });
          } else {
            resolve({ active: false, ip: "" });
          }
        },
      );
    });
  },
);

// HOST NAME
ipcMain.handle("get-hostname", async () => {
  return os.hostname();
});

// ---------- Folder selection ----------
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

  // Get just the folder name, not the full path, to use as root for relative paths
  const folderName = path.basename(folderRoot);
  await walk(folderRoot, folderName);
  return allFiles.length > 0 ? allFiles : null;
});

// ---------- File chunking (for P2P) ----------

ipcMain.handle(
  "read-file-chunk",
  async (
    _event,
    filePath: string,
    start: number,
    size: number,
  ): Promise<string> => {
    return new Promise((resolve, reject) => {
      // Open file, read chunk, return as base64
      open(filePath, "r", (err, fd) => {
        if (err) return reject(err);
        const buf = Buffer.alloc(size);
        read(fd, buf, 0, size, start, (err, bytesRead) => {
          close(fd, () => {});
          if (err) return reject(err);
          resolve(buf.slice(0, bytesRead).toString("base64"));
        });
      });
    });
  },
);

// for file resume

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
    } catch {}
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
fileServer.on("download-completed", (_index: number, fileName: string) => {
  mainWindow?.webContents.send("download-update", {
    event: "completed",
    fileName,
  });
});

// ---------- Clipboard file paths ----------
ipcMain.handle(
  "get-clipboard-files",
  async (): Promise<{ paths: string[]; type: "files" | "none" }> => {
    const { clipboard } = await import("electron");
    // On Windows, copied files are available via nativeImage or file list
    // electron clipboard doesn't expose file paths directly, so we read from the raw formats
    try {
      const rawFilenames = clipboard.read("FileNameW"); // Windows-specific
      if (rawFilenames && rawFilenames.length > 0) {
        // Parse null-terminated wide string list
        const paths: string[] = rawFilenames
          .split("\0")
          .map((p) => p.trim())
          .filter((p) => p.length > 0 && fs.existsSync(p));
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

ipcMain.handle("compress-sdp", async (_event, sdp: string): Promise<string> => {
  return Buffer.from(sdp, "utf-8").toString("base64");
});

ipcMain.handle(
  "decompress-sdp",
  async (_event, compact: string): Promise<string> => {
    return Buffer.from(compact, "base64").toString("utf-8");
  },
);

ipcMain.handle("ping", async () => "pong");
// ---------- Discovery (mDNS + signaling server) ----------
let signalingServer: http.Server | null = null;
let storedOfferSDP = "";

ipcMain.handle(
  "start-advertising",
  async (_event, sdpOffer: string): Promise<number> => {
    storedOfferSDP = sdpOffer;

    // Spin up a tiny HTTP server that serves the SDP
    const PORT = 3004;
    if (signalingServer) signalingServer.close();

    signalingServer = require("http").createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        if (req.method === "GET" && req.url === "/sdp") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end(storedOfferSDP);
        } else if (req.method === "POST" && req.url === "/answer") {
          let body = "";
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => {
            discoveryManager.emit("answer-received", body);
            res.writeHead(200);
            res.end("OK");
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      },
    );

    await new Promise<void>((resolve) =>
      signalingServer!.listen(PORT, resolve),
    );
    discoveryManager.startAdvertising(currentHotspotIP, PORT);
    return PORT;
  },
);

ipcMain.handle("start-browsing", async (): Promise<void> => {
  discoveryManager.startBrowsing();
});

ipcMain.handle("stop-discovery", async (): Promise<void> => {
  discoveryManager.stop();
  if (signalingServer) {
    signalingServer.close();
    signalingServer = null;
  }
});

ipcMain.handle(
  "connect-to-device",
  async (_event, sdpOffer: string): Promise<string> => {
    // Create answer using existing logic
    const pc = new (require("electron").BrowserWindow?.webContents?.session
      ?.webRTC?.RTCPeerConnection)();
    // Actually we need to create the answer in the renderer side, but we can handle it differently.
    // This should be done in the renderer. We'll just return a placeholder.
    // We'll implement the real connection logic in the frontend.
    return "connected";
  },
);

// Forward events to renderer
discoveryManager.on("device-found", (device) => {
  mainWindow?.webContents.send("device-found", device);
});

discoveryManager.on("answer-received", (answerSDP: string) => {
  mainWindow?.webContents.send("answer-received", answerSDP);
});

// ---------- App startup ----------
app.whenReady().then(createWindow);

app.on("before-quit", () => {
  discoveryManager.stop();
  if (signalingServer) signalingServer.close();
  uploadServer.stop();
  fileServer.stop();
  stopWindowsHotspot();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
