"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Input, Select, Field, Card, Badge, Modal, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";

type ProductRow = {
  id: string; sku: string; name: string; selling_price: string; purchase_price?: string;
  stock: string; minimum_stock: string; status: string; category_name: string | null;
  barcode: string | null; unit: string | null;
};
type ListResp = { data: ProductRow[]; page: number; limit: number; total: number };
type Category = { id: string; name: string };

function ProductsInner() {
  const { t, formatMoney } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useMe();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [page, setPage] = useState(1);
  const [categoryId, setCategoryId] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [showNew, setShowNew] = useState(params.get("new") === "1");

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const query = new URLSearchParams({ page: String(page), limit: "25" });
  if (debouncedQ) query.set("q", debouncedQ);
  if (categoryId) query.set("categoryId", categoryId);
  if (lowStock) query.set("lowStock", "true");

  const { data, isLoading, mutate } = useApi<ListResp>(`/products?${query}`);
  const { data: cats } = useApi<{ data: Category[] }>("/categories");

  const columns: Column<ProductRow>[] = [
    { key: "name", header: t("common.name"), render: (r) => (
      <div>
        <p className="font-medium">{r.name}</p>
        <p className="text-xs text-ink-3">{r.sku}{r.barcode ? ` · ${r.barcode}` : ""}</p>
      </div>
    )},
    { key: "category_name", header: t("common.category"), render: (r) => r.category_name ?? "—" },
    { key: "selling_price", header: t("products.sellingPrice"), align: "end",
      render: (r) => <span className="num">{formatMoney(r.selling_price)}</span> },
    { key: "stock", header: t("products.stock"), align: "end", render: (r) => {
      const stock = Number(r.stock), min = Number(r.minimum_stock);
      const tone = stock <= 0 ? "danger" : min > 0 && stock <= min ? "warn" : "ok";
      return <Badge tone={tone}><span className="num">{stock}</span></Badge>;
    }},
    { key: "status", header: t("common.status"), render: (r) => (
      <Badge tone={r.status === "active" ? "ok" : "neutral"}>
        {r.status === "active" ? t("products.active") : t("products.archived")}
      </Badge>
    )},
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("products.title")}</h1>
        {can("products.create") && (
          <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t("products.add")}</Button>
        )}
      </div>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input placeholder={t("products.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className="max-w-[180px]">
            <option value="">{t("common.all")} — {t("products.categories")}</option>
            {cats?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <input type="checkbox" checked={lowStock} onChange={(e) => { setLowStock(e.target.checked); setPage(1); }} />
            {t("products.lowStockFilter")}
          </label>
        </div>
        {isLoading && !data ? (
          <TableSkeleton />
        ) : !data?.data.length ? (
          <EmptyState title={t("products.empty")} hint={t("products.emptyHint")}
            action={can("products.create") && <Button onClick={() => setShowNew(true)}><Plus size={15} /> {t("products.add")}</Button>} />
        ) : (
          <>
            <DataTable columns={columns} rows={data.data} onRowClick={(r) => router.push(`/products/${r.id}`)} />
            <Pagination page={page} setPage={setPage} total={data.total} limit={data.limit} />
          </>
        )}
      </Card>

      <NewProductModal open={showNew} onClose={() => setShowNew(false)}
        categories={cats?.data ?? []} onCreated={() => { setShowNew(false); mutate(); }} />
    </div>
  );
}

function NewProductModal({ open, onClose, categories, onCreated }: {
  open: boolean; onClose: () => void; categories: Category[]; onCreated: () => void;
}) {
  const { t } = useI18n();
  const { data: warehouses } = useApi<{ data: Array<{ id: string; name: string; is_default: boolean }> }>(open ? "/warehouses" : null);
  const [form, setForm] = useState({
    name: "", sku: "", barcode: "", categoryId: "", sellingPrice: "", purchasePrice: "",
    taxRate: "19", minimumStock: "0", initialQty: "", initialCost: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      let categoryId = form.categoryId || undefined;
      if (newCategory.trim()) {
        const c = await apiFetch<{ id: string }>("/categories", { method: "POST", json: { name: newCategory.trim() } });
        categoryId = c.id;
      }
      const wh = warehouses?.data.find((w) => w.is_default) ?? warehouses?.data[0];
      await apiFetch("/products", {
        method: "POST",
        json: {
          name: form.name, sku: form.sku || undefined, categoryId,
          sellingPrice: Number(form.sellingPrice || 0), purchasePrice: Number(form.purchasePrice || 0),
          taxRate: Number(form.taxRate || 0), minimumStock: Number(form.minimumStock || 0),
          barcodes: form.barcode ? [form.barcode] : [],
          initialStock: form.initialQty && wh
            ? { warehouseId: wh.id, quantity: Number(form.initialQty), unitCost: Number(form.initialCost || 0) }
            : undefined,
        },
      });
      setForm({ name: "", sku: "", barcode: "", categoryId: "", sellingPrice: "", purchasePrice: "", taxRate: "19", minimumStock: "0", initialQty: "", initialCost: "" });
      setNewCategory("");
      onCreated();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("products.add")} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.name")} required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} autoFocus required />
          </Field>
          <Field label={t("products.sku")} hint={t("common.optional")}>
            <Input value={form.sku} onChange={(e) => set("sku", e.target.value)} />
          </Field>
          <Field label={t("products.barcode")}>
            <Input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} />
          </Field>
          <Field label={t("common.category")}>
            <div className="flex gap-2">
              <Select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">{t("common.select")}</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Input placeholder={t("products.newCategory")} value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)} />
            </div>
          </Field>
          <Field label={t("products.sellingPrice")} required>
            <Input type="number" step="0.01" min="0" value={form.sellingPrice}
              onChange={(e) => set("sellingPrice", e.target.value)} required />
          </Field>
          <Field label={t("products.purchasePrice")}>
            <Input type="number" step="0.01" min="0" value={form.purchasePrice}
              onChange={(e) => set("purchasePrice", e.target.value)} />
          </Field>
          <Field label={t("products.taxRate")}>
            <Input type="number" step="0.01" min="0" max="100" value={form.taxRate}
              onChange={(e) => set("taxRate", e.target.value)} />
          </Field>
          <Field label={t("products.minStock")}>
            <Input type="number" step="1" min="0" value={form.minimumStock}
              onChange={(e) => set("minimumStock", e.target.value)} />
          </Field>
          <Field label={t("products.initialQty")} hint={t("common.optional")}>
            <Input type="number" step="0.001" min="0" value={form.initialQty}
              onChange={(e) => set("initialQty", e.target.value)} />
          </Field>
          <Field label={t("products.unitCost")}>
            <Input type="number" step="0.01" min="0" value={form.initialCost}
              onChange={(e) => set("initialCost", e.target.value)} disabled={!form.initialQty} />
          </Field>
        </div>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" loading={loading}>{t("common.create")}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProductsPage() {
  return <Suspense><ProductsInner /></Suspense>;
}
