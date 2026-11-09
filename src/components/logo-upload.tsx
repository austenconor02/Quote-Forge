"use client";
import { useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";

export function LogoUpload({ value, name, onChange }: { value: string; name: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  async function load(file?: File) {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 4 * 1024 * 1024) { setError("Choose a PNG, JPG, or WebP logo smaller than 4 MB."); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const ratio = Math.min(512 / bitmap.width, 512 / bitmap.height, 1);
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      onChange(canvas.toDataURL("image/png"));
    } catch { setError("This image couldn’t be read. Try a different file."); }
    if (input.current) input.current.value = "";
  }
  return <div className="logo-upload-wrap"><div className="logo-uploader" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void load(e.dataTransfer.files[0]); }}><div className="logo-upload-preview">{value ? <img src={value} alt={`${name || "Company"} logo preview`}/> : <ImagePlus size={29}/>}</div><div><strong>Your logo. Their first impression.</strong><p>Drop an image here, or choose a file.</p><span>PNG, JPG, or WebP · Up to 4 MB</span></div><div className="logo-upload-actions"><button type="button" className="button secondary small" onClick={() => input.current?.click()}><Upload size={14}/>{value ? "Replace" : "Upload logo"}</button>{value && <button type="button" className="icon-button" aria-label="Remove logo" onClick={() => onChange("")}><X size={16}/></button>}</div><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Upload company logo" onChange={e => void load(e.target.files?.[0])}/></div>{error && <p role="alert" className="form-error">{error}</p>}</div>;
}
