"use client";

import { useRef, useState } from "react";

interface UploadCardProps {
  file: File | null;
  previewUrl: string | null;
  onFile: (file: File | null) => void;
  hint: string;
}

export function UploadCard({ file, previewUrl, onFile, hint }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`doc-card p-5 text-center transition-colors ${
        dragOver ? "bg-[var(--color-paper-3)]" : ""
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />

      {previewUrl ? (
        <div className="space-y-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Selected media preview"
            className="max-h-56 mx-auto border border-[var(--color-rule)]"
          />
          <p className="mono text-[0.75rem] text-[var(--color-ink-soft)] break-all">
            {file?.name}
          </p>
          <button type="button" className="btn btn-ghost" onClick={() => onFile(null)}>
            Choose a different file
          </button>
        </div>
      ) : (
        <div className="py-8 space-y-3">
          <p className="eyebrow">Drop an image here</p>
          <p className="text-[var(--color-ink-soft)] text-sm max-w-xs mx-auto">{hint}</p>
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Select file
          </button>
        </div>
      )}
    </div>
  );
}
