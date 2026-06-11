import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FaCircle, FaTimes, FaCopy, FaCheck } from "react-icons/fa";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/P2PSession.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
}

interface QueueFile {
  id: string;
  name: string;
  path: string | null;
  size: number;
  status: "queued" | "transferring" | "done" | "cancelled";
  progress: number;
  source: "file" | "text";
  textData?: string;
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

const P2PSession: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();

  // ── Modes: choose → send (shows code) | join (enter code) ──
  const [mode, setMode] = useState<"choose" | "send" | "join">("choose");
  const [connected, setConnected] = useState(false);
  const [sessionStatus, setSessionStatus] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Send mode
  const [myCode, setMyCode] = useState("");         // 4-digit code shown to sender
  const [myIP, setMyIP] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [waitingForJoiner, setWaitingForJoiner] = useState(false);

  // Join mode
  const [joinIP, setJoinIP] = useState("");          // IP the joiner types
  const [joinCode, setJoinCode] = useState(["", "", "", ""]);  // 4 digit boxes
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);

  // File transfer
  const [fileQueue, setFileQueue] = useState<QueueFile[]>([]);
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>({});
  const [sendSpeeds, setSendSpeeds] = useState<Record<string, number>>({});
  const [receiveSpeeds, setReceiveSpeeds] = useState<Record<string, number>>({});

  const lastSendBytesRef = useRef<Record<string, number>>({});
  const lastSendTimeRef = useRef<Record<string, number>>({});
  const lastRecvBytesRef = useRef<Record<string, number>>({});
  const lastRecvTimeRef = useRef<Record<string, number>>({});
  const receivePathsRef = useRef<Record<string, string>>({});

  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);
  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  const chooseRef = useRef<HTMLDivElement>(null);
  const sendPanelRef = useRef<HTMLDivElement>(null);
  const joinPanelRef = useRef<HTMLDivElement>(null);

  const showFileArea = useCallback(() => setConnected(true), []);

  // ── GSAP animations ──────────────────────────────────
  useGSAP(() => {
    if (mode === "choose" && chooseRef.current)
      gsap.fromTo(chooseRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
  }, { dependencies: [mode] });

  useGSAP(() => {
    if (mode === "send" && sendPanelRef.current)
      gsap.fromTo(sendPanelRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" });
  }, { dependencies: [mode] });

  useGSAP(() => {
    if (mode === "join" && joinPanelRef.current)
      gsap.fromTo(joinPanelRef.current, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" });
  }, { dependencies: [mode] });

  // ── Data channel message handler ─────────────────────
  const handleDCMessage = useCallback(async (raw: string) => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "file-start") {
      const { id, name, size, fromOffset } = msg;
      const savePath = `C:\\mayo-received\\${name}`;
      receivePathsRef.current[id] = savePath;
      if (fromOffset > 0) {
        setReceiveMap(prev => ({ ...prev, [id]: { name, size, path: savePath, received: fromOffset } }));
      } else {
        await window.electronAPI.createReceiveFile(savePath);
        setReceiveMap(prev => ({ ...prev, [id]: { name, size, path: savePath, received: 0 } }));
      }
      await window.electronAPI.saveResumeState(id, fromOffset || 0, savePath);
    }

    if (msg.type === "file-chunk") {
      const { id, data, offset } = msg;
      const path = receivePathsRef.current[id];
      if (!path) return;
      await window.electronAPI.appendReceiveChunk(path, data);
      const decodedLen = atob(data).length;
      const newReceived = offset + decodedLen;
      setReceiveMap(prev => {
        const entry = prev[id];
        if (!entry) return prev;
        return { ...prev, [id]: { ...entry, received: newReceived } };
      });
      await window.electronAPI.saveResumeState(id, newReceived, path);
      const now = Date.now();
      const elapsed = (now - (lastRecvTimeRef.current[id] || now)) / 1000;
      const deltaBytes = newReceived - (lastRecvBytesRef.current[id] || 0);
      if (elapsed >= 0.5) {
        setReceiveSpeeds(prev => ({ ...prev, [id]: (deltaBytes / elapsed) / (1024 * 1024) }));
        lastRecvBytesRef.current[id] = newReceived;
        lastRecvTimeRef.current[id] = now;
      }
    }

    if (msg.type === "file-end") {
      const { id } = msg;
      setSessionStatus(t("fileReceived", { name: receiveMap[id]?.name || "" }));
      await window.electronAPI.clearResumeState(id);
      delete receivePathsRef.current[id];
      setReceiveMap(prev => { const n = { ...prev }; delete n[id]; return n; });
      setReceiveSpeeds(prev => { const n = { ...prev }; delete n[id]; return n; });
      delete lastRecvBytesRef.current[id];
      delete lastRecvTimeRef.current[id];
    }
  }, [receiveMap, t]);

  const waitForICE = (pc: RTCPeerConnection) =>
    Promise.race([
      new Promise<void>(resolve => {
        if (pc.iceGatheringState === "complete") resolve();
        else pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") resolve();
        });
      }),
      new Promise<void>(resolve => setTimeout(resolve, 10000)),
    ]);

  // ── SEND MODE: generate code ─────────────────────────
  const startSendMode = async () => {
    try {
      const localIP = await window.electronAPI.getLocalIP();
      if (!localIP) {
        setSessionStatus(t("noNetworkDetected"));
        return;
      }
      setMyIP(localIP);
      setMode("send");

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localPC.current = pc;

      const dc = pc.createDataChannel("mayo-share", { ordered: true });
      localDC.current = dc;
      dc.onopen = () => { setSessionStatus(t("dataChannelOpen")); showFileArea(); };
      dc.onmessage = e => handleDCMessage(e.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForICE(pc);

      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      const code = await window.electronAPI.generateCode(compact);
      setMyCode(code);
      setWaitingForJoiner(true);
    } catch (err: any) {
      setSessionStatus(t("errorOccurred", { message: err.message }));
    }
  };

  // Listen for answer from joiner (backend sends "answer-received" event)
  useEffect(() => {
    const cleanup = window.electronAPI.onAnswerReceived(async (answerSDP: string) => {
      if (!localPC.current) return;
      try {
        const sdp = await window.electronAPI.decompressSDP(answerSDP);
        await localPC.current.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp })
        );
        setWaitingForJoiner(false);
      } catch (err: any) {
        setSessionStatus(t("invalidAnswer", { message: err.message }));
      }
    });
    return cleanup;
  }, [t]);

  // ── JOIN MODE: enter IP + code, fetch SDP, post answer ─
  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newCode = [...joinCode];
    newCode[index] = digit;
    setJoinCode(newCode);
    if (digit && index < 3) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !joinCode[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length === 4) {
      setJoinCode(pasted.split(""));
      digitRefs.current[3]?.focus();
    }
  };

  const connectWithCode = async () => {
    const code = joinCode.join("");
    if (code.length !== 4) { setJoinError(t("enterFullCode")); return; }
    if (!joinIP.trim()) { setJoinError(t("enterSenderIP")); return; }

    setJoining(true);
    setJoinError("");

    try {
      // Fetch sender's SDP using their IP + code
      const compactOffer = await window.electronAPI.joinByCode(joinIP.trim(), code);
      const offerSDP = await window.electronAPI.decompressSDP(compactOffer);

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      localPC.current = pc;

      pc.ondatachannel = event => {
        const dc = event.channel;
        localDC.current = dc;
        dc.onopen = () => { setSessionStatus(t("dataChannelOpen")); showFileArea(); };
        dc.onmessage = e => handleDCMessage(e.data);
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: offerSDP }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForICE(pc);

      const compactAnswer = await window.electronAPI.compressSDP(pc.localDescription!.sdp);

      // Post answer back to sender
      await window.electronAPI.submitAnswer(joinIP.trim(), code, compactAnswer);
      setJoining(false);
      setSessionStatus(t("answerSent"));
    } catch (err: any) {
      setJoining(false);
      if (err.message === "wrong_code") {
        setJoinError(t("wrongCode"));
      } else if (err.message === "timeout") {
        setJoinError(t("connectionTimeout"));
      } else {
        setJoinError(t("errorOccurred", { message: err.message }));
      }
    }
  };

  // ── File management ───────────────────────────────────
  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: QueueFile[] = await Promise.all(
      paths.map(async p => ({
        id: Date.now().toString() + Math.random(),
        name: p.split("\\").pop() || p,
        path: p,
        size: await window.electronAPI.getFileSize(p),
        status: "queued" as const,
        progress: 0,
        source: "file" as const,
      }))
    );
    setFileQueue(prev => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) => setFileQueue(prev => prev.filter(f => f.id !== id));

  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (isSending) return;
    e.preventDefault();
    const clipboard = e.clipboardData;
    if (!clipboard) return;

    if (clipboard.files && clipboard.files.length > 0) {
      const newFiles: QueueFile[] = [];
      for (let i = 0; i < clipboard.files.length; i++) {
        const f = clipboard.files[i];
        const filePath = (f as any).path;
        if (filePath) {
          newFiles.push({ id: Date.now().toString() + Math.random(), name: f.name, path: filePath, size: f.size, status: "queued", progress: 0, source: "file" });
        }
      }
      if (newFiles.length > 0) { setFileQueue(prev => [...prev, ...newFiles]); return; }
    }

    const imageItem = Array.from(clipboard.items).find(item => item.type.startsWith("image/"));
    if (imageItem) {
      const blob = imageItem.getAsFile();
      if (blob) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(",")[1];
          const fileName = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
          const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
          setFileQueue(prev => [...prev, { id: Date.now().toString() + Math.random(), name: fileName, path: savedPath, size: blob.size, status: "queued", progress: 0, source: "file" }]);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }

    const text = clipboard.getData("text/plain");
    if (text && text.trim()) {
      const fileName = `pasted-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
      const base64 = btoa(unescape(encodeURIComponent(text)));
      const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
      setFileQueue(prev => [...prev, { id: Date.now().toString() + Math.random(), name: fileName, path: savedPath, size: new Blob([text]).size, status: "queued", progress: 0, source: "file", textData: base64 }]);
    }
  }, [isSending]);

  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  const sendAll = async () => {
    if (!localDC.current || localDC.current.readyState !== "open") {
      setSessionStatus(t("dataChannelNotOpen")); return;
    }
    setIsSending(true);

    for (const file of fileQueue) {
      if (file.status === "done" || file.status === "cancelled") continue;
      setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: "transferring" } : f));

      if (file.textData) {
        localDC.current.send(JSON.stringify({ type: "file-start", id: file.id, name: file.name, size: file.size, resumable: false }));
        localDC.current.send(JSON.stringify({ type: "file-chunk", id: file.id, data: file.textData, offset: 0, totalSize: file.size }));
        localDC.current.send(JSON.stringify({ type: "file-end", id: file.id }));
      } else if (file.path) {
        const resumeState = await window.electronAPI.getResumeState(file.id);
        const startOffset = resumeState ? resumeState.offset : 0;
        localDC.current.send(JSON.stringify({ type: "file-start", id: file.id, name: file.name, size: file.size, resumable: true, fromOffset: startOffset }));

        const CHUNK = 512 * 1024;
        let offset = startOffset;
        let pendingChunks = 0;
        const MAX_PENDING = 15;
        lastSendBytesRef.current[file.id] = offset;
        lastSendTimeRef.current[file.id] = Date.now();
        setSendSpeeds(prev => ({ ...prev, [file.id]: 0 }));

        while (offset < file.size) {
          while (pendingChunks >= MAX_PENDING) await new Promise(r => setTimeout(r, 50));
          const chunkSize = Math.min(CHUNK, file.size - offset);
          const base64 = await window.electronAPI.readFileChunk(file.path, offset, chunkSize);
          pendingChunks++;
          localDC.current.send(JSON.stringify({ type: "file-chunk", id: file.id, data: base64, offset, totalSize: file.size }));
          offset += chunkSize;
          setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, progress: Math.round((offset / file.size) * 100) } : f));
          const now = Date.now();
          const elapsed = (now - lastSendTimeRef.current[file.id]) / 1000;
          const delta = offset - (lastSendBytesRef.current[file.id] || 0);
          if (elapsed >= 0.5) {
            setSendSpeeds(prev => ({ ...prev, [file.id]: (delta / elapsed) / (1024 * 1024) }));
            lastSendBytesRef.current[file.id] = offset;
            lastSendTimeRef.current[file.id] = now;
          }
          await new Promise(r => setTimeout(r, 1));
        }

        while (pendingChunks > 0) await new Promise(r => setTimeout(r, 100));
        localDC.current.send(JSON.stringify({ type: "file-end", id: file.id }));
        await window.electronAPI.clearResumeState(file.id);
        setSendSpeeds(prev => { const n = { ...prev }; delete n[file.id]; return n; });
        delete lastSendBytesRef.current[file.id];
        delete lastSendTimeRef.current[file.id];
      }

      setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: "done" } : f));
    }

    setIsSending(false);
    setSessionStatus(t("allFilesSent"));
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => { window.electronAPI.stopSignaling?.(); };
  }, []);

  // ── RENDER ────────────────────────────────────────────
  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("deviceConnect")}</h2>

      {/* ── Mode chooser ── */}
      {mode === "choose" && !connected && (
        <div ref={chooseRef}>
          <div className={styles.modeRow}>
            <button className={styles.btn} onClick={startSendMode}>
              {t("createSession")}
            </button>
            <button className={styles.ghostBtn} onClick={() => setMode("join")}>
              {t("joinSession")}
            </button>
          </div>
          <p className={styles.hint} style={{ textAlign: "center", marginTop: 8 }}>
            {t("p2pHint")}
          </p>
        </div>
      )}

      {/* ── SEND MODE: show code ── */}
      {mode === "send" && !connected && (
        <div className={styles.createPanel} ref={sendPanelRef}>
          <p className={styles.label}>{t("shareYourIP")}</p>
          <div className={styles.ipDisplay}>
            <span className={styles.ipText}>{myIP}</span>
            <button
              className={styles.copyBtn}
              onClick={() => { navigator.clipboard.writeText(myIP); }}
            >
              <FaCopy size={13} />
            </button>
          </div>

          <p className={styles.label} style={{ marginTop: 24 }}>{t("yourCode")}</p>
          <div className={styles.codeDisplay}>
            {myCode ? (
              myCode.split("").map((d, i) => (
                <span key={i} className={styles.codeDigit}>{d}</span>
              ))
            ) : (
              <div className={styles.spinner} />
            )}
          </div>

          {myCode && (
            <button
              className={styles.copyBtn}
              style={{ marginTop: 8 }}
              onClick={() => {
                navigator.clipboard.writeText(myCode);
                setCodeCopied(true);
                setTimeout(() => setCodeCopied(false), 2000);
              }}
            >
              {codeCopied ? <><FaCheck size={13} style={{ marginRight: 4 }} />{t("copied")}</> : <><FaCopy size={13} style={{ marginRight: 4 }} />{t("copyCode")}</>}
            </button>
          )}

          <p className={styles.hint} style={{ marginTop: 16, textAlign: "center" }}>
            {waitingForJoiner ? t("waitingForJoiner") : t("generatingCode")}
          </p>
          {waitingForJoiner && <div className={styles.spinner} style={{ marginTop: 8 }} />}
        </div>
      )}

      {/* ── JOIN MODE: enter IP + 4-digit code ── */}
      {mode === "join" && !connected && (
        <div className={styles.codePanel} ref={joinPanelRef}>
          <p className={styles.label}>{t("enterSenderIPLabel")}</p>
          <input
            className={styles.ipInput}
            type="text"
            placeholder="e.g. 172.16.4.100"
            value={joinIP}
            onChange={e => setJoinIP(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") digitRefs.current[0]?.focus(); }}
          />

          <p className={styles.label} style={{ marginTop: 20 }}>{t("enterCode")}</p>
          <div className={styles.digitRow}>
            {joinCode.map((digit, i) => (
              <input
                key={i}
                ref={el => (digitRefs.current[i] = el)}
                className={styles.digitInput}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleDigitChange(i, e.target.value)}
                onKeyDown={e => handleDigitKeyDown(i, e)}
                onPaste={i === 0 ? handleDigitPaste : undefined}
              />
            ))}
          </div>

          {joinError && <p className={styles.errorText}>{joinError}</p>}

          <button
            className={styles.btn}
            style={{ marginTop: 20 }}
            onClick={connectWithCode}
            disabled={joining}
          >
            {joining ? t("connecting") : t("connect")}
          </button>

          {joining && <div className={styles.spinner} style={{ marginTop: 12 }} />}
        </div>
      )}

      {/* ── Status message ── */}
      {sessionStatus && (
        <div className={`${styles.status} ${sessionStatus.toLowerCase().includes("error") ? styles.error : ""}`}>
          {sessionStatus}
        </div>
      )}

      {/* ── Connected: file transfer area ── */}
      {connected && (
        <div className={styles.fileArea}>
          <div className={styles.connectedBadge}>
            <FaCircle size={12} color="#4CAF50" style={{ marginRight: 8 }} />
            {t("connected")}
          </div>
          <div className={styles.actionRow}>
            <button className={styles.btn} onClick={addFiles} disabled={isSending}>{t("addFiles")}</button>
            <button className={styles.ghostBtn} onClick={() => document.execCommand("paste")} disabled={isSending}>{t("paste")}</button>
            <button className={styles.sendBtn} onClick={sendAll} disabled={fileQueue.length === 0 || isSending}>
              {isSending ? t("sending") : t("sendAll")}
            </button>
          </div>

          {fileQueue.length > 0 && (
            <div className={styles.queue}>
              {fileQueue.map(f => (
                <div key={f.id} className={styles.queueItem}>
                  <span className={styles.queueName}>{f.name}</span>
                  <span className={styles.queueSize}>{formatBytes(f.size)}</span>
                  <span className={styles.queueStatus}>
                    {f.status === "transferring"
                      ? `${f.progress}%${sendSpeeds[f.id] ? ` (${sendSpeeds[f.id].toFixed(1)} MB/s)` : ""}`
                      : t(`queueStatus_${f.status}`)}
                  </span>
                  {f.status !== "transferring" && f.status !== "done" && (
                    <button className={styles.removeBtn} onClick={() => removeFile(f.id)} title={t("removeFile")}>
                      <FaTimes size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {Object.keys(receiveMap).length > 0 && (
            <div className={styles.incomingSection}>
              <p className={styles.label}>{t("receivingFiles")}</p>
              {Object.entries(receiveMap).map(([id, entry]) => (
                <div key={id} className={styles.queueItem}>
                  <span className={styles.queueName}>{entry.name}</span>
                  <progress value={entry.received} max={entry.size} className={styles.progress} />
                  <span className={styles.queueStatus}>
                    {Math.round((entry.received / entry.size) * 100)}%
                    {receiveSpeeds[id] ? ` – ${receiveSpeeds[id].toFixed(1)} MB/s` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default P2PSession;