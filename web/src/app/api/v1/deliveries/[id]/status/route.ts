import { z } from "zod";
import { withApi, parseBody, pathId, notFound, ApiError } from "@/lib/api";
import { round2 } from "@/lib/money";

/**
 * Delivery status transitions with validation. On "delivered":
 *  - stamps delivered_at
 *  - settles COD through the payments engine (cash method), allocated
 *    to the sale, updating paid_amount + customer balance atomically.
 */
const schema = z.object({
  status: z.enum(["picked_up", "out_for_delivery", "delivered", "failed", "cancelled"]),
  failureReason: z.string().max(300).nullish(),
  codCollected: z.boolean().default(true),
  // Proof of delivery: compressed data-URLs captured on the courier page.
  proofs: z.array(z.object({
    kind: z.enum(["photo", "signature"]),
    data: z.string().startsWith("data:image/").max(1_000_000),
  })).max(4).default([]),
  // Scanned customer QR (raw payload or bare uuid) — verified server-side.
  qrToken: z.string().max(120).nullish(),
});

function extractQr(raw: string): string | null {
  const m = raw.trim().match(/(?:DAITEC:CUST:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1].toLowerCase() : null;
}

const ALLOWED: Record<string, string[]> = {
  pending: ["cancelled"],
  assigned: ["picked_up", "out_for_delivery", "failed", "cancelled"],
  picked_up: ["out_for_delivery", "delivered", "failed", "cancelled"],
  out_for_delivery: ["delivered", "failed"],
};

export const POST = withApi(async ({ req, db, companyId, session, can, require, audit }) => {
  await require("deliveries.update_status");
  const id = pathId(req, 1);
  const body = await parseBody(req, schema);

  const d = await db.query(
    `select * from deliveries where id = $1 and company_id = $2 and deleted_at is null for update`,
    [id, companyId]);
  if (!d.rowCount) throw notFound("Delivery");
  const delivery = d.rows[0];

  // Couriers may only update their own deliveries.
  if (!(await can("deliveries.assign")) && delivery.courier_id !== session.userId) {
    throw notFound("Delivery");
  }
  const allowed = ALLOWED[delivery.status] ?? [];
  if (!allowed.includes(body.status)) {
    throw new ApiError(409, "INVALID_TRANSITION",
      `Cannot go from "${delivery.status}" to "${body.status}".`);
  }
  if (body.status === "failed" && !body.failureReason) {
    throw new ApiError(400, "REASON_REQUIRED", "A failure reason is required.");
  }

  const stamp: Record<string, string> = {
    picked_up: "picked_up_at", out_for_delivery: "out_at", delivered: "delivered_at",
  };

  // Customer QR verification (optional, stamped when it matches).
  let qrVerified = false;
  if (body.qrToken && body.status === "delivered" && delivery.customer_id) {
    const c = await db.query(`select qr_token from customers where id = $1`, [delivery.customer_id]);
    const scanned = extractQr(body.qrToken);
    if (!scanned || !c.rowCount || scanned !== String(c.rows[0].qr_token).toLowerCase()) {
      throw new ApiError(409, "QR_MISMATCH", "This QR code does not belong to this delivery's customer.");
    }
    qrVerified = true;
  }

  let codPaymentId: string | null = null;
  const cod = round2(Number(delivery.cod_amount));
  if (body.status === "delivered" && body.codCollected && cod > 0 && delivery.sale_id) {
    // Guard against over-collection if the sale was partially paid meanwhile.
    const s = await db.query(
      `select customer_id, total, paid_amount from sales where id = $1 for update`, [delivery.sale_id]);
    if (s.rowCount) {
      const due = round2(Number(s.rows[0].total) - Number(s.rows[0].paid_amount));
      const amount = Math.min(cod, due);
      if (amount > 0) {
        const cash = await db.query(
          `select id from payment_methods where company_id = $1 and kind = 'cash' and is_active limit 1`,
          [companyId]);
        if (cash.rowCount) {
          const pnum = await db.query(`select next_document_number($1,'payment') as n`, [companyId]);
          const pay = await db.query(
            `insert into payments (company_id, number, direction, partner_type, customer_id,
                payment_method_id, amount, notes, created_by)
             values ($1,$2,'in','customer',$3,$4,$5,$6,$7) returning id`,
            [companyId, pnum.rows[0].n, s.rows[0].customer_id, cash.rows[0].id, amount,
             `COD ${delivery.number}`, session.userId]
          );
          codPaymentId = pay.rows[0].id;
          await db.query(
            `insert into payment_allocations (company_id, payment_id, target_type, target_id, amount)
             values ($1,$2,'sale',$3,$4)`,
            [companyId, codPaymentId, delivery.sale_id, amount]
          );
          const newPaid = round2(Number(s.rows[0].paid_amount) + amount);
          await db.query(
            `update sales set paid_amount = $1,
               payment_status = case when $1 >= total then 'paid' else 'partial' end
             where id = $2`,
            [newPaid, delivery.sale_id]
          );
          if (s.rows[0].customer_id) {
            await db.query(
              `update customers set balance = balance - $1 where id = $2 and company_id = $3`,
              [amount, s.rows[0].customer_id, companyId]
            );
          }
        }
      }
    }
  }

  // Attach proof of delivery (append-only evidence) on terminal statuses.
  if (body.proofs.length && ["delivered", "failed"].includes(body.status)) {
    for (const proof of body.proofs) {
      await db.query(
        `insert into delivery_proofs (company_id, delivery_id, kind, data, created_by)
         values ($1,$2,$3,$4,$5)`,
        [companyId, id, proof.kind, proof.data, session.userId]
      );
    }
  }

  await db.query(
    `update deliveries set status = $1,
       failure_reason = $2,
       cod_payment_id = coalesce($3, cod_payment_id)
       ${qrVerified ? ", qr_verified_at = now()" : ""}
       ${stamp[body.status] ? `, ${stamp[body.status]} = now()` : ""}
     where id = $4`,
    [body.status, body.status === "failed" ? body.failureReason : null, codPaymentId, id]
  );
  await audit({
    action: "update_status", entityType: "delivery", entityId: id, entityLabel: delivery.number,
    oldValues: { status: delivery.status },
    newValues: { status: body.status, codPaymentId, failureReason: body.failureReason ?? undefined,
      proofs: body.proofs.map((p) => p.kind), qrVerified: qrVerified || undefined },
  });
  return { ok: true, status: body.status, codPaymentId, qrVerified };
});
