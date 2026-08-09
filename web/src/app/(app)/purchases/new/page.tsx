"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, ClientApiError } from "@/lib/client";
import { Button, Input, Select, Field, Card, ErrorState } from "@/components/ui";

type Line = { productId: string; name: string; quantity: number; unitPrice: number; taxRate: number };
type Lookup = { id: string; name: string; price: string; tax_rate: string };

export default function NewPurchaseOrderPage() {
  const { t, formatMoney } = useI18n();
  const router = useRouter();
  const { data: suppliers } = useApi<{ data: Array<{ id: string; name: string }> }>("/suppliers?limit=100");
  const { data: warehouses } = useApi<{ data: Array<{ id: string; name: string; is_default: boolean }> }>("/warehouses");
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Lookup[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (warehouses?.data.length && !warehouseId) {
      setWarehouseId((warehouses.data.find((w) => w.is_default) ?? warehouses.data[0]).id);
    }
  }, [warehouses, warehouseId]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await apiFetch<{ data: Lookup[] }>(`/products/lookup?q=${encodeURIComponent(q.trim())}`);
        setResults(r.data);
      } catch { setResults([]); }
    }, 200);
  }, [q]);

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 + l.taxRate / 100), 0);
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit() {
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch<{ purchaseOrderId: string }>("/purchases/orders", {
        method: "POST",
        json: {
          supplierId, warehouseId: warehouseId || null, expectedDate: expectedDate || null,
          items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate })),
        },
      });
      router.push(`/purchases/${r.purchaseOrderId}`);
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-ink-3 hover:bg-surface hover:text-ink">
          <ArrowLeft size={17} />
        </button>
        <h1 className="text-lg font-semibold">{t("purchases.newOrder")}</h1>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("purchases.supplier")} required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t("common.select")}</option>
              {suppliers?.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.warehouse")}>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses?.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label={t("purchases.expectedDate")}>
            <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={t("sales.addItem")}>
        <div className="relative">
          <Input placeholder={t("products.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-pop">
              {results.map((r) => (
                <button key={r.id} onClick={() => {
                    setLines((ls) => [...ls, { productId: r.id, name: r.name, quantity: 1, unitPrice: 0, taxRate: Number(r.tax_rate ?? 0) }]);
                    setQ(""); setResults([]);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-canvas">
                  <span className="font-medium">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {lines.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[12px] uppercase text-ink-3">
                <th className="py-2 text-start font-medium">{t("common.description")}</th>
                <th className="py-2 text-end font-medium">{t("common.quantity")}</th>
                <th className="py-2 text-end font-medium">{t("purchases.unitCost")}</th>
                <th className="py-2 text-end font-medium">{t("common.tax")} %</th>
                <th className="py-2 text-end font-medium">{t("common.total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-2 pe-2 font-medium">{l.name}</td>
                  <td className="py-2"><Input type="number" min="0.001" step="any" value={l.quantity}
                    onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })} className="ms-auto !w-20 text-end" /></td>
                  <td className="py-2"><Input type="number" min="0" step="0.01" value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) || 0 })} className="ms-auto !w-28 text-end" /></td>
                  <td className="py-2"><Input type="number" min="0" max="100" value={l.taxRate}
                    onChange={(e) => setLine(i, { taxRate: Number(e.target.value) || 0 })} className="ms-auto !w-16 text-end" /></td>
                  <td className="num py-2 text-end font-medium">{formatMoney(l.quantity * l.unitPrice * (1 + l.taxRate / 100))}</td>
                  <td className="py-2 ps-2">
                    <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                      className="rounded p-1 text-ink-3 hover:text-danger"><X size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 flex items-center justify-end gap-4 border-t border-line pt-4">
          <span className="text-lg font-semibold">{t("common.total")}: <span className="num">{formatMoney(total)}</span></span>
          <Button loading={loading} disabled={!supplierId || !lines.length} onClick={submit}>
            <Plus size={15} /> {t("common.create")}
          </Button>
        </div>
        {err && <ErrorState message={err} />}
      </Card>
    </div>
  );
}
