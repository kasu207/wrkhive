import { strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { appleSport, appleWorkoutName, createExportScanner, parseAppleDate, parseAutoExportPayload, parseExportWorkout, readAppleHealthExport, type AppleWorkout } from "./apple-health";

const RUN_IOS17 = `<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="45.5" durationUnit="min" sourceName="Apple Watch von Philipp" sourceVersion="10.0" device="&lt;&lt;HKDevice: 0x28&gt;, name:Apple Watch&gt;" creationDate="2024-05-04 08:47:00 +0200" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <MetadataEntry key="HKElevationAscended" value="8520 cm"/>
  <WorkoutEvent type="HKWorkoutEventTypeSegment" date="2024-05-04 08:00:00 +0200" duration="5" durationUnit="min"/>
  <WorkoutActivity uuid="A1" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200" duration="45.5" durationUnit="min">
   <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200" average="151.2" minimum="98" maximum="176" unit="count/min"/>
  </WorkoutActivity>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200" average="151.2" minimum="98" maximum="176" unit="count/min"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200" sum="512.4" unit="kcal"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200" sum="8.61" unit="km"/>
  <WorkoutRoute sourceName="Apple Watch von Philipp" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:46:00 +0200">
   <FileReference path="/workout-routes/route_2024-05-04_8.46am.gpx"/>
  </WorkoutRoute>
 </Workout>`;

const RIDE_LEGACY = `<Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="60" durationUnit="min" totalDistance="18.5" totalDistanceUnit="mi" totalEnergyBurned="2000" totalEnergyBurnedUnit="kJ" sourceName="Zwift" startDate="2021-01-10 18:00:00 +0100" endDate="2021-01-10 19:00:00 +0100"/>`;

const BJJ = `<Workout workoutActivityType="HKWorkoutActivityTypeMartialArts" duration="90" durationUnit="min" sourceName="Apple Watch" startDate="2024-05-06 19:00:00 +0200" endDate="2024-05-06 20:30:00 +0200">
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" average="148" maximum="185" unit="count/min"/>
 </Workout>`;

const EXPORT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT Workout ((MetadataEntry|WorkoutEvent|WorkoutRoute|WorkoutStatistics)*)>
<!ATTLIST Workout workoutActivityType CDATA #REQUIRED>
]>
<HealthData locale="de_DE">
 <ExportDate value="2024-05-10 10:00:00 +0200"/>
 <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" unit="count/min" startDate="2024-05-04 08:00:00 +0200" endDate="2024-05-04 08:00:00 +0200" value="120"/>
 ${RUN_IOS17}
 ${RIDE_LEGACY}
 <Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2024-05-05 08:00:00 +0200" endDate="2024-05-05 08:10:00 +0200" value="800"/>
 ${BJJ}
 <ActivitySummary dateComponents="2024-05-06" activeEnergyBurned="700"/>
