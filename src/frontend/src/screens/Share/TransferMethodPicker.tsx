import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { VscGlobe } from "react-icons/vsc";
import { FaLink } from "react-icons/fa6";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/TransferMethodPicker.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onSelectP2P: () => void;
  onSelectQuick: () => void;
  onBack: () => void;
}

const TransferMethodPicker: React.FC<Props> = ({
  onSelectP2P,
  onSelectQuick,
  onBack,
}) => {
  const { t } = useTranslation();
  const cardsRef = useRef<HTMLDivElement>(null);

  // Entrance animation – cards stagger in from below
  useGSAP(() => {
    if (cardsRef.current) {
      gsap.fromTo(
        cardsRef.current.querySelectorAll(`.${styles.card}`),
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.1,
          ease: "power2.out",
        }
      );
    }
  }, []);

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.heading}>{t("chooseTransferMethod")}</h2>
      <p className={styles.subtitle}>{t("howToShare")}</p>

      <div className={styles.cards} ref={cardsRef}>
        <MethodCard
          icon={<VscGlobe size={40} />}
          title={t("quickShare")}
          description={t("quickShareDesc")}
          color="#b169e0"
          onClick={onSelectQuick}
        />
        <MethodCard
          icon={<FaLink size={36} />}
          title={t("deviceConnect")}
          description={t("deviceConnectDesc")}
          color="#b169e0"
          onClick={onSelectP2P}
        />
      </div>
    </div>
  );
};

interface CardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  onClick: () => void;
}

const MethodCard: React.FC<CardProps> = ({
  icon,
  title,
  description,
  color,
  onClick,
}) => (
  <div
    className={styles.card}
    onClick={onClick}
    onMouseEnter={(e) =>
      ((e.currentTarget as HTMLDivElement).style.borderColor = color)
    }
    onMouseLeave={(e) =>
      ((e.currentTarget as HTMLDivElement).style.borderColor = "#222")
    }
  >
    <div className={styles.cardEmoji}>{icon}</div>
    <div className={styles.cardTitle}>{title}</div>
    <div className={styles.cardDesc}>{description}</div>
  </div>
);

export default TransferMethodPicker;