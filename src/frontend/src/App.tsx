import React, { useState, useEffect } from "react";
import HomeScreen from "./screens/Home/HomeScreen";
import SetupStepper from "./screens/Onboarding/SetupStepper";
import HotspotCheck from "./screens/Share/HotspotCheck";
import TransferMethodPicker from "./screens/Share/TransferMethodPicker";
import QuickShare from "./screens/Share/QuickShare";
import P2PSession from "./screens/Share/P2PSession";
import ReceiveScreen from "./screens/Receive/ReceiveScreen";
import ActivityScreen from "./screens/Activity/ActivityScreen";
import SupportScreen from "./screens/Support/SupportScreen";
import RateUsScreen from "./screens/RateUs/RateUsScreen";
import ReceiveFromBrowser from "./screens/ReceiveFromBrowser/ReceiveFromBrowser";
import StatusBar from "./components/StatusBar";

export type Screen =
  | "home"
  | "share-hotspot-check"
  | "share-method-picker"
  | "share-p2p"
  | "share-quick"
  | "receive"
  | "receive-browser"
  | "settings"
  | "activity"
  | "support"
  | "rate";

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>("home");
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [hotspotActive, setHotspotActive] = useState(false);
  const [hotspotIP, setHotspotIP] = useState("");
  const [connectedDevicesCount, setConnectedDevicesCount] = useState(0);
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null);

  // Check setup flag on mount
  useEffect(() => {
    const done = localStorage.getItem("mayo-setup-complete");
    setSetupComplete(done === "true");
  }, []);

  // Poll hotspot status every 5 seconds
  // Poll hotspot and local network status every 5 seconds
  useEffect(() => {
    if (setupComplete !== true) return;

    const updateStatus = async () => {
      try {
        // 1. Check hotspot status
        const hotspotStatus = await window.electronAPI.checkHotspotStatus();
        setHotspotActive(hotspotStatus.active);
        if (hotspotStatus.active && hotspotStatus.ip) {
          setHotspotIP(hotspotStatus.ip);
          // If hotspot is active, label is usually set by HotspotCheck.
          // But if we're on a screen that didn't set one, show fallback.
          setConnectionLabel(
            (prev) => prev || `Hotspot active · ${hotspotStatus.ip}`,
          );
        } else {
          setHotspotIP("");
        }

        // 2. Check local Wi‑Fi (existing network)
        const localIP = await window.electronAPI.getLocalIP();
        if (localIP) {
          const ssid = await window.electronAPI.getWifiSSID();
          const label = `Connected to ${ssid || "Wi-Fi"}`;
          // Only overwrite if hotspot is not active
          if (!hotspotStatus.active) {
            setConnectionLabel(label);
          }
        } else if (!hotspotStatus.active) {
          // No local network and no hotspot → show "No network"
          setConnectionLabel("No network");
        }
      } catch {
        setHotspotActive(false);
        setHotspotIP("");
        setConnectionLabel("No network");
      }
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);
    return () => clearInterval(interval);
  }, [setupComplete]);

  const completeSetup = () => {
    localStorage.setItem("mayo-setup-complete", "true");
    setSetupComplete(true);
  };

  const resetSetup = () => {
    localStorage.removeItem("mayo-setup-complete");
    setSetupComplete(false);
    setScreen("home");
  };

  const onHotspotStarted = (ip: string) => {
    setHotspotActive(true);
    setHotspotIP(ip);
  };

  if (setupComplete === null) {
    return (
      <div
        style={{
          background: "#0A0A0A",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ color: "#b169e0", fontSize: "1.5rem" }}>MAYO Share</div>
      </div>
    );
  }

  if (!setupComplete) {
    return <SetupStepper onComplete={completeSetup} />;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "#0A0A0A",
      }}
    >
      <div style={{ flex: 1 }}>
        {screen === "home" && (
          <HomeScreen
            currentScreen={screen}
            setScreen={setScreen}
            onHelpClick={resetSetup}
          />
        )}

        {screen === "share-hotspot-check" && (
          <HotspotCheck
            onReady={() => setScreen("share-method-picker")}
            onBack={() => {
              setScreen("home");
              setConnectionLabel(null);
            }}
            onHotspotStarted={onHotspotStarted}
            onConnectionChange={(label: string) => setConnectionLabel(label)}
          />
        )}

        {screen === "share-method-picker" && (
          <TransferMethodPicker
            onSelectP2P={() => setScreen("share-p2p")}
            onSelectQuick={() => setScreen("share-quick")}
            onBack={() => setScreen("share-hotspot-check")}
          />
        )}

        {screen === "share-quick" && (
          <QuickShare
            onBack={() => setScreen("share-method-picker")}
            shareIP={hotspotIP}
          />
        )}

        {screen === "share-p2p" && (
          <P2PSession onBack={() => setScreen("share-method-picker")} />
        )}

        {screen === "receive" && (
          <ReceiveScreen onBack={() => setScreen("home")} />
        )}

        {screen === "receive-browser" && (
          <ReceiveFromBrowser
            onBack={() => setScreen("home")}
            onSenderApproved={() =>
              setConnectedDevicesCount((prev) => prev + 1)
            }
            onStopReceiving={() => setConnectedDevicesCount(0)}
          />
        )}

        {screen === "activity" && (
          <ActivityScreen onBack={() => setScreen("home")} />
        )}

        {screen === "support" && (
          <SupportScreen onBack={() => setScreen("home")} />
        )}

        {screen === "rate" && <RateUsScreen onBack={() => setScreen("home")} />}
      </div>

      <StatusBar
        hotspotActive={hotspotActive}
        hotspotIP={hotspotIP}
        transferLabel={null}
        transferProgress={null}
        appVersion="1.0.0"
        connectedDevices={connectedDevicesCount}
        connectionLabel={connectionLabel}
      />
    </div>
  );
};

export default App;
