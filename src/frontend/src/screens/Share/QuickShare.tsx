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
  FaCloudUploadAlt,
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

// Read a Blob/File's bytes as base64 — used when clipboard content has no file
// path (e.g. an image blob or a browser File in modern Electron).
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });


const QuickShare: React.FC<Props> = ({ onBack, shareIP }) => {
  const { t } = useTranslation();
  const [downloadIps, setDownloadIps] = useState<Map<string, Set<string>>>(new Map());
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [shareUrl, setShareUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
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

  // Listen for download events – with cleanup
  useEffect(() => {
    const handleDownloadUpdate = (data: any) => {
      if (data.event === "started") {
        setFiles((prev) =>
          prev.map((f) =>
            f.name === data.fileName ? { ...f, downloadStatus: "downloading" } : f
          )
        );
      } else if (data.event === "completed") {
        setFiles((prev) =>
          prev.map((f) =>
            f.name === data.fileName ? { ...f, downloadStatus: "done" } : f
          )
        );
        if (data.clientIp) {
          setDownloadIps((prev) => {
            const newMap = new Map(prev);
            const existing = newMap.get(data.fileName) || new Set<string>();
            existing.add(data.clientIp);
            newMap.set(data.fileName, existing);
            return newMap;
          });
        }
      }
    };

    // Assume the API returns an unsubscribe function; if not, adjust accordingly
    const cleanup = window.electronAPI.onDownloadUpdate(handleDownloadUpdate);
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, []);

  // Ctrl+V paste — pastes ANYTHING already copied: OS files (video/pdf/zip/…),
  // screenshots/images, or text.
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      if (isSharing) return;

      // Don't hijack paste while typing in an input/textarea.
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const clipboard = e.clipboardData;
      if (!clipboard) return;
      e.preventDefault();

      // IMPORTANT: read everything from clipboardData SYNCHRONOUSLY now. After
      // the first `await`, the event's clipboardData is emptied — which is why
      // text and images silently failed to paste before.
      const text = clipboard.getData("text/plain");
      const browserFiles = Array.from(clipboard.files);
      const imageItem = Array.from(clipboard.items).find((it) =>
        it.type.startsWith("image/")
      );
      const imageBlob = imageItem ? imageItem.getAsFile() : null;

      // Case 0: a real file copied from the OS file manager (ANY type).
      try {
        const native = await window.electronAPI.getClipboardFiles();
        if (native.paths && native.paths.length > 0) {
          const newFiles: FileEntry[] = [];
          for (const p of native.paths) {
            const name = p.split(/[\\/]/).pop() || p;
            if (isInvalidFile(name)) continue;
            let size = 0;
            try { size = await window.electronAPI.getFileSize(p); } catch { }
            newFiles.push({
              id: crypto.randomUUID(),
              path: p,
              relativePath: name,
              name,
              size,
              downloadStatus: "idle",
            });
          }
          if (newFiles.length > 0) {
            setFiles((prev) => [...prev, ...newFiles]);
            return;
          }
        }
      } catch { /* fall through */ }

      // Case 1: browser File objects (no path in modern Electron → save bytes).
      if (browserFiles.length > 0) {
        const newFiles: FileEntry[] = [];
        for (const f of browserFiles) {
          if (isInvalidFile(f.name)) continue;
          try {
            const base64 = await blobToBase64(f);
            const saved = await window.electronAPI.saveTempFile(f.name, base64);
            newFiles.push({
              id: crypto.randomUUID(),
              path: saved,
              relativePath: f.name,
              name: f.name,
              size: f.size,
              downloadStatus: "idle",
            });
          } catch { }
        }
        if (newFiles.length > 0) {
          setFiles((prev) => [...prev, ...newFiles]);
          return;
        }
      }

      // Case 2: pasted image / screenshot (image data, not a file).
      if (imageBlob) {
        const base64 = await blobToBase64(imageBlob);
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `screenshot-${timestamp}.png`;
        const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
        setFiles((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            path: savedPath,
            relativePath: fileName,
            name: fileName,
            size: imageBlob.size,
            downloadStatus: "idle",
          },
        ]);
        return;
      }

      // Case 3: plain text.
      if (text && text.trim()) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `pasted-text-${timestamp}.txt`;
        const base64 = btoa(unescape(encodeURIComponent(text)));
        const savedPath = await window.electronAPI.saveTempFile(fileName, base64);
        const size = new Blob([text]).size;
        setFiles((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            path: savedPath,
            relativePath: fileName,
            name: fileName,
            size,
            downloadStatus: "idle",
          },
        ]);
      }
    },
    [isSharing]
  );



  useEffect(() => {
    document.addEventListener("paste", handlePaste as any);
    return () => document.removeEventListener("paste", handlePaste as any);
  }, [handlePaste]);

  // ✅ Files that are incomplete/temp and should never be shared
  const isInvalidFile = (name: string) => {
    const lower = name.toLowerCase();
    return (
      lower.endsWith(".crdownload") ||   // Chrome partial download
      lower.endsWith(".part") ||          // Firefox partial download
      lower.endsWith(".tmp") ||           // temp files
      lower.endsWith(".download") ||      // Safari partial download
      lower.startsWith("~$")             // Office temp files
    );
  };

  const addFiles = async () => {
    const paths = await window.electronAPI.selectFile();
    if (!paths) return;
    const allFiles: FileEntry[] = await Promise.all(
      paths.map(async (p) => ({
        id: crypto.randomUUID(),
        path: p,
        relativePath: p.split("\\").pop() || p,
        name: p.split("\\").pop() || p,
        size: await window.electronAPI.getFileSize(p),
        downloadStatus: "idle" as const,
      }))
    );
    const validFiles = allFiles.filter((f) => !isInvalidFile(f.name));
    const skipped = allFiles.length - validFiles.length;
    if (skipped > 0) {
      alert(`${skipped} file(s) skipped — incomplete or temporary files cannot be shared.`);
    }
    setFiles((prev) => [...prev, ...validFiles]);
  };

  const addFolder = async () => {
    const folderFiles = await window.electronAPI.selectFolder();
    if (!folderFiles) return;
    const newFiles: FileEntry[] = await Promise.all(
      folderFiles.map(async (f) => ({
        id: crypto.randomUUID(),
        path: f.absolute,
        relativePath: f.relative,
        name: f.absolute.split("\\").pop() || f.relative,
        size: await window.electronAPI.getFileSize(f.absolute),
        downloadStatus: "idle" as const,
      }))
    );
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (id: string) =>
    setFiles((prev) => prev.filter((f) => f.id !== id));

  // Remove an ENTIRE folder (all files under it) in one click.
  const removeFolder = (folderFiles: FileEntry[]) => {
    const ids = new Set(folderFiles.map((f) => f.id));
    setFiles((prev) => prev.filter((f) => !ids.has(f.id)));
  };


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
          f.id === file.id ? { ...f, size: new Blob([editContent]).size } : f
        )
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
      const allFolders = fileGroups.filter((g) => g.folderName !== "").map((g) => g.folderName);
      setExpandedFolders(new Set(allFolders));
      setAllExpanded(true);
    }
  };

  const startSharing = async () => {
    if (files.length === 0) return;
    try {
      const payload = files.map((f) =>
        f.relativePath !== f.name ? { absolute: f.path, relative: f.relativePath } : f.path
      );
      // Ensure we have a valid IP – fallback to local IP if shareIP is empty
      let ip = shareIP;
      if (!ip) {
        ip = (await window.electronAPI.getLocalIP()) ?? undefined;
      }
      const url = await window.electronAPI.startFileServer(payload, ip);
      setShareUrl(url);
      setIsSharing(true);

      const isDarkMode = document.documentElement.getAttribute("data-theme") === "dark";
      const qrLightColor = isDarkMode ? "#0A0A0A" : "#FFFFFF";
      const qrData = await QRCode.toDataURL(url, {
        width: 220,
        margin: 2,
        color: { dark: "#7C3EFF", light: qrLightColor },
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
    setDownloadIps(new Map());
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

  // ── GSAP animations ─────────────────────────────────
  useGSAP(
    () => {
      if (isSharing && shareLayoutRef.current) {
        gsap.fromTo(
          shareLayoutRef.current,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }
        );
      }
    },
    { dependencies: [isSharing] }
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
          }
        );
      }
    },
    { dependencies: [files, isSharing] }
  );

  useEffect(() => {
    const badges = document.querySelectorAll<HTMLElement>(`.${styles.downloadBadge}`);
    const tooltip = document.createElement("div");
    tooltip.className = styles.downloadTooltip;
    document.body.appendChild(tooltip);

    const showTooltip = (e: MouseEvent) => {
      const badge = e.currentTarget as HTMLElement;
      const fileName = badge.getAttribute("data-filename");
      if (!fileName) return;
      const count = downloadIps.get(fileName)?.size || 0;
      if (count < 2) return;
      tooltip.textContent = `${count} device${count !== 1 ? "s" : ""} downloaded this file`;
      const rect = badge.getBoundingClientRect();
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - 30}px`;
      tooltip.style.transform = "translateX(-50%) scale(0.9)";
      tooltip.style.opacity = "0";
      tooltip.style.display = "block";
      gsap.to(tooltip, {
        duration: 0.2,
        opacity: 1,
        scale: 1,
        ease: "back.out(0.6)",
      });
    };

    const hideTooltip = () => {
      gsap.to(tooltip, {
        duration: 0.15,
        opacity: 0,
        scale: 0.9,
        onComplete: () => {
          tooltip.style.display = "none";
        },
      });
    };

    badges.forEach((badge) => {
      badge.addEventListener("mouseenter", showTooltip);
      badge.addEventListener("mouseleave", hideTooltip);
    });

    return () => {
      badges.forEach((badge) => {
        badge.removeEventListener("mouseenter", showTooltip);
        badge.removeEventListener("mouseleave", hideTooltip);
      });
      tooltip.remove();
    };
  }, [downloadIps, files]);

  const folderContentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Turn dropped files/folders into shareable entries. Folders are walked so
  // every file inside is added with its relative path (keeps the tree).
  const processDroppedFiles = async (fileList: FileList) => {
    const newFiles: FileEntry[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      // Modern Electron: real on-disk path of a dragged file/folder.
      let filePath = "";
      try { filePath = window.electronAPI.getPathForFile(f); } catch { }

      // No path (rare synthetic blob): save its bytes to a temp file.
      if (!filePath) {
        if (isInvalidFile(f.name)) continue;
        try {
          const base64 = await blobToBase64(f);
          const saved = await window.electronAPI.saveTempFile(f.name, base64);
          newFiles.push({
            id: crypto.randomUUID(),
            path: saved,
            relativePath: f.name,
            name: f.name,
            size: f.size,
            downloadStatus: "idle",
          });
        } catch { }
        continue;
      }

      // Folder → walk it and add every file inside (with relative paths).
      let isDir = false;
      try { isDir = await window.electronAPI.isDirectory(filePath); } catch { }
      if (isDir) {
        try {
          const walked = await window.electronAPI.walkDirectory(filePath);
          for (const w of walked) {
            if (isInvalidFile(w.relative)) continue;
            let size = 0;
            try { size = await window.electronAPI.getFileSize(w.absolute); } catch { }
            newFiles.push({
              id: crypto.randomUUID(),
              path: w.absolute,
              relativePath: w.relative,
              name: w.absolute.split(/[\\/]/).pop() || w.relative,
              size,
              downloadStatus: "idle",
            });
          }
        } catch { }
        continue;
      }

      // Single file
      const name = f.name || filePath.split(/[\\/]/).pop() || filePath;
      if (isInvalidFile(name)) continue;
      let size = f.size;
      try { size = await window.electronAPI.getFileSize(filePath); } catch { }
      newFiles.push({
        id: crypto.randomUUID(),
        path: filePath,
        relativePath: name,
        name,
        size,
        downloadStatus: "idle",
      });
    }
    if (newFiles.length > 0) setFiles((prev) => [...prev, ...newFiles]);
  };

  // Use a counter so moving over child elements doesn't flicker the overlay.
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isSharing) return;
    dragCounter.current++;
    if (Array.from(e.dataTransfer.types || []).includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    if (isSharing) return;
    const droppedFiles = e.dataTransfer.files;
    if (!droppedFiles || droppedFiles.length === 0) return;
    await processDroppedFiles(droppedFiles);
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
            }
          );
        }
      });
    }
  };

  // ── Render helpers ──────────────────────────────
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
            {file.downloadStatus === "downloading" && <div className={styles.miniSpinner} />}
            {file.downloadStatus === "done" && (
              <div className={styles.downloadBadge} data-filename={file.name}>
                <FaCheckCircle color="#4CAF50" size={16} />
                {(() => {
                  const ips = downloadIps.get(file.name);
                  const count = ips ? ips.size : 0;
                  return count >= 2 ? <span className={styles.downloadCount}>{count}</span> : null;
                })()}
              </div>
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
              {t("fileCount", { count: group.files.length })} · {formatBytes(totalSize)}
            </span>
            {!isSharing && (
              <button
                className={styles.removeBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  removeFolder(group.files);
                }}
                title={t("removeFile")}
              >
                <FaTimes size={14} />
              </button>
            )}
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
     <div
      className={`${styles.container} ${isDragging ? styles.dragOver : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
        {isDragging && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            // Glassy: just blur the page content with a faint frosted layer —
            // no solid color, so it looks right in both light & dark mode.
            background: "rgba(255, 255, 255, 0.04)",
            backdropFilter: "blur(10px) saturate(120%)",
            WebkitBackdropFilter: "blur(10px) saturate(120%)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              padding: "32px 44px",
              borderRadius: 24,
              background: "rgba(124, 62, 255, 0.10)",
              border: "1px solid rgba(124, 62, 255, 0.25)",
              boxShadow: "0 8px 40px rgba(0, 0, 0, 0.18)",
            }}
          >
            <FaCloudUploadAlt size={60} color="var(--accent)" />
            <span style={{ color: "var(--text-primary)", fontSize: "1.15rem", fontWeight: 600 }}>
              Drop files or folders to add
            </span>
          </div>
        </div>
      )}

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

         {files.length > 0 && !isSharing && (
        <div className={styles.stickyActionBar}>
          <div className={styles.stickyInfo}>
            {/* Expand/Collapse lives here, but ONLY when folders are present */}
            {hasFolders && (
              <button className={styles.toggleAllBtn} onClick={toggleAll}>
                <FaLayerGroup size={14} style={{ marginRight: 6 }} />
                {allExpanded ? t("collapseAll") : t("expandAll")}
              </button>
            )}
          </div>
          <div className={styles.stickyActions}>
            <button className={styles.shareBtn} onClick={startSharing}>
              {t("startSharing")} ({formatBytes(files.reduce((sum, f) => sum + f.size, 0))})
            </button>
          </div>
        </div>
      )}

      {/* Add buttons sit right under the Send button, ABOVE the file list */}
      {!isSharing && (
        <div className={styles.actionRow}>
          <button className={styles.btn} onClick={addFiles}>
            {t("addFiles")}
          </button>
          <button className={styles.ghostBtn} onClick={addFolder}>
            {t("addFolder")}
          </button>
        </div>
      )}


      {files.length > 0 && !isSharing && (
        <div className={styles.fileList} ref={fileListRef}>
          {renderGroups()}
        </div>
      )}

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
              <div className={styles.qrWrapper}>
                <img src={qrDataUrl} alt="QR Code" className={styles.qr} />
              </div>
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
                    <FaCheckCircle style={{ marginRight: 4 }} color="#4CAF50" size={14} />{" "}
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