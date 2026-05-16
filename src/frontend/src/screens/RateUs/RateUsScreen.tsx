import React, { useState, useEffect } from "react";
import { FaStar, FaCoffee } from "react-icons/fa";
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

        setSyncStatus("Syncing…");

        // Replace this URL with your actual backend endpoint
        const response = await fetch("https://your-backend.com/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: data.rating,
            timestamp: data.timestamp,
            appVersion: "1.0.0",
          }),
        });

        if (response.ok) {
          localStorage.setItem(
            RATING_STORAGE_KEY,
            JSON.stringify({
              ...data,
              pendingSync: false,
            }),
          );
          setSyncStatus("Rating submitted. Thank you!");
        } else {
          setSyncStatus("Sync failed. Will retry later.");
        }
      } catch {
        setSyncStatus("Sync failed. Will retry later.");
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

    // Save locally immediately
    localStorage.setItem(
      RATING_STORAGE_KEY,
      JSON.stringify({
        rating: star,
        timestamp: new Date().toISOString(),
        pendingSync: true,
      }),
    );

    setSyncStatus("Saved. Will submit when online.");
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
              href="https://www.buymeacoffee.com/yourhandle"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.supportLink}
            >
              <FaCoffee style={{ marginRight: 6 }} />
              Support Development
            </a>
          </div>
        )}

        {syncStatus && <p className={styles.syncStatus}>{syncStatus}</p>}
      </div>
    </div>
  );
};

export default RateUsScreen;
