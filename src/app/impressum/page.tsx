import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand";

export const metadata: Metadata = {
  title: "Impressum",
  robots: { index: true, follow: true },
};

// Angaben gemäß § 5 DDG.
const ANBIETER = {
  name: "Philipp Richter",
  strasse: "Franz-Schubert-Straße 11",
  ort: "06108 Halle (Saale)",
  land: "Deutschland",
  email: "info@wrkhive.cloud",
  telefon: null as string | null, // optional: zweiter schneller Kontaktweg
  ustId: null as string | null, // z. B. "DE123456789", nur falls vorhanden
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

export default function ImpressumPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="flex h-16 items-center px-5 sm:px-8">
        <Link href="/" aria-label="Wrkhive Startseite">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-[680px] px-5 pb-20 pt-6 sm:px-8">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-ink">Impressum</h1>

        <Section title="Angaben gemäß § 5 DDG">
          <p>
            {ANBIETER.name}
            <br />
            {ANBIETER.strasse}
            <br />
            {ANBIETER.ort}
            <br />
            {ANBIETER.land}
          </p>
        </Section>

        <Section title="Kontakt">
          <p>
            {ANBIETER.telefon ? (
              <>
                Telefon: {ANBIETER.telefon}
                <br />
              </>
            ) : null}
            E-Mail:{" "}
            <a href={`mailto:${ANBIETER.email}`} className="text-ink underline underline-offset-2">
              {ANBIETER.email}
            </a>
            <br />
            Kontaktformular:{" "}
            <Link href="/kontakt" className="text-ink underline underline-offset-2">
              wrkhive.cloud/kontakt
            </Link>
          </p>
        </Section>

        {ANBIETER.ustId ? (
          <Section title="Umsatzsteuer-ID">
            <p>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG: {ANBIETER.ustId}</p>
          </Section>
        ) : null}

        <Section title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
          <p>
            {ANBIETER.name}, Anschrift wie oben
          </p>
        </Section>

        <Section title="Verbraucherstreitbeilegung">
          <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
        </Section>

        <Section title="Haftung für Inhalte">
          <p>
            Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Wir sind jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen entfernen wir diese Inhalte umgehend.
          </p>
        </Section>

        <Section title="Haftung für Links">
          <p>
            Unser Angebot enthält Links zu externen Websites Dritter (z. B. Garmin, Wahoo, intervals.icu), auf deren Inhalte wir keinen Einfluss haben. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich. Bei Bekanntwerden von Rechtsverletzungen entfernen wir derartige Links umgehend.
          </p>
        </Section>

        <Section title="Marken">
          <p>Garmin, Wahoo und Zwift sind Marken ihrer jeweiligen Inhaber. Wrkhive ist ein unabhängiges Produkt und steht in keiner geschäftlichen Verbindung zu diesen Unternehmen.</p>
        </Section>
      </main>
    </div>
  );
}
