import { floorLabel, floorShort } from "@/lib/data";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { itemNo, STATUS_LABEL, assessmentMeta } from "./bmd";
import type { DefRow, PhotoRow, ProjectContact } from "./data";
import { respLabel, RESPONSIBLE } from "./responsible";
import { assigneeText, personName, tradeOf, type Person } from "./assign";

export type GroupBy = "none" | "floor" | "person" | "trade" | "responsible";
export type PdfOptions = {
  groupBy?: GroupBy;
  people?: Map<string, Person>;
  contacts?: ProjectContact[];
  title?: string;
  asBlob?: boolean;
  fileName?: string;
};
type Section = { title: string; lines: string[]; rows: ExportRow[] };

const byFloorRoom = (a: DefRow, b: DefRow) =>
  (a.locations?.floors?.number ?? 0) - (b.locations?.floors?.number ?? 0) ||
  (a.locations?.name ?? "").localeCompare(b.locations?.name ?? "", undefined, { numeric: true }) ||
  a.item_number - b.item_number;

const locKey = (r: DefRow, withFloor: boolean) => {
  const name = r.locations?.name ?? "—";
  return withFloor ? `${floorLabel(r.locations?.floors)} · ${name}` : name;
};

function contactLines(match: (c: ProjectContact) => boolean, contacts: ProjectContact[], extra: string[] = []) {
  const c = contacts.find(match);
  const parts = [...extra];
  if (c) {
    if (c.name) parts.push(c.name);
    if (c.phone_mobile || c.phone_office) parts.push(c.phone_mobile || c.phone_office || "");
    if (c.email && !parts.includes(c.email)) parts.push(c.email);
  }
  return parts.length ? [parts.filter(Boolean).join("  ·  ")] : [];
}

export function buildSections(rows: ExportRow[], opts: PdfOptions): Section[] {
  const sorted = [...rows].sort(byFloorRoom);
  const people = opts.people ?? new Map<string, Person>();
  const contacts = opts.contacts ?? [];
  const mode = opts.groupBy ?? "floor";
  if (mode === "none") return [{ title: "All items", lines: [], rows: sorted }];
  const map = new Map<string, Section>();
  const unassigned: ExportRow[] = [];
  for (const r of sorted) {
    let key: string;
    let make: () => Section;
    if (mode === "responsible") {
      if (r.responsible_party === "unassigned") {
        unassigned.push(r);
        continue;
      }
      key = r.responsible_party;
      make = () => ({ title: respLabel(r.responsible_party), lines: [], rows: [] });
    } else if (mode === "floor") {
      const f = r.locations?.floors;
      key = String(f?.number ?? 0);
      make = () => ({ title: floorLabel(f), lines: [], rows: [] });
    } else if (mode === "person") {
      if (!r.assigned_to) {
        unassigned.push(r);
        continue;
      }
      const p = people.get(r.assigned_to);
      key = r.assigned_to;
      make = () => {
        const email = (p?.email ?? "").toLowerCase();
        return {
          title: personName(p),
          lines: contactLines(
            (c) => !!email && c.email?.toLowerCase() === email,
            contacts,
            [p?.company ?? "", p?.email ?? ""].filter(Boolean),
          ),
          rows: [],
        };
      };
    } else {
      const t = tradeOf(r, people);
      if (!t) {
        unassigned.push(r);
        continue;
      }
      key = t.toLowerCase();
      make = () => {
        const emails = [...people.values()].filter((p) => p.company?.trim().toLowerCase() === key && p.email).map((p) => p.email!);
        const lines = contactLines((c) => c.company?.trim().toLowerCase() === key, contacts);
        return { title: t, lines: lines.length ? lines : emails.length ? [emails.join(", ")] : [], rows: [] };
      };
    }
    if (!map.has(key)) map.set(key, make());
    map.get(key)!.rows.push(r);
  }
  const out = [...map.values()];
  if (mode === "floor") out.sort((a, b) => (a.rows[0]?.locations?.floors?.number ?? 0) - (b.rows[0]?.locations?.floors?.number ?? 0));
  else if (mode === "responsible")
    out.sort((a, b) => RESPONSIBLE.findIndex((x) => x.value === a.rows[0]?.responsible_party) - RESPONSIBLE.findIndex((x) => x.value === b.rows[0]?.responsible_party));
  else out.sort((a, b) => a.title.localeCompare(b.title));
  if (unassigned.length) out.push({ title: mode === "responsible" ? "Not yet assigned" : "Unassigned", lines: [], rows: unassigned });
  return out;
}
import { signPaths } from "./photos";

export type ExportRow = DefRow & { photoPaths: string[] };

export function buildRows(items: DefRow[], photos: PhotoRow[]): ExportRow[] {
  return items.map((d) => ({
    ...d,
    photoPaths: photos.filter((p) => p.deficiency_id === d.id).map((p) => p.storage_path),
  }));
}

const flat = async (rows: ExportRow[], people: Map<string, Person> = new Map()) => {
  const allPaths = rows.flatMap((r) => r.photoPaths);
  const urls = allPaths.length > 0 ? await signPaths(allPaths) : {};
  return rows.map((r) => ({
    Item: itemNo(r.item_number),
    Floor: floorLabel(r.locations?.floors),
    Location: r.locations?.name ?? "",
    Area: r.area,
    Material: r.material,
    Issue: r.issue_type,
    Assessment: assessmentMeta(r.assessment).label,
    Status: STATUS_LABEL[r.status],
    "Responsible party": respLabel(r.responsible_party),
    "Assigned person": assigneeText(r, people).person,
    "Trade / company": tradeOf(r, people),
    Assigned: r.assigned_at ? new Date(r.assigned_at).toLocaleDateString() : "",
    Description: r.description ?? "",
    "Due date": r.due_date ?? "",
    Created: new Date(r.created_at).toLocaleDateString(),
    Closed: r.closed_at ? new Date(r.closed_at).toLocaleDateString() : "",
    "Photo URLs": r.photoPaths.map((p) => urls[p] ?? p).join(" | "),
  }));
};

