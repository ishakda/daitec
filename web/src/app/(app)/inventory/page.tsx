"use client";
import { useState, useEffect } from "react";
import { useI18n } from "@/components/I18nProvider";
import { useApi, apiFetch, useMe, ClientApiError } from "@/lib/client";
import { Button, Card, Badge, Select, Input, Field, Modal, EmptyState, TableSkeleton } from "@/components/ui";
import { DataTable, Pagination, Column } from "@/components/DataTable";
import { SlidersHorizontal, ArrowLeftRight } from "lucide-react";

type BalanceRow = { product_id: string; sku: string; name: string; minimum_stock: string; quantity: string; stock_value?: string };
type MovementRow = { id: string; movement_type: string; quantity: string; unit_cost: string; created_at: string; product_name: string; sku: string; warehouse_name: string; created_by_name: string | null; notes: string | null };
type TransferRow = { id: string; number: string; status: string; from_warehouse: string; to_warehouse: string; item_count: number; created_at: string };
type Warehouse = { id: string; name: string; is_default: boolean };

export default function InventoryPage() {
  const { t, formatMoney, formatDateTime } = useI18n();
  const { can } = useMe();
  const [tab, setTab] = useState<"stock" | "movements" | "transfers">("stock");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const { data: warehouses } = useApi<{ data: Warehouse[] }>("/warehouses");

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedQ(q); setPage(1); }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const stockQuery = new URLSearchParams({ page: String(page), limit: "50" });
  if (warehouseId) stockQuery.set("warehouseId", warehouseId);
  if (debouncedQ) stockQuery.set("q", debouncedQ);
  const { data: stock, isLoading: stockLoading, mutate: mutateStock } =
    useApi<{ data: BalanceRow[]; totalValue: string | null }>(tab === "stock" ? `/inventory?${stockQuery}` : null);

  const mvQuery = new URLSearchParams({ page: String(page), limit: "50" });
  if (warehouseId) mvQuery.set("warehouseId", warehouseId);
  const { data: movements, isLoading: mvLoading } =
    useApi<{ data: MovementRow[] }>(tab === "movements" ? `/inventory/movements?${mvQuery}` : null);

  const { data: transfers, isLoading: trLoading, mutate: mutateTransfers } =
    useApi<{ data: TransferRow[] }>(tab === "transfers" ? `/inventory/transfers?page=${page}` : null);

  const stockCols: Column<BalanceRow>[] = [
    { key: "name", header: t("common.name"), render: (r) => (
      <div><p className="font-medium">{r.name}</p><p className="text-xs text-ink-3">{r.sku}</p></div>
    )},
    { key: "quantity", header: t("products.stock"), align: "end", render: (r) => {
      const qty = Number(r.quantity), min = Number(r.minimum_stock);
      return <Badge tone={qty <= 0 ? "danger" : min > 0 && qty <= min ? "warn" : "ok"}><span className="num">{qty}</span></Badge>;
    }},
    ...(stock?.data.some((r) => r.stock_value != null) ? [{
      key: "stock_value", header: t("inventory.stockValue"), align: "end" as const,
      render: (r: BalanceRow) => <span className="num">{r.stock_value != null ? formatMoney(r.stock_value) : "—"}</span>,
    }] : []),
  ];

  const mvTone: Record<string, "ok" | "danger" | "warn" | "info" | "neutral"> = {
    purchase_receipt: "ok", sale_return: "ok", adjustment_in: "ok", initial: "info", transfer_in: "info",
    sale: "danger", purchase_return: "warn", adjustment_out: "warn", transfer_out: "info", damage: "danger", loss: "danger", count: "neutral",
  };
  const mvCols: Column<MovementRow>[] = [
    { key: "created_at", header: t("common.date"), render: (r) => <span className="text-[13px]">{formatDateTime(r.created_at)}</span> },
    { key: "product_name", header: t("nav.products"), render: (r) => (
      <div><p className="font-medium">{r.product_name}</p><p className="text-xs text-ink-3">{r.warehouse_name}</p></div>
    )},
    { key: "movement_type", header: t("inventory.kind"), render: (r) => (
      <Badge tone={mvTone[r.movement_type] ?? "neutral"}>{r.movement_type}</Badge>
    )},
    { key: "quantity", header: t("common.quantity"), align: "end", render: (r) => (
      <span className={`num font-medium ${Number(r.quantity) > 0 ? "text-ok" : "text-danger"}`}>
        {Number(r.quantity) > 0 ? "+" : ""}{Number(r.quantity)}
      </span>
    )},
    { key: "created_by_name", header: t("audit.user"), render: (r) => r.created_by_name ?? "—" },
  ];

  const trCols: Column<TransferRow>[] = [
    { key: "number", header: t("common.number"), render: (r) => <span className="num font-medium">{r.number}</span> },
    { key: "route", header: t("common.warehouse"), render: (r) => `${r.from_warehouse} → ${r.to_warehouse}` },
    { key: "item_count", header: t("common.items"), align: "end", render: (r) => <span className="num">{r.item_count}</span> },
    { key: "status", header: t("common.status"), render: (r) => (
      <Badge tone={r.status === "received" ? "ok" : r.status === "in_transit" ? "warn" : "neutral"}>
        {t(`inventory.${r.status === "in_transit" ? "inTransit" : r.status}`)}
      </Badge>
    )},
    { key: "actions", header: "", align: "end", render: (r) => (
      <TransferActions transfer={r} onDone={() => { mutateTransfers(); }} />
    )},
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t("inventory.title")}</h1>
        <div className="flex gap-2">
          {can("inventory.transfer") && (
            <Button variant="secondary" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight size={15} /> {t("inventory.newTransfer")}
            </Button>
          )}
          {can("inventory.adjust") && (
            <Button onClick={() => setAdjustOpen(true)}>
              <SlidersHorizontal size={15} /> {t("inventory.adjust")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {(["stock", "movements", "transfers"] as const).map((tb) => (
            <button key={tb} onClick={() => { setTab(tb); setPage(1); }}
              className={`rounded-md px-3.5 py-1.5 text-[13px] font-medium ${tab === tb ? "bg-navy text-white" : "text-ink-2 hover:bg-canvas"}`}>
              {tb === "stock" ? t("products.stock") : t(`inventory.${tb}`)}
            </button>
          ))}
        </div>
        {tab !== "transfers" && (
          <Select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }} className="max-w-[200px]">
            <option value="">{t("common.all")} — {t("common.warehouse")}</option>
            {warehouses?.data.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        )}
        {tab === "stock" && stock?.totalValue != null && (
          <span className="ms-auto text-sm text-ink-2">
            {t("inventory.stockValue")}: <span className="num font-semibold text-ink">{formatMoney(stock.totalValue)}</span>
          </span>
        )}
      </div>

      <Card pad={false}>
        {tab === "stock" && (
          <>
            <div className="border-b border-line p-3">
              <Input placeholder={t("products.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            </div>
            {stockLoading && !stock ? <TableSkeleton /> :
              !stock?.data.length ? <EmptyState title={t("common.noResults")} /> : (
                <>
                  <DataTable columns={stockCols} rows={stock.data.map((r) => ({ ...r, id: r.product_id }))} />
                  <Pagination page={page} setPage={setPage} hasMore={(stock?.data.length ?? 0) >= 50} />
                </>
              )}
          </>
        )}
        {tab === "movements" && (
          mvLoading && !movements ? <TableSkeleton /> :
          !movements?.data.length ? <EmptyState title={t("inventory.empty")} /> : (
            <>
              <DataTable columns={mvCols} rows={movements.data} />
              <Pagination page={page} setPage={setPage} hasMore={(movements?.data.length ?? 0) >= 50} />
            </>
          )
        )}
        {tab === "transfers" && (
          trLoading && !transfers ? <TableSkeleton /> :
          !transfers?.data.length ? <EmptyState title={t("common.none")} /> : (
            <DataTable columns={trCols} rows={transfers.data} />
          )
        )}
      </Card>

      {adjustOpen && (
        <AdjustModal warehouses={warehouses?.data ?? []} onClose={() => setAdjustOpen(false)}
          onDone={() => { setAdjustOpen(false); mutateStock(); }} />
      )}
      {transferOpen && (
        <TransferModal warehouses={warehouses?.data ?? []} onClose={() => setTransferOpen(false)}
          onDone={() => { setTransferOpen(false); setTab("transfers"); mutateTransfers(); }} />
      )}
    </div>
  );
}

function TransferActions({ transfer, onDone }: { transfer: TransferRow; onDone: () => void }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  if (transfer.status === "received" || transfer.status === "cancelled") return null;
  const action = transfer.status === "draft" ? "send" : "receive";
  return (
    <Button variant="secondary" className="h-7 px-2.5 text-xs" loading={loading}
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try { await apiFetch(`/inventory/transfers/${transfer.id}/${action}`, { method: "POST" }); onDone(); }
        catch { /* surfaced via list refresh */ }
        finally { setLoading(false); }
      }}>
      {t(`inventory.${action}`)}
    </Button>
  );
}

