// Shared definitions and pure helpers for the New job wizard and Job details page.

export const SCOPES = [
  { key: "floor_tile", label: "Floor tile" },
  { key: "wall_tile", label: "Wall tile" },
  { key: "lvp", label: "Vinyl plank / LVP" },
  { key: "hardwood", label: "Hardwood" },
  { key: "laminate", label: "Laminate" },
  { key: "carpet", label: "Carpet (broadloom)" },
  { key: "carpet_tile", label: "Carpet tile" },
  { key: "wall_base", label: "Wall base" },
  { key: "transitions", label: "Transitions / trim" },
  { key: "window_coverings", label: "Window coverings" },
  { key: "countertops", label: "Countertops" },
  { key: "other", label: "Other" },
] as const;
export type ScopeKey = (typeof SCOPES)[number]["key"];
export const scopeLabel = (k: string) => SCOPES.find((s) => s.key === k)?.label ?? k;

const SCOPE_LISTS: Record<ScopeKey, { materials: string[]; issues: string[] }> = {
  floor_tile: {
    materials: ["Floor tile", "Grout & caulk"],
    issues: ["Lippage", "Chipped / cracked", "Hollow tile", "Grout inconsistent / missing", "Caulking missing or poor", "Exposed cut edge", "Layout / pattern misaligned"],
  },
  wall_tile: {
    materials: ["Wall tile", "Grout & caulk"],
    issues: ["Lippage", "Chipped / cracked", "Hollow tile", "Grout inconsistent / missing", "Caulking missing or poor", "Exposed cut edge", "Layout / pattern misaligned"],
  },
  lvp: { materials: ["Vinyl plank"], issues: ["Gap / open joint", "Scratched / gouged", "Lifting / peaking", "Visible seam"] },
  hardwood: { materials: ["Hardwood"], issues: ["Gap / open joint", "Scratched / gouged", "Cupping / crowning", "Squeak / loose board", "Finish defect"] },
  laminate: { materials: ["Laminate"], issues: ["Gap / open joint", "Scratched / gouged", "Lifting / peaking", "Chipped edge"] },
  carpet: { materials: ["Carpet"], issues: ["Visible seam", "Ripple / buckling", "Loose at edge", "Stain / discoloration", "Pile direction wrong"] },
  carpet_tile: { materials: ["Carpet tile"], issues: ["Visible seam", "Tile lifting", "Pattern / direction wrong", "Stain / discoloration"] },
  wall_base: { materials: ["Wall base"], issues: ["Loose base", "Gap at corner", "Poor mitre / seam"] },
  transitions: { materials: ["Transition / trim"], issues: ["Loose / missing trim", "Height mismatch", "Wrong profile"] },
  window_coverings: {
    materials: ["Blind", "Drapery", "Hardware", "Motorization"],
    issues: ["Not level", "Doesn't close", "Missing valance", "Damaged slat", "Cord/chain issue", "Wrong size", "Light gap"],
  },
  countertops: { materials: ["Countertop"], issues: ["Chipped / cracked", "Seam visible", "Not level", "Caulking missing or poor", "Overhang incorrect"] },
  other: { materials: [], issues: [] },
};

export type BuildingType = "numbered" | "named" | "mixed";
export const BUILDING_TYPES: { value: BuildingType; label: string; hint: string }[] = [
  { value: "numbered", label: "Hotel / multi-residential", hint: "Numbered rooms like 201–228" },
  { value: "named", label: "Office / commercial", hint: "Named rooms like Boardroom, Reception" },
  { value: "mixed", label: "Mixed", hint: "Numbered rooms and named spaces" },
];

const AREAS: Record<"numbered" | "named", string[]> = {
  numbered: ["Entry / vestibule", "Main room", "Closet", "Bathroom – shower walls", "Bathroom – vanity wall", "Bathroom – general wall tile", "Bathroom – floor", "Corridor"],
  named: ["Main floor area", "Walls", "Doorway / threshold", "Washroom – floor", "Washroom – walls", "Kitchen / lunchroom", "Stairs", "Corridor"],
};

