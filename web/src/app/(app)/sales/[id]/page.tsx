"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Undo2, Bike } from "lucide-react";
import { NewDeliveryModal } from "@/app/(app)/deliveries/page";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Spinner, ErrorState, Modal, Field, Input, Select, paymentTone } from "@/components/ui";

type SaleDetail = {
  id: string; number: string; sale_type: string; sale_date: string; due_date: string | null;
  status: string; payment_status: string; subtotal: string; discount_amount: string;
  tax_amount: string; shipping_amount: string; total: string; paid_amount: string;
  customer_name: string | null; warehouse_name: string; created_by_name: string | null;
  items: Array<{ id: string; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate: string; line_total: string }>;
  payments: Array<{ id: string; number: string; direction: string; payment_date: string; method: string; allocated: string }>;
  returns: Array<{ id: string; number: string; total: string; created_at: string }>;
};
type Method = { id: string; name: string; kind: string };

export default function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const { data: sale, error, isLoading, mutate } = useApi<SaleDetail>(`/sales/${id}`);
  const [returnOpen, setReturnOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const { data: mapData } = useApi<{ couriers: Array<{ id: string; name: string }> }>(
    can("deliveries.create") ? "/map" : null);

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (error || !sale) return <ErrorState message={t("common.errorGeneric")} />;

  const due = Number(sale.total) - Number(sale.paid_amount);
  const canReturn = can("sales.refund") && ["invoice", "pos"].includes(sale.sale_type) && sale.status === "completed";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-2 text-ink-3 hover:bg-surface hover:text-ink">
          <ArrowLeft size={17} />
        </button>
        <div className="flex-1">
          <h1 className="num text-lg font-semibold">{sale.number}</h1>
          <p className="text-xs text-ink-3">{formatDate(sale.sale_date)} · {sale.customer_name ?? t("sales.walkIn")}</p>
        </div>
        <Badge tone={paymentTone(sale.payment_status)}>{t(`sales.${sale.payment_status}`)}</Badge>
        <Button variant="secondary" onClick={() => window.open(`/sales/${id}/print`, "_blank")}>
          <Printer size={15} /> {t("common.print")}
        </Button>
        {canReturn && (
          <Button variant="secondary" onClick={() => setReturnOpen(true)}>
            <Undo2 size={15} /> {t("sales.returnSale")}
          </Button>
        )}
        {can("deliveries.create") && ["invoice", "pos"].includes(sale.sale_type) && (
          <Button variant="secondary" onClick={() => setDeliveryOpen(true)}>
            <Bike size={15} /> {t("delivery.createFromSale")}
          </Button>
        )}
      </div>

      <Card pad={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-4 py-2.5 text-start font-medium">{t("common.description")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.quantity")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.price")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.discount")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.tax")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.total")}</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{item.description}</td>
                <td className="num px-4 py-2.5 text-end">{Number(item.quantity)}</td>
                <td className="num px-4 py-2.5 text-end">{formatMoney(item.unit_price)}</td>
                <td className="num px-4 py-2.5 text-end">{Number(item.discount_pct) > 0 ? `${Number(item.discount_pct)}%` : "—"}</td>
                <td className="num px-4 py-2.5 text-end">{Number(item.tax_rate)}%</td>
                <td className="num px-4 py-2.5 text-end font-medium">{formatMoney(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-[13px]">
              <td colSpan={5} className="px-4 py-1.5 pt-3 text-end text-ink-2">{t("common.subtotal")}</td>
              <td className="num px-4 py-1.5 pt-3 text-end">{formatMoney(sale.subtotal)}</td>
            </tr>
            {Number(sale.discount_amount) > 0 && (
              <tr className="text-[13px]"><td colSpan={5} className="px-4 py-1.5 text-end text-ink-2">{t("common.discount")}</td>
                <td className="num px-4 py-1.5 text-end">−{formatMoney(sale.discount_amount)}</td></tr>
            )}
            <tr className="text-[13px]"><td colSpan={5} className="px-4 py-1.5 text-end text-ink-2">{t("common.tax")}</td>
              <td className="num px-4 py-1.5 text-end">{formatMoney(sale.tax_amount)}</td></tr>
            {Number(sale.shipping_amount) > 0 && (
              <tr className="text-[13px]"><td colSpan={5} className="px-4 py-1.5 text-end text-ink-2">{t("sales.shipping")}</td>
                <td className="num px-4 py-1.5 text-end">{formatMoney(sale.shipping_amount)}</td></tr>
            )}
            <tr className="text-[15px] font-semibold">
              <td colSpan={5} className="px-4 py-2 text-end">{t("common.total")}</td>
              <td className="num px-4 py-2 text-end">{formatMoney(sale.total)}</td>
            </tr>
            {due > 0.001 && (
              <tr className="text-[13px] text-warn">
                <td colSpan={5} className="px-4 pb-3 text-end">{t("common.due")}</td>
                <td className="num px-4 pb-3 text-end font-medium">{formatMoney(due)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={t("payments.title")} pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {sale.payments.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2"><span className="num text-xs text-ink-3">{p.number}</span><br />{p.method}</td>
                  <td className="px-4 py-2 text-xs text-ink-3">{formatDate(p.payment_date)}</td>
                  <td className={`num px-4 py-2 text-end font-medium ${p.direction === "out" ? "text-danger" : ""}`}>
                    {p.direction === "out" ? "−" : ""}{formatMoney(p.allocated)}
                  </td>
                </tr>
              ))}
              {!sale.payments.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("payments.empty")}</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card title={t("sales.return")} pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {sale.returns.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-line last:border-0 hover:bg-canvas"
                  onClick={() => router.push(`/sales/${r.id}`)}>
                  <td className="num px-4 py-2 font-medium">{r.number}</td>
                  <td className="px-4 py-2 text-xs text-ink-3">{formatDate(r.created_at)}</td>
                  <td className="num px-4 py-2 text-end font-medium text-danger">−{formatMoney(r.total)}</td>
                </tr>
              ))}
              {!sale.returns.length && <tr><td className="px-4 py-6 text-center text-ink-3">{t("common.none")}</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      {returnOpen && (
        <ReturnModal sale={sale} onClose={() => setReturnOpen(false)}
          onDone={() => { setReturnOpen(false); mutate(); }} />
      )}
      {deliveryOpen && (
        <NewDeliveryModal couriers={mapData?.couriers ?? []} saleId={id}
          onClose={() => setDeliveryOpen(false)}
          onDone={() => { setDeliveryOpen(false); }} />
      )}
    </div>
  );
}

