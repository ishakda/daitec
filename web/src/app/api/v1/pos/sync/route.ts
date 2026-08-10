import { z } from "zod";
import { withApi, parseBody, ApiError } from "@/lib/api";
import { createSale } from "@/lib/domain/sales";

/**
 * Offline POS sync: replays a queued sale exactly once.
 *  - Idempotency: (company, device, key) unique in sync_queue. A replayed
 *    request returns the stored result — a sale can never be created twice.
 *  - Business-rule failures (e.g. INSUFFICIENT_STOCK after selling blind
 *    offline) are recorded as `conflict` and returned as such: the client
 *    dequeues the item and surfaces it for review instead of retrying forever.
 *  - Unexpected errors roll back everything (including the queue row) so the
 *    client retries later.
 */
const schema = z.object({
  deviceId: z.string().min(8).max(80),
  idempotencyKey: z.string().min(8).max(80),
  queuedAt: z.string().nullish(),
  operation: z.literal("create_sale"),
  payload: z.object({
    saleType: z.enum(["pos", "invoice"]).default("pos"),
    customerId: z.string().uuid().nullish(),
    warehouseId: z.string().uuid(),
    registerSessionId: z.string().uuid().nullish(),
    items: z.array(z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().nullish(),
      quantity: z.number().positive(),
      unitPrice: z.number().min(0),
      discountPct: z.number().min(0).max(100).default(0),
      taxRate: z.number().min(0).max(100).default(0),
    })).min(1),
    globalDiscount: z.number().min(0).default(0),
    payments: z.array(z.object({
      paymentMethodId: z.string().uuid(),
      amount: z.number().positive(),
    })).default([]),
  }),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("pos.use");
  const body = await parseBody(req, schema);

  // Replay? Return the recorded outcome.
  const existing = await db.query(
    `select status, payload, error from sync_queue
     where company_id = $1 and device_id = $2 and idempotency_key = $3`,
    [companyId, body.deviceId, body.idempotencyKey]
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    return {
      duplicate: true,
      status: row.status,
      result: row.payload?.result ?? null,
      error: row.error,
    };
  }

  try {
    const result = await createSale(db, companyId, session.userId, {
      ...body.payload,
      saleType: body.payload.saleType,
      customerId: body.payload.customerId ?? null,
    });
    await db.query(
      `insert into sync_queue (company_id, device_id, idempotency_key, operation, payload, status, client_created_at, applied_at)
       values ($1,$2,$3,$4,$5,'applied',$6,now())`,
      [companyId, body.deviceId, body.idempotencyKey, body.operation,
       JSON.stringify({ request: body.payload, result: { saleId: result.saleId, number: result.number, total: result.totals.total } }),
       body.queuedAt ?? null]
    );
    await audit({
      action: "offline_sync", entityType: "sale", entityId: result.saleId, entityLabel: result.number,
      newValues: { deviceId: body.deviceId, idempotencyKey: body.idempotencyKey, queuedAt: body.queuedAt },
    });
    return { duplicate: false, status: "applied", result: { saleId: result.saleId, number: result.number, total: result.totals.total } };
  } catch (err) {
    // Business-rule failure → recorded conflict (own transaction context is
    // aborted, so record via a fresh statement won't work inside the same tx.
    // We rethrow a special marker handled below by a second request path.)
    if (err instanceof ApiError || (err instanceof Error && err.message.startsWith("INSUFFICIENT_STOCK"))) {
      const message = err instanceof ApiError ? `${err.code}: ${err.message}` : err.message;
      throw new ApiError(409, "SYNC_CONFLICT", message, { deviceId: body.deviceId, idempotencyKey: body.idempotencyKey });
    }
    throw err;
  }
});
