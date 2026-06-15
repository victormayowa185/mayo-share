import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { 
  FaCircle, FaTimes, FaCheck, FaCopy,
  FaChevronDown, FaChevronUp, FaChevronRight, FaFolderOpen, 
  FaPlus, FaUpload 
} from "react-icons/fa";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/P2PSession.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
  initialMode?: "send" | "join";
}

interface QueueFile {
  id: string;
  name: string;
  path: string | null;
  size: number;
  status: "queued" | "transferring" | "done" | "cancelled";
  progress: number;
  source: "file" | "text";
}

interface ReceiveEntry {
  name: string;
  size: number;
  path: string;
  received: number;
}

// Item 4: a file that has finished downloading on the receiver side,
// kept around so the "Received" section can still show it after the
// progress bar disappears.
interface ReceivedFile {
  id: string;
  name: string;
  size: number;
  path: string;
}

const formatBytes = (b: number) => {
  if (b === 0) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
};

interface FileGroup {
  folderName: string;
  files: QueueFile[];
}

// ✅ Item 1: group queued files by their top-level folder (based on relative
// path produced by addFolder, e.g. "MyFolder/sub/file.txt")
const groupQueueFiles = (files: QueueFile[]): FileGroup[] => {
  const groupsMap = new Map<string, QueueFile[]>();
  for (const file of files) {
    const parts = file.name.split("/");
    const folder = parts.length > 1 ? parts[0] : "";
    if (!groupsMap.has(folder)) groupsMap.set(folder, []);
    groupsMap.get(folder)!.push(file);
  }
  const groups: FileGroup[] = [];
  const rootFiles = groupsMap.get("") || [];
  for (const [folder, folderFiles] of groupsMap) {
    if (folder) groups.push({ folderName: folder, files: folderFiles });
  }
  if (rootFiles.length > 0) groups.push({ folderName: "", files: rootFiles });
  return groups;
};

