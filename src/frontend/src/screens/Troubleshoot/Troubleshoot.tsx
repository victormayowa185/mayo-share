import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  FaCheckCircle,
  FaTimesCircle,
  FaWrench,
  FaNetworkWired,
  FaShieldAlt,
} from 'react-icons/fa';
import BackButton from '../../components/BackButton';
import styles from "../../styles/screens/Troubleshoot.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
}

interface NetworkDiagnosis {
  ssid: string | null;
  profileCategory: string | null;
  loopbackAdapterPresent: boolean;
  port3001Listening: boolean;
}

const TroubleshootScreen: React.FC<Props> = ({ onBack }) => {
  const { t } = useTranslation();

  const [firewallStatus, setFirewallStatus] = useState<'idle' | 'working' | 'success' | 'error' | 'needsAdmin'>('idle');
  const [firewallMessage, setFirewallMessage] = useState('');
  const [diagnosisResult, setDiagnosisResult] = useState<NetworkDiagnosis | null>(null);
  const [diagnosisWorking, setDiagnosisWorking] = useState(false);

  const cardsRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (cardsRef.current) {
      const cards = cardsRef.current.querySelectorAll(`.${styles.card}`);
      gsap.fromTo(
        cards,
        { opacity: 0, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.35,
          stagger: 0.12,
          ease: 'power2.out',
        },
      );
    }
  }, []);

  const handleFixFirewall = async () => {
    setFirewallStatus('working');
    setFirewallMessage('');
    try {
      const result = await window.electronAPI.fixFirewall();
      if (result.success) {
        setFirewallStatus('success');
        setFirewallMessage(result.output || t('firewallRuleAdded'));
      } else {
        if (result.error && result.error.includes('administrator')) {
          setFirewallStatus('needsAdmin');
          setFirewallMessage(t('runAsAdmin'));
        } else {
          setFirewallStatus('error');
          setFirewallMessage(result.error || t('firewallRuleFailed'));
        }
      }
    } catch (err: any) {
      setFirewallStatus('error');
      setFirewallMessage(err.message || t('unexpectedError'));
    }
  };

  const handleDiagnoseNetwork = async () => {
    setDiagnosisWorking(true);
    try {
      const diagnosis = await window.electronAPI.diagnoseNetwork();
      setDiagnosisResult(diagnosis);
    } catch (err: any) {
      setDiagnosisResult(null);
    } finally {
      setDiagnosisWorking(false);
    }
  };

  // The ✅/❌ live inside the translation strings — strip them so we can show a
  // crisp React icon instead of an emoji.
  const stripEmoji = (s: string) => s.replace(/[✅❌]/g, "").trim();

  const renderStatus = (ok: boolean, okKey: string, badKey: string) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: ok ? "#4CAF50" : "#f44336",
        fontWeight: 600,
      }}
    >
      {ok ? <FaCheckCircle size={14} /> : <FaTimesCircle size={14} />}
      {stripEmoji(t(ok ? okKey : badKey))}
    </span>
  );

  const Dots = () => (
    <span className={styles.dots} role="status" aria-label={t('working')}>
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />

      <h2 className={styles.title}>{t('troubleshoot')}</h2>
      <p className={styles.subtitle}>{t('troubleshootSubtitle')}</p>

      <div ref={cardsRef}>
        {/* ── Firewall Auto‑Fix ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <FaShieldAlt size={20} color="#7C3EFF" />
            <h3>{t('firewallAutoFix')}</h3>
          </div>
          <p className={styles.cardDesc}>{t('firewallAutoFixDesc')}</p>
          <button
            className={styles.btn}
            onClick={handleFixFirewall}
            disabled={firewallStatus === 'working'}
          >
             {firewallStatus === 'working' ? <Dots /> : t('fixFirewall')}

          </button>
          {firewallStatus === 'success' && (
            <div className={styles.successMsg}>
              <FaCheckCircle style={{ marginRight: 6 }} /> {firewallMessage}
            </div>
          )}
          {firewallStatus === 'error' && (
            <div className={styles.errorMsg}>
              <FaTimesCircle style={{ marginRight: 6 }} /> {firewallMessage}
            </div>
          )}
          {firewallStatus === 'needsAdmin' && (
            <div className={styles.adminHint}>
              <FaTimesCircle style={{ marginRight: 6 }} /> {t('runAsAdmin')}
            </div>
          )}
        </div>

        {/* ── Network & Port Status Checker ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <FaNetworkWired size={20} color="#7C3EFF" />
            <h3>{t('networkPortStatus')}</h3>
          </div>
          <p className={styles.cardDesc}>{t('networkPortStatusDesc')}</p>
          <button
            className={styles.btn}
            onClick={handleDiagnoseNetwork}
            disabled={diagnosisWorking}
          >
                      {diagnosisWorking ? <Dots /> : t('runDiagnostics')}

          </button>
          {diagnosisResult && (
            <div className={styles.diagnosisResult}>
              <p><strong>{t('wifiSSID')}:</strong> {diagnosisResult.ssid || t('notConnected')}</p>
              <p><strong>{t('networkCategory')}:</strong> {diagnosisResult.profileCategory || t('unknown')}</p>
              <p>
                <strong>{t('loopbackAdapter')}:</strong>{' '}
                {renderStatus(diagnosisResult.loopbackAdapterPresent, 'present', 'notFound')}
              </p>
              <p>
                <strong>{t('port3001')}:</strong>{' '}
                {renderStatus(diagnosisResult.port3001Listening, 'listening', 'notListening')}
              </p>

            </div>
          )}
        </div>

        {/* ── Smart Fallback Advice ── */}
        {diagnosisResult && diagnosisResult.profileCategory?.toLowerCase() === 'public' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <FaWrench size={20} color="#7C3EFF" />
              <h3>{t('smartAdvice')}</h3>
            </div>
            <p className={styles.cardDesc}>
              {t('publicNetworkAdvice')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TroubleshootScreen;