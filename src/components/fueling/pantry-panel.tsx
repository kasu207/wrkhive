"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteProduct, saveProduct, togglePantry } from "@/app/actions/nutrition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, UnitInput } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { PRODUCT_KIND_LABEL, PRODUCT_KINDS, type FuelProduct, type ProductKind } from "@/lib/nutrition";

function facts(p: FuelProduct) {
  const parts = [`${String(p.carbsG).replace(".", ",")} g KH`];
  if (p.sodiumMg) parts.push(`${p.sodiumMg} mg Natrium`);
  if (p.caffeineMg) parts.push(`${p.caffeineMg} mg Koffein`);
  return parts.join(" · ");
}

export function PantryPanel({ products, pantryIds }: { products: FuelProduct[]; pantryIds: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [active, setActive] = useState(() => new Set(pantryIds));
  const [editing, setEditing] = useState<FuelProduct | "new" | null>(null);

  const toggle = (p: FuelProduct, on: boolean) => {
    setActive((s) => {
      const next = new Set(s);
      if (on) next.add(p.id);
      else next.delete(p.id);
      return next;
    });
    start(async () => {
      const r = await togglePantry({ productId: p.id, active: on });
      if (!r.ok) toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
      router.refresh();
    });
  };

  const remove = (p: FuelProduct) => {
    if (!window.confirm(`„${p.name}“ löschen?`)) return;
    start(async () => {
      const r = await deleteProduct(p.id);
      if (r.ok) toast({ tone: "success", title: "Gelöscht" });
      else toast({ tone: "error", title: "Nicht gelöscht", description: r.error });
      router.refresh();
    });
  };

  const groups = PRODUCT_KINDS.map((kind) => ({ kind, items: products.filter((p) => p.kind === kind) })).filter((g) => g.items.length);

  return (
    <Card>
      <CardHeader
        title="Vorrat"
        description="Was du zu Hause hast und unterwegs magst. Die Pläne verwenden nur aktive Produkte."
        action={
          <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
            <Plus />
            Eigenes Produkt
          </Button>
        }
      />
      <div className="divide-y divide-border pt-3" aria-busy={pending || undefined}>
        {groups.map((g) => (
          <div key={g.kind} className="px-5 py-3">
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{PRODUCT_KIND_LABEL[g.kind]}</h3>
            <ul>
              {g.items.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                      {p.name}
                      {p.multiSource ? <Badge tone="good">Glukose + Fruktose</Badge> : null}
                      {p.custom ? <Badge>Eigenes</Badge> : null}
                    </div>
                    <div className="text-[12px] text-ink-3">
                      {p.servingLabel}: {facts(p)}
                    </div>
                  </div>
                  {p.custom ? (
                    <>
                      <Button variant="ghost" size="icon-sm" aria-label={`${p.name} bearbeiten`} onClick={() => setEditing(p)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`${p.name} löschen`} onClick={() => remove(p)}>
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                  <Switch checked={active.has(p.id)} onChange={(on) => toggle(p, on)} label={`${p.name} im Vorrat`} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <ProductDialog
        product={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </Card>
  );
}

function ProductDialog({ product, onClose, onSaved }: { product: FuelProduct | "new" | null; onClose: () => void; onSaved: () => void }) {
  const open = product !== null;
  const existing = product && product !== "new" ? product : null;
  return (
    <Dialog open={open} onClose={onClose} title={existing ? "Produkt bearbeiten" : "Eigenes Produkt"} description="Werte pro Portion, wie sie auf der Packung stehen.">
      {open ? <ProductForm key={existing?.id ?? "new"} existing={existing} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function ProductForm({ existing, onSaved }: { existing: FuelProduct | null; onSaved: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    name: existing?.name ?? "",
    kind: (existing?.kind ?? "gel") as ProductKind,
    carbsG: existing ? String(existing.carbsG).replace(".", ",") : "",
    sodiumMg: existing ? String(existing.sodiumMg) : "0",
    caffeineMg: existing ? String(existing.caffeineMg) : "0",
    fluidMl: existing?.fluidMl ? String(existing.fluidMl) : "500",
    servingLabel: existing?.servingLabel ?? "1 Portion",
    multiSource: existing?.multiSource ?? false,
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const num = (s: string) => Number(s.replace(",", ".")) || 0;

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveProduct({
            id: existing?.id,
            name: v.name,
            kind: v.kind,
            carbsG: num(v.carbsG),
            sodiumMg: Math.round(num(v.sodiumMg)),
            caffeineMg: Math.round(num(v.caffeineMg)),
            multiSource: v.multiSource,
            fluidMl: v.kind === "drink" ? Math.round(num(v.fluidMl)) : null,
            servingLabel: v.servingLabel,
          });
          if (r.ok) {
            toast({ tone: "success", title: "Gespeichert", description: r.message });
            onSaved();
          } else toast({ tone: "error", title: "Nicht gespeichert", description: r.error });
        });
      }}
    >
      <Field label="Name" htmlFor="p-name" className="sm:col-span-2">
        <Input id="p-name" value={v.name} onChange={set("name")} maxLength={60} placeholder="z. B. Gel 100 Orange" required />
      </Field>
      <Field label="Art" htmlFor="p-kind">
        <Select id="p-kind" value={v.kind} onChange={set("kind")}>
          {PRODUCT_KINDS.map((k) => (
            <option key={k} value={k}>
              {PRODUCT_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Portion" htmlFor="p-serving">
        <Input id="p-serving" value={v.servingLabel} onChange={set("servingLabel")} maxLength={40} />
      </Field>
      <Field label="Kohlenhydrate" htmlFor="p-carbs">
        <UnitInput id="p-carbs" unit="g" inputMode="decimal" value={v.carbsG} onChange={set("carbsG")} required={v.kind !== "salt"} />
      </Field>
      <Field label="Natrium" htmlFor="p-sodium" hint="Steht nur Salz drauf: Salz in g × 400">
        <UnitInput id="p-sodium" unit="mg" inputMode="numeric" value={v.sodiumMg} onChange={set("sodiumMg")} />
      </Field>
      <Field label="Koffein" htmlFor="p-caffeine">
        <UnitInput id="p-caffeine" unit="mg" inputMode="numeric" value={v.caffeineMg} onChange={set("caffeineMg")} />
      </Field>
      {v.kind === "drink" ? (
        <Field label="Wasser pro Portion" htmlFor="p-fluid">
          <UnitInput id="p-fluid" unit="ml" inputMode="numeric" value={v.fluidMl} onChange={set("fluidMl")} />
        </Field>
      ) : null}
      <label className="flex items-center justify-between gap-3 text-[14px] text-ink sm:col-span-2">
        <span>
          Glukose und Fruktose
          <span className="block text-[12px] text-ink-3">Zutaten enthalten Fruktose, Zucker (Saccharose) oder Honig neben Glukose/Maltodextrin, z. B. „2:1“ oder „1:0,8“</span>
        </span>
        <Switch checked={v.multiSource} onChange={(on) => setV((s) => ({ ...s, multiSource: on }))} label="Glukose und Fruktose" />
      </label>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={pending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}
