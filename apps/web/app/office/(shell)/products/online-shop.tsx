"use client";
import { useEffect, useRef, useState } from "react";
import { rupees } from "@/lib/money";
import { rpc } from "@/lib/rpc";
import { IMAGE_ACCEPT, storefrontImageUrl, uploadStorefrontImage } from "@/lib/storefront-images";

// Online shop panel (P1-33, D-52, D-58). The database keeps the page and decides publish.
// The public price is the SKU's existing default price. This panel does not set a price.

const TITLE_MAX = 60;
const DESC_MAX = 160;
const BODY_MAX = 4000;
const HOW_MAX = 2000;

export type ShopSku = {
  id: string;
  code: string;
  variant: string;
  published: boolean;
  list_price_paisa: number | string | null;
};

export type ShopRow = {
  product_group_id: string;
  category_slug: string | null;
  category_meta_title: string | null;
  category_meta_description: string | null;
  category_body: string | null;
  category_published: boolean | null;
  product_id: string;
  slug: string | null;
  meta_title: string | null;
  meta_description: string | null;
  body: string | null;
  how_to_use: string | null;
  image_path: string | null;
  published: boolean | null;
  skus: ShopSku[] | string | null;
};

type ProductRef = {
  product_id: string;
  product_group_id: string;
  skus: { id: string; code: string; variant: string; list_price_paisa: number | null }[];
};

const paisaOf = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const shadesOf = (raw: ShopRow["skus"], fallback: ProductRef["skus"]): ShopSku[] => {
  if (typeof raw === "string") {
    try {
      return shadesOf(JSON.parse(raw) as ShopSku[], fallback);
    } catch {
      return fallback.map((s) => ({ ...s, published: false }));
    }
  }
  if (raw && raw.length > 0) return raw;
  return fallback.map((s) => ({ ...s, published: false }));
};

const firstPublished = (data: { published: boolean }[] | { published: boolean } | null) => {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The database returned no row.");
  return row.published;
};