</HealthData>
`;

describe("apple health dates", () => {
  it("parses the export format with offset", () => {
    const r = parseAppleDate("2024-05-04 08:00:00 +0200")!;
    expect(r.date.toISOString()).toBe("2024-05-04T06:00:00.000Z");
    expect(r.offsetSec).toBe(7200);
  });
  it("parses 12-hour clock variants", () => {
    expect(parseAppleDate("2021-12-24 8:02:43 PM -0500")!.date.toISOString()).toBe("2021-12-25T01:02:43.000Z");
    expect(parseAppleDate("2021-12-24 12:10:00 AM +0000")!.date.toISOString()).toBe("2021-12-24T00:10:00.000Z");
  });
  it("rejects dates without offset", () => {
    expect(parseAppleDate("2024-05-04 08:00:00")).toBeNull();
  });
});

describe("apple health sports", () => {
  it("maps HealthKit and Health Auto Export names", () => {
    expect(appleSport("HKWorkoutActivityTypeRunning").sport).toBe("run");
    expect(appleSport("Outdoor Run").sport).toBe("run");
    expect(appleSport("Indoor Cycling").sport).toBe("ride");
    expect(appleSport("TraditionalStrengthTraining").sport).toBe("strength");
    expect(appleSport("Functional Strength Training").sport).toBe("strength");
    expect(appleSport("MartialArts")).toEqual({ sport: "other", label: "Kampfsport" });
    expect(appleSport("HandCycling").sport).toBe("other");
    expect(appleSport("StairClimbing").label).toBe("Treppensteigen");
    expect(appleSport("Curling")).toEqual({ sport: "other", label: "Curling" });
  });
  it("names indoor sessions", () => {
    expect(appleWorkoutName({ type: "Cycling", indoor: true })).toBe("Indoor-Radfahrt");
    expect(appleWorkoutName({ type: "Indoor Run", indoor: null })).toBe("Laufband");
    expect(appleWorkoutName({ type: "Running", indoor: false })).toBe("Lauf");
  });
});

describe("apple health export.xml", () => {
  it("reads iOS 16+ workouts with statistics and metadata", () => {
    const w = parseExportWorkout(RUN_IOS17)!;
    expect(w).toMatchObject({
      type: "Running",
      start: "2024-05-04T06:00:00.000Z",
      utcOffsetSec: 7200,
      durationSec: 2730,
      distanceM: 8610,
      calories: 512,
      avgHr: 151.2,
      maxHr: 176,
      indoor: false,
      source: "Apple Watch von Philipp",
    });
    expect(w.elevationGainM).toBeCloseTo(85.2);
  });
  it("reads legacy attributes and converts units", () => {
    const w = parseExportWorkout(RIDE_LEGACY)!;
    expect(w.distanceM).toBe(29773);
    expect(w.calories).toBe(478);
    expect(w.durationSec).toBe(3600);
    expect(w.source).toBe("Zwift");
  });
  it("scans a document split into arbitrary chunks", () => {
    for (const size of [1, 7, 64, 1000]) {
      const found: AppleWorkout[] = [];
      const scanner = createExportScanner((w) => found.push(w));
      for (let i = 0; i < EXPORT_XML.length; i += size) scanner.push(EXPORT_XML.slice(i, i + size));
      expect(scanner.end().skipped).toBe(0);
      expect(found.map((w) => w.type)).toEqual(["Running", "Cycling", "MartialArts"]);
    }
  });
  it("streams the ZIP export and ignores other entries", async () => {
    const zip = zipSync({
      "apple_health_export/export_cda.xml": strToU8("<ClinicalDocument>" + "x".repeat(10000) + "</ClinicalDocument>"),
      "apple_health_export/Export.xml": strToU8(EXPORT_XML),
      "apple_health_export/workout-routes/route.gpx": strToU8("<gpx/>"),
    });
    const blob = new Blob([zip as BlobPart]);
    const progress: number[] = [];
    const r = await readAppleHealthExport({ name: "export.zip", size: blob.size, stream: () => blob.stream() }, (f) => progress.push(f));
    expect(r.foundXml).toBe(true);
    expect(r.workouts).toHaveLength(3);
    expect(progress.at(-1)).toBeGreaterThan(0);
  });
  it("streams ZIPs written with data descriptors (as iOS does)", async () => {
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      const zip = new Zip((err, data, final) => {
        if (err) return reject(err);
        chunks.push(data);
        if (final) resolve();
      });
      const entry = new ZipDeflate("apple_health_export/export.xml", { level: 6 });
      zip.add(entry);
      const bytes = strToU8(EXPORT_XML);
      for (let i = 0; i < bytes.length; i += 500) entry.push(bytes.subarray(i, i + 500), i + 500 >= bytes.length);
      zip.end();
    });
    const blob = new Blob(chunks as BlobPart[]);
    const r = await readAppleHealthExport({ name: "Export.zip", size: blob.size, stream: () => blob.stream() });
    expect(r.workouts.map((w) => w.type)).toEqual(["Running", "Cycling", "MartialArts"]);
  });
  it("reads an unpacked export.xml", async () => {
    const blob = new Blob([EXPORT_XML]);
    const r = await readAppleHealthExport({ name: "Export.xml", size: blob.size, stream: () => blob.stream() });
    expect(r.workouts).toHaveLength(3);
  });
  it("reports a ZIP without export.xml", async () => {
    const blob = new Blob([zipSync({ "foo.txt": strToU8("hi") }) as BlobPart]);
    const r = await readAppleHealthExport({ name: "other.zip", size: blob.size, stream: () => blob.stream() });
    expect(r.foundXml).toBe(false);
  });
});

describe("Health Auto Export", () => {
  it("reads v2 workouts", () => {
    const r = parseAutoExportPayload({
      data: {
        workouts: [
          {
            id: "5C1C-UUID",
            name: "Outdoor Run",
            start: "2024-05-04 08:00:00 +0200",
            end: "2024-05-04 08:46:00 +0200",
            duration: 2730,
            distance: { qty: 8.61, units: "km" },
            activeEnergyBurned: { qty: 512.4, units: "kcal" },
            heartRate: { min: { qty: 98, units: "bpm" }, avg: { qty: 151.2, units: "bpm" }, max: { qty: 176, units: "bpm" } },
            elevationUp: { qty: 85.2, units: "m" },
            isIndoor: false,
          },
        ],
      },
    });
    expect(r.workouts[0]).toMatchObject({ id: "5C1C-UUID", type: "Outdoor Run", durationSec: 2730, distanceM: 8610, calories: 512, avgHr: 151, maxHr: 176, indoor: false, utcOffsetSec: 7200 });
  });
  it("reads v1 workouts with heart-rate series, kJ and minutes", () => {
    const r = parseAutoExportPayload({
      data: {
        workouts: [
          {
            name: "Walking",
            start: "2021-12-24 08:02:43 +0800",
            end: "2021-12-24 08:21:53 +0800",
            duration: 19.1,
            heartRateData: [
              { units: "bpm", qty: 108, date: "2021-12-24 08:02:47 +0800" },
              { units: "bpm", qty: 120, date: "2021-12-24 08:03:47 +0800" },
            ],
            elevation: { descent: 0, ascent: 16.36, units: "m" },
            activeEnergy: { qty: 226.2, units: "kJ" },
          },
        ],
      },
    });
    expect(r.workouts[0]).toMatchObject({ type: "Walking", durationSec: 1146, avgHr: 114, maxHr: 120, calories: 54, id: null });
    expect(r.workouts[0].elevationGainM).toBeCloseTo(16.36);
  });
  it("uses the time span when the duration does not fit", () => {
    const r = parseAutoExportPayload({ data: { workouts: [{ name: "Yoga", start: "2024-01-01 10:00:00 +0100", end: "2024-01-01 11:00:00 +0100", duration: 5 }] } });
    expect(r.workouts[0].durationSec).toBe(3600);
  });
  it("skips invalid entries and recognises metric-only payloads", () => {
    expect(parseAutoExportPayload({ data: { workouts: [{ name: "Run" }, null] } })).toMatchObject({ workouts: [], skipped: 2 });
    expect(parseAutoExportPayload({ data: { metrics: [] } }).metricsOnly).toBe(true);
    expect(parseAutoExportPayload("nonsense").workouts).toEqual([]);
  });
});
