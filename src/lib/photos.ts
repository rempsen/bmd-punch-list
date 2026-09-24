import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PHOTO_BUCKET = "deficiency-photos";

/** Downscale to max 1600px on the long edge and re-encode as JPEG. */
export async function compressImage(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  if (typeof document === "undefined") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  return blob ?? file;
}

export async function uploadDeficiencyPhoto(
  deficiencyId: string,
  file: File,
  kind: "before" | "after",
  userId?: string,
) {
  const blob = await compressImage(file);
  const path = `${deficiencyId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg" });
  if (upErr) throw upErr;
  const { error } = await supabase.from("deficiency_photos").insert({
    deficiency_id: deficiencyId,
    storage_path: path,
    kind,
    uploaded_by: userId ?? null,
  });
  if (error) throw error;
  return path;
}

export async function signPaths(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
  }
  return map;
}

export function useSignedUrls(paths: string[]) {
  const key = [...paths].sort().join("|");
  return useQuery({
    queryKey: ["signed-urls", key],
    queryFn: () => signPaths(paths),
    enabled: paths.length > 0,
    staleTime: 30 * 60 * 1000,
  });
}
