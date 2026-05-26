import React, { useState, useEffect } from "react";
import { FaArrowLeft, FaCheckCircle, FaCopy, FaSpinner } from "react-icons/fa";
import { FaDesktop, FaMobileAlt, FaTabletAlt } from "react-icons/fa";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next"; // ← import the hook
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/ReceiveFromBrowser.module.css";

interface ReceivedFile {
  id: string;
  name: string;
  time: string;
}

interface Props {
  onBack: () => void;
  onSenderApproved?: () => void;
  onStopReceiving?: () => void;
}

const getDeviceIcon = (deviceType: string) => {
  switch (deviceType) {
    case "phone":
      return <FaMobileAlt size={16} color="#b169e0" />;
    case "tablet":
      return <FaTabletAlt size={16} color="#b169e0" />;
    case "desktop":
    default:
      return <FaDesktop size={16} color="#b169e0" />;
  }
};

const ReceiveFromBrowser: React.FC<Props> = ({
  onBack,
  onSenderApproved,
  onStopReceiving,
}) => {
  const { t } = useTranslation(); // ← get the t function
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [isReceiving, setIsReceiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startingHotspot, setStartingHotspot] = useState(false);
  const [hotspotStatus, setHotspotStatus] = useState("");
  const [approvedSenders, setApprovedSenders] = useState<
    { sessionId: string; senderName: string }[]
  >([]);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [pendingSenders, setPendingSenders] = useState<
    { sessionId: string; senderName: string; deviceType: string }[]
  >([]);

  // FIXED: Listen for file-received events and remove sender from uploading list
  useEffect(() => {
    window.electronAPI.onUploadUpdate((data) => {
      if (data.event === "received") {
        const newFile: ReceivedFile = {
          id: Date.now().toString() + Math.random(),
          name: data.fileName,
          time: new Date().toLocaleTimeString(),
        };
        setReceivedFiles((prev) => [...prev, newFile]);

        // FIXED: Remove sender from approvedSenders after file is received
        setApprovedSenders((prev) =>
          prev.filter((s) => s.senderName !== data.senderName),
        );
      }
    });
  }, []);

  useEffect(() => {
    window.electronAPI.onSenderConnected(
      (data: { sessionId: string; senderName: string; deviceType: string }) => {
        setPendingSenders((prev) => {
          const existingIdx = prev.findIndex(
            (s) => s.sessionId === data.sessionId,
          );
          if (existingIdx !== -1) {
            const updated = [...prev];
            updated[existingIdx] = data;
            return updated;
          }
          return [...prev, data];
        });
      },
    );
  }, []);

  const startReceiving = async () => {
    onStopReceiving?.();
    try {
      setStartingHotspot(true);
      setHotspotStatus(t("checkingNetwork"));

      // 1. Try to detect an existing Wi‑Fi network
      const localIP = await window.electronAPI.getLocalIP();
      if (localIP) {
        setHotspotStatus(t("usingExistingNetwork"));
        const url = await window.electronAPI.startUploadServer(localIP);
        setShareUrl(url);
        setIsReceiving(true);
        setStartingHotspot(false);
        setHotspotStatus("");
        const qrData = await QRCode.toDataURL(url, {
          width: 200,
          margin: 2,
          color: { dark: "#b169e0", light: "#0A0A0A" },
        });
        setQrDataUrl(qrData);
        return;
      }

      // 2. No existing network found – fall back to hotspot
      setHotspotStatus(t("startingHotspotFallback"));
      const status = await window.electronAPI.checkHotspotStatus();
      let ip = status.ip;

      if (!status.active) {
        const result = await window.electronAPI.startHotspot();
        if (result.includes("SUCCESS")) {
          const ipMatch = result.match(
            /Hotspot IP \(for sharing\):\s*([\d.]+)/,
          );
          if (ipMatch && ipMatch[1]) ip = ipMatch[1];
        } else {
          throw new Error(t("hotspotStartFailed") + ": " + result);
        }
      }

      setHotspotStatus(t("hotspotActiveStartingServer"));
      const url = await window.electronAPI.startUploadServer();
      setShareUrl(url);
      setIsReceiving(true);
      setStartingHotspot(false);
      setHotspotStatus("");
      const qrData = await QRCode.toDataURL(url, {
        width: 200,
        margin: 2,
        color: { dark: "#b169e0", light: "#0A0A0A" },
      });
      setQrDataUrl(qrData);
    } catch (err: any) {
      alert(t("errorOccurred") + ": " + (err.message || err));
      setStartingHotspot(false);
      setHotspotStatus("");
    }
  };

  const stopReceiving = async () => {
    await window.electronAPI.stopUploadServer();
    setShareUrl("");
    setQrDataUrl("");
    setIsReceiving(false);
    setCopied(false);
    onStopReceiving?.();
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={styles.container}>
      <BackButton
        className={styles.compactBack}
        onClick={() => {
          if (isReceiving) stopReceiving();
          onBack();
        }}
      />
      <h2 className={styles.title}>{t("receiveFromBrowser")}</h2>
      <p className={styles.subtitle}>
        {isReceiving ? t("askSenderToOpenLink") : t("startReceivingDesc")}
      </p>

      {/* Show hotspot progress */}
      {startingHotspot && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            color: "#aaa",
          }}
        >
          <FaSpinner className={styles.spinner} />
          <span>{hotspotStatus}</span>
        </div>
      )}

      {!isReceiving && !startingHotspot && (
        <button className={styles.btn} onClick={startReceiving}>
          {t("startReceiving")}
        </button>
      )}

      {isReceiving && (
        <div className={styles.receivePanel}>
          {/* QR Code */}
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code" className={styles.qr} />
          ) : (
            <div className={styles.qrPlaceholder}>
              <span>{t("generatingQR")}</span>
            </div>
          )}

          {/* URL + Copy */}
          <div className={styles.urlRow}>
            <span className={styles.url}>{shareUrl}</span>
            <button className={styles.copyBtn} onClick={copyLink}>
              {copied ? (
                <>
                  <FaCheckCircle
                    style={{ marginRight: 4 }}
                    color="#4CAF50"
                    size={14}
                  />{" "}
                  {t("copied")}
                </>
              ) : (
                <>
                  <FaCopy style={{ marginRight: 4 }} size={14} />{" "}
                  {t("copyLink")}
                </>
              )}
            </button>
          </div>

          <p className={styles.hint}>{t("tellReceiverToConnect")}</p>

          <button className={styles.stopBtn} onClick={stopReceiving}>
            {t("stopReceiving")}
          </button>

          {/* Pending Senders */}
          {pendingSenders.length > 0 && (
            <div className={styles.receivedSection}>
              <h3 className={styles.receivedTitle}>{t("pendingSenders")}</h3>
              <ul className={styles.fileList}>
                {pendingSenders.map((s) => (
                  <li key={s.sessionId} className={styles.fileItem}>
                    <span className={styles.fileName}>
                      {getDeviceIcon(s.deviceType)}
                      {s.senderName || t("unnamed")}
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className={styles.acceptBtn}
                        onClick={async () => {
                          await window.electronAPI.approveSender(s.sessionId);
                          setPendingSenders((prev) =>
                            prev.filter((x) => x.sessionId !== s.sessionId),
                          );
                          setApprovedSenders((prev) => [
                            ...prev,
                            { sessionId: s.sessionId, senderName: s.senderName || "Unknown" },
                          ]);
                          onSenderApproved?.();
                        }}
                      >
                        {t("accept")}
                      </button>
                      <button
                        className={styles.declineBtn}
                        onClick={async () => {
                          await window.electronAPI.declineSender(s.sessionId);
                          setPendingSenders((prev) =>
                            prev.filter((x) => x.sessionId !== s.sessionId),
                          );
                        }}
                      >
                        {t("decline")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {approvedSenders.length > 0 && (
            <div className={styles.receivedSection}>
              <h3 className={styles.receivedTitle}>Uploading from</h3>
              <ul className={styles.fileList}>
                {approvedSenders.map((sender) => (
                  <li key={sender.sessionId} className={styles.fileItem}>
                    <div
                      className={styles.miniSpinner}
                      style={{ marginRight: 8 }}
                    />
                    <span className={styles.fileName}>{sender.senderName}</span>
                    <span className={styles.fileTime}>Uploading…</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Received files list */}
          {receivedFiles.length > 0 && (
            <div className={styles.receivedSection}>
              <h3 className={styles.receivedTitle}>{t("receivedFiles")}</h3>
              <ul className={styles.fileList}>
                {receivedFiles.map((f) => (
                  <li key={f.id} className={styles.fileItem}>
                    <FaCheckCircle
                      size={14}
                      color="#4CAF50"
                      style={{ marginRight: 8 }}
                    />
                    <span className={styles.fileName}>{f.name}</span>
                    <span className={styles.fileTime}>{f.time}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingSenders.length === 0 &&
            receivedFiles.length === 0 &&
            approvedSenders.length === 0 && (
              <p className={styles.waitingHint}>{t("waitingForSenders")}</p>
            )}
        </div>
      )}
    </div>
  );
};

export default ReceiveFromBrowser;
