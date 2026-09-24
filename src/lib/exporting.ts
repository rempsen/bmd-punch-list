import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { itemNo, STATUS_LABEL, assessmentMeta } from "./bmd";
import type { DefRow, PhotoRow } from "./data";
import { signPaths } from "./photos";

export type ExportRow = DefRow & { photoPaths: string[] };

export function buildRows(items: DefRow[], photos: PhotoRow[]): ExportRow[] {
  return items.map((d) => ({
    ...d,
    photoPaths: photos.filter((p) => p.deficiency_id === d.id).map((p) => p.storage_path),
  }));
}

const flat = async (rows: ExportRow[]) => {
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
    Description: r.description ?? "",
    "Due date": r.due_date ?? "",
    Created: new Date(r.created_at).toLocaleDateString(),
    Closed: r.closed_at ? new Date(r.closed_at).toLocaleDateString() : "",
    "Photo URLs": r.photoPaths.map((p) => urls[p] ?? p).join(" | "),
  }));
};

export async function exportExcel(rows: ExportRow[], projectName: string) {
  const data = await flat(rows);
  const sheet = XLSX.utils.json_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Deficiencies");
  XLSX.writeFile(book, `${projectName.replace(/\s+/g, "-")}-deficiencies.xlsx`);
}

export async function exportCsv(rows: ExportRow[], projectName: string) {
  const data = await flat(rows);
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
) {
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
    doc.text(`${project.name} — Deficiency report`, tx, margin + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    doc.text(reportDate, tx, margin + 22);
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
  const sub = [project.client_name, project.address].filter(Boolean).join("  ·  ");
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

  const floorNames = new Map<number, string>();
  for (const r of rows) {
    const f = r.locations?.floors;
    if (f) floorNames.set(f.number, floorLabel(f));
  }
  const byFloor = new Map<number, ExportRow[]>();
  for (const r of rows) {
    const f = r.locations?.floors?.number ?? 0;
    byFloor.set(f, [...(byFloor.get(f) ?? []), r]);
  }

  for (const floorNumber of [...byFloor.keys()].sort((a, b) => a - b)) {
    const floorRows = byFloor.get(floorNumber) ?? [];
    ensureSpace(40);
    doc.setFillColor(35, 45, 70);
    doc.rect(margin, y - 12, pageWidth - margin * 2, 20, "F");
    doc.setTextColor(255);
    doc.setFontSize(11);
    doc.text(floorNames.get(floorNumber) ?? `Floor ${floorNumber}`, margin + 6, y + 2);
    doc.setTextColor(20);
    y += 24;

    const byLocation = new Map<string, ExportRow[]>();
    for (const r of floorRows) {
      const name = r.locations?.name ?? "—";
      byLocation.set(name, [...(byLocation.get(name) ?? []), r]);
    }

    for (const name of [...byLocation.keys()].sort()) {
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

  doc.save(`${project.name.replace(/\s+/g, "-")}-deficiency-report.pdf`);
}
