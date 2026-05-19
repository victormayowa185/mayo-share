import React, { useState } from "react";
import { FaArrowLeft, FaCheckCircle, FaTimesCircle, FaArrowRight } from "react-icons/fa";
import styles from "../../styles/screens/SetupStepper.module.css";

interface Props {
  onComplete: () => void;
}

const steps = [
  {
    title: "Open Add Hardware Wizard",
    instruction:
      "Click the button below. A hardware wizard will open automatically.",
    note: 'When it opens, click "Next" to continue.',
  },
  {
    title: "Select Hardware Type",
    instruction:
      'In the wizard, choose "Install the hardware that I manually select from a list", then click Next.',
    note: 'Scroll down and select "Network adapters", then click Next.',
  },
  {
    title: "Select the Loopback Adapter",
    instruction:
      'In the Manufacturer list, select "Microsoft". In the Model list, select "Microsoft KM-TEST Loopback Adapter".',
    note: "Click Next, then Finish.",
  },
  {
    title: "Verify Setup",
    instruction:
      "Click the button below to check if the adapter was installed correctly.",
    note: "You should see a green checkmark if everything is ready.",
  },
];

const SetupStepper: React.FC<Props> = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [verifyStatus, setVerifyStatus] = useState<
    "idle" | "checking" | "ok" | "fail"
  >("idle");

  const launchWizard = async () => {
    try {
      await window.electronAPI.startHotspot(); // placeholder
    } catch {
      // ignore
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
      <div className={styles.logo}>🦅 MAYO Share</div>
      <div className={styles.subtitle}>First-time setup</div>

      {/* Step indicator */}
      <div className={styles.steps}>
        {steps.map((_, i) => (
          <div
            key={i}
            className={styles.stepDot}
            style={{ background: i <= currentStep ? "#0066FF" : "#333" }}
          />
        ))}
      </div>

      {/* Card */}
      <div className={styles.card}>
        <div className={styles.stepNumber}>
          Step {currentStep + 1} of {steps.length}
        </div>
        <h2 className={styles.title}>{step.title}</h2>
        <p className={styles.instruction}>{step.instruction}</p>
        <p className={styles.note}>{step.note}</p>

        {currentStep === 0 && (
          <button onClick={launchWizard} className={styles.btn}>
            Open Hardware Wizard
          </button>
        )}

        {isLastStep && (
          <div>
            <button
              onClick={verifySetup}
              className={styles.btn}
              disabled={verifyStatus === "checking"}
            >
              {verifyStatus === "checking" ? "Checking..." : "Verify Setup"}
            </button>
            {verifyStatus === "ok" && (
              <div className={styles.successMsg}>
                <FaCheckCircle style={{ marginRight: 8 }} /> Setup complete! You
                are ready to use MAYO Share.
              </div>
            )}
            {verifyStatus === "fail" && (
              <div className={styles.failMsg}>
                <FaTimesCircle style={{ marginRight: 8 }} /> Adapter not found.
                Please go back and repeat the steps.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className={styles.navRow}>
        {currentStep > 0 && (
          <button className={styles.btn} onClick={goBack}>
            <FaArrowLeft style={{ marginRight: 6 }} /> Back
          </button>
        )}
        {!isLastStep && (
          <button
            onClick={() => setCurrentStep((s) => s + 1)}
            className={styles.btn}
          >
            Next <FaArrowRight style={{ marginLeft: 6 }} />
          </button>
        )}
        {isLastStep && verifyStatus === "ok" && (
          <button
            onClick={onComplete}
            className={styles.btn}
            style={{ background: "#4CAF50" }}
          >
            Enter MAYO Share <FaArrowRight style={{ marginLeft: 6 }} />
          </button>
        )}
        <button onClick={onComplete} className={styles.ghostBtn}>
          Skip for now
        </button>
      </div>
    </div>
  );
};

export default SetupStepper;
