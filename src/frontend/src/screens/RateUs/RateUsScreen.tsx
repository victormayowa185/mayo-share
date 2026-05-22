import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { FaStar, FaHeart } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/RateUsScreen.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
}

const RATING_STORAGE_KEY = "mayo-user-rating";

const RateUsScreen: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();

  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [submitted, setSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");

  // Ref for entrance animation
  const contentRef = useRef<HTMLDivElement>(null);

  // GSAP entrance animation
  useGSAP(() => {
    if (contentRef.current) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }
      );
    }
  }, []);

  // Load saved rating on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RATING_STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.rating) {
          setSelectedRating(data.rating);
          setSubmitted(true);
        }
      }
    } catch {}
  }, []);

  // Sync pending rating when online
  useEffect(() => {
    const syncRating = async () => {
      if (!navigator.onLine) return;
      try {
        const saved = localStorage.getItem(RATING_STORAGE_KEY);
        if (!saved) return;
        const data = JSON.parse(saved);
        if (!data.pendingSync) return;

        setSyncStatus(t("syncingRating"));

        const result = await window.electronAPI.submitRating({
          rating: data.rating,
          timestamp: data.timestamp,
          appVersion: "1.0.0",
        });

        if (result.success) {
          localStorage.setItem(
            RATING_STORAGE_KEY,
            JSON.stringify({ ...data, pendingSync: false }),
          );
          setSyncStatus(t("ratingSubmittedThankYou"));
          setTimeout(() => setSyncStatus(""), 3000);
        } else {
          setSyncStatus(t("willSyncRatingWhenOnline"));
        }
      } catch {
        setSyncStatus(t("willSyncRatingWhenOnline"));
      }
    };

    syncRating();
    window.addEventListener("online", syncRating);
    return () => window.removeEventListener("online", syncRating);
  }, [submitted]);

  const handleStarClick = (star: number) => {
    if (submitted) return;
    setSelectedRating(star);
    setSubmitted(true);

    localStorage.setItem(
      RATING_STORAGE_KEY,
      JSON.stringify({
        rating: star,
        timestamp: new Date().toISOString(),
        pendingSync: true,
      }),
    );

    setSyncStatus(t("ratingSavedWillSyncWhenOnline"));
  };

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <div className={styles.content} ref={contentRef}>
        <h2 className={styles.title}>{t("rateUs")}</h2>
        <p className={styles.paragraph}>
          {submitted ? t("thankYouFeedback") : t("enjoyingMayoShare")}
        </p>

        <div className={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => (
            <FaStar
              key={star}
              size={32}
              color={
                star <= (hoverRating || selectedRating) ? "#b169e0" : "#333"
              }
              style={{
                cursor: submitted ? "default" : "pointer",
                transition: "color 0.15s",
              }}
              onMouseEnter={() => !submitted && setHoverRating(star)}
              onMouseLeave={() => !submitted && setHoverRating(0)}
              onClick={() => handleStarClick(star)}
            />
          ))}
        </div>

        {!submitted && (
          <button className={styles.btn} onClick={() => handleStarClick(5)}>
            {t("rateNow")}
          </button>
        )}

        {submitted && (
          <div className={styles.thankYou}>
            <p className={styles.ratingText}>
              {t("youRatedMayoShare", { rating: selectedRating })}
              {selectedRating > 1 ? "s" : ""}!
            </p>
            <a
              href="https://github.com/sponsors/victormayowa185"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sponsorLink}
            >
              <FaHeart style={{ marginRight: 6 }} />
              {t("sponsorOnGitHub")}
            </a>
          </div>
        )}

        {syncStatus && <p className={styles.syncStatus}>{syncStatus}</p>}
      </div>
    </div>
  );
};

export default RateUsScreen;