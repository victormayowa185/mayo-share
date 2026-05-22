import React, { useState, useEffect } from "react";
import { FaStar, FaHeart } from "react-icons/fa";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/RateUsScreen.module.css";

interface Props {
  onBack: () => void;
}

const RATING_STORAGE_KEY = "mayo-user-rating";

const RateUsScreen: React.FC<Props> = ({ onBack }) => {
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [submitted, setSubmitted] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");

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

  useEffect(() => {
    const syncRating = async () => {
      if (!navigator.onLine) return;
      try {
        const saved = localStorage.getItem(RATING_STORAGE_KEY);
        if (!saved) return;
        const data = JSON.parse(saved);
        if (!data.pendingSync) return;

        setSyncStatus("Syncing rating…");

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
          setSyncStatus("Rating submitted. Thank you!");
          setTimeout(() => setSyncStatus(""), 3000);
        } else {
          setSyncStatus("Will sync rating when online.");
        }
      } catch {
        setSyncStatus("Will sync rating when online.");
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

    setSyncStatus("Rating saved. Will sync when online.");
  };

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <div className={styles.content}>
        <h2 className={styles.title}>Rate Us</h2>
        <p className={styles.paragraph}>
          {submitted
            ? "Thank you for your feedback!"
            : "Enjoying MAYO Share? Let others know!"}
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
            Rate Now
          </button>
        )}

        {submitted && (
          <div className={styles.thankYou}>
            <p className={styles.ratingText}>
              You rated MAYO Share {selectedRating} star
              {selectedRating > 1 ? "s" : ""}!
            </p>
            <a
              href="https://github.com/sponsors/victormayowa185"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sponsorLink}
            >
              <FaHeart style={{ marginRight: 6 }} />
              Sponsor on GitHub
            </a>
          </div>
        )}

        {syncStatus && <p className={styles.syncStatus}>{syncStatus}</p>}
      </div>
    </div>
  );
};

export default RateUsScreen;
