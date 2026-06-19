import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { 
  FaCircle, FaTimes, FaCheck, FaCopy,
  FaChevronDown, FaChevronUp, FaChevronRight, FaFolderOpen, 
  FaPlus, FaUpload, FaWifi
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

interface ReceivedFile {
  id: string;
  name: string;
  size: number;
  path: string;
}

interface ReceivedGroup {
  folderName: string;
  files: ReceivedFile[];
}

const formatBytes = (b: number) => {
  if (b === 0) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
};

const shortName = (name: string) => name.split("/").pop() || name;

interface FileGroup {
  folderName: string;
  files: QueueFile[];
}

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

const groupReceivedFiles = (files: ReceivedFile[]): ReceivedGroup[] => {
  const groupsMap = new Map<string, ReceivedFile[]>();
  for (const file of files) {
    const parts = file.name.split("/");
    const folder = parts.length > 1 ? parts[0] : "";
    if (!groupsMap.has(folder)) groupsMap.set(folder, []);
    groupsMap.get(folder)!.push(file);
  }
  const groups: ReceivedGroup[] = [];
  const rootFiles = groupsMap.get("") || [];
  for (const [folder, folderFiles] of groupsMap) {
    if (folder) groups.push({ folderName: folder, files: folderFiles });
  }
  if (rootFiles.length > 0) groups.push({ folderName: "", files: rootFiles });
  return groups;
};

const isInvalidFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".crdownload") ||
    lower.endsWith(".part") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".download") ||
    lower.startsWith("~$")
  );
};

type ConnectionState = "idle" | "connected" | "disconnected" | "reconnecting";

