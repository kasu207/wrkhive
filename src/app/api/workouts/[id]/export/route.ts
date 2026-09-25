import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { workouts } from "@/db/schema";
import { getCurrentUser, thresholdsOf } from "@/lib/server/auth";
import { encodeFitWorkout } from "@/lib/workout/export/fit";
import { encodeZwo } from "@/lib/workout/export/zwo";
import { serializeWorkoutText } from "@/lib/workout/text";

function fileBase(name: string) {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "workout";
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/workouts/[id]/export">) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const w = getDb()
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, id), eq(workouts.userId, user.id)))
    .get();
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });

  const format = request.nextUrl.searchParams.get("format") ?? "fit";
  const t = thresholdsOf(user);
  const base = fileBase(w.name);
  const disposition = (ext: string) => `attachment; filename="${base}.${ext}"`;

  switch (format) {
    case "fit": {
      const bytes = encodeFitWorkout({ name: w.name, description: w.description, structure: w.structure, thresholds: t });
      return new NextResponse(Buffer.from(bytes), {
        headers: { "Content-Type": "application/vnd.ant.fit", "Content-Disposition": disposition("fit"), "Cache-Control": "no-store" },
      });
    }
    case "zwo": {
      if (w.sport === "strength") return NextResponse.json({ error: "Zwift unterstützt kein Krafttraining" }, { status: 400 });
      const xml = encodeZwo({ name: w.name, description: w.description, structure: w.structure, thresholds: t });
      return new NextResponse(xml, {
        headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": disposition("zwo"), "Cache-Control": "no-store" },
      });
    }
    case "txt": {
      const text = `${w.name}\n${w.description ? `${w.description}\n` : ""}\n${serializeWorkoutText(w.structure, t)}\n`;
      return new NextResponse(text, {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": disposition("txt"), "Cache-Control": "no-store" },
      });
    }
    case "json": {
      const json = JSON.stringify({ name: w.name, description: w.description, sport: w.sport, structure: w.structure }, null, 2);
      return new NextResponse(json, {
        headers: { "Content-Type": "application/json", "Content-Disposition": disposition("json"), "Cache-Control": "no-store" },
      });
    }
    default:
      return NextResponse.json({ error: "unknown format" }, { status: 400 });
  }
}
