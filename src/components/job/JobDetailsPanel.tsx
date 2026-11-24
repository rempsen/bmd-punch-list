import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { ContactFields, DetailsFields, Field, ScopePicker, type DetailsValue } from "@/components/job/fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useContacts, useProject, useScopes } from "@/lib/data";
import { emptyContact, joinAddress, type Contact } from "@/lib/job-wizard";
import { CONTACT_KINDS } from "@/lib/projects/contacts";

type EditContact = Contact & { id?: string; is_primary: boolean };


export function JobDetailsPanel() {
  const { refreshPermissions } = useAuth();
  const qc = useQueryClient();
  const { data: project } = useProject();
  const { data: contacts } = useContacts(project?.id);
  const { data: scopes } = useScopes(project?.id);

  const [details, setDetails] = useState<DetailsValue | null>(null);
  const [address, setAddress] = useState("");
  const [client, setClient] = useState("");
  const [list, setList] = useState<EditContact[]>([]);
  const [scopeKeys, setScopeKeys] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!project) return;
    setDetails({
      name: project.name,
      street: project.street ?? "",
      city: project.city ?? "",
      province: project.province ?? "",
      postal_code: project.postal_code ?? "",
      po_number: project.po_number ?? "",
      start_date: project.start_date ?? "",
      target_date: project.target_date ?? "",
      notes: project.notes ?? "",
    });
    setAddress(project.address ?? "");
    setClient(project.client_name ?? "");
  }, [project]);
  useEffect(() => {
    if (contacts)
      setList(
        contacts.map((c) => ({
          id: c.id,
          kind: (c.kind as Contact["kind"]) ?? "client",
          name: c.name ?? "",
          company: c.company ?? "",
          title: c.title ?? "",
          email: c.email ?? "",
          phone_mobile: c.phone_mobile ?? "",
          phone_office: c.phone_office ?? "",
          is_primary: c.is_primary,
        })),
      );
  }, [contacts]);
  useEffect(() => {
    if (!scopes) return;
    setScopeKeys(scopes.map((s) => s.scope));
    setOther(scopes.find((s) => s.scope === "other")?.other_text ?? "");
  }, [scopes]);

  if (!project || !details) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const changeDetails = (p: Partial<DetailsValue>) => {
    const next = { ...details, ...p };
    setDetails(next);
    if ("street" in p || "city" in p || "province" in p || "postal_code" in p) setAddress(joinAddress(next));
  };

  const save = async () => {
    if (!details.name.trim()) return void toast.error("Enter a job name");
    setBusy(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({
          name: details.name.trim(),
          street: details.street.trim() || null,
          city: details.city.trim() || null,
          province: details.province.trim() || null,
          postal_code: details.postal_code.trim() || null,
          address: address.trim() || null,
          po_number: details.po_number.trim() || null,
          start_date: details.start_date || null,
          target_date: details.target_date || null,
          notes: details.notes.trim() || null,
          client_name: client.trim() || null,
        })
        .eq("id", project.id);
      if (error) throw error;

      const keep = list.filter((c) => c.id).map((c) => c.id!);
      const removed = (contacts ?? []).filter((c) => !keep.includes(c.id)).map((c) => c.id);
      if (removed.length) {
        const r = await supabase.from("project_contacts").delete().in("id", removed);
        if (r.error) throw r.error;
      }
      for (const [i, c] of list.entries()) {
        const row = {
          project_id: project.id,
          kind: c.kind,
          name: c.name.trim() || null,
          company: c.company.trim() || null,
          title: c.title.trim() || null,
          email: c.email.trim() || null,
          phone_mobile: c.phone_mobile.trim() || null,
          phone_office: c.phone_office.trim() || null,
          is_primary: c.is_primary,
          sort_order: i + 1,
        };
        const r = c.id
          ? await supabase.from("project_contacts").update(row).eq("id", c.id)
          : await supabase.from("project_contacts").insert(row);
        if (r.error) throw r.error;
      }

      const current = (scopes ?? []).map((s) => s.scope);
      const drop = current.filter((s) => !scopeKeys.includes(s));
      if (drop.length) {
        const r = await supabase.from("project_scopes").delete().eq("project_id", project.id).in("scope", drop);
        if (r.error) throw r.error;
      }
      const rows = scopeKeys.map((s) => ({ project_id: project.id, scope: s, other_text: s === "other" ? other.trim() || null : null }));
      if (rows.length) {
        const r = await supabase.from("project_scopes").upsert(rows, { onConflict: "project_id,scope" });
        if (r.error) throw r.error;
      }

      toast.success("Job details saved");
      await refreshPermissions();
      for (const k of ["project", "contacts", "scopes"]) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String((e as { message?: string }).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const setC = (i: number, p: Partial<EditContact>) => setList((l) => l.map((c, j) => (j === i ? { ...c, ...p } : c)));

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Job details</h2>
        <DetailsFields value={details} onChange={changeDetails} />
        <div className="mt-4">
          <Field label="Address as shown in the header and reports">
            <Input className="h-11" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Client &amp; contacts</h2>
        <div className="mb-4 max-w-md">
          <Field label="Client company">
            <Input className="h-11" value={client} onChange={(e) => setClient(e.target.value)} />
          </Field>
        </div>
        <div className="space-y-4">
          {list.map((c, i) => (
            <div key={c.id ?? `new-${i}`} className="rounded-md border border-border p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Select value={c.kind} onValueChange={(v) => setC(i, { kind: v as Contact["kind"] })}>
                  <SelectTrigger className="h-10 w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_KINDS.map((k) => (
                      <SelectItem key={k.value} value={k.value}>
                        {k.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="primary-contact"
                    checked={c.is_primary}
                    onChange={() => setList((l) => l.map((x, j) => ({ ...x, is_primary: j === i })))}
                  />
                  Main client contact
                </label>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 className="mr-1 h-4 w-4" /> Remove
                </Button>
              </div>
              <ContactFields value={c} onChange={(p) => setC(i, p)} />
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-3 h-11"
          onClick={() => setList((l) => [...l, { ...emptyContact(l.length ? "gc" : "client"), is_primary: l.length === 0 }])}
        >
          <Plus className="mr-1 h-4 w-4" /> Add contact
        </Button>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase">Scopes</h2>
        <ScopePicker value={scopeKeys} other={other} onChange={setScopeKeys} onOther={setOther} />
        <p className="mt-2 text-xs text-muted-foreground">Changing scopes here doesn't change the pick lists — edit those under Pick lists.</p>
      </section>

      <Button className="h-12 px-6" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Save job details"}
      </Button>
    </div>
  );
}
