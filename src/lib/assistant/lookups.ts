/**
 * The assistant's lookups. Each one runs with the asker's own Supabase client, so row-level security decides what comes
 * back: a person without pricing access gets no costs, and documents are only those they can open. Nothing here writes.
 */
import { shapeLine } from "@/lib/estimating/data";
import { priceEstimateLine } from "@/lib/estimating/assemble";
import { versionSummary, type Rates } from "@/lib/estimating/worksheet";
import type { Lookups } from "./run";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Sb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>; from: (t: string) => any };

const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const id = (v: unknown, what: string) => {
  const s = str(v, 40);
  if (!UUID.test(s)) throw new Error(`${what} must be an id (uuid)`);
  return s;
};
const page = (v: unknown) => {
  const n = Math.floor(Number(v));
  if (!(n >= 1)) throw new Error("page must be 1 or more");
  return n;
};
/** The words of a query as a PostgREST "or" pattern over the given columns. */
const ilike = (q: string, cols: string[]) => {
  const words = q.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return null;
  const pat = `%${words.join("%").replace(/[%,()]/g, " ")}%`;
  return cols.map((c) => `${c}.ilike.${pat}`).join(",");
};
const must = <T>(r: { data: T; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const dollars = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);

async function rates(sb: Sb): Promise<Rates> {
  const row = must(await sb.from("tax_settings").select("pst_pct,gst_pct,hst_pct").eq("id", 1).maybeSingle()) as { pst_pct: number; gst_pct: number; hst_pct: number } | null;
  return { pstPct: Number(row?.pst_pct ?? 0), gstPct: Number(row?.gst_pct ?? 0), hstPct: Number(row?.hst_pct ?? 0) };
}

export function lookupsFor(sb: Sb, opts: { canPrice: boolean }): Lookups {
  return {
    company_details: async () => {
      const rows = must(await sb.rpc("company_details")) as Record<string, string>[] | null;
      const r = rows?.[0];
      return r ? { company_name: r["company_name"], office_address: r["office_address"], mailing_address: r["mailing_address"], phone: r["phone"], email: r["email"], website: r["website"], hours: r["hours"], gst_number: r["gst_number"], business_number: r["business_number"] } : { error: "No company details are saved yet" };
    },

    search_catalogue: async (args) => {
      const q = str(args["q"]);
      const or = ilike(q, ["name", "manufacturer", "product_line", "sku", "cost_code", "category"]);
      if (!or) throw new Error("q is required");
      const mats = must(await sb.from("catalogue_materials").select("id,name,category,manufacturer,product_line,sku,colour,cost_code,purchase_uom,cost_uom,coverage_per_purchase_unit,coverage_uom,unit_cost_cents,price_date,price_source,pst_applies,active,supplier:suppliers(name)").or(or).order("name").limit(25)) as Record<string, unknown>[];
      const lab = must(await sb.from("labour_rates").select("id,name,cost_code,uom,unit_cost_cents,active").or(ilike(q, ["name", "cost_code"])!).order("name").limit(15)) as Record<string, unknown>[];
      const price = (r: Record<string, unknown>) => (opts.canPrice ? { unit_cost: dollars(r["unit_cost_cents"] as number | null), price_date: r["price_date"] ?? null, price_source: r["price_source"] ?? null } : {});
      return {
        materials: mats.map((r) => ({ id: r["id"], name: r["name"], category: r["category"], manufacturer: r["manufacturer"], product_line: r["product_line"], sku: r["sku"], colour: r["colour"], cost_code: r["cost_code"], purchase_uom: r["purchase_uom"], cost_uom: r["cost_uom"], coverage_per_purchase_unit: r["coverage_per_purchase_unit"], coverage_uom: r["coverage_uom"], pst_applies: r["pst_applies"], active: r["active"], supplier: (r["supplier"] as { name?: string } | null)?.name ?? null, ...price(r) })),
        labour_rates: lab.map((r) => ({ id: r["id"], name: r["name"], cost_code: r["cost_code"], uom: r["uom"], active: r["active"], ...(opts.canPrice ? { unit_cost: dollars(r["unit_cost_cents"] as number | null) } : {}) })),
        note: opts.canPrice ? "Costs are in Canadian dollars per cost_uom, before markup." : "Costs are hidden: the asker has no pricing access.",
      };
    },

    search_clients: async (args) => {
      const q = str(args["q"]);
      const or = ilike(q, ["name", "email", "phone", "billing_address"]);
      if (!or) throw new Error("q is required");
      const rows = must(await sb.from("clients").select("id,name,email,phone,billing_address,active,notes,contacts:client_contacts(name,title,email,phone_office,phone_mobile,is_primary)").or(or).order("name").limit(20)) as Record<string, unknown>[];
      if (rows.length) return rows;
      // The name may be on a contact rather than the client.
      const byContact = must(await sb.from("client_contacts").select("client_id,name,title,email,phone_office,phone_mobile,is_primary,client:clients(id,name,email,phone,billing_address,active)").or(ilike(q, ["name", "email"])!).limit(20)) as Record<string, unknown>[];
      return byContact.map((c) => ({ contact: { name: c["name"], title: c["title"], email: c["email"], phone_office: c["phone_office"], phone_mobile: c["phone_mobile"], is_primary: c["is_primary"] }, client: c["client"] }));
    },

    search_projects: async (args) => {
      const q = str(args["q"]);
      const cols = "id,project_number,name,client_name,client_id,stage,stage_entered_at,address,city,province,job_type,building_type,bid_due_date,start_date,target_date,po_number,estimated_value_cents,archived_at";
      let query = sb.from("projects").select(cols).order("stage_entered_at", { ascending: false }).limit(25);
      const or = ilike(q, ["name", "project_number", "client_name", "address", "city", "po_number"]);
      if (or) query = query.or(or);
      const rows = must(await query) as Record<string, unknown>[];
      return rows.map((r) => ({ ...r, estimated_value: opts.canPrice ? dollars(r["estimated_value_cents"] as number | null) : undefined, estimated_value_cents: undefined }));
    },

    project_overview: async (args) => {
      const pid = id(args["project_id"], "project_id");
      const p = must(await sb.from("projects").select("id,project_number,name,client_name,client_id,stage,stage_entered_at,address,street,city,province,postal_code,job_type,building_type,bid_due_date,start_date,target_date,po_number,estimated_value_cents,holdback_pct,notes,lost_reason,lost_note,archived_at,created_at").eq("id", pid).maybeSingle()) as Record<string, unknown> | null;
      if (!p) throw new Error("No project with that id, or it is not one the asker can see");
      const [contacts, people, docs, quotes, client] = await Promise.all([
        sb.from("project_contacts").select("kind,name,title,company,email,phone_office,phone_mobile,is_primary").eq("project_id", pid).order("sort_order"),
        sb.rpc("project_people", { _project: pid }),
        sb.from("project_documents").select("section").eq("project_id", pid),
        sb.from("quotes").select("number,kind,status,value_cents,accepted_value_cents,sent_at,accepted_at").eq("project_id", pid).order("created_at"),
        p["client_id"] ? sb.from("clients").select("name,email,phone,billing_address,contacts:client_contacts(name,title,email,phone_office,phone_mobile,is_primary)").eq("id", p["client_id"] as string).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      const sections: Record<string, number> = {};
      for (const d of ((docs.data ?? []) as { section: string }[])) sections[d.section] = (sections[d.section] ?? 0) + 1;
      return {
        ...p,
        estimated_value: opts.canPrice ? dollars(p["estimated_value_cents"] as number | null) : undefined,
        estimated_value_cents: undefined,
        client: client.data ?? null,
        site_contacts: contacts.data ?? [],
        people: people.error ? [] : people.data,
        documents_by_section: sections,
        quotes: ((quotes.data ?? []) as Record<string, unknown>[]).map((q) => ({ number: q["number"], kind: q["kind"], status: q["status"], sent_at: q["sent_at"], accepted_at: q["accepted_at"], value: dollars(q["value_cents"] as number | null), accepted_value: dollars(q["accepted_value_cents"] as number | null) })),
      };
    },

    project_estimate_summary: async (args) => {
      if (!opts.canPrice) throw new Error("The asker does not have pricing access, so the estimate cannot be shown");
      const pid = id(args["project_id"], "project_id");
      const [versions, r] = await Promise.all([
        sb.from("estimate_versions").select("id,kind,co_number,name,description,default_markup_pct,is_base,locked,status,lines:estimate_lines(*,components:estimate_line_components(*))").eq("project_id", pid).order("sort_order"),
        rates(sb),
      ]);
      const vs = must(versions) as Record<string, unknown>[];
      return vs.map((v) => {
        const lines = ((v["lines"] ?? []) as unknown[]).map(shapeLine).sort((a, b) => a.sort_order - b.sort_order);
        const s = versionSummary(lines, r);
        return {
          version_id: v["id"],
          kind: v["kind"],
          co_number: v["co_number"],
          name: v["name"],
          description: v["description"],
          status: v["status"],
          locked: v["locked"],
          default_markup_pct: Number(v["default_markup_pct"]),
          cost: dollars(s.costCents),
          sell_before_tax: dollars(s.sellCents),
          tax: dollars(s.totals.taxCents),
          total: dollars(s.totals.totalCents),
          sections: s.sections.map((x) => ({ section: x.section, cost: dollars(x.costCents), sell: dollars(x.sellCents) })),
          lines: lines.map((l) => {
            const p = priceEstimateLine(l, l.components, r);
            return { description: l.description, section: l.section, kind: l.kind, qty: l.driver_qty, uom: l.driver_uom, selection: l.selection, markup_pct: l.markup_pct, cost: dollars(p.costCents), sell: dollars(p.sellCents), cost_code: l.cost_code, notes: l.notes, allowance: l.is_allowance, subject_to_measure: l.subject_to_measure, ...(p.error ? { error: p.error } : {}) };
          }),
        };
      });
    },

    list_quotes: async (args) => {
      const pid = id(args["project_id"], "project_id");
      const rows = must(await sb.from("quotes").select("id,number,kind,co_number,revision,status,value_cents,accepted_value_cents,validity_days,sent_at,recipients,accepted_at,decision_note,inclusions,exclusions,clarifications,deposit,attention,client_notes,created_at").eq("project_id", pid).order("created_at")) as Record<string, unknown>[];
      return rows.map((q) => ({ ...q, value: dollars(q["value_cents"] as number | null), accepted_value: dollars(q["accepted_value_cents"] as number | null), value_cents: undefined, accepted_value_cents: undefined }));
    },

    search_documents: async (args) => {
      const q = str(args["q"]);
      if (!q) throw new Error("q is required");
      const pid = args["project_id"] ? id(args["project_id"], "project_id") : null;
      const hits = must(await sb.rpc("search_document_pages", { _project: pid, _q: q, _limit: 20 })) as Record<string, unknown>[] | null;
      if (!hits?.length) return [];
      const ids = [...new Set(hits.map((h) => h["document_id"] as string))];
      const docs = must(await sb.from("project_documents").select("id,project_id,created_at,project:projects(name,project_number)").in("id", ids)) as Record<string, unknown>[];
      const byId = new Map(docs.map((d) => [d["id"] as string, d]));
      return hits.map((h) => {
        const d = byId.get(h["document_id"] as string);
        const proj = d?.["project"] as { name?: string; project_number?: string | null } | null | undefined;
        return { document_id: h["document_id"], file_name: h["file_name"], section: h["section"], version: h["version"], page: h["page"], snippet: String(h["snippet"] ?? "").replace(/<\/?b>/g, ""), project: proj ? `${proj.project_number ? `${proj.project_number} ` : ""}${proj.name ?? ""}`.trim() : null, project_id: d?.["project_id"] ?? null, uploaded: d?.["created_at"] ?? null };
      });
    },

    read_document_page: async (args) => {
      const did = id(args["document_id"], "document_id");
      const pg = page(args["page"]);
      const row = must(await sb.from("document_pages").select("page,text,document:project_documents(file_name,section,created_at,text_pages)").eq("document_id", did).eq("page", pg).maybeSingle()) as Record<string, unknown> | null;
      if (!row) throw new Error("No such page, or the document is not one the asker can read");
      const d = row["document"] as { file_name?: string; section?: string; created_at?: string; text_pages?: number | null } | null;
      return { document_id: did, file_name: d?.file_name ?? null, section: d?.section ?? null, uploaded: d?.created_at ?? null, pages: d?.text_pages ?? null, page: pg, text: row["text"] };
    },

    search_knowledge: async (args) => {
      const q = str(args["q"]);
      if (!q) throw new Error("q is required");
      const hits = must(await sb.rpc("search_knowledge", { _q: q, _limit: 20 })) as Record<string, unknown>[] | null;
      const rows = hits ?? [];
      if (!rows.length) return [];
      const memoryIds = rows.filter((h) => h["kind"] === "memory").map((h) => h["item_id"] as string);
      const bodies = memoryIds.length ? (must(await sb.from("knowledge_items").select("id,body,updated_at").in("id", memoryIds)) as { id: string; body: string | null; updated_at: string }[]) : [];
      const bodyOf = new Map(bodies.map((b) => [b.id, b]));
      return rows.map((h) => {
        const b = bodyOf.get(h["item_id"] as string);
        return { item_id: h["item_id"], kind: h["kind"], title: h["title"], folder: h["folder"], file_name: h["file_name"], visibility: h["visibility"], page: h["page"], ...(h["kind"] === "memory" ? { text: b?.body ?? null, updated: b?.updated_at ?? null } : { snippet: String(h["snippet"] ?? "").replace(/<\/?b>/g, "") }) };
      });
    },

    read_knowledge_page: async (args) => {
      const iid = id(args["item_id"], "item_id");
      const pg = page(args["page"]);
      const row = must(await sb.from("knowledge_pages").select("page,text,item:knowledge_items(title,file_name,kind,folder,text_pages,updated_at)").eq("item_id", iid).eq("page", pg).maybeSingle()) as Record<string, unknown> | null;
      if (!row) throw new Error("No such page, or the file is not one the asker can read");
      const k = row["item"] as { title?: string; file_name?: string | null; kind?: string; folder?: string | null; text_pages?: number | null; updated_at?: string } | null;
      return { item_id: iid, kind: k?.kind ?? "file", title: k?.title ?? null, file_name: k?.file_name ?? null, folder: k?.folder ?? null, pages: k?.text_pages ?? null, updated: k?.updated_at ?? null, page: pg, text: row["text"] };
    },
  };
}
