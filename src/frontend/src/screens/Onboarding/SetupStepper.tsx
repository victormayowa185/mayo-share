import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  FaArrowLeft,
  FaCheckCircle,
  FaTimesCircle,
  FaArrowRight,
} from "react-icons/fa";
import styles from "../../styles/screens/SetupStepper.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onComplete: () => void;
}

const SetupStepper: React.FC<Props> = ({ onComplete }) => {
  const { t } = useTranslation();

  const steps = [
    {
      titleKey: "step1Title",
      instructionKey: "step1Instruction",
      noteKey: "step1Note",
    },
    {
      titleKey: "step2Title",
      instructionKey: "step2Instruction",
      noteKey: "step2Note",
    },
    {
      titleKey: "step3Title",
      instructionKey: "step3Instruction",
      noteKey: "step3Note",
    },
    {
      titleKey: "step4Title",
      instructionKey: "step4Instruction",
      noteKey: "step4Note",
    },
  ];

  const [currentStep, setCurrentStep] = useState(0);
  const [verifyStatus, setVerifyStatus] = useState<
    "idle" | "checking" | "ok" | "fail"
  >("idle");

  const cardRef = useRef<HTMLDivElement>(null);
  const stepsIndicatorRef = useRef<HTMLDivElement>(null);
  const navRowRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      if (stepsIndicatorRef.current) {
        tl.fromTo(
          stepsIndicatorRef.current,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.3 },
          0,
        );
      }
      if (cardRef.current) {
        tl.fromTo(
          cardRef.current,
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.35 },
          "-=0.15",
        );
      }
      if (navRowRef.current) {
        const buttons = navRowRef.current.querySelectorAll("button");
        if (buttons.length > 0) {
          tl.fromTo(
            buttons,
            { opacity: 0, y: 6 },
            { opacity: 1, y: 0, duration: 0.25, stagger: 0.05 },
            "-=0.1",
          );
        }
      }
    },
    { dependencies: [currentStep] },
  );

  const launchWizard = async () => {
    const result = await window.electronAPI.launchHardwareWizard();
    if (!result.success) {
      alert(
        "Could not open hardware wizard: " + (result.error || "unknown error"),
      );
    }
  };

  const verifySetup = async () => {
    setVerifyStatus("checking");
    try {
      const result = await window.electronAPI.startHotspot();
      if (
        result.includes("SUCCESS") ||
        result.includes("Loopback") ||
        result.includes("Using adapter")
      ) {
        setVerifyStatus("ok");
      } else {
        setVerifyStatus("fail");
      }
    } catch {
      setVerifyStatus("fail");
    }
  };

  const goBack = () => setCurrentStep((prev) => prev - 1);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className={styles.container}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}></span>
        <span className={styles.logoText}>MAYO Share</span>
      </div>
      <div className={styles.subtitle}>{t("firstTimeSetup")}</div>

      {/* Step indicator with ARIA labels */}
      <div className={styles.steps} ref={stepsIndicatorRef}>
        {steps.map((_, i) => (
          <div
            key={i}
            className={styles.stepDot}
            role="status"
            aria-label={t("stepXofY", { current: i + 1, total: steps.length })}
            style={{ background: i <= currentStep ? "#b169e0" : "#333" }}
          />
        ))}
      </div>

      {/* Card */}
      <div className={styles.card} ref={cardRef}>
        <div className={styles.stepNumber}>
          {t("stepXofY", { current: currentStep + 1, total: steps.length })}
        </div>
        <h2 className={styles.title}>{t(step.titleKey)}</h2>
        <p className={styles.instruction}>{t(step.instructionKey)}</p>
        <p className={styles.note}>{t(step.noteKey)}</p>

        {currentStep === 0 && (
          <button onClick={launchWizard} className={styles.btn}>
            {t("openHardwareWizard")}
          </button>
        )}

        {isLastStep && (
          <div>
            <button
              onClick={verifySetup}
              className={styles.btn}
              disabled={verifyStatus === "checking"}
            >
              {verifyStatus === "checking" ? t("checking") : t("verifySetup")}
            </button>
            {verifyStatus === "ok" && (
              <div className={styles.successMsg}>
                <FaCheckCircle aria-hidden="true" style={{ marginRight: 8 }} />{" "}
                {t("setupComplete")}
              </div>
            )}
            {verifyStatus === "fail" && (
              <div className={styles.failMsg}>
                <FaTimesCircle aria-hidden="true" style={{ marginRight: 8 }} />{" "}
                {t("adapterNotFound")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className={styles.navRow} ref={navRowRef}>
        {currentStep > 0 && (
          <button className={styles.btn} onClick={goBack}>
            <FaArrowLeft aria-hidden="true" style={{ marginRight: 6 }} /> {t("back")}
          </button>
        )}
        {!isLastStep && (
          <button
            onClick={() => setCurrentStep((s) => s + 1)}
            className={styles.btn}
          >
            {t("next")} <FaArrowRight aria-hidden="true" style={{ marginLeft: 6 }} />
          </button>
        )}
        {isLastStep && verifyStatus === "ok" && (
          <button
            onClick={onComplete}
            className={styles.btn}
            style={{ background: "#4CAF50" }}
          >
            {t("enterMayoShare")} <FaArrowRight aria-hidden="true" style={{ marginLeft: 6 }} />
          </button>
        )}
        {!(isLastStep && verifyStatus === "ok") && (
          <button onClick={onComplete} className={styles.ghostBtn}>
            {t("skipForNow")}
          </button>
        )}
      </div>
    </div>
  );
};

export default SetupStepper;