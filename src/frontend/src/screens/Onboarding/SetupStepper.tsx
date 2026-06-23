import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  FaArrowLeft,
  FaCheckCircle,
  FaTimesCircle,
  FaArrowRight,
  FaExclamationTriangle,
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
    "idle" | "checking" | "ok" | "fail" | "no-admin"
  >("idle");
  const [wizardError, setWizardError] = useState<string | null>(null);

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
    try {
      const result = await window.electronAPI.launchHardwareWizard();
      if (!result.success) {
        setWizardError(result.error || t("unknownError"));
        setTimeout(() => setWizardError(null), 5000);
      }
    } catch (err: any) {
      setWizardError(err.message || t("unknownError"));
      setTimeout(() => setWizardError(null), 5000);
    }
  };

  /**
   * Verify the loopback adapter is installed using the lightweight
   * diagnose-network IPC — this does NOT require admin privileges.
   * Previously the code called startHotspot which ran a PowerShell script
   * that requires Administrator and would always fail if the app isn't
   * elevated, showing "Not running as Administrator" even when the adapter
   * was correctly installed.
   */
  const verifySetup = async () => {
    setVerifyStatus("checking");
    try {
      // 1. Try the lightweight diagnosis first
      const diagnosis = await window.electronAPI.diagnoseNetwork();

      if (diagnosis.loopbackAdapterPresent) {
        setVerifyStatus("ok");
        return;
      }

      // 2. Fallback: If diagnosis says no, try to actually query the hotspot script 
      // but parse the result manually for keywords
      const result = await window.electronAPI.startHotspot();
      if (
        result.includes("SUCCESS") ||
        result.includes("Loopback") ||
        result.includes("Using adapter") ||
        result.includes("KM-TEST")
      ) {
        setVerifyStatus("ok");
      } else if (result.includes("Not running as Administrator")) {
        // If the only error is Admin, but it found the adapter name earlier in the log, it's okay!
        if (result.toLowerCase().includes("loopback") || result.toLowerCase().includes("km-test")) {
          setVerifyStatus("no-admin");
        } else {
          setVerifyStatus("fail");
        }
      } else {
        setVerifyStatus("fail");
      }
    } catch (err: any) {
      setVerifyStatus("fail");
    }
  };

  const goBack = () => setCurrentStep((prev) => prev - 1);

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;
  const verifyPassed = verifyStatus === "ok" || verifyStatus === "no-admin";

  const Dots = () => (
    <span className={styles.dots} role="status" aria-label={t("checking")}>
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );

  return (

    <div className={styles.container}>


      <div className={styles.logo}>
        <span className={styles.logoIcon}></span>
        <span className={styles.logoText}>
          <span className={styles.logoMayo}>MAYO</span> Share
        </span>
      </div>



      <div className={styles.subtitle}>{t("firstTimeSetup")}</div>

      <div className={styles.steps} ref={stepsIndicatorRef}>
        {steps.map((_, i) => (
          <div
            key={i}
            className={styles.stepDot}
            role="status"
            aria-label={t("stepXofY", { current: i + 1, total: steps.length })}
            style={{ background: i <= currentStep ? "var(--accent)" : "#333" }}

          />
        ))}
      </div>

      <div className={styles.card} ref={cardRef}>
        <div className={styles.stepNumber}>
          {t("stepXofY", { current: currentStep + 1, total: steps.length })}
        </div>
        <h2 className={styles.title}>{t(step.titleKey)}</h2>
        <p className={styles.instruction}>{t(step.instructionKey)}</p>
        <p className={styles.note}>{t(step.noteKey)}</p>

        {currentStep === 0 && (
          <>
            <button onClick={launchWizard} className={styles.btn}>
              {t("openHardwareWizard")}
            </button>
            {wizardError && (
              <div className={styles.errorMsg} role="alert">
                <FaTimesCircle aria-hidden="true" style={{ marginRight: 8 }} />
                {wizardError}
              </div>
            )}
          </>
        )}

        {isLastStep && (
          <div>
            <button
              onClick={verifySetup}
              className={styles.btn}
              disabled={verifyStatus === "checking"}
            >
                 {verifyStatus === "checking" ? <Dots /> : t("verifySetup")}

            </button>

            {verifyStatus === "ok" && (
              <div className={styles.successMsg}>
                <FaCheckCircle aria-hidden="true" style={{ marginRight: 8 }} />{" "}
                {t("setupComplete")}
              </div>
            )}

            {/* Adapter found but app needs admin to start hotspot — still let them proceed */}
            {verifyStatus === "no-admin" && (
              <div className={styles.successMsg} style={{ color: "#f0a500" }}>
                <FaCheckCircle aria-hidden="true" style={{ marginRight: 8 }} />{" "}
                Loopback adapter found! To use the offline hotspot, run MAYO Share as Administrator.
                You can still use P2P and Wi-Fi sharing without admin.
              </div>
            )}

            {verifyStatus === "fail" && (
              <div className={styles.failMsg}>
                <FaTimesCircle aria-hidden="true" style={{ marginRight: 8 }} />{" "}
                {t("adapterNotFound")}
                <p style={{ fontSize: "0.85rem", marginTop: 6, color: "var(--text-secondary)" }}>
                  Make sure you selected <strong>Microsoft KM-TEST Loopback Adapter</strong> in the Hardware Wizard (Step 1). After installing, click Verify again.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

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
        {isLastStep && verifyPassed && (
          <button
            onClick={onComplete}
            className={styles.btn}
            style={{ background: "#4CAF50" }}
          >
            {t("enterMayoShare")} <FaArrowRight aria-hidden="true" style={{ marginLeft: 6 }} />
          </button>
        )}
        {!(isLastStep && verifyPassed) && (
          <button onClick={onComplete} className={styles.ghostBtn}>
            {t("skipForNow")}
          </button>
        )}
      </div>
    </div>
  );
};

export default SetupStepper;