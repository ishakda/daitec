"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Trash2, Pause, Play, Banknote, X, Printer, Wifi, WifiOff, CloudUpload, AlertTriangle } from "lucide-react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, ClientApiError } from "@/lib/client";
import { Button, Input, Field, Modal, Badge, Spinner } from "@/components/ui";
import {
  cacheCatalog, offlineLookup, catalogCount, enqueueSale, pendingSales,
  conflictSales, discardConflict, drainQueue, CatalogItem, ConflictItem,
} from "@/lib/offline";

type LookupItem = { id: string; sku: string; name: string; price: string; tax_rate: string; variant_id: string | null; variant_name: string | null; stock: string };
type CartLine = { productId: string; variantId: string | null; name: string; unitPrice: number; taxRate: number; quantity: number; discountPct: number; stock: number };
type Method = { id: string; name: string; code: string; kind: string };
type Customer = { id: string; name: string };
type RegisterResp = { current: { id: string; opening_cash: string; opened_at: string } | null };
type ReceiptSettings = { autoPrint: boolean };

const HELD_KEY = "sahla_pos_held";

export default function PosPage() {
  const { t, formatMoney } = useI18n();
  const { data: reg, isLoading: regLoading, mutate: mutateReg } = useApi<RegisterResp>("/registers");
  const { data: methods } = useApi<{ data: Method[] }>("/payment-methods");
  const { data: warehouses } = useApi<{ data: Array<{ id: string; name: string; is_default: boolean }> }>("/warehouses");
  const { data: receiptSettings } = useApi<{ value: ReceiptSettings }>("/settings/receipt");

  const [cart, setCart] = useState<CartLine[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LookupItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [held, setHeld] = useState<Array<{ id: number; cart: CartLine[]; customer: Customer | null }>>([]);
  const [lastTicket, setLastTicket] = useState<{ saleId: string; number: string; total: number; change: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const warehouse = warehouses?.data.find((w) => w.is_default) ?? warehouses?.data[0];
  const session = reg?.current ?? null;

  /* ---------------- offline engine ---------------- */
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [conflictsOpen, setConflictsOpen] = useState(false);

  const refreshOfflineState = useCallback(async () => {
    setPendingCount((await pendingSales()).length);
    setConflicts(await conflictSales());
  }, []);

  const runDrain = useCallback(async () => {
    if (!navigator.onLine) return;
    const r = await drainQueue();
    if (r.applied > 0) flash(t("offline.synced", { n: r.applied }));
    refreshOfflineState();
  }, [refreshOfflineState, t]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => { setOnline(true); runDrain(); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    refreshOfflineState();
    // cache the catalog for offline search (refresh when online)
    (async () => {
      try {
        const r = await apiFetch<{ data: CatalogItem[] }>("/pos/catalog");
        await cacheCatalog(r.data);
      } catch { /* offline start: keep the existing cache */ }
    })();
    const iv = setInterval(runDrain, 30000);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { setHeld(JSON.parse(localStorage.getItem(HELD_KEY) ?? "[]")); } catch { /* ignore */ }
  }, []);
  const persistHeld = (h: typeof held) => { setHeld(h); localStorage.setItem(HELD_KEY, JSON.stringify(h)); };

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  const addItem = useCallback((item: LookupItem) => {
    const stock = Number(item.stock);
    setCart((c) => {
      const idx = c.findIndex((l) => l.productId === item.id && l.variantId === item.variant_id);
      if (idx >= 0) {
        const next = [...c];
        if (next[idx].quantity + 1 > stock) { flash(t("pos.insufficientStock")); return c; }
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      if (stock <= 0) { flash(t("pos.insufficientStock")); return c; }
      return [...c, {
        productId: item.id, variantId: item.variant_id,
        name: item.variant_name ? `${item.name} — ${item.variant_name}` : item.name,
        unitPrice: Number(item.price), taxRate: Number(item.tax_rate ?? 0),
        quantity: 1, discountPct: 0, stock,
      }];
    });
    setQ(""); setResults([]); searchRef.current?.focus();
  }, [t]);

  // Search with barcode-first strategy (Enter = exact barcode submit)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim() || !warehouse) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const r = await apiFetch<{ data: LookupItem[]; matched: string }>(
          `/products/lookup?q=${encodeURIComponent(q.trim())}&warehouseId=${warehouse.id}`);
        setResults(r.data);
      } catch {
        // offline: search the cached catalog
        const hits = await offlineLookup(q.trim());
        setResults(hits.map((h) => ({
          id: h.id, sku: h.sku, name: h.name, price: h.selling_price,
          tax_rate: h.tax_rate, variant_id: null, variant_name: null, stock: h.stock,
        })));
      }
    }, 160);
  }, [q, warehouse]);

  async function onSearchEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter" || !q.trim() || !warehouse) return;
    e.preventDefault();
    try {
      if (!navigator.onLine) throw new Error("offline");
      const r = await apiFetch<{ data: LookupItem[] }>(
        `/products/lookup?barcode=${encodeURIComponent(q.trim())}&warehouseId=${warehouse.id}`);
      if (r.data.length) { addItem(r.data[0]); return; }
    } catch {
      const hits = await offlineLookup(q.trim(), 1);
      if (hits.length) {
        addItem({ id: hits[0].id, sku: hits[0].sku, name: hits[0].name, price: hits[0].selling_price,
          tax_rate: hits[0].tax_rate, variant_id: null, variant_name: null, stock: hits[0].stock });
        return;
      }
    }
    if (results.length) addItem(results[0]);
  }

  const totals = cart.reduce(
    (acc, l) => {
      const base = l.quantity * l.unitPrice * (1 - l.discountPct / 100);
      const tax = base * (l.taxRate / 100);
      return { subtotal: acc.subtotal + base, tax: acc.tax + tax, total: acc.total + base + tax };
    },
    { subtotal: 0, tax: 0, total: 0 }
  );

  const setLine = (i: number, patch: Partial<CartLine>) =>
    setCart((c) => c.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function holdSale() {
    if (!cart.length) return;
    persistHeld([...held, { id: Date.now(), cart, customer }]);
    setCart([]); setCustomer(null);
  }
  function resumeSale(id: number) {
    const h = held.find((x) => x.id === id);
    if (!h) return;
    setCart(h.cart); setCustomer(h.customer);
    persistHeld(held.filter((x) => x.id !== id));
  }

  if (regLoading) return <Spinner label={t("common.loading")} />;

  return (
    <div className="flex h-screen flex-col bg-canvas">
      <header className="no-print flex h-12 items-center gap-3 border-b border-line bg-navy px-3 text-white">
        <Link href="/dashboard" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
          <ArrowLeft size={15} /> {t("common.back")}
        </Link>
        <span className="font-semibold">{t("pos.title")}</span>
        {session ? (
          <Badge tone="ok">{t("pos.session")} · {formatMoney(session.opening_cash)}</Badge>
        ) : (
          <Badge tone="warn">{t("pos.noSession")}</Badge>
        )}
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold
          ${online ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/20 text-red-300"}`}>
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? t("offline.online") : t("offline.offline")}
        </span>
        {pendingCount > 0 && (
          <button onClick={runDrain}
            className="flex items-center gap-1.5 rounded-full bg-amber-400/15 px-2.5 py-1 text-[12px] font-semibold text-amber-300 hover:bg-amber-400/25">
            <CloudUpload size={13} /> {t("offline.pending", { n: pendingCount })}
          </button>
        )}
        {conflicts.length > 0 && (
          <button onClick={() => setConflictsOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-red-400/15 px-2.5 py-1 text-[12px] font-semibold text-red-300 hover:bg-red-400/25">
            <AlertTriangle size={13} /> {t("offline.conflicts", { n: conflicts.length })}
          </button>
        )}
        <div className="ms-auto flex items-center gap-2">
          {lastTicket && (
            <span className="flex items-center gap-2 text-[12.5px] text-white/70">
              {t("pos.lastTicket")}: <span className="num font-medium text-white">{lastTicket.number}</span>
              {lastTicket.change > 0 && <> · {t("pos.change")}: <span className="num font-semibold text-emerald-300">{formatMoney(lastTicket.change)}</span></>}
              {lastTicket.saleId && (
                <button
                  onClick={() => window.open(`/pos/receipt/${lastTicket.saleId}?dup=1`, "_blank", "width=420,height=640")}
                  title={t("pos.printReceipt")}
                  className="rounded-md p-1.5 text-white/80 hover:bg-white/15 hover:text-white"
                >
                  <Printer size={15} />
                </button>
              )}
            </span>
          )}
          {session && <CloseRegisterButton sessionId={session.id} onClosed={() => mutateReg()} />}
        </div>
      </header>

      {!session ? (
        <OpenRegister onOpened={() => mutateReg()} />
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* Left: search + results */}
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <Input
              ref={searchRef}
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchEnter}
              placeholder={t("pos.scanOrSearch")}
              className="h-12 text-[15px]"
            />
            <div className="scroll-thin mt-3 grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
              {results.map((r) => (
                <button
                  key={`${r.id}:${r.variant_id ?? ""}`}
                  onClick={() => addItem(r)}
                  disabled={Number(r.stock) <= 0}
                  className="flex flex-col items-start rounded-xl border border-line bg-surface p-3 text-start shadow-card
                    transition-colors hover:border-accent disabled:opacity-45"
                >
                  <span className="line-clamp-2 text-[13.5px] font-medium leading-snug">{r.name}</span>
                  <span className="mt-auto flex w-full items-center justify-between pt-2">
                    <span className="num text-sm font-semibold text-accent">{formatMoney(r.price)}</span>
                    <Badge tone={Number(r.stock) > 0 ? "neutral" : "danger"}>
                      {Number(r.stock) > 0 ? <span className="num">{Number(r.stock)}</span> : t("pos.outOfStock")}
                    </Badge>
                  </span>
                </button>
              ))}
              {q && !results.length && (
                <p className="col-span-full py-10 text-center text-sm text-ink-3">{t("common.noResults")}</p>
              )}
              {!q && held.length > 0 && (
                <div className="col-span-full">
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">{t("pos.heldSales")}</p>
                  <div className="flex flex-wrap gap-2">
                    {held.map((h) => (
                      <button key={h.id} onClick={() => resumeSale(h.id)}
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] hover:border-accent">
                        <Play size={13} className="text-accent" />
                        {h.cart.length} {t("common.items")} · {h.customer?.name ?? t("sales.walkIn")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: cart */}
          <div className="flex w-[400px] shrink-0 flex-col border-s border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <h2 className="text-sm font-semibold">{t("pos.cart")}</h2>
              <div className="flex gap-1.5">
                <CustomerPicker customer={customer} onPick={setCustomer} />
                <Button variant="ghost" className="h-8 px-2" onClick={holdSale} disabled={!cart.length} title={t("pos.hold")}>
                  <Pause size={15} />
                </Button>
                <Button variant="ghost" className="h-8 px-2" onClick={() => { setCart([]); setCustomer(null); }} disabled={!cart.length} title={t("pos.clear")}>
                  <Trash2 size={15} className="text-danger" />
                </Button>
              </div>
            </div>
            <div className="scroll-thin flex-1 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="px-4 py-14 text-center text-[13px] text-ink-3">{t("pos.emptyCart")}</p>
              ) : cart.map((l, i) => (
                <div key={`${l.productId}:${l.variantId ?? ""}`} className="border-b border-line px-4 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13.5px] font-medium leading-snug">{l.name}</p>
                    <button onClick={() => setCart((c) => c.filter((_, idx) => idx !== i))}
                      className="rounded p-0.5 text-ink-3 hover:text-danger"><X size={14} /></button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-line-2">
                      <button className="h-7 w-7 text-ink-2 hover:bg-canvas" onClick={() => l.quantity > 1 && setLine(i, { quantity: l.quantity - 1 })}>−</button>
                      <input
                        type="number" min={1} max={l.stock} value={l.quantity}
                        onChange={(e) => {
                          const v = Math.max(1, Math.min(l.stock, Number(e.target.value) || 1));
                          setLine(i, { quantity: v });
                        }}
                        className="num h-7 w-12 border-x border-line-2 text-center text-[13px] outline-none"
                      />
                      <button className="h-7 w-7 text-ink-2 hover:bg-canvas"
                        onClick={() => l.quantity < l.stock ? setLine(i, { quantity: l.quantity + 1 }) : flash(t("pos.insufficientStock"))}>+</button>
                    </div>
                    <input
                      type="number" min={0} max={100} value={l.discountPct || ""}
                      placeholder="%" title={t("common.discount")}
                      onChange={(e) => setLine(i, { discountPct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                      className="num h-7 w-14 rounded-lg border border-line-2 px-1.5 text-center text-[13px] outline-none focus:border-accent"
                    />
                    <span className="num ms-auto text-[13.5px] font-semibold">
                      {formatMoney(l.quantity * l.unitPrice * (1 - l.discountPct / 100) * (1 + l.taxRate / 100))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-line p-4">
              <div className="mb-3 space-y-1 text-[13px] text-ink-2">
                <div className="flex justify-between"><span>{t("common.subtotal")}</span><span className="num">{formatMoney(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span>{t("common.tax")}</span><span className="num">{formatMoney(totals.tax)}</span></div>
                <div className="flex justify-between text-base font-semibold text-ink">
                  <span>{t("common.total")}</span><span className="num">{formatMoney(totals.total)}</span>
                </div>
              </div>
              <Button className="h-12 w-full text-[15px]" disabled={!cart.length} onClick={() => setPayOpen(true)}>
                <Banknote size={17} /> {t("pos.pay")} · <span className="num">{formatMoney(totals.total)}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {conflictsOpen && (
        <Modal open onClose={() => setConflictsOpen(false)} title={t("offline.conflictsTitle")} wide>
          <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{t("offline.conflictHint")}</p>
          <table className="w-full text-sm">
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.idempotencyKey} className="border-b border-line last:border-0">
                  <td className="num px-2 py-2 font-medium">{c.localNumber}</td>
                  <td className="px-2 py-2 text-xs text-ink-3">{new Date(c.queuedAt).toLocaleString()}</td>
                  <td className="num px-2 py-2 text-end font-medium">{formatMoney(c.total)}</td>
                  <td className="px-2 py-2 text-xs text-danger">{c.error}</td>
                  <td className="px-2 py-2 text-end">
                    <Button variant="ghost" className="h-7 px-2 text-xs text-danger"
                      onClick={async () => { await discardConflict(c.idempotencyKey); refreshOfflineState(); }}>
                      {t("offline.discard")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-navy px-4 py-2.5 text-[13.5px] font-medium text-white shadow-pop">
          {toast}
        </div>
      )}

      {payOpen && session && warehouse && (
        <PaymentModal
          total={totals.total}
          methods={methods?.data ?? []}
          customer={customer}
          onClose={() => setPayOpen(false)}
          onConfirm={async (payments, change) => {
            const salePayload = {
              saleType: "pos", customerId: customer?.id ?? null, warehouseId: warehouse.id,
              registerSessionId: session.id,
              items: cart.map((l) => ({
                productId: l.productId, variantId: l.variantId, quantity: l.quantity,
                unitPrice: l.unitPrice, discountPct: l.discountPct, taxRate: l.taxRate,
              })),
              payments,
            };
            try {
              if (!navigator.onLine) throw new TypeError("offline");
              const r = await apiFetch<{ saleId: string; number: string; totals: { total: number } }>("/sales", {
                method: "POST", json: salePayload,
              });
              setLastTicket({ saleId: r.saleId, number: r.number, total: r.totals.total, change });
              setCart([]); setCustomer(null); setPayOpen(false);
              if (receiptSettings?.value.autoPrint) {
                window.open(`/pos/receipt/${r.saleId}`, "_blank", "width=420,height=640");
              }
            } catch (e) {
              // Network failure → queue the sale locally (idempotent replay later).
              if (e instanceof TypeError) {
                const queued = await enqueueSale(salePayload, totals.total);
                setOnline(false);
                setLastTicket({ saleId: "", number: queued.localNumber, total: queued.total, change });
                setCart([]); setCustomer(null); setPayOpen(false);
                flash(t("offline.queuedInfo"));
                refreshOfflineState();
              } else {
                throw e; // business errors still surface in the modal
              }
            }
            searchRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/* ---------- Open / Close register ---------- */
function OpenRegister({ onOpened }: { onOpened: () => void }) {
  const { t } = useI18n();
  const [cash, setCash] = useState("0");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-card">
        <h2 className="mb-1 text-base font-semibold">{t("pos.openRegister")}</h2>
        <p className="mb-4 text-[13px] text-ink-3">{t("pos.openToStart")}</p>
        <Field label={t("pos.openingCash")}>
          <Input type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} autoFocus />
        </Field>
        {err && <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <Button className="mt-4 w-full" loading={loading} onClick={async () => {
          setLoading(true); setErr(null);
          try { await apiFetch("/registers", { method: "POST", json: { openingCash: Number(cash || 0) } }); onOpened(); }
          catch (e) { setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric")); }
          finally { setLoading(false); }
        }}>
          {t("pos.openRegister")}
        </Button>
      </div>
    </div>
  );
}

function CloseRegisterButton({ sessionId, onClosed }: { sessionId: string; onClosed: () => void }) {
  const { t, formatMoney } = useI18n();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState("");
  const [result, setResult] = useState<{ expected: number; actual: number; difference: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button variant="secondary" className="h-8 bg-white/10 !border-white/20 text-white hover:!bg-white/20"
        onClick={() => setOpen(true)}>
        {t("pos.closeRegister")}
      </Button>
      <Modal open={open} onClose={() => { setOpen(false); if (result) onClosed(); }} title={t("pos.closeRegister")}>
        {result ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-ink-2">{t("pos.expectedCash")}</span>
              <span className="num font-medium">{formatMoney(result.expected)}</span></div>
            <div className="flex justify-between"><span className="text-ink-2">{t("pos.actualCash")}</span>
              <span className="num font-medium">{formatMoney(result.actual)}</span></div>
            <div className={`flex justify-between text-base font-semibold ${result.difference === 0 ? "text-ok" : "text-danger"}`}>
              <span>{t("pos.difference")}</span><span className="num">{formatMoney(result.difference)}</span>
            </div>
            <Button className="mt-3 w-full" onClick={() => { setOpen(false); onClosed(); }}>{t("common.close")}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label={t("pos.actualCash")} required>
              <Input type="number" min="0" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} autoFocus />
            </Field>
            {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
            <Button className="w-full" loading={loading} disabled={actual === ""} onClick={async () => {
              setLoading(true); setErr(null);
              try {
                setResult(await apiFetch(`/registers/${sessionId}/close`, { method: "POST", json: { actualCash: Number(actual) } }));
              } catch (e) { setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric")); }
              finally { setLoading(false); }
            }}>
              {t("common.confirm")}
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ---------- Customer picker ---------- */
function CustomerPicker({ customer, onPick }: { customer: Customer | null; onPick: (c: Customer | null) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data } = useApi<{ data: Customer[] }>(open ? `/customers?q=${encodeURIComponent(q)}&limit=8` : null);
  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`h-8 max-w-[150px] truncate rounded-lg border px-2.5 text-[12.5px] font-medium
          ${customer ? "border-accent bg-accent-soft text-accent-strong" : "border-line-2 text-ink-2 hover:bg-canvas"}`}>
        {customer?.name ?? t("sales.customer")}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("sales.customer")}>
        <Input placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="scroll-thin mt-3 max-h-64 space-y-1 overflow-y-auto">
          <button onClick={() => { onPick(null); setOpen(false); }}
            className="w-full rounded-lg px-3 py-2 text-start text-sm text-ink-2 hover:bg-canvas">
            {t("sales.walkIn")}
          </button>
          {data?.data.map((c) => (
            <button key={c.id} onClick={() => { onPick(c); setOpen(false); }}
              className="w-full rounded-lg px-3 py-2 text-start text-sm font-medium hover:bg-canvas">
              {c.name}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

/* ---------- Payment modal ---------- */
function PaymentModal({ total, methods, customer, onClose, onConfirm }: {
  total: number;
  methods: Method[];
  customer: Customer | null;
  onClose: () => void;
  onConfirm: (payments: Array<{ paymentMethodId: string; amount: number }>, change: number) => Promise<void>;
}) {
  const { t, formatMoney } = useI18n();
  const cash = methods.find((m) => m.kind === "cash");
  const [methodId, setMethodId] = useState(cash?.id ?? methods[0]?.id ?? "");
  const [received, setReceived] = useState(String(Math.ceil(total)));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = methods.find((m) => m.id === methodId);
  const isCredit = selected?.kind === "credit";
  const receivedNum = Number(received || 0);
  const applied = isCredit ? 0 : Math.min(receivedNum, total);
  const change = !isCredit && selected?.kind === "cash" ? Math.max(0, receivedNum - total) : 0;
  const creditNeedsCustomer = (isCredit || applied < total) && !customer;

  async function confirm() {
    setLoading(true); setErr(null);
    try {
      const payments = applied > 0 ? [{ paymentMethodId: methodId, amount: Math.round(applied * 100) / 100 }] : [];
      await onConfirm(payments, change);
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`${t("pos.pay")} — ${formatMoney(total)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {methods.map((m) => (
            <button key={m.id} onClick={() => setMethodId(m.id)}
              className={`rounded-lg border px-2 py-2.5 text-[13px] font-medium transition-colors
                ${m.id === methodId ? "border-accent bg-accent-soft text-accent-strong" : "border-line-2 text-ink-2 hover:bg-canvas"}`}>
              {m.name}
            </button>
          ))}
        </div>
        {!isCredit && (
          <Field label={t("pos.cashReceived")}>
            <Input type="number" min="0" step="0.01" value={received}
              onChange={(e) => setReceived(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && !loading && !creditNeedsCustomer && confirm()} />
          </Field>
        )}
        <div className="space-y-1 rounded-lg bg-canvas p-3 text-sm">
          <div className="flex justify-between"><span className="text-ink-2">{t("common.paid")}</span>
            <span className="num font-medium">{formatMoney(applied)}</span></div>
          {applied < total && (
            <div className="flex justify-between text-warn"><span>{t("common.due")} ({t("sales.unpaid")})</span>
              <span className="num font-medium">{formatMoney(total - applied)}</span></div>
          )}
          {change > 0 && (
            <div className="flex justify-between text-base font-semibold text-ok">
              <span>{t("pos.change")}</span><span className="num">{formatMoney(change)}</span>
            </div>
          )}
        </div>
        {creditNeedsCustomer && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{t("sales.walkIn")} → {t("sales.customer")} ?</p>
        )}
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <Button className="h-11 w-full" loading={loading} disabled={creditNeedsCustomer} onClick={confirm}>
          {t("pos.finalize")}
        </Button>
      </div>
    </Modal>
  );
}
