"use client";
import { useCallback, useEffect, useState } from "react";
import { ListState } from "@/components/confirm-action";
import { rupees, toPaisa } from "@/lib/money";
import { IMAGE_ACCEPT, signedImageUrls, uploadProductImage } from "@/lib/product-images";
import { db, rows, rpc } from "@/lib/rpc";

type Sku = {
  id: string;
  code: string;
  variant: string;
  unit: string;
  size_value: number | null;
  units_per_carton: number | null;
  barcode: string | null;
  list_price_paisa: number | null;
  active: boolean;
};
type Product = {
  product_id: string;
  product_group_id: string;
  group_name: string;
  brand_label: string;
  name: string;
  description: string | null;
  image_path: string | null;
  active: boolean;
  skus: Sku[];
};
type Group = { id: string; name: string; active: boolean };

const UNITS = ["ml", "l", "g", "kg", "pack", "piece"];
const GROUP_LIMIT = 500;
const DESCRIPTION_MAX = 1000; // product.description
const NAME_MAX = 120;
const BRAND_MAX = 60;
const VARIANT_MAX = 80;
const CODE_MAX = 40;
const REASON_MAX = 300;
// app.office_set_sku_price takes a reason of 3 to 300 characters.
const REASON_MIN = 3;
const PRICE_MAX_CHARS = 12; // rupees as typed (lib/money.ts toPaisa)

