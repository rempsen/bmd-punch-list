import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Copy, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { ContactFields, DetailsFields, Field, ScopePicker } from "@/components/job/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/lib/platform/db";
import { useAuth } from "@/lib/auth";
import {
  BUILDING_TYPES,
  HOTEL_CHIPS,
  OFFICE_CHIPS,
  blankFloor,
  buildPayload,
  buildPickLists,
  defaultFloorLabels,
  emptyWizard,
  floorLocations,
  joinAddress,
  newKey,
  scopeLabel,
  summarise,
  type WizardData,
  type WizardFloor,
} from "@/lib/job-wizard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/new-job")({
  head: () => ({
    meta: [
      { title: "New job — BMD Projects" },
      { name: "description", content: "Set up a new BMD job: details, client, scopes and building layout." },
      { property: "og:title", content: "New job — BMD Projects" },
      { property: "og:description", content: "Guided setup for a new BMD Materials job." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { draft?: string | undefined; project?: string | undefined } => ({
    draft: typeof s["draft"] === "string" ? s["draft"] : undefined,
    // Set-up-site mode: add floors and rooms to a project that already exists in the pipeline.
    project: typeof s["project"] === "string" ? s["project"] : undefined,
  }),
  component: NewJobPage,
});

const STEPS = ["Job details", "Client", "Scopes", "Building", "Review"];
// In office mode these chips are common areas rather than rooms
const COMMONISH = new Set(["Vestibule", "Lobby", "Common area", "Corridor", "Stairwell", "Elevator lobby"]);

function NewJobPage() {
  const { canCreateJobs, canAny, refreshPermissions, setProjectId } = useAuth();
  const { draft: draftParam, project: siteFor } = Route.useSearch();
  const firstStep = siteFor ? 3 : 1;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [d, setD] = useState<WizardData>(emptyWizard);
  const [step, setStep] = useState(siteFor ? 3 : 1);
  const [draftId, setDraftId] = useState<string | null>(draftParam ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draftParam) return;
    void supabase
      .from("job_drafts")
      .select("*")
      .eq("id", draftParam)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setD({ ...emptyWizard(), ...(data.data as Partial<WizardData>) });
          setStep(data.step || 1);
        }
      });
  }, [draftParam]);

  useEffect(() => {
    if (!siteFor) return;
    void supabase
      .from("projects")
      .select("name,client_name,project_scopes(scope,other_text)")
      .eq("id", siteFor)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const sc = (data.project_scopes ?? []) as { scope: string; other_text: string | null }[];
        setD((cur) => ({
          ...cur,
          name: data.name,
          client_company: data.client_name ?? "",
          scopes: sc.map((x) => x.scope),
          other_scope: sc.find((x) => x.scope === "other")?.other_text ?? "",
        }));
      });
  }, [siteFor]);

  const set = (p: Partial<WizardData>) => setD((cur) => ({ ...cur, ...p }));
  const counts = useMemo(() => summarise(d), [d]);

  if (!(siteFor ? canAny("manage_projects") : canCreateJobs))
    return (
      <div>
        <PageHeader title="New job" />
        <p className="p-6 text-sm text-muted-foreground">You don't have access to create jobs.</p>
      </div>
    );

  const validate = (s: number): string | null => {
    if (s === 1 && !d.name.trim()) return "Enter a job name";
    if (s === 2 && !d.client_company.trim()) return "Enter the client company";
    if (s === 4) {
      if (d.floors.length === 0) return "Add at least one floor";
      for (const f of d.floors) {
        if (!f.label.trim()) return "Every floor needs a name";
        const e = floorLocations(f, d.building).error;
        if (e) return `${f.label}: ${e}`;
      }
    }
    return null;
  };

  const next = () => {
    const e = validate(step);
    if (e) { toast.error(e); return; }
    setStep((s) => Math.min(5, s + 1));
    window.scrollTo({ top: 0 });
  };

  const saveDraft = async () => {
    const row = { name: d.name || "Untitled job", step, data: d as never, updated_at: new Date().toISOString() };
    const res = draftId
      ? await supabase.from("job_drafts").update(row).eq("id", draftId).select("id").single()
      : await supabase.from("job_drafts").insert(row).select("id").single();
    if (res.error) { toast.error(res.error.message); return; }
    setDraftId(res.data.id);
    toast.success("Draft saved — continue it any time from Choose a job");
  };

  const create = async () => {
    for (const s of siteFor ? [4] : [1, 2, 4]) {
      const e = validate(s);
      if (e) {
        setStep(s);
        toast.error(e);
        return;
      }
    }
    setBusy(true);
    const { data: newId, error } = siteFor
      ? await db.rpc("setup_project_site", { _project: siteFor, _job: buildPayload(d) })
      : await supabase.rpc("create_job", { _job: buildPayload(d) as never });
    const id = siteFor ?? newId;
    if (error) {
      setBusy(false);
      toast.error(error.message);
      return;
    }
    if (draftId) await supabase.from("job_drafts").delete().eq("id", draftId);
    await refreshPermissions();
    setProjectId(id as string);
    qc.removeQueries();
    setBusy(false);
    toast.success(siteFor ? `${d.name} site set up` : `${d.name} created`);
    void navigate({ to: "/dashboard", search: { welcome: "1" } });
  };

  return (
    <div>
      <PageHeader
        title={siteFor ? "Set up site" : "New job"}
        subtitle={d.name || "Set up a job in five steps"}
        actions={
          siteFor ? undefined : (
            <Button variant="outline" className="h-10" onClick={() => void saveDraft()}>
              Save draft
            </Button>
          )
        }
      />
      <ol className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-3 md:px-6">
        {STEPS.map((label, i) => {
          const n = i + 1;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => n < step && n >= firstStep && setStep(n)}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                  n === step ? "border-primary bg-primary text-primary-foreground" : n < step ? "border-primary text-primary" : "border-border text-muted-foreground",
                )}
              >
                {n < step ? <Check className="h-4 w-4" /> : n}
              </button>
              <span className={cn("hidden text-sm sm:inline", n === step ? "font-semibold" : "text-muted-foreground")}>{label}</span>
              {n < STEPS.length && <span className="h-px flex-1 bg-border" />}
            </li>
          );
        })}
      </ol>

      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
        {step === 1 && (
          <Section title="Job details">
            <DetailsFields value={d} onChange={set} />
          </Section>
        )}

        {step === 2 && (
          <>
            <Section title="Client">
              <div className="mb-4">
                <Field label="Client company" required>
                  <Input className="h-11" value={d.client_company} onChange={(e) => set({ client_company: e.target.value })} />
                </Field>
              </div>
              <ContactFields value={d.contact} onChange={(p) => set({ contact: { ...d.contact, ...p } })} />
            </Section>
            <Section title="Second contact (optional)">
              {d.hasSecond ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {(["gc", "site", "other"] as const).map((k) => (
                      <Chip key={k} on={d.second.kind === k} onClick={() => set({ second: { ...d.second, kind: k } })}>
                        {k === "gc" ? "General contractor" : k === "site" ? "Site super" : "Other"}
                      </Chip>
                    ))}
                  </div>
                  <ContactFields value={d.second} onChange={(p) => set({ second: { ...d.second, ...p } })} />
                  <Button variant="ghost" className="mt-2" onClick={() => set({ hasSecond: false })}>
                    Remove second contact
                  </Button>
                </>
              ) : (
                <Button variant="outline" className="h-11" onClick={() => set({ hasSecond: true })}>
                  <Plus className="mr-1 h-4 w-4" /> Add a second contact (site super / GC)
                </Button>
              )}
              <div className="mt-4 max-w-xs">
                <Field label="Site contact phone">
                  <Input className="h-11" type="tel" value={d.site_phone} onChange={(e) => set({ site_phone: e.target.value })} />
                </Field>
              </div>
            </Section>
          </>
        )}

        {step === 3 && (
          <Section title="Scopes BMD is doing on this job">
            <ScopePicker value={d.scopes} other={d.other_scope} onChange={(scopes) => set({ scopes })} onOther={(other_scope) => set({ other_scope })} />
            <p className="mt-3 text-xs text-muted-foreground">
              These set up the job's materials and issue types. You can still edit the pick lists in Settings afterwards.
            </p>
          </Section>
        )}

        {step === 4 && <BuildingStep d={d} set={set} counts={counts} />}

        {step === 5 && <Review d={d} counts={counts} goto={(n) => setStep(Math.max(firstStep, n))} />}

        <div className="sticky bottom-20 flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 shadow-sm md:bottom-4">
          <Button variant="outline" className="h-12" disabled={step === firstStep} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
          <span className="text-xs text-muted-foreground">
            Step {step} of 5 · {counts.floors} floors, {counts.rooms} rooms, {counts.common} common areas
          </span>
          {step < 5 ? (
            <Button className="h-12 px-6" onClick={next}>
              Next
            </Button>
          ) : (
            <Button className="h-12 px-6" disabled={busy} onClick={() => void create()}>
              {busy ? "Creating…" : siteFor ? "Set up site" : "Create job"}
            </Button>
          )}
        </div>
        <p className="text-center text-xs">
          <Link to={siteFor ? "/projects" : "/jobs"} className="text-muted-foreground hover:underline">
            Cancel
          </Link>
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 md:p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3 py-1.5 text-sm transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function BuildingStep({
  d,
  set,
  counts,
}: {
  d: WizardData;
  set: (p: Partial<WizardData>) => void;
  counts: { floors: number; rooms: number; common: number };
}) {
  const setFloor = (key: string, p: Partial<WizardFloor>) =>
    set({ floors: d.floors.map((f) => (f.key === key ? { ...f, ...p } : f)) });
  const setCount = (n: number) => {
    const count = Math.max(1, Math.min(60, n || 1));
    if (count <= d.floors.length) return set({ floors: d.floors.slice(0, count) });
    const labels = defaultFloorLabels(count);
    set({ floors: [...d.floors, ...labels.slice(d.floors.length).map(blankFloor)] });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.floors.length) return;
    const fl = [...d.floors];
    [fl[i], fl[j]] = [fl[j]!, fl[i]!];
    set({ floors: fl });
  };
  const copyToAll = (src: WizardFloor) => {
    set({
      floors: d.floors.map((f) =>
        f.key === src.key
          ? f
          : {
              ...f,
              common: [...new Set([...f.common, ...src.common])],
              named: [...f.named.filter((n) => !src.named.some((s) => s.name === n.name)), ...src.named.map((n) => ({ ...n }))],
            },
      ),
    });
    toast.success(`Copied ${src.label}'s spaces to every floor`);
  };

  return (
    <>
      <Section title="Building type">
        <div className="grid gap-2 sm:grid-cols-3">
          {BUILDING_TYPES.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => set({ building: b.value })}
              className={cn(
                "min-h-16 rounded-lg border p-3 text-left",
                d.building === b.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted",
              )}
            >
              <p className="text-sm font-semibold">{b.label}</p>
              <p className="text-xs text-muted-foreground">{b.hint}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div className="w-40">
            <Field label="Number of floors" required>
              <Input className="h-11" type="number" min={1} max={60} value={d.floors.length} onChange={(e) => setCount(Number(e.target.value))} />
            </Field>
          </div>
          <p className="pb-2 text-sm font-medium">
            {counts.floors} floors, {counts.rooms} rooms, {counts.common} common areas
          </p>
        </div>
      </Section>

      {d.floors.map((f, i) => (
        <FloorCard
          key={f.key}
          f={f}
          building={d.building}
          first={i === 0}
          last={i === d.floors.length - 1}
          onChange={(p) => setFloor(f.key, p)}
          onMove={(dir) => move(i, dir)}
          onRemove={() => set({ floors: d.floors.filter((x) => x.key !== f.key) })}
          onCopyAll={() => copyToAll(f)}
        />
      ))}
      <Button variant="outline" className="h-11" onClick={() => set({ floors: [...d.floors, { ...blankFloor(String(d.floors.length)), key: newKey() }] })}>
        <Plus className="mr-1 h-4 w-4" /> Add floor
      </Button>
    </>
  );
}

