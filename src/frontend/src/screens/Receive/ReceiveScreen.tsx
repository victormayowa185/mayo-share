import React, { useState } from "react";
import { FaLink } from "react-icons/fa6";
import { MdGetApp } from "react-icons/md";
import ReceiveFromBrowser from "../ReceiveFromBrowser/ReceiveFromBrowser.tsx";
import P2PSession from "../Share/P2PSession";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/ReceiveScreen.module.css";

interface Props {
  onBack: () => void;
}

const ReceiveScreen: React.FC<Props> = ({ onBack }) => {
  const [mode, setMode] = useState<"choose" | "p2p" | "browser">("choose");

  return (
    <div className={styles.container}>
      {/* Outer back arrow – hidden when P2P or browser mode is active */}
      {mode === "choose" && <BackButton onClick={onBack} />}
      {mode === "choose" && <h2 className={styles.title}>Receive Files</h2>}

      {/* ── Mode chooser ── */}
      {mode === "choose" && (
        <div className={styles.modeCards}>
          <div className={styles.modeCard} onClick={() => setMode("p2p")}>
            <div className={styles.cardEmoji}>
              <FaLink size={36} />
            </div>
            <div className={styles.cardTitle}>Join Device Connect</div>
            <div className={styles.cardDesc}>
              Accept files from a MAYO Share session. Paste the offer code or
              auto‑discover nearby devices.
            </div>
          </div>

          <div className={styles.modeCard} onClick={() => setMode("browser")}>
            <div className={styles.cardEmoji}>
              <MdGetApp size={36} />
            </div>
            <div className={styles.cardTitle}>Receive from Browser</div>
            <div className={styles.cardDesc}>
              Let a phone or any device send files TO this laptop. No app needed
              on their side.
            </div>
          </div>
        </div>
      )}

      {/* ── P2P join (uses the upgraded P2PSession component) ── */}
      {mode === "p2p" && (
        <P2PSession onBack={() => setMode("choose")} initialMode="join" />
      )}

      {/* ── Receive from Browser ── */}
      {mode === "browser" && (
        <ReceiveFromBrowser onBack={() => setMode("choose")} />
      )}
    </div>
  );
};

export default ReceiveScreen;