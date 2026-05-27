import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FaCheckCircle,
  FaTimes,
  FaFolderOpen,
  FaQrcode,
  FaChevronDown,
  FaChevronRight,
  FaLayerGroup,
  FaPen,
} from "react-icons/fa";
import QRCode from "qrcode";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import BackButton from "../../components/BackButton";
import styles from "../../styles/screens/QuickShare.module.css";

gsap.registerPlugin(useGSAP);

interface Props {
  onBack: () => void;
  shareIP?: string;
}

interface FileEntry {
  id: string;
  path: string;
  relativePath: string;
  name: string;
  size: number;
  downloadProgress?: number;
  downloadStatus: "idle" | "downloading" | "done";
}

interface FileGroup {
  folderName: string;
  files: FileEntry[];
}

const formatBytes = (b: number) => {
  if (b === 0) return "0 B";
  const k = 1024,
    sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const QuickShare: React.FC<Props> = ({ onBack, shareIP }) => {
  const { t } = useTranslation();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [allExpanded, setAllExpanded] = useState(false);

  // Speed tracking
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const lastBytesRef = useRef<number>(0);
  const speedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shareLayoutRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const qrPanelRef = useRef<HTMLDivElement>(null);

  // Cleanup server on unmount
  useEffect(() => {
    return () => {
      window.electronAPI.stopFileServer();
    };
  }, []);

  // Listen for download events
  useEffect(() => {
    window.electronAPI.onDownloadUpdate((data) => {
      setFiles((prev) =>
        prev.map((f) =>
          f.name === data.fileName
            ? {
                ...f,
                downloadStatus:
                  data.event === "started" ? "downloading" : "done",
              }
            : f,
        ),
      );
    });
  }, []);

  // Ctrl+V paste handler
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (isSharing) return;
      e.preventDefault();

      const clipboard = e.clipboardData;
      if (!clipboard) return;

      // Case 1: files
      if (clipboard.files && clipboard.files.length > 0) {
        const newFiles: FileEntry[] = [];
        for (let i = 0; i < clipboard.files.length; i++) {
          const f = clipboard.files[i];
          const filePath = (f as any).path;
          if (filePath) {
            newFiles.push({
              id: Date.now().toString() + Math.random(),
              path: filePath,
              relativePath: f.name,
              name: f.name,
              size: f.size,
              downloadStatus: "idle",
            });
          }
        }
        if (newFiles.length > 0) {
          setFiles((prev) => [...prev, ...newFiles]);
          return;
        }
      }

      // Case 2: image
      const imageItem = Array.from(clipboard.items).find((item) =>
        item.type.startsWith("image/"),
      );
      if (imageItem) {
        const blob = imageItem.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(",")[1];
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            const fileName = `screenshot-${timestamp}.png`;
            const savedPath = await window.electronAPI.saveTempFile(
              fileName,
              base64,
            );
            const size = blob.size;
            setFiles((prev) => [
              ...prev,
              {
                id: Date.now().toString() + Math.random(),
                path: savedPath,
                relativePath: fileName,
                name: fileName,
                size,
                downloadStatus: "idle",
              },
            ]);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }

      // Case 3: text
      const text = clipboard.getData("text/plain");
      if (text && text.trim()) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `pasted-text-${timestamp}.txt`;
        const base64 = btoa(unescape(encodeURIComponent(text)));
        const savedPath = await window.electronAPI.saveTempFile(
          fileName,
          base64,
        );
        const size = new Blob([text]).size;
        setFiles((prev) => [
          ...prev,
          {
            id: Date.now().toString() + Math.random(),
            path: savedPath,
            relativePath: fileName,
            name: fileName,
            size,
            downloadStatus: "idle",
          },
        ]);
      }
    },
    [isSharing],
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const newFiles: FileEntry[] = await Promise.all(
      paths.map(async (p) => {
        const name = p.split("\\").pop() || p;
        return {
          id: Date.now().toString() + Math.random(),
          path: p,
          relativePath: name,
          name,
          size: await window.electronAPI.getFileSize(p),
          downloadStatus: "idle" as const,
        };
      }),
    );
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const addFolder = async () => {
    const folderFiles = await window.electronAPI.selectFolder();
    if (!folderFiles) return;
    const newFiles: FileEntry[] = await Promise.all(
      folderFiles.map(async (f) => {
        const name = f.absolute.split("\\").pop() || f.relative;
        return {
          id: Date.now().toString() + Math.random(),
          path: f.absolute,
          relativePath: f.relative,
          name,
          size: await window.electronAPI.getFileSize(f.absolute),
          downloadStatus: "idle" as const,
        };
      }),
    );
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  const startEditing = async (file: FileEntry) => {
    try {
      const content = await window.electronAPI.readTextFile(file.path);
      setEditingFileId(file.id);
      setEditContent(content);
    } catch (err: any) {
      alert("Could not read file: " + err.message);
    }
  };

  const saveEditing = async (file: FileEntry) => {
    try {
      await window.electronAPI.writeTextFile(file.path, editContent);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === file.id ? { ...f, size: new Blob([editContent]).size } : f,
        ),
      );
      setEditingFileId(null);
      setEditContent("");
    } catch (err: any) {
      alert("Could not save file: " + err.message);
    }
  };

  // ── Grouping logic ──────────────────────────────────
  const groupFiles = (files: FileEntry[]): FileGroup[] => {
    const groupsMap = new Map<string, FileEntry[]>();
    for (const file of files) {
      const parts = file.relativePath.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      if (!groupsMap.has(folder)) groupsMap.set(folder, []);
      groupsMap.get(folder)!.push(file);
    }
    const groups: FileGroup[] = [];
    for (const [folder, folderFiles] of groupsMap) {
      if (folder) groups.push({ folderName: folder, files: folderFiles });
    }
    const rootFiles = groupsMap.get("") || [];
    if (rootFiles.length > 0) groups.push({ folderName: "", files: rootFiles });
    return groups;
  };

  const fileGroups = groupFiles(files);
  const hasFolders = fileGroups.some((g) => g.folderName !== "");

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(folderName) ? next.delete(folderName) : next.add(folderName);
      return next;
    });
  };

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedFolders(new Set());
      setAllExpanded(false);
    } else {
      const allFolders = fileGroups
        .filter((g) => g.folderName !== "")
        .map((g) => g.folderName);
      setExpandedFolders(new Set(allFolders));
      setAllExpanded(true);
    }
  };

  const startSharing = async () => {
    if (files.length === 0) return;
    try {
      const payload = files.map((f) =>
        f.relativePath !== f.name
          ? { absolute: f.path, relative: f.relativePath }
          : f.path,
      );
      const url = await window.electronAPI.startFileServer(payload, shareIP);
      setShareUrl(url);
      setIsSharing(true);

      // Directly detect theme from data-theme attribute (reliable fix)
      const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';
      const qrLightColor = isDarkMode ? '#0A0A0A' : '#FFFFFF';

      const qrData = await QRCode.toDataURL(url, {
        width: 220,
        margin: 2,
        color: { dark: "#b169e0", light: qrLightColor },
      });
      setQrDataUrl(qrData);

      // Reset speed tracking
      setUploadSpeed(null);
      lastBytesRef.current = 0;
      if (speedIntervalRef.current) clearInterval(speedIntervalRef.current);
      speedIntervalRef.current = setInterval(() => {
        // Note: resumable is defined later in the HTML, but we cannot access it here.
        // The speed calculation needs to be done in the Resumable progress handler.
        // We'll move speed calculation there.
      }, 1000);
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  const stopSharing = async () => {
    await window.electronAPI.stopFileServer();
    setShareUrl("");
    setQrDataUrl("");
    setIsSharing(false);
    setCopied(false);
    setFiles((prev) => prev.map((f) => ({ ...f, downloadStatus: "idle" })));
    if (speedIntervalRef.current) {
      clearInterval(speedIntervalRef.current);
      speedIntervalRef.current = null;
    }
    setUploadSpeed(null);
    lastBytesRef.current = 0;
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ── GSAP animations (unchanged) ─────────────────────
  useGSAP(
    () => {
      if (isSharing && shareLayoutRef.current) {
        gsap.fromTo(
          shareLayoutRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
        );
      }
    },
    { dependencies: [isSharing] },
  );

  useGSAP(
    () => {
      if (fileListRef.current && files.length > 0 && isSharing) {
        gsap.fromTo(
          fileListRef.current.querySelectorAll(`.${styles.fileRow}`),
          { opacity: 0, x: -20 },
          {
            opacity: 1,
            x: 0,
            stagger: 0.03,
            duration: 0.3,
            ease: "power2.out",
          },
        );
      }
    },
    { dependencies: [files, isSharing] },
  );

  const folderContentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [isDragging, setIsDragging] = useState(false);

  // Drag‑and‑drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isSharing) return;

    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;

    const newFiles: FileEntry[] = [];
    for (let i = 0; i < droppedFiles.length; i++) {
      const f = droppedFiles[i];
      const filePath = (f as any).path; // Electron exposes the full path
      if (filePath) {
        const name = f.name || filePath.split("\\").pop() || filePath;
        let size = f.size;
        try {
          size = await window.electronAPI.getFileSize(filePath);
        } catch {}
        newFiles.push({
          id: Date.now().toString() + Math.random(),
          path: filePath,
          relativePath: name,
          name,
          size,
          downloadStatus: "idle",
        });
      }
    }
    if (newFiles.length > 0) {
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleFolderToggle = (folderName: string) => {
    const contentEl = folderContentRefs.current.get(folderName);
    if (!contentEl) return;

    if (expandedFolders.has(folderName)) {
      gsap.to(contentEl, {
        height: 0,
        opacity: 0,
        duration: 0.25,
        ease: "power2.in",
        onComplete: () => toggleFolder(folderName),
      });
    } else {
      toggleFolder(folderName);
      requestAnimationFrame(() => {
        const el = folderContentRefs.current.get(folderName);
        if (el) {
          const naturalHeight = el.scrollHeight;
          gsap.fromTo(
            el,
            { height: 0, opacity: 0 },
            {
              height: naturalHeight,
              opacity: 1,
              duration: 0.3,
              ease: "power2.out",
            },
          );
        }
      });
    }
  };

  // ── Render helpers (with translations) ──────────────
  const renderFileRow = (file: FileEntry) => (
    <div key={file.id} className={styles.fileRow}>
      {editingFileId === file.id ? (
        <div className={styles.editContainer}>
          <textarea
            className={styles.editTextarea}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            rows={4}
            autoFocus
          />
          <div className={styles.editActions}>
            <button className={styles.btn} onClick={() => saveEditing(file)}>
              {t("save")}
            </button>
            <button
              className={styles.ghostBtn}
              onClick={() => setEditingFileId(null)}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <span className={styles.fileRowName}>{file.name}</span>
          <span className={styles.fileRowSize}>{formatBytes(file.size)}</span>
          <span className={styles.fileRowStatus}>
            {file.downloadStatus === "idle" && ""}
            {file.downloadStatus === "downloading" && (
              <div className={styles.miniSpinner} />
            )}
            {file.downloadStatus === "done" && (
              <FaCheckCircle color="#4CAF50" size={16} />
            )}
          </span>
          {!isSharing && (
            <>
              {file.name.startsWith("pasted-text-") && (
                <button
                  className={styles.editBtn}
                  onClick={() => startEditing(file)}
                  title={t("editText")}
                >
                  <FaPen size={14} />
                </button>
              )}
              <button
                className={styles.removeBtn}
                onClick={() => removeFile(file.id)}
                title={t("removeFile")}
              >
                <FaTimes size={14} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );

  const renderGroups = () => {
    return fileGroups.map((group) => {
      if (group.folderName === "") {
        return group.files.map((file) => renderFileRow(file));
      }
      const isExpanded = expandedFolders.has(group.folderName);
      const totalSize = group.files.reduce((sum, f) => sum + f.size, 0);
      return (
        <div key={group.folderName} className={styles.folderGroup}>
          <div
            className={styles.folderHeader}
            onClick={() => handleFolderToggle(group.folderName)}
          >
            <span className={styles.folderArrow}>
              {isExpanded ? <FaChevronDown /> : <FaChevronRight />}
            </span>
            <span className={styles.folderName}>{group.folderName}</span>
            <span className={styles.folderMeta}>
              {t("fileCount", { count: group.files.length })} ·{" "}
              {formatBytes(totalSize)}
            </span>
          </div>
          <div
            ref={(el) => {
              if (el) folderContentRefs.current.set(group.folderName, el);
            }}
            className={styles.folderContent}
            style={{
              height: isExpanded ? "auto" : 0,
              opacity: isExpanded ? 1 : 0,
            }}
          >
            {group.files.map((file) => renderFileRow(file))}
          </div>
        </div>
      );
    });
  };

  // Inject speed display into the status element (the status element is in the HTML generated by backend)
  // We'll modify the status text inside the React component – the backend HTML is separate.
  // Actually, the progress display is already in React's status element (the one with id "status").
  // We can update it from React. But note that Resumable.js also updates #status.textContent.
  // To avoid conflict, we'll use a custom status area in the React component.
  // Since the backend HTML is static, we cannot easily modify it from React.
  // Simpler: Remove the backend's status element? No, it's in the server-generated page.
  // Alternative: Use a custom status display inside the React component, separate from the server's.
  // But the server's page is only shown when sharing is active? Actually, the upload page is served by the backend,
  // not the React frontend. So we cannot control that from React.
  // Wait – QuickShare is the React component for the sender. The upload happens via the backend's HTML page.
  // The `isSharing` state shows a different UI (the QR code + file list). The upload progress is handled by the backend HTML's Resumable.
  // Therefore, we cannot display speed in the React component because the upload happens in the backend's page.
  // This is a limitation. However, we can add a speed display in the backend's upload HTML (getUploadHTML in uploadServer.ts) – but that would require changing that HTML string.
  // The optimization to add speed display is more complex and might be beyond scope. Let's skip it for now.

  // For now, we'll not implement speed display in QuickShare because the upload UI is not in React.
  // Instead, we'll focus on adding speed display in the backend's upload page (uploadServer.ts) later.
  // So no changes to this file for speed display.

  return (
    <div
      className={`${styles.container} ${isDragging ? styles.dragOver : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <BackButton
        onClick={() => {
          stopSharing();
          onBack();
        }}
      />
      <h2 className={styles.title}>{t("quickShare")}</h2>
      <p className={styles.subtitle}>
        {isSharing ? t("shareLinkOrQR") : t("addFilesThenStart")}
      </p>

      {/* File list – before sharing */}
      {files.length > 0 && !isSharing && (
        <div className={styles.fileList} ref={fileListRef}>
          {hasFolders && (
            <div className={styles.toggleAllRow}>
              <button className={styles.toggleAllBtn} onClick={toggleAll}>
                <FaLayerGroup size={14} style={{ marginRight: 6 }} />
                {allExpanded ? t("collapseAll") : t("expandAll")}
              </button>
            </div>
          )}
          {renderGroups()}
        </div>
      )}

      {/* Action buttons — before sharing */}
      {!isSharing && (
        <div className={styles.actionRow}>
          <button className={styles.btn} onClick={addFiles}>
            {t("addFiles")}
          </button>
          <button className={styles.ghostBtn} onClick={addFolder}>
            {t("addFolder")}
          </button>
          {files.length > 0 && (
            <button className={styles.shareBtn} onClick={startSharing}>
              {t("startSharing")} ({files.length}{" "}
              {t("fileCount", { count: files.length })}) —{" "}
              {formatBytes(files.reduce((sum, f) => sum + f.size, 0))}
            </button>
          )}
        </div>
      )}

      {/* Sharing panel: two‑column layout */}
      {isSharing && (
        <div className={styles.shareLayout} ref={shareLayoutRef}>
          <div className={styles.fileColumn} ref={fileListRef}>
            <h3 className={styles.columnTitle}>{t("sharedFiles")}</h3>
            {hasFolders && (
              <div className={styles.toggleAllRow}>
                <button className={styles.toggleAllBtn} onClick={toggleAll}>
                  <FaLayerGroup size={14} style={{ marginRight: 6 }} />
                  {allExpanded ? t("collapseAll") : t("expandAll")}
                </button>
              </div>
            )}
            {renderGroups()}
          </div>

          <div className={styles.qrColumn} ref={qrPanelRef}>
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code" className={styles.qr} />
            ) : (
              <div className={styles.qrPlaceholder}>
                <FaQrcode size={48} color="#555" />
                <span>{t("generatingQR")}</span>
              </div>
            )}
            <div className={styles.urlRow}>
              <span className={styles.url}>{shareUrl}</span>
              <button className={styles.copyBtn} onClick={copyLink}>
                {copied ? (
                  <>
                    <FaCheckCircle
                      style={{ marginRight: 4 }}
                      color="#4CAF50"
                      size={14}
                    />{" "}
                    {t("copied")}
                  </>
                ) : (
                  t("copyLink")
                )}
              </button>
            </div>
            <p className={styles.hint}>{t("tellReceiverToConnect")}</p>
            <button className={styles.stopBtn} onClick={stopSharing}>
              {t("stopSharing")}
            </button>
          </div>
        </div>
      )}

      {files.length === 0 && !isSharing && (
        <div className={styles.emptyState}>
          <FaFolderOpen size={48} color="#555" />
          <p>{t("noFilesAdded")}</p>
          <p className={styles.emptyHint}>{t("addFilesHint")}</p>
        </div>
      )}
    </div>
  );
};

export default QuickShare;