const P2PSession: React.FC<Props> = ({ onBack, initialMode }) => {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"choose" | "send" | "join">(
    initialMode === "send" ? "send" : initialMode === "join" ? "join" : "choose"
  );
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
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
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [receivedGroups, setReceivedGroups] = useState<ReceivedGroup[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [allCollapsed, setAllCollapsed] = useState(false);
  
  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const receivePathsRef = useRef<Record<string, string>>({});
  const receiveMapRef = useRef<Record<string, ReceiveEntry>>({});
  const messageQueueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const rejectedRef = useRef<Set<string>>(new Set());
  const stopSendRef = useRef<Set<string>>(new Set());
  const abortBatchRef = useRef(false);

  const showFileArea = useCallback(() => {
    setConnected(true);
    setConnectionState("connected");
  }, []);

  useEffect(() => {
    receiveMapRef.current = receiveMap;
  }, [receiveMap]);

  useEffect(() => {
    setReceivedGroups(groupReceivedFiles(receivedFiles));
  }, [receivedFiles]);

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

  // ─── WebRTC connection state monitoring ─────────────────────────────────────
  const setupConnectionMonitor = useCallback((pc: RTCPeerConnection) => {
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "disconnected" || state === "failed" || state === "closed") {
        setConnectionState("disconnected");
        setConnected(false);
        setSessionStatus("Disconnected. Try checking your network...");
      } else if (state === "connecting") {
        setConnectionState("reconnecting");
      } else if (state === "connected") {
        setConnectionState("connected");
        setConnected(true);
        setSessionStatus("");
      }
    };
  }, []);

  // ─── Paste handler ───────────────────────────────────────────────────────────
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    if (isSending) return;

    const clipboard = e.clipboardData;
    if (!clipboard) return;

    const browserFiles = Array.from(clipboard.files);
    const items = Array.from(clipboard.items);
    const plainText = clipboard.getData("text/plain");

    e.preventDefault();

    let clipboardPaths: { paths: string[]; type: string } = { paths: [], type: "none" };
    try {
      clipboardPaths = await window.electronAPI.getClipboardFiles();
    } catch (err) {
      console.warn("getClipboardFiles failed:", err);
    }

    if (clipboardPaths.paths.length > 0) {
      const newFiles: QueueFile[] = [];
      for (const rawPath of clipboardPaths.paths) {
        try {
          const size = await window.electronAPI.getFileSize(rawPath);
          const name = rawPath.split(/[\\\/]/).pop() || rawPath;
          if (!isInvalidFile(name)) {
            newFiles.push({
              id: Math.random().toString(36).substring(2, 9),
              name,
              path: rawPath,
              size,
              status: "queued",
              progress: 0,
              source: "file",
            });
          }
        } catch (err) {
          console.error("Could not process path:", rawPath, err);
        }
      }
      if (newFiles.length > 0) {
        setFileQueue(prev => [...prev, ...newFiles]);
        return;
      }
    }

    if (browserFiles.length > 0) {
      const newFiles: QueueFile[] = [];
      for (const f of browserFiles) {
        const filePath = (f as any).path || null;
        const name = f.name;
        if (isInvalidFile(name)) continue;
        let size = f.size;
        if (size === 0 && filePath) {
          try { size = await window.electronAPI.getFileSize(filePath); } catch { }
        }
        newFiles.push({
          id: Math.random().toString(36).substring(2, 9),
          name,
          path: filePath,
          size,
          status: "queued",
          progress: 0,
          source: "file",
        });
      }
      if (newFiles.length > 0) {
        setFileQueue(prev => [...prev, ...newFiles]);
        return;
      }
    }

    const imageItem = items.find(item => item.type.startsWith("image/"));
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `screenshot-${Date.now()}.png`;
          const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
          setFileQueue(prev => [...prev, {
            id: Math.random().toString(36).substring(2, 9),
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

    if (plainText && plainText.trim()) {
      const fileName = `note-${Date.now()}.txt`;
      const base64 = btoa(unescape(encodeURIComponent(plainText)));
      const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
      setFileQueue(prev => [...prev, {
        id: Math.random().toString(36).substring(2, 9),
        name: fileName,
        path: savedPath,
        size: new Blob([plainText]).size,
        status: "queued",
        progress: 0,
        source: "file",
      }]);
    }
  }, [isSending]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: QueueFile[] = await Promise.all(
      paths.map(async p => ({
        id: Math.random().toString(36).substring(2, 9),
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
        id: Math.random().toString(36).substring(2, 9),
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

  // Cancel a single file — works before AND during transfer
  const cancelFile = (id: string) => {
    stopSendRef.current.add(id);
    setFileQueue(prev => prev.map(f =>
      f.id === id && (f.status === "queued" || f.status === "transferring")
        ? { ...f, status: "cancelled" }
        : f
    ));
  };

  // Cancel an entire folder — works before AND during transfer
  const cancelFolder = (folderName: string) => {
    setFileQueue(prev => {
      const ids: string[] = [];
      const next = prev.map(f => {
        const parts = f.name.split("/");
        const folder = parts.length > 1 ? parts[0] : "";
        if (folder === folderName && (f.status === "queued" || f.status === "transferring")) {
          ids.push(f.id);
          return { ...f, status: "cancelled" as const };
        }
        return f;
      });
      ids.forEach(id => stopSendRef.current.add(id));
      return next;
    });
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      next.delete(folderName);
      return next;
    });
  };

  const toggleFolder = (folderName: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName); else next.add(folderName);
      return next;
    });
  };

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

  const sendAll = async () => {
    const dc = localDC.current;
    if (!dc || dc.readyState !== "open") return;

    abortBatchRef.current = false;
    stopSendRef.current.clear();

    setIsSending(true);
    // Snapshot the queue at send time
    let queue: QueueFile[] = [];
    setFileQueue(prev => { queue = prev; return prev; });
    await new Promise(r => setTimeout(r, 0));

    for (const file of queue) {
      if (file.status === "done" || file.status === "cancelled") continue;
      if (abortBatchRef.current) break;
      if (stopSendRef.current.has(file.id)) continue;

      dc.send(JSON.stringify({
        type: "file-start", id: file.id, name: file.name, size: file.size, fromOffset: 0
      }));

      const CHUNK_SIZE = 16384;
      let offset = 0;

      while (offset < file.size) {
        if (abortBatchRef.current || stopSendRef.current.has(file.id)) break;
        if (dc.bufferedAmount > 1024 * 1024) {
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
        
        if (progress % 5 === 0) {
          setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: "transferring", progress } : f));
        }
      }

      if (abortBatchRef.current || stopSendRef.current.has(file.id)) continue;

      dc.send(JSON.stringify({ type: "file-end", id: file.id }));
      setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: "done", progress: 100 } : f));
      window.electronAPI.logP2pActivity("sent", file.name);
    }
    setIsSending(false);
  };

  const handleDCMessage = useCallback(async (raw: string) => {
    let msg: any; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "file-reject") {
      stopSendRef.current.add(msg.id);
      abortBatchRef.current = true;
      setFileQueue(prev => prev.map(f => f.id === msg.id ? { ...f, status: "cancelled" } : f));
      if (msg.reason === "no-space") {
        setSessionStatus(t("receiverNoSpace", { name: shortName(msg.name || "") }));
      } else {
        setSessionStatus(t("receiverDeclined", { name: shortName(msg.name || "") }));
      }
      return;
    }

    if (msg.type === "file-start") {
      try {
        const { free } = await window.electronAPI.getDiskSpace();
        if (free > 0 && msg.size > free) {
          rejectedRef.current.add(msg.id);
          const dc = localDC.current;
          if (dc && dc.readyState === "open") {
            dc.send(JSON.stringify({
              type: "file-reject",
              id: msg.id,
              reason: "no-space",
              name: msg.name,
            }));
          }
          setSessionStatus(
            t("notEnoughSpace", {
              name: shortName(msg.name),
              size: formatBytes(msg.size),
              free: formatBytes(free),
            }),
          );
          return;
        }
      } catch { }

      const saveDir = await window.electronAPI.getSavePath();
      const safeName = msg.name.replace(/\//g, "\\");
      const savePath = saveDir + "\\" + safeName;

      receivePathsRef.current[msg.id] = savePath;
      await window.electronAPI.createReceiveFile(savePath);
      setReceiveMap(prev => ({ ...prev, [msg.id]: { name: msg.name, size: msg.size, path: savePath, received: 0 } }));
    }

    if (msg.type === "file-chunk") {
      if (rejectedRef.current.has(msg.id)) return;
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
      if (rejectedRef.current.has(msg.id)) {
        rejectedRef.current.delete(msg.id);
        return;
      }
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
      window.electronAPI.logP2pActivity("received", msg.name || entry?.name || "");
    }
  }, [t]);

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
      setupConnectionMonitor(pc);
      const dc = pc.createDataChannel("mayo-share", { ordered: true });
      localDC.current = dc;
      dc.onopen = () => { showFileArea(); };
      dc.onmessage = e => { messageQueueRef.current.push(e.data); processMessageQueue(); };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise(r => setTimeout(r, 1500));
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
      setupConnectionMonitor(pc);
      pc.ondatachannel = event => {
        localDC.current = event.channel;
        localDC.current.onopen = () => { showFileArea(); };
        localDC.current.onmessage = e => { messageQueueRef.current.push(e.data); processMessageQueue(); };
      };
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSDP }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
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

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (joinCode[index]) {
        const newCode = [...joinCode];
        newCode[index] = "";
        setJoinCode(newCode);
      } else if (index > 0) {
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

  // ─── Per-file/per-folder cancel button in queue rows ────────────────────────
  // Shows for both queued AND transferring files/folders
  const renderQueueRow = (f: QueueFile) => (
    <div key={f.id} className={styles.queueItem}>
      <div className={styles.queueName}>{f.name}</div>
      <div className={styles.queueSize}>{formatBytes(f.size)}</div>
      {f.status === "transferring" && <progress value={f.progress} max="100" className={styles.progress} />}
      {f.status !== "queued" && (
        <div className={styles.queueStatus}>
          {f.status === "done"
            ? <FaCheck color="#4CAF50" />
            : f.status === "transferring"
              ? `${f.progress}%`
              : f.status}
        </div>
      )}
      {/* Cancel button: visible for queued and transferring — not for done/cancelled */}
      {(f.status === "queued" || f.status === "transferring") && (
        <button className={styles.removeBtn} onClick={() => cancelFile(f.id)} title="Cancel">
          <FaTimes />
        </button>
      )}
    </div>
  );

  // Disconnection banner (no resume UI, just the message)
  const showDisconnectBanner = connectionState === "disconnected";

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("deviceConnect")}</h2>

      {/* Disconnection smart banner */}
      {showDisconnectBanner && (
        <div style={{
          background: "#3a1a1a",
          border: "1px solid #c62828",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
        }}>
          <FaWifi color="#c62828" size={18} style={{ marginTop: 2 }} />
          <div>
            <div style={{ color: "#ef5350", fontWeight: 600, marginBottom: 4 }}>
              Disconnected. Try checking your network...
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Re-enter the code from your sender to reconnect.
            </div>
          </div>
        </div>
      )}

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

          {/* Send button at top, before file list */}
          {fileQueue.some(f => f.status !== "done" && f.status !== "cancelled") && !isSending && (
            <button className={styles.sendBtn} onClick={sendAll} style={{ width: '100%' }}>
              <FaUpload /> {t("send")} ({formatBytes(fileQueue.filter(f => f.status !== "done" && f.status !== "cancelled").reduce((sum, f) => sum + f.size, 0))})
            </button>
          )}

          <div className={styles.actionRow}>
            <button className={styles.btn} onClick={addFiles} disabled={isSending}><FaPlus /> Add Files</button>
            <button className={styles.ghostBtn} onClick={addFolder} disabled={isSending}><FaFolderOpen /> Add Folder</button>
          </div>

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
                  <>
                    {hasFolders && (
                      <div className={styles.stickyFolderBar}>
                        <button className={styles.toggleAllBtn} onClick={() => toggleAll(groups)}>
                          {allCollapsed ? "Expand All" : "Collapse All"}
                        </button>
                      </div>
                    )}
                    <div className={styles.queue}>
                    {groups.map(group => {
                      if (group.folderName === "") {
                        return group.files.map(f => renderQueueRow(f));
                      }
                      const collapsed = collapsedFolders.has(group.folderName);
                      const totalSize = group.files.reduce((s, f) => s + f.size, 0);
                      const folderIsActive = group.files.some(f => f.status === "queued" || f.status === "transferring");
                      return (
                        <div key={group.folderName} className={styles.folderGroup}>
                          <div className={styles.folderHeader} onClick={() => toggleFolder(group.folderName)}>
                            <span className={styles.folderArrow}>{collapsed ? <FaChevronRight /> : <FaChevronDown />}</span>
                            <span className={styles.folderName}>{group.folderName}</span>
                            <span className={styles.folderMeta}>{group.files.length} files · {formatBytes(totalSize)}</span>
                            <button
                              className={styles.toggleAllBtn}
                              onClick={(e) => { e.stopPropagation(); toggleFolder(group.folderName); }}
                            >
                              {collapsed ? "Expand" : "Collapse"}
                            </button>
                            {/* Cancel folder button: visible when folder has queued or transferring files */}
                            {folderIsActive && (
                              <button
                                className={styles.removeFolderBtn}
                                onClick={(e) => { e.stopPropagation(); cancelFolder(group.folderName); }}
                                title="Cancel folder"
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
                  </>
                )}

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

          {Object.keys(receiveMap).length > 0 && (
            <div className={styles.incomingSection}>
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

          {receivedFiles.length > 0 && (
            <>
              <div className={styles.sectionDivider}>
                <span className={styles.sectionLabel}>{t("receivedFiles")}</span>
                <span className={styles.sectionCount}>
                  {receivedFiles.length} files · {formatBytes(receivedFiles.reduce((s, f) => s + f.size, 0))}
                </span>
              </div>
              <div className={styles.queue}>
                {receivedGroups.map(group => {
                  if (group.folderName === "") {
                    return group.files.map(f => (
                      <div key={f.id} className={styles.queueItem}>
                        <div className={styles.queueName}>{f.name}</div>
                        <div className={styles.queueSize}>{formatBytes(f.size)}</div>
                        <div className={styles.queueStatus}><FaCheck color="#4CAF50" /></div>
                      </div>
                    ));
                  }
                  const collapsed = collapsedFolders.has(`received-${group.folderName}`);
                  const totalSize = group.files.reduce((s, f) => s + f.size, 0);
                  return (
                    <div key={group.folderName} className={styles.folderGroup}>
                      <div className={styles.folderHeader} onClick={() => toggleFolder(`received-${group.folderName}`)}>
                        <span className={styles.folderArrow}>{collapsed ? <FaChevronRight /> : <FaChevronDown />}</span>
                        <span className={styles.folderName}>{group.folderName}</span>
                        <span className={styles.folderMeta}>{group.files.length} files · {formatBytes(totalSize)}</span>
                        <button
                          className={styles.toggleAllBtn}
                          onClick={(e) => { e.stopPropagation(); toggleFolder(`received-${group.folderName}`); }}
                        >
                          {collapsed ? "Expand" : "Collapse"}
                        </button>
                      </div>
                      {!collapsed && group.files.map(f => (
                        <div key={f.id} className={styles.queueItem}>
                          <div className={styles.queueName}>{f.name.split("/").slice(1).join("/") || f.name}</div>
                          <div className={styles.queueSize}>{formatBytes(f.size)}</div>
                          <div className={styles.queueStatus}><FaCheck color="#4CAF50" /></div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {sessionStatus && <div className={styles.status} style={{marginTop: 20, color: 'var(--accent)'}}>{sessionStatus}</div>}
    </div>
  );
};

export default P2PSession;