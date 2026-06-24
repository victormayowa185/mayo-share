import React, { useState, useEffect } from "react";
import { FaCheckCircle, FaCopy, FaSpinner, FaQrcode } from "react-icons/fa";
import { FaDesktop, FaMobileAlt, FaTabletAlt } from "react-icons/fa";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";
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
  // Wrapped in a div with a specific class for alignment
  const icon = () => {
    switch (deviceType) {
      case "phone": return <FaMobileAlt size={18} color="#7C3EFF" />;
      case "tablet": return <FaTabletAlt size={18} color="#7C3EFF" />;
      default: return <FaDesktop size={18} color="#7C3EFF" />;
    }
  };

  return (
    <div className={styles.deviceIconWrapper}>
      {icon()}
    </div>
  );
};

const getQrLightColor = () => {
  const isDarkMode = document.documentElement.getAttribute("data-theme") === "dark";
  return isDarkMode ? "#0A0A0A" : "#FFFFFF";
};

const ReceiveFromBrowser: React.FC<Props> = ({
  onBack,
  onSenderApproved,
  onStopReceiving,
}) => {
  const { t } = useTranslation();
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [isReceiving, setIsReceiving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [startingHotspot, setStartingHotspot] = useState(false);
  const [hotspotStatus, setHotspotStatus] = useState("");
  const [approvedSenders, setApprovedSenders] = useState<{ sessionId: string; senderName: string }[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([]);
  const [pendingSenders, setPendingSenders] = useState<{ sessionId: string; senderName: string; deviceType: string }[]>([]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onUploadUpdate((data) => {
      if (data.event === "received") {
        const newFile: ReceivedFile = {
          id: Date.now().toString() + Math.random(),
          name: data.fileName,
          time: new Date().toLocaleTimeString(),
        };
        setReceivedFiles((prev) => [...prev, newFile]);
        // @ts-ignore
        setApprovedSenders((prev) => prev.filter((s) => s.senderName !== data.senderName));
      }
    });
    return () => unsubscribe();
  }, []);


  useEffect(() => {
    const unsubscribe = window.electronAPI.onSenderConnected((data: { sessionId: string; senderName: string; deviceType: string }) => {
      setPendingSenders((prev) => {
        const existingIdx = prev.findIndex((s) => s.sessionId === data.sessionId);
        if (existingIdx !== -1) {
          const updated = [...prev];
          updated[existingIdx] = data;
          return updated;
        }
        return [...prev, data];
      });
    });
    return () => unsubscribe();
  }, []);


  useEffect(() => {
    if (!isReceiving || !shareUrl) return;
    const observer = new MutationObserver(async () => {
      try {
        const qrData = await QRCode.toDataURL(shareUrl, {
          width: 220,
          margin: 2,
          color: { dark: "#7C3EFF", light: getQrLightColor() },
        });
        setQrDataUrl(qrData);
      } catch (err) { console.error("QR regeneration failed", err); }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [isReceiving, shareUrl]);

  const startReceiving = async () => {
    onStopReceiving?.();
    try {
      setStartingHotspot(true);
      setHotspotStatus(t("checkingNetwork"));
      const localIP = await window.electronAPI.getLocalIP();
      if (localIP) {
        setHotspotStatus(t("usingExistingNetwork"));
        const url = await window.electronAPI.startUploadServer(localIP);
        setShareUrl(url);
        setIsReceiving(true);
        setStartingHotspot(false);
        setHotspotStatus("");
        const qrData = await QRCode.toDataURL(url, {
          width: 220,
          margin: 2,
          color: { dark: "#7C3EFF", light: getQrLightColor() },
        });
        setQrDataUrl(qrData);
        return;
      }
      setHotspotStatus(t("startingHotspotFallback"));
      const status = await window.electronAPI.checkHotspotStatus();
      let ip = status.ip;
      if (!status.active) {
        const result = await window.electronAPI.startHotspot();
        if (result.includes("SUCCESS")) {
          const ipMatch = result.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
          if (ipMatch && ipMatch[1]) ip = ipMatch[1];
        } else { throw new Error(t("hotspotStartFailed") + ": " + result); }
      }
      setHotspotStatus(t("hotspotActiveStartingServer"));
      const url = await window.electronAPI.startUploadServer();
      setShareUrl(url);
      setIsReceiving(true);
      setStartingHotspot(false);
      setHotspotStatus("");
      const qrData = await QRCode.toDataURL(url, {
        width: 220,
        margin: 2,
        color: { dark: "#7C3EFF", light: getQrLightColor() },
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
      <BackButton onClick={() => { if (isReceiving) stopReceiving(); onBack(); }} />
      <h2 className={styles.title}>{t("receiveFromBrowser")}</h2>
      <p className={styles.subtitle}>
        {isReceiving ? t("askSenderToOpenLink") : t("receiveFromBrowserDesc")}
      </p>

      {startingHotspot && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, color: "#aaa" }}>
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
        <div className={styles.shareLayout}>
          {/* LEFT COLUMN: Lists */}
          <div className={styles.leftColumn}>
            {pendingSenders.length > 0 && (
              <div className={styles.receivedSection}>
                <h3 className={styles.columnTitle}>{t("pendingSenders")}</h3>
                <ul className={styles.fileList}>
                  {pendingSenders.map((s) => (
                    <li key={s.sessionId} className={styles.fileItem}>
                      <span className={styles.fileName}>
                        {getDeviceIcon(s.deviceType)}
                        {s.senderName || t("unnamed")}
                      </span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className={styles.acceptBtn} onClick={async () => {
                          await window.electronAPI.approveSender(s.sessionId);
                          setPendingSenders((prev) => prev.filter((x) => x.sessionId !== s.sessionId));
                          setApprovedSenders((prev) => [...prev, { sessionId: s.sessionId, senderName: s.senderName || "Unknown" }]);
                          onSenderApproved?.();
                        }}>{t("accept")}</button>
                        <button className={styles.declineBtn} onClick={async () => {
                          await window.electronAPI.declineSender(s.sessionId);
                          setPendingSenders((prev) => prev.filter((x) => x.sessionId !== s.sessionId));
                        }}>{t("decline")}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {approvedSenders.length > 0 && (
              <div className={styles.receivedSection}>
                <h3 className={styles.columnTitle}>Uploading from</h3>
                <ul className={styles.fileList}>
                  {approvedSenders.map((sender) => (
                    <li key={sender.sessionId} className={styles.fileItem}>
                      <div className={styles.miniSpinner} style={{ marginRight: 8 }} />
                      <span className={styles.fileName}>{sender.senderName}</span>
                      <span className={styles.fileTime}>Uploading…</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {receivedFiles.length > 0 && (
              <div className={styles.receivedSection}>
                <h3 className={styles.columnTitle}>{t("receivedFiles")}</h3>
                <ul className={styles.fileList}>
                  {receivedFiles.map((f) => (
                    <li key={f.id} className={styles.fileItem}>
                      <FaCheckCircle size={14} color="#4CAF50" style={{ marginRight: 8 }} />
                      <span className={styles.fileName}>{f.name}</span>
                      <span className={styles.fileTime}>{f.time}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pendingSenders.length === 0 && receivedFiles.length === 0 && approvedSenders.length === 0 && (
              <p className={styles.waitingHint}>{t("waitingForSenders")}</p>
            )}
          </div>

          {/* RIGHT COLUMN: QR and Info */}
          <div className={styles.rightColumn}>
            {qrDataUrl ? (
              <div className={styles.qrWrapper}>
                <img src={qrDataUrl} alt="QR Code" className={styles.qr} />
              </div>
            ) : (
              <div className={styles.qrPlaceholder}>
                <FaQrcode size={48} color="#555" />
                <span>{t("generatingQR")}</span>
              </div>
            )}

            <div className={styles.urlRow}>
              <span className={styles.url}>{shareUrl}</span>
              <button className={styles.copyBtn} onClick={copyLink}>
                {copied ? (
                  <><FaCheckCircle style={{ marginRight: 4 }} color="#4CAF50" size={14} /> {t("copied")}</>
                ) : (
                  <><FaCopy style={{ marginRight: 4 }} size={14} /> {t("copyLink")}</>
                )}
              </button>
            </div>
            <p className={styles.hint}>{t("tellReceiverToConnect")}</p>
            <button className={styles.stopBtn} onClick={stopReceiving}>{t("stopReceiving")}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReceiveFromBrowser;