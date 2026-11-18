"use client";
import { supabaseBrowser } from "@/lib/supabase/browser";

// Public shop pictures (migration 20261111010000, D-52). The bucket is public-read. The office
// uploads under storefront/{product id}/{uuid}.{ext}. Storage policies decide who may write.

const BUCKET = "storefront-images";
export const MAX_IMAGE_BYTES = 5_242_880; // 5 MB, the bucket's own limit
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Public URL for a storefront object name. Null when there is no name. */
export function storefrontImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabaseBrowser().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl || null;
}

/** Uploads a shop picture for this product and returns its object name, or throws a message. */
export async function uploadStorefrontImage(productId: string, file: File): Promise<string> {
  const ext = EXTENSION[file.type];
  if (!ext) throw new Error("Choose a PNG, JPEG or WebP picture.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("The picture is larger than 5 MB.");
  const name = `storefront/${productId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseBrowser().storage.from(BUCKET).upload(name, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(`The picture was not uploaded: ${error.message}`);
  return name;
}
