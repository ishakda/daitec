"use client";
/**
 * Offline POS engine — IndexedDB catalog cache + sale queue + sync drain.
 *
 * Stores (db "daitec-pos"):
 *  - catalog: active products (searchable offline, barcodes included)
 *  - queue:   sales captured offline, keyed by idempotencyKey, FIFO drain
 *  - conflicts: items the server rejected on business rules (for review)
 *
 * Guarantees:
 *  - a transaction is NEVER lost: it stays in `queue` until the server
 *    confirms `applied` (or records a `conflict`);
 *  - a transaction is NEVER duplicated: the server dedupes on
 *    (company, deviceId, idempotencyKey).
 */

export type CatalogItem = {
  id: string; sku: string; name: string;
  selling_price: string; tax_rate: string; stock: string; barcodes: string[];
};
export type QueuedSale = {
  idempotencyKey: string;
  deviceId: string;
  queuedAt: string;
  localNumber: string;
  total: number;
  payload: Record<string, unknown>;
};
export type ConflictItem = QueuedSale & { error: string };

const DB_NAME = "daitec-pos";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog", { keyPath: "id" });
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "idempotencyKey" });
      if (!db.objectStoreNames.contains("conflicts")) db.createObjectStore("conflicts", { keyPath: "idempotencyKey" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export function deviceId(): string {
  let id = localStorage.getItem("daitec_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("daitec_device_id", id);
  }
  return id;
}

/* ---------------- catalog cache ---------------- */
export async function cacheCatalog(items: CatalogItem[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("catalog", "readwrite");
    const s = t.objectStore("catalog");
    s.clear();
    for (const item of items) s.put(item);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  await tx("meta", "readwrite", (s) => s.put({ key: "catalogAt", value: new Date().toISOString() }));
}

export async function offlineLookup(q: string, limit = 12): Promise<CatalogItem[]> {
  const all = await tx<CatalogItem[]>("catalog", "readonly", (s) => s.getAll());
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  // exact barcode first
  const byBarcode = all.filter((p) => p.barcodes?.some((b) => b === q.trim()));
  if (byBarcode.length) return byBarcode.slice(0, limit);
  return all
    .filter((p) => p.name.toLowerCase().includes(needle) || p.sku?.toLowerCase().includes(needle))
    .sort((a, b) => a.name.toLowerCase().indexOf(needle) - b.name.toLowerCase().indexOf(needle))
    .slice(0, limit);
}

export async function catalogCount(): Promise<number> {
  return tx<number>("catalog", "readonly", (s) => s.count());
}

/* ---------------- offline queue ---------------- */
export async function enqueueSale(payload: Record<string, unknown>, total: number): Promise<QueuedSale> {
  const n = await tx<number>("queue", "readonly", (s) => s.count());
  const item: QueuedSale = {
    idempotencyKey: crypto.randomUUID(),
    deviceId: deviceId(),
    queuedAt: new Date().toISOString(),
    localNumber: `HL-${String(n + 1).padStart(3, "0")}`,
    total,
    payload,
  };
  await tx("queue", "readwrite", (s) => s.put(item));
  return item;
}

export async function pendingSales(): Promise<QueuedSale[]> {
  const all = await tx<QueuedSale[]>("queue", "readonly", (s) => s.getAll());
  return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function conflictSales(): Promise<ConflictItem[]> {
  return tx<ConflictItem[]>("conflicts", "readonly", (s) => s.getAll());
}

export async function discardConflict(key: string) {
  await tx("conflicts", "readwrite", (s) => s.delete(key));
}

/* ---------------- sync engine ---------------- */
let draining = false;

export type DrainResult = { applied: number; conflicts: number; remaining: number };

export async function drainQueue(): Promise<DrainResult> {
  if (draining) return { applied: 0, conflicts: 0, remaining: (await pendingSales()).length };
  draining = true;
  let applied = 0, conflicts = 0;
  try {
    const items = await pendingSales();
    for (const item of items) {
      let res: Response;
      try {
        res = await fetch("/api/v1/pos/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deviceId: item.deviceId,
            idempotencyKey: item.idempotencyKey,
            queuedAt: item.queuedAt,
            operation: "create_sale",
            payload: item.payload,
          }),
        });
      } catch {
        break; // still offline — stop draining, keep everything queued
      }

      if (res.ok) {
        await tx("queue", "readwrite", (s) => s.delete(item.idempotencyKey));
        applied++;
        continue;
      }
      const body = await res.json().catch(() => null);
      const code = body?.error?.code;
      if (res.status === 409 && code === "SYNC_CONFLICT") {
        // Business rule rejected the sale — move to conflicts, record server-side.
        await tx("conflicts", "readwrite", (s) =>
          s.put({ ...item, error: body.error.message ?? "conflict" }));
        await tx("queue", "readwrite", (s) => s.delete(item.idempotencyKey));
        conflicts++;
        fetch("/api/v1/pos/sync/conflict", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deviceId: item.deviceId, idempotencyKey: item.idempotencyKey,
            error: body.error.message ?? "conflict", queuedAt: item.queuedAt, payload: item.payload,
          }),
        }).catch(() => {});
        continue;
      }
      if (res.status === 401 || res.status === 403) break; // session issue — stop, retry after login
      // 5xx / unknown: stop and retry later, order preserved
      break;
    }
  } finally {
    draining = false;
  }
  return { applied, conflicts, remaining: (await pendingSales()).length };
}
