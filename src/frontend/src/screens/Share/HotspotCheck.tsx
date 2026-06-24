import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FaCheckCircle,
  FaArrowRight,
  FaWifi,
} from "react-icons/fa";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/HotspotCheck.module.css";

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
  const { t } = useTranslation();

  const [errorMessage, setErrorMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [success, setSuccess] = useState(false);
  const [localIP, setLocalIP] = useState<string | null>(null);
  const [ssid, setSsid] = useState<string>("");
  const [checkingNetwork, setCheckingNetwork] = useState(true);
  const [showHotspotUI, setShowHotspotUI] = useState(false);

  const networkContainer = useRef<HTMLDivElement>(null);
  const hotspotContainer = useRef<HTMLDivElement>(null);
  const successContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkNetwork = async () => {
      try {
        const ip = await window.electronAPI.getLocalIP();
        if (ip) {
          setLocalIP(ip);
          const name = await window.electronAPI.getWifiSSID();
          const ssidName = name || "Wi-Fi";
          setSsid(ssidName);
          // Use i18n key instead of hardcoded string
          onConnectionChange(t("connectedTo", { ssid: ssidName }));
        }
      } finally {
        setCheckingNetwork(false);
      }
    };
    checkNetwork();
  }, [onConnectionChange, t]);

  useGSAP(
    () => {
      if (showHotspotUI && hotspotContainer.current) {
        const ctx = gsap.context(() => {
          gsap.fromTo(
            hotspotContainer.current,
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" }
          );
        });
        return () => ctx.revert();
      }
    },
    { dependencies: [showHotspotUI] }
  );

  useGSAP(
    () => {
      if (success && successContainer.current) {
        const ctx = gsap.context(() => {
          gsap.fromTo(
            successContainer.current,
            { opacity: 0, scale: 0.95 },
            { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(1.4)" }
          );
        });
        return () => ctx.revert();
      }
    },
    { dependencies: [success] }
  );

  const startHotspot = async () => {
    if (networkContainer.current) {
      gsap.to(networkContainer.current, {
        opacity: 0,
        y: -20,
        duration: 0.25,
        onComplete: async () => {
          setShowHotspotUI(true);
          setRunning(true);
          setErrorMessage("");
          try {
            const result = await window.electronAPI.startHotspot();
            if (result.includes("SUCCESS")) {
              setSuccess(true);
              const ipMatch = result.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
              if (ipMatch && ipMatch[1]) {
                const ip = ipMatch[1];
                onHotspotStarted(ip);
                onConnectionChange(t("hotspotActive", { ip }));
              } else {
                throw new Error("Could not determine hotspot IP");
              }
            } else {
              setErrorMessage(t("hotspotFailed"));
            }
          } catch (err: any) {
            setErrorMessage(t("errorOccurred", { message: err.message || err }));

          } finally {
            setRunning(false);
          }
        },
      });
    } else {
      setShowHotspotUI(true);
      setRunning(true);
      setErrorMessage("");
      try {
        const result = await window.electronAPI.startHotspot();
        if (result.includes("SUCCESS")) {
          setSuccess(true);
          const ipMatch = result.match(/Hotspot IP \(for sharing\):\s*([\d.]+)/);
          if (ipMatch && ipMatch[1]) {
            const ip = ipMatch[1];
            onHotspotStarted(ip);
            onConnectionChange(t("hotspotActive", { ip }));
          } else {
            throw new Error("Could not determine hotspot IP");
          }
        } else {
          setErrorMessage(t("hotspotFailed"));
        }
      } catch (err: any) {
        setErrorMessage(t("errorOccurred", { message: err.message || err }));

      } finally {
        setRunning(false);
      }
    }
  };

  if (checkingNetwork) {
    return (
      <div className={styles.container}>
        <p style={{ color: "#aaa" }}>{t("detectingNetwork")}</p>
      </div>
    );
  }

  if (localIP && !showHotspotUI) {
    return (
      <div className={styles.container} ref={networkContainer}>
        <BackButton onClick={onBack} />
        <h2 className={styles.title}>{t("networkFound")}</h2>
        <div className={styles.networkInfo}>
          <FaWifi size={20} color="#4CAF50" />
          <span className={styles.networkName}>{ssid}</span>
        </div>
        <p className={styles.subtitle}>
          {t("youAreConnectedTo", { ssid })}<br />
          {t("filesWillBeShared")}
        </p>

        <button
          className={styles.btn}
          onClick={() => {
            onHotspotStarted(localIP);
            onReady();
          }}
        >
          {t("shareNow")}
        </button>
        <button
          className={styles.ghostBtn}
          onClick={startHotspot}
          disabled={running}
        >
          {t("startOfflineHotspot")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container} ref={hotspotContainer}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("startOfflineHotspotTitle")}</h2>
      <p className={styles.subtitle}>{t("hotspotRequired")}</p>

      {!success && (
        <>
          <button
            className={styles.btn}
            onClick={startHotspot}
            disabled={running}
          >
            {running ? (
              <span className={styles.spinnerContainer}>
                <span className={styles.spinner} /> {t("startingHotspot")}
              </span>
            ) : (
              t("startHotspot")
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
            {t("hotspotActiveMessage")}
          </div>


          <button className={styles.btn} onClick={onReady}>
            {t("continue")} <FaArrowRight />
          </button>


        </div>
      )}
    </div>
  );
};

export default HotspotCheck;