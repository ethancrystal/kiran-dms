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

type Done = (m: string) => Promise<void>;

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

const categoryStateOf = (row: ShopRow | undefined) => {
  if (row?.category_published === true) return "Category page is published.";
  return row?.category_slug ? "Category page is not published." : "Category page is not saved.";
};

/**
 * The idempotency key of the write being sent (H-08). Sending the same content again reuses the key, so
 * a save whose answer was lost is replayed by the database, not written twice. Different content gets
 * a new key, so the database never meets an old key with new content. A write the database accepted
 * gives its key up.
 */
function useWriteKey() {
  const pending = useRef<{ signature: string; key: string } | null>(null);
  return {
    keyFor(content: unknown) {
      const signature = JSON.stringify(content);
      if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
      return pending.current.key;
    },
    accepted() {
      pending.current = null;
    },
  };
}

/** Runs one write: busy while it runs, the database's refusal shown in place, the page reloaded after. */
function useShopWrite(onDone: Done) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await action();
      if (message !== null) await onDone(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Sets a category, product or shade on or off the shop; returns what the database now holds. */
async function sendPublished(clientId: string, kind: "category" | "product" | "sku", subjectId: string, published: boolean) {
  const data = await rpc<{ published: boolean }[] | { published: boolean }>("office_set_storefront_published", {
    p_client_id: clientId,
    p_kind: kind,
    p_subject_id: subjectId,
    p_published: published,
  });
  return firstPublished(data);
}

/**
 * One category page (a product group's public page). Shown once per category, above the products,
 * so two product cards of the same category cannot overwrite each other's text.
 */
export function ShopCategory({
  groupId,
  groupName,
  row,
  onDone,
}: {
  groupId: string;
  groupName: string;
  row: ShopRow | undefined;
  onDone: Done;
}) {
  const [slug, setSlug] = useState(row?.category_slug ?? "");
  const [title, setTitle] = useState(row?.category_meta_title ?? "");
  const [desc, setDesc] = useState(row?.category_meta_description ?? "");
  const [body, setBody] = useState(row?.category_body ?? "");
  const { busy, error, run } = useShopWrite(onDone);
  const saveKey = useWriteKey();
  const publishKey = useWriteKey();

  useEffect(() => {
    setSlug(row?.category_slug ?? "");
    setTitle(row?.category_meta_title ?? "");
    setDesc(row?.category_meta_description ?? "");
    setBody(row?.category_body ?? "");
  }, [row]);

  const save = () =>
    run(async () => {
      const content = { p_product_group_id: groupId, p_slug: slug, p_meta_title: title, p_meta_description: desc, p_body: body };
      await rpc("office_upsert_storefront_category", { p_client_id: saveKey.keyFor(content), ...content });
      saveKey.accepted();
      return `Category page of ${groupName} saved.`;
    });

  const setPublished = (published: boolean) =>
    run(async () => {
      const on = await sendPublished(publishKey.keyFor({ groupId, published }), "category", groupId, published);
      publishKey.accepted();
      return on ? `Category page of ${groupName} is published.` : `Category page of ${groupName} is not published.`;
    });

  return (
    <form
      aria-label={`Category page of ${groupName}`}
      data-testid={`shop-category-${groupId}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3>{groupName}</h3>
      <p className="muted">{categoryStateOf(row)}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <label htmlFor={`cat-slug-${groupId}`}>
        Category address ({slug.length} characters)
        <input id={`cat-slug-${groupId}`} value={slug} onChange={(e) => setSlug(e.target.value)} />
      </label>
      <label htmlFor={`cat-title-${groupId}`}>
        Category meta title ({title.length} of {TITLE_MAX})
        <input id={`cat-title-${groupId}`} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label htmlFor={`cat-desc-${groupId}`}>
        Category meta description ({desc.length} of {DESC_MAX})
        <textarea id={`cat-desc-${groupId}`} value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
      </label>
      <label htmlFor={`cat-body-${groupId}`}>
        Category page text ({body.length} of {BODY_MAX})
        <textarea id={`cat-body-${groupId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save category page"}
      </button>
      {row?.category_slug && (
        <button
          type="button"
          className="inline"
          disabled={busy}
          onClick={() => void setPublished(row.category_published !== true)}
        >
          {row.category_published ? "Unpublish category page" : "Publish category page"}
        </button>
      )}
    </form>
  );
}

/** The product's public page and which of its shades are on the shop. */
export function OnlineShop({
  product,
  row,
  loadError,
  onDone,
}: {
  product: ProductRef;
  row: ShopRow | undefined;
  loadError: string | null;
  onDone: Done;
}) {
  const [slug, setSlug] = useState(row?.slug ?? "");
  const [title, setTitle] = useState(row?.meta_title ?? "");
  const [desc, setDesc] = useState(row?.meta_description ?? "");
  const [body, setBody] = useState(row?.body ?? "");
  const [how, setHow] = useState(row?.how_to_use ?? "");
  const [imagePath, setImagePath] = useState(row?.image_path ?? "");
  const { busy, error, run } = useShopWrite(onDone);
  const saveKey = useWriteKey();
  const publishKey = useWriteKey();
  const pictureInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSlug(row?.slug ?? "");
    setTitle(row?.meta_title ?? "");
    setDesc(row?.meta_description ?? "");
    setBody(row?.body ?? "");
    setHow(row?.how_to_use ?? "");
    setImagePath(row?.image_path ?? "");
  }, [row]);

  const sendPage = async (path: string) => {
    const content = {
      p_product_id: product.product_id,
      p_slug: slug,
      p_meta_title: title,
      p_meta_description: desc,
      p_body: body,
      p_how_to_use: how,
      p_image_path: path,
    };
    await rpc("office_upsert_storefront_product", { p_client_id: saveKey.keyFor(content), ...content });
    saveKey.accepted();
  };

  const savePage = () =>
    run(async () => {
      await sendPage(imagePath);
      return "Online shop page saved.";
    });

  const addPicture = (file: File) =>
    run(async () => {
      const path = await uploadStorefrontImage(product.product_id, file);
      setImagePath(path);
      // A page that is not saved yet keeps the path in this form until Save.
      if (!row?.slug) return null;
      await sendPage(path);
      return "Picture saved.";
    });

  const setPublished = (kind: "product" | "sku", subjectId: string, published: boolean, label: string) =>
    run(async () => {
      const on = await sendPublished(publishKey.keyFor({ kind, subjectId, published }), kind, subjectId, published);
      publishKey.accepted();
      return on ? `${label} is published.` : `${label} is not published.`;
    });

  // The shop details did not load (for example, the database does not have them yet). Nothing is shown
  // to edit, because a form of blanks could be saved over a page that exists. The rest of the Products
  // page does not depend on this panel.
  if (loadError) {
    return (
      <section className="card" aria-label="Online shop" data-testid={`online-shop-${product.product_id}`}>
        <h3>Online shop</h3>
        <p className="error" role="alert">
          The online shop details could not be loaded: {loadError}
        </p>
      </section>
    );
  }

  const shades = shadesOf(row?.skus ?? null, product.skus);
  const preview = storefrontImageUrl(imagePath);

  return (
    <section className="card" aria-label="Online shop" data-testid={`online-shop-${product.product_id}`}>
      <h3>Online shop</h3>
      <p className="muted">
        {categoryStateOf(row)} A product page is public only while its category page is published. The category page is under
        Online shop categories, above the products.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        aria-label="Product page"
        onSubmit={(e) => {
          e.preventDefault();
          void savePage();
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
          Shop picture
          <input
            id={`shop-picture-${product.product_id}`}
            type="file"
            accept={IMAGE_ACCEPT}
            disabled={busy}
            ref={pictureInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so that choosing the same file again is still a change.
              if (pictureInput.current) pictureInput.current.value = "";
              if (file) void addPicture(file);
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
