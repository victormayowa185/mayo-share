import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  FaCircle, FaTimes, FaCheck, FaCopy,
  FaChevronDown, FaChevronUp, FaChevronRight, FaFolderOpen,
  FaPlus, FaUpload, FaWifi, FaPlay, FaTrash,
  FaLock, FaShieldAlt, FaExclamationTriangle, FaCloudUploadAlt
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
  cancelled?: boolean;
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

// Exact decoded byte length of a base64 string WITHOUT decoding it.
// (atob() on a 256KB chunk, ~8000 times for a 2GB file, was choking the receiver.)
const base64ByteLength = (b64: string): number => {
  const len = b64.length;
  if (len === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((len * 3) / 4) - padding;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

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

// ─── Persistence helpers ──────────────────────────────────────────────────────
const SESSION_STORAGE_KEY = "mayo_p2p_session_cache";

const saveSessionToDisk = (queue: QueueFile[]) => {
  const data = { queue };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
};

const loadSessionFromDisk = () => {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};

const clearSessionFromDisk = () => {
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

// ─── Component ─────────────────────────────────────────────────────────────────
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

  // ─── Solana integrity state ───────────────────────────────────────────────
  const [integrityEnabled, setIntegrityEnabled] = useState(false);
  const integrityEnabledRef = useRef(false);

  const [safetyCode, setSafetyCode] = useState("");
  const [verifyMap, setVerifyMap] =
    useState<Record<string, "pending" | "verified" | "tampered">>({});

  // ─── Resume state ────────────────────────────────────────────────────────────
  const [resumeOffer, setResumeOffer] = useState<{
    offsets: Record<string, number>;
  } | null>(null);

  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const receivePathsRef = useRef<Record<string, string>>({});
  const receiveMapRef = useRef<Record<string, ReceiveEntry>>({});
  // Per-file running progress kept in a ref so we can accumulate every chunk's
  // bytes WITHOUT re-rendering React on each of the ~8000 chunks. We only push
  // to state (which re-renders the progress bar) when the whole-number percent
  // actually changes.
  const receiveProgressRef = useRef<Record<string, { received: number; size: number; lastPct: number }>>({});
  const messageQueueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const rejectedRef = useRef<Set<string>>(new Set());
  const stopSendRef = useRef<Set<string>>(new Set());
  const abortBatchRef = useRef(false);
  const fileQueueRef = useRef<QueueFile[]>([]);
  const resumeOfferRef = useRef<{ offsets: Record<string, number> } | null>(null);
  const intentionalCloseRef = useRef(false);
  const sendingRef = useRef(false);

  // ─── Solana integrity refs ────────────────────────────────────────────────
  const myPubKeyRef = useRef<string>("");
  const peerPubKeyRef = useRef<string>("");
  const verifierMap = useRef<Record<string, string>>({});

  // Refs to the rendered rows / folder groups so we can animate them out
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const folderRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ─── Load integrity setting ────────────────────────────────────────────────
  useEffect(() => {
    window.electronAPI.getIntegrityCheck().then(val => {
      setIntegrityEnabled(val);
      integrityEnabledRef.current = val;
    });
  }, []);

  // ─── Fade helpers ──────────────────────────────────────────────────────────
  const fadeOutRow = (id: string, remove: () => void) => {
    const el = rowRefs.current[id];
    if (!el) { setTimeout(remove, 2400); return; }
    gsap.to(el, {
      opacity: 0, height: 0, marginTop: 0, marginBottom: 0,
      paddingTop: 0, paddingBottom: 0, overflow: "hidden",
      duration: 0.4, delay: 2, ease: "power2.in",
      onComplete: () => { delete rowRefs.current[id]; remove(); },
    });
  };

  const fadeOutFolder = (folderName: string, remove: () => void) => {
    const el = folderRefs.current[folderName];
    if (!el) { setTimeout(remove, 2400); return; }
    gsap.to(el, {
      opacity: 0, height: 0, marginTop: 0, marginBottom: 0, overflow: "hidden",
      duration: 0.4, delay: 2, ease: "power2.in",
      onComplete: () => { delete folderRefs.current[folderName]; remove(); },
    });
  };

  const showFileArea = useCallback(() => {
    setConnected(true);
    setConnectionState("connected");
  }, []);

  // Load our Solana identity (public key) once when the screen mounts.
  useEffect(() => {
    window.electronAPI.getPublicKey().then((pk) => { myPubKeyRef.current = pk; });
  }, []);

  // Once we know BOTH keys, compute the shared safety code.
  const updateSafetyCode = async () => {
    const mine = myPubKeyRef.current;
    const peer = peerPubKeyRef.current;
    if (!mine || !peer) return;
    try {
      const code = await window.electronAPI.safetyNumber(mine, peer);
      setSafetyCode(code);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    receiveMapRef.current = receiveMap;
  }, [receiveMap]);

  useEffect(() => {
    fileQueueRef.current = fileQueue;
  }, [fileQueue]);

  useEffect(() => {
    resumeOfferRef.current = resumeOffer;
  }, [resumeOffer]);

  // Restore an interrupted SEND session
  useEffect(() => {
    if (initialMode !== "send") return;
    const saved = loadSessionFromDisk();
    if (saved && saved.queue && saved.queue.length > 0) {
      setFileQueue(
        saved.queue.map((f: QueueFile) => ({
          ...f,
          status: f.status === "transferring" ? "queued" : f.status,
        }))
      );
    }
  }, []);

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
      if (state === "failed" || state === "disconnected") {
        if (intentionalCloseRef.current) return;
        setConnectionState("disconnected");
        setConnected(false);
        setSessionStatus("");
      } else if (state === "connecting") {
        setConnectionState("reconnecting");
      } else if (state === "connected") {
        intentionalCloseRef.current = false;
        setConnectionState("connected");
        setConnected(true);
        setSessionStatus("");
      }
    };
  }, []);

  // ─── Data-channel death detection ───────────────────────────────────────────
  // The peer connection can stay "connected" while the SCTP data channel quietly
  // closes (e.g. buffer overflow mid multi-GB transfer). Without these handlers
  // the sender keeps "sending" into a dead channel and marks files done.
  const setupDataChannelMonitor = useCallback((dc: RTCDataChannel) => {
    dc.onclose = () => {
      if (intentionalCloseRef.current) return;
      sendingRef.current = false;
      abortBatchRef.current = true;
      setIsSending(false);
      setConnectionState("disconnected");
      setConnected(false);
      setSessionStatus("");
    };
    dc.onerror = () => {
      if (intentionalCloseRef.current) return;
      sendingRef.current = false;
      abortBatchRef.current = true;
      setIsSending(false);
      setConnectionState("disconnected");
      setConnected(false);
    };
  }, []);

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  const cleanupWebRTC = useCallback(() => {
    intentionalCloseRef.current = true;
    if (localDC.current) {
      localDC.current.close();
      localDC.current = null;
    }
    if (localPC.current) {
      localPC.current.close();
      localPC.current = null;
    }
    setWaitingForJoiner(false);
    setJoining(false);
    setIsSending(false);
    setResumeOffer(null);
  }, []);

  // ─── Paste handler ──────────────────────────────────────────────────────────
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }
    const clipboard = e.clipboardData;
    if (!clipboard) return;
    const browserFiles = Array.from(clipboard.files);
    const items = Array.from(clipboard.items);
    const plainText = clipboard.getData("text/plain");
    const imageItemSync = items.find(item => item.type.startsWith("image/"));
    const imageBlobSync = imageItemSync ? imageItemSync.getAsFile() : null;
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
        const name = f.name;
        if (isInvalidFile(name)) continue;
        let filePath = (f as any).path || null;
        let size = f.size;
        if (!filePath) {
          try {
            const base64 = await blobToBase64(f);
            filePath = await window.electronAPI.saveTempFile(name, base64);
          } catch { continue; }
        } else if (size === 0) {
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

    if (imageBlobSync) {
      const base64 = await blobToBase64(imageBlobSync);
      const fileName = `screenshot-${Date.now()}.png`;
      const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
      setFileQueue(prev => [...prev, {
        id: Math.random().toString(36).substring(2, 9),
        name: fileName,
        path: savedPath,
        size: imageBlobSync.size,
        status: "queued",
        progress: 0,
        source: "file",
      }]);
      return;
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

  // ─── File & folder pickers ──────────────────────────────────────────────────
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

  // ─── Drag & drop ─────────────────────────────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const processDroppedItems = async (fileList: FileList) => {
    const newFiles: QueueFile[] = [];
    const mk = (name: string, path: string, size: number): QueueFile => ({
      id: Math.random().toString(36).substring(2, 9),
      name,
      path,
      size,
      status: "queued",
      progress: 0,
      source: "file",
    });
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      let filePath = "";
      try { filePath = window.electronAPI.getPathForFile(f); } catch { }

      if (!filePath) {
        if (isInvalidFile(f.name)) continue;
        try {
          const base64 = await blobToBase64(f);
          filePath = await window.electronAPI.saveTempFile(f.name, base64);
        } catch { continue; }
        newFiles.push(mk(f.name, filePath, f.size));
        continue;
      }

      let isDir = false;
      try { isDir = await window.electronAPI.isDirectory(filePath); } catch { }
      if (isDir) {
        try {
          const walked = await window.electronAPI.walkDirectory(filePath);
          for (const w of walked) {
            if (isInvalidFile(w.relative)) continue;
            let size = 0;
            try { size = await window.electronAPI.getFileSize(w.absolute); } catch { }
            newFiles.push(mk(w.relative, w.absolute, size));
          }
        } catch { }
        continue;
      }

      const name = f.name || filePath.split(/[\\/]/).pop() || filePath;
      if (isInvalidFile(name)) continue;
      let size = f.size;
      try { size = await window.electronAPI.getFileSize(filePath); } catch { }
      newFiles.push(mk(name, filePath, size));
    }
    if (newFiles.length > 0) setFileQueue(prev => [...prev, ...newFiles]);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (Array.from(e.dataTransfer.types || []).includes("Files")) setIsDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDragging(false); }
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    await processDroppedItems(dropped);
  };

  const cancelFile = (id: string) => {
    stopSendRef.current.add(id);
    setFileQueue(prev => prev.map(f =>
      f.id === id && (f.status === "queued" || f.status === "transferring")
        ? { ...f, status: "cancelled" }
        : f
    ));
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "cancel-file", id }));
    }
    fadeOutRow(id, () =>
      setFileQueue(prev => prev.filter(f => f.id !== id))
    );
  };

  const cancelFolder = (folderName: string) => {
    const ids = fileQueueRef.current
      .filter(f => {
        const folder = f.name.includes("/") ? f.name.split("/")[0] : "";
        return folder === folderName && (f.status === "queued" || f.status === "transferring");
      })
      .map(f => f.id);
    ids.forEach(id => stopSendRef.current.add(id));
    setFileQueue(prev => prev.map(f =>
      ids.includes(f.id) ? { ...f, status: "cancelled" as const } : f
    ));
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "cancel-folder", folderName }));
    }
    fadeOutFolder(folderName, () =>
      setFileQueue(prev => prev.filter(f => !ids.includes(f.id)))
    );
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      next.delete(folderName);
      return next;
    });
  };

  const cancelIncomingFile = (id: string) => {
    const entry = receiveMapRef.current[id];
    rejectedRef.current.add(id);
    const cancelPath = receivePathsRef.current[id];
    delete receivePathsRef.current[id];
    if (cancelPath) {
      try { window.electronAPI.finishReceiveFile(cancelPath); } catch { /* ignore */ }
    }
    setReceiveMap(prev =>
      prev[id] ? { ...prev, [id]: { ...prev[id], cancelled: true } } : prev
    );
    fadeOutRow(id, () =>
      setReceiveMap(prev => { const n = { ...prev }; delete n[id]; return n; })
    );
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({
        type: "receiver-cancel-file",
        id,
        name: entry?.name || "",
      }));
    }
  };

  const cancelIncomingFolder = (folderName: string) => {
    const ids: string[] = [];
    for (const [id, entry] of Object.entries(receiveMapRef.current)) {
      const folder = entry.name.includes("/") ? entry.name.split("/")[0] : "";
      if (folder === folderName) ids.push(id);
    }
    ids.forEach(id => {
      rejectedRef.current.add(id);
      const cancelPath = receivePathsRef.current[id];
      delete receivePathsRef.current[id];
      if (cancelPath) {
        try { window.electronAPI.finishReceiveFile(cancelPath); } catch { /* ignore */ }
      }
    });
    setReceiveMap(prev => {
      const n = { ...prev };
      ids.forEach(id => { if (n[id]) n[id] = { ...n[id], cancelled: true }; });
      return n;
    });
    ids.forEach(id =>
      fadeOutRow(id, () =>
        setReceiveMap(prev => { const n = { ...prev }; delete n[id]; return n; })
      )
    );
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({
        type: "receiver-cancel-folder",
        folderName,
      }));
    }
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

  // ─── sendAll with conditional integrity ────────────────────────────────────
  const sendAll = async (startOffsets: Record<string, number> = {}) => {
    const dc = localDC.current;
    if (!dc || dc.readyState !== "open") return;
    if (sendingRef.current) return;

    sendingRef.current = true;
    abortBatchRef.current = false;
    setIsSending(true);
    saveSessionToDisk(fileQueueRef.current);

    const processed = new Set<string>();

    try {
      while (!abortBatchRef.current) {
        const file = fileQueueRef.current.find(
          f => f.status === "queued" && !processed.has(f.id) && !stopSendRef.current.has(f.id)
        );
        if (!file) break;
        processed.add(file.id);

        const offset = startOffsets[file.id] || 0;
        setFileQueue(prev => prev.map(f =>
          f.id === file.id
            ? { ...f, status: "transferring", progress: Math.min(100, Math.round((offset / Math.max(file.size, 1)) * 100)) }
            : f
        ));

        // Start a streaming signer ONLY if integrity is enabled
        let signerKey: string | null = null;
        if (integrityEnabledRef.current) {
          try {
            signerKey = await window.electronAPI.startStreamSign();
          } catch (err) {
            console.error("startStreamSign failed:", err);
          }
        }

        dc.send(JSON.stringify({
          type: "file-start",
          id: file.id,
          name: file.name,
          size: file.size,
          offset,
        }));

        const CHUNK_SIZE = 256 * 1024;
        let currentOffset = offset;
        let cancelled = false;

        while (currentOffset < file.size) {
          if (abortBatchRef.current || stopSendRef.current.has(file.id)) {
            cancelled = true;
            break;
          }
          // Bail out if the channel died mid-transfer instead of "sending" into
          // the void and then marking the file done.
          if (dc.readyState !== "open") {
            cancelled = true;
            abortBatchRef.current = true;
            break;
          }
          if (dc.bufferedAmount > 1024 * 1024) {
            await new Promise(resolve => {
              const check = () => {
                if (dc.bufferedAmount < 512 * 1024) resolve(null);
                else setTimeout(check, 50);
              };
              check();
            });
          }

          const base64 = await window.electronAPI.readFileChunk(file.path!, currentOffset, CHUNK_SIZE);

          // Feed chunk into hasher only if integrity is on
          if (signerKey) {
            try {
              await window.electronAPI.streamSignChunk(signerKey, base64);
            } catch { /* non-fatal */ }
          }

          dc.send(JSON.stringify({ type: "file-chunk", id: file.id, data: base64, offset: currentOffset }));

          currentOffset += CHUNK_SIZE;
          const progress = Math.min(100, Math.round((currentOffset / file.size) * 100));
          if (progress % 5 === 0) {
            setFileQueue(prev => {
              const next = prev.map(f =>
                f.id === file.id ? { ...f, status: "transferring", progress } : f
              );
              saveSessionToDisk(next);
              return next;
            });
          }
        }

        if (cancelled) {
          if (signerKey) {
            try { await window.electronAPI.finishStreamSign(signerKey); } catch { }
          }
          continue;
        }

        let proof: { hash: string; signature: string; publicKey: string } | null = null;
        if (signerKey) {
          try {
            proof = await window.electronAPI.finishStreamSign(signerKey);
          } catch (err) {
            console.error("finishStreamSign failed:", err);
          }
        }

        dc.send(JSON.stringify({
          type: "file-end",
          id: file.id,
          name: file.name,
          size: file.size,
          hash: proof?.hash,
          signature: proof?.signature,
          publicKey: proof?.publicKey,
        }));

        setFileQueue(prev => {
          const next = prev.map(f =>
            f.id === file.id ? { ...f, status: "done", progress: 100 } : f
          );
          saveSessionToDisk(next);
          return next;
        });
        window.electronAPI.logP2pActivity("sent", file.name);
      }
    } finally {
      sendingRef.current = false;
      setIsSending(false);
      const stillPending = fileQueueRef.current.some(
        f => f.status === "queued" || f.status === "transferring"
      );
      if (!stillPending && !abortBatchRef.current) clearSessionFromDisk();
    }
  };

  // ─── handleDCMessage with conditional integrity ──────────────────────────
  const handleDCMessage = useCallback(async (raw: string) => {
    let msg: any; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "handshake-offer") {
      const saveDir = await window.electronAPI.getSavePath();
      const sep = saveDir.includes("\\") ? "\\" : "/";
      const mayoShareDir = saveDir + sep + "MAYO Share";
      const offsets: Record<string, number> = {};
      for (const f of msg.files) {
        const safeName = f.name.replace(/\//g, sep);
        const savePath = mayoShareDir + sep + safeName;
        let onDisk = 0;
        try {
          onDisk = await window.electronAPI.getFileSize(savePath);
        } catch {
          onDisk = 0;
        }
        if (onDisk > 0 && onDisk < f.size) {
          offsets[f.id] = onDisk;
        }
      }

      // Only pin keys and compute safety code if integrity is enabled
      if (integrityEnabledRef.current && msg.senderPublicKey) {
        peerPubKeyRef.current = msg.senderPublicKey;
        updateSafetyCode();
      }

      if (localDC.current && localDC.current.readyState === "open") {
        localDC.current.send(JSON.stringify({
          type: "handshake-response",
          offsets,
          receiverPublicKey: integrityEnabledRef.current ? myPubKeyRef.current : "",
        }));
      }

      if (Object.keys(offsets).length > 0) {
        setResumeOffer({ offsets });
      }
      return;
    }

    if (msg.type === "handshake-response") {
      if (integrityEnabledRef.current && msg.receiverPublicKey) {
        peerPubKeyRef.current = msg.receiverPublicKey;
        updateSafetyCode();
      }
      if (msg.offsets && Object.keys(msg.offsets).length > 0) {
        setResumeOffer({ offsets: msg.offsets });
      } else {
        setResumeOffer(null);
      }
      return;
    }

    if (msg.type === "request-send") {
      setResumeOffer(null);
      if (msg.fresh) clearSessionFromDisk();
      const offsets = msg.fresh ? {} : (resumeOfferRef.current?.offsets || {});
      sendAll(offsets);
      return;
    }

    if (msg.type === "resume-dismiss") {
      setResumeOffer(null);
      return;
    }

    if (msg.type === "file-reject") {
      stopSendRef.current.add(msg.id);
      abortBatchRef.current = true;
      setFileQueue(prev => prev.map(f => f.id === msg.id ? { ...f, status: "cancelled" } : f));
      if (msg.reason === "no-space") {
        setSessionStatus(t("receiverNoSpace", { name: shortName(msg.name || "") }));
      } else {
        fadeOutRow(msg.id, () => setFileQueue(prev => prev.filter(f => f.id !== msg.id)));
      }
      return;
    }

    if (msg.type === "cancel-file") {
      rejectedRef.current.add(msg.id);
      const cancelPath = receivePathsRef.current[msg.id];
      delete receivePathsRef.current[msg.id];
      if (cancelPath) {
        try { await window.electronAPI.finishReceiveFile(cancelPath); } catch { /* ignore */ }
      }
      const vid = verifierMap.current[msg.id];
      if (vid) {
        try { await window.electronAPI.finishVerifyHash(vid); } catch {}
        delete verifierMap.current[msg.id];
      }
      setReceiveMap(prev =>
        prev[msg.id] ? { ...prev, [msg.id]: { ...prev[msg.id], cancelled: true } } : prev
      );
      fadeOutRow(msg.id, () =>
        setReceiveMap(prev => { const n = { ...prev }; delete n[msg.id]; return n; })
      );
      return;
    }

    if (msg.type === "cancel-folder") {
      const ids = Object.keys(receiveMapRef.current).filter(id => {
        const name = receiveMapRef.current[id].name;
        const folder = name.includes("/") ? name.split("/")[0] : "";
        return folder === msg.folderName;
      });
      ids.forEach(id => {
        rejectedRef.current.add(id);
        const cancelPath = receivePathsRef.current[id];
        delete receivePathsRef.current[id];
        if (cancelPath) {
          try { window.electronAPI.finishReceiveFile(cancelPath); } catch {}
        }
        const vid = verifierMap.current[id];
        if (vid) {
          try { window.electronAPI.finishVerifyHash(vid); } catch {}
          delete verifierMap.current[id];
        }
      });
      setReceiveMap(prev => {
        const n = { ...prev };
        ids.forEach(id => { if (n[id]) n[id] = { ...n[id], cancelled: true }; });
        return n;
      });
      ids.forEach(id =>
        fadeOutRow(id, () =>
          setReceiveMap(prev => { const n = { ...prev }; delete n[id]; return n; })
        )
      );
      return;
    }

    if (msg.type === "receiver-cancel-file") {
      stopSendRef.current.add(msg.id);
      setFileQueue(prev => prev.map(f =>
        f.id === msg.id && (f.status === "queued" || f.status === "transferring")
          ? { ...f, status: "cancelled" }
          : f
      ));
      fadeOutRow(msg.id, () =>
        setFileQueue(prev => prev.filter(f => f.id !== msg.id))
      );
      return;
    }

    if (msg.type === "receiver-cancel-folder") {
      const ids = fileQueueRef.current
        .filter(f => {
          const folder = f.name.includes("/") ? f.name.split("/")[0] : "";
          return folder === msg.folderName && (f.status === "queued" || f.status === "transferring");
        })
        .map(f => f.id);
      ids.forEach(id => stopSendRef.current.add(id));
      setFileQueue(prev => prev.map(f =>
        ids.includes(f.id) ? { ...f, status: "cancelled" as const } : f
      ));
      fadeOutFolder(msg.folderName, () =>
        setFileQueue(prev => prev.filter(f => !ids.includes(f.id)))
      );
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

      setReceiveMap(prev => { const n = { ...prev }; delete n[msg.id]; return n; });

      const saveDir = await window.electronAPI.getSavePath();
      const sep = saveDir.includes("\\") ? "\\" : "/";
      const mayoShareDir = saveDir + sep + "MAYO Share";
      const safeName = msg.name.replace(/\//g, sep);
      const savePath = mayoShareDir + sep + safeName;

      const isResuming = msg.offset && msg.offset > 0;
      await window.electronAPI.createReceiveFile(savePath, isResuming);
      receivePathsRef.current[msg.id] = savePath;

      // Start verifier only if integrity is enabled
      let verifierId: string | null = null;
      if (integrityEnabledRef.current) {
        try {
          verifierId = await window.electronAPI.startVerifyHash();
        } catch { /* ignore */ }
      }
      verifierMap.current[msg.id] = verifierId || "";

      receiveProgressRef.current[msg.id] = { received: msg.offset || 0, size: msg.size, lastPct: -1 };
      setReceiveMap(prev => ({ ...prev, [msg.id]: { name: msg.name, size: msg.size, path: savePath, received: msg.offset || 0 } }));
      return;
    }

    if (msg.type === "file-chunk") {
      if (rejectedRef.current.has(msg.id)) return;
      const path = receivePathsRef.current[msg.id];
      if (!path) return;

      try {
        await window.electronAPI.appendReceiveChunk(path, msg.data);
      } catch (err) {
        // Disk/IPC write failed. Abandon THIS file (it would be corrupt anyway)
        // but keep the session alive so later files still transfer. Marking it
        // rejected makes file-end skip finalizing it as a good received file.
        console.error("appendReceiveChunk failed; abandoning file:", msg.id, err);
        rejectedRef.current.add(msg.id);
        delete receivePathsRef.current[msg.id];
        delete receiveProgressRef.current[msg.id];
        try { await window.electronAPI.finishReceiveFile(path); } catch { /* ignore */ }
        const vid = verifierMap.current[msg.id];
        if (vid) {
          try { await window.electronAPI.finishVerifyHash(vid); } catch { /* ignore */ }
          delete verifierMap.current[msg.id];
        }
        setReceiveMap(prev => { const n = { ...prev }; delete n[msg.id]; return n; });
        return;
      }

      const verifierId = verifierMap.current[msg.id];
      if (verifierId) {
        try {
          await window.electronAPI.updateVerifyHash(verifierId, msg.data);
        } catch { /* non-fatal */ }
      }

      // Measure the chunk without decoding it, and only re-render when the
      // displayed percentage changes — not on every single chunk.
      const chunkLen = base64ByteLength(msg.data);
      const prog = receiveProgressRef.current[msg.id];
      if (prog) {
        prog.received += chunkLen;
        const pct = prog.size > 0 ? Math.floor((prog.received / prog.size) * 100) : 0;
        if (pct !== prog.lastPct) {
          prog.lastPct = pct;
          const received = prog.received;
          setReceiveMap(prev => {
            const entry = prev[msg.id];
            if (!entry) return prev;
            return { ...prev, [msg.id]: { ...entry, received } };
          });
        }
      } else {
        // Fallback (no progress entry): keep the old accurate-but-eager behaviour.
        setReceiveMap(prev => {
          const entry = prev[msg.id];
          if (!entry) return prev;
          return { ...prev, [msg.id]: { ...entry, received: entry.received + chunkLen } };
        });
      }
      return;
    }

    if (msg.type === "file-end") {
      if (rejectedRef.current.has(msg.id)) {
        rejectedRef.current.delete(msg.id);
        const vid = verifierMap.current[msg.id];
        if (vid) {
          try { await window.electronAPI.finishVerifyHash(vid); } catch {}
          delete verifierMap.current[msg.id];
        }
        return;
      }
      const entry = receiveMapRef.current[msg.id];
      const savedPath = receivePathsRef.current[msg.id] || entry?.path || "";
      delete receivePathsRef.current[msg.id];
      delete receiveProgressRef.current[msg.id];

      // Flush & close the write stream so all bytes are on disk before we treat
      // the file as complete (and before any integrity check reads it).
      if (savedPath) {
        try { await window.electronAPI.finishReceiveFile(savedPath); } catch { /* ignore */ }
      }

      let fileHash: string | null = null;
      const vid = verifierMap.current[msg.id];
      if (vid) {
        try {
          fileHash = await window.electronAPI.finishVerifyHash(vid);
        } catch { }
        delete verifierMap.current[msg.id];
      }

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

      // Only verify if integrity is enabled and we have a proof
      if (integrityEnabledRef.current) {
        const proof = (msg.hash && msg.signature)
          ? { hash: msg.hash, signature: msg.signature, publicKey: msg.publicKey || "" }
          : null;

        if (proof && fileHash) {
          const pinnedKey = peerPubKeyRef.current || proof.publicKey;
          if (peerPubKeyRef.current && proof.publicKey && proof.publicKey !== peerPubKeyRef.current) {
            setVerifyMap(prev => ({ ...prev, [msg.id]: "tampered" }));
          } else {
            try {
              const res = await window.electronAPI.verifyHash(fileHash, proof.signature, pinnedKey);
              setVerifyMap(prev => ({ ...prev, [msg.id]: res.valid ? "verified" : "tampered" }));
            } catch {
              setVerifyMap(prev => ({ ...prev, [msg.id]: "tampered" }));
            }
          }
        }
      }
      return;
    }
  }, [t, sendAll]);

  const processMessageQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    try {
      while (messageQueueRef.current.length > 0) {
        const next = messageQueueRef.current.shift()!;
        // A single bad message must never kill the whole pump. If it threw and
        // we let it bubble, the `finally` below would still run, but every
        // remaining queued message would be dropped — so isolate each one.
        try {
          await handleDCMessage(next);
        } catch (err) {
          console.error("handleDCMessage failed for a message:", err);
        }
      }
    } finally {
      // CRITICAL: always release the lock, even on error. If this stayed `true`
      // the receiver would silently ignore every future message (the classic
      // "sender shows sent, receiver gets nothing" freeze).
      processingRef.current = false;
    }
  }, [handleDCMessage]);

  // ─── startSendMode ──────────────────────────────────────────────────────────
  const startSendMode = async () => {
    cleanupWebRTC();
    try {
      const ip = await window.electronAPI.getLocalIP();
      if (!ip) {
        setSessionStatus(t("noNetworkDetected"));
        return;
      }
      setMyIP(ip);

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localPC.current = pc;
      intentionalCloseRef.current = false;
      setupConnectionMonitor(pc);

      const dc = pc.createDataChannel("mayo-share", { ordered: true });
      localDC.current = dc;
      setupDataChannelMonitor(dc);

      dc.onopen = () => {
        showFileArea();
        const queue = fileQueueRef.current;
        dc.send(JSON.stringify({
          type: "handshake-offer",
          files: queue,
          senderPublicKey: integrityEnabledRef.current ? myPubKeyRef.current : "",
        }));
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise(r => setTimeout(r, 1500));

      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      try {
        const code = await window.electronAPI.generateCode(compact);
        setMyCode(code);
        setWaitingForJoiner(true);
      } catch (err: any) {
        console.error("generateCode error:", err);
        setSessionStatus("Server busy. Re-trying in 2s...");
        setTimeout(() => {
          if (!myCode && !waitingForJoiner) {
            startSendMode();
          }
        }, 2000);
      }
    } catch (err: any) {
      setSessionStatus("Connection Error: " + err.message);
    }
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

  // ─── connectWithCode ────────────────────────────────────────────────────────
  const connectWithCode = async () => {
    const code = joinCode.join("");
    if (code.length !== 4) return;

    cleanupWebRTC();
    setJoining(true);
    setSessionStatus("");

    try {
      const compactOffer = await window.electronAPI.joinByCode(joinIP.trim(), code);
      const offerSDP = await window.electronAPI.decompressSDP(compactOffer);

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localPC.current = pc;
      intentionalCloseRef.current = false;
      setupConnectionMonitor(pc);

      pc.ondatachannel = event => {
        localDC.current = event.channel;
        setupDataChannelMonitor(localDC.current);
        localDC.current.onopen = () => {
          showFileArea();
        };
        localDC.current.onmessage = e => { messageQueueRef.current.push(e.data); processMessageQueue(); };
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSDP }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForICE(pc);

      const compactAnswer = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      await window.electronAPI.submitAnswer(joinIP.trim(), code, compactAnswer);

      setJoining(false);
    } catch (err: any) {
      setJoining(false);
      if (err.message && err.message.toLowerCase().includes("wrong_code")) {
        setSessionStatus("❌ Invalid Code. Please check and try again.");
      } else if (err.message && err.message.toLowerCase().includes("timeout")) {
        setSessionStatus("❌ Connection timed out. Is the sender ready?");
      } else {
        setSessionStatus("❌ Failed to connect. Is the sender ready?");
      }
      if (localPC.current) {
        localPC.current.close();
        localPC.current = null;
      }
    }
  };

  // ─── Digit input handlers ──────────────────────────────────────────────────
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

  // ─── Render helpers ─────────────────────────────────────────────────────────
  const renderVerifyBadge = (id: string) => {
    if (!integrityEnabledRef.current) return null;
    const v = verifyMap[id];
    if (!v) return null;
    if (v === "verified") {
      return (
        <span title="Integrity verified by Solana"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#4CAF50", fontSize: "0.72rem" }}>
          <FaShieldAlt /> Verified
        </span>
      );
    }
    if (v === "tampered") {
      return (
        <span title="Signature did not match — file may be altered"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#ef5350", fontSize: "0.72rem" }}>
          <FaExclamationTriangle /> Unverified
        </span>
      );
    }
    return <span style={{ color: "var(--text-secondary)", fontSize: "0.72rem" }}>checking…</span>;
  };

  const renderQueueRow = (f: QueueFile) => (
    <div
      key={f.id}
      ref={el => { rowRefs.current[f.id] = el; }}
      className={styles.queueItem}
    >
      <div className={styles.queueName}>{f.name}</div>
      <div className={styles.queueSize}>{formatBytes(f.size)}</div>
      {f.status === "transferring" && <progress value={f.progress} max="100" className={styles.progress} />}
      {(f.status !== "queued" || isSending) && (
        <div className={styles.queueStatus}>
          {f.status === "done"
            ? <FaCheck color="#4CAF50" />
            : f.status === "transferring"
              ? `${f.progress}%`
              : f.status === "queued"
                ? "queued"
                : f.status}
        </div>
      )}
      {(f.status === "queued" || f.status === "transferring") && (
        <button className={styles.removeBtn} onClick={() => cancelFile(f.id)} title="Cancel">
          <FaTimes />
        </button>
      )}
    </div>
  );

  // ─── Resume controls ────────────────────────────────────────────────────────
  const beginSend = (offsets: Record<string, number>) => {
    setResumeOffer(null);
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "resume-dismiss" }));
    }
    sendAll(offsets);
  };

  const handleResume = () => {
    if (mode === "send") {
      beginSend(resumeOffer?.offsets || {});
    } else {
      setResumeOffer(null);
      localDC.current?.send(JSON.stringify({ type: "request-send", fresh: false }));
    }
  };

  const handleCancelResume = () => {
    clearSessionFromDisk();
    setResumeOffer(null);
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "resume-dismiss" }));
    }
  };

  // ─── Connection-lost screen ────────────────────────────────────────────────
  if (connectionState === "disconnected") {
    return (
      <div className={styles.container}>
        <BackButton onClick={() => { cleanupWebRTC(); onBack(); }} />
        <h2 className={styles.title}>{t("deviceConnect")}</h2>
        <div
          style={{
            border: "2px solid #c62828",
            background: "var(--bg-card)",
            borderRadius: 14,
            padding: 24,
            maxWidth: 460,
            width: "100%",
            margin: "20px auto",
            textAlign: "center",
          }}
        >
          <FaWifi size={34} color="#c62828" style={{ marginBottom: 12 }} />
          <h3 style={{ color: "#ef5350", marginBottom: 10 }}>Connection lost</h3>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "0.95rem",
              lineHeight: 1.6,
              marginBottom: 20,
            }}
          >
            The other device went offline and the transfer was paused. Go back
            and reconnect the normal way – once you're connected again we'll
            detect the unfinished transfer and offer to resume it from where it
            stopped.
          </p>
          <button
            className={styles.btn}
            onClick={() => { cleanupWebRTC(); onBack(); }}
          >
            Go Back &amp; Reconnect
          </button>
        </div>
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────────
  return (
    <div
      className={styles.container}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            background: "rgba(255, 255, 255, 0.04)",
            backdropFilter: "blur(10px) saturate(120%)",
            WebkitBackdropFilter: "blur(10px) saturate(120%)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              padding: "32px 44px",
              borderRadius: 24,
              background: "rgba(124, 62, 255, 0.10)",
              border: "1px solid rgba(124, 62, 255, 0.25)",
              boxShadow: "0 8px 40px rgba(0, 0, 0, 0.18)",
            }}
          >
            <FaCloudUploadAlt size={60} color="var(--accent)" />
            <span style={{ color: "var(--text-primary)", fontSize: "1.15rem", fontWeight: 600 }}>
              Drop files or folders to add
            </span>
          </div>
        </div>
      )}

      <BackButton onClick={() => { cleanupWebRTC(); onBack(); }} />
      <h2 className={styles.title}>{t("deviceConnect")}</h2>

      {!connected && mode === "send" && (
        <div className={styles.createPanel}>
          <p className={styles.label}>{t("yourCode")}</p>
          <div className={styles.codeDisplay}>
            {myCode ? myCode.split("").map((d, i) => <span key={i} className={styles.codeDigit}>{d}</span>) : <div className={styles.spinner} />}
          </div>

          <button
            onClick={() => setShowIPDetails(!showIPDetails)}
            className={styles.ghostBtn}
            style={{ marginTop: 20, border: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            Advanced Info
            <span className={`${styles.arrow} ${showIPDetails ? styles.arrowOpen : ''}`}>
              <FaChevronDown size={14} />
            </span>
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
          {resumeOffer && (
            <div style={{
              border: '2px solid var(--accent)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
              background: 'var(--bg-card)',
              width: '100%'
            }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)' }}>
                <FaWifi /> Interrupted Transfer
              </h3>
              <p style={{ fontSize: '0.9rem', margin: '10px 0' }}>
                We found a partially received file. Do you want to resume from where you left off?
              </p>
              <div className={styles.actionRow}>
                <button className={styles.btn} onClick={handleResume}>
                  <FaPlay style={{ marginRight: 6 }} /> Resume
                </button>
                <button className={styles.ghostBtn} onClick={handleCancelResume}>
                  <FaTimes style={{ marginRight: 6 }} /> Cancel
                </button>
              </div>
            </div>
          )}

          <div className={styles.connectedBadge}><FaCircle size={10} color="#4CAF50" /> {t("connected")}</div>

          {safetyCode && integrityEnabled && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 10,
                border: "1px solid var(--accent)", borderRadius: 10,
                padding: "10px 14px", margin: "10px 0", width: "100%",
                background: "var(--bg-card)",
              }}
            >
              <FaLock color="var(--accent)" />
              <div>
                <strong style={{ letterSpacing: 1 }}>
                  Security code: {safetyCode.slice(0, 4)} {safetyCode.slice(4)}
                </strong>
                <div style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>
                  Make sure this matches on both devices — it proves your Solana keys weren't swapped.
                </div>
              </div>
            </div>
          )}

          <p className={styles.subtitle}>Add files, then start sharing.</p>

          {fileQueue.some(f => f.status === "queued") && !isSending && !resumeOffer && (
            <button className={styles.sendBtn} onClick={() => sendAll({})} style={{ width: '100%' }}>
              <FaUpload /> {t("send")} ({formatBytes(fileQueue.filter(f => f.status === "queued").reduce((sum, f) => sum + f.size, 0))})
            </button>
          )}

          <div className={styles.actionRow}>
            <button className={styles.btn} onClick={addFiles}><FaPlus /> Add Files</button>
            <button className={styles.ghostBtn} onClick={addFolder}><FaFolderOpen /> Add Folder</button>
          </div>

          {fileQueue.length === 0 && Object.keys(receiveMap).length === 0 && receivedFiles.length === 0 && (
            <div className={styles.emptyState}>
              <FaFolderOpen size={40} color="#333" />
              <p>No files added yet.</p>
              <p style={{ fontSize: '0.8rem' }}>Click buttons above or press Ctrl+V to paste.</p>
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
                          <div
                            key={group.folderName}
                            ref={el => { folderRefs.current[group.folderName] = el; }}
                            className={styles.folderGroup}
                          >
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
              {Object.entries(receiveMap).map(([id, f]) => {
                const folderName = f.name.includes("/") ? f.name.split("/")[0] : "";
                return (
                  <div
                    key={id}
                    ref={el => { rowRefs.current[id] = el; }}
                    className={styles.queueItem}
                  >
                    <span className={styles.queueName}>{f.name}</span>
                    {f.cancelled ? (
                      <span className={styles.queueStatus}>cancelled</span>
                    ) : (
                      <>
                        <progress value={f.received} max={f.size} className={styles.progress} />
                        <span>{Math.round((f.received / f.size) * 100)}%</span>
                        {folderName && (
                          <button
                            className={styles.removeFolderBtn}
                            onClick={() => cancelIncomingFolder(folderName)}
                            title="Cancel folder"
                          >
                            <FaFolderOpen />
                          </button>
                        )}
                        <button
                          className={styles.removeBtn}
                          onClick={() => cancelIncomingFile(id)}
                          title="Cancel"
                        >
                          <FaTimes />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
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
                        <div className={styles.queueStatus} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <FaCheck color="#4CAF50" /> {renderVerifyBadge(f.id)}
                        </div>
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
                          <div className={styles.queueStatus} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <FaCheck color="#4CAF50" /> {renderVerifyBadge(f.id)}
                          </div>
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

      {sessionStatus && <div className={styles.status} style={{ marginTop: 20, color: 'var(--accent)' }}>{sessionStatus}</div>}
    </div>
  );
};

export default P2PSession;