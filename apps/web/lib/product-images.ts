"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Product pictures (migration 20261105110000, D-39). The bucket is private: the office uploads under
// products/{product id}/{uuid}.{ext} with its signed-in session, and pages show pictures through
// short-lived signed URLs. The storage policies decide who may write and read; these checks only
// save a round trip with a clear message.

const BUCKET = "product-images";
const SIGNED_URL_SECONDS = 3600;
export const MAX_IMAGE_BYTES = 5_242_880; // 5 MB, the bucket's own limit
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Signed URLs for the given object names, keyed by name. Asks storage only when there is a name.
 * A failure (storage not running, a refused read) gives no URLs: the page shows "No picture" instead
 * of an error, because the product itself is still usable.
 */
export async function signedImageUrls(paths: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
  const names = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  if (names.length === 0) return {};
  try {
    const { data, error } = await supabaseBrowser().storage.from(BUCKET).createSignedUrls(names, SIGNED_URL_SECONDS);
    if (error || !data) return {};
    return Object.fromEntries(
      data.flatMap((d: { path: string | null; signedUrl: string | null; error: string | null }) =>
        d.path && d.signedUrl && !d.error ? [[d.path, d.signedUrl]] : [],
      ),
    );
  } catch {
    return {};
  }
}

/** Uploads a picture for a product and returns its object name, or throws a message for the page. */
export async function uploadProductImage(productId: string, file: File): Promise<string> {
  const ext = EXTENSION[file.type];
  if (!ext) throw new Error("Choose a PNG, JPEG or WebP picture.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The picture is larger than 5 MB.");
  const name = `products/${productId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseBrowser().storage.from(BUCKET).upload(name, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`The picture was not uploaded: ${error.message}`);
  return name;
}