export function OnlineShop({
  product,
  row,
  onDone,
}: {
  product: ProductRef;
  row: ShopRow | undefined;
  onDone: (m: string) => Promise<void>;
}) {
  const [catSlug, setCatSlug] = useState(row?.category_slug ?? "");
  const [catTitle, setCatTitle] = useState(row?.category_meta_title ?? "");
  const [catDesc, setCatDesc] = useState(row?.category_meta_description ?? "");
  const [catBody, setCatBody] = useState(row?.category_body ?? "");
  const [slug, setSlug] = useState(row?.slug ?? "");
  const [title, setTitle] = useState(row?.meta_title ?? "");
  const [desc, setDesc] = useState(row?.meta_description ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [how, setHow] = useState(row?.how_to_use ?? "");
  const [imagePath, setImagePath] = useState(row?.image_path ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catClient, setCatClient] = useState(() => crypto.randomUUID());
  const [pageClient, setPageClient] = useState(() => crypto.randomUUID());
  // One key per publish attempt, kept until the database accepts it (H-08).
  const publishKeys = useRef(new Map<string, string>());
  const clientFor = (key: string) => {
    const existing = publishKeys.current.get(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    publishKeys.current.set(key, created);
    return created;
  };

  useEffect(() => {
    setCatSlug(row?.category_slug ?? "");
    setCatTitle(row?.category_meta_title ?? "");
    setCatDesc(row?.category_meta_description ?? "");
    setCatBody(row?.category_body ?? "");
    setSlug(row?.slug ?? "");
    setTitle(row?.meta_title ?? "");
    setDesc(row?.meta_description ?? "");
    setBody(row?.body ?? "");
    setHow(row?.how_to_use ?? "");
    setImagePath(row?.image_path ?? "");
  }, [row]);

  const run = async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      await onDone(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCategory = () =>
    run(async () => {
      await rpc("office_upsert_storefront_category", {
        p_client_id: catClient,
        p_product_group_id: product.product_group_id,
        p_slug: catSlug,
        p_meta_title: catTitle,
        p_meta_description: catDesc,
        p_body: catBody,
      });
      setCatClient(crypto.randomUUID());
      return "Category page saved.";
    });

  const savePage = (path: string) =>
    run(async () => {
      await rpc("office_upsert_storefront_product", {
        p_client_id: pageClient,
        p_product_id: product.product_id,
        p_slug: slug,
        p_meta_title: title,
        p_meta_description: desc,
        p_body: body,
        p_how_to_use: how,
        p_image_path: path,
      });
      setPageClient(crypto.randomUUID());
      return "Online shop page saved.";
    });

  const setPublished = (kind: "category" | "product" | "sku", subjectId: string, published: boolean, label: string) =>
    run(async () => {
      const key = `${kind}:${subjectId}:${published}`;
      const data = await rpc<{ published: boolean }[] | { published: boolean }>("office_set_storefront_published", {
        p_client_id: clientFor(key),
        p_kind: kind,
        p_subject_id: subjectId,
        p_published: published,
      });
      publishKeys.current.set(key, crypto.randomUUID());
      const on = firstPublished(data);
      return on ? `${label} is published.` : `${label} is not published.`;
    });

  const shades = shadesOf(row?.skus ?? null, product.skus);
  const preview = storefrontImageUrl(imagePath);
  const categoryState =
    row?.category_published === true
      ? "Category page is published."
      : row?.category_slug
        ? "Category page is not published."
        : "Category page is not saved.";

  return (
    <section className="card" aria-label="Online shop" data-testid={`online-shop-${product.product_id}`}>
      <h3>Online shop</h3>
      <p className="muted">{categoryState} A product is listed only when its category page is published.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        aria-label="Category page"
        onSubmit={(e) => {
          e.preventDefault();
          void saveCategory();
        }}
      >
        <label htmlFor={`cat-slug-${product.product_id}`}>
          Category address ({catSlug.length} characters)
          <input id={`cat-slug-${product.product_id}`} value={catSlug} onChange={(e) => setCatSlug(e.target.value)} />
        </label>
        <label htmlFor={`cat-title-${product.product_id}`}>
          Category meta title ({catTitle.length} of {TITLE_MAX})
          <input id={`cat-title-${product.product_id}`} value={catTitle} onChange={(e) => setCatTitle(e.target.value)} />
        </label>
        <label htmlFor={`cat-desc-${product.product_id}`}>
          Category meta description ({catDesc.length} of {DESC_MAX})
          <textarea id={`cat-desc-${product.product_id}`} value={catDesc} onChange={(e) => setCatDesc(e.target.value)} rows={2} />
        </label>
        <label htmlFor={`cat-body-${product.product_id}`}>
          Category page text ({catBody.length} of {BODY_MAX})
          <textarea id={`cat-body-${product.product_id}`} value={catBody} onChange={(e) => setCatBody(e.target.value)} rows={3} />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save category page"}
        </button>
        {row?.category_slug && (
          <button
            type="button"
            className="inline"
            disabled={busy}
            onClick={() =>
              void setPublished("category", product.product_group_id, row.category_published !== true, "Category page")
            }
          >
            {row.category_published ? "Unpublish category page" : "Publish category page"}
          </button>
        )}
      </form>
      <form
        aria-label="Product page"
        onSubmit={(e) => {
          e.preventDefault();
          void savePage(imagePath);
        }}
      >
        <label htmlFor={`shop-slug-${product.product_id}`}>
          Page address ({slug.length} characters)
          <input id={`shop-slug-${product.product_id}`} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label htmlFor={`shop-title-${product.product_id}`}>
          Meta title ({title.length} of {TITLE_MAX})
          <input id={`shop-title-${product.product_id}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label htmlFor={`shop-desc-${product.product_id}`}>
          Meta description ({desc.length} of {DESC_MAX})
          <textarea id={`shop-desc-${product.product_id}`} value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
        </label>
        <label htmlFor={`shop-body-${product.product_id}`}>
          Page text ({body.length} of {BODY_MAX})
          <textarea id={`shop-body-${product.product_id}`} value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
        </label>
        <label htmlFor={`shop-how-${product.product_id}`}>
          How to use ({how.length} of {HOW_MAX})
          <textarea id={`shop-how-${product.product_id}`} value={how} onChange={(e) => setHow(e.target.value)} rows={3} />
        </label>
        <label htmlFor={`shop-picture-${product.product_id}`}>
          Picture
          <input
            id={`shop-picture-${product.product_id}`}
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              // A page that is not saved yet keeps the path in this form until Save.
              if (!row?.slug) {
                setBusy(true);
                setError(null);
                void uploadStorefrontImage(product.product_id, file)
                  .then((path) => setImagePath(path))
                  .catch((err: Error) => setError(err.message))
                  .finally(() => setBusy(false));
                return;
              }
              void run(async () => {
                const path = await uploadStorefrontImage(product.product_id, file);
                setImagePath(path);
                await rpc("office_upsert_storefront_product", {
                  p_client_id: pageClient,
                  p_product_id: product.product_id,
                  p_slug: slug,
                  p_meta_title: title,
                  p_meta_description: desc,
                  p_body: body,
                  p_how_to_use: how,
                  p_image_path: path,
                });
                setPageClient(crypto.randomUUID());
                return "Picture saved.";
              });
            }}
          />
        </label>
        {preview && <img className="thumb" src={preview} alt="" />}
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save online shop page"}
        </button>
        {row?.slug && (
          <button
            type="button"
            className="inline"
            disabled={busy}
            onClick={() => void setPublished("product", product.product_id, row.published !== true, "Product page")}
          >
            {row.published ? "Unpublish product page" : "Publish product page"}
          </button>
        )}
      </form>
      <h4>Shades on the shop</h4>
      <ul className="plain">
        {shades.map((shade) => {
          const paisa = paisaOf(shade.list_price_paisa);
          return (
            <li key={shade.id}>
              <strong>{shade.code}</strong> · {shade.variant} · {paisa === null ? "No price yet" : rupees(paisa)}{" "}
              <a href={`#price-${shade.id}`}>Set the default price</a>{" "}
              <button
                type="button"
                className="inline"
                disabled={busy}
                onClick={() => void setPublished("sku", shade.id, !shade.published, shade.code)}
              >
                {shade.published ? `Unpublish ${shade.code}` : `Publish ${shade.code}`}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
