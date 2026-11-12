"use client";

import { useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { uploadStudioImage } from "@/components/studio/imageUpload";
import { Button, Field, TextInput } from "@/components/studio/ui";
import { cn } from "@/lib/utils";

export interface PickedImage {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
}

/**
 * Upload / replace / remove one image, with the "describe this image" box
 * right under it (alt text — good for Google and screen readers).
 */
export function ImagePicker({
  value,
  onChange,
  label,
  help,
  purpose = "blog",
  aspect = "aspect-[16/9]",
  withAlt = true,
  disabled,
}: {
  value: PickedImage | null | undefined;
  onChange: (v: PickedImage | null) => void;
  label: string;
  help?: string;
  purpose?: "blog" | "page";
  aspect?: string;
  withAlt?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);

  const handle = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const up = await uploadStudioImage(file, { purpose, maxWidth: purpose === "page" ? 1200 : 1600 });
      onChange({ url: up.url, width: up.width, height: up.height, alt: value?.alt || "" });
    } catch (e: any) {
      setError(e?.message || "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <Field label={label} help={help}>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!disabled) handle(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "relative overflow-hidden rounded-xl border-2 border-dashed bg-surface-container-low",
            aspect,
            drag ? "border-primary bg-primary-fixed" : "border-outline-variant"
          )}
        >
          {value?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.url} alt={value.alt || ""} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => input.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-on-surface-variant hover:text-primary"
            >
              <MaterialIcon name="add_photo_alternate" size={34} />
              <span className="font-semibold">Click to upload, or drag an image here</span>
              <span className="text-xs">JPG, PNG, WebP or GIF. We shrink it automatically.</span>
            </button>
          )}
          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-sm font-semibold text-on-surface">
              <MaterialIcon name="progress_activity" size={22} className="mr-2 animate-spin" /> Uploading…
            </div>
          )}
        </div>
      </Field>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {value?.url && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" icon="upload" onClick={() => input.current?.click()} disabled={disabled || busy}>
            Replace
          </Button>
          <Button type="button" variant="danger" icon="delete" onClick={() => onChange(null)} disabled={disabled || busy}>
            Remove
          </Button>
        </div>
      )}
      {withAlt && value?.url && (
        <Field label="Describe this image" help="A few words about what the picture shows, e.g. “Dentist talking to a patient at the front desk”.">
          <TextInput
            value={value.alt || ""}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, alt: e.target.value })}
            placeholder="What is in the picture?"
          />
        </Field>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}
