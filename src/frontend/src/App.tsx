import React, { useState, useEffect, useRef } from "react";
import HomeScreen from "./screens/Home/HomeScreen";
import SetupStepper from "./screens/Onboarding/SetupStepper";
import LanguageSelectScreen from "./screens/LanguageSelect/LanguageSelectScreen";
import HotspotCheck from "./screens/Share/HotspotCheck";
import TransferMethodPicker from "./screens/Share/TransferMethodPicker";
import QuickShare from "./screens/Share/QuickShare";
import P2PSession from "./screens/Share/P2PSession";
import ReceiveMethodPicker from "./screens/Receive/ReceiveMethodPicker";
import ActivityScreen from "./screens/Activity/ActivityScreen";
import SupportScreen from "./screens/Support/SupportScreen";
import RateUsScreen from "./screens/RateUs/RateUsScreen";
import TopBar from "./components/TopBar";
import TroubleshootScreen from "./screens/Troubleshoot/Troubleshoot";
import ReceiveFromBrowser from "./screens/ReceiveFromBrowser/ReceiveFromBrowser";
import SettingsScreen from "./screens/Settings/SettingsScreen";
import StatusBar from "./components/StatusBar";

export type Screen =
  | "home"
  | "share-hotspot-check"
  | "share-method-picker"
  | "share-p2p"
  | "share-quick"
  | "receive"
  | "receive-browser"
  | "receive-p2p"
  | "settings"
  | "activity"
  | "support"
  | "rate"
  | "troubleshoot"
  | "language-select";

// Screens that represent an active transfer session — navigating away and back
// should keep you on the transfer screen, not drop you to home.
const TRANSFER_SCREENS: Screen[] = ["share-p2p", "receive-p2p", "share-quick", "receive-browser"];
const PERSISTENT_SCREEN_KEY = "mayo-current-screen";
const PERSISTENT_HISTORY_KEY = "mayo-screen-history";