export async function exportExcel(rows: ExportRow[], projectName: string, people?: Map<string, Person>) {
  const data = await flat(rows, people);
  const sheet = XLSX.utils.json_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Deficiencies");
  XLSX.writeFile(book, `${projectName.replace(/\s+/g, "-")}-deficiencies.xlsx`);
}

export async function exportCsv(rows: ExportRow[], projectName: string, people?: Map<string, Person>) {
  const data = await flat(rows, people);
  const sheet = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName.replace(/\s+/g, "-")}-deficiencies.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function exportPdf(
  rows: ExportRow[],
  project: { name: string; client_name: string | null; address: string | null },
  clientText?: string,
  opts: PdfOptions = {},
): Promise<Blob | void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  let y = margin;
  const logo = await toDataUrl("/bmd-logo.png");
  const reportDate = new Date().toLocaleDateString();

  const drawHeader = () => {
    const logoW = 80;
    const logoH = 40;
    if (logo) doc.addImage(logo, "PNG", margin, margin - 8, logoW, logoH);
    const tx = margin + (logo ? logoW + 12 : 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20, 20, 20);
    doc.text(`${project.name} — ${opts.title ?? "Deficiency report"}`, tx, margin + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(clientText ? `${reportDate}  ·  ${clientText}` : reportDate, tx, margin + 22);
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(232, 196, 184);
    doc.line(margin, margin + 38, pageWidth - margin, margin + 38);
    y = margin + 56;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      drawHeader();
    }
  };

  drawHeader();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const sub = [clientText ? null : project.client_name, project.address].filter(Boolean).join("  ·  ");
  if (sub) {
    doc.text(sub, margin, y);
    y += 18;
  }

  const counts = {
    total: rows.length,
    mustFix: rows.filter((r) => r.assessment === "must_fix").length,
    review: rows.filter((r) => r.assessment === "client_review").length,
    acceptable: rows.filter((r) => r.assessment === "acceptable").length,
    closed: rows.filter((r) => r.status === "verified" || r.status === "accepted_as_is").length,
  };
  doc.setFont("helvetica", "bold");
  doc.text(
    `Total ${counts.total}   ·   Must fix ${counts.mustFix}   ·   Needs client review ${counts.review}   ·   Acceptable ${counts.acceptable}   ·   Closed ${counts.closed}`,
    margin,
    y,
  );
  y += 20;

  const urls = await signPaths(rows.flatMap((r) => r.photoPaths).slice(0, 120));

  const sections = buildSections(rows, opts);

  for (const section of sections) {
    ensureSpace(60);
    const headerH = 20 + section.lines.length * 11;
    doc.setFillColor(35, 45, 70);
    doc.rect(margin, y - 12, pageWidth - margin * 2, headerH, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.title, margin + 6, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${section.rows.length} item${section.rows.length === 1 ? "" : "s"}`, pageWidth - margin - 6, y + 2, { align: "right" });
    section.lines.forEach((l, i) => doc.text(l, margin + 6, y + 14 + i * 11));
    doc.setTextColor(20);
    y += headerH + 4;

    const byLocation = new Map<string, ExportRow[]>();
    for (const r of section.rows) {
      const name = locKey(r, opts.groupBy !== "floor");
      byLocation.set(name, [...(byLocation.get(name) ?? []), r]);
    }

    for (const name of byLocation.keys()) {
      ensureSpace(92);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text(name, margin, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);

      for (const r of byLocation.get(name) ?? []) {
        ensureSpace(70);
        doc.setFont("helvetica", "bold");
        doc.text(itemNo(r.item_number), margin, y);
        doc.setFont("helvetica", "normal");
        doc.text(
          `${r.area} · ${r.material} · ${r.issue_type}`,
          margin + 55,
          y,
          { maxWidth: pageWidth - margin * 2 - 200 },
        );
        doc.text(
          `${assessmentMeta(r.assessment).label} · ${STATUS_LABEL[r.status]}`,
          pageWidth - margin - 150,
          y,
        );
        y += 12;
        {
          const a = assigneeText(r, opts.people ?? new Map<string, Person>());
          const who = a.person || a.trade;
          if (r.responsible_party !== "unassigned" || who) {
            doc.setTextColor(100);
            doc.text(`Responsible: ${respLabel(r.responsible_party)}${who ? ` · ${who}` : ""}`, margin + 55, y);
            doc.setTextColor(20);
            y += 11;
          }
        }
        if (r.description) {
          const lines = doc.splitTextToSize(r.description, pageWidth - margin * 2 - 60) as string[];
          doc.setTextColor(100);
          doc.text(lines, margin + 55, y);
          doc.setTextColor(20);
          y += lines.length * 11;
        }

        const thumbs = r.photoPaths.slice(0, 4);
        if (thumbs.length > 0) {
          ensureSpace(70);
          let x = margin + 55;
          for (const path of thumbs) {
            const url = urls[path];
            if (!url) continue;
            const dataUrl = await toDataUrl(url);
            if (!dataUrl) continue;
            try {
              doc.addImage(dataUrl, "JPEG", x, y, 70, 55);
              x += 78;
            } catch {
              /* skip unreadable image */
            }
          }
          y += 62;
        }
        y += 6;
      }
    }
  }

  if (opts.asBlob) return doc.output("blob");
  doc.save(opts.fileName ?? `${project.name.replace(/\s+/g, "-")}-deficiency-report.pdf`);
}
