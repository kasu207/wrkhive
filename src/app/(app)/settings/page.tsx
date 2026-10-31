import type { Metadata } from "next";
import Link from "next/link";
import { AutoAdaptCard } from "@/components/auto-adapt-card";
import { ContactInbox } from "@/components/contact";
import { GoalsCard } from "@/components/goals-card";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui/card";
import { goalsOf } from "@/lib/goals";
import { CURRENT_VERSION } from "@/lib/release-notes";
import { isInstallationOwner, requireUser } from "@/lib/server/auth";
import { listContactMessages } from "@/lib/server/contact";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const user = await requireUser();
  const inbox = isInstallationOwner(user) ? listContactMessages() : null;
  return (
    <div className="animate-fade-up">
      <PageHeader title="Einstellungen" description={user.isDemo ? "Demo-Konto" : user.email} />
      {inbox ? (
        <div className="mb-5">
          <ContactInbox messages={inbox} />
        </div>
      ) : null}
      <div className="mb-5">
        <GoalsCard initial={goalsOf(user.goals)} initialNote={user.goalNote ?? ""} />
      </div>
      <div className="mb-5">
        <AutoAdaptCard initial={user.autoAdapt} />
      </div>
      <SettingsForm
        isDemo={user.isDemo}
        initial={{
          name: user.name,
          ftp: user.ftp,
          lthr: user.lthr,
          maxHr: user.maxHr,
          restHr: user.restHr,
          thresholdPace: user.thresholdPace,
          weightKg: user.weightKg,
          baselineWeeklyHours: user.baselineWeeklyHours,
          timeZone: user.timeZone,
        }}
      />
      <p className="mt-8 text-center text-[12px] text-ink-3">
        <Link href="/release-notes" className="hover:text-ink-2">
          Neuigkeiten · Version {CURRENT_VERSION}
        </Link>
        <span className="lg:hidden">
          {" · "}
          <Link href="/impressum" className="hover:text-ink-2">
            Impressum
          </Link>
          {" · "}
          <Link href="/kontakt" className="hover:text-ink-2">
            Kontakt
          </Link>
        </span>
      </p>
    </div>
  );
}
