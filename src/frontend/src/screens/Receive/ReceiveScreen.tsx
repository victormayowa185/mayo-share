import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { FaLink } from "react-icons/fa6";
import { MdGetApp } from "react-icons/md";
import ReceiveFromBrowser from "../ReceiveFromBrowser/ReceiveFromBrowser";
import P2PSession from "../Share/P2PSession";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/ReceiveScreen.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
}

const ReceiveScreen: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"choose" | "p2p" | "browser">("choose");

  // Ref for the cards container
  const cardsRef = useRef<HTMLDivElement>(null);

  // Entrance animation – only when mode is "choose" (the mode chooser is visible)
useGSAP(
  () => {
    if (mode === "choose" && cardsRef.current) {
      const cards = cardsRef.current.querySelectorAll(`.${styles.modeCard}`);
      gsap.fromTo(
        cards,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          ease: "power2.out",
          onComplete: () => {
            gsap.set(cards, { clearProps: "transform" });
          }
        }
      );
    }
  },
  { dependencies: [mode] }
);
  return (
    <div className={styles.container}>
      {/* Outer back arrow – hidden when P2P or browser mode is active */}
      {mode === "choose" && <BackButton onClick={onBack} />}
      {mode === "choose" && (
        <h2 className={styles.title}>{t("receiveFiles")}</h2>
      )}

      {/* ── Mode chooser ── */}
      {mode === "choose" && (
        <div className={styles.modeCards} ref={cardsRef}>
          <div className={styles.modeCard} onClick={() => setMode("p2p")}>
            <div className={styles.cardEmoji}>
              <FaLink size={36} />
            </div>
            <div className={styles.cardTitle}>
              {t("joinDeviceConnect")}
            </div>
            <div className={styles.cardDesc}>
              {t("joinDeviceConnectDesc")}
            </div>
          </div>

          <div className={styles.modeCard} onClick={() => setMode("browser")}>
            <div className={styles.cardEmoji}>
              <MdGetApp size={36} />
            </div>
            <div className={styles.cardTitle}>
              {t("receiveFromBrowser")}
            </div>
            <div className={styles.cardDesc}>
              {t("receiveFromBrowserDesc")}
            </div>
          </div>
        </div>
      )}

      {/* ── P2P join (uses the upgraded P2PSession component) ── */}
      {mode === "p2p" && (
         // @ts-ignore
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