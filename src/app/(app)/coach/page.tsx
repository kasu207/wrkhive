import type { Metadata } from "next";
import { CoachView } from "@/components/coach/coach-view";
import { PageHeader } from "@/components/ui/card";
import { requireUser, thresholdsOf } from "@/lib/server/auth";
import { coachHistory } from "@/lib/server/coach";
import { env } from "@/lib/server/env";

export const metadata: Metadata = { title: "Coach" };
// AI responses can take a while (plans with many sessions).
export const maxDuration = 300;

export default async function CoachPage(props: PageProps<"/coach">) {
  const user = await requireUser();
  const { tab } = await props.searchParams;
  const messages = coachHistory(user.id);
  return (
    <div className="animate-fade-up">
      <PageHeader title="Coach" description="Spontane Workouts und langfristige Pläne, abgestimmt auf deine aktuelle Form." />
      <CoachView
        messages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, payload: m.payload ?? null }))}
        thresholds={thresholdsOf(user)}
        engine={env.anthropicConfigured() ? "ai" : "rules"}
        initialTab={tab === "plan" ? "plan" : "chat"}
      />
    </div>
  );
}
