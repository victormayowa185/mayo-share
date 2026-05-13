import React, { useState, useRef } from 'react';
import { FaArrowLeft, FaCheckCircle, FaCircle } from 'react-icons/fa';
import { FaLink } from 'react-icons/fa6';
import { VscGlobe } from 'react-icons/vsc';
import { MdGetApp } from 'react-icons/md';
import ReceiveFromBrowser from '../ReceiveFromBrowser/ReceiveFromBrowser.tsx';
import styles from '../../styles/screens/ReceiveScreen.module.css';

interface Props {
  onBack: () => void;
}

interface ReceiveEntry {
  name: string;
  size: number;
  path: string;
  received: number;
}

const ReceiveScreen: React.FC<Props> = ({ onBack }) => {
  const [mode, setMode] = useState<'choose' | 'p2p' | 'quick' | 'browser'>('choose');
  const [offerInput, setOfferInput] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [quickUrl, setQuickUrl] = useState('');
  const [sessionStatus, setSessionStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>({});

  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);

  const handleDCMessage = async (raw: string) => {
    let msg: any;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'file-start') {
      const { id, name, size, resumable, fromOffset } = msg;
      const savePath = `C:\\mayo-received\\${name}`;
      if (resumable && fromOffset > 0) {
        setReceiveMap(prev => ({ ...prev, [id]: { name, size, path: savePath, received: fromOffset } }));
      } else {
        await window.electronAPI.createReceiveFile(savePath);
        setReceiveMap(prev => ({ ...prev, [id]: { name, size, path: savePath, received: 0 } }));
      }
      await window.electronAPI.saveResumeState(id, fromOffset || 0, savePath);
    }

    if (msg.type === 'file-chunk') {
      const { id, data, offset } = msg;
      const entry = receiveMap[id];
      if (!entry) return;
      await window.electronAPI.appendReceiveChunk(entry.path, data);
      const decodedLen = atob(data).length;
      const newReceived = offset + decodedLen;
      setReceiveMap(prev => ({ ...prev, [id]: { ...prev[id], received: newReceived } }));
      await window.electronAPI.saveResumeState(id, newReceived, entry.path);
    }

    if (msg.type === 'file-end') {
      const { id } = msg;
      setSessionStatus(`File received: ${receiveMap[id]?.name || ''}`);
      await window.electronAPI.clearResumeState(id);
      setReceiveMap(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  };

  const waitForICE = (pc: RTCPeerConnection) =>
    Promise.race([
      new Promise<void>(resolve => {
        if (pc.iceGatheringState === 'complete') resolve();
        else pc.addEventListener('icegatheringstatechange', () => {
          if (pc.iceGatheringState === 'complete') resolve();
        });
      }),
      new Promise<void>(resolve => setTimeout(resolve, 10000)),
    ]);

  const processOffer = async () => {
    if (!offerInput.trim()) return;
    try {
      const sdp = await window.electronAPI.decompressSDP(offerInput.trim());
      const pc = new RTCPeerConnection({ iceServers: [] });
      localPC.current = pc;

      pc.ondatachannel = event => {
        const dc = event.channel;
        localDC.current = dc;
        dc.onopen = () => { setSessionStatus('Connected! Ready to receive.'); setConnected(true); };
        dc.onmessage = e => handleDCMessage(e.data);
      };

      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForICE(pc);

      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      setAnswerCode(compact);
    } catch (err: any) {
      setSessionStatus('Error: ' + err.message);
    }
  };

  const openQuickLink = () => {
    if (quickUrl.trim()) window.open(quickUrl.trim(), '_blank');
  };

  return (
    <div className={styles.container}>
      {/* Outer back arrow – hidden when browser mode is active */}
      {mode !== 'browser' && (
        <button className={styles.backBtn} onClick={onBack}>
          <FaArrowLeft style={{ marginRight: 6 }} /> Back
        </button>
      )}
      <h2 className={styles.title}>Receive Files</h2>

      {/* ── Mode chooser ── */}
      {mode === 'choose' && (
        <div className={styles.modeCards}>
          <div className={styles.modeCard} onClick={() => setMode('p2p')}>
            <div className={styles.cardEmoji}>
              <FaLink size={36} />
            </div>
            <div className={styles.cardTitle}>Join Device Connect</div>
            <div className={styles.cardDesc}>
              Accept files from a MAYO Share session. Paste the offer code from the sender.
            </div>
          </div>

          <div className={styles.modeCard} onClick={() => setMode('quick')}>
            <div className={styles.cardEmoji}>
              <VscGlobe size={36} />
            </div>
            <div className={styles.cardTitle}>Open Quick Share Link</div>
            <div className={styles.cardDesc}>
              Download a file shared via Quick Share. Enter the URL or scan the QR code.
            </div>
          </div>

          <div className={styles.modeCard} onClick={() => setMode('browser')}>
            <div className={styles.cardEmoji}>
              <MdGetApp size={36} />
            </div>
            <div className={styles.cardTitle}>Receive from Browser</div>
            <div className={styles.cardDesc}>
              Let a phone or any device send files TO this laptop. No app needed on their side.
            </div>
          </div>
        </div>
      )}

      {/* ── P2P join ── */}
      {mode === 'p2p' && (
        <div className={styles.panel}>
          {!connected ? (
            <>
              <p className={styles.label}>Paste the offer code from the sender:</p>
              <textarea
                className={styles.codeBox}
                value={offerInput}
                onChange={e => setOfferInput(e.target.value)}
                placeholder="Paste offer code here"
                rows={4}
              />
              <button className={styles.btn} onClick={processOffer}>Process Offer</button>

              {answerCode && (
                <>
                  <p className={styles.label} style={{ marginTop: 24 }}>
                    Your answer code — give this back to the sender:
                  </p>
                  <textarea className={styles.codeBox} readOnly value={answerCode} rows={4} />
                  <button
                    className={styles.copyBtn}
                    onClick={() => navigator.clipboard.writeText(answerCode)}
                  >
                    Copy Code
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div className={styles.connectedBadge}>
                <FaCircle size={12} color="#4CAF50" style={{ marginRight: 6 }} />
                Connected — waiting for files
              </div>
              {Object.entries(receiveMap).map(([id, entry]) => (
                <div key={id} className={styles.fileRow}>
                  <span className={styles.fileName}>{entry.name}</span>
                  <progress value={entry.received} max={entry.size} className={styles.progress} />
                  <span className={styles.pct}>
                    {Math.round((entry.received / entry.size) * 100)}%
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Quick Share link ── */}
      {mode === 'quick' && (
        <div className={styles.panel}>
          <p className={styles.label}>Enter the Quick Share URL:</p>
          <input
            className={styles.urlInput}
            type="text"
            value={quickUrl}
            onChange={e => setQuickUrl(e.target.value)}
            placeholder="http://192.168.137.2:3000"
          />
          <button className={styles.btn} onClick={openQuickLink}>Open Link</button>
          <p className={styles.hint}>Or scan the QR code on the sender's screen with your browser.</p>
          <button className={styles.backBtn} style={{ marginTop: 24 }} onClick={() => setMode('choose')}>
            ← Back
          </button>
        </div>
      )}

      {/* ── Receive from Browser ── */}
      {mode === 'browser' && (
        <ReceiveFromBrowser onBack={() => setMode('choose')} />
      )}

      {/* ── Status ── */}
      {sessionStatus && (
        <div className={`${styles.status} ${sessionStatus.includes('Error') ? styles.error : ''}`}>
          {sessionStatus.includes('File received') ? (
            <><FaCheckCircle style={{ marginRight: 6, color: '#4CAF50' }} />{sessionStatus}</>
          ) : sessionStatus}
        </div>
      )}
    </div>
  );
};

export default ReceiveScreen;