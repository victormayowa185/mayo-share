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

  return (
    <div className={styles.container}>
      <BackButton onClick={onBack} />
      <h2 className={styles.title}>{t('troubleshoot')}</h2>
      <p className={styles.subtitle}>{t('troubleshootSubtitle')}</p>

      <div ref={cardsRef}>
        {/* ── Firewall Auto‑Fix ── */}
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <FaShieldAlt size={20} color="#b169e0" />
            <h3>{t('firewallAutoFix')}</h3>
          </div>
          <p className={styles.cardDesc}>{t('firewallAutoFixDesc')}</p>
          <button
            className={styles.btn}
            onClick={handleFixFirewall}
            disabled={firewallStatus === 'working'}
          >
            {firewallStatus === 'working' ? t('working') : t('fixFirewall')}
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
            <FaNetworkWired size={20} color="#b169e0" />
            <h3>{t('networkPortStatus')}</h3>
          </div>
          <p className={styles.cardDesc}>{t('networkPortStatusDesc')}</p>
          <button
            className={styles.btn}
            onClick={handleDiagnoseNetwork}
            disabled={diagnosisWorking}
          >
            {diagnosisWorking ? t('checking') : t('runDiagnostics')}
          </button>
          {diagnosisResult && (
            <div className={styles.diagnosisResult}>
              <p><strong>{t('wifiSSID')}:</strong> {diagnosisResult.ssid || t('notConnected')}</p>
              <p><strong>{t('networkCategory')}:</strong> {diagnosisResult.profileCategory || t('unknown')}</p>
              <p>
                <strong>{t('loopbackAdapter')}:</strong>{' '}
                {diagnosisResult.loopbackAdapterPresent ? t('present') : t('notFound')}
              </p>
              <p>
                <strong>{t('port3001')}:</strong>{' '}
                {diagnosisResult.port3001Listening ? t('listening') : t('notListening')}
              </p>
            </div>
          )}
        </div>

        {/* ── Smart Fallback Advice ── */}
        {diagnosisResult && diagnosisResult.profileCategory?.toLowerCase() === 'public' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <FaWrench size={20} color="#b169e0" />
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