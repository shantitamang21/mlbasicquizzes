// src/components/Note/Note.tsx
import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from "react";
import { db, storage, ensureAnon } from "../../firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import "./Note.css";

type NoteDoc = {
  id: string;
  title: string;
  body: string;
  ownerId?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  storagePath?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

function omitUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const key of Object.keys(obj)) {
    const v = (obj as any)[key];
    if (v !== undefined) out[key] = v;
  }
  return out as T;
}

function formatTs(ts: any | undefined) {
  try {
    if (ts?.toDate) {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(ts.toDate());
    }
  } catch (e) {
    console.warn("Failed to format timestamp:", e);
  }
  return "Unknown";
}

function getFileSizeMB(file: File): number {
  return file.size / (1024 * 1024);
}

const MAX_MB = 10;
const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const isImage = (contentType: string | null | undefined) =>
  !!contentType && contentType.startsWith("image/");

export default function Note() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [selected, setSelected] = useState<NoteDoc | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notesRef = useMemo(() => collection(db, "teacherNotes"), []);

  const canSave = (!!title.trim() || !!body.trim() || !!file) && !saving;

  /* ---------------- File picker ---------------- */

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;

    if (!f) {
      setFile(null);
      setImagePreview(null);
      setUploadError(null);
      setUploadProgress(null);
      return;
    }

    if (!ALLOWED_TYPES.includes(f.type)) {
      alert(`This file type is not allowed. Type: ${f.type || "unknown"}`);
      e.currentTarget.value = "";
      setUploadProgress(null);
      return;
    }

    if (f.size > MAX_MB * 1024 * 1024) {
      alert(
        `File is too large. Max ${MAX_MB} MB. Your file is ${getFileSizeMB(f).toFixed(
          1
        )} MB.`
      );
      e.currentTarget.value = "";
      setUploadProgress(null);
      return;
    }

    setUploadError(null);
    setUploadProgress(null);
    setFile(f);

    if (isImage(f.type)) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(f);
    } else {
      setImagePreview(null);
    }
  }

  /* ---------------- Firestore listener ---------------- */

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;

    async function startListener() {
      try {
        // make sure we are signed in anonymously before listening
        await ensureAnon();
        if (cancelled) return;

        const q = query(notesRef, orderBy("createdAt", "desc"));

        unsub = onSnapshot(
          q,
          (snap) => {
            const list: NoteDoc[] = snap.docs.map((d) => {
              const data = d.data();
              return {
                id: d.id,
                title: data.title ?? "",
                body: data.body ?? "",
                ownerId: data.ownerId ?? null,
                fileUrl: data.fileUrl ?? null,
                fileName: data.fileName ?? null,
                contentType: data.contentType ?? null,
                fileSize: data.fileSize ?? null,
                storagePath: data.storagePath ?? null,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
              };
            });
            setNotes(list);
            setSelected((prev) => {
              if (!prev) return prev;
              const refreshed = list.find((n) => n.id === prev.id);
              return refreshed ?? prev;
            });
          },
          (err) => {
            console.error("Firestore listener error:", err);
            const errorMessage =
              (err?.code ? `${err.code}: ` : "") +
              (err?.message || "Failed to load notes from Firestore");
            setUploadError(errorMessage);
            alert(errorMessage);
          }
        );
      } catch (e: any) {
        console.error("Auth init error (listener):", e);
        const errorMessage =
          (e?.code ? `${e.code}: ` : "") +
          (e?.message || "Failed to initialize notes");
        setUploadError(errorMessage);
        alert(errorMessage);
      }
    }

    startListener();

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [notesRef]);

  /* ---------------- Save new note ---------------- */

  const handleSave = useCallback(async () => {
    if (!title.trim() && !body.trim() && !file) {
      alert("Please add a title or note, or attach a file.");
      return;
    }

    setSaving(true);
    setUploadError(null);

    try {
      // 1) make sure user is signed in
      const uid = await ensureAnon();

      let fileUrl: string | undefined;
      let storagePath: string | undefined;
      let fileName: string | undefined;
      let contentType: string | undefined;
      let fileSize: number | undefined;

      // 2) upload file if present
      if (file) {
        storagePath = `users/${uid}/notes/${Date.now()}_${file.name.replace(
          /[^a-zA-Z0-9.-]/g,
          "_"
        )}`;

        const storageRef = ref(storage, storagePath);
        const metadata = file.type ? { contentType: file.type } : undefined;

        const uploadTask = uploadBytesResumable(storageRef, file, metadata);
        setUploadProgress(0);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            (snap) => {
              if (snap.totalBytes > 0) {
                const pct = Math.round(
                  (snap.bytesTransferred / snap.totalBytes) * 100
                );
                setUploadProgress(pct);
              }
            },
            (err) => {
              console.error("Storage upload error:", err);
              reject(err);
            },
            () => resolve()
          );
        });

        fileUrl = await getDownloadURL(uploadTask.snapshot.ref);
        fileName = file.name;
        contentType = metadata?.contentType || file.type || undefined;
        fileSize = file.size;
      }

      // 3) save note in Firestore
      const payload = omitUndefined({
        title: title.trim(),
        body: body.trim(),
        fileUrl: file ? fileUrl! : null,
        fileName: file ? fileName! : null,
        contentType: file ? contentType ?? null : null,
        fileSize: file ? fileSize ?? null : null,
        storagePath: file ? storagePath! : null,
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(notesRef, payload);

      // 4) reset form
      setTitle("");
      setBody("");
      setFile(null);
      setImagePreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      console.error("Upload/save error:", e);
      const errorMessage =
        (e?.code ? `${e.code}: ` : "") +
        (e?.message || "Failed to save note");
      setUploadError(errorMessage);
      alert(`Save failed: ${errorMessage}`);
    } finally {
      setUploadProgress(null);
      setSaving(false);
    }
  }, [title, body, file, notesRef]);

  /* ---------------- Delete note ---------------- */

  async function handleDelete(note: NoteDoc) {
    const ok = window.confirm(`Delete "${note.title || "(untitled)"}"?`);
    if (!ok) return;

    try {
      await ensureAnon();

      await deleteDoc(doc(db, "teacherNotes", note.id));

      if (note.storagePath) {
        try {
          await deleteObject(ref(storage, note.storagePath));
        } catch (e) {
          console.warn("Storage delete warning:", e);
        }
      }
      if (selected?.id === note.id) setSelected(null);
    } catch (e: any) {
      console.error("Delete error:", e);
      const errorMessage =
        (e?.code ? `${e.code}: ` : "") +
        (e?.message || "Failed to delete note");
      alert(errorMessage);
    }
  }

  /* ---------------- Keyboard shortcuts ---------------- */

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canSave) handleSave();
      }
      if (e.key === "Escape") {
        setSelected(null);
        setIsEditing(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave, handleSave]);

  /* ---------------- Open / close / edit note ---------------- */

  function openNote(n: NoteDoc) {
    setSelected(n);
    setIsEditing(false);
    setEditTitle(n.title || "");
    setEditBody(n.body || "");
  }

  function closeNote() {
    setSelected(null);
    setIsEditing(false);
  }

  const editChanged =
    (selected?.title || "") !== editTitle ||
    (selected?.body || "") !== editBody;

  async function saveEdit() {
    if (!selected) return;
    try {
      await ensureAnon();

      const updatePayload = omitUndefined({
        title: editTitle.trim(),
        body: editBody.trim(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "teacherNotes", selected.id), updatePayload);
      setSelected((prev) =>
        prev ? { ...prev, title: editTitle.trim(), body: editBody.trim() } : prev
      );
      setIsEditing(false);
    } catch (e: any) {
      console.error("Update error:", e);
      const errorMessage =
        (e?.code ? `${e.code}: ` : "") +
        (e?.message || "Failed to update note");
      alert(errorMessage);
    }
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="note-container">
      <h2 className="note-page-title">Teacher Notes</h2>

      <div className="note-grid">
        {/* Left side: editor */}
        <div className="card note-card-editor">
          <div className="field">
            <label className="label">Title</label>
            <input
              type="text"
              className="input"
              placeholder="e.g., Parent meeting agenda"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label">Note</label>
            <textarea
              className="textarea"
              placeholder="Write your note…"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="label">
              Attachment (optional) – Images, PDFs, Documents
            </label>
            <div className="file-row">
              <input
                ref={fileInputRef}
                type="file"
                className="file-input"
                onChange={onPickFile}
                accept="image/*,.pdf,.txt,.docx"
              />
              {file && (
                <div className="file-info">
                  <span className="file-hint">{file.name}</span>
                  <small className="file-size">
                    ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                  </small>
                </div>
              )}
            </div>

            {uploadError && (
              <div className="error-message">⚠ {uploadError}</div>
            )}

            {imagePreview && (
              <div className="file-preview">
                <div className="preview-label">Preview:</div>
                <img src={imagePreview} alt="Preview" className="preview-image" />
              </div>
            )}

            {uploadProgress !== null && (
              <div className="progress-container" aria-live="polite">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  >
                    {uploadProgress}%
                  </div>
                </div>
                <div className="progress-hint">
                  {uploadProgress < 100
                    ? "Uploading attachment…"
                    : "Finishing upload…"}
                </div>
              </div>
            )}
          </div>

          <div className="actions">
            <button
              className="btn btn-save"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving ? "Saving…" : "Save Note"}
            </button>

            <button
              className="btn btn-clear-red"
              onClick={() => {
                setTitle("");
                setBody("");
                setFile(null);
                setImagePreview(null);
                setUploadError(null);
                setUploadProgress(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={saving}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Right side: list */}
        <div className="card note-card-list">
          <div className="list-header">
            <h3 className="list-title">Saved Notes</h3>
            <div className="list-tools">
              <span className="list-badge">{notes.length} total</span>
            </div>
          </div>

          {notes.length === 0 ? (
            <div className="note-empty">
              No notes yet — create your first note on the left.
            </div>
          ) : (
            <div className="note-list">
              {notes.map((n) => (
                <div key={n.id} className="note-item">
                  <div className="note-item-main" onClick={() => openNote(n)}>
                    <div className="note-item-title">
                      {n.title || "(untitled)"}
                    </div>
                    {n.body && (
                      <div className="note-item-body">{n.body}</div>
                    )}

                    {n.fileUrl && isImage(n.contentType) && (
                      <img
                        src={n.fileUrl}
                        alt={n.fileName || "attachment"}
                        className="note-item-image"
                      />
                    )}

                    {n.fileUrl && !isImage(n.contentType) && (
                      <div className="note-item-file">📎 {n.fileName}</div>
                    )}

                    <div className="note-item-meta">
                      <small>
                        Created: {formatTs(n.createdAt)}
                        {n.updatedAt && <> • Updated: {formatTs(n.updatedAt)}</>}
                      </small>
                    </div>
                  </div>

                  <div className="note-item-actions">
                    <button
                      className="btn btn-blue"
                      onClick={() => openNote(n)}
                    >
                      Open
                    </button>
                    <button
                      className="btn btn-blue"
                      onClick={() => handleDelete(n)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {selected && (
        <div className="note-modal-backdrop" onClick={closeNote}>
          <div className="note-modal" onClick={(e) => e.stopPropagation()}>
            <div className="note-modal-header">
              {isEditing ? (
                <input
                  className="input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              ) : (
                <h3 className="note-modal-title">
                  {selected.title || "(untitled)"}
                </h3>
              )}

              <div className="note-modal-actions">
                {!isEditing ? (
                  <button
                    className="btn btn-blue"
                    onClick={() => setIsEditing(true)}
                  >
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-blue"
                      onClick={saveEdit}
                      disabled={!editChanged}
                    >
                      Save
                    </button>
                    <button
                      className="btn btn-blue"
                      onClick={() => {
                        setIsEditing(false);
                        setEditTitle(selected.title || "");
                        setEditBody(selected.body || "");
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                <button className="btn btn-blue" onClick={closeNote}>
                  Close
                </button>
              </div>
            </div>

            <div className="note-modal-body">
              {isEditing ? (
                <textarea
                  className="textarea"
                  rows={8}
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                />
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{selected.body}</div>
              )}

              {selected.fileUrl && (
                <div className="note-modal-attachment">
                  <div className="attachment-label">📎 Attachment</div>

                  {isImage(selected.contentType) ? (
                    <div>
                      <img
                        src={selected.fileUrl}
                        alt={selected.fileName || "attachment"}
                        className="attachment-image"
                      />
                      <div className="attachment-info">
                        {selected.fileName}{" "}
                        {typeof selected.fileSize === "number" && (
                          <>({(selected.fileSize / 1024).toFixed(1)} KB)</>
                        )}
                      </div>
                    </div>
                  ) : (
                    <a
                      href={selected.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="attachment-link"
                    >
                      📄 {selected.fileName}{" "}
                      {typeof selected.fileSize === "number" && (
                        <>({(selected.fileSize / 1024).toFixed(1)} KB)</>
                      )}
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
