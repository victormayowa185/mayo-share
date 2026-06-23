import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  FaCircle, FaTimes, FaCheck, FaCopy,
  FaChevronDown, FaChevronUp, FaChevronRight, FaFolderOpen,
  FaPlus, FaUpload, FaWifi, FaPlay, FaTrash,
  FaLock, FaShieldAlt, FaExclamationTriangle
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
  const [safetyCode, setSafetyCode] = useState("");                       // shown on both screens to compare
  const [verifyMap, setVerifyMap] =
    useState<Record<string, "pending" | "verified" | "tampered">>({});    // per received-file result


  // ─── Resume state ────────────────────────────────────────────────────────────
  const [resumeOffer, setResumeOffer] = useState<{
    offsets: Record<string, number>;
  } | null>(null);

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
  const fileQueueRef = useRef<QueueFile[]>([]);   // for handshake
  // --- NEW REFS ---
  const resumeOfferRef = useRef<{ offsets: Record<string, number> } | null>(null);
  const intentionalCloseRef = useRef(false);
  // Guard so only ONE send loop runs at a time — it drains the live queue,
  // so files you add mid-transfer get picked up automatically.
  const sendingRef = useRef(false);

  // ─── Solana integrity refs ────────────────────────────────────────────────
  const myPubKeyRef = useRef<string>("");    // our own Solana public key
  const peerPubKeyRef = useRef<string>("");  // the OTHER device's key, PINNED at handshake
  const incomingProofRef = useRef<
    Record<string, { hash: string; signature: string; publicKey: string }>
  >({}); // signature/hash that arrived with each incoming file, checked on file-end



  // Refs to the rendered rows / folder groups so we can animate them out
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const folderRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Keep a cancelled row visible for 2s, then collapse + fade it out and remove it.
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

  // Same idea, but for a whole folder group on the sender's queue.
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

  // Once we know BOTH keys, compute the shared safety code so the two users
  // can confirm nobody swapped a key (anti man-in-the-middle).
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

  // Keep queue ref in sync for handshake
  useEffect(() => {
    fileQueueRef.current = fileQueue;
  }, [fileQueue]);

  // Keep resume offer in a ref so DC message handlers see the latest value
  useEffect(() => {
    resumeOfferRef.current = resumeOffer;
  }, [resumeOffer]);

  // Restore an interrupted SEND session so its files are ready to resume
  // after the user goes back and reconnects the normal way.
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
      // "closed" only happens when WE close (back button / cleanup) – ignore it.
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

  // ─── Cleanup ──────────────────────────────────────────────────────────────────
  const cleanupWebRTC = useCallback(() => {
    intentionalCloseRef.current = true; // so the monitor doesn't flag a disconnect
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
    // NOTE: we intentionally do NOT clear the saved session here, so the
    // unfinished transfer can be detected and resumed after reconnect.
  }, []);

  // ─── Paste handler (unchanged) ──────────────────────────────────────────────
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

  // ─── File & folder pickers (unchanged) ──────────────────────────────────────
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

  const cancelFile = (id: string) => {
    stopSendRef.current.add(id);
    setFileQueue(prev => prev.map(f =>
      f.id === id && (f.status === "queued" || f.status === "transferring")
        ? { ...f, status: "cancelled" }
        : f
    ));
    // Tell the receiver so its stuck incoming row cancels too
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "cancel-file", id }));
    }
    // Show "cancelled" for 2s, then remove the row from the queue
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
    // Tell the receiver so its stuck incoming row cancels too
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "cancel-folder", folderName }));
    }
    // Show "cancelled" for 2s, then remove the whole folder from the queue
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
    delete receivePathsRef.current[id];
    // Show "cancelled" for 2s, then fade out and remove
    setReceiveMap(prev =>
      prev[id] ? { ...prev, [id]: { ...prev[id], cancelled: true } } : prev
    );
    fadeOutRow(id, () =>
      setReceiveMap(prev => { const n = { ...prev }; delete n[id]; return n; })
    );
    // Tell the sender to stop sending this file
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({
        type: "receiver-cancel-file",
        id,
        name: entry?.name || "",
      }));
    }
  };

  // ─── Receiver side: cancel an entire incoming folder ──────────────────────
  // The receiver only "sees" the file currently arriving, so we send the
  // folder name and let the sender drop every remaining file in that folder.
  const cancelIncomingFolder = (folderName: string) => {
    const ids: string[] = [];
    for (const [id, entry] of Object.entries(receiveMapRef.current)) {
      const folder = entry.name.includes("/") ? entry.name.split("/")[0] : "";
      if (folder === folderName) ids.push(id);
    }
    ids.forEach(id => {
      rejectedRef.current.add(id);
      delete receivePathsRef.current[id];
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

  // ─── UPDATED sendAll with offset support and persistence ────────────────────
  // ─── sendAll: drains the LIVE queue, so files added mid-transfer are sent too ─
  const sendAll = async (startOffsets: Record<string, number> = {}) => {
    const dc = localDC.current;
    if (!dc || dc.readyState !== "open") return;
    // A loop is already running — it will pick up any newly-queued files itself
    if (sendingRef.current) return;

    sendingRef.current = true;
    abortBatchRef.current = false;
    setIsSending(true);
    saveSessionToDisk(fileQueueRef.current);

    // Tracks files we've already started this run (synchronous, so the live
    // `find` below never re-picks the same file while state catches up).
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

        // Sign the file OFFLINE: hash it (SHA-256) + sign the hash with our
        // Ed25519/Solana key. Sent alongside file-start; verified on file-end.
        let proof: { hash: string; signature: string; publicKey: string } | null = null;
        try {
          proof = await window.electronAPI.signFile(file.path!);
        } catch (err) {
          console.error("signFile failed:", err);
        }

        dc.send(JSON.stringify({
          type: "file-start",
          id: file.id,
          name: file.name,
          size: file.size,
          offset,
          hash: proof?.hash,
          signature: proof?.signature,
          publicKey: proof?.publicKey,
        }));



        const CHUNK_SIZE = 16384;
        let currentOffset = offset;

        while (currentOffset < file.size) {
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

          const base64 = await window.electronAPI.readFileChunk(file.path!, currentOffset, CHUNK_SIZE);
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

        // Cancelled / aborted mid-file — don't mark done, just move on
        if (stopSendRef.current.has(file.id) || abortBatchRef.current) continue;

        // NOTE: name + size are now included so the receiver always shows a
        // correct "Received Files" row (fixes blank/invisible received rows).
        dc.send(JSON.stringify({ type: "file-end", id: file.id, name: file.name, size: file.size }));
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


  // ─── UPDATED handleDCMessage with handshake and resume ─────────────────────
  const handleDCMessage = useCallback(async (raw: string) => {
    let msg: any; try { msg = JSON.parse(raw); } catch { return; }

    // ─── Handshake: sender offers file list; receiver replies with byte offsets
    // The RECEIVER is the source of truth: we check how many bytes are ACTUALLY
    // on disk for each offered file and resume from exactly there.
    if (msg.type === "handshake-offer") {
      const saveDir = await window.electronAPI.getSavePath();
      const offsets: Record<string, number> = {};
      for (const f of msg.files) {
        const safeName = f.name.replace(/\//g, "\\");
        const savePath = saveDir + "\\" + safeName;
        let onDisk = 0;
        try {
          onDisk = await window.electronAPI.getFileSize(savePath);
        } catch {
          onDisk = 0; // file not there yet
        }
        if (onDisk > 0 && onDisk < f.size) {
          offsets[f.id] = onDisk;
        }
      }


      // Pin the sender's Solana key for this session, then surface the shared
      // safety code so both users can confirm no key was swapped (anti-MITM).
      if (msg.senderPublicKey) {
        peerPubKeyRef.current = msg.senderPublicKey;
        updateSafetyCode();
      }

      if (localDC.current && localDC.current.readyState === "open") {
        localDC.current.send(JSON.stringify({
          type: "handshake-response",
          offsets,
          receiverPublicKey: myPubKeyRef.current,
        }));
      }

      // Only prompt if there's actually an unfinished transfer to resume
      if (Object.keys(offsets).length > 0) {
        setResumeOffer({ offsets });
      }
      return;

    }

    // ─── Handshake response: receiver tells sender where to start ───────────
    if (msg.type === "handshake-response") {
      if (msg.receiverPublicKey) {
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


    // ─── Receiver pressed a resume button – tell the sender to (re)start sending
    if (msg.type === "request-send") {
      setResumeOffer(null);
      if (msg.fresh) clearSessionFromDisk();
      const offsets = msg.fresh ? {} : (resumeOfferRef.current?.offsets || {});
      sendAll(offsets);
      return;
    }

    // ─── Sender pressed a resume button – dismiss our (receiver) prompt
    if (msg.type === "resume-dismiss") {
      setResumeOffer(null);
      return;
    }

    // ─── File reject (unchanged) ─────────────────────────────────────────────
    // âââ File reject (unchanged) âââââââââââââââââââââââââââââââââââââââââââ
    // âââ File reject (no-space is a real error, so keep that message; a plain
    //     decline shows no text â the row just fades out) âââââââââââââââââââââ
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

    // âââ Sender cancelled a single file (handled on the receiver) ââââââââââââ
    // Ignore any in-flight chunks, mark the incoming row cancelled, then fade.
    if (msg.type === "cancel-file") {
      rejectedRef.current.add(msg.id);
      delete receivePathsRef.current[msg.id];
      setReceiveMap(prev =>
        prev[msg.id] ? { ...prev, [msg.id]: { ...prev[msg.id], cancelled: true } } : prev
      );
      fadeOutRow(msg.id, () =>
        setReceiveMap(prev => { const n = { ...prev }; delete n[msg.id]; return n; })
      );
      return;
    }

    // âââ Sender cancelled a whole folder (handled on the receiver) âââââââââââ
    if (msg.type === "cancel-folder") {
      const ids = Object.keys(receiveMapRef.current).filter(id => {
        const name = receiveMapRef.current[id].name;
        const folder = name.includes("/") ? name.split("/")[0] : "";
        return folder === msg.folderName;
      });
      ids.forEach(id => {
        rejectedRef.current.add(id);
        delete receivePathsRef.current[id];
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


    // âââ Receiver cancelled a single incoming file (handled on sender) âââ
    // ─── Receiver cancelled a single file (handled on sender) ─────────────
    // Only stops THIS file — the rest of the batch keeps sending. No text;
    // the row just shows "cancelled" for 2s then fades out.
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

    // ─── Receiver cancelled a whole folder (handled on sender) ───────────
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



    // ─── File start (with resume support AND clears stale entries) ──────────
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

      // Clear any stale receiveMap entry for this file ID
      setReceiveMap(prev => {
        const n = { ...prev };
        delete n[msg.id];
        return n;
      });

      const saveDir = await window.electronAPI.getSavePath();
      const safeName = msg.name.replace(/\//g, "\\");
      const savePath = saveDir + "\\" + safeName;

      const isResuming = msg.offset && msg.offset > 0;
      await window.electronAPI.createReceiveFile(savePath, isResuming);



      receivePathsRef.current[msg.id] = savePath;
      // Remember the signature/hash that came with this file so we can verify
      // it against the sender's PINNED key once the last byte lands.
      if (msg.signature && msg.hash) {
        incomingProofRef.current[msg.id] = {
          hash: msg.hash,
          signature: msg.signature,
          publicKey: msg.publicKey || "",
        };
        setVerifyMap(prev => ({ ...prev, [msg.id]: "pending" }));
      }
      setReceiveMap(prev => ({
        ...prev,
        [msg.id]: {
          name: msg.name,
          size: msg.size,
          path: savePath,
          received: msg.offset || 0
        }
      }));
      return;



    }

    // ─── File chunk (unchanged) ──────────────────────────────────────────────
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
      return;
    }

    // ─── File end (unchanged) ────────────────────────────────────────────────
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

      // ─── Offline integrity check (Solana / Ed25519) ──────────────────────
      // Re-hash the file we ACTUALLY received and verify the sender's signature
      // against the key we PINNED at handshake. One changed byte (or a swapped
      // key) makes this fail.
      const proof = incomingProofRef.current[msg.id];
      delete incomingProofRef.current[msg.id];
      if (proof && savedPath) {
        const pinnedKey = peerPubKeyRef.current || proof.publicKey;
        // Anti-MITM: the per-file key MUST match the key pinned at handshake.
        if (peerPubKeyRef.current && proof.publicKey && proof.publicKey !== peerPubKeyRef.current) {
          setVerifyMap(prev => ({ ...prev, [msg.id]: "tampered" }));
        } else {
          try {
            const res = await window.electronAPI.verifyFile(savedPath, proof.signature, pinnedKey);
            setVerifyMap(prev => ({ ...prev, [msg.id]: res.valid ? "verified" : "tampered" }));
          } catch {
            setVerifyMap(prev => ({ ...prev, [msg.id]: "tampered" }));
          }
        }
      }
    }
  }, [t, sendAll]);





  const processMessageQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (messageQueueRef.current.length > 0) {
      const next = messageQueueRef.current.shift()!;
      await handleDCMessage(next);
    }
    processingRef.current = false;
  }, [handleDCMessage]);

  // ─── startSendMode (sender) with handshake on open ─────────────────────────
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


      dc.onopen = () => {
        showFileArea();
        // Send handshake: file list + our Solana public key (so the receiver
        // can pin it and build the shared safety code).
        const queue = fileQueueRef.current;
        dc.send(JSON.stringify({
          type: "handshake-offer",
          files: queue,
          senderPublicKey: myPubKeyRef.current,
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

  // ─── connectWithCode (receiver) ─────────────────────────────────────────────
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
        localDC.current.onopen = () => {
          showFileArea();
          // Receiver doesn't send handshake; sender will
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

  // ─── Digit input handlers (unchanged) ──────────────────────────────────────
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

  // ─── Resume / Start-Fresh controls (either side can trigger) ──────────────
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

  // Cancel just dismisses the resume prompt (on BOTH sides) without sending
  // anything. The partial file is left as-is — the user simply doesn't want
  // to continue with it.
  const handleCancelResume = () => {
    clearSessionFromDisk();
    setResumeOffer(null);
    if (localDC.current && localDC.current.readyState === "open") {
      localDC.current.send(JSON.stringify({ type: "resume-dismiss" }));
    }
  };


  // ─── Connection-lost screen: the other device dropped off the network ─────
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

  return (
    <div className={styles.container}>
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
          {/* ─── Resume prompt ────────────────────────────────────────── */}
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

          {safetyCode && (
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



          {/* Send button — only when nothing is transferring. During a transfer,
              files added are queued and auto-sent, so the button isn't needed. */}
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