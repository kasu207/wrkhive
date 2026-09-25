import { describe, expect, it } from "vitest";
import { garminSport, normalizeGarminActivity } from "./garmin";
import { localNoonInstant } from "./http";
import { intervalsSport, normalizeAthleteId, normalizeIntervalsActivity, packIntervalsToken, unpackIntervalsToken } from "./intervals";
import { normalizeWahooWorkout, wahooWorkoutType } from "./wahoo";

describe("Garmin", () => {
  it("maps activity types", () => {
    expect(garminSport("ROAD_BIKING")).toBe("ride");
    expect(garminSport("INDOOR_CYCLING")).toBe("ride");
    expect(garminSport("VIRTUAL_RIDE")).toBe("ride");
    expect(garminSport("TRAIL_RUNNING")).toBe("run");
    expect(garminSport("TREADMILL_RUNNING")).toBe("run");
    expect(garminSport("STRENGTH_TRAINING")).toBe("strength");
    expect(garminSport("MOTORCYCLING")).toBe("other");
    expect(garminSport("YOGA")).toBe("other");
  });
  it("normalizes an activity summary", () => {
    const a = normalizeGarminActivity({ summaryId: "x", activityId: 42, activityType: "RUNNING", startTimeInSeconds: 1_700_000_000, startTimeOffsetInSeconds: 3600, durationInSeconds: 2700, distanceInMeters: 9000, averageHeartRateInBeatsPerMinute: 148 });
    expect(a).toMatchObject({ externalId: "42", sport: "run", durationSec: 2700, distanceM: 9000, avgHr: 148, utcOffsetSec: 3600, name: "Lauf" });
  });
});

describe("Wahoo", () => {
  it("normalizes a workout with summary (string fields)", () => {
    const a = normalizeWahooWorkout({
      id: 7,
      starts: "2026-05-01T06:00:00.000Z",
      workout_type_id: 12,
      workout_summary: { duration_total_accum: "3600.0", duration_active_accum: "3500", distance_accum: "30000.5", power_bike_avg: "210.4", heart_rate_avg: "140", ascent_accum: "0.0" },
    });
    expect(a).toMatchObject({ externalId: "7", sport: "ride", durationSec: 3600, movingSec: 3500, distanceM: 30000.5, avgPower: 210, avgHr: 140, elevationGainM: 0 });
  });
  it("ignores workouts without summary", () => {
    expect(normalizeWahooWorkout({ id: 1, starts: "2026-05-01T06:00:00Z", workout_type_id: 0, workout_summary: null })).toBeNull();
  });
});

describe("local noon", () => {
  it("anchors a calendar day at noon in the athlete's zone (DST aware)", () => {
    expect(localNoonInstant("2026-07-01", "Europe/Berlin").toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(localNoonInstant("2026-12-01", "Europe/Berlin").toISOString()).toBe("2026-12-01T11:00:00.000Z");
    expect(localNoonInstant("2026-12-01", "America/Los_Angeles").toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });
});

describe("Wahoo workout types", () => {
  it("marks trainer rides as BIKING_INDOOR_TRAINER", () => {
    expect(wahooWorkoutType("ride", true)).toBe(61);
    expect(wahooWorkoutType("ride", false)).toBe(0);
    expect(wahooWorkoutType("run", true)).toBe(1);
  });
});

describe("intervals.icu", () => {
  it("normalizes athlete ids from input or profile URLs", () => {
    expect(normalizeAthleteId(" i12345 ")).toBe("i12345");
    expect(normalizeAthleteId("I12345")).toBe("i12345");
    expect(normalizeAthleteId("https://intervals.icu/athlete/i777/activities")).toBe("i777");
    expect(normalizeAthleteId("")).toBe("0");
    expect(normalizeAthleteId("abc")).toBeNull();
  });
  it("packs the token so keys containing colons survive", () => {
    expect(unpackIntervalsToken(packIntervalsToken("i1", "a:b"))).toEqual({ athleteId: "i1", apiKey: "a:b" });
    expect(() => unpackIntervalsToken("nokey")).toThrow();
  });
  it("maps sport types", () => {
    expect(intervalsSport("VirtualRide")).toBe("ride");
    expect(intervalsSport("GravelRide")).toBe("ride");
    expect(intervalsSport("TrailRun")).toBe("run");
    expect(intervalsSport("WeightTraining")).toBe("strength");
    expect(intervalsSport("Swim")).toBe("other");
  });
  it("normalizes an activity with local offset", () => {
    const a = normalizeIntervalsActivity({
      id: "i42",
      name: "Rolle",
      type: "VirtualRide",
      start_date_local: "2026-05-01T18:00:00",
      start_date: "2026-05-01T16:00:00Z",
      moving_time: 3500,
      elapsed_time: 3600,
      distance: 32000,
      icu_average_watts: 201.4,
      icu_weighted_avg_watts: 215,
      average_heartrate: 141,
    });
    expect(a).toMatchObject({ externalId: "i42", sport: "ride", durationSec: 3600, movingSec: 3500, utcOffsetSec: 7200, avgPower: 201, normPower: 215, avgHr: 141 });
    expect(a!.startTime.toISOString()).toBe("2026-05-01T16:00:00.000Z");
  });
  it("skips Strava stubs", () => {
    expect(normalizeIntervalsActivity({ id: "x", source: "STRAVA" })).toBeNull();
  });
});
