import React, { useState } from 'react';
import { FaCheckCircle, FaTimesCircle, FaWrench, FaNetworkWired, FaShieldAlt } from 'react-icons/fa';
import BackButton from '../../components/BackButton';
import styles from '../../styles/screens/Troubleshoot.module.css';

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
  const [firewallStatus, setFirewallStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [firewallMessage, setFirewallMessage] = useState('');
  const [diagnosisResult, setDiagnosisResult] = useState<NetworkDiagnosis | null>(null);
  const [diagnosisWorking, setDiagnosisWorking] = useState(false);

  const handleFixFirewall = async () => {
    setFirewallStatus('working');
    setFirewallMessage('');
    try {
      const result = await window.electronAPI.fixFirewall();
      if (result.success) {
        setFirewallStatus('success');
        setFirewallMessage(result.output || 'Firewall rule added successfully.');
      } else {
        setFirewallStatus('error');
        setFirewallMessage(result.error || 'Failed to add firewall rule.');
      }
    } catch (err: any) {
      setFirewallStatus('error');
      setFirewallMessage(err.message || 'An unexpected error occurred.');
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
      <h2 className={styles.title}>Troubleshoot</h2>
      <p className={styles.subtitle}>Diagnose and fix common connection issues.</p>

      {/* ── Firewall Auto‑Fix ── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <FaShieldAlt size={20} color="#b169e0" />
          <h3>Firewall Auto‑Fix</h3>
        </div>
        <p className={styles.cardDesc}>
          Windows Firewall may block incoming connections on ports 3000 and 3001. Click the button to automatically add the required rule.
        </p>
        <button
          className={styles.btn}
          onClick={handleFixFirewall}
          disabled={firewallStatus === 'working'}
        >
          {firewallStatus === 'working' ? 'Working…' : 'Fix Firewall'}
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
      </div>

      {/* ── Network & Port Status Checker ── */}
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <FaNetworkWired size={20} color="#b169e0" />
          <h3>Network & Port Status</h3>
        </div>
        <p className={styles.cardDesc}>
          Check your current network environment and whether the server ports are listening.
        </p>
        <button
          className={styles.btn}
          onClick={handleDiagnoseNetwork}
          disabled={diagnosisWorking}
        >
          {diagnosisWorking ? 'Checking…' : 'Run Diagnostics'}
        </button>
        {diagnosisResult && (
          <div className={styles.diagnosisResult}>
            <p><strong>Wi‑Fi SSID:</strong> {diagnosisResult.ssid || 'Not connected'}</p>
            <p><strong>Network Category:</strong> {diagnosisResult.profileCategory || 'Unknown'}</p>
            <p>
              <strong>Loopback Adapter:</strong>{' '}
              {diagnosisResult.loopbackAdapterPresent ? '✅ Present' : '❌ Not found'}
            </p>
            <p>
              <strong>Port 3001:</strong>{' '}
              {diagnosisResult.port3001Listening ? '✅ Listening' : '❌ Not listening'}
            </p>
          </div>
        )}
      </div>

      {/* ── Smart Fallback Advice ── */}
      {diagnosisResult && diagnosisResult.profileCategory === 'Public' && (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <FaWrench size={20} color="#b169e0" />
            <h3>Smart Advice</h3>
          </div>
          <p className={styles.cardDesc}>
            You are connected to a <strong>Public</strong> network. Some networks block device‑to‑device communication. For a guaranteed connection, try using the offline hotspot:
            <br />
            <em>Receive &gt; Start Offline Hotspot</em>
          </p>
        </div>
      )}
    </div>
  );
};

export default TroubleshootScreen;  