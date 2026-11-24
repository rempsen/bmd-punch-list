import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { TechnicianVisits } from "@/components/scheduling/TechnicianVisits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { errText } from "@/lib/platform/db";
import { addSubcontractor, useMonthVisits, useTechnicians } from "@/lib/scheduling/data";
import { searchTechnicians, siteDay, visitsThisMonth, type Technician } from "@/lib/scheduling/logic";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/technicians")({
  head: () => ({ meta: [{ title: "Crews and Subcontractors · BMD Materials" }] }),
  component: TechniciansPage,
});

function TechniciansPage() {
  const { canAny } = useAuth();
  if (!canAny("view_pipeline")) return <Navigate to="/" replace />;
  return <Technicians />;
}

type Tab = "subcontractors" | "staff";

function Technicians() {
  const { canAny } = useAuth();
  const canAdd = canAny("manage_projects") || canAny("manage_catalogue");
  const techs = useTechnicians();
  const month = useMonthVisits();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("subcontractors");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const all = techs.data ?? [];
  const counts = useMemo(() => visitsThisMonth(month.data ?? [], all, siteDay(new Date())), [month.data, all]);
  const staff = all.filter((t) => t.source === "bmd");
  const subs = all.filter((t) => t.source === "supplier");
  const seen = all.filter((t) => t.source === "arriveping");
  const shown = searchTechnicians(tab === "staff" ? staff : subs, q);

  const add = async (name: string) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 2) return void toast.error("Type the subcontractor's name.");
    setBusy(true);
    try {
      const id = await addSubcontractor(clean);
      await qc.refetchQueries({ queryKey: ["technicians"] });
      void qc.invalidateQueries({ queryKey: ["catalogue"] });
      toast.success(`${clean} is now a subcontractor. Add their contact details in the catalogue.`);
      setNewName("");
      setAdding(false);
      setTab("subcontractors");
      setOpenId(id);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const row = (t: Technician) => {
    const open = openId === t.id;
    const n = counts.get(t.id) ?? 0;
    return (
      <li key={t.id}>
        <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : t.id)} className="flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50">
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{t.name}</span>
            {t.detail && <span className="block truncate text-xs text-muted-foreground">{t.detail}</span>}
          </span>
          {t.source === "supplier" && <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{t.both ? "Labour and materials" : "Labour"}</span>}
          <span className={cn("w-36 text-right text-sm tabular-nums", n ? "text-foreground" : "text-muted-foreground")}>{n === 1 ? "1 visit this month" : `${n} visits this month`}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
        </button>
        {open && (
          <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
            <TechnicianVisits techId={t.id} />
          </div>
        )}
      </li>
    );
  };

  return (
    <div>
      <PageHeader
        title="Crews and Subcontractors"
        subtitle="Everyone a visit can be assigned to: BMD staff, and the Labour vendors under Suppliers & subcontractors"
        actions={
          canAdd && (
            <Button className="h-11" onClick={() => setAdding((a) => !a)}>
              <Plus className="mr-2 h-4 w-4" /> Add subcontractor
            </Button>
          )
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        {adding && (
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void add(newName);
            }}
          >
            <label className="min-w-60 flex-1 space-y-1 text-sm font-medium">
              Subcontractor's name
              <Input autoFocus className="h-11" maxLength={120} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Prairie Floor Installers" />
            </label>
            <Button type="submit" className="h-11" disabled={busy || newName.trim().length < 2}>
              {busy ? "Adding…" : "Add as Labour"}
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              They are added to Catalogue → Suppliers &amp; subcontractors as Labour. A vendor that already has this name is reused, and a materials-only one becomes Labour and materials.
            </p>
          </form>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Kind of technician" className="inline-flex rounded-md border border-border bg-card p-1">
            {(["subcontractors", "staff"] as Tab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setOpenId(null); }} className={cn("min-h-9 rounded px-3 text-sm font-medium", tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
                {k === "staff" ? `Staff (${staff.length})` : `Subcontractors (${subs.length})`}
              </button>
            ))}
          </div>
          <Input aria-label="Search technicians" className="h-11 max-w-xs" placeholder="Search name, contact or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          {canAny("view_pricing") && (
            <Link to="/catalogue" className="ml-auto text-sm font-medium text-primary underline-offset-4 hover:underline">
              Edit contact details in the catalogue
            </Link>
          )}
        </div>
        {techs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : techs.error ? (
          <p className="text-sm text-destructive">The technicians could not be loaded: {errText(techs.error)}</p>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {q.trim()
              ? "Nobody matches that search."
              : tab === "staff"
                ? "No BMD staff are set up as field technicians yet. Give a person the BMD field access level (Company settings → Users) and they appear here."
                : "No subcontractors yet. Add one here, or mark a vendor as Labour under Catalogue → Suppliers & subcontractors."}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">{shown.map(row)}</ul>
        )}
        {canAdd && seen.length > 0 && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Seen in ArrivePing, not in the catalogue yet</h2>
            <p className="mt-1 text-xs text-muted-foreground">Crew names ArrivePing has reported on a visit. Add one as a subcontractor only if they are not BMD staff.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {seen.map((t) => (
                <li key={t.id}>
                  <Button variant="outline" size="sm" className="h-9" disabled={busy} onClick={() => void add(t.name)}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> {t.name}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
