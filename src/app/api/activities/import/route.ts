import { NextResponse, type NextRequest } from "next/server";
import { decodeFitActivity, expandUploads } from "@/lib/fit/activity";
import { getCurrentUser } from "@/lib/server/auth";
import { upsertActivities } from "@/lib/server/sync";

export const maxDuration = 120;

const MAX_FILES = 200;
const MAX_BYTES = 60 * 1024 * 1024;

/**
 * Imports activities from FIT files (or ZIP archives containing FIT files,
 * e.g. Garmin Connect "Export Original"). Works without any provider API.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!uploads.length) return NextResponse.json({ error: "Keine Dateien ausgewählt." }, { status: 400 });
  if (uploads.length > MAX_FILES) return NextResponse.json({ error: `Maximal ${MAX_FILES} Dateien auf einmal.` }, { status: 400 });
  const total = uploads.reduce((a, f) => a + f.size, 0);
  if (total > MAX_BYTES) return NextResponse.json({ error: "Die Dateien sind zusammen größer als 60 MB." }, { status: 413 });

  const files = await Promise.all(uploads.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const { fit, errors } = expandUploads(files);
  const activities = [];
  for (const f of fit) {
    try {
      const r = decodeFitActivity(f.bytes, f.name, user.lthr, user.timeZone);
      activities.push(...r.activities);
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`${f.name}: ${e instanceof Error ? e.message : "konnte nicht gelesen werden"}`);
    }
  }
  const { inserted, updated } = activities.length ? upsertActivities(user, { id: null, provider: "manual" }, activities) : { inserted: 0, updated: 0 };
  const skipped = activities.length - inserted - updated;
  return NextResponse.json({ files: fit.length, activities: activities.length, inserted, updated, skipped, errors: errors.slice(0, 20) });
}