// Screens we should NOT restore on relaunch (connection/session screens that
// would be stale after a restart).
const NON_RESTORABLE: Screen[] = ["share-hotspot-check", "share-method-picker"];

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>("home");
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [languageSet, setLanguageSet] = useState<boolean | null>(null);
  const [hotspotActive, setHotspotActive] = useState(false);
  const [hotspotIP, setHotspotIP] = useState("");
  const [connectedDevicesCount, setConnectedDevicesCount] = useState(0);
  const [connectionLabel, setConnectionLabel] = useState<string | null>(null);
  const [storageLabel, setStorageLabel] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string | null>(null);
  const screenRef = useRef<Screen>("home");

  // Keep a ref in sync so event handlers always read the current value without
  // needing screen in their dependency arrays.
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // ─── Persist screen across tab/TopBar navigation ────────────────────────────
  // We save the screen to sessionStorage (not localStorage) so it resets on
  // a full app restart but survives TopBar navigations within one session.
  const persistScreen = (s: Screen, history: Screen[]) => {
    if (NON_RESTORABLE.includes(s)) return; // don't persist stale sessions
    try {
      sessionStorage.setItem(PERSISTENT_SCREEN_KEY, s);
      sessionStorage.setItem(PERSISTENT_HISTORY_KEY, JSON.stringify(history));
    } catch { }
  };

  // Navigate to a new screen, pushing current to history
  const navigateTo = (next: Screen) => {
    setScreenHistory((prev) => {
      const newHistory = [...prev, screenRef.current];
      persistScreen(next, newHistory);
      return newHistory;
    });
    setScreen(next);
    screenRef.current = next;
  };

  // Go back to previous screen in history, or home if empty
  const navigateBack = () => {
    setScreenHistory((prev) => {
      if (prev.length === 0) {
        setScreen("home");
        screenRef.current = "home";
        persistScreen("home", []);
        return prev;
      }
      const history = [...prev];
      const last = history.pop()!;
      setScreen(last);
      screenRef.current = last;
      persistScreen(last, history);
      return history;
    });
  };

  // Check setup flags and platform on mount — also restore last screen
  useEffect(() => {
    const init = async () => {
      const done = localStorage.getItem("mayo-setup-complete");
      const langDone = localStorage.getItem("mayo-language-set");

      const plat = await window.electronAPI.getPlatform();
      setPlatform(plat);

      if (plat === "darwin") {
        localStorage.setItem("mayo-setup-complete", "true");
        setSetupComplete(true);
      } else {
        setSetupComplete(done === "true");
      }
      setLanguageSet(langDone === "true");

      // Restore last screen from sessionStorage (within a single app session)
      try {
        const savedScreen = sessionStorage.getItem(PERSISTENT_SCREEN_KEY) as Screen | null;
        const savedHistory = sessionStorage.getItem(PERSISTENT_HISTORY_KEY);
        if (savedScreen && !NON_RESTORABLE.includes(savedScreen)) {
          setScreen(savedScreen);
          screenRef.current = savedScreen;
          if (savedHistory) {
            setScreenHistory(JSON.parse(savedHistory));
          }
        }
      } catch { }
    };
    init();
  }, []);

  // Poll hotspot status every 5 seconds
  useEffect(() => {
    if (setupComplete !== true) return;

    const updateStatus = async () => {
      try {
        const hotspotStatus = await window.electronAPI.checkHotspotStatus();
        setHotspotActive(hotspotStatus.active);
        if (hotspotStatus.active && hotspotStatus.ip) {
          setHotspotIP(hotspotStatus.ip);
          setConnectionLabel(
            (prev) => prev || `Hotspot active · ${hotspotStatus.ip}`,
          );
        } else {
          setHotspotIP("");
        }

        const localIP = await window.electronAPI.getLocalIP();
        if (localIP) {
          const ssid = await window.electronAPI.getWifiSSID();
          const label = `Connected to ${ssid || "Wi-Fi"}`;
          if (!hotspotStatus.active) {
            setConnectionLabel(label);
          }
        } else if (!hotspotStatus.active) {
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

  // Poll device storage usage for the status-bar indicator
  useEffect(() => {
    if (setupComplete !== true) return;

    const formatBytes = (b: number) => {
      if (!b || b <= 0) return "0 B";
      const k = 1024;
      const units = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.min(
        units.length - 1,
        Math.floor(Math.log(b) / Math.log(k)),
      );
      return `${parseFloat((b / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
    };

    const updateStorage = async () => {
      try {
        const { free, total } = await window.electronAPI.getDiskSpace();
        if (total > 0) {
          setStorageLabel(`${formatBytes(total - free)} used of ${formatBytes(total)}`);
        } else {
          setStorageLabel(null);
        }
      } catch {
        setStorageLabel(null);
      }
    };

    updateStorage();
    const interval = setInterval(updateStorage, 10000);
    return () => clearInterval(interval);
  }, [setupComplete]);

  const completeSetup = () => {
    localStorage.setItem("mayo-setup-complete", "true");
    setSetupComplete(true);
  };

  const resetSetup = () => {
    localStorage.removeItem("mayo-setup-complete");
    if (platform === "darwin") {
      localStorage.setItem("mayo-setup-complete", "true");
      setSetupComplete(true);
    } else {
      setSetupComplete(false);
    }
    setScreenHistory([]);
    setScreen("home");
    screenRef.current = "home";
    try {
      sessionStorage.removeItem(PERSISTENT_SCREEN_KEY);
      sessionStorage.removeItem(PERSISTENT_HISTORY_KEY);
    } catch { }
  };

  const onHotspotStarted = (ip: string) => {
    setHotspotActive(true);
    setHotspotIP(ip);
  };

  // ----- EARLY RETURNS (loading, language, setup) -----
  if (setupComplete === null || languageSet === null) {
    return (
      <div
        style={{
          background: "var(--bg-primary)",
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

  if (!languageSet) {
    return (
      <LanguageSelectScreen
        onComplete={() => {
          localStorage.setItem("mayo-language-set", "true");
          setLanguageSet(true);
        }}
      />
    );
  }

  if (!setupComplete) {
    return <SetupStepper onComplete={completeSetup} />;
  }

  // ----- MAIN APP (home & all screens) -----
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        background: "var(--bg-primary)",
      }}
    >
      <div style={{ flex: 1 }}>
        {/* TopBar navigations are captured here and also persisted */}
        <TopBar
          onNavigate={(s: Screen) => {
            // If we're on a transfer screen and user clicks a tab,
            // we still save the transfer screen so back-navigation returns to it.
            navigateTo(s);
          }}
        />
        {screen === "home" && (
          <HomeScreen
            currentScreen={screen}
            setScreen={navigateTo}
            // @ts-ignore
            onHelpClick={resetSetup}
          />
        )}
        {screen === "share-hotspot-check" && (
          <HotspotCheck
            onReady={() => navigateTo("share-method-picker")}
            onBack={() => {
              navigateBack();
              setConnectionLabel(null);
            }}
            onHotspotStarted={onHotspotStarted}
            onConnectionChange={(label: string) => setConnectionLabel(label)}
          />
        )}
        {screen === "share-method-picker" && (
          <TransferMethodPicker
            onSelectP2P={() => navigateTo("share-p2p")}
            onSelectQuick={() => navigateTo("share-quick")}
            onBack={navigateBack}
          />
        )}
        {screen === "share-quick" && (
          <QuickShare
            onBack={navigateBack}
            shareIP={hotspotIP}
          />
        )}
        {/* SEND P2P – skip chooser, go straight to send mode */}
        {screen === "share-p2p" && (
          <P2PSession onBack={navigateBack} initialMode="send" />
        )}
        {screen === "receive" && (
          <ReceiveMethodPicker
            onSelectBrowser={() => navigateTo("receive-browser")}
            onSelectP2P={() => navigateTo("receive-p2p")}
            onBack={navigateBack}
          />
        )}
        {screen === "receive-browser" && (
          <ReceiveFromBrowser
            onBack={navigateBack}
            onSenderApproved={() =>
              setConnectedDevicesCount((prev) => prev + 1)
            }
            onStopReceiving={() => setConnectedDevicesCount(0)}
          />
        )}
        {/* RECEIVE P2P – skip chooser, go straight to join mode with auto‑IP */}
        {screen === "receive-p2p" && (
          <P2PSession onBack={navigateBack} initialMode="join" />
        )}
        {screen === "activity" && (
          <ActivityScreen onBack={navigateBack} />
        )}
        {screen === "support" && (
          <SupportScreen
            onBack={navigateBack}
            onReplayOnboarding={resetSetup}
            // @ts-ignore
            onNavigateTo={navigateTo}
          />
        )}
        {screen === "settings" && (
          <SettingsScreen onBack={navigateBack} />
        )}
        {screen === "troubleshoot" && (
          <TroubleshootScreen onBack={navigateBack} />
        )}
        {screen === "rate" && <RateUsScreen onBack={navigateBack} />}
      </div>

      <StatusBar
        hotspotActive={hotspotActive}
        hotspotIP={hotspotIP}
        transferLabel={null}
        transferProgress={null}
        appVersion="1.0.0"
        connectedDevices={connectedDevicesCount}
        connectionLabel={connectionLabel}
        storageLabel={storageLabel}
      />
    </div>
  );
};

export default App;