import React, { useEffect, useMemo, useState, useRef } from "react";
import { db, storage } from "../../firebase";
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
  Object.keys(obj).forEach((k) => {
    const v = (obj as any)[k];
    if (v !== undefined) out[k] = v;
  });
  return out as T;
}

function formatTs(ts: any | undefined) {
  try {
    if (ts?.toDate) {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(ts.toDate());
    }
  } catch {}
  return "Unknown";
}

// Function to compress images
async function compressImage(file: File, maxWidth = 1200, quality = 0.7): Promise<File> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        // Calculate new dimensions while maintaining aspect ratio
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Could not compress image'));
              return;
            }
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// Function to get file size in MB
function getFileSizeMB(file: File): number {
  return file.size / (1024 * 1024);
}

export default function Note() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState<NoteDoc[]>([]);
  const [selected, setSelected] = useState<NoteDoc | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const notesRef = useMemo(() => collection(db, "teacherNotes"), []);

  const MAX_MB = 5; // Reduced from 15MB to 5MB for faster uploads
  const ALLOWED = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];

  // Check if file is an image
  const isImage = (contentType: string | null | undefined) => {
    return contentType?.startsWith('image/');
  };

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      setImagePreview(null);
      setUploadError(null);
      return;
    }
    
    if (!ALLOWED.includes(f.type)) {
      alert("This file type is not allowed.");
      e.currentTarget.value = "";
      return;
    }
    
    if (f.size > MAX_MB * 1024 * 1024) {
      alert(`File is too large. Max ${MAX_MB} MB. Your file is ${getFileSizeMB(f).toFixed(1)} MB.`);
      e.currentTarget.value = "";
      return;
    }
    
    setUploadError(null);
    
    try {
      let processedFile = f;

      // Compress images larger than 1MB
      if (isImage(f.type) && f.size > 1 * 1024 * 1024) {
        setSaving(true); // Show compressing state
        processedFile = await compressImage(f);
        console.log(`Compressed from ${getFileSizeMB(f).toFixed(1)}MB to ${getFileSizeMB(processedFile).toFixed(1)}MB`);
      }

      setFile(processedFile);

      // Create preview for images
      if (isImage(processedFile.type)) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setImagePreview(reader.result as string);
          setSaving(false); // Hide compressing state
        };
        reader.readAsDataURL(processedFile);
      } else {
        setImagePreview(null);
        setSaving(false); // Hide compressing state
      }
    } catch (error) {
      console.error('Error processing file:', error);
      setUploadError('Failed to process file. Please try another image.');
      setSaving(false);
      e.currentTarget.value = "";
    }
  }

  useEffect(() => {
    const q = query(notesRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: NoteDoc[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          title: data.title ?? "",
          body: data.body ?? "",
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
      if (selected) {
        const refreshed = list.find((n) => n.id === selected.id);
        if (refreshed) setSelected(refreshed);
      }
    });
    return () => unsub();
  }, [notesRef, selected]);

  async function handleSave() {
    if (!title.trim() && !body.trim() && !file) {
      alert("Please add a title or note, or attach a file.");
      return;
    }
    
    setSaving(true);
    setProgress(0);
    setUploadError(null);

    try {
      let fileUrl: string | undefined;
      let storagePath: string | undefined;
      let fileName: string | undefined;
      let contentType: string | undefined;
      let fileSize: number | undefined;

      if (file) {
        storagePath = `notes/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        const storageRef = ref(storage, storagePath);
        
        // Add timeout for upload
        const uploadPromise = new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(storageRef, file);
          
          // Set a timeout for the upload (5 minutes)
          const timeout = setTimeout(() => {
            task.cancel();
            reject(new Error('Upload timeout. Please try again with a smaller file.'));
          }, 5 * 60 * 1000);

          task.on(
            "state_changed",
            (snap) => {
              const pct = Math.round(
                (snap.bytesTransferred / snap.totalBytes) * 100
              );
              setProgress(pct);
            },
            (error) => {
              clearTimeout(timeout);
              reject(error);
            },
            async () => {
              clearTimeout(timeout);
              try {
                fileUrl = await getDownloadURL(task.snapshot.ref);
                fileName = file.name;
                contentType = file.type || undefined;
                fileSize = file.size;
                resolve();
              } catch (error) {
                reject(error);
              }
            }
          );
        });

        await uploadPromise;
      }

      const payload = omitUndefined({
        title: title.trim(),
        body: body.trim(),
        fileUrl: file ? fileUrl! : null,
        fileName: file ? fileName! : null,
        contentType: file ? contentType ?? null : null,
        fileSize: file ? fileSize ?? null : null,
        storagePath: file ? storagePath! : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(notesRef, payload);

      // Reset form state
      setTitle("");
      setBody("");
      setFile(null);
      setImagePreview(null);
      setProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (e: any) {
      console.error("Upload error:", e);
      const errorMessage = e?.message || "Failed to save note";
      setUploadError(errorMessage);
      alert(errorMessage);
    } finally {
      setSaving(false);
      setProgress(0);
    }
  }

  async function handleDelete(note: NoteDoc) {
    const ok = window.confirm(`Delete "${note.title || "(untitled)"}"?`);
    if (!ok) return;

    try {
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
      console.error(e);
      alert(e?.message || "Failed to delete");
    }
  }

  const canSave = (!!title.trim() || !!body.trim() || !!file) && !saving;

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
  }, [canSave]);

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
    (selected?.title || "") !== editTitle || (selected?.body || "") !== editBody;

  async function saveEdit() {
    if (!selected) return;
    try {
      await updateDoc(doc(db, "teacherNotes", selected.id), omitUndefined({
        title: editTitle.trim(),
        body: editBody.trim(),
        updatedAt: serverTimestamp(),
      }));
      setSelected((prev) =>
        prev ? { ...prev, title: editTitle.trim(), body: editBody.trim() } : prev
      );
      setIsEditing(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Failed to update note");
    }
  }

  return (
    <div className="note-container">
      <h2 className="note-page-title">Teacher Notes</h2>

      <div className="note-grid">
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
            <label className="label">Attachment (optional) - Images, PDFs, Documents</label>
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
            
            {/* Upload Error */}
            {uploadError && (
              <div className="error-message">
                {uploadError}
              </div>
            )}
            
            {/* Image Preview */}
            {imagePreview && (
              <div className="file-preview">
                <div className="preview-label">Preview:</div>
                <img 
                  src={imagePreview} 
                  alt="Preview" 
                  className="preview-image"
                />
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {saving && (
            <div className="progress-container">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}>
                  {progress > 0 ? `${progress}%` : 'Processing...'}
                </div>
              </div>
              <div className="progress-hint">
                {progress === 0 ? "Compressing image..." : "Uploading..."}
              </div>
            </div>
          )}

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
                setProgress(0);
                setUploadError(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={saving}
            >
              Clear
            </button>
          </div>
        </div>

        {/* Rest of your component remains the same */}
        <div className="card note-card-list">
          <div className="list-header">
            <h3>Saved Notes</h3>
            <div className="muted">{notes.length} total</div>
          </div>

          {notes.length === 0 ? (
            <div>No notes yet</div>
          ) : (
            <div className="note-list">
              {notes.map((n) => (
                <div key={n.id} className="note-item">
                  <div className="note-item-main" onClick={() => openNote(n)}>
                    <div className="note-item-title">{n.title || "(untitled)"}</div>
                    {n.body && <div className="note-item-body">{n.body}</div>}
                    
                    {/* Show image thumbnail */}
                    {n.fileUrl && isImage(n.contentType) && (
                      <img 
                        src={n.fileUrl} 
                        alt={n.fileName || 'attachment'}
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
                    <button className="btn btn-blue" onClick={() => openNote(n)}>
                      Open
                    </button>
                    <button className="btn btn-blue" onClick={() => handleDelete(n)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal code remains the same */}
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
                <h3 className="note-modal-title">{selected.title || "(untitled)"}</h3>
              )}

              <div className="note-modal-actions">
                {!isEditing ? (
                  <button className="btn btn-blue" onClick={() => setIsEditing(true)}>
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

              {/* Display attachment */}
              {selected.fileUrl && (
                <div className="note-modal-attachment">
                  <div className="attachment-label">📎 Attachment</div>
                  
                  {isImage(selected.contentType) ? (
                    <div>
                      <img 
                        src={selected.fileUrl} 
                        alt={selected.fileName || 'attachment'}
                        className="attachment-image"
                      />
                      <div className="attachment-info">
                        {selected.fileName} ({(selected.fileSize! / 1024).toFixed(1)} KB)
                      </div>
                    </div>
                  ) : (
                    <a 
                      href={selected.fileUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="attachment-link"
                    >
                      📄 {selected.fileName} ({(selected.fileSize! / 1024).toFixed(1)} KB)
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
