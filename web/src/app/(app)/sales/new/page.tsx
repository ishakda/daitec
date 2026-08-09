"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, ClientApiError } from "@/lib/client";
import { Button, Input, Select, Field, Card, ErrorState } from "@/components/ui";

type Line = { productId: string; name: string; quantity: number; unitPrice: number; discountPct: number; taxRate: number };
type Lookup = { id: string; name: string; price: string; tax_rate: string; stock: string };
type Method = { id: string; name: string; kind: string };

export default function NewSalePage() {
  const { t, formatMoney } = useI18n();
  const router = useRouter();
  const { data: warehouses } = useApi<{ data: Array<{ id: string; name: string; is_default: boolean }> }>("/warehouses");
  const { data: methods } = useApi<{ data: Method[] }>("/payment-methods");
  const [saleType, setSaleType] = useState<"invoice" | "proforma">("invoice");
  const [customerId, setCustomerId] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const { data: customers } = useApi<{ data: Array<{ id: string; name: string }> }>(`/customers?q=${encodeURIComponent(customerQ)}&limit=10`);
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Lookup[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [globalDiscount, setGlobalDiscount] = useState("");
  const [payMethod, setPayMethod] = useState("");
  const [payAmount, setPayAmount] = useState("");
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
    if (!q.trim() || !warehouseId) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await apiFetch<{ data: Lookup[] }>(`/products/lookup?q=${encodeURIComponent(q.trim())}&warehouseId=${warehouseId}`);
        setResults(r.data);
      } catch { setResults([]); }
    }, 200);
  }, [q, warehouseId]);

  const totals = lines.reduce((acc, l) => {
    const base = l.quantity * l.unitPrice * (1 - l.discountPct / 100);
    return { subtotal: acc.subtotal + base, tax: acc.tax + base * l.taxRate / 100 };
  }, { subtotal: 0, tax: 0 });
  const total = totals.subtotal + totals.tax - Number(globalDiscount || 0);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function submit() {
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch<{ saleId: string }>("/sales", {
        method: "POST",
        json: {
          saleType, customerId: customerId || null, warehouseId,
          dueDate: dueDate || null, globalDiscount: Number(globalDiscount || 0),
          items: lines.map((l) => ({
            productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice,
            discountPct: l.discountPct, taxRate: l.taxRate,
          })),
          payments: payMethod && Number(payAmount) > 0
            ? [{ paymentMethodId: payMethod, amount: Number(payAmount) }] : [],
        },
      });
      router.push(`/sales/${r.saleId}`);
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
        <h1 className="text-lg font-semibold">{t("sales.newSale")}</h1>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t("common.status")}>
            <Select value={saleType} onChange={(e) => setSaleType(e.target.value as "invoice" | "proforma")}>
              <option value="invoice">{t("sales.invoice")}</option>
              <option value="proforma">{t("sales.proforma")}</option>
            </Select>
          </Field>
          <Field label={t("sales.customer")}>
            <Input list="customers-list" placeholder={t("common.search")} value={customerQ}
              onChange={(e) => {
                setCustomerQ(e.target.value);
                const m = customers?.data.find((c) => c.name === e.target.value);
                setCustomerId(m?.id ?? "");
              }} />
            <datalist id="customers-list">
              {customers?.data.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </Field>
          <Field label={t("common.warehouse")}>
            <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses?.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.dueDate")}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
                    setLines((ls) => [...ls, {
                      productId: r.id, name: r.name, quantity: 1,
                      unitPrice: Number(r.price), discountPct: 0, taxRate: Number(r.tax_rate ?? 0),
                    }]);
                    setQ(""); setResults([]);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-start text-sm hover:bg-canvas">
                  <span className="font-medium">{r.name}</span>
                  <span className="num text-ink-3">{formatMoney(r.price)} · {Number(r.stock)}</span>
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
                <th className="py-2 text-end font-medium">{t("common.price")}</th>
                <th className="py-2 text-end font-medium">{t("common.discount")} %</th>
                <th className="py-2 text-end font-medium">{t("common.tax")} %</th>
                <th className="py-2 text-end font-medium">{t("common.total")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const lineTotal = l.quantity * l.unitPrice * (1 - l.discountPct / 100) * (1 + l.taxRate / 100);
                return (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="py-2 pe-2 font-medium">{l.name}</td>
                    <td className="py-2"><Input type="number" min="0.001" step="any" value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })} className="ms-auto !w-20 text-end" /></td>
                    <td className="py-2"><Input type="number" min="0" step="0.01" value={l.unitPrice}
                      onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) || 0 })} className="ms-auto !w-28 text-end" /></td>
                    <td className="py-2"><Input type="number" min="0" max="100" value={l.discountPct}
                      onChange={(e) => setLine(i, { discountPct: Number(e.target.value) || 0 })} className="ms-auto !w-16 text-end" /></td>
                    <td className="py-2"><Input type="number" min="0" max="100" value={l.taxRate}
                      onChange={(e) => setLine(i, { taxRate: Number(e.target.value) || 0 })} className="ms-auto !w-16 text-end" /></td>
                    <td className="num py-2 text-end font-medium">{formatMoney(lineTotal)}</td>
                    <td className="py-2 ps-2">
                      <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                        className="rounded p-1 text-ink-3 hover:text-danger"><X size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("sales.globalDiscount")}>
            <Input type="number" min="0" step="0.01" value={globalDiscount} onChange={(e) => setGlobalDiscount(e.target.value)} />
          </Field>
          {saleType === "invoice" && (
            <>
              <Field label={t("payments.method")}>
                <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="">{t("common.none")}</option>
                  {methods?.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label={`${t("common.paid")} (${t("common.optional")})`}>
                <Input type="number" min="0" step="0.01" value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)} disabled={!payMethod} />
              </Field>
            </>
          )}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
          <div className="text-sm text-ink-2">
            {t("common.subtotal")}: <span className="num">{formatMoney(totals.subtotal)}</span> ·{" "}
            {t("common.tax")}: <span className="num">{formatMoney(totals.tax)}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-lg font-semibold">
              {t("common.total")}: <span className="num">{formatMoney(total)}</span>
            </span>
            <Button loading={loading} disabled={!lines.length || total < 0} onClick={submit}>
              <Plus size={15} /> {t("common.create")}
            </Button>
          </div>
        </div>
        {err && <ErrorState message={err} />}
      </Card>
    </div>
  );
}
