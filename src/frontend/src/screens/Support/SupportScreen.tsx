import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { FaEnvelope, FaGlobe } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/SupportScreen.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
  onReplayOnboarding?: () => void;
  onNavigateTo?: (screen: string) => void;
}

const SupportScreen: React.FC<Props> = ({
  onBack,
  onReplayOnboarding,
  onNavigateTo,
}) => {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);

  // Entrance animation
  useGSAP(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
      );
    }
  }, []);

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <div className={styles.content} ref={contentRef}>
        <h2 className={styles.title}>{t("getSupport")}</h2>
        <p className={styles.paragraph}>{t("supportDescription")}</p>
        <div className={styles.card}>
          <div className={styles.contactRow}>
            <FaEnvelope size={16} color="#888" />
            <span>victormayowa185@gmail.com</span>
          </div>
          <div className={styles.contactRow}>
            <FaGlobe size={16} color="#888" />
            <span>github.com/victormayowa185</span>
          </div>
        </div>
        <button className={styles.btn} onClick={() => onReplayOnboarding?.()}>
          {t("replayOnboarding")}
        </button>
        <button
          className={styles.btn}
          onClick={() => onNavigateTo?.("troubleshoot")}
        >
          {t("troubleshoot")}
        </button>
      </div>
    </div>
  );
};

export default SupportScreen;