// Products (D-39; spec section 5): the owner or a manager adds and edits products and SKUs, writes a
// description, uploads or replaces a picture, sets list prices with a reason, and activates or
// deactivates. Every rule is the database's (app.office_upsert_product, app.office_upsert_sku,
// app.office_set_sku_price, the product-images storage policies); this page shows their answer.
export default function Products() {
  const [products, setProducts] = useState<Product[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, g] = await Promise.all([
        rpc<Product[]>("office_catalogue"),
        rows<Group>(db().from("product_group").select("id, name, active").order("name").limit(GROUP_LIMIT)),
      ]);
      setProducts(p ?? []);
      setGroups(g);
      setUrls(await signedImageUrls((p ?? []).map((x) => x.image_path)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const done = async (m: string) => {
    setNotice(m);
    await load();
  };

  return (
    <>
      <h1>Products</h1>
      <p className="muted">
        Products and SKUs that orders are made from. List prices are set here with a reason; per-salon prices are on each
        salon&apos;s page.
      </p>
      {notice && <output className="ok">{notice}</output>}
      <AddProduct groups={groups.filter((g) => g.active)} onDone={done} />
      <ListState loading={loading} error={error} empty={products.length === 0} emptyText="No products yet." />
      {!loading &&
        products.map((p) => (
          <ProductCard
            key={p.product_id}
            product={p}
            groups={groups}
            imageUrl={p.image_path ? urls[p.image_path] : undefined}
            onDone={done}
          />
        ))}
    </>
  );
}

function AddProduct({ groups, onDone }: { groups: Group[]; onDone: (m: string) => Promise<void> }) {
  const empty = { group: "", brand: "", name: "", description: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per attempt: the upsert is keyed by it, so a retry after a lost answer is the same product.
  const [productId, setProductId] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form
      className="card"
      aria-label="Add a product"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          if (!form.group) throw new Error("Choose the product group.");
          await rpc("office_upsert_product", {
            p_id: productId,
            p_product_group_id: form.group,
            p_brand_label: form.brand.trim(),
            p_name: form.name.trim(),
            p_active: true,
            p_description: form.description.trim() === "" ? null : form.description,
            p_image_path: null,
          });
          const name = form.name.trim();
          setForm(empty);
          setProductId(crypto.randomUUID());
          await onDone(`Product ${name} added. Add its SKUs and prices below.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Add a product</h2>
      <label htmlFor="new-group">Product group</label>
      <select id="new-group" value={form.group} onChange={set("group")}>
        <option value="">Choose a group</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {groups.length === 0 && <p className="muted">No active product group yet.</p>}
      <label htmlFor="new-brand">Brand label</label>
      <input id="new-brand" value={form.brand} onChange={set("brand")} maxLength={BRAND_MAX} required />
      <label htmlFor="new-name">Product name</label>
      <input id="new-name" value={form.name} onChange={set("name")} maxLength={NAME_MAX} required />
      <label htmlFor="new-description">Description (optional)</label>
      <textarea
        id="new-description"
        value={form.description}
        onChange={set("description")}
        maxLength={DESCRIPTION_MAX}
        rows={3}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Add product"}
      </button>
    </form>
  );
}

function ProductCard({
  product,
  groups,
  imageUrl,
  onDone,
}: {
  product: Product;
  groups: Group[];
  imageUrl: string | undefined;
  onDone: (m: string) => Promise<void>;
}) {
  return (
    <section className="card" aria-label={`Product ${product.name}`}>
      <div className="row">
        {imageUrl ? (
          <img className="thumb" src={imageUrl} alt={product.name} />
        ) : (
          <span className="thumb">{product.image_path ? "Picture unavailable" : "No picture"}</span>
        )}
        <h2>
          {product.name}{" "}
          <span className="muted">
            · {product.brand_label} · {product.group_name}
          </span>{" "}
          <span className={`badge ${product.active ? "active" : "suspended"}`}>{product.active ? "Active" : "Inactive"}</span>
        </h2>
      </div>
      {product.description && <p>{product.description}</p>}
      <EditProduct product={product} groups={groups} onDone={onDone} />
      <Picture product={product} onDone={onDone} />
      <h3>SKUs</h3>
      {product.skus.length === 0 && <p className="muted">No SKUs yet.</p>}
      <ul className="plain">
        {product.skus.map((s) => (
          <SkuRow key={s.id} product={product} sku={s} onDone={onDone} />
        ))}
      </ul>
      <AddSku product={product} onDone={onDone} />
    </section>
  );
}

const upsertProduct = (
  p: Product,
  change: Partial<{ group: string; brand: string; name: string; active: boolean; description: string; image: string }>,
) =>
  rpc("office_upsert_product", {
    p_id: p.product_id,
    p_product_group_id: change.group ?? p.product_group_id,
    p_brand_label: change.brand ?? p.brand_label,
    p_name: change.name ?? p.name,
    p_active: change.active ?? p.active,
    // null keeps what is recorded; an empty string clears it (migration 20261105110000).
    p_description: change.description ?? null,
    p_image_path: change.image ?? null,
  });

function EditProduct({ product, groups, onDone }: { product: Product; groups: Group[]; onDone: (m: string) => Promise<void> }) {
  const init = () => ({
    group: product.product_group_id,
    brand: product.brand_label,
    name: product.name,
    description: product.description ?? "",
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ReturnType<typeof init>) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setOpen(false);
      await onDone(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const id = product.product_id;

  return (
    <div>
      <div className="row">
        <button type="button" className="inline" onClick={() => setOpen((o) => !o)} disabled={busy}>
          {open ? "Close edit" : "Edit product"}
        </button>
        <button
          type="button"
          className="inline"
          disabled={busy}
          onClick={() =>
            run(
              () => upsertProduct(product, { active: !product.active }),
              `${product.name} ${product.active ? "deactivated: it leaves new orders" : "activated"}.`,
            )
          }
        >
          {product.active ? "Deactivate product" : "Activate product"}
        </button>
      </div>
      {open && (
        <form
          aria-label={`Edit ${product.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () =>
                upsertProduct(product, {
                  group: form.group,
                  brand: form.brand.trim(),
                  name: form.name.trim(),
                  description: form.description.trim() === "" ? "" : form.description,
                }),
              `${form.name.trim()} saved.`,
            );
          }}
        >
          <label htmlFor={`group-${id}`}>Product group</label>
          <select id={`group-${id}`} value={form.group} onChange={set("group")}>
            {groups
              .filter((g) => g.active || g.id === product.product_group_id)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
          </select>
          <label htmlFor={`brand-${id}`}>Brand label</label>
          <input id={`brand-${id}`} value={form.brand} onChange={set("brand")} maxLength={BRAND_MAX} required />
          <label htmlFor={`name-${id}`}>Product name</label>
          <input id={`name-${id}`} value={form.name} onChange={set("name")} maxLength={NAME_MAX} required />
          <label htmlFor={`description-${id}`}>Description (empty removes it)</label>
          <textarea
            id={`description-${id}`}
            value={form.description}
            onChange={set("description")}
            maxLength={DESCRIPTION_MAX}
            rows={3}
          />
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save product"}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Picture({ product, onDone }: { product: Product; onDone: (m: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = product.product_id;
  return (
    <form
      className="inline-form"
      aria-label={`Picture of ${product.name}`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return setError("Choose a picture first.");
        setBusy(true);
        setError(null);
        try {
          // The old picture stays in storage as history; the product points at the new one.
          const path = await uploadProductImage(id, file);
          await upsertProduct(product, { image: path });
          setFile(null);
          await onDone(`Picture of ${product.name} saved.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`picture-${id}`}>
        {product.image_path ? "Replace the picture" : "Add a picture"} (PNG, JPEG or WebP, up to 5 MB)
        <input id={`picture-${id}`} type="file" accept={IMAGE_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <button type="submit" className="inline" disabled={busy || !file}>
        {busy ? "Uploading…" : "Upload picture"}
      </button>
      {product.image_path && (
        <button
          type="button"
          className="inline link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await upsertProduct(product, { image: "" });
              await onDone(`Picture removed from ${product.name}.`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove picture
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const upsertSku = (productId: string, s: Sku, active: boolean) =>
  rpc("office_upsert_sku", {
    p_id: s.id,
    p_product_id: productId,
    p_code: s.code,
    p_variant: s.variant,
    p_unit: s.unit,
    p_size_value: s.size_value,
    p_units_per_carton: s.units_per_carton,
    p_barcode: s.barcode,
    p_active: active,
  });

function SkuRow({ product, sku, onDone }: { product: Product; sku: Sku; onDone: (m: string) => Promise<void> }) {
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: a retry after a lost answer is the same price change (H-08).
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const sid = sku.id;
  return (
    <li aria-label={`SKU ${sku.code}`}>
      <strong>{sku.code}</strong> · {sku.variant} · {sku.size_value ?? ""} {sku.unit} ·{" "}
      <span data-testid={`price-${sku.code}`}>
        {sku.list_price_paisa === null ? "No price yet" : rupees(sku.list_price_paisa)}
      </span>{" "}
      <span className={`badge ${sku.active ? "active" : "suspended"}`}>{sku.active ? "Active" : "Inactive"}</span>
      <form
        className="inline-form"
        aria-label={`Price of ${sku.code}`}
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const paisa = toPaisa(price);
          if (paisa === null || paisa < 1) return setError("Enter the price in rupees, for example 1500 or 1500.50.");
          setBusy(true);
          try {
            await rpc("office_set_sku_price", {
              p_client_id: clientId,
              p_sku_id: sid,
              p_price_paisa: paisa,
              p_reason: reason.trim(),
            });
            setClientId(crypto.randomUUID());
            setPrice("");
            setReason("");
            await onDone(`${sku.code} now lists at ${rupees(paisa)}.`);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={`price-${sid}`}>
          List price (Rs) for {sku.code}
          <input
            id={`price-${sid}`}
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            maxLength={PRICE_MAX_CHARS}
          />
        </label>
        <label htmlFor={`reason-${sid}`}>
          Reason for the price of {sku.code}
          <input
            id={`reason-${sid}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            minLength={REASON_MIN}
            maxLength={REASON_MAX}
            required
          />
        </label>
        <button type="submit" className="inline" disabled={busy}>
          {busy ? "Saving…" : `Set price of ${sku.code}`}
        </button>
        <button
          type="button"
          className="inline link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await upsertSku(product.product_id, sku, !sku.active);
              await onDone(`${sku.code} ${sku.active ? "deactivated" : "activated"}.`);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {sku.active ? `Deactivate ${sku.code}` : `Activate ${sku.code}`}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </li>
  );
}

function AddSku({ product, onDone }: { product: Product; onDone: (m: string) => Promise<void> }) {
  const empty = { code: "", variant: "", unit: "ml", size: "" };
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per attempt: the upsert is keyed by it.
  const [skuId, setSkuId] = useState(() => crypto.randomUUID());
  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pid = product.product_id;
  return (
    <form
      className="inline-form"
      aria-label={`Add a SKU to ${product.name}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const size = form.size.trim() === "" ? null : Number(form.size);
          if (size !== null && !(size > 0)) throw new Error("The size must be a number above 0, or empty.");
          await rpc("office_upsert_sku", {
            p_id: skuId,
            p_product_id: pid,
            p_code: form.code.trim().toUpperCase(),
            p_variant: form.variant.trim(),
            p_unit: form.unit,
            p_size_value: size,
            p_units_per_carton: null,
            p_barcode: null,
            p_active: true,
          });
          const code = form.code.trim().toUpperCase();
          setForm(empty);
          setSkuId(crypto.randomUUID());
          await onDone(`SKU ${code} added to ${product.name}. Set its price to sell it.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor={`code-${pid}`}>
        SKU code
        <input id={`code-${pid}`} value={form.code} onChange={set("code")} maxLength={CODE_MAX} required />
      </label>
      <label htmlFor={`variant-${pid}`}>
        Variant
        <input id={`variant-${pid}`} value={form.variant} onChange={set("variant")} maxLength={VARIANT_MAX} required />
      </label>
      <label htmlFor={`unit-${pid}`}>
        Unit
        <select id={`unit-${pid}`} value={form.unit} onChange={set("unit")}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={`size-${pid}`}>
        Size (optional)
        <input id={`size-${pid}`} inputMode="decimal" value={form.size} onChange={set("size")} />
      </label>
      <button type="submit" className="inline" disabled={busy}>
        {busy ? "Saving…" : "Add SKU"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
