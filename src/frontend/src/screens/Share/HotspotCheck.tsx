import React, { useState, useEffect, useRef } from "react";
import {
  FaArrowLeft,
  FaCheckCircle,
  FaArrowRight,
  FaWifi,
} from "react-icons/fa";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import styles from "../../styles/screens/HotspotCheck.module.css";

// Register the hook so GSAP can clean up automatically
gsap.registerPlugin(useGSAP);

interface Props {
  onReady: () => void;
  onBack: () => void;
  onHotspotStarted: (ip: string) => void;
  onConnectionChange: (label: string) => void;
}

const HotspotCheck: React.FC<Props> = ({
  onReady,
  onBack,
  onHotspotStarted,
  onConnectionChange,
}) => {
  const [errorMessage, setErrorMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [success, setSuccess] = useState(false);
  const [localIP, setLocalIP] = useState<string | null>(null);
  const [ssid, setSsid] = useState<string>("");
  const [checkingNetwork, setCheckingNetwork] = useState(true);
  const [showHotspotUI, setShowHotspotUI] = useState(false);

  // Refs for the two main containers
  const networkContainer = useRef<HTMLDivElement>(null);
  const hotspotContainer = useRef<HTMLDivElement>(null);
  const successContainer = useRef<HTMLDivElement>(null);

  // Detect existing Wi‑Fi on mount
  useEffect(() => {
    const checkNetwork = async () => {
      try {
        const ip = await window.electronAPI.getLocalIP();
        if (ip) {
          setLocalIP(ip);
          try {
            const name = await window.electronAPI.getWifiSSID();
            setSsid(name || "Wi-Fi");
          } catch {
            setSsid("Wi-Fi");
          }
          onConnectionChange(`Connected to ${ssid || "Wi-Fi"}`);
        }
      } finally {
        setCheckingNetwork(false);
      }
    };
    checkNetwork();
  }, []);

  // Animate in the hotspot UI when it appears
  useGSAP(
    () => {
      if (showHotspotUI && hotspotContainer.current) {
        gsap.fromTo(
          hotspotContainer.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
        );
      }
    },
    { dependencies: [showHotspotUI] }
  );

  // Animate in the success message when hotspot finishes
  useGSAP(
    () => {
      if (success && successContainer.current) {
        gsap.fromTo(
          successContainer.current,
          { opacity: 0, scale: 0.95 },
          { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.4)" }
        );
      }
    },
    { dependencies: [success] }
  );

  const startHotspot = async () => {
    // Animate out the network‑found UI if it's visible
    if (networkContainer.current) {
      gsap.to(networkContainer.current, {
        opacity: 0,
        y: -20,
        duration: 0.25,
        onComplete: () => {
          setShowHotspotUI(true);
        },
      });
    } else {
      setShowHotspotUI(true);
    }

    setRunning(true);
    setErrorMessage("");
    try {
      const result = await window.electronAPI.startHotspot();
      if (result.includes("SUCCESS")) {
        setSuccess(true);
        const ipMatch = result.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
        const ip = ipMatch && ipMatch[1] ? ipMatch[1] : "192.168.137.1";
        onHotspotStarted(ip);
        onConnectionChange(`Hotspot active · ${ip}`);
      } else {
        setErrorMessage("Failed to start hotspot. Check log for details.");
      }
    } catch (err: any) {
      setErrorMessage("Error: " + (err.message || err));
    } finally {
      setRunning(false);
    }
  };

  if (checkingNetwork) {
    return (
      <div className={styles.container}>
        <p style={{ color: "#aaa" }}>Detecting network...</p>
      </div>
    );
  }

  // Existing network found – before switching to hotspot UI
  if (localIP && !showHotspotUI) {
    return (
      <div className={styles.container} ref={networkContainer}>
        <button className={styles.backBtn} onClick={onBack}>
          <FaArrowLeft style={{ marginRight: 6 }} /> Back
        </button>
        <h2 className={styles.title}>Network Found</h2>
        <div className={styles.networkInfo}>
          <FaWifi size={20} color="#4CAF50" />
          <span className={styles.networkName}>{ssid}</span>
        </div>
        <p className={styles.subtitle}>
          You're connected to {ssid}.<br />
          Files will be shared on this network.
        </p>

        <button
          className={styles.btn}
          onClick={() => {
            onHotspotStarted(localIP);
            onReady();
          }}
        >
          Share Now
        </button>
        <button
          className={styles.ghostBtn}
          onClick={startHotspot}
          disabled={running}
        >
          – or – Start Offline Hotspot
        </button>
      </div>
    );
  }

  // Hotspot UI (starting or started)
  return (
    <div className={styles.container} ref={hotspotContainer}>
      <button className={styles.backBtn} onClick={onBack}>
        <FaArrowLeft style={{ marginRight: 6 }} /> Back
      </button>
      <h2 className={styles.title}>Start Offline Hotspot</h2>
      <p className={styles.subtitle}>
        No network detected. Your hotspot must be active before sharing files.
      </p>

      {!success && (
        <>
          <button
            className={styles.btn}
            onClick={startHotspot}
            disabled={running}
          >
            {running ? (
              <span className={styles.spinnerContainer}>
                <span className={styles.spinner} /> Starting hotspot…
              </span>
            ) : (
              "Start Hotspot"
            )}
          </button>
          {errorMessage && (
            <p style={{ color: "#f44336", marginTop: 12 }}>{errorMessage}</p>
          )}
        </>
      )}

      {success && (
        <div className={styles.successRow} ref={successContainer}>
          <div className={styles.successMsg}>
            <FaCheckCircle style={{ marginRight: 8 }} />
            Hotspot is active!
          </div>
          <button className={styles.btn} onClick={onReady}>
            Continue <FaArrowRight style={{ marginLeft: 6 }} />
          </button>
        </div>
      )}
    </div>
  );
};

export default HotspotCheck;