import React, { useState, useRef } from "react";
import { useTranslation }x from "react-i18next";
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
  const cardsRef = useRef<HTMLDivElement>(null);

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
      {mode === "choose" && <BackButton onClick={onBack} />}
      {mode === "choose" && (
        <h2 className={styles.title}>{t("receiveFiles")}</h2>
      )}

      {mode === "choose" && (
        <div className={styles.modeCards} ref={cardsRef}>
          <button
            type="button"
            className={styles.modeCard}
            onClick={() => setMode("p2p")}
          >
            <div className={styles.cardEmoji} aria-hidden="true">
              <FaLink size={36} />
            </div>
            <div className={styles.cardTitle}>
              {t("joinDeviceConnect")}
            </div>
            <div className={styles.cardDesc}>
              {t("joinDeviceConnectDesc")}
            </div>
          </button>

          <button
            type="button"
            className={styles.modeCard}
            onClick={() => setMode("browser")}
          >
            <div className={styles.cardEmoji} aria-hidden="true">
              <MdGetApp size={36} />
            </div>
            <div className={styles.cardTitle}>
              {t("receiveFromBrowser")}
            </div>
            <div className={styles.cardDesc}>
              {t("receiveFromBrowserDesc")}
            </div>
          </button>
        </div>
      )}

      {mode === "p2p" && (
        // @ts-ignore
        <P2PSession onBack={() => setMode("choose")} initialMode="join" />
      )}

      {mode === "browser" && (
        <ReceiveFromBrowser onBack={() => setMode("choose")} />
      )}
    </div>
  );
};

export default ReceiveScreen;