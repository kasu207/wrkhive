import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth-forms";
import { registrationOpen } from "@/lib/server/access";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Registrieren" };

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  if (!registrationOpen()) {
    return (
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Registrierung geschlossen</h1>
        <p className="mb-7 mt-1.5 text-[15px] leading-relaxed text-ink-2">Auf diesem Server werden keine neuen Konten angelegt.</p>
        <Link href="/login" className="font-semibold text-ink underline-offset-4 hover:underline">
          Zur Anmeldung
        </Link>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Konto erstellen</h1>
      <p className="mb-7 mt-1.5 text-[15px] text-ink-2">In einer Minute startklar. Kostenlos.</p>
      <SignupForm />
      <p className="mt-8 text-center text-sm text-ink-2">
        Schon registriert?{" "}
        <Link href="/login" className="font-semibold text-ink underline-offset-4 hover:underline">
          Anmelden
        </Link>
      </p>
    </div>
  );
}
