import { describe, expect, it } from "vitest";
import { APPS, connectionPreference, detectSourceApp, isTrainingApp, recommendConnections } from "./apps";

describe("source app detection", () => {
  it("recognizes training apps from device or uploading client", () => {
    expect(detectSourceApp({ hints: ["Zwift"] })).toBe("zwift");
    expect(detectSourceApp({ hints: [null, "MyWhoosh"] })).toBe("mywhoosh");
    expect(detectSourceApp({ hints: ["ROUVY"] })).toBe("rouvy");
    expect(detectSourceApp({ hints: ["Intervals.icu Companion"] })).toBe("apple");
  });
  it("recognizes devices", () => {
    expect(detectSourceApp({ hints: ["ELEMNT BOLT"] })).toBe("wahoo");
    expect(detectSourceApp({ hints: ["Garmin Forerunner 265"] })).toBe("garmin");
    expect(detectSourceApp({ hints: ["Edge 540"] })).toBe("garmin");
    expect(detectSourceApp({ hints: ["fēnix 8"] })).toBe("garmin");
  });
  it("prefers the app over the device and uses names only for training apps", () => {
    expect(detectSourceApp({ hints: ["Zwift Garmin"] })).toBe("zwift");
    expect(detectSourceApp({ name: "Zwift – Watopia", fallback: "garmin" })).toBe("zwift");
    expect(detectSourceApp({ name: "Runde mit Garmin-Kollegen", fallback: "wahoo" })).toBe("wahoo");
    expect(detectSourceApp({ hints: ["Karoo 3"], fallback: null })).toBeNull();
  });
  it("classifies training apps", () => {
    expect(isTrainingApp("mywhoosh")).toBe(true);
    expect(isTrainingApp("garmin")).toBe(false);
    expect(isTrainingApp(null)).toBe(false);
  });
  it("describes a route for every app", () => {
    for (const a of APPS) {
      expect(a.activities.length).toBeGreaterThan(0);
      expect(a.setup.length).toBeGreaterThan(0);
    }
  });
});

describe("connection recommendation", () => {
  it("covers everything with intervals.icu when no direct access exists", () => {
    const r = recommendConnections(["wahoo", "mywhoosh", "freeletics", "zwift"], { garmin: false, wahoo: false });
    expect(r.connections).toEqual([{ id: "intervals", apps: ["wahoo", "zwift", "mywhoosh", "freeletics"] }]);
    const fl = r.routes.find((x) => x.app.id === "freeletics")!;
    expect(fl.workouts).toBeNull();
    expect(fl.activities?.via).toBe("intervals");
  });
  it("prefers direct device connections when configured", () => {
    const r = recommendConnections(["wahoo", "rouvy"], { garmin: false, wahoo: true });
    expect(r.connections.map((c) => c.id).sort()).toEqual(["intervals", "wahoo"]);
    expect(r.routes.find((x) => x.app.id === "wahoo")!.workouts?.via).toBe("wahoo");
  });
  it("returns nothing for no selection", () => {
    expect(recommendConnections([], { garmin: true, wahoo: true }).connections).toEqual([]);
  });
});

describe("connection preference", () => {
  it("puts the athlete's devices first", () => {
    expect(connectionPreference(["mywhoosh", "wahoo"])).toEqual(["wahoo", "intervals", "garmin"]);
    expect(connectionPreference(["garmin"])).toEqual(["garmin", "wahoo", "intervals"]);
    expect(connectionPreference(null)).toEqual(["wahoo", "garmin", "intervals"]);
  });
});
