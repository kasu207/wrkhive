import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/onboarding";
import { isInstallationOwner, requireUser } from "@/lib/server/auth";
import { env } from "@/lib/server/env";
import { PROVIDERS } from "@/lib/server/sync";

export const metadata: Metadata = { title: "Willkommen" };

export default async function WelcomePage() {
  const user = await requireUser();
  if (user.onboardedAt || user.isDemo) redirect("/dashboard");
  const pace = user.thresholdPace;
  return (
    <div className="animate-fade-up py-2 sm:py-6">
      <Onboarding
        name={user.name}
        // Wahoo works directly once the owner registers a personal app (or it is configured on the server).
        directAvailable={{ garmin: PROVIDERS.garmin.isConfigured(), wahoo: PROVIDERS.wahoo.isConfigured() || (isInstallationOwner(user) && env.wahoo().source !== "env") }}
        defaults={{ ftp: user.ftp, lthr: user.lthr, pace: `${Math.floor(pace / 60)}:${String(pace % 60).padStart(2, "0")}` }}
      />
    </div>
  );
}
