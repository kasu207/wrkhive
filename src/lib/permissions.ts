/** Human-readable warnings for permissions a user did not grant at the provider. */
const REQUIRED: Record<"garmin" | "wahoo" | "intervals", { key: string; label: string }[]> = {
  garmin: [
    { key: "WORKOUT_IMPORT", label: "Workouts an Garmin senden (Workout-Import)" },
    { key: "ACTIVITY_EXPORT", label: "Aktivitäten an Wrkhive übertragen (Activity-Export)" },
  ],
  wahoo: [
    { key: "plans_write", label: "Trainingspläne anlegen (plans_write)" },
    { key: "workouts_write", label: "Workouts planen (workouts_write)" },
    { key: "workouts_read", label: "Aktivitäten lesen (workouts_read)" },
  ],
  // Personal API keys carry full access to the athlete's own account.
  intervals: [],
};

export function missingPermissions(provider: "garmin" | "wahoo" | "intervals", scopes: string | null | undefined): string[] {
  // Unknown scope list (provider did not report it): assume everything was granted.
  if (!scopes) return [];
  const granted = new Set(scopes.split(/[\s,]+/).filter(Boolean));
  return REQUIRED[provider].filter((r) => !granted.has(r.key)).map((r) => r.label);
}
