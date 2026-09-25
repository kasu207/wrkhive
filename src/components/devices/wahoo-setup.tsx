"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState, useTransition } from "react";
import { connectDevice, removeWahooApp, saveWahooApp } from "@/app/actions/devices";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

export interface WahooSelfService {
  /** The current user may register the installation's Wahoo app. */
  allowed: boolean;
  /** Where the credentials come from right now. */
  source: "env" | "ui" | null;
  redirectUri: string;
  scopes: string;
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium text-ink-3">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 break-all text-[12.5px] text-ink">{value}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable (e.g. plain http): the value stays selectable */
            }
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface hover:text-ink"
          aria-label={`${label} kopieren`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}

/**
 * One-time setup for self-hosted installs: the owner registers a personal,
 * free Wahoo developer app (sandbox, available immediately) and pastes its
 * credentials here. Afterwards Wahoo is connected like any OAuth provider.
 */
export function WahooSetupDialog({ open, onClose, setup }: { open: boolean; onClose: () => void; setup: WahooSelfService }) {
  const toast = useToast();
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveWahooApp(clientId, secret);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const c = await connectDevice("wahoo");
      if (!c.ok) {
        setError(c.error);
        return;
      }
      window.location.href = c.data!.url;
    });

  const remove = () =>
    start(async () => {
      const r = await removeWahooApp();
      if (!r.ok) return toast({ tone: "error", title: "Fehler", description: r.error });
      toast({ tone: "success", title: "Wahoo-App entfernt" });
      onClose();
      window.location.reload();
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Wahoo direkt verbinden"
      description="Einmalig, etwa 5 Minuten. Danach landen Workouts mit einem Klick auf deinem ELEMNT."
      footer={
        <>
          {setup.source === "ui" ? (
            <Button variant="ghost" onClick={remove} disabled={pending} className="mr-auto text-critical-ink hover:bg-critical-soft hover:text-critical-ink">
              App entfernen
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={save} loading={pending} disabled={!clientId.trim() || !secret.trim()}>
            Speichern und verbinden
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (clientId.trim() && secret.trim()) save();
        }}
      >
        <p className="text-[14px] leading-relaxed text-ink-2">
          Wahoo gibt Workouts nur an registrierte Apps weiter. Für den eigenen Gebrauch legst du dir dafür kostenlos eine persönliche App an. Sie ist sofort nutzbar, Wahoo muss nichts prüfen.
        </p>
        <ol className="space-y-4 text-[14px] leading-relaxed text-ink-2">
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">1</span>
            <span>
              Im{" "}
              <a href="https://developers.wahooligan.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-focus hover:underline">
                Wahoo-Entwicklerportal <ExternalLink className="size-3" />
              </a>{" "}
              kostenlos registrieren und anmelden.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">2</span>
            <span>
              Unter <strong className="font-medium text-ink">My Apps</strong> auf <strong className="font-medium text-ink">Add a new app</strong>: Name „Wrkhive“, Typ <strong className="font-medium text-ink">Confidential</strong>, Umgebung{" "}
              <strong className="font-medium text-ink">Sandbox</strong>.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">3</span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <span>Diese Werte übernehmen:</span>
              <CopyValue label="Redirect URI" value={setup.redirectUri} />
              <CopyValue label="Scopes" value={setup.scopes} />
            </div>
          </li>
          <li className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-white">4</span>
            <span>App speichern und Client-ID und Client-Secret hier einfügen.</span>
          </li>
        </ol>
        <div className="space-y-3">
          <Field label="Client-ID" htmlFor="wahoo-client-id">
            <Input id="wahoo-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Client-Secret" htmlFor="wahoo-client-secret" error={error ?? undefined}>
            <Input id="wahoo-client-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!error} />
          </Field>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-3">
          Sandbox-Apps erlauben bis zu 250 Abfragen am Tag. Das reicht für das Senden von Workouts und den Abgleich alle 30 Minuten. Das Secret wird verschlüsselt gespeichert. Lehnt Wahoo die Redirect URI ab, weil sie mit http beginnt, richte den HTTPS-Tunnel aus der Anleitung ein und trage die https-Adresse ein.
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
