"use client";

import { Check, Mail, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useTransition } from "react";
import { deleteContactMessage, sendContactMessage, setContactMessageRead, type ContactState } from "@/app/actions/contact";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

export function ContactForm({ defaults }: { defaults?: { name: string; email: string } }) {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContactMessage, undefined);

  if (state?.ok) {
    return (
      <div className="rounded-xl border border-[#c9e9c9] bg-good-soft p-5 text-[15px] text-good-ink" role="status">
        <p className="font-semibold">Danke, deine Nachricht ist angekommen.</p>
        <p className="mt-1">Ich melde mich so schnell wie möglich per E-Mail bei dir.</p>
      </div>
    );
  }

  const fe = state?.fieldErrors;
  const v = state?.values;
  return (
    <form action={action} className="space-y-4">
      {/* Honeypot for bots, hidden from people and assistive tech. */}
      <div className="absolute -left-[9999px]" aria-hidden>
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <Field label="Name" htmlFor="contact-name" error={fe?.name}>
        <Input id="contact-name" name="name" autoComplete="name" required maxLength={100} defaultValue={v?.name ?? defaults?.name} aria-invalid={!!fe?.name} />
      </Field>
      <Field label="E-Mail" htmlFor="contact-email" error={fe?.email} hint="Dorthin schicke ich meine Antwort.">
        <Input id="contact-email" name="email" type="email" autoComplete="email" required maxLength={200} defaultValue={v?.email ?? defaults?.email} aria-invalid={!!fe?.email} />
      </Field>
      <Field label="Nachricht" htmlFor="contact-message" error={fe?.message}>
        <Textarea id="contact-message" name="message" required minLength={10} maxLength={5000} rows={6} defaultValue={v?.message} aria-invalid={!!fe?.message} />
      </Field>
      {state?.error ? (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical-ink" role="alert">
          {state.error}
        </p>
      ) : null}
      <p className="text-[13px] leading-relaxed text-ink-3">
        Deine Angaben werden nur gespeichert, um deine Anfrage zu beantworten, und danach gelöscht.
      </p>
      <Button type="submit" size="lg" loading={pending}>
        Nachricht senden
      </Button>
    </form>
  );
}

type InboxMessage = { id: string; name: string; email: string; message: string; createdAt: Date; readAt: Date | null };

const dateFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function ContactInbox({ messages }: { messages: InboxMessage[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const unread = messages.filter((m) => !m.readAt).length;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast({ tone: "error", title: "Fehler", description: r.error });
      router.refresh();
    });
  }

  return (
    <Card id="kontaktanfragen" className="pb-2">
      <CardHeader
        title="Kontaktanfragen"
        description={messages.length ? `${unread} ungelesen · ${messages.length} insgesamt` : "Nachrichten aus dem Kontaktformular landen hier."}
      />
      {messages.length ? (
        <ul className="mt-3 divide-y divide-border">
          {messages.map((m) => (
            <li key={m.id} className={cn("px-5 py-4", pending && "opacity-70")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                    {m.name}
                    {!m.readAt ? <Badge tone="brand">Neu</Badge> : null}
                  </p>
                  <p className="text-[13px] text-ink-3">
                    {m.email} · {dateFmt.format(m.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <a
                    href={`mailto:${m.email}?subject=${encodeURIComponent("Deine Nachricht an Wrkhive")}`}
                    className={buttonClass("ghost", "icon-sm")}
                    aria-label="Per E-Mail antworten"
                    title="Per E-Mail antworten"
                    onClick={() => {
                      if (!m.readAt) run(() => setContactMessageRead(m.id, true));
                    }}
                  >
                    <Mail />
                  </a>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.readAt ? "Als ungelesen markieren" : "Als gelesen markieren"}
                    title={m.readAt ? "Als ungelesen markieren" : "Als gelesen markieren"}
                    onClick={() => run(() => setContactMessageRead(m.id, !m.readAt))}
                  >
                    <Check className={m.readAt ? "text-good" : undefined} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Löschen"
                    title="Löschen"
                    onClick={() => {
                      if (confirm(`Nachricht von ${m.name} endgültig löschen?`)) run(() => deleteContactMessage(m.id));
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{m.message}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
