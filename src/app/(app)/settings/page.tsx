import type { Metadata } from "next";
import { AutoAdaptCard } from "@/components/auto-adapt-card";
import { SettingsForm } from "@/components/settings-form";
import { PageHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/server/auth";

export const metadata: Metadata = { title: "Einstellungen" };

export default async function SettingsPage() {
  const user = await requireUser();
  return (
    <div className="animate-fade-up">
      <PageHeader title="Einstellungen" description={user.isDemo ? "Demo-Konto" : user.email} />
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
          timeZone: user.timeZone,
        }}
      />
    </div>
  );
}
