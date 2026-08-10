import { z } from "zod";
import { withApi, parseBody } from "@/lib/api";

/**
 * Records an offline-sale conflict (e.g. INSUFFICIENT_STOCK discovered at
 * sync time) in sync_queue for manager review. Separate endpoint because
 * the failed sale's transaction rolls back entirely.
 */
const schema = z.object({
  deviceId: z.string().min(8).max(80),
  idempotencyKey: z.string().min(8).max(80),
  error: z.string().max(500),
  queuedAt: z.string().nullish(),
  payload: z.unknown(),
});

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("pos.use");
  const body = await parseBody(req, schema);
  await db.query(
    `insert into sync_queue (company_id, device_id, idempotency_key, operation, payload, status, error, client_created_at)
     values ($1,$2,$3,'create_sale',$4,'conflict',$5,$6)
     on conflict (company_id, device_id, idempotency_key) do nothing`,
    [companyId, body.deviceId, body.idempotencyKey,
     JSON.stringify({ request: body.payload }), body.error, body.queuedAt ?? null]
  );
  await audit({
    action: "offline_conflict", entityType: "sale", entityLabel: body.idempotencyKey.slice(0, 8),
    newValues: { deviceId: body.deviceId, error: body.error },
  });
  return { ok: true };
});