function ReturnModal({ sale, onClose, onDone }: { sale: SaleDetail; onClose: () => void; onDone: () => void }) {
  const { t, formatMoney } = useI18n();
  const { data: methods } = useApi<{ data: Method[] }>("/payment-methods");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [refundMethod, setRefundMethod] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const returnTotal = sale.items.reduce((s, item) => {
    const n = Number(qty[item.id] || 0);
    if (n <= 0) return s;
    const base = n * Number(item.unit_price) * (1 - Number(item.discount_pct) / 100);
    return s + base * (1 + Number(item.tax_rate) / 100);
  }, 0);

  async function submit() {
    setLoading(true); setErr(null);
    try {
      const items = sale.items
        .filter((i) => Number(qty[i.id] || 0) > 0)
        .map((i) => ({ saleItemId: i.id, quantity: Number(qty[i.id]) }));
      await apiFetch(`/sales/${sale.id}/return`, {
        method: "POST",
        json: {
          items,
          refund: refundMethod ? { paymentMethodId: refundMethod, amount: Math.round(returnTotal * 100) / 100 } : null,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("sales.returnSale")} wide>
      <div className="space-y-4">
        <table className="w-full text-sm">
          <tbody>
            {sale.items.map((item) => (
              <tr key={item.id} className="border-b border-line last:border-0">
                <td className="py-2 pe-3 font-medium">{item.description}</td>
                <td className="num py-2 pe-3 text-ink-3">×{Number(item.quantity)}</td>
                <td className="py-2 text-end">
                  <Input type="number" min="0" max={Number(item.quantity)} step="1" placeholder={t("sales.returnQty")}
                    value={qty[item.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [item.id]: e.target.value }))}
                    className="ms-auto !w-28" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("sales.cashRefund")} hint={t("common.optional")}>
            <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {methods?.data.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <div className="self-end rounded-lg bg-canvas px-3 py-2 text-sm">
            {t("common.total")}: <span className="num font-semibold">{formatMoney(returnTotal)}</span>
          </div>
        </div>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} disabled={returnTotal <= 0} onClick={submit}>{t("sales.refund")}</Button>
        </div>
      </div>
    </Modal>
  );
}
