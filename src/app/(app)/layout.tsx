import { after } from "next/server";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/server/auth";
import { staleConnections, syncConnection } from "@/lib/server/sync";

const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  // Continuous sync: refresh stale connections in the background after the response.
  const stale = staleConnections(user.id, AUTO_SYNC_INTERVAL_MS);
  if (stale.length) {
    after(async () => {
      for (const c of stale) await syncConnection(c);
    });
  }

  return (
    <AppShell user={{ name: user.name, email: user.email }} demo={user.isDemo}>
      {children}
    </AppShell>
  );
}
