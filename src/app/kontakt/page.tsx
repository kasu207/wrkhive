import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { ContactForm } from "@/components/contact";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Kontakt" };

export default async function KontaktPage() {
  const user = await getCurrentUser();
  const defaults = user && !user.isDemo ? { name: user.name, email: user.email } : undefined;

  return (
    <div className="min-h-dvh bg-surface">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Link href="/" aria-label="Wrkhive Startseite">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-[560px] px-5 pb-20 pt-6 sm:px-8">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-ink">Kontakt</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">
          Fragen, Feedback oder ein Problem mit Wrkhive? Schreib mir hier oder per E-Mail an{" "}
          <a href="mailto:info@wrkhive.cloud" className="text-ink underline underline-offset-2">
            info@wrkhive.cloud
          </a>
          .
        </p>
        <div className="mt-8">
          <ContactForm defaults={defaults} />
        </div>
        <p className="mt-10 text-[13px] text-ink-3">
          <Link href="/impressum" className="hover:text-ink">
            Impressum
          </Link>
        </p>
      </main>
    </div>
  );
}
