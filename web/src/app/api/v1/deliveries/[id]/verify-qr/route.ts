import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";

const schema = z.object({ token: z.string().min(8).max(120) });

/** Parse "DAITEC:CUST:<uuid>" or a bare uuid. */
function extractToken(raw: string): string | null {
  const m = raw.trim().match(/(?:DAITEC:CUST:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Verify a scanned customer QR against this delivery's customer.
 * Read-only (used for instant feedback at scan time); the delivered
 * status call re-verifies and stamps qr_verified_at.
 */
export const POST = withApi(async ({ req, db, companyId, session, can, require }) => {
  await require("deliveries.update_status");
  const id = pathId(req, 1);
  const { token } = await parseBody(req, schema);

  const d = await db.query(
    `select d.courier_id, d.customer_id, c.name as customer_name, c.qr_token
     from deliveries d left join customers c on c.id = d.customer_id
     where d.id = $1 and d.company_id = $2 and d.deleted_at is null`,
    [id, companyId]);
  if (!d.rowCount) throw notFound("Delivery");
  const row = d.rows[0];
  if (!(await can("deliveries.assign")) && row.courier_id !== session.userId) throw notFound("Delivery");
  if (!row.customer_id) {
    throw new ApiError(409, "NO_CUSTOMER", "This delivery has no identified customer to verify.");
  }
  const scanned = extractToken(token);
  if (!scanned || scanned !== String(row.qr_token).toLowerCase()) {
    throw new ApiError(409, "QR_MISMATCH", "This QR code does not belong to this delivery's customer.");
  }
  return { ok: true, customerName: row.customer_name };
});
