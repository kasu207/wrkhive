/**
 * Runs once per server start. Removes stray sample data (see
 * lib/server/demo-cleanup.ts) and starts the background sync scheduler in the
 * Node.js runtime so self-hosted installs (Docker) pull new activities without
 * an external cron job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { purgeStrayDemoData } = await import("./lib/server/demo-cleanup");
  try {
    const purged = purgeStrayDemoData();
    if (purged.users) console.log(`[wrkhive] removed sample data from ${purged.users} account(s): ${purged.connections} demo connection(s), ${purged.activities} activities`);
  } catch (e) {
    console.error("[wrkhive] demo cleanup failed", e);
  }
  if (process.env.NODE_ENV !== "production" && process.env.SYNC_SCHEDULER !== "on") return;
  const { startSyncScheduler } = await import("./lib/server/scheduler");
  startSyncScheduler();
}
