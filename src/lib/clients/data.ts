import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { planClientImport, type ParsedClient } from "./import";

export type Client = {
  id: string;
  name: string;
  billing_address: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  qbo_customer_id: string | null;
  active: boolean;
};
export type ClientContact = {
  id: string;
  client_id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone_mobile: string | null;
  phone_office: string | null;
  is_primary: boolean;
};

const CLIENT_COLS = "id,name,billing_address,phone,email,notes,qbo_customer_id,active";

export function useClients() {
  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select(CLIENT_COLS).order("name");
      if (error) throw error;
      return (data ?? []) as Client[];
    },
  });
}

export function useClientContacts(clientId: string | null) {
  return useQuery({
    queryKey: ["client-contacts", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_contacts")
        .select("id,client_id,name,title,email,phone_mobile,phone_office,is_primary")
        .eq("client_id", clientId!)
        .order("is_primary", { ascending: false })
        .order("name");
      if (error) throw error;
      return (data ?? []) as ClientContact[];
    },
  });
}

export function useRefreshClients() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["clients"] });
    void qc.invalidateQueries({ queryKey: ["client-contacts"] });
  };
}

export type ClientInput = Pick<Client, "name" | "billing_address" | "phone" | "email" | "notes">;

export async function saveClient(id: string | null, input: ClientInput): Promise<string> {
  const row = { ...input, name: input.name.trim(), updated_at: new Date().toISOString() };
  if (!row.name) throw new Error("Client name is required");
  if (id) {
    const { error } = await supabase.from("clients").update(row).eq("id", id);
    if (error) throw new Error(friendly(error.message));
    return id;
  }
  const { data, error } = await supabase.from("clients").insert(row).select("id").single();
  if (error) throw new Error(friendly(error.message));
  return data.id;
}

const friendly = (m: string) => (/clients_name_key/.test(m) ? "A client with that name already exists." : m);

/** Adds clients that are not already present. Never updates or deletes existing rows. */
export async function importClients(parsed: ParsedClient[]): Promise<{ added: number; unchanged: number }> {
  const { data: existing, error } = await supabase.from("clients").select("id,name,qbo_customer_id");
  if (error) throw error;
  const plan = planClientImport(parsed, existing ?? []);
  for (let i = 0; i < plan.inserts.length; i += 200) {
    const batch = plan.inserts.slice(i, i + 200);
    const { data: inserted, error: insErr } = await supabase
      .from("clients")
      .insert(batch.map((c) => ({ name: c.name, email: c.email, phone: c.phone, billing_address: c.billingAddress })))
      .select("id,name");
    if (insErr) throw insErr;
    const byName = new Map((inserted ?? []).map((r) => [r.name, r.id]));
    const contacts = batch
      .filter((c) => c.contactName && byName.has(c.name))
      .map((c) => ({ client_id: byName.get(c.name)!, name: c.contactName, email: c.email, phone_office: c.phone, is_primary: true }));
    if (contacts.length) {
      const { error: cErr } = await supabase.from("client_contacts").insert(contacts);
      if (cErr) throw cErr;
    }
  }
  return { added: plan.inserts.length, unchanged: plan.unchanged };
}
