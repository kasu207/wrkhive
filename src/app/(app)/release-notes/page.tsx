import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/card";
import { displayDate } from "@/lib/dates";
import { formatDateShort } from "@/lib/format";
import { RELEASES } from "@/lib/release-notes";

export const metadata: Metadata = { title: "Neuigkeiten" };

export default function ReleaseNotesPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="Neuigkeiten" description="Was sich in Wrkhive geändert hat." />
      <div className="max-w-[760px] space-y-4">
        {RELEASES.map((r) => (
          <Card key={r.version} className="p-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-[16px] font-semibold">{r.title}</h2>
              <span className="text-[13px] text-ink-3 tabular">
                Version {r.version} · {formatDateShort(displayDate(r.date))}
              </span>
            </div>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-ink-2 marker:text-ink-3">
              {r.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