function AdjustModal({ warehouses, onClose, onDone }: {
  warehouses: Warehouse[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? "");
  const [productQ, setProductQ] = useState("");
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [results, setResults] = useState<Array<{ id: string; name: string; stock: string }>>([]);
  const [kind, setKind] = useState("adjustment_in");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!productQ.trim() || product) { setResults([]); return; }
    const id = setTimeout(async () => {
      try {
        const r = await apiFetch<{ data: Array<{ id: string; name: string; stock: string }> }>(
          `/products/lookup?q=${encodeURIComponent(productQ)}&warehouseId=${warehouseId}`);
        setResults(r.data);
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(id);
  }, [productQ, product, warehouseId]);

  async function submit() {
    if (!product) return;
    setLoading(true); setErr(null);
    try {
      await apiFetch("/inventory/adjustments", {
        method: "POST",
        json: {
          warehouseId, productId: product.id, kind,
          quantity: Number(quantity), unitCost: unitCost !== "" ? Number(unitCost) : null,
          notes: notes || null,
        },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("inventory.adjust")}>
      <div className="space-y-4">
        <Field label={t("common.warehouse")}>
          <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label={t("nav.products")} required>
          <div className="relative">
            <Input value={product?.name ?? productQ}
              onChange={(e) => { setProduct(null); setProductQ(e.target.value); }} autoFocus />
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-pop">
                {results.map((r) => (
                  <button key={r.id} onClick={() => { setProduct(r); setResults([]); }}
                    className="flex w-full justify-between px-3 py-2 text-start text-sm hover:bg-canvas">
                    <span className="font-medium">{r.name}</span>
                    <span className="num text-ink-3">{Number(r.stock)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("inventory.kind")}>
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="adjustment_in">{t("inventory.in")}</option>
              <option value="adjustment_out">{t("inventory.out")}</option>
              <option value="damage">{t("inventory.damage")}</option>
              <option value="loss">{t("inventory.loss")}</option>
              <option value="count">{t("inventory.count")}</option>
              <option value="initial">{t("inventory.initial")}</option>
            </Select>
          </Field>
          <Field label={t("common.quantity")} required>
            <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
        </div>
        {["adjustment_in", "initial"].includes(kind) && (
          <Field label={t("inventory.avgCost")} hint={t("common.optional")}>
            <Input type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </Field>
        )}
        <Field label={t("common.notes")}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} disabled={!product || quantity === ""} onClick={submit}>{t("common.confirm")}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TransferModal({ warehouses, onClose, onDone }: {
  warehouses: Warehouse[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [fromId, setFromId] = useState(warehouses[0]?.id ?? "");
  const [toId, setToId] = useState(warehouses[1]?.id ?? "");
  const [lines, setLines] = useState<Array<{ productId: string; name: string; quantity: number }>>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; stock: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const id = setTimeout(async () => {
      try {
        const r = await apiFetch<{ data: Array<{ id: string; name: string; stock: string }> }>(
          `/products/lookup?q=${encodeURIComponent(q)}&warehouseId=${fromId}`);
        setResults(r.data);
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(id);
  }, [q, fromId]);

  async function submit() {
    setLoading(true); setErr(null);
    try {
      await apiFetch("/inventory/transfers", {
        method: "POST",
        json: { fromWarehouseId: fromId, toWarehouseId: toId, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ClientApiError ? e.message : t("common.errorGeneric"));
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("inventory.newTransfer")} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("inventory.fromWarehouse")}>
            <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label={t("inventory.toWarehouse")}>
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="relative">
          <Input placeholder={t("products.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface shadow-pop">
              {results.map((r) => (
                <button key={r.id} onClick={() => {
                    setLines((ls) => [...ls, { productId: r.id, name: r.name, quantity: 1 }]);
                    setQ(""); setResults([]);
                  }}
                  className="flex w-full justify-between px-3 py-2 text-start text-sm hover:bg-canvas">
                  <span className="font-medium">{r.name}</span>
                  <span className="num text-ink-3">{Number(r.stock)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="flex-1 text-sm font-medium">{l.name}</span>
            <Input type="number" min="0.001" step="any" value={l.quantity}
              onChange={(e) => setLines((ls) => ls.map((x, idx) => idx === i ? { ...x, quantity: Number(e.target.value) || 0 } : x))}
              className="!w-24 text-end" />
            <button onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="text-ink-3 hover:text-danger">✕</button>
          </div>
        ))}
        {err && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button loading={loading} disabled={!lines.length || fromId === toId} onClick={submit}>{t("common.create")}</Button>
        </div>
      </div>
    </Modal>
  );
}
