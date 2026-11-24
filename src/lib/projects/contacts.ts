// Who to reach about a job. The role is stored in project_contacts.kind.
export type ContactKind = "client" | "pm" | "super" | "gc" | "site" | "other";

export const CONTACT_KINDS: { value: ContactKind; label: string }[] = [
  { value: "client", label: "Client" },
  { value: "pm", label: "Customer's project manager" },
  { value: "super", label: "Site superintendent" },
  { value: "gc", label: "General contractor" },
  { value: "site", label: "Site" },
  { value: "other", label: "Other" },
];
export const contactKindLabel = (k: string): string => CONTACT_KINDS.find((x) => x.value === k)?.label ?? k;
export const isContactKind = (k: unknown): k is ContactKind => CONTACT_KINDS.some((x) => x.value === k);

/** The customer's project manager and the site superintendent come first; the rest keep their saved order. */
export function orderContacts<T extends { kind: string; sort_order: number }>(list: T[]): T[] {
  const rank = (k: string) => (k === "pm" ? 0 : k === "super" ? 1 : 2);
  return [...list].sort((a, b) => rank(a.kind) - rank(b.kind) || a.sort_order - b.sort_order);
}

/** A link a phone can dial, or null when the text holds no number. An extension is dialled after a pause. */
export function telHref(phone: string | null | undefined): string | null {
  const [main = "", ext = ""] = (phone ?? "").split(/\s*(?:ext\.?|x)\s*/i);
  const digits = main.replace(/\D/g, "");
  if (digits.length < 7) return null;
  const extDigits = ext.replace(/\D/g, "");
  return `tel:${main.trim().startsWith("+") ? "+" : ""}${digits}${extDigits ? `,${extDigits}` : ""}`;
}
