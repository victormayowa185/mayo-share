import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { 
  FaCircle, FaTimes, FaCheck, 
  FaChevronDown, FaChevronUp, FaFolderOpen, 
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

const formatBytes = (b: number) => {
  if (b === 0) return "0 B";
  const k = 1024, s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
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
  const [waitingForJoiner, setWaitingForJoiner] = useState(false);

  // Receiver States
  const [joinIP, setJoinIP] = useState("");
  const [joinCode, setJoinCode] = useState(["", "", "", ""]);
  const [joining, setJoining] = useState(false);

  // Queue States
  const [fileQueue, setFileQueue] = useState<QueueFile[]>([]);
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>({});
  
  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);
  const receivePathsRef = useRef<Record<string, string>>({});

  const showFileArea = useCallback(() => setConnected(true), []);

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

  // ── Clipboard Paste ──
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (!connected || isSending) return;
    const clipboard = e.clipboardData;
    if (clipboard && clipboard.files.length > 0) {
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
      setFileQueue(prev => [...prev, ...newFiles]);
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
      delete receivePathsRef.current[msg.id];
      setReceiveMap(prev => { const n = { ...prev }; delete n[msg.id]; return n; });
    }
  }, []);

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
      dc.onmessage = e => handleDCMessage(e.data);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise(r => setTimeout(r, 1500)); // Wait for ICE gathering
      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      const code = await window.electronAPI.generateCode(compact);
      setMyCode(code);
      setWaitingForJoiner(true);
    } catch (err: any) { setSessionStatus("Error: " + err.message); }
  };

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
        localDC.current.onmessage = e => handleDCMessage(e.data);
      };
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSDP }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const compactAnswer = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      await window.electronAPI.submitAnswer(joinIP.trim(), code, compactAnswer);
    } catch (err: any) { setJoining(false); setSessionStatus("Connection Failed"); }
  };

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...joinCode]; newCode[index] = digit; setJoinCode(newCode);
    if (digit && index < 3) digitRefs.current[index + 1]?.focus();
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
          {showIPDetails && <div className={styles.ipDisplay}><code>{myIP}</code></div>}
          <p className={styles.hint}>{waitingForJoiner ? t("waitingForJoiner") : t("generatingCode")}</p>
        </div>
      )}

      {!connected && mode === "join" && (
        <div className={styles.codePanel}>
          <p className={styles.label}>{t("enterSenderIPLabel")}</p>
          <input className={styles.ipInput} value={joinIP} onChange={e => setJoinIP(e.target.value)} placeholder="192.168.x.x" />
          <p className={styles.label} style={{ marginTop: 20 }}>{t("enterCode")}</p>
          <div className={styles.digitRow}>
            {joinCode.map((digit, i) => <input key={i} ref={el => (digitRefs.current[i] = el)} className={styles.digitInput} maxLength={1} value={digit} onChange={e => handleDigitChange(i, e.target.value)} />)}
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

          <div className={styles.queue} style={{ marginTop: 20 }}>
            {fileQueue.length === 0 ? (
              <div className={styles.emptyState}>
                <FaFolderOpen size={40} color="#333" />
                <p>No files added yet.</p>
                <p style={{fontSize: '0.8rem'}}>Click buttons above or press Ctrl+V to paste.</p>
              </div>
            ) : (
              fileQueue.map(f => (
                <div key={f.id} className={styles.queueItem}>
                  <div className={styles.queueName}>{f.name}</div>
                  <div className={styles.queueSize}>{formatBytes(f.size)}</div>
                  {f.status === "transferring" && <progress value={f.progress} max="100" className={styles.progress} />}
                  <div className={styles.queueStatus}>{f.status === "done" ? <FaCheck color="#4CAF50"/> : f.status}</div>
                  {!isSending && f.status !== "done" && <button className={styles.removeBtn} onClick={() => removeFile(f.id)}><FaTimes /></button>}
                </div>
              ))
            )}
          </div>

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

          {fileQueue.length > 0 && !isSending && (
            <button className={styles.sendBtn} onClick={sendAll} style={{ marginTop: 20, width: '100%', background: '#4CAF50', color: 'white', padding: 15, borderRadius: 10, border: 'none', cursor: 'pointer' }}>
              <FaUpload /> Send All ({fileQueue.length} files)
            </button>
          )}
        </div>
      )}

      {sessionStatus && <div className={styles.status} style={{marginTop: 20, color: 'var(--accent)'}}>{sessionStatus}</div>}
    </div>
  );
};

export default P2PSession;