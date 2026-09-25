"use client";

import { useActionState, useState } from "react";
import { login, signup, startDemo, type AuthState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** Hidden field filled with the browser's time zone after mount. */
function TimeZoneField() {
  return (
    <input
      type="hidden"
      name="timeZone"
      ref={(el) => {
        if (el) el.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }}
    />
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, undefined);
  return (
    <form action={action} className="space-y-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="E-Mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Passwort" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
      </Field>
      {state?.error ? <p className="rounded-lg bg-critical-soft px-3 py-2 text-[13px] text-critical-ink" role="alert">{state.error}</p> : null}
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Anmelden
      </Button>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(signup, undefined);
  return (
    <form action={action} className="space-y-4">
      <TimeZoneField />
      <Field label="Name" htmlFor="name" error={state?.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="given-name" required autoFocus aria-invalid={!!state?.fieldErrors?.name} />
      </Field>
      <Field label="E-Mail" htmlFor="email" error={state?.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!state?.fieldErrors?.email} />
      </Field>
      <Field label="Passwort" htmlFor="password" error={state?.fieldErrors?.password} hint="Mindestens 8 Zeichen">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} aria-invalid={!!state?.fieldErrors?.password} />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Konto erstellen
      </Button>
    </form>
  );
}

export function DemoButton({ variant = "secondary", size = "lg", className, children = "Demo ansehen" }: { variant?: "secondary" | "primary" | "brand" | "ghost"; size?: "md" | "lg"; className?: string; children?: React.ReactNode }) {
  const [pending, setPending] = useState(false);
  return (
    <form action={startDemo} onSubmit={() => setPending(true)}>
      <TimeZoneField />
      <Button type="submit" variant={variant} size={size} className={className} loading={pending}>
        {children}
      </Button>
    </form>
  );
}
