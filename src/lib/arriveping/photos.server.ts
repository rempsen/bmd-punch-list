import { AP_PATHS, parseWorkOrderPhotos, photoStoragePath, type ApPhoto } from "./core";

/**
 * Copies a completed work order's photos from ArrivePing into the job's photo bucket, filed under the install visit
 * (`install_visit_photos`). Server only. Nothing here throws: a photo that cannot be fetched is counted and logged, and the
 * next completion event or "Get photos" press tries it again. Photos already copied (by ArrivePing's photo id) are skipped.
 */

const PHOTO_BUCKET = "deficiency-photos";
const DOWNLOAD_TIMEOUT_MS = 20_000;
const MAX_PHOTO_BYTES = 20_000_000;

export type PhotoImport = { found: number; imported: number; skipped: number; failed: number; error?: string };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // install_visit_photos is newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabaseAdmin as any;
}

/** One photo, fetched from its signed URL. Null when it is not an image, too big, or could not be read. */
async function download(photo: ApPhoto, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetchImpl(photo.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? photo.contentType ?? "").split(";")[0]!.trim().toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_PHOTO_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.byteLength > MAX_PHOTO_BYTES || bytes.byteLength === 0 ? null : { bytes, contentType };
  } catch {
    return null;
  }
}

/**
 * Imports the photos on a visit's work order. `workOrder` is the record as a webhook delivered it, when there is one; the
 * work order is read from ArrivePing as well, since a delivery may leave photos out or carry links that have since expired.
 */
export async function importVisitPhotos(
  visit: { id: string; project_id: string; arriveping_job_id: string | null },
  workOrder: unknown = null,
  fetchImpl: typeof fetch = fetch,
): Promise<PhotoImport> {
  const none: PhotoImport = { found: 0, imported: 0, skipped: 0, failed: 0 };
  if (!visit.arriveping_job_id) return { ...none, error: "The visit is not in ArrivePing." };
  const db = await admin();
  let photos = parseWorkOrderPhotos(workOrder);
  let readError: string | undefined;
  try {
    const { apFetch } = await import("./client.server");
    const res = await apFetch(`${AP_PATHS.workorders}/${encodeURIComponent(visit.arriveping_job_id)}`, { method: "GET" }, fetchImpl);
    if (res.ok) {
      // Fresh links first: the same photo from the webhook is dropped as a duplicate by id.
      photos = [...parseWorkOrderPhotos(res.json), ...photos].filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
    } else if (!photos.length) {
      readError = res.error;
    }
  } catch (error) {
    if (!photos.length) readError = error instanceof Error ? error.message : String(error);
  }
  if (!photos.length) return { ...none, ...(readError ? { error: readError } : {}) };

  const { data: have, error: haveError } = await db
    .from("install_visit_photos")
    .select("arriveping_photo_id")
    .in("arriveping_photo_id", photos.map((p) => p.id));
  if (haveError) return { ...none, found: photos.length, error: `Could not read the visit's photos: ${haveError.message}` };
  const seen = new Set(((have ?? []) as { arriveping_photo_id: string }[]).map((r) => r.arriveping_photo_id));

  const out: PhotoImport = { found: photos.length, imported: 0, skipped: 0, failed: 0 };
  for (const photo of photos) {
    if (seen.has(photo.id)) {
      out.skipped++;
      continue;
    }
    const got = await download(photo, fetchImpl);
    if (!got) {
      out.failed++;
      console.error(`ArrivePing photos: could not fetch photo ${photo.id} for visit ${visit.id}`);
      continue;
    }
    const path = photoStoragePath(visit.id, { ...photo, contentType: got.contentType });
    const up = await db.storage.from(PHOTO_BUCKET).upload(path, got.bytes, { contentType: got.contentType, upsert: true });
    if (up.error) {
      out.failed++;
      console.error(`ArrivePing photos: could not store photo ${photo.id}: ${up.error.message}`);
      continue;
    }
    const { error } = await db.from("install_visit_photos").insert({
      visit_id: visit.id,
      project_id: visit.project_id,
      arriveping_photo_id: photo.id,
      storage_path: path,
      content_type: got.contentType,
      caption: photo.caption,
      taken_at: photo.takenAt,
      taken_by: photo.takenBy,
    });
    // Another import got there first (a webhook and a check at once): the photo is on file either way.
    if (error && /duplicate|unique/i.test(error.message)) out.skipped++;
    else if (error) {
      out.failed++;
      console.error(`ArrivePing photos: could not record photo ${photo.id}: ${error.message}`);
    } else out.imported++;
  }
  if (out.imported) {
    const { error } = await db.from("install_visit_events").insert({
      visit_id: visit.id,
      project_id: visit.project_id,
      status: "photos",
      note: `${out.imported} photo${out.imported === 1 ? "" : "s"} copied from ArrivePing`,
      source: "arriveping",
    });
    if (error) console.error(`install_visit_events: could not log the photo import for ${visit.id}: ${error.message}`);
  }
  return out;
}
