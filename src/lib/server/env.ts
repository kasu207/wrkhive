import "server-only";

export const env = {
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  anthropicConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
  coachModel: () => process.env.COACH_MODEL ?? "claude-opus-5",
  garmin: () => ({
    clientId: process.env.GARMIN_CLIENT_ID ?? "",
    clientSecret: process.env.GARMIN_CLIENT_SECRET ?? "",
  }),
  wahoo: () => ({
    clientId: process.env.WAHOO_CLIENT_ID ?? "",
    clientSecret: process.env.WAHOO_CLIENT_SECRET ?? "",
    webhookToken: process.env.WAHOO_WEBHOOK_TOKEN ?? "",
  }),
  cronSecret: () => process.env.CRON_SECRET ?? "",
};
