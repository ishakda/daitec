"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Spinner, ErrorState, Modal, Field, Input } from "@/components/ui";

type PoDetail = {
  id: string; number: string; status: string; order_date: string; expected_date: string | null;
  subtotal: string; tax_amount: string; total: string; supplier_id: string; supplier_name: string;
  warehouse_id: string | null; warehouse_name: string | null;
  items: Array<{ id: string; product_id: string; description: string; quantity: string; received_qty: string; unit_price: string; tax_rate: string; line_total: string }>;
  receipts: Array<{ id: string; number: string; receipt_date: string; status: string }>;
};

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatMoney, formatDate } = useI18n();
  const router = useRouter();
  const { can } = useMe();
  const { data: po, error, isLoading, mutate } = useApi<PoDetail>(`/purchases/orders/${id}`);
  const [receiveOpen, setReceiveOpen] = useState(false);

  if (isLoading) return <Spinner label={t("common.loading")} />;
  if (error || !po) return <ErrorState message={t("common.errorGeneric")} />;

  const receivable = po.items.some((i) => Number(i.received_qty) < Number(i.quantity));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => router.push("/purchases")} className="rounded-lg p-2 text-ink-3 hover:bg-surface hover:text-ink">
          <ArrowLeft size={17} />
        </button>
        <div className="flex-1">
          <h1 className="num text-lg font-semibold">{po.number}</h1>
          <p className="text-xs text-ink-3">{po.supplier_name} · {formatDate(po.order_date)}</p>
        </div>
        <Badge tone={po.status === "received" ? "ok" : po.status === "cancelled" ? "neutral" : "warn"}>
          {t(`purchases.${po.status === "partially_received" ? "partiallyReceived" : po.status}`)}
        </Badge>
        {can("purchases.receive") && receivable && (
          <Button onClick={() => setReceiveOpen(true)}><PackageCheck size={15} /> {t("purchases.receive")}</Button>
        )}
      </div>

      <Card pad={false}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[12px] uppercase tracking-wide text-ink-3">
              <th className="px-4 py-2.5 text-start font-medium">{t("common.description")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.quantity")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("purchases.receivedQty")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("purchases.unitCost")}</th>
              <th className="px-4 py-2.5 text-end font-medium">{t("common.total")}</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => (
              <tr key={item.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{item.description}</td>
                <td className="num px-4 py-2.5 text-end">{Number(item.quantity)}</td>
                <td className="num px-4 py-2.5 text-end">
                  <Badge tone={Number(item.received_qty) >= Number(item.quantity) ? "ok" : "warn"}>
                    {Number(item.received_qty)}
                  </Badge>
                </td>
                <td className="num px-4 py-2.5 text-end">{formatMoney(item.unit_price)}</td>
                <td className="num px-4 py-2.5 text-end font-medium">{formatMoney(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line text-[15px] font-semibold">
              <td colSpan={4} className="px-4 py-2.5 text-end">{t("common.total")}</td>
              <td className="num px-4 py-2.5 text-end">{formatMoney(po.total)}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {po.receipts.length > 0 && (
        <Card title={t("purchases.receipts")} pad={false}>
          <table className="w-full text-sm">
            <tbody>
              {po.receipts.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="num px-4 py-2 font-medium">{r.number}</td>
                  <td className="px-4 py-2 text-ink-3">{formatDate(r.receipt_date)}</td>
                  <td className="px-4 py-2 text-end"><Badge tone="ok">{t("purchases.received")}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {receiveOpen && (
        <ReceiveModal po={po} onClose={() => setReceiveOpen(false)}
          onDone={() => { setReceiveOpen(false); mutate(); }} />
      )}
    </div>
  );
}

function ReceiveModal({ po, onClose, onDone }: { po: PoDetail; onClose: () => void; onDone: () => void }) {
  const { t, formatMoney } = useI18n();
  const { data: warehouses } = useApi<{ data: Array<{ id: string; name: string; is_default: boolean }> }>("/warehouses");
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.items.map((i) => [i.id, String(Number(i.quantity) - Number(i.received_qty))])));
  const [cost, setCost] = useState<Record<string, string>>(() =>
    Object.fromEntries(po.items.map((i) => [i.id, i.unit_price])));
  const [createInvoice, setCreateInvoice] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totalValue = po.items.reduce((s, i) => s + Number(qty[i.id] || 0) * Number(cost[i.id] || 0), 0);

  async function submit() {
    setLoading(true); setErr(null);
    try {
      const wh = po.warehouse_id ?? (warehouses?.data.find((w) => w.is_default) ?? warehouses?.data[0])?.id;
      const items = po.items
        .filter((i) => Number(qty[i.id] || 0) > 0)
        .map((i) => ({
          purchaseOrderItemId: i.id, productId: i.product_id,
          quantity: Number(qty[i.id]), unitCost: Number(cost[i.id] || 0),
        }));
      await apiFetch("/purchases/receipts", {
        method: "POST",
        json: {
          purchaseOrderId: po.id, supplierId: po.supplier_id, warehouseId: wh,
          items, createSupplierInvoice: createInvoice,
          dueDate: dueDate || null, supplierRef: supplierRef || null,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("purchases.receive")} wide>
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-[12px] uppercase text-ink-3">
              <th className="py-2 text-start font-medium">{t("common.description")}</th>
              <th className="py-2 text-end font-medium">{t("purchases.remainingQty")}</th>
              <th className="py-2 text-end font-medium">{t("purchases.receivedQty")}</th>
              <th className="py-2 text-end font-medium">{t("purchases.unitCost")}</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => {
              const remaining = Number(item.quantity) - Number(item.received_qty);
              return (
                <tr key={item.id} className="border-b border-line last:border-0">
                  <td className="py-2 pe-3 font-medium">{item.description}</td>
                  <td className="num py-2 text-end text-ink-3">{remaining}</td>
                  <td className="py-2"><Input type="number" min="0" max={remaining} step="any"
                    value={qty[item.id]} onChange={(e) => setQty((q) => ({ ...q, [item.id]: e.target.value }))}
                    className="ms-auto !w-24 text-end" /></td>
                  <td className="py-2"><Input type="number" min="0" step="0.01"
                    value={cost[item.id]} onChange={(e) => setCost((c) => ({ ...c, [item.id]: e.target.value }))}
                    className="ms-auto !w-28 text-end" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <input type="checkbox" checked={createInvoice} onChange={(e) => setCreateInvoice(e.target.checked)} />
            {t("purchases.createInvoice")}
          </label>
          {createInvoice && (
            <>
              <Field label={t("common.dueDate")}>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label={t("purchases.supplierRef")}>
                <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
              </Field>
            </>
          )}
          <div className="ms-auto rounded-lg bg-canvas px-3 py-2 text-sm">
            {t("common.total")}: <span className="num font-semibold">{formatMoney(totalValue)}</span>
          </div>
        </div>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} disabled={totalValue < 0} onClick={submit}>{t("common.confirm")}</Button>
        </div>
      </div>
    </Modal>
  );
}
