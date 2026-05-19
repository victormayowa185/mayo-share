import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  FaArrowLeft,
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
  downloadStatus: "idle" | "downloading" | "done";
}

interface FileGroup {
  folderName: string; // e.g. "fate zero/1" or "" for root files
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
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [allExpanded, setAllExpanded] = useState(false);

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
            const name = f.name;
            newFiles.push({
              id: Date.now().toString() + Math.random(),
              path: filePath,
              relativePath: name,
              name,
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
      // Update file size in state
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
      // Extract folder portion from relativePath (e.g. "fate zero/1/01. Fate Zero.mkv" → "fate zero/1")
      const parts = file.relativePath.split("/");
      const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
      if (!groupsMap.has(folder)) groupsMap.set(folder, []);
      groupsMap.get(folder)!.push(file);
    }

    const groups: FileGroup[] = [];
    // Add named folders first, then root files
    for (const [folder, folderFiles] of groupsMap) {
      if (folder) {
        groups.push({ folderName: folder, files: folderFiles });
      }
    }
    // Root files (no folder)
    const rootFiles = groupsMap.get("") || [];
    if (rootFiles.length > 0) {
      groups.push({ folderName: "", files: rootFiles });
    }

    return groups;
  };

  const fileGroups = groupFiles(files);
  const hasFolders = fileGroups.some((g) => g.folderName !== "");

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
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

      const qrData = await QRCode.toDataURL(url, {
        width: 220,
        margin: 2,
        color: { dark: "#b169e0", light: "#0A0A0A" },
      });
      setQrDataUrl(qrData);
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
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // GSAP animations
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

  // Animate files when they appear in the sharing panel
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

  // Animate folder expand/collapse
  const folderContentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const handleFolderToggle = (folderName: string) => {
    const contentEl = folderContentRefs.current.get(folderName);
    if (!contentEl) return;

    if (expandedFolders.has(folderName)) {
      // Collapse
      gsap.to(contentEl, {
        height: 0,
        opacity: 0,
        duration: 0.25,
        ease: "power2.in",
        onComplete: () => {
          toggleFolder(folderName);
        },
      });
    } else {
      // Expand
      toggleFolder(folderName);
      // We need to wait for the DOM to update before animating
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

  // Render a single file row
  const renderFileRow = (file: FileEntry) => (
  <div key={file.id} className={styles.fileRow}>
    {editingFileId === file.id ? (
      // ── Inline editor ──
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
            Save
          </button>
          <button
            className={styles.ghostBtn}
            onClick={() => setEditingFileId(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    ) : (
      // ── Normal file row ──
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
                title="Edit text"
              >
                <FaPen size={14} />
              </button>
            )}
            <button
              className={styles.removeBtn}
              onClick={() => removeFile(file.id)}
              title="Remove file"
            >
              <FaTimes size={14} />
            </button>
          </>
        )}
      </>
    )}
  </div>
);

  // Render groups
  const renderGroups = () => {
    return fileGroups.map((group) => {
      if (group.folderName === "") {
        // Root files – no collapsible header
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
              {group.files.length} file{group.files.length > 1 ? "s" : ""} ·{" "}
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

  return (
    <div className={styles.container}>
      <BackButton
        onClick={() => {
          stopSharing();
          onBack();
        }}
      />

      <h2 className={styles.title}>Quick Share</h2>
      <p className={styles.subtitle}>
        {isSharing
          ? "Share the link or QR code — receiver opens it in any browser."
          : "Add files, then start sharing."}
      </p>

      {/* File list – before sharing */}
      {files.length > 0 && !isSharing && (
        <div className={styles.fileList} ref={fileListRef}>
          {hasFolders && (
            <div className={styles.toggleAllRow}>
              <button className={styles.toggleAllBtn} onClick={toggleAll}>
                <FaLayerGroup size={14} style={{ marginRight: 6 }} />
                {allExpanded ? "Collapse All" : "Expand All"}
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
            Add Files
          </button>
          <button className={styles.ghostBtn} onClick={addFolder}>
            Add Folder
          </button>
          {files.length > 0 && (
            <button className={styles.shareBtn} onClick={startSharing}>
              Start Sharing ({files.length} file{files.length > 1 ? "s" : ""}) —{" "}
              {formatBytes(files.reduce((sum, f) => sum + f.size, 0))}
            </button>
          )}
        </div>
      )}

      {/* Sharing panel: two‑column layout */}
      {isSharing && (
        <div className={styles.shareLayout} ref={shareLayoutRef}>
          <div className={styles.fileColumn} ref={fileListRef}>
            <h3 className={styles.columnTitle}>Shared Files</h3>
            {hasFolders && (
              <div className={styles.toggleAllRow}>
                <button className={styles.toggleAllBtn} onClick={toggleAll}>
                  <FaLayerGroup size={14} style={{ marginRight: 6 }} />
                  {allExpanded ? "Collapse All" : "Expand All"}
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
                <span>Generating QR…</span>
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
                    Copied
                  </>
                ) : (
                  "Copy Link"
                )}
              </button>
            </div>
            <p className={styles.hint}>
              Tell the receiver to connect to your hotspot and open this link.
            </p>
            <button className={styles.stopBtn} onClick={stopSharing}>
              Stop Sharing
            </button>
          </div>
        </div>
      )}

      {files.length === 0 && !isSharing && (
        <div className={styles.emptyState}>
          <FaFolderOpen size={48} color="#555" />
          <p>No files added yet.</p>
          <p className={styles.emptyHint}>
            Click "Add Files", "Add Folder", or press Ctrl+V to paste.
          </p>
        </div>
      )}
    </div>
  );
};

export default QuickShare;
