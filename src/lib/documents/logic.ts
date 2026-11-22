export type DocSection = "plans" | "specifications" | "vendor" | "quotes_sent" | "contract" | "photos" | "other";

export const SECTIONS: { value: DocSection; label: string }[] = [
  { value: "plans", label: "Plans" },
  { value: "specifications", label: "Specifications" },
  { value: "vendor", label: "Vendor quotes and data sheets" },
  { value: "quotes_sent", label: "Quotes sent" },
  { value: "contract", label: "Contract" },
  { value: "photos", label: "Photos" },
  { value: "other", label: "Other" },
];
export const sectionLabel = (s: DocSection) => SECTIONS.find((x) => x.value === s)?.label ?? s;

export type DocRow = {
  id: string;
  project_id: string;
  section: DocSection;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  mime: string | null;
  version: number;
  uploaded_by: string | null;
  note: string | null;
  mirror_status: string;
  mirror_error: string | null;
  created_at: string;
};

export const MAX_BYTES = 250 * 1024 * 1024;
export const BUCKET = "project-documents";

/** A storage-key-safe version of a file name. The original name is kept in the database row. */
export function safeFileName(name: string): string {
  const flat = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^[.\\/\s]+/, "")
    .replace(/[^A-Za-z0-9 ._()-]+/g, "_")
    .trim();
  if (!/[A-Za-z0-9]/.test(flat)) return "file";
  if (flat.length <= 120) return flat;
  const dot = flat.lastIndexOf(".");
  const ext = dot > 0 && flat.length - dot <= 10 ? flat.slice(dot) : "";
  return flat.slice(0, 120 - ext.length) + ext;
}

export const storagePath = (projectId: string, section: DocSection, documentId: string, fileName: string) =>
  `${projectId}/${section}/${documentId}/${safeFileName(fileName)}`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function checkFile(f: { name: string; size: number }): string | null {
  if (f.size === 0) return `${f.name} is empty.`;
  if (f.size > MAX_BYTES) return `${f.name} is ${formatBytes(f.size)} — the limit is 250 MB per file.`;
  return null;
}

/** What the browser can show inline. SVG is left out on purpose: it can carry script. */
export function previewKind(mime: string | null, name: string): "pdf" | "image" | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime ?? "") || ["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
    return mime === "image/svg+xml" ? null : "image";
  }
  return null;
}

export function guessSection(name: string, mime?: string): DocSection {
  if (mime?.startsWith("image/")) return "photos";
  if (/spec|project manual|\b\d{2} \d{2} \d{2}\b|division \d/i.test(name)) return "specifications";
  return "plans";
}

export type DocEntry = { latest: DocRow; older: DocRow[] };

/** One entry per file name in each section, newest version first. */
export function groupVersions(rows: DocRow[]): Record<DocSection, DocEntry[]> {
  const out = Object.fromEntries(SECTIONS.map((s) => [s.value, [] as DocEntry[]])) as Record<DocSection, DocEntry[]>;
  const byKey = new Map<string, DocRow[]>();
  for (const r of rows) {
    const k = `${r.section}\u0000${r.file_name.toLowerCase()}`;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => b.version - a.version);
    out[sorted[0]!.section].push({ latest: sorted[0]!, older: sorted.slice(1) });
  }
  for (const s of SECTIONS) out[s.value].sort((a, b) => a.latest.file_name.localeCompare(b.latest.file_name, undefined, { numeric: true }));
  return out;
}
