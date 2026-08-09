"use client";
import { use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useI18n } from "@/components/I18nProvider";
import { useApi } from "@/lib/client";
import { Spinner } from "@/components/ui";

/**
 * Thermal receipt (58mm / 80mm), driven by the company's configurable
 * receipt template (Settings → Receipt). Auto-triggers the browser
 * print dialog; thermal drivers take it from there.
 */

type ReceiptSettings = {
  paperWidth: "58" | "80";
  headerText: string; footerText: string;
  showNif: boolean; showTaxDetail: boolean;
  showCashier: boolean; showCustomer: boolean;
  autoPrint: boolean;
};
type Company = {
  name: string; address: string | null; city: string | null; phone: string | null;
  nif: string | null; rc: string | null; ai: string | null;
};
type Sale = {
  number: string; sale_type: string; created_at: string;
  subtotal: string; discount_amount: string; tax_amount: string; total: string; paid_amount: string;
  customer_name: string | null; created_by_name: string | null;
  items: Array<{ id: string; description: string; quantity: string; unit_price: string;
    discount_pct: string; tax_rate: string; line_total: string }>;
  payments: Array<{ id: string; method: string; direction: string; allocated: string }>;
};

function ReceiptInner({ id }: { id: string }) {
  const { t, formatMoney, formatDateTime } = useI18n();
  const params = useSearchParams();
  const isDuplicate = params.get("dup") === "1";
  const { data: sale } = useApi<Sale>(`/sales/${id}`);
  const { data: company } = useApi<Company>("/companies/active");
  const { data: settings } = useApi<{ value: ReceiptSettings }>("/settings/receipt");

  const ready = sale && company && settings;
  useEffect(() => {
    if (ready) {
      const timer = setTimeout(() => window.print(), 350);
      return () => clearTimeout(timer);
    }
  }, [ready]);

  if (!ready) return <Spinner label={t("common.loading")} />;
  const s = settings.value;
  const w = s.paperWidth === "58" ? 58 : 80;
  const paidIn = sale.payments.filter((p) => p.direction === "in");
  const received = paidIn.reduce((sum, p) => sum + Number(p.allocated), 0);
  const change = Math.max(0, received - Number(sale.total));
  const dz = (n: number | string) => `${Number(n).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-canvas">
      {/* Print sizing for thermal paper */}
      <style>{`
        @media print {
          @page { size: ${w}mm auto; margin: 0; }
          body { background: #fff !important; }
          .receipt { box-shadow: none !important; margin: 0 !important; border: none !important; }
        }
      `}</style>

      <div
        className="receipt mx-auto my-6 border border-line bg-white text-black shadow-card"
        style={{
          width: `${w}mm`, padding: `${w === 58 ? "3mm 2.5mm" : "4mm 3.5mm"}`,
          fontFamily: "'Courier New', ui-monospace, monospace",
          fontSize: w === 58 ? "10.5px" : "12px", lineHeight: 1.35,
        }}
        dir="ltr"
      >
        {/* Header */}
        <div className="text-center">
          <p className="text-[1.25em] font-bold uppercase">{company.name}</p>
          {company.address && <p>{company.address}</p>}
          {company.city && <p>{company.city}</p>}
          {company.phone && <p>Tél: {company.phone}</p>}
          {s.showNif && company.nif && <p>NIF: {company.nif}</p>}
          {s.showNif && company.rc && <p>RC: {company.rc}</p>}
          {s.headerText && <p className="mt-1 whitespace-pre-line">{s.headerText}</p>}
        </div>

        <Dashes />
        <div className="flex justify-between">
          <span>{t("receipt.ticketNo")} {sale.number}</span>
          {isDuplicate && <span className="font-bold">{t("receipt.duplicate")}</span>}
        </div>
        <p>{formatDateTime(sale.created_at)}</p>
        {s.showCashier && sale.created_by_name && <p>{t("receipt.cashier")}: {sale.created_by_name}</p>}
        {s.showCustomer && sale.customer_name && <p>{t("sales.customer")}: {sale.customer_name}</p>}
        <Dashes />

        {/* Items */}
        {sale.items.map((item) => {
          const qty = Number(item.quantity);
          const disc = Number(item.discount_pct);
          return (
            <div key={item.id} className="mb-1">
              <p className="break-words font-bold">{item.description}</p>
              <div className="flex justify-between">
                <span>
                  {qty} x {dz(item.unit_price)}
                  {disc > 0 ? ` -${disc}%` : ""}
                </span>
                <span>{dz(item.line_total)}</span>
              </div>
            </div>
          );
        })}

        <Dashes />
        <div className="flex justify-between"><span>{t("common.subtotal")}</span><span>{dz(sale.subtotal)}</span></div>
        {Number(sale.discount_amount) > 0 && (
          <div className="flex justify-between"><span>{t("common.discount")}</span><span>-{dz(sale.discount_amount)}</span></div>
        )}
        {s.showTaxDetail && (
          <div className="flex justify-between"><span>{t("common.tax")}</span><span>{dz(sale.tax_amount)}</span></div>
        )}
        <div className="flex justify-between text-[1.3em] font-bold">
          <span>{t("common.total")}</span><span>{formatMoney(sale.total)}</span>
        </div>

        {paidIn.length > 0 && (
          <>
            <Dashes />
            {paidIn.map((p) => (
              <div key={p.id} className="flex justify-between">
                <span>{p.method}</span><span>{dz(p.allocated)}</span>
              </div>
            ))}
            {change > 0 && (
              <div className="flex justify-between font-bold">
                <span>{t("receipt.change")}</span><span>{dz(change)}</span>
              </div>
            )}
            {Number(sale.paid_amount) < Number(sale.total) && (
              <div className="flex justify-between font-bold">
                <span>{t("common.due")}</span><span>{dz(Number(sale.total) - Number(sale.paid_amount))}</span>
              </div>
            )}
          </>
        )}

        <Dashes />
        <div className="text-center">
          {s.footerText && <p className="whitespace-pre-line">{s.footerText}</p>}
          <p className="mt-1">* * *</p>
        </div>
      </div>

      <div className="no-print mx-auto flex max-w-xs flex-col items-center gap-2 pb-8">
        <button onClick={() => window.print()}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-strong">
          {t("common.print")}
        </button>
        <p className="text-xs text-ink-3">{t("receipt.printHint")}</p>
      </div>
    </div>
  );
}

function Dashes() {
  return <p className="my-1 overflow-hidden whitespace-nowrap">{"-".repeat(64)}</p>;
}

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense><ReceiptInner id={id} /></Suspense>;
}