export function buildPickLists(building: BuildingType, scopes: { scope: string; other_text?: string | null }[]) {
  const areas =
    building === "mixed" ? [...new Set([...AREAS.numbered, ...AREAS.named])] : [...AREAS[building]];
  if (scopes.some((s) => s.scope === "window_coverings")) areas.push("Window");
  areas.push("Other");
  const materials: string[] = [];
  const issues: string[] = [];
  for (const s of scopes) {
    const l = SCOPE_LISTS[s.scope as ScopeKey];
    if (l) {
      materials.push(...l.materials);
      issues.push(...l.issues);
    }
    if (s.scope === "other" && s.other_text?.trim()) materials.push(s.other_text.trim());
  }
  issues.push("Stain / discoloration", "Missing piece", "Other");
  const uniq = (a: string[]) => [...new Set(a)];
  return [
    ...uniq(areas).map((value) => ({ kind: "area" as const, value })),
    ...uniq(materials).map((value) => ({ kind: "material" as const, value })),
    ...uniq(issues).map((value) => ({ kind: "issue_type" as const, value })),
  ];
}

export const HOTEL_CHIPS = [
  "Corridor – North", "Corridor – South", "Elevator lobby", "Ice/vending", "Stairwell", "Housekeeping",
  "Fitness", "Pool", "Restaurant", "Lobby", "Back of house",
];
export const OFFICE_CHIPS = [
  "Vestibule", "Lobby", "Reception", "Common area", "Boardroom", "Meeting room", "Private office", "Open office",
  "Men's washroom", "Women's washroom", "Universal washroom", "Kitchen / lunchroom", "Janitor", "Storage",
  "Mechanical", "Electrical", "IT/server", "Corridor", "Stairwell", "Elevator lobby",
];

/** Parses "201-214, 216-228" (with optional prefix) into room names. */
export function parseRoomRange(text: string, prefix = ""): { rooms: string[]; error?: string } {
  const rooms: string[] = [];
  for (const raw of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = raw.match(/^(\d+)(?:[-–](\d+))?$/);
    if (!m) return { rooms, error: `Can't read "${raw}"` };
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a) return { rooms, error: `"${raw}" runs backwards` };
    if (b - a > 500) return { rooms, error: `"${raw}" is too large` };
    for (let n = a; n <= b; n++) rooms.push(`${prefix}${n}`);
  }
  return { rooms: [...new Set(rooms)] };
}

export type NamedRoom = { name: string; qty: number };
export type WizardFloor = {
  key: string;
  label: string;
  rangeText: string;
  prefix: string;
  common: string[];
  named: NamedRoom[];
};

export type Contact = {
  kind: "client" | "pm" | "super" | "gc" | "site" | "other";
  name: string;
  company: string;
  title: string;
  email: string;
  phone_mobile: string;
  phone_office: string;
};
export const emptyContact = (kind: Contact["kind"]): Contact => ({
  kind, name: "", company: "", title: "", email: "", phone_mobile: "", phone_office: "",
});

export type WizardData = {
  name: string;
  street: string;
  city: string;
  province: string;
  postal_code: string;
  po_number: string;
  start_date: string;
  target_date: string;
  notes: string;
  client_company: string;
  contact: Contact;
  second: Contact;
  hasSecond: boolean;
  site_phone: string;
  scopes: string[];
  other_scope: string;
  building: BuildingType;
  floors: WizardFloor[];
};

let k = 0;
export const newKey = () => `f${Date.now().toString(36)}${k++}`;

export function defaultFloorLabels(n: number): string[] {
  const out = ["Basement", "Main floor"];
  for (let i = 2; out.length < n; i++) out.push(String(i));
  return out.slice(0, n);
}

export const blankFloor = (label: string): WizardFloor => ({
  key: newKey(), label, rangeText: "", prefix: "", common: [], named: [],
});

