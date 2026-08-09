import { PoolClient } from "pg";
import { computeTotals, round2 } from "../money";
import { ApiError, badRequest, notFound } from "../api";

/**
 * Sales domain service. Every function expects an RLS-scoped client
 * already inside a transaction (withApi provides both), so a sale +
 * items + stock movements + payment + balance updates + audit are
 * atomic — any failure rolls everything back.
 */

export type SaleItemInput = {
  productId: string;
  variantId?: string | null;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
};

export type CreateSaleInput = {
  saleType: "invoice" | "pos" | "proforma";
  customerId?: string | null;
  warehouseId: string;
  branchId?: string | null;
  registerSessionId?: string | null;
  salesOrderId?: string | null;
  deliveryNoteId?: string | null;
  items: SaleItemInput[];
  globalDiscount?: number;
  shipping?: number;
  dueDate?: string | null;
  notes?: string | null;
  /** payments taken immediately (POS or invoice down payment) */
  payments?: Array<{ paymentMethodId: string; amount: number; reference?: string | null }>;
};

export async function createSale(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: CreateSaleInput
) {
  if (!input.items.length) throw badRequest("A sale needs at least one item.");

  const totals = computeTotals({
    lines: input.items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPct: i.discountPct,
      taxRate: i.taxRate,
    })),
    globalDiscount: input.globalDiscount,
    shipping: input.shipping,
  });

  const paymentsTotal = round2((input.payments ?? []).reduce((s, p) => s + p.amount, 0));
  if (paymentsTotal > totals.total) {
    throw new ApiError(400, "OVERPAYMENT", "Payment exceeds the sale total.");
  }
  const isProforma = input.saleType === "proforma";
  const unpaid = round2(totals.total - paymentsTotal);

  // Credit sale checks: credit requires an identified customer.
  if (!isProforma && unpaid > 0 && !input.customerId) {
    throw new ApiError(400, "CREDIT_NEEDS_CUSTOMER", "Credit sales require a customer.");
  }
  if (!isProforma && unpaid > 0 && input.customerId) {
    const c = await db.query(
      `select balance, credit_limit from customers where id = $1 and company_id = $2`,
      [input.customerId, companyId]
    );
    if (!c.rowCount) throw notFound("Customer");
    const { balance, credit_limit } = c.rows[0];
    if (credit_limit != null && Number(balance) + unpaid > Number(credit_limit)) {
      throw new ApiError(409, "CREDIT_LIMIT_EXCEEDED",
        "This sale would exceed the customer's credit limit.");
    }
  }

  const docType = input.saleType === "pos" ? "pos" : input.saleType === "proforma" ? "quotation" : "invoice";
  const num = await db.query(`select next_document_number($1, $2) as n`, [
    companyId, input.saleType === "proforma" ? "invoice" : docType,
  ]);
  const number = (input.saleType === "proforma" ? "PRO" : "") + num.rows[0].n;

  const sale = await db.query(
    `insert into sales (company_id, number, sale_type, customer_id, branch_id, warehouse_id,
        sales_order_id, delivery_note_id, register_session_id, status, payment_status,
        due_date, subtotal, discount_amount, tax_amount, shipping_amount, total, paid_amount, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     returning id, number`,
    [
      companyId, number, input.saleType, input.customerId ?? null, input.branchId ?? null,
      input.warehouseId, input.salesOrderId ?? null, input.deliveryNoteId ?? null,
      input.registerSessionId ?? null,
      isProforma ? "unpaid" : paymentsTotal >= totals.total ? "paid" : paymentsTotal > 0 ? "partial" : "unpaid",
      input.dueDate ?? null,
      totals.subtotal, totals.discountAmount, totals.taxAmount, totals.shippingAmount,
      totals.total, isProforma ? 0 : paymentsTotal, input.notes ?? null, userId,
    ]
  );
  const saleId: string = sale.rows[0].id;

  let totalCost = 0;
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const line = totals.lines[i];

    const prod = await db.query(
      `select p.name, b.avg_cost
       from products p
       left join inventory_balances b on b.product_id = p.id and b.warehouse_id = $3
         and coalesce(b.variant_id,'00000000-0000-0000-0000-000000000000') = coalesce($4::uuid,'00000000-0000-0000-0000-000000000000')
       where p.id = $1 and p.company_id = $2 and p.deleted_at is null`,
      [item.productId, companyId, input.warehouseId, item.variantId ?? null]
    );
    if (!prod.rowCount) throw notFound("Product");
    const unitCost = Number(prod.rows[0].avg_cost ?? 0);
    totalCost = round2(totalCost + unitCost * item.quantity);

    await db.query(
      `insert into sale_items (company_id, sale_id, product_id, variant_id, description,
          quantity, unit_price, discount_pct, tax_rate, unit_cost, line_total, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        companyId, saleId, item.productId, item.variantId ?? null,
        item.description ?? prod.rows[0].name, item.quantity, item.unitPrice,
        item.discountPct ?? 0, item.taxRate ?? 0, unitCost, line.lineTotal, i,
      ]
    );

    if (!isProforma) {
      // Ledger insert — the DB trigger enforces stock rules and updates balances.
      await db.query(
        `insert into stock_movements (company_id, warehouse_id, product_id, variant_id,
            movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
         values ($1,$2,$3,$4,'sale',$5,$6,'sale',$7,$8)`,
        [companyId, input.warehouseId, item.productId, item.variantId ?? null,
         -item.quantity, unitCost, saleId, userId]
      );
    }
  }

  await db.query(`update sales set total_cost = $1 where id = $2`, [totalCost, saleId]);

  // Immediate payments
  if (!isProforma) {
    for (const p of input.payments ?? []) {
      if (p.amount <= 0) continue;
      const pnum = await db.query(`select next_document_number($1,'payment') as n`, [companyId]);
      const pay = await db.query(
        `insert into payments (company_id, number, direction, partner_type, customer_id,
            payment_method_id, register_session_id, amount, reference, created_by)
         values ($1,$2,'in','customer',$3,$4,$5,$6,$7,$8) returning id`,
        [companyId, pnum.rows[0].n, input.customerId ?? null, p.paymentMethodId,
         input.registerSessionId ?? null, round2(p.amount), p.reference ?? null, userId]
      );
      await db.query(
        `insert into payment_allocations (company_id, payment_id, target_type, target_id, amount)
         values ($1,$2,'sale',$3,$4)`,
        [companyId, pay.rows[0].id, saleId, round2(p.amount)]
      );
    }
    // Customer receivable
    if (unpaid > 0 && input.customerId) {
      await db.query(
        `update customers set balance = balance + $1 where id = $2 and company_id = $3`,
        [unpaid, input.customerId, companyId]
      );
    }
  }

  return { saleId, number: sale.rows[0].number, totals, paid: isProforma ? 0 : paymentsTotal, totalCost };
}

export type CreateReturnInput = {
  saleId: string;
  items: Array<{ saleItemId: string; quantity: number }>;
  refund?: { paymentMethodId: string; amount: number } | null;
  registerSessionId?: string | null;
  notes?: string | null;
};

export async function createReturn(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: CreateReturnInput
) {
  const saleQ = await db.query(
    `select * from sales where id = $1 and company_id = $2 and deleted_at is null`,
    [input.saleId, companyId]
  );
  if (!saleQ.rowCount) throw notFound("Sale");
  const sale = saleQ.rows[0];
  if (sale.sale_type === "return" || sale.sale_type === "proforma") {
    throw badRequest("This document cannot be refunded.");
  }
  if (!input.items.length) throw badRequest("Select at least one item to return.");

  // Quantities already returned for this sale
  const returned = await db.query(
    `select si_orig.id as orig_item_id, coalesce(sum(ri.quantity),0) as returned_qty
     from sale_items si_orig
     left join sales r on r.parent_sale_id = si_orig.sale_id and r.sale_type = 'return' and r.status = 'completed'
     left join sale_items ri on ri.sale_id = r.id and ri.product_id = si_orig.product_id
       and coalesce(ri.variant_id,'00000000-0000-0000-0000-000000000000') = coalesce(si_orig.variant_id,'00000000-0000-0000-0000-000000000000')
     where si_orig.sale_id = $1
     group by si_orig.id`,
    [input.saleId]
  );
  const returnedMap = new Map<string, number>(
    returned.rows.map((r) => [r.orig_item_id, Number(r.returned_qty)])
  );

  const num = await db.query(`select next_document_number($1,'credit_note') as n`, [companyId]);
  const ret = await db.query(
    `insert into sales (company_id, number, sale_type, parent_sale_id, customer_id, branch_id,
        warehouse_id, register_session_id, status, payment_status, notes, created_by)
     values ($1,$2,'return',$3,$4,$5,$6,$7,'completed','unpaid',$8,$9)
     returning id, number`,
    [companyId, num.rows[0].n, input.saleId, sale.customer_id, sale.branch_id,
     sale.warehouse_id, input.registerSessionId ?? null, input.notes ?? null, userId]
  );
  const returnId: string = ret.rows[0].id;

  let subtotal = 0, taxAmount = 0, totalCost = 0;
  for (const line of input.items) {
    const itemQ = await db.query(
      `select * from sale_items where id = $1 and sale_id = $2`,
      [line.saleItemId, input.saleId]
    );
    if (!itemQ.rowCount) throw notFound("Sale item");
    const item = itemQ.rows[0];
    const alreadyReturned = returnedMap.get(item.id) ?? 0;
    const returnable = Number(item.quantity) - alreadyReturned;
    if (line.quantity <= 0 || line.quantity > returnable) {
      throw new ApiError(409, "RETURN_QTY_EXCEEDED",
        `Only ${returnable} unit(s) of "${item.description}" can still be returned.`);
    }

    const base = round2(line.quantity * Number(item.unit_price) * (1 - Number(item.discount_pct) / 100));
    const tax = round2(base * Number(item.tax_rate) / 100);
    subtotal = round2(subtotal + base);
    taxAmount = round2(taxAmount + tax);
    totalCost = round2(totalCost + Number(item.unit_cost) * line.quantity);

    await db.query(
      `insert into sale_items (company_id, sale_id, product_id, variant_id, description,
          quantity, unit_price, discount_pct, tax_rate, unit_cost, line_total)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [companyId, returnId, item.product_id, item.variant_id, item.description,
       line.quantity, item.unit_price, item.discount_pct, item.tax_rate, item.unit_cost,
       round2(base + tax)]
    );
    // Goods come back into stock at the cost they left with.
    await db.query(
      `insert into stock_movements (company_id, warehouse_id, product_id, variant_id,
          movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
       values ($1,$2,$3,$4,'sale_return',$5,$6,'sale',$7,$8)`,
      [companyId, sale.warehouse_id, item.product_id, item.variant_id,
       line.quantity, Number(item.unit_cost), returnId, userId]
    );
  }

  const total = round2(subtotal + taxAmount);
  await db.query(
    `update sales set subtotal=$1, tax_amount=$2, total=$3, total_cost=$4 where id=$5`,
    [subtotal, taxAmount, total, totalCost, returnId]
  );

  // Cash refund and/or receivable reduction
  const refundAmount = round2(Math.min(input.refund?.amount ?? 0, total));
  if (input.refund && refundAmount > 0) {
    const pnum = await db.query(`select next_document_number($1,'payment') as n`, [companyId]);
    const pay = await db.query(
      `insert into payments (company_id, number, direction, partner_type, customer_id,
          payment_method_id, register_session_id, amount, notes, created_by)
       values ($1,$2,'out','customer',$3,$4,$5,$6,'Remboursement',$7) returning id`,
      [companyId, pnum.rows[0].n, sale.customer_id, input.refund.paymentMethodId,
       input.registerSessionId ?? null, refundAmount, userId]
    );
    await db.query(
      `insert into payment_allocations (company_id, payment_id, target_type, target_id, amount)
       values ($1,$2,'sale',$3,$4)`,
      [companyId, pay.rows[0].id, returnId, refundAmount]
    );
  }
  // Reduce customer receivable for the non-refunded remainder (credit note)
  const creditToBalance = round2(total - refundAmount);
  if (sale.customer_id && creditToBalance > 0) {
    await db.query(
      `update customers set balance = balance - $1 where id = $2 and company_id = $3`,
      [creditToBalance, sale.customer_id, companyId]
    );
  }
  // Mark the original sale refunded when every unit has come back.
  await db.query(
    `update sales s set payment_status = 'refunded'
     where s.id = $1
       and (select coalesce(sum(quantity),0) from sale_items where sale_id = $1)
           <= (select coalesce(sum(ri.quantity),0)
               from sales r join sale_items ri on ri.sale_id = r.id
               where r.parent_sale_id = $1 and r.sale_type = 'return' and r.status = 'completed')`,
    [input.saleId]
  );

  return { returnId, number: ret.rows[0].number, total, refunded: refundAmount };
}
