/**
 * Runs once per server start. Starts the background sync scheduler in the
 * Node.js runtime so self-hosted installs (Docker) pull new activities without
 * an external cron job.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production" && process.env.SYNC_SCHEDULER !== "on") return;
  const { startSyncScheduler } = await import("./lib/server/scheduler");
  startSyncScheduler();
}