export const emptyWizard = (): WizardData => ({
  name: "", street: "", city: "", province: "", postal_code: "", po_number: "", start_date: "", target_date: "", notes: "",
  client_company: "", contact: emptyContact("client"), second: emptyContact("gc"), hasSecond: false, site_phone: "",
  scopes: [], other_scope: "", building: "numbered",
  floors: defaultFloorLabels(3).map(blankFloor),
});

export const joinAddress = (d: Pick<WizardData, "street" | "city" | "province" | "postal_code">) =>
  [d.street, d.city, [d.province, d.postal_code].filter((x) => x.trim()).join(" ")].map((x) => x.trim()).filter(Boolean).join(", ");

export type BuiltLocation = { type: "room" | "common_area"; name: string; room_type: string | null };

export function floorLocations(f: WizardFloor, building: BuildingType): { locations: BuiltLocation[]; error?: string } {
  const locations: BuiltLocation[] = [];
  let error: string | undefined;
  if (building !== "named" && f.rangeText.trim()) {
    const r = parseRoomRange(f.rangeText, f.prefix.trim());
    error = r.error;
    locations.push(...r.rooms.map((name) => ({ type: "room" as const, name, room_type: "Guest room" })));
  }
  if (building !== "numbered") {
    for (const n of f.named) {
      const qty = Math.max(1, Math.min(99, Math.floor(n.qty || 1)));
      for (let i = 1; i <= qty; i++)
        locations.push({ type: "room", name: qty > 1 ? `${n.name} ${i}` : n.name, room_type: n.name });
    }
  }
  for (const c of f.common) locations.push({ type: "common_area", name: c, room_type: null });
  // de-duplicate by name
  const seen = new Set<string>();
  return { locations: locations.filter((l) => (seen.has(l.name.toLowerCase()) ? false : (seen.add(l.name.toLowerCase()), true))), ...(error ? { error } : {}) };
}

/** Floor numbers: numeric labels keep their number, Basement is 0, others get their position. */
export function floorNumbers(labels: string[]): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  labels.forEach((l, i) => {
    const t = l.trim();
    let n = /^\d+$/.test(t) ? Number(t) : /^(floor|level)\s+(\d+)$/i.test(t) ? Number(t.match(/\d+/)![0]) : /basement|lower/i.test(t) ? 0 : /^main/i.test(t) ? 1 : i;
    while (used.has(n)) n = n < 100 ? 100 + i : n + 1;
    used.add(n);
    out.push(n);
  });
  return out;
}

export function summarise(d: WizardData) {
  let rooms = 0;
  let common = 0;
  for (const f of d.floors) {
    for (const l of floorLocations(f, d.building).locations) (l.type === "room" ? rooms++ : common++);
  }
  return { floors: d.floors.length, rooms, common };
}

export function buildPayload(d: WizardData) {
  const nums = floorNumbers(d.floors.map((f) => f.label));
  const scopes = d.scopes.map((s) => ({ scope: s, other_text: s === "other" ? d.other_scope : null }));
  const contacts: Record<string, unknown>[] = [
    { ...d.contact, kind: "client", company: d.contact.company || d.client_company, is_primary: true },
  ];
  if (d.hasSecond && (d.second.name || d.second.company || d.second.email)) contacts.push({ ...d.second, is_primary: false });
  if (d.site_phone.trim()) contacts.push({ kind: "site", name: "Site contact", phone_mobile: d.site_phone, is_primary: false });
  return {
    name: d.name,
    street: d.street,
    city: d.city,
    province: d.province,
    postal_code: d.postal_code,
    address: joinAddress(d),
    po_number: d.po_number,
    start_date: d.start_date,
    target_date: d.target_date,
    notes: d.notes,
    building_type: d.building,
    client_company: d.client_company,
    contacts,
    scopes,
    pick_lists: buildPickLists(d.building, scopes),
    floors: d.floors.map((f, i) => ({ label: f.label.trim() || `Floor ${i + 1}`, number: nums[i], locations: floorLocations(f, d.building).locations })),
  };
}
