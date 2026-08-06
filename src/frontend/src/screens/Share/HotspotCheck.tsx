import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FaWifi } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/HotspotCheck.module.css";

interface Props {
  onReady: () => void;
  onBack: () => void;
  onConnectionChange: (label: string) => void;
}

const HotspotCheck: React.FC<Props> = ({
  onReady,
  onBack,
  onConnectionChange,
}) => {
  const { t } = useTranslation();

  const [localIP, setLocalIP] = useState<string | null>(null);
  const [ssid, setSsid] = useState<string>("");
  const [checkingNetwork, setCheckingNetwork] = useState(true);

  useEffect(() => {
    const checkNetwork = async () => {
      try {
        const ip = await window.electronAPI.getLocalIP();
        if (ip) {
          setLocalIP(ip);
          const name = await window.electronAPI.getWifiSSID();
          const ssidName = name || "Wi-Fi";
          setSsid(ssidName);
          onConnectionChange(t("connectedTo", { ssid: ssidName }));
        }
      } finally {
        setCheckingNetwork(false);
      }
    };
    checkNetwork();
  }, [onConnectionChange, t]);

  if (checkingNetwork) {
    return (
      <div className={styles.container}>
        <p style={{ color: "#aaa" }}>{t("detectingNetwork")}</p>
      </div>
    );
  }

  if (localIP) {
    return (
      <div className={styles.container}>
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

        <button className={styles.btn} onClick={onReady}>
          {t("shareNow")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t("noNetworkFound")}</h2>
      <p className={styles.subtitle}>{t("noNetworkFoundDesc")}</p>
      <button
        className={styles.btn}
        onClick={async () => {
          setCheckingNetwork(true);
          const ip = await window.electronAPI.getLocalIP();
          if (ip) {
            setLocalIP(ip);
            const name = await window.electronAPI.getWifiSSID();
            const ssidName = name || "Wi-Fi";
            setSsid(ssidName);
            onConnectionChange(t("connectedTo", { ssid: ssidName }));
          }
          setCheckingNetwork(false);
        }}
      >
        {t("retry")}
      </button>
    </div>
  );
};

export default HotspotCheck;