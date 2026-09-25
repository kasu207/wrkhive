import { eq } from "drizzle-orm";
import { after } from "next/server";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/db";
import { deviceConnections } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { syncConnection } from "@/lib/server/sync";

const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  // Continuous sync: refresh stale connections in the background after the response.
  const stale = getDb()
    .select()
    .from(deviceConnections)
    .where(eq(deviceConnections.userId, user.id))
    .all()
    .filter((c) => c.autoSync && c.status !== "revoked" && (!c.lastSyncAt || Date.now() - c.lastSyncAt.getTime() > AUTO_SYNC_INTERVAL_MS));
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
