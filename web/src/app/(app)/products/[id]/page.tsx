"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Input, Field, Card, Badge, Spinner, ErrorState, Modal } from "@/components/ui";

type ProductDetail = {
  id: string; sku: string; name: string; description: string | null;
  selling_price: string; purchase_price?: string; wholesale_price: string | null;
  tax_rate: string; minimum_stock: string; status: string;
  category_name: string | null; brand_name: string | null; unit_name: string | null;
  barcodes: Array<{ id: string; barcode: string; is_primary: boolean }>;
  stock: Array<{ warehouse_id: string; warehouse_name: string; quantity: string; avg_cost: string | null }>;
};

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatMoney } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const { data: p, error, isLoading, mutate } = useApi<ProductDetail>(`/products/${id}`);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (error || !p) return <ErrorState message={t("common.errorGeneric")} />;

  const startEdit = () => {
    setForm({
      name: p.name, sellingPrice: p.selling_price, purchasePrice: p.purchase_price ?? "",
      taxRate: p.tax_rate, minimumStock: p.minimum_stock,
      barcodes: p.barcodes.map((b) => b.barcode).join(", "),
    });
    setEditing(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiFetch(`/products/${id}`, {
        method: "PATCH",
        json: {
          name: form.name, sellingPrice: Number(form.sellingPrice),
          ...(form.purchasePrice !== "" ? { purchasePrice: Number(form.purchasePrice) } : {}),
          taxRate: Number(form.taxRate), minimumStock: Number(form.minimumStock),
          barcodes: form.barcodes.split(",").map((b) => b.trim()).filter(Boolean),
        },
      });
      setEditing(false); mutate();
    } catch (e2) {
      setErr(e2 instanceof ClientApiError ? e2.message : t("common.errorGeneric"));
    } finally { setSaving(false); }
  }

  async function doDelete() {
    try {
      await apiFetch(`/products/${id}`, { method: "DELETE" });
      router.push("/products");
    } catch (e2) {
      setErr(e2 instanceof ClientApiError ? e2.message : t("common.errorGeneric"));
      setConfirmDelete(false);
    }
  }

  const totalStock = p.stock.reduce((s, w) => s + Number(w.quantity), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push("/products")} className="rounded-lg p-2 text-ink-3 hover:bg-surface hover:text-ink">
          <ArrowLeft size={17} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{p.name}</h1>
          <p className="text-xs text-ink-3">{p.sku}{p.category_name ? ` · ${p.category_name}` : ""}</p>
        </div>
        <Badge tone={totalStock <= 0 ? "danger" : Number(p.minimum_stock) > 0 && totalStock <= Number(p.minimum_stock) ? "warn" : "ok"}>
          {t("products.stock")}: <span className="num ms-1">{totalStock}</span>
        </Badge>
        {can("products.edit") && !editing && <Button variant="secondary" onClick={startEdit}>{t("common.edit")}</Button>}
        {can("products.delete") && (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={15} className="text-danger" /></Button>
        )}
      </div>

      {err && <ErrorState message={err} />}

      {editing ? (
        <Card title={t("common.edit")}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Field label={t("common.name")} required>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label={t("products.barcodes")}>
              <Input value={form.barcodes} onChange={(e) => setForm((f) => ({ ...f, barcodes: e.target.value }))} />
            </Field>
            <Field label={t("products.sellingPrice")}>
              <Input type="number" step="0.01" min="0" value={form.sellingPrice}
                onChange={(e) => setForm((f) => ({ ...f, sellingPrice: e.target.value }))} />
            </Field>
            {p.purchase_price !== undefined && (
              <Field label={t("products.purchasePrice")}>
                <Input type="number" step="0.01" min="0" value={form.purchasePrice}
                  onChange={(e) => setForm((f) => ({ ...f, purchasePrice: e.target.value }))} />
              </Field>
            )}
            <Field label={t("products.taxRate")}>
              <Input type="number" step="0.01" min="0" max="100" value={form.taxRate}
                onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} />
            </Field>
            <Field label={t("products.minStock")}>
              <Input type="number" min="0" value={form.minimumStock}
                onChange={(e) => setForm((f) => ({ ...f, minimumStock: e.target.value }))} />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" loading={saving}>{t("common.save")}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
            </div>
          </form>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title={t("common.price")}>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-2">{t("products.sellingPrice")}</dt>
                <dd className="num font-medium">{formatMoney(p.selling_price)}</dd></div>
              {p.purchase_price !== undefined && (
                <div className="flex justify-between"><dt className="text-ink-2">{t("products.purchasePrice")}</dt>
                  <dd className="num font-medium">{formatMoney(p.purchase_price)}</dd></div>
              )}
              <div className="flex justify-between"><dt className="text-ink-2">{t("products.taxRate")}</dt>
                <dd className="num">{Number(p.tax_rate)}%</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">{t("products.minStock")}</dt>
                <dd className="num">{Number(p.minimum_stock)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">{t("products.barcodes")}</dt>
                <dd>{p.barcodes.map((b) => b.barcode).join(", ") || "—"}</dd></div>
            </dl>
          </Card>
          <Card title={t("common.warehouse")} pad={false}>
            <table className="w-full text-sm">
              <tbody>
                {p.stock.map((w) => (
                  <tr key={w.warehouse_id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5">{w.warehouse_name}</td>
                    <td className="num px-4 py-2.5 text-end font-medium">{Number(w.quantity)}</td>
                    {w.avg_cost != null && (
                      <td className="num px-4 py-2.5 text-end text-ink-3">{formatMoney(w.avg_cost)}</td>
                    )}
                  </tr>
                ))}
                {p.stock.length === 0 && (
                  <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t("common.confirmDelete")}>
        <p className="mb-4 text-sm text-ink-2">{p.name}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>{t("common.cancel")}</Button>
          <Button variant="danger" onClick={doDelete}>{t("common.delete")}</Button>
        </div>
      </Modal>
    </div>
  );
}