const P2PSession: React.FC<Props> = ({ onBack, initialMode }) => {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"choose" | "send" | "join">(
    initialMode === "send" ? "send" : initialMode === "join" ? "join" : "choose"
  );
  const [connected, setConnected] = useState(false);
  const [sessionStatus, setSessionStatus] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Sender States
  const [myCode, setMyCode] = useState("");
  const [myIP, setMyIP] = useState("");
  const [showIPDetails, setShowIPDetails] = useState(false);
  const [ipCopied, setIpCopied] = useState(false);
  const [waitingForJoiner, setWaitingForJoiner] = useState(false);

  // Receiver States
  const [joinIP, setJoinIP] = useState("");
  const [joinCode, setJoinCode] = useState(["", "", "", ""]);
  const [joining, setJoining] = useState(false);

  // Queue States
  const [fileQueue, setFileQueue] = useState<QueueFile[]>([]);
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>({});
  // ✅ Item 4: completed downloads, kept visible in a "Received" section
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  // ✅ Item 1: folder collapse state — set of folder names currently collapsed
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  
  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const receivePathsRef = useRef<Record<string, string>>({});
  // Mirrors receiveMap for synchronous access inside stable callbacks
  const receiveMapRef = useRef<Record<string, ReceiveEntry>>({});
  // ✅ Item 4 fix: serialize incoming data-channel messages so chunks are
  // written to disk strictly in order, preventing corrupted/incomplete files.
  const messageQueueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  const showFileArea = useCallback(() => setConnected(true), []);

  useEffect(() => {
    receiveMapRef.current = receiveMap;
  }, [receiveMap]);

  // ── Connection Logic ──
  useEffect(() => {
    if (mode === "send" && !myCode) startSendMode();
    if (mode === "join") {
      window.electronAPI.getLocalIP().then((ip) => {
        if (ip) {
          const parts = ip.split(".");
          if (parts.length === 4) { parts[3] = "1"; setJoinIP(parts.join(".")); }
        }
      });
    }
  }, [mode]);

  // ── Clipboard Paste (Item 5: supports files, images, and text) ──
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!connected || isSending) return;
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    // Case 1: file paths copied from file explorer
    if (clipboard.files && clipboard.files.length > 0) {
      const newFiles: QueueFile[] = [];
      for (let i = 0; i < clipboard.files.length; i++) {
        const f = clipboard.files[i];
        const filePath = (f as any).path;
        if (filePath) {
          newFiles.push({
            id: Math.random().toString(36),
            name: f.name,
            path: filePath,
            size: f.size,
            status: "queued",
            progress: 0,
            source: "file"
          });
        }
      }
      if (newFiles.length > 0) {
        setFileQueue(prev => [...prev, ...newFiles]);
        return;
      }
    }

    // Case 2: image data (e.g. screenshot copied to clipboard)
    const imageItem = Array.from(clipboard.items).find(item => item.type.startsWith("image/"));
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
          const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
          setFileQueue(prev => [...prev, {
            id: Math.random().toString(36),
            name: fileName,
            path: savedPath,
            size: blob.size,
            status: "queued",
            progress: 0,
            source: "file",
          }]);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }

    // Case 3: plain text
    const text = clipboard.getData("text/plain");
    if (text && text.trim()) {
      const fileName = `pasted-text-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
      const base64 = btoa(unescape(encodeURIComponent(text)));
      const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
      setFileQueue(prev => [...prev, {
        id: Math.random().toString(36),
        name: fileName,
        path: savedPath,
        size: new Blob([text]).size,
        status: "queued",
        progress: 0,
        source: "file",
      }]);
    }
  }, [connected, isSending]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  // ── File Management ──
  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: QueueFile[] = await Promise.all(
      paths.map(async p => ({
        id: Math.random().toString(36),
        name: p.split('\\').pop() || p,
        path: p,
        size: await window.electronAPI.getFileSize(p),
        status: "queued" as const,
        progress: 0,
        source: "file" as const,
      }))
    );
    setFileQueue(prev => [...prev, ...newFiles]);
  };

  const addFolder = async () => {
    const folderFiles = await window.electronAPI.selectFolder();
    if (!folderFiles) return;
    const newFiles: QueueFile[] = await Promise.all(
      folderFiles.map(async f => ({
        id: Math.random().toString(36),
        name: f.relative,
        path: f.absolute,
        size: await window.electronAPI.getFileSize(f.absolute),
        status: "queued" as const,
        progress: 0,
        source: "file" as const,
      }))
    );
    setFileQueue(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => setFileQueue(prev => prev.filter(f => f.id !== id));

  // ✅ New: remove every file belonging to a folder in one click, so the
  // user doesn't have to open the folder and remove files one by one.
  const removeFolder = (folderName: string) => {
    setFileQueue(prev => prev.filter(f => {
      const parts = f.name.split("/");
      const folder = parts.length > 1 ? parts[0] : "";
      return folder !== folderName;
    }));
    setCollapsedFolders(prev => {
      if (!prev.has(folderName)) return prev;
      const next = new Set(prev);
      next.delete(folderName);
      return next;
    });
  };

  // ✅ Item 1: toggle a single folder's collapsed state
  const toggleFolder = (folderName: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName); else next.add(folderName);
      return next;
    });
  };

  // ✅ Item 1: collapse/expand ALL folders at once (sticky button)
  const toggleAll = (groups: FileGroup[]) => {
    const folderNames = groups.filter(g => g.folderName).map(g => g.folderName);
    if (allCollapsed) {
      setCollapsedFolders(new Set());
      setAllCollapsed(false);
    } else {
      setCollapsedFolders(new Set(folderNames));
      setAllCollapsed(true);
    }
  };

  // ── CORE SENDING LOGIC (WITH BACKPRESSURE FIX) ──
  const sendAll = async () => {
    const dc = localDC.current;
    if (!dc || dc.readyState !== "open") return;
    
    setIsSending(true);
    for (const file of fileQueue) {
      if (file.status === "done") continue;
      
      // Tell receiver to prepare for file
      dc.send(JSON.stringify({ 
        type: "file-start", id: file.id, name: file.name, size: file.size, fromOffset: 0 
      }));

      const CHUNK_SIZE = 16384; // Safe size for data channel
      let offset = 0;

      while (offset < file.size) {
        // 🛑 BACKPRESSURE FIX: If the internal buffer is too full, wait before sending more
        if (dc.bufferedAmount > 1024 * 1024) { // Wait if buffer > 1MB
            await new Promise(resolve => {
                const check = () => {
                    if (dc.bufferedAmount < 512 * 1024) resolve(null);
                    else setTimeout(check, 50);
                };
                check();
            });
        }

        const base64 = await window.electronAPI.readFileChunk(file.path!, offset, CHUNK_SIZE);
        dc.send(JSON.stringify({ type: "file-chunk", id: file.id, data: base64, offset }));
        
        offset += CHUNK_SIZE;
        const progress = Math.min(100, Math.round((offset / file.size) * 100));
        
        // Update UI every 5% to keep performance high
        if (progress % 5 === 0) {
            setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: "transferring", progress } : f));
        }
      }

      dc.send(JSON.stringify({ type: "file-end", id: file.id }));
      setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: "done", progress: 100 } : f));
    }
    setIsSending(false);
    setSessionStatus(t("allFilesSent"));
    // ✅ Item 2: keep sent files visible in the list with "Sent" status —
    // do NOT clear the queue. New files added later will appear alongside.
  };

  // ── DATA CHANNEL RECEIVER SETUP ──
  const handleDCMessage = useCallback(async (raw: string) => {
    let msg: any; try { msg = JSON.parse(raw); } catch { return; }
    
    if (msg.type === "file-start") {
      const saveDir = await window.electronAPI.getSavePath();
      // Normalize folder paths for Windows
      const safeName = msg.name.replace(/\//g, "\\"); 
      const savePath = saveDir + "\\" + safeName;
      
      receivePathsRef.current[msg.id] = savePath;
      await window.electronAPI.createReceiveFile(savePath);
      setReceiveMap(prev => ({ ...prev, [msg.id]: { name: msg.name, size: msg.size, path: savePath, received: 0 } }));
    }

    if (msg.type === "file-chunk") {
      const path = receivePathsRef.current[msg.id];
      if (!path) return;
      await window.electronAPI.appendReceiveChunk(path, msg.data);
      const chunkLen = atob(msg.data).length;
      setReceiveMap(prev => {
        const entry = prev[msg.id];
        if (!entry) return prev;
        return { ...prev, [msg.id]: { ...entry, received: entry.received + chunkLen } };
      });
    }

    if (msg.type === "file-end") {
      const entry = receiveMapRef.current[msg.id];
      const savedPath = receivePathsRef.current[msg.id] || entry?.path || "";
      delete receivePathsRef.current[msg.id];
      setReceiveMap(prev => { const n = { ...prev }; delete n[msg.id]; return n; });
      setReceivedFiles(prev => [
        ...prev,
        {
          id: msg.id,
          name: msg.name || entry?.name || "",
          size: msg.size ?? entry?.size ?? 0,
          path: savedPath,
        },
      ]);
      setSessionStatus(t("fileReceived", { name: msg.name || "" }));
    }
  }, []);

  // ✅ Item 4 fix: process queued messages strictly one at a time, in order.
  // Without this, fast-arriving file-chunk messages trigger overlapping
  // async IPC writes that can land out of order and corrupt the file.
  const processMessageQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (messageQueueRef.current.length > 0) {
      const next = messageQueueRef.current.shift()!;
      await handleDCMessage(next);
    }
    processingRef.current = false;
  }, [handleDCMessage]);

  const startSendMode = async () => {
    try {
      const ip = await window.electronAPI.getLocalIP();
      if (!ip) { setSessionStatus(t("noNetworkDetected")); return; }
      setMyIP(ip);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localPC.current = pc;
      const dc = pc.createDataChannel("mayo-share", { ordered: true });
      localDC.current = dc;
      dc.onopen = () => { setSessionStatus(t("dataChannelOpen")); showFileArea(); };
      dc.onmessage = e => { messageQueueRef.current.push(e.data); processMessageQueue(); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise(r => setTimeout(r, 1500)); // Wait for ICE gathering
      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      const code = await window.electronAPI.generateCode(compact);
      setMyCode(code);
      setWaitingForJoiner(true);
    } catch (err: any) { setSessionStatus("Error: " + err.message); }
  };

  const waitForICE = (pc: RTCPeerConnection) =>
    Promise.race([
      new Promise<void>(resolve => {
        if (pc.iceGatheringState === "complete") resolve();
        else pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") resolve();
        });
      }),
      new Promise<void>(resolve => setTimeout(resolve, 1500)),
    ]);

  const connectWithCode = async () => {
    const code = joinCode.join("");
    if (code.length !== 4) return;
    setJoining(true);
    try {
      const compactOffer = await window.electronAPI.joinByCode(joinIP.trim(), code);
      const offerSDP = await window.electronAPI.decompressSDP(compactOffer);
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localPC.current = pc;
      pc.ondatachannel = event => {
        localDC.current = event.channel;
        localDC.current.onopen = () => { setSessionStatus(t("dataChannelOpen")); showFileArea(); };
        localDC.current.onmessage = e => { messageQueueRef.current.push(e.data); processMessageQueue(); };
      };
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSDP }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // ✅ Item 4 fix: wait for ICE gathering to complete before sending answer,
      // same as the sender does for its offer. Without this, the answer SDP
      // may have no/incomplete ICE candidates, causing flaky connections.
      await waitForICE(pc);
      const compactAnswer = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      await window.electronAPI.submitAnswer(joinIP.trim(), code, compactAnswer);
    } catch (err: any) { setJoining(false); setSessionStatus("Connection Failed"); }
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...joinCode]; newCode[index] = digit; setJoinCode(newCode);
    if (digit && index < 3) digitRefs.current[index + 1]?.focus();
  };

  // ✅ Item 3: Backspace deletes current digit and moves focus to previous box
  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (joinCode[index]) {
        // Clear current digit, stay on this box
        const newCode = [...joinCode];
        newCode[index] = "";
        setJoinCode(newCode);
      } else if (index > 0) {
        // Already empty — move to previous box and clear it too
        const newCode = [...joinCode];
        newCode[index - 1] = "";
        setJoinCode(newCode);
        digitRefs.current[index - 1]?.focus();
      }
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && index > 0) {
      digitRefs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && index < 3) {
      digitRefs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  // ✅ Item 3: Support pasting a full 4-digit code
  const handleDigitPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length > 0) {
      e.preventDefault();
      const newCode = ["", "", "", ""];
      for (let i = 0; i < pasted.length; i++) newCode[i] = pasted[i];
      setJoinCode(newCode);
      const nextIndex = Math.min(pasted.length, 3);
      digitRefs.current[nextIndex]?.focus();
    }
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onAnswerReceived(async (answerSDP: string) => {
      if (!localPC.current) return;
      const sdp = await window.electronAPI.decompressSDP(answerSDP);
      await localPC.current.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
      setWaitingForJoiner(false);
    });
    return () => { cleanup(); window.electronAPI.stopSignaling?.(); };
  }, []);

  // ✅ Item 1: shared row renderer for both grouped and ungrouped files
  const renderQueueRow = (f: QueueFile) => (
    <div key={f.id} className={styles.queueItem}>
      <div className={styles.queueName}>{f.name}</div>
      <div className={styles.queueSize}>{formatBytes(f.size)}</div>
      {f.status === "transferring" && <progress value={f.progress} max="100" className={styles.progress} />}
      <div className={styles.queueStatus}>
        {f.status === "done"
          ? <><FaCheck color="#4CAF50" /> {t("sent")}</>
          : f.status}
      </div>
      {!isSending && f.status !== "done" && <button className={styles.removeBtn} onClick={() => removeFile(f.id)}><FaTimes /></button>}
    </div>
  );

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("deviceConnect")}</h2>

      {!connected && mode === "send" && (
        <div className={styles.createPanel}>
          <p className={styles.label}>{t("yourCode")}</p>
          <div className={styles.codeDisplay}>
            {myCode ? myCode.split("").map((d, i) => <span key={i} className={styles.codeDigit}>{d}</span>) : <div className={styles.spinner} />}
          </div>
          <button onClick={() => setShowIPDetails(!showIPDetails)} className={styles.ghostBtn} style={{ marginTop: 20, border: 'none' }}>
             Advanced Info {showIPDetails ? <FaChevronUp /> : <FaChevronDown />}
          </button>
          {showIPDetails && (
            <div className={styles.ipDisplay}>
              <code>{myIP}</code>
              <button
                className={styles.copyBtn}
                onClick={() => {
                  navigator.clipboard.writeText(myIP);
                  setIpCopied(true);
                  setTimeout(() => setIpCopied(false), 2000);
                }}
                title="Copy IP"
              >
                {ipCopied ? <FaCheck size={13} /> : <FaCopy size={13} />}
              </button>
            </div>
          )}
          <p className={styles.hint}>{waitingForJoiner ? t("waitingForJoiner") : t("generatingCode")}</p>
        </div>
      )}

      {!connected && mode === "join" && (
        <div className={styles.codePanel}>
          <p className={styles.label}>{t("enterSenderIPLabel")}</p>
          <input className={styles.ipInput} value={joinIP} onChange={e => setJoinIP(e.target.value)} placeholder="192.168.x.x" />
          <p className={styles.label} style={{ marginTop: 20 }}>{t("enterCode")}</p>
          <div className={styles.digitRow}>
            {joinCode.map((digit, i) => <input key={i} ref={el => (digitRefs.current[i] = el)} className={styles.digitInput} maxLength={1} value={digit} onChange={e => handleDigitChange(i, e.target.value)} onKeyDown={e => handleDigitKeyDown(i, e)} onPaste={handleDigitPaste} inputMode="numeric" />)}
          </div>
          <button className={styles.btn} onClick={connectWithCode} disabled={joining} style={{ marginTop: 20 }}>{joining ? "Connecting..." : "Connect"}</button>
        </div>
      )}

      {connected && (
        <div className={styles.fileArea}>
          <div className={styles.connectedBadge}><FaCircle size={10} color="#4CAF50" /> {t("connected")}</div>
          <p className={styles.subtitle}>Add files, then start sharing.</p>

          <div className={styles.actionRow}>
            <button className={styles.btn} onClick={addFiles} disabled={isSending}><FaPlus /> Add Files</button>
            <button className={styles.ghostBtn} onClick={addFolder} disabled={isSending}><FaFolderOpen /> Add Folder</button>
          </div>

          {/* ✅ Item 3: empty state only shown when there's truly nothing —
              no queued/sent files AND no incoming files */}
          {fileQueue.length === 0 && Object.keys(receiveMap).length === 0 && receivedFiles.length === 0 && (
            <div className={styles.emptyState}>
              <FaFolderOpen size={40} color="#333" />
              <p>No files added yet.</p>
              <p style={{fontSize: '0.8rem'}}>Click buttons above or press Ctrl+V to paste.</p>
            </div>
          )}

          {fileQueue.length > 0 && (() => {
            const activeFiles = fileQueue.filter(f => f.status !== "done");
            const sentFiles = fileQueue.filter(f => f.status === "done");
            const groups = groupQueueFiles(activeFiles);
            const hasFolders = groups.some(g => g.folderName !== "");
            return (
              <>
                {activeFiles.length > 0 && (
                  <div className={styles.queue} style={{ marginTop: 20 }}>
                    {/* "Collapse All" — no longer sticky, see item 3 */}
                    {hasFolders && (
                      <div className={styles.stickyFolderBar}>
                        <button className={styles.toggleAllBtn} onClick={() => toggleAll(groups)}>
                          {allCollapsed ? "Uncollapse All" : "Collapse All"}
                        </button>
                      </div>
                    )}
                    {groups.map(group => {
                      if (group.folderName === "") {
                        return group.files.map(f => renderQueueRow(f));
                      }
                      const collapsed = collapsedFolders.has(group.folderName);
                      const totalSize = group.files.reduce((s, f) => s + f.size, 0);
                      return (
                        <div key={group.folderName} className={styles.folderGroup}>
                          {/* This header sticks to the top while scrolling
                              through this folder's files (item 3) */}
                          <div className={styles.folderHeader} onClick={() => toggleFolder(group.folderName)}>
                            <span className={styles.folderArrow}>{collapsed ? <FaChevronRight /> : <FaChevronDown />}</span>
                            <span className={styles.folderName}>{group.folderName}</span>
                            <span className={styles.folderMeta}>{group.files.length} files · {formatBytes(totalSize)}</span>
                            <button
                              className={styles.toggleAllBtn}
                              onClick={(e) => { e.stopPropagation(); toggleFolder(group.folderName); }}
                            >
                              {collapsed ? "Uncollapse" : "Collapse"}
                            </button>
                            {!isSending && (
                              <button
                                className={styles.removeFolderBtn}
                                onClick={(e) => { e.stopPropagation(); removeFolder(group.folderName); }}
                                title="Remove folder"
                              >
                                <FaTimes />
                              </button>
                            )}
                          </div>
                          {!collapsed && group.files.map(f => renderQueueRow(f))}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Sent section (item 2) ── */}
                {sentFiles.length > 0 && (
                  <>
                    <div className={styles.sectionDivider}>
                      <span className={styles.sectionLabel}>{t("sent")}</span>
                      <span className={styles.sectionCount}>
                        {sentFiles.length} files · {formatBytes(sentFiles.reduce((s, f) => s + f.size, 0))}
                      </span>
                    </div>
                    <div className={styles.queue}>
                      {sentFiles.map(f => renderQueueRow(f))}
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* ── Receiving in progress ── */}
          {Object.keys(receiveMap).length > 0 && (
            <div className={styles.incomingSection} style={{ marginTop: 20 }}>
              <p className={styles.label}>Incoming Files:</p>
              {Object.entries(receiveMap).map(([id, f]) => (
                <div key={id} className={styles.queueItem}>
                  <span className={styles.queueName}>{f.name}</span>
                  <progress value={f.received} max={f.size} className={styles.progress} />
                  <span>{Math.round((f.received / f.size) * 100)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* ── Received section (item 4) — keeps completed downloads
              visible so the user can see what arrived and still send more ── */}
          {receivedFiles.length > 0 && (
            <>
              <div className={styles.sectionDivider}>
                <span className={styles.sectionLabel}>{t("receivedFiles")}</span>
                <span className={styles.sectionCount}>
                  {receivedFiles.length} files · {formatBytes(receivedFiles.reduce((s, f) => s + f.size, 0))}
                </span>
              </div>
              <div className={styles.queue}>
                {receivedFiles.map(f => (
                  <div key={f.id} className={styles.queueItem}>
                    <div className={styles.queueName}>{f.name}</div>
                    <div className={styles.queueSize}>{formatBytes(f.size)}</div>
                    <div className={styles.queueStatus}>
                      <FaCheck color="#4CAF50" /> {t("sent")}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {fileQueue.some(f => f.status !== "done" && f.status !== "cancelled") && !isSending && (
            <button className={styles.sendBtn} onClick={sendAll} style={{ marginTop: 20, width: '100%', background: '#4CAF50', color: 'white', padding: 15, borderRadius: 10, border: 'none', cursor: 'pointer' }}>
              <FaUpload /> {t("send")} ({formatBytes(fileQueue.filter(f => f.status !== "done" && f.status !== "cancelled").reduce((sum, f) => sum + f.size, 0))})
            </button>
          )}
        </div>
      )}

      {sessionStatus && <div className={styles.status} style={{marginTop: 20, color: 'var(--accent)'}}>{sessionStatus}</div>}
    </div>
  );
};

export default P2PSession;