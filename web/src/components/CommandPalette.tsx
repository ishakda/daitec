"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Package, Users, Factory, Receipt, Truck, Plus, ShoppingCart } from "lucide-react";
import { useI18n } from "./I18nProvider";
import { apiFetch } from "@/lib/client";

type SearchResults = {
  products: Array<{ id: string; name: string; detail: string | null }>;
  customers: Array<{ id: string; name: string; detail: string | null }>;
  suppliers: Array<{ id: string; name: string; detail: string | null }>;
  sales: Array<{ id: string; name: string; detail: string | null }>;
  purchaseOrders: Array<{ id: string; name: string; detail: string | null }>;
};

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) { setQ(""); setResults(null); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults(null); return; }
    timer.current = setTimeout(async () => {
      try { setResults(await apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`)); }
      catch { setResults(null); }
    }, 180);
  }, [q]);

  if (!open) return null;

  const go = (path: string) => { onClose(); router.push(path); };

  const quickActions = [
    { label: t("sales.newSale"), icon: Receipt, path: "/sales/new" },
    { label: t("nav.pos"), icon: ShoppingCart, path: "/pos" },
    { label: t("products.add"), icon: Package, path: "/products?new=1" },
    { label: t("customers.add"), icon: Users, path: "/customers?new=1" },
    { label: t("purchases.newOrder"), icon: Truck, path: "/purchases?new=1" },
    { label: t("expenses.add"), icon: Plus, path: "/expenses?new=1" },
  ];

  const sections: Array<{ title: string; icon: typeof Package; items: Array<{ id: string; name: string; detail: string | null }>; path: (id: string) => string }> =
    results
      ? [
          { title: t("nav.products"), icon: Package, items: results.products, path: (id: string) => `/products/${id}` },
          { title: t("nav.customers"), icon: Users, items: results.customers, path: (id: string) => `/customers/${id}` },
          { title: t("nav.suppliers"), icon: Factory, items: results.suppliers, path: (id: string) => `/suppliers/${id}` },
          { title: t("nav.sales"), icon: Receipt, items: results.sales, path: (id: string) => `/sales/${id}` },
          { title: t("purchases.orders"), icon: Truck, items: results.purchaseOrders, path: (id: string) => `/purchases/${id}` },
        ].filter((s) => s.items.length)
      : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="text-ink-3" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("common.search")}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded border border-line-2 px-1.5 py-0.5 text-[10.5px] text-ink-3">ESC</kbd>
        </div>
        <div className="scroll-thin max-h-[50vh] overflow-y-auto p-2">
          {!results && (
            <div className="grid grid-cols-2 gap-1 p-1">
              {quickActions.map((a) => (
                <button key={a.path} onClick={() => go(a.path)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-start text-[13.5px] font-medium text-ink-2 hover:bg-canvas hover:text-ink">
                  <a.icon size={15.5} className="text-accent" /> {a.label}
                </button>
              ))}
            </div>
          )}
          {sections.map((s) => (
            <div key={s.title} className="mb-1.5">
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{s.title}</p>
              {s.items.map((item) => (
                <button key={item.id} onClick={() => go(s.path(item.id))}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm hover:bg-canvas">
                  <s.icon size={15} className="shrink-0 text-ink-3" />
                  <span className="font-medium">{item.name}</span>
                  {item.detail && <span className="ms-auto text-xs text-ink-3">{item.detail}</span>}
                </button>
              ))}
            </div>
          ))}
          {results && sections.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-3">{t("common.noResults")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
