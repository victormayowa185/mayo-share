import React, { useState, useRef } from 'react';
import styles from '../../styles/screens/P2PSession.module.css';

interface Props {
  onBack: () => void;
}

interface QueueFile {
  id: string;
  name: string;
  path: string | null;
  size: number;
  status: 'queued' | 'transferring' | 'done' | 'cancelled';
  progress: number;
  source: 'file' | 'text';
  textData?: string;
}

interface ReceiveEntry {
  name: string;
  size: number;
  path: string;
  received: number;
}

const formatBytes = (b: number) => {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

const P2PSession: React.FC<Props> = ({ onBack }) => {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');
  const [sessionStatus, setSessionStatus] = useState('');
  const [connected, setConnected] = useState(false);
  const [offerCode, setOfferCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [answerInput, setAnswerInput] = useState('');
  const [offerInput, setOfferInput] = useState('');
  const [fileQueue, setFileQueue] = useState<QueueFile[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [receiveMap, setReceiveMap] = useState<Record<string, ReceiveEntry>>({});

  const localPC = useRef<RTCPeerConnection | null>(null);
  const localDC = useRef<RTCDataChannel | null>(null);

  const showFileArea = () => setConnected(true);

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
      const { id, data, offset, totalSize } = msg;
      setReceiveMap(prev => {
        const entry = prev[id];
        if (!entry) return prev;
        const decodedLen = atob(data).length;
        return { ...prev, [id]: { ...entry, received: offset + decodedLen } };
      });
      await window.electronAPI.appendReceiveChunk(`C:\\mayo-received\\${receiveMap[msg.id]?.name || ''}`, data);
      await window.electronAPI.saveResumeState(msg.id, msg.offset + atob(data).length, `C:\\mayo-received\\${receiveMap[msg.id]?.name || ''}`);
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

  const createSession = async () => {
    setMode('create');
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      localPC.current = pc;

      const dc = pc.createDataChannel('mayo-share', { ordered: true });
      localDC.current = dc;
      dc.onopen = () => { setSessionStatus('Connected! Data channel open.'); showFileArea(); };
      dc.onmessage = e => handleDCMessage(e.data);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForICE(pc);

      const compact = await window.electronAPI.compressSDP(pc.localDescription!.sdp);
      setOfferCode(compact);
    } catch (err: any) {
      setSessionStatus('Error: ' + err.message);
    }
  };

  const submitAnswer = async () => {
    if (!answerInput.trim() || !localPC.current) return;
    try {
      const sdp = await window.electronAPI.decompressSDP(answerInput.trim());
      await localPC.current.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
      setSessionStatus('Answer accepted – connecting...');
    } catch (err: any) {
      setSessionStatus('Invalid answer: ' + err.message);
    }
  };

  const processOffer = async () => {
    if (!offerInput.trim()) return;
    setMode('join');
    try {
      const sdp = await window.electronAPI.decompressSDP(offerInput.trim());
      const pc = new RTCPeerConnection({ iceServers: [] });
      localPC.current = pc;

      pc.ondatachannel = event => {
        const dc = event.channel;
        localDC.current = dc;
        dc.onopen = () => { setSessionStatus('Connected! Data channel open.'); showFileArea(); };
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

  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: QueueFile[] = await Promise.all(paths.map(async p => ({
      id: Date.now().toString() + Math.random(),
      name: p.split('\\').pop() || p,
      path: p,
      size: await window.electronAPI.getFileSize(p),
      status: 'queued' as const,
      progress: 0,
      source: 'file' as const,
    })));
    setFileQueue(prev => [...prev, ...newFiles]);
  };

  const pasteText = async () => {
    const text = await navigator.clipboard.readText().catch(() => '');
    if (!text.trim()) { setSessionStatus('Clipboard is empty.'); return; }
    const name = `pasted-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const encoded = btoa(unescape(encodeURIComponent(text)));
    setFileQueue(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      name, path: null,
      size: new Blob([text]).size,
      status: 'queued', progress: 0,
      source: 'text', textData: encoded,
    }]);
  };

  const removeFile = (id: string) => {
    setFileQueue(prev => prev.filter(f => f.id !== id));
  };

  const sendAll = async () => {
    if (!localDC.current || localDC.current.readyState !== 'open') {
      setSessionStatus('Data channel not open.'); return;
    }
    setIsSending(true);

    for (const file of fileQueue) {
      if (file.status === 'done' || file.status === 'cancelled') continue;

      setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: 'transferring' } : f));

      if (file.source === 'text') {
        localDC.current.send(JSON.stringify({ type: 'file-start', id: file.id, name: file.name, size: file.size, resumable: false }));
        localDC.current.send(JSON.stringify({ type: 'file-chunk', id: file.id, data: file.textData, offset: 0, totalSize: file.size }));
        localDC.current.send(JSON.stringify({ type: 'file-end', id: file.id }));
      } else {
        const resumeState = await window.electronAPI.getResumeState(file.id);
        const startOffset = resumeState ? resumeState.offset : 0;
        localDC.current.send(JSON.stringify({ type: 'file-start', id: file.id, name: file.name, size: file.size, resumable: true, fromOffset: startOffset }));

        const CHUNK = 64 * 1024;
        let offset = startOffset;
        while (offset < file.size) {
          const chunkSize = Math.min(CHUNK, file.size - offset);
          const base64 = await window.electronAPI.readFileChunk(file.path!, offset, chunkSize);
          localDC.current.send(JSON.stringify({ type: 'file-chunk', id: file.id, data: base64, offset, totalSize: file.size }));
          offset += chunkSize;
          const progress = Math.round((offset / file.size) * 100);
          setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, progress } : f));
          await new Promise(r => setTimeout(r, 1));
        }
        localDC.current.send(JSON.stringify({ type: 'file-end', id: file.id }));
        await window.electronAPI.clearResumeState(file.id);
      }

      setFileQueue(prev => prev.map(f => f.id === file.id ? { ...f, status: 'done' } : f));
    }

    setIsSending(false);
    setSessionStatus('All files sent!');
  };

  return (
    <div className={styles.container}>
      <button className={styles.backBtn} onClick={onBack}>← Back</button>
      <h2 className={styles.title}>Device Connect</h2>

      {/* Mode selection */}
      {mode === 'choose' && !connected && (
        <div className={styles.modeRow}>
          <button className={styles.btn} onClick={createSession}>Create Session</button>
          <button className={styles.ghostBtn} onClick={() => setMode('join')}>Join Session</button>
        </div>
      )}

      {/* Offerer — show offer code */}
      {mode === 'create' && !connected && (
        <div className={styles.codePanel}>
          <p className={styles.label}>Your session code — share with the other device:</p>
          {offerCode ? (
            <>
              <textarea className={styles.codeBox} readOnly value={offerCode} rows={4} />
              <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(offerCode)}>Copy Code</button>
              <p className={styles.label} style={{ marginTop: 24 }}>Paste the answer code from the other device:</p>
              <textarea className={styles.codeBox} value={answerInput} onChange={e => setAnswerInput(e.target.value)} placeholder="Paste answer code here" rows={4} />
              <button className={styles.btn} onClick={submitAnswer}>Submit Answer</button>
            </>
          ) : (
            <div className={styles.spinner} />
          )}
        </div>
      )}

      {/* Joiner — paste offer code */}
      {mode === 'join' && !connected && (
        <div className={styles.codePanel}>
          <p className={styles.label}>Paste the offer code from the other device:</p>
          <textarea className={styles.codeBox} value={offerInput} onChange={e => setOfferInput(e.target.value)} placeholder="Paste offer code here" rows={4} />
          <button className={styles.btn} onClick={processOffer}>Process Offer</button>
          {answerCode && (
            <>
              <p className={styles.label} style={{ marginTop: 24 }}>Your answer code — give this back:</p>
              <textarea className={styles.codeBox} readOnly value={answerCode} rows={4} />
              <button className={styles.copyBtn} onClick={() => navigator.clipboard.writeText(answerCode)}>Copy Code</button>
            </>
          )}
        </div>
      )}

      {/* Status */}
      {sessionStatus && (
        <div className={`${styles.status} ${sessionStatus.includes('Error') ? styles.error : ''}`}>
          {sessionStatus}
        </div>
      )}

      {/* Connected file area */}
      {connected && (
        <div className={styles.fileArea}>
          <div className={styles.connectedBadge}>🟢 Connected</div>

          <div className={styles.actionRow}>
            <button className={styles.btn} onClick={addFiles} disabled={isSending}>Add Files</button>
            <button className={styles.btn} onClick={pasteText} disabled={isSending} style={{ background: '#333' }}>Paste Text</button>
            <button className={styles.sendBtn} onClick={sendAll} disabled={fileQueue.length === 0 || isSending}>
              {isSending ? 'Sending...' : 'Send All'}
            </button>
          </div>

          {/* Send queue */}
          {fileQueue.length > 0 && (
            <div className={styles.queue}>
              {fileQueue.map(f => (
                <div key={f.id} className={styles.queueItem}>
                  <span className={styles.queueName}>{f.name}</span>
                  <span className={styles.queueSize}>{formatBytes(f.size)}</span>
                  <span className={styles.queueStatus}>
                    {f.status === 'transferring' ? `${f.progress}%` : `[${f.status}]`}
                  </span>
                  {f.status !== 'transferring' && f.status !== 'done' && (
                    <button className={styles.removeBtn} onClick={() => removeFile(f.id)}>❌</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Incoming files */}
          {Object.keys(receiveMap).length > 0 && (
            <div className={styles.incomingSection}>
              <p className={styles.label}>Receiving files...</p>
              {Object.entries(receiveMap).map(([id, entry]) => (
                <div key={id} className={styles.queueItem}>
                  <span className={styles.queueName}>{entry.name}</span>
                  <progress value={entry.received} max={entry.size} className={styles.progress} />
                  <span className={styles.queueStatus}>
                    {Math.round((entry.received / entry.size) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default P2PSession;