function FloorCard({
  f,
  building,
  first,
  last,
  onChange,
  onMove,
  onRemove,
  onCopyAll,
}: {
  f: WizardFloor;
  building: WizardData["building"];
  first: boolean;
  last: boolean;
  onChange: (p: Partial<WizardFloor>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onCopyAll: () => void;
}) {
  const [qty, setQty] = useState(1);
  const [custom, setCustom] = useState("");
  const built = floorLocations(f, building);
  const rooms = built.locations.filter((l) => l.type === "room").length;
  const common = built.locations.length - rooms;

  const toggleCommon = (c: string) =>
    onChange({ common: f.common.includes(c) ? f.common.filter((x) => x !== c) : [...f.common, c] });
  const addNamed = (name: string) => {
    const n = name.trim();
    if (!n) return;
    const existing = f.named.find((x) => x.name === n);
    onChange({
      named: existing ? f.named.map((x) => (x.name === n ? { ...x, qty: qty } : x)) : [...f.named, { name: n, qty }],
    });
    setQty(1);
  };
  const officeChip = (c: string) => (COMMONISH.has(c) ? toggleCommon(c) : addNamed(c));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-11 max-w-56 font-semibold" value={f.label} onChange={(e) => onChange({ label: e.target.value })} aria-label="Floor name" />
        <span className="text-xs text-muted-foreground">
          {rooms} rooms · {common} common areas
        </span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" disabled={last} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopyAll}>
            <Copy className="mr-1 h-4 w-4" /> Copy to all floors
          </Button>
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label="Remove floor">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {building !== "named" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]">
          <Field label="Prefix">
            <Input className="h-11" placeholder="e.g. S" value={f.prefix} onChange={(e) => onChange({ prefix: e.target.value })} />
          </Field>
          <Field label="Room numbers">
            <Input className="h-11" placeholder="e.g. 201-228 or 201-214, 216-228" value={f.rangeText} onChange={(e) => onChange({ rangeText: e.target.value })} />
          </Field>
          {built.error && <p className="text-sm text-destructive sm:col-span-2">{built.error}</p>}
        </div>
      )}

      {building !== "named" && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-semibold text-muted-foreground uppercase">Common areas</p>
          <div className="flex flex-wrap gap-2">
            {HOTEL_CHIPS.map((c) => (
              <Chip key={c} on={f.common.includes(c)} onClick={() => toggleCommon(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {building !== "numbered" && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Spaces</p>
            <span className="text-xs text-muted-foreground">Quantity for next chip:</span>
            <Input className="h-9 w-16" type="number" min={1} max={99} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} aria-label="Quantity" />
          </div>
          <div className="flex flex-wrap gap-2">
            {OFFICE_CHIPS.map((c) => (
              <Chip key={c} on={f.common.includes(c) || f.named.some((n) => n.name === c)} onClick={() => officeChip(c)}>
                {qty > 1 && !COMMONISH.has(c) ? `${c} ×${qty}` : c}
              </Chip>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              className="h-11"
              placeholder="Add another space…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addNamed(custom);
                  setCustom("");
                }
              }}
            />
            <Button variant="outline" className="h-11" onClick={() => { addNamed(custom); setCustom(""); }}>
              Add
            </Button>
          </div>
        </div>
      )}

      {(f.named.length > 0 || (building === "named" && f.common.length > 0)) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {f.named.map((n) => (
            <li key={n.name} className="flex items-center gap-1 rounded-md border border-border bg-muted/50 py-1 pr-1 pl-2 text-sm">
              {n.name}
              <Input
                className="h-7 w-14"
                type="number"
                min={1}
                max={99}
                value={n.qty}
                aria-label={`${n.name} quantity`}
                onChange={(e) => onChange({ named: f.named.map((x) => (x.name === n.name ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)) })}
              />
              <button type="button" aria-label={`Remove ${n.name}`} onClick={() => onChange({ named: f.named.filter((x) => x.name !== n.name) })} className="rounded p-1 hover:bg-muted">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {building === "named" &&
            f.common.map((c) => (
              <li key={c} className="flex items-center gap-1 rounded-md border border-dashed border-border py-1 pr-1 pl-2 text-sm">
                {c} <span className="text-xs text-muted-foreground">(common)</span>
                <button type="button" aria-label={`Remove ${c}`} onClick={() => toggleCommon(c)} className="rounded p-1 hover:bg-muted">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function Review({ d, counts, goto }: { d: WizardData; counts: { floors: number; rooms: number; common: number }; goto: (s: number) => void }) {
  const lists = buildPickLists(d.building, d.scopes.map((s) => ({ scope: s, other_text: s === "other" ? d.other_scope : null })));
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span>{v || "—"}</span>
    </div>
  );
  const Edit = ({ s }: { s: number }) => (
    <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => goto(s)}>
      Edit
    </button>
  );
  return (
    <>
      <Section title="Job">
        <div className="-mt-2 mb-2 text-right"><Edit s={1} /></div>
        <Row k="Name" v={d.name} />
        <Row k="Address" v={joinAddress(d)} />
        <Row k="Job / PO number" v={d.po_number} />
        <Row k="Dates" v={[d.start_date, d.target_date].filter(Boolean).join(" → ")} />
        <Row k="Notes" v={d.notes} />
      </Section>
      <Section title="Client">
        <div className="-mt-2 mb-2 text-right"><Edit s={2} /></div>
        <Row k="Company" v={d.client_company} />
        <Row k="Contact" v={[d.contact.name, d.contact.title, d.contact.email, d.contact.phone_mobile, d.contact.phone_office].filter(Boolean).join(" · ")} />
        {d.hasSecond && <Row k="Second contact" v={[d.second.name, d.second.company, d.second.email, d.second.phone_mobile].filter(Boolean).join(" · ")} />}
        <Row k="Site phone" v={d.site_phone} />
      </Section>
      <Section title="Scopes & pick lists">
        <div className="-mt-2 mb-2 text-right"><Edit s={3} /></div>
        <Row k="Scopes" v={d.scopes.map((s) => (s === "other" && d.other_scope ? d.other_scope : scopeLabel(s))).join(", ")} />
        <Row k="Areas" v={lists.filter((l) => l.kind === "area").map((l) => l.value).join(", ")} />
        <Row k="Materials" v={lists.filter((l) => l.kind === "material").map((l) => l.value).join(", ")} />
        <Row k="Issue types" v={lists.filter((l) => l.kind === "issue_type").map((l) => l.value).join(", ")} />
      </Section>
      <Section title={`Building — ${counts.floors} floors, ${counts.rooms} rooms, ${counts.common} common areas`}>
        <div className="-mt-2 mb-2 text-right"><Edit s={4} /></div>
        <ul className="space-y-2 text-sm">
          {d.floors.map((f) => {
            const locs = floorLocations(f, d.building).locations;
            return (
              <li key={f.key}>
                <span className="font-medium">{f.label}</span>{" "}
                <span className="text-muted-foreground">
                  ({locs.length}) {locs.slice(0, 12).map((l) => l.name).join(", ")}
                  {locs.length > 12 ? `, … +${locs.length - 12} more` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
