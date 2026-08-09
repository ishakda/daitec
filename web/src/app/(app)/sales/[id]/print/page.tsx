"use client";
import { use, useEffect } from "react";
import { useI18n } from "@/components/I18nProvider";
import { useApi } from "@/lib/client";
import { Spinner } from "@/components/ui";

type Company = { name: string; legal_name: string | null; address: string | null; city: string | null;
  wilaya: string | null; phone: string | null; nif: string | null; nis: string | null; rc: string | null;
  ai: string | null; invoice_footer: string | null };
type Sale = {
  number: string; sale_type: string; sale_date: string; due_date: string | null;
  subtotal: string; discount_amount: string; tax_amount: string; shipping_amount: string;
  total: string; paid_amount: string;
  customer_name: string | null; customer_address: string | null; customer_nif: string | null;
  customer_rc: string | null; customer_ai: string | null;
  items: Array<{ id: string; description: string; quantity: string; unit_price: string;
    discount_pct: string; tax_rate: string; line_total: string }>;
};

export default function PrintSalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, formatMoney, formatDate } = useI18n();
  const { data: sale } = useApi<Sale>(`/sales/${id}`);
  const { data: company } = useApi<Company>("/companies/active");

  useEffect(() => {
    if (sale && company) setTimeout(() => window.print(), 300);
  }, [sale, company]);

  if (!sale || !company) return <Spinner label={t("common.loading")} />;

  const docTitle = sale.sale_type === "return" ? t("sales.return")
    : sale.sale_type === "proforma" ? t("sales.proforma")
    : sale.sale_type === "pos" ? t("sales.ticket") : t("sales.invoice");
  const due = Number(sale.total) - Number(sale.paid_amount);

  return (
    <div className="print-page mx-auto min-h-screen max-w-[210mm] bg-white p-10 text-[13px] text-ink">
      <div className="flex items-start justify-between border-b-2 border-navy pb-5">
        <div>
          <h1 className="text-xl font-bold text-navy">{company.name}</h1>
          {company.legal_name && <p>{company.legal_name}</p>}
          {company.address && <p>{company.address}</p>}
          <p>{[company.city, company.wilaya].filter(Boolean).join(", ")}</p>
          {company.phone && <p>{company.phone}</p>}
        </div>
        <div className="text-end">
          <h2 className="text-lg font-bold uppercase">{docTitle}</h2>
          <p className="num font-semibold">{sale.number}</p>
          <p>{formatDate(sale.sale_date)}</p>
          {sale.due_date && <p>{t("common.dueDate")}: {formatDate(sale.due_date)}</p>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-6">
        <div className="text-[12px]">
          {company.nif && <p>NIF: <span className="num">{company.nif}</span></p>}
          {company.rc && <p>RC: <span className="num">{company.rc}</span></p>}
          {company.nis && <p>NIS: <span className="num">{company.nis}</span></p>}
          {company.ai && <p>AI: <span className="num">{company.ai}</span></p>}
        </div>
        <div className="rounded border border-line p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase text-ink-3">{t("sales.customer")}</p>
          <p className="font-semibold">{sale.customer_name ?? t("sales.walkIn")}</p>
          {sale.customer_address && <p>{sale.customer_address}</p>}
          {sale.customer_nif && <p>NIF: <span className="num">{sale.customer_nif}</span></p>}
          {sale.customer_rc && <p>RC: <span className="num">{sale.customer_rc}</span></p>}
        </div>
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="bg-navy text-white">
            <th className="border border-navy px-2 py-1.5 text-start">{t("common.description")}</th>
            <th className="border border-navy px-2 py-1.5 text-end">{t("common.quantity")}</th>
            <th className="border border-navy px-2 py-1.5 text-end">{t("common.price")}</th>
            <th className="border border-navy px-2 py-1.5 text-end">{t("common.discount")}</th>
            <th className="border border-navy px-2 py-1.5 text-end">{t("common.tax")}</th>
            <th className="border border-navy px-2 py-1.5 text-end">{t("common.total")}</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.id}>
              <td className="border border-line px-2 py-1.5">{i.description}</td>
              <td className="num border border-line px-2 py-1.5 text-end">{Number(i.quantity)}</td>
              <td className="num border border-line px-2 py-1.5 text-end">{formatMoney(i.unit_price)}</td>
              <td className="num border border-line px-2 py-1.5 text-end">{Number(i.discount_pct) > 0 ? `${Number(i.discount_pct)}%` : "—"}</td>
              <td className="num border border-line px-2 py-1.5 text-end">{Number(i.tax_rate)}%</td>
              <td className="num border border-line px-2 py-1.5 text-end">{formatMoney(i.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-end">
        <table className="w-64 text-[13px]">
          <tbody>
            <tr><td className="py-1 text-ink-2">{t("common.subtotal")}</td>
              <td className="num py-1 text-end">{formatMoney(sale.subtotal)}</td></tr>
            {Number(sale.discount_amount) > 0 && (
              <tr><td className="py-1 text-ink-2">{t("common.discount")}</td>
                <td className="num py-1 text-end">−{formatMoney(sale.discount_amount)}</td></tr>)}
            <tr><td className="py-1 text-ink-2">{t("common.tax")}</td>
              <td className="num py-1 text-end">{formatMoney(sale.tax_amount)}</td></tr>
            <tr className="border-t-2 border-navy text-[15px] font-bold">
              <td className="py-1.5">{t("common.total")}</td>
              <td className="num py-1.5 text-end">{formatMoney(sale.total)}</td></tr>
            {due > 0.001 && sale.sale_type !== "proforma" && (
              <>
                <tr><td className="py-1 text-ink-2">{t("common.paid")}</td>
                  <td className="num py-1 text-end">{formatMoney(sale.paid_amount)}</td></tr>
                <tr className="font-semibold"><td className="py-1">{t("common.due")}</td>
                  <td className="num py-1 text-end">{formatMoney(due)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {company.invoice_footer && (
        <p className="mt-10 border-t border-line pt-3 text-center text-[11px] text-ink-3">{company.invoice_footer}</p>
      )}
      <button onClick={() => window.print()} className="no-print mt-8 rounded-lg bg-accent px-4 py-2 text-white">
        {t("common.print")}
      </button>
    </div>
  );
}
