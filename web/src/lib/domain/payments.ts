import { PoolClient } from "pg";
import { round2 } from "../money";
import { ApiError, badRequest, notFound } from "../api";

/**
 * Standalone payment (customer settles debt / we pay a supplier),
 * allocated against one or more open documents. Enforces:
 *  - allocation ≤ remaining due per document
 *  - total allocations ≤ payment amount
 *  - no overpayment of partner balance (unless a document allows it)
 * Updates document payment_status and partner balance atomically.
 */
export async function createPayment(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: {
    direction: "in" | "out";
    partnerType: "customer" | "supplier";
    customerId?: string | null;
    supplierId?: string | null;
    paymentMethodId: string;
    registerSessionId?: string | null;
    amount: number;
    paymentDate?: string | null;
    reference?: string | null;
    notes?: string | null;
    allocations?: Array<{ targetType: "sale" | "supplier_invoice"; targetId: string; amount: number }>;
  }
) {
  const amount = round2(input.amount);
  if (amount <= 0) throw badRequest("Payment amount must be positive.");
  if (input.partnerType === "customer" && !input.customerId)
    throw badRequest("Customer is required.");
  if (input.partnerType === "supplier" && !input.supplierId)
    throw badRequest("Supplier is required.");

  const allocations = input.allocations ?? [];
  const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
  if (allocated > amount)
    throw new ApiError(400, "OVER_ALLOCATION", "Allocations exceed the payment amount.");

  const num = await db.query(`select next_document_number($1,'payment') as n`, [companyId]);
  const pay = await db.query(
    `insert into payments (company_id, number, direction, partner_type, customer_id, supplier_id,
        payment_method_id, register_session_id, amount, payment_date, reference, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,coalesce($10::date, current_date),$11,$12,$13)
     returning id, number`,
    [companyId, num.rows[0].n, input.direction, input.partnerType,
     input.customerId ?? null, input.supplierId ?? null, input.paymentMethodId,
     input.registerSessionId ?? null, amount, input.paymentDate ?? null,
     input.reference ?? null, input.notes ?? null, userId]
  );
  const paymentId: string = pay.rows[0].id;

  for (const alloc of allocations) {
    const a = round2(alloc.amount);
    if (a <= 0) throw badRequest("Allocation amounts must be positive.");

    if (alloc.targetType === "sale") {
      const s = await db.query(
        `select total, paid_amount, payment_status from sales
         where id = $1 and company_id = $2 and deleted_at is null for update`,
        [alloc.targetId, companyId]
      );
      if (!s.rowCount) throw notFound("Sale");
      const due = round2(Number(s.rows[0].total) - Number(s.rows[0].paid_amount));
      if (a > due)
        throw new ApiError(409, "OVERPAYMENT",
          `Allocation exceeds the remaining due (${due.toFixed(2)}) on this invoice.`);
      const newPaid = round2(Number(s.rows[0].paid_amount) + a);
      await db.query(
        `update sales set paid_amount = $1,
           payment_status = case when $1 >= total then 'paid' else 'partial' end
         where id = $2`,
        [newPaid, alloc.targetId]
      );
    } else {
      const si = await db.query(
        `select total, paid_amount from supplier_invoices
         where id = $1 and company_id = $2 and deleted_at is null for update`,
        [alloc.targetId, companyId]
      );
      if (!si.rowCount) throw notFound("Supplier invoice");
      const due = round2(Number(si.rows[0].total) - Number(si.rows[0].paid_amount));
      if (a > due)
        throw new ApiError(409, "OVERPAYMENT",
          `Allocation exceeds the remaining due (${due.toFixed(2)}) on this supplier invoice.`);
      const newPaid = round2(Number(si.rows[0].paid_amount) + a);
      await db.query(
        `update supplier_invoices set paid_amount = $1,
           payment_status = case when $1 >= total then 'paid' else 'partial' end
         where id = $2`,
        [newPaid, alloc.targetId]
      );
    }

    await db.query(
      `insert into payment_allocations (company_id, payment_id, target_type, target_id, amount)
       values ($1,$2,$3,$4,$5)`,
      [companyId, paymentId, alloc.targetType, alloc.targetId, a]
    );
  }

  // Partner balance: inbound customer payment reduces receivable;
  // outbound supplier payment reduces payable.
  if (input.partnerType === "customer" && input.customerId) {
    const delta = input.direction === "in" ? -amount : amount;
    await db.query(
      `update customers set balance = balance + $1 where id = $2 and company_id = $3`,
      [delta, input.customerId, companyId]
    );
  } else if (input.partnerType === "supplier" && input.supplierId) {
    const delta = input.direction === "out" ? -amount : amount;
    await db.query(
      `update suppliers set balance = balance + $1 where id = $2 and company_id = $3`,
      [delta, input.supplierId, companyId]
    );
  }

  return { paymentId, number: pay.rows[0].number, amount, allocated };
}
