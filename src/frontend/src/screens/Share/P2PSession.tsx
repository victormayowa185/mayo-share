import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { FaCircle, FaTimes, FaFolderOpen } from "react-icons/fa";
import QRCode from "qrcode";
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
  const k = 1024,
    s = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + s[i];
};

const P2PSession: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [sessionStatus, setSessionStatus] = useState("");
  const [connected, setConnected] = useState(false);
  const [answerCode, setAnswerCode] = useState("");
  const [offerInput, setOfferInput] = useState("");
  const [fileQueue, setFileQueue] = useState<QueueFile[]>([]);
  const [answerQrDataUrl, setAnswerQrDataUrl] = useState("");
  const [discoveredDevices, setDiscoveredDevices] = useState<
    Array<{ name: string; host: string; port: number }>
  >([]);
  const [browsing, setBrowsing] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const [signalingPort, setSignalingPort] = useState<number | null>(null);
  const [showAnswerCode, setShowAnswerCode] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>({});

  // Speed tracking for sending
  const [sendSpeeds, setSendSpeeds] = useState<Record<string, number>>({});
  const lastSendBytesRef = useRef<Record<string, number>>({});
  const lastSendTimeRef = useRef<Record<string, number>>({});

  // Speed tracking for receiving
  const [receiveSpeeds, setReceiveSpeeds] = useState<Record<string, number>>({});
  const lastRecvBytesRef = useRef<Record<string, number>>({});
  const lastRecvTimeRef = useRef<Record<string, number>>({});

  // Auto‑retry states
  const [waitingMessage, setWaitingMessage] = useState(t("lookingForDevices"));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);

  const createLayoutRef = useRef<HTMLDivElement>(null);
  const joinLayoutRef = useRef<HTMLDivElement>(null);
  const receivePathsRef = useRef<Record<string, string>>({});

  // Ref for the mode‑chooser section
  const modeChooserRef = useRef<HTMLDivElement>(null);

  const showFileArea = () => setConnected(true);

  // ── Data channel handler ────────────────────────────
  const handleDCMessage = async (raw: string) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "file-start") {
      const { id, name, size, resumable, fromOffset } = msg;
      const savePath = `C:\\mayo-received\\${name}`;
      receivePathsRef.current[id] = savePath;
      if (resumable && fromOffset > 0) {
        setReceiveMap((prev) => ({
          ...prev,
          [id]: { name, size, path: savePath, received: fromOffset },
        }));
      } else {
        await window.electronAPI.createReceiveFile(savePath);
        setReceiveMap((prev) => ({
          ...prev,
          [id]: { name, size, path: savePath, received: 0 },
        }));
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
      setReceiveMap((prev) => {
        const entry = prev[id];
        if (!entry) return prev;
        return { ...prev, [id]: { ...entry, received: newReceived } };
      });
      await window.electronAPI.saveResumeState(id, newReceived, path);

      // Update receive speed
      const now = Date.now();
      const elapsed = (now - (lastRecvTimeRef.current[id] || now)) / 1000;
      const deltaBytes = newReceived - (lastRecvBytesRef.current[id] || 0);
      if (elapsed >= 0.5) {
        const speedMBps = (deltaBytes / elapsed) / (1024 * 1024);
        setReceiveSpeeds((prev) => ({ ...prev, [id]: speedMBps }));
        lastRecvBytesRef.current[id] = newReceived;
        lastRecvTimeRef.current[id] = now;
      }
    }

    if (msg.type === "file-end") {
      const { id } = msg;
      setSessionStatus(t("fileReceived", { name: receiveMap[id]?.name || "" }));
      await window.electronAPI.clearResumeState(id);
      delete receivePathsRef.current[id];
      setReceiveMap((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      // Cleanup speed tracking – use setter for state
      setReceiveSpeeds((prev) => {
        const newSpeeds = { ...prev };
        delete newSpeeds[id];
        return newSpeeds;
      });
      delete lastRecvBytesRef.current[id];
      delete lastRecvTimeRef.current[id];
    }
  };

  const waitForICE = (pc: RTCPeerConnection) =>
    Promise.race([
      new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") resolve();
        else
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") resolve();
          });
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 10000)),
    ]);

  // ── Create Session – start advertising ──────────────
  const startAdvertisingSession = async () => {
    try {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);

      const localIP = await window.electronAPI.getLocalIP();
      if (!localIP) {
        setWaitingMessage(t("noNetworkDetected"));
        return;
      }

      const pc = new RTCPeerConnection({ iceServers: [] });
      localPC.current = pc;

      const dc = pc.createDataChannel("mayo-share", { ordered: true });
      localDC.current = dc;
      dc.onopen = () => {
        setSessionStatus(t("dataChannelOpen"));
        showFileArea();
      };
      dc.onmessage = (e) => handleDCMessage(e.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForICE(pc);

      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      const port = await window.electronAPI.startAdvertising(compact);
      setSignalingPort(port);
      setAdvertising(true);

      setWaitingMessage(t("lookingForDevices"));

      retryTimerRef.current = setTimeout(() => {
        setWaitingMessage(t("retrying"));
        setTimeout(() => {
          if (!connected) startAdvertisingSession();
        }, 1500);
      }, 10000);
    } catch (err: any) {
      setSessionStatus(t("errorOccurred", { message: err.message }));
    }
  };

  const createSession = () => {
    setMode("create");
    setWaitingMessage(t("lookingForDevices"));
    startAdvertisingSession();
  };

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (connected && retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
    }
  }, [connected]);

  // ── Join Session ────────────────────────────────────
  const processOffer = async () => {
    if (!offerInput.trim()) return;
    setMode("join");
    try {
      const sdp = await window.electronAPI.decompressSDP(offerInput.trim());
      const pc = new RTCPeerConnection({ iceServers: [] });
      localPC.current = pc;

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        localDC.current = dc;
        dc.onopen = () => {
          setSessionStatus(t("dataChannelOpen"));
          showFileArea();
        };
        dc.onmessage = (e) => handleDCMessage(e.data);
      };

      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "offer", sdp }),
      );
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForICE(pc);

      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      setAnswerCode(compact);

      const qrData = await QRCode.toDataURL(compact, {
        width: 200,
        margin: 2,
        color: { dark: "#b169e0", light: "#0A0A0A" },
      });
      setAnswerQrDataUrl(qrData);
    } catch (err: any) {
      setSessionStatus(t("errorOccurred", { message: err.message }));
    }
  };

  // ── File management ─────────────────────────────────
  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: QueueFile[] = await Promise.all(
      paths.map(async (p) => ({
        id: Date.now().toString() + Math.random(),
        name: p.split("\\").pop() || p,
        path: p,
        size: await window.electronAPI.getFileSize(p),
        status: "queued" as const,
        progress: 0,
        source: "file" as const,
      })),
    );
    setFileQueue((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) =>
    setFileQueue((prev) => prev.filter((f) => f.id !== id));

  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
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
            newFiles.push({
              id: Date.now().toString() + Math.random(),
              name: f.name,
              path: filePath,
              size: f.size,
              status: "queued",
              progress: 0,
              source: "file",
            });
          }
        }
        if (newFiles.length > 0) {
          setFileQueue((prev) => [...prev, ...newFiles]);
          return;
        }
      }

      const imageItem = Array.from(clipboard.items).find((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItem) {
        const blob = imageItem.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(",")[1];
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const fileName = `screenshot-${timestamp}.png`;
            const savedPath = await window.electronAPI.saveTempFile(
              fileName,
              base64,
            );
            setFileQueue((prev) => [
              ...prev,
              {
                id: Date.now().toString() + Math.random(),
                name: fileName,
                path: savedPath,
                size: blob.size,
                status: "queued",
                progress: 0,
                source: "file",
              },
            ]);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }

      const text = clipboard.getData("text/plain");
      if (text && text.trim()) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `pasted-${timestamp}.txt`;
        const base64 = btoa(unescape(encodeURIComponent(text)));
        const savedPath = await window.electronAPI.saveTempFile(
          fileName,
          base64,
        );
        setFileQueue((prev) => [
          ...prev,
          {
            id: Date.now().toString() + Math.random(),
            name: fileName,
            path: savedPath,
            size: new Blob([text]).size,
            status: "queued",
            progress: 0,
            source: "file",
            textData: base64,
          },
        ]);
      }
    },
    [isSending],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  // ✅ Only one useEffect for listeners (with cleanup)
  useEffect(() => {
    let cleanupDevice: (() => void) | undefined;
    let cleanupAnswer: (() => void) | undefined;

    const deviceHandler = (device: { name: string; host: string; port: number }) => {
      setDiscoveredDevices((prev) => [...prev, device]);
    };
    const answerHandler = async (answerSDP: string) => {
      if (localPC.current) {
        try {
          await localPC.current.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: answerSDP })
          );
          setSessionStatus(t("dataChannelOpen"));
          showFileArea();
        } catch (err: any) {
          setSessionStatus(t("invalidAnswer", { message: err.message }));
        }
      }
    };

    const maybeCleanupDevice = window.electronAPI.onDeviceFound(deviceHandler);
    const maybeCleanupAnswer = window.electronAPI.onAnswerReceived(answerHandler);

    if (typeof maybeCleanupDevice === "function") cleanupDevice = maybeCleanupDevice;
    if (typeof maybeCleanupAnswer === "function") cleanupAnswer = maybeCleanupAnswer;

    return () => {
      if (cleanupDevice) cleanupDevice();
      if (cleanupAnswer) cleanupAnswer();
    };
  }, [t, showFileArea]);

  const sendAll = async () => {
    if (!localDC.current || localDC.current.readyState !== "open") {
      setSessionStatus(t("dataChannelNotOpen"));
      return;
    }
    setIsSending(true);

    for (const file of fileQueue) {
      if (file.status === "done" || file.status === "cancelled") continue;

      setFileQueue((prev) =>
        prev.map((f) =>
          f.id === file.id ? { ...f, status: "transferring" } : f,
        ),
      );

      if (file.textData) {
        localDC.current.send(
          JSON.stringify({
            type: "file-start",
            id: file.id,
            name: file.name,
            size: file.size,
            resumable: false,
          }),
        );
        localDC.current.send(
          JSON.stringify({
            type: "file-chunk",
            id: file.id,
            data: file.textData,
            offset: 0,
            totalSize: file.size,
          }),
        );
        localDC.current.send(JSON.stringify({ type: "file-end", id: file.id }));
      } else if (file.path) {
        const resumeState = await window.electronAPI.getResumeState(file.id);
        const startOffset = resumeState ? resumeState.offset : 0;
        localDC.current.send(
          JSON.stringify({
            type: "file-start",
            id: file.id,
            name: file.name,
            size: file.size,
            resumable: true,
            fromOffset: startOffset,
          }),
        );

        const CHUNK = 512 * 1024; // 512KB chunks
        let offset = startOffset;
        let pendingChunks = 0;
        const MAX_PENDING = 15;

        // Initialize speed tracking for this file
        lastSendBytesRef.current[file.id] = offset;
        lastSendTimeRef.current[file.id] = Date.now();
        setSendSpeeds((prev) => ({ ...prev, [file.id]: 0 }));

        while (offset < file.size) {
          while (pendingChunks >= MAX_PENDING) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          const chunkSize = Math.min(CHUNK, file.size - offset);
          const base64 = await window.electronAPI.readFileChunk(
            file.path,
            offset,
            chunkSize,
          );

          pendingChunks++;
          localDC.current.send(
            JSON.stringify({
              type: "file-chunk",
              id: file.id,
              data: base64,
              offset,
              totalSize: file.size,
            }),
          );

          offset += chunkSize;
          const progress = Math.round((offset / file.size) * 100);
          setFileQueue((prev) =>
            prev.map((f) => (f.id === file.id ? { ...f, progress } : f)),
          );

          // Calculate send speed
          const now = Date.now();
          const elapsed = (now - lastSendTimeRef.current[file.id]) / 1000;
          const totalSent = offset;
          const deltaBytes = totalSent - (lastSendBytesRef.current[file.id] || 0);
          if (elapsed >= 0.5) {
            const speedMBps = (deltaBytes / elapsed) / (1024 * 1024);
            setSendSpeeds((prev) => ({ ...prev, [file.id]: speedMBps }));
            lastSendBytesRef.current[file.id] = totalSent;
            lastSendTimeRef.current[file.id] = now;
          }

          await new Promise((r) => setTimeout(r, 1));
        }

        while (pendingChunks > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        localDC.current.send(JSON.stringify({ type: "file-end", id: file.id }));
        await window.electronAPI.clearResumeState(file.id);
        // Cleanup speed tracking – use setter for state
        setSendSpeeds((prev) => {
          const newSpeeds = { ...prev };
          delete newSpeeds[file.id];
          return newSpeeds;
        });
        delete lastSendBytesRef.current[file.id];
        delete lastSendTimeRef.current[file.id];
      }

      setFileQueue((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, status: "done" } : f)),
      );
    }

    setIsSending(false);
    setSessionStatus(t("allFilesSent"));
  };

  // ── GSAP animations ─────────────────────────────────
  useGSAP(
    () => {
      if (mode === "choose" && modeChooserRef.current) {
        gsap.fromTo(
          modeChooserRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" },
        );
      }
    },
    { dependencies: [mode] },
  );

  useGSAP(
    () => {
      if (mode === "create" && createLayoutRef.current) {
        gsap.fromTo(
          createLayoutRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
        );
      }
    },
    { dependencies: [mode] },
  );

  useGSAP(
    () => {
      if (mode === "join" && joinLayoutRef.current) {
        gsap.fromTo(
          joinLayoutRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
        );
      }
    },
    { dependencies: [mode] },
  );

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("deviceConnect")}</h2>

      {mode === "choose" && !connected && (
        <div ref={modeChooserRef}>
          <div className={styles.modeRow}>
            <button className={styles.btn} onClick={createSession}>
              {t("createSession")}
            </button>
            <button
              className={styles.ghostBtn}
              onClick={() => {
                setMode("join");
                setDiscoveredDevices([]);
                setBrowsing(true);
                window.electronAPI.startBrowsing();
              }}
            >
              {t("joinSession")}
            </button>
          </div>
          <div className={styles.emptyState}>
            <FaFolderOpen size={48} color="#555" />
            <p>{t("createOrJoin")}</p>
          </div>
        </div>
      )}

      {mode === "create" && !connected && (
        <div className={styles.createPanel} ref={createLayoutRef}>
          <div className={styles.spinner} />
          <p className={styles.waitingText}>{waitingMessage}</p>
          {waitingMessage === t("noNetworkDetected") && (
            <p className={styles.hint} style={{ marginTop: 12 }}>
              {t("connectToWifiHint")}
            </p>
          )}
          {waitingMessage === t("retrying") && (
            <p
              className={styles.hint}
              style={{ marginTop: 12, color: "#b169e0" }}
            >
              {t("searchingAgain")}
            </p>
          )}
        </div>
      )}

      {mode === "join" && !connected && (
        <div className={styles.codePanel} ref={joinLayoutRef}>
          <p className={styles.label}>
            {browsing ? t("nearbyDevices") : t("pasteOfferCode")}
          </p>
          {browsing && (
            <div className={styles.deviceList}>
              {discoveredDevices.length === 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div className={styles.spinner} />
                  <p className={styles.hint}>{t("searchingForDevices")}</p>
                </div>
              )}
              {discoveredDevices.map((dev, idx) => (
                <div
                  key={idx}
                  className={styles.deviceItem}
                  onClick={async () => {
                    setBrowsing(false);
                    try {
                      const response = await fetch(`http://${dev.host}:${dev.port}/sdp`);
                      const offerSDP = await response.text();
                      setOfferInput(offerSDP);

                      // Create a new peer connection if none exists
                      if (!localPC.current) {
                        const pc = new RTCPeerConnection({ iceServers: [] });
                        localPC.current = pc;
                        pc.ondatachannel = (event) => {
                          const dc = event.channel;
                          localDC.current = dc;
                          dc.onopen = () => {
                            setSessionStatus(t("dataChannelOpen"));
                            showFileArea();
                          };
                          dc.onmessage = (e) => handleDCMessage(e.data);
                        };
                      }

                      const pc = localPC.current;
                      const offer = await window.electronAPI.decompressSDP(offerSDP);
                      await pc.setRemoteDescription(
                        new RTCSessionDescription({ type: "offer", sdp: offer })
                      );
                      const answer = await pc.createAnswer();
                      await pc.setLocalDescription(answer);
                      await waitForICE(pc);
                      const compactAnswer = await window.electronAPI.compressSDP(
                        pc.localDescription!.sdp
                      );
                      setAnswerCode(compactAnswer);
                      const qrData = await QRCode.toDataURL(compactAnswer, {
                        width: 200,
                        margin: 2,
                      });
                      setAnswerQrDataUrl(qrData);
                      await fetch(`http://${dev.host}:${dev.port}/answer`, {
                        method: "POST",
                        body: compactAnswer,
                      });
                    } catch (err: any) {
                      setSessionStatus(t("errorOccurred", { message: err.message }));
                    }
                  }}
                >
                  <span>{dev.name}</span>
                </div>
              ))}
            </div>
          )}
          {!browsing && (
            <>
              <textarea
                className={styles.codeBox}
                value={offerInput}
                onChange={(e) => setOfferInput(e.target.value)}
                placeholder={t("pasteOfferCodePlaceholder")}
                rows={4}
              />
              <button className={styles.btn} onClick={processOffer}>
                {t("processOffer")}
              </button>
            </>
          )}
          {answerCode && !browsing && (
            <>
              <p className={styles.label} style={{ marginTop: 24 }}>
                {t("yourAnswerCode")}
              </p>
              <textarea
                className={styles.codeBox}
                readOnly
                value={answerCode}
                rows={4}
              />
              <button
                className={styles.copyBtn}
                onClick={() => navigator.clipboard.writeText(answerCode)}
              >
                {t("copyCode")}
              </button>
              {answerQrDataUrl && (
                <img
                  src={answerQrDataUrl}
                  alt={t("answerQR")}
                  className={styles.qr}
                />
              )}
            </>
          )}
        </div>
      )}

      {sessionStatus && (
        <div
          className={`${styles.status} ${sessionStatus.includes("Error") ? styles.error : ""}`}
        >
          {sessionStatus}
        </div>
      )}

      {connected && (
        <div className={styles.fileArea}>
          <div className={styles.connectedBadge}>
            <FaCircle size={12} color="#4CAF50" style={{ marginRight: 8 }} />{" "}
            {t("connected")}
          </div>
          <div className={styles.actionRow}>
            <button
              className={styles.btn}
              onClick={addFiles}
              disabled={isSending}
            >
              {t("addFiles")}
            </button>
            <button
              className={styles.ghostBtn}
              onClick={() => document.execCommand("paste")}
              disabled={isSending}
            >
              {t("paste")}
            </button>
            <button
              className={styles.sendBtn}
              onClick={sendAll}
              disabled={fileQueue.length === 0 || isSending}
            >
              {isSending ? t("sending") : t("sendAll")}
            </button>
          </div>
          {fileQueue.length > 0 && (
            <div className={styles.queue}>
              {fileQueue.map((f) => (
                <div key={f.id} className={styles.queueItem}>
                  <span className={styles.queueName}>{f.name}</span>
                  <span className={styles.queueSize}>
                    {formatBytes(f.size)}
                  </span>
                  <span className={styles.queueStatus}>
                    {f.status === "transferring"
                      ? `${f.progress}% ${sendSpeeds[f.id] ? `(${sendSpeeds[f.id].toFixed(1)} MB/s)` : ""}`
                      : t(`queueStatus_${f.status}`)}
                  </span>
                  {f.status !== "transferring" && f.status !== "done" && (
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeFile(f.id)}
                      title={t("removeFile")}
                    >
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
                  <progress
                    value={entry.received}
                    max={entry.size}
                    className={styles.progress}
                  />
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