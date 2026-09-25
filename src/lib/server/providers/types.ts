import type { DeviceConnection, User } from "@/db/schema";
import type { SourceAppId } from "@/lib/apps";
import type { WorkoutStructure } from "@/lib/workout/types";

export type ProviderId = "garmin" | "wahoo" | "intervals";

/** Activity as delivered by a provider, before load metrics are derived. */
export interface NormalizedActivity {
  externalId: string;
  sport: "ride" | "run" | "strength" | "other";
  name: string;
  startTime: Date;
  /** Offset of the local time zone in seconds, if known (for the calendar day). */
  utcOffsetSec?: number | null;
  durationSec: number;
  movingSec?: number | null;
  distanceM?: number | null;
  elevationGainM?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgPower?: number | null;
  normPower?: number | null;
  avgCadence?: number | null;
  avgSpeed?: number | null;
  calories?: number | null;
  hrZoneSec?: number[] | null;
  deviceName?: string | null;
  /** App or device the activity was recorded with (see lib/apps.ts). */
  sourceApp?: SourceAppId | null;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string | null;
}

export interface ConnectedAccount {
  externalUserId: string;
  displayName: string | null;
  /** Permissions the user granted at the provider (e.g. Garmin WORKOUT_IMPORT). */
  permissions?: string[];
}

export interface SendInput {
  name: string;
  description: string;
  structure: WorkoutStructure;
  /** Scheduled calendar day (YYYY-MM-DD) or null for "library only". */
  date: string | null;
  /** IANA time zone of the athlete, used to anchor the scheduled day. */
  timeZone: string;
  user: User;
  workoutId: string;
  /** Ride on a smart trainer (indoor, ERG) rather than outdoors. */
  indoor: boolean;
}

export interface SendResult {
  externalIds: Record<string, string | number>;
  message: string;
}

export interface SyncResult {
  activities: NormalizedActivity[];
  /** True when the provider delivers data asynchronously (webhooks/backfill). */
  asyncRequested?: boolean;
  message?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  /** Devices users recognize, for the UI. */
  devices: string[];
  /** "oauth": server-side app credentials + OAuth; "apikey": the athlete enters a personal API key. */
  auth: "oauth" | "apikey";
  /** True when OAuth credentials are configured; otherwise demo mode is used. */
  isConfigured(): boolean;
  authorizeUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  account(accessToken: string): Promise<ConnectedAccount>;
  /** Returns reasons why the workout cannot be sent, or [] if it can. */
  compatibility(structure: WorkoutStructure, date: string | null): string[];
  send(accessToken: string, input: SendInput): Promise<SendResult>;
  sync(accessToken: string, connection: DeviceConnection, since: Date): Promise<SyncResult>;
  revoke(accessToken: string): Promise<void>;
  /** API-key providers: validates the key and returns the account plus the token to store. */
  connectWithKey?(input: { athleteId: string; apiKey: string }): Promise<ConnectedAccount & { token: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly authExpired = false,
  ) {
    super(message);
  }
}
