import { Encoder, Profile, type FileIdMesg, type RecordMesg, type SessionMesg } from "@garmin/fitsdk";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ascentFromAltitudes, decodeFitActivity, expandUploads, normalizedPowerFromRecords } from "./activity";

const START = new Date("2026-06-01T06:00:00Z");

/** Builds a realistic 1 Hz ride: 10 min steady 200 W, 5 min at 300 W, climbing 100 m. */
function rideFit(opts: { session: boolean; manufacturer?: string; spikes?: boolean }) {
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: opts.manufacturer ?? "wahooFitness", product: 1, timeCreated: START } as unknown as FileIdMesg);
  const seconds = 15 * 60;
  let distance = 0;
  for (let i = 0; i <= seconds; i++) {
    const power = i < 600 ? 200 : 300;
    distance += 8;
    let altitude = 100 + (i / seconds) * 100;
    if (opts.spikes && i % 97 === 0) altitude = 12600; // corrupt barometer samples
    enc.onMesg(Profile.MesgNum.RECORD, {
      timestamp: new Date(START.getTime() + i * 1000),
      power,
      heartRate: i < 600 ? 145 : 165,
      distance,
      speed: 8,
      altitude,
    } as unknown as RecordMesg);
  }
  if (opts.session) {
    enc.onMesg(Profile.MesgNum.SESSION, {
      timestamp: new Date(START.getTime() + seconds * 1000),
      startTime: START,
      sport: "cycling",
      subSport: "road",
      totalElapsedTime: seconds,
      totalTimerTime: seconds,
      totalDistance: distance,
      avgHeartRate: 148,
      maxHeartRate: 170,
      avgPower: 233,
      avgCadence: 88,
      totalAscent: 100,
      totalCalories: 210,
    } as unknown as SessionMesg);
  }
  return enc.close();
}

describe("FIT activity import", () => {
  it("reads a Wahoo ride and derives Normalized Power and HR zones", () => {
    const r = decodeFitActivity(rideFit({ session: true }), "ride.fit", 165);
    expect(r.errors).toEqual([]);
    expect(r.activities).toHaveLength(1);
    const a = r.activities[0];
    expect(a).toMatchObject({ sport: "ride", durationSec: 900, movingSec: 900, avgHr: 148, avgPower: 233, avgCadence: 88, elevationGainM: 100, deviceName: "Wahoo" });
    expect(a.startTime.toISOString()).toBe(START.toISOString());
    // NP of 10 min @200 W + 5 min @300 W is above the average power
    expect(a.normPower!).toBeGreaterThan(233);
    expect(a.normPower!).toBeLessThan(300);
    // 145 bpm = 88 % of 165 -> Z2; 165 bpm = 100 % -> Z5
    expect(a.hrZoneSec![1]).toBeGreaterThan(550);
    expect(a.hrZoneSec![4]).toBeGreaterThan(280);
    expect(a.name).toBe("Morgenrunde");
  });

  it("rebuilds a missing session summary from records and filters altitude spikes", () => {
    const r = decodeFitActivity(rideFit({ session: false, manufacturer: "garmin", spikes: true }), "crash.fit", 165);
    expect(r.errors).toEqual([]);
    const a = r.activities[0];
    expect(a.sport).toBe("ride"); // power present
    expect(a.durationSec).toBe(900);
    expect(a.distanceM).toBe(7208);
    expect(a.avgPower).toBeGreaterThan(225);
    expect(a.elevationGainM!).toBeGreaterThan(80);
    expect(a.elevationGainM!).toBeLessThan(120);
  });

  it("produces a stable id so re-imports are idempotent", () => {
    const bytes = rideFit({ session: true });
    expect(decodeFitActivity(bytes, "a.fit", 165).activities[0].externalId).toBe(decodeFitActivity(bytes, "b.fit", 165).activities[0].externalId);
  });

  it("rejects non-FIT and non-activity files", () => {
    expect(decodeFitActivity(new TextEncoder().encode("hello"), "x.fit", 165).errors[0]).toMatch(/keine FIT-Datei/);
    const workout = new Encoder();
    workout.onMesg(Profile.MesgNum.FILE_ID, { type: "workout", manufacturer: "development", product: 0, timeCreated: START } as unknown as FileIdMesg);
    expect(decodeFitActivity(workout.close(), "w.fit", 165).errors[0]).toMatch(/keine Aktivität/);
  });

  it("expands Garmin Connect style ZIP archives (also nested)", () => {
    const fit = rideFit({ session: true });
    const inner = zipSync({ "123456_ACTIVITY.fit": fit });
    const outer = zipSync({ "export/activity.zip": inner, "readme.txt": new TextEncoder().encode("x") });
    const r = expandUploads([
      { name: "garmin.zip", bytes: outer },
      { name: "direct.fit", bytes: fit },
      { name: "notes.pdf", bytes: new Uint8Array(3) },
    ]);
    expect(r.fit.map((f) => f.name)).toEqual(["123456_ACTIVITY.fit", "direct.fit"]);
    expect(r.errors).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("computes NP of a constant effort as that power", () => {
    const recs = Array.from({ length: 600 }, (_, i) => ({ timestamp: new Date(START.getTime() + i * 1000), power: 250 }));
    expect(normalizedPowerFromRecords(recs)).toBe(250);
  });

  it("ignores a calibration step and noise when summing ascent", () => {
    const series = [
      ...Array.from({ length: 60 }, (_, i) => ({ t: i, alt: 500 + (i % 2) * 0.5 })), // noise only
      ...Array.from({ length: 40 }, (_, i) => ({ t: 60 + i, alt: 900 })), // step (calibration)
      ...Array.from({ length: 100 }, (_, i) => ({ t: 100 + i, alt: 900 + i * 0.5 })), // real climb 50 m
    ];
    const gain = ascentFromAltitudes(series);
    expect(gain).toBeGreaterThanOrEqual(45);
    expect(gain).toBeLessThanOrEqual(55);
  });
});
