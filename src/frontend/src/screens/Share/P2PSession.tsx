import React, { useState, useRef, useEffect, useCallback } from "react";
import { FaArrowLeft, FaCircle, FaTimes, FaFolderOpen } from "react-icons/fa";
import QRCode from "qrcode";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
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
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>(
    {},
  );

  // Auto‑retry states
  const [waitingMessage, setWaitingMessage] = useState(
    "Looking for nearby devices…",
  );
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);

  const createLayoutRef = useRef<HTMLDivElement>(null);
  const joinLayoutRef = useRef<HTMLDivElement>(null);
  const receivePathsRef = useRef<Record<string, string>>({});

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
    }

    if (msg.type === "file-end") {
      const { id } = msg;
      setSessionStatus(`File received: ${receiveMap[id]?.name || ""}`);
      await window.electronAPI.clearResumeState(id);
      delete receivePathsRef.current[id];
      setReceiveMap((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
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
        setWaitingMessage(
          "No network detected. Please connect to a Wi‑Fi network or start your hotspot first.",
        );
        return;
      }

      const pc = new RTCPeerConnection({ iceServers: [] });
      localPC.current = pc;

      const dc = pc.createDataChannel("mayo-share", { ordered: true });
      localDC.current = dc;
      dc.onopen = () => {
        setSessionStatus("Connected! Data channel open.");
        showFileArea();
      };
      dc.onmessage = (e) => handleDCMessage(e.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForICE(pc);

      const compact = await window.electronAPI.compressSDP(
        pc.localDescription!.sdp,
      );
      const port = await window.electronAPI.startAdvertising(compact);
      setSignalingPort(port);
      setAdvertising(true);

      setWaitingMessage("Looking for nearby devices…");

      retryTimerRef.current = setTimeout(() => {
        setWaitingMessage("Retrying…");
        setTimeout(() => {
          if (!connected) startAdvertisingSession();
        }, 1500);
      }, 10000);
    } catch (err: any) {
      setSessionStatus("Error: " + err.message);
    }
  };

  const createSession = () => {
    setMode("create");
    setWaitingMessage("Looking for nearby devices…");
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
          setSessionStatus("Connected! Data channel open.");
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

      const compact = await window.electronAPI.compressSDP(
        pc.localDescription!.sdp,
      );
      setAnswerCode(compact);

      const qrData = await QRCode.toDataURL(compact, {
        width: 200,
        margin: 2,
        color: { dark: "#b169e0", light: "#0A0A0A" },
      });
      setAnswerQrDataUrl(qrData);
    } catch (err: any) {
      setSessionStatus("Error: " + err.message);
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

  useEffect(() => {
    window.electronAPI.onDeviceFound(
      (device: { name: string; host: string; port: number }) => {
        setDiscoveredDevices((prev) => [...prev, device]);
      },
    );

    window.electronAPI.onAnswerReceived(async (answerSDP: string) => {
      if (localPC.current) {
        try {
          await localPC.current.setRemoteDescription(
            new RTCSessionDescription({ type: "answer", sdp: answerSDP }),
          );
          setSessionStatus("Connected! Data channel open.");
          showFileArea();
        } catch (err: any) {
          setSessionStatus("Invalid answer: " + err.message);
        }
      }
    });

    return () => {};
  }, []);

  const sendAll = async () => {
    if (!localDC.current || localDC.current.readyState !== "open") {
      setSessionStatus("Data channel not open.");
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

        const CHUNK = 64 * 1024;
        let offset = startOffset;
        while (offset < file.size) {
          const chunkSize = Math.min(CHUNK, file.size - offset);
          const base64 = await window.electronAPI.readFileChunk(
            file.path,
            offset,
            chunkSize,
          );
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
          await new Promise((r) => setTimeout(r, 1));
        }
        localDC.current.send(JSON.stringify({ type: "file-end", id: file.id }));
        await window.electronAPI.clearResumeState(file.id);
      }

      setFileQueue((prev) =>
        prev.map((f) => (f.id === file.id ? { ...f, status: "done" } : f)),
      );
    }

    setIsSending(false);
    setSessionStatus("All files sent!");
  };

  // GSAP animations
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
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.title}>Device Connect</h2>

      {mode === "choose" && !connected && (
        <div className={styles.modeRow}>
          <button className={styles.btn} onClick={createSession}>
            Create Session
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
            Join Session
          </button>
        </div>
      )}

      {/* ── Create Session – pure discovery mode ── */}
      {mode === "create" && !connected && (
        <div className={styles.createPanel} ref={createLayoutRef}>
          <div className={styles.spinner} />
          <p className={styles.waitingText}>{waitingMessage}</p>
          {waitingMessage.includes("No network") && (
            <p className={styles.hint} style={{ marginTop: 12 }}>
              Please connect to a Wi‑Fi network or start your hotspot and try
              again.
            </p>
          )}
          {waitingMessage.includes("Retrying") && (
            <p
              className={styles.hint}
              style={{ marginTop: 12, color: "#b169e0" }}
            >
              Searching again automatically…
            </p>
          )}
        </div>
      )}

      {/* ── Join Session – purple theme, spinner, GSAP ── */}
      {mode === "join" && !connected && (
        <div className={styles.codePanel} ref={joinLayoutRef}>
          <p className={styles.label}>
            {browsing
              ? "Nearby devices:"
              : "Paste the offer code from the other device:"}
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
                  <p className={styles.hint}>Searching for devices...</p>
                </div>
              )}
              {discoveredDevices.map((dev, idx) => (
                <div
                  key={idx}
                  className={styles.deviceItem}
                  onClick={async () => {
                    setBrowsing(false);
                    try {
                      const response = await fetch(
                        `http://${dev.host}:${dev.port}/sdp`,
                      );
                      const offerSDP = await response.text();
                      setOfferInput(offerSDP);
                      const pc = new RTCPeerConnection({ iceServers: [] });
                      localPC.current = pc;
                      pc.ondatachannel = (event) => {
                        const dc = event.channel;
                        localDC.current = dc;
                        dc.onopen = () => {
                          setSessionStatus("Connected! Data channel open.");
                          showFileArea();
                        };
                        dc.onmessage = (e) => handleDCMessage(e.data);
                      };
                      const offer =
                        await window.electronAPI.decompressSDP(offerSDP);
                      await pc.setRemoteDescription(
                        new RTCSessionDescription({
                          type: "offer",
                          sdp: offer,
                        }),
                      );
                      const answer = await pc.createAnswer();
                      await pc.setLocalDescription(answer);
                      await waitForICE(pc);
                      const compactAnswer =
                        await window.electronAPI.compressSDP(
                          pc.localDescription!.sdp,
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
                      setSessionStatus("Error: " + err.message);
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
                placeholder="Paste offer code here"
                rows={4}
              />
              <button className={styles.btn} onClick={processOffer}>
                Process Offer
              </button>
            </>
          )}
          {answerCode && !browsing && (
            <>
              <p className={styles.label} style={{ marginTop: 24 }}>
                Your answer code — give this back:
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
                Copy Code
              </button>
              {answerQrDataUrl && (
                <img
                  src={answerQrDataUrl}
                  alt="Answer QR"
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
            Connected
          </div>
          <div className={styles.actionRow}>
            <button
              className={styles.btn}
              onClick={addFiles}
              disabled={isSending}
            >
              Add Files
            </button>
            <button
              className={styles.ghostBtn}
              onClick={() => document.execCommand("paste")}
              disabled={isSending}
            >
              Paste (Ctrl+V)
            </button>
            <button
              className={styles.sendBtn}
              onClick={sendAll}
              disabled={fileQueue.length === 0 || isSending}
            >
              {isSending ? "Sending..." : "Send All"}
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
                      ? `${f.progress}%`
                      : `[${f.status}]`}
                  </span>
                  {f.status !== "transferring" && f.status !== "done" && (
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeFile(f.id)}
                      title="Remove file"
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
              <p className={styles.label}>Receiving files...</p>
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
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!connected && mode === "choose" && (
        <div className={styles.emptyState}>
          <FaFolderOpen size={48} color="#555" />
          <p>Create or join a session to start.</p>
        </div>
      )}
    </div>
  );
};

export default P2PSession;
