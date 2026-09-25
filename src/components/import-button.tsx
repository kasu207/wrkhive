"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface ImportResult {
  files: number;
  activities: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  error?: string;
}

/** Uploads FIT / ZIP files to the activity import endpoint. */
export function ImportButton({ variant = "secondary", label = "FIT-Dateien importieren" }: { variant?: "secondary" | "primary"; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      const body = new FormData();
      for (const f of Array.from(list)) body.append("files", f);
      const res = await fetch("/api/activities/import", { method: "POST", body });
      const data = (await res.json()) as ImportResult;
      if (!res.ok) {
        toast({ tone: "error", title: "Import fehlgeschlagen", description: data.error ?? `Fehler ${res.status}` });
        return;
      }
      const parts = [`${data.inserted} neu`];
      if (data.updated) parts.push(`${data.updated} aktualisiert`);
      if (data.skipped) parts.push(`${data.skipped} bereits vorhanden`);
      toast({
        tone: data.errors.length && !data.activities ? "error" : "success",
        title: data.activities ? `${data.activities} Aktivität${data.activities === 1 ? "" : "en"} gelesen` : "Keine Aktivitäten gefunden",
        description: [parts.join(", "), ...data.errors.slice(0, 3)].join(" · "),
      });
      router.refresh();
    } catch {
      toast({ tone: "error", title: "Import fehlgeschlagen", description: "Netzwerkfehler." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input ref={input} type="file" accept=".fit,.zip,application/zip,application/vnd.ant.fit" multiple hidden onChange={(e) => upload(e.target.files)} />
      <Button variant={variant} onClick={() => input.current?.click()} loading={busy}>
        {busy ? null : <Upload />}
        {label}
      </Button>
    </>
  );
}
