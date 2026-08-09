import { PoolClient } from "pg";
import { computeTotals, round2 } from "../money";
import { ApiError, badRequest, notFound } from "../api";

export type PurchaseItemInput = {
  productId: string;
  variantId?: string | null;
  description?: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  taxRate?: number;
};

export async function createPurchaseOrder(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: {
    supplierId: string;
    warehouseId?: string | null;
    expectedDate?: string | null;
    items: PurchaseItemInput[];
    globalDiscount?: number;
    shipping?: number;
    notes?: string | null;
  }
) {
  if (!input.items.length) throw badRequest("A purchase order needs at least one item.");
  const totals = computeTotals({
    lines: input.items.map((i) => ({
      quantity: i.quantity, unitPrice: i.unitPrice,
      discountPct: i.discountPct, taxRate: i.taxRate,
    })),
    globalDiscount: input.globalDiscount, shipping: input.shipping,
  });

  const num = await db.query(`select next_document_number($1,'purchase_order') as n`, [companyId]);
  const po = await db.query(
    `insert into purchase_orders (company_id, number, supplier_id, warehouse_id, status,
        expected_date, subtotal, discount_amount, tax_amount, shipping_amount, total, notes, created_by)
     values ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12) returning id, number`,
    [companyId, num.rows[0].n, input.supplierId, input.warehouseId ?? null,
     input.expectedDate ?? null, totals.subtotal, totals.discountAmount, totals.taxAmount,
     totals.shippingAmount, totals.total, input.notes ?? null, userId]
  );
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const p = await db.query(
      `select name from products where id = $1 and company_id = $2 and deleted_at is null`,
      [item.productId, companyId]
    );
    if (!p.rowCount) throw notFound("Product");
    await db.query(
      `insert into purchase_order_items (company_id, purchase_order_id, product_id, variant_id,
          description, quantity, unit_price, discount_pct, tax_rate, line_total, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [companyId, po.rows[0].id, item.productId, item.variantId ?? null,
       item.description ?? p.rows[0].name, item.quantity, item.unitPrice,
       item.discountPct ?? 0, item.taxRate ?? 0, totals.lines[i].lineTotal, i]
    );
  }
  return { purchaseOrderId: po.rows[0].id, number: po.rows[0].number, totals };
}

/**
 * Goods receipt: brings stock in (ledger movements → weighted avg cost),
 * supports partial reception against a PO, updates received quantities,
 * PO status and product last purchase price. Optionally creates the
 * supplier invoice (payable) in the same transaction.
 */
export async function receiveGoods(
  db: PoolClient,
  companyId: string,
  userId: string,
  input: {
    purchaseOrderId?: string | null;
    supplierId: string;
    warehouseId: string;
    items: Array<{
      purchaseOrderItemId?: string | null;
      productId: string;
      variantId?: string | null;
      quantity: number;
      unitCost: number;
    }>;
    createSupplierInvoice?: boolean;
    dueDate?: string | null;
    supplierRef?: string | null;
    notes?: string | null;
  }
) {
  if (!input.items.length) throw badRequest("A goods receipt needs at least one item.");

  const num = await db.query(`select next_document_number($1,'goods_receipt') as n`, [companyId]);
  const gr = await db.query(
    `insert into goods_receipts (company_id, number, purchase_order_id, supplier_id, warehouse_id, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, number`,
    [companyId, num.rows[0].n, input.purchaseOrderId ?? null, input.supplierId,
     input.warehouseId, input.notes ?? null, userId]
  );
  const receiptId: string = gr.rows[0].id;

  let totalValue = 0;
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    if (item.quantity <= 0) throw badRequest("Received quantity must be positive.");
    if (item.unitCost < 0) throw badRequest("Unit cost cannot be negative.");

    const p = await db.query(
      `select name from products where id = $1 and company_id = $2 and deleted_at is null`,
      [item.productId, companyId]
    );
    if (!p.rowCount) throw notFound("Product");

    // Over-reception guard against the PO line
    if (item.purchaseOrderItemId) {
      const poi = await db.query(
        `select quantity, received_qty from purchase_order_items where id = $1 and purchase_order_id = $2`,
        [item.purchaseOrderItemId, input.purchaseOrderId]
      );
      if (!poi.rowCount) throw notFound("Purchase order line");
      const remaining = Number(poi.rows[0].quantity) - Number(poi.rows[0].received_qty);
      if (item.quantity > remaining) {
        throw new ApiError(409, "OVER_RECEPTION",
          `Only ${remaining} unit(s) remain to receive on this order line.`);
      }
      await db.query(
        `update purchase_order_items set received_qty = received_qty + $1 where id = $2`,
        [item.quantity, item.purchaseOrderItemId]
      );
    }

    await db.query(
      `insert into goods_receipt_items (company_id, goods_receipt_id, purchase_order_item_id,
          product_id, variant_id, description, quantity, unit_cost, position)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [companyId, receiptId, item.purchaseOrderItemId ?? null, item.productId,
       item.variantId ?? null, p.rows[0].name, item.quantity, item.unitCost, i]
    );

    await db.query(
      `insert into stock_movements (company_id, warehouse_id, product_id, variant_id,
          movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
       values ($1,$2,$3,$4,'purchase_receipt',$5,$6,'goods_receipt',$7,$8)`,
      [companyId, input.warehouseId, item.productId, item.variantId ?? null,
       item.quantity, item.unitCost, receiptId, userId]
    );

    // Track last purchase price on the product
    await db.query(
      `update products set purchase_price = $1 where id = $2 and company_id = $3`,
      [item.unitCost, item.productId, companyId]
    );

    totalValue = round2(totalValue + item.quantity * item.unitCost);
  }

  // Update PO status
  if (input.purchaseOrderId) {
    await db.query(
      `update purchase_orders po set status = (
         case when not exists (
           select 1 from purchase_order_items where purchase_order_id = po.id and received_qty < quantity
         ) then 'received' else 'partially_received' end
       ) where po.id = $1 and po.company_id = $2`,
      [input.purchaseOrderId, companyId]
    );
  }

  // Optional supplier invoice (payable)
  let supplierInvoice: { id: string; number: string; total: number } | null = null;
  if (input.createSupplierInvoice) {
    const sinum = await db.query(`select next_document_number($1,'supplier_invoice') as n`, [companyId]);
    const si = await db.query(
      `insert into supplier_invoices (company_id, number, supplier_ref, purchase_order_id,
          goods_receipt_id, supplier_id, due_date, subtotal, total, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning id, number`,
      [companyId, sinum.rows[0].n, input.supplierRef ?? null, input.purchaseOrderId ?? null,
       receiptId, input.supplierId, input.dueDate ?? null, totalValue, userId]
    );
    for (const item of input.items) {
      const p = await db.query(`select name from products where id = $1`, [item.productId]);
      await db.query(
        `insert into supplier_invoice_items (company_id, supplier_invoice_id, product_id, variant_id,
            description, quantity, unit_price, line_total)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [companyId, si.rows[0].id, item.productId, item.variantId ?? null,
         p.rows[0]?.name ?? "Article", item.quantity, item.unitCost,
         round2(item.quantity * item.unitCost)]
      );
    }
    await db.query(
      `update suppliers set balance = balance + $1 where id = $2 and company_id = $3`,
      [totalValue, input.supplierId, companyId]
    );
    supplierInvoice = { id: si.rows[0].id, number: si.rows[0].number, total: totalValue };
  }

  return { receiptId, number: gr.rows[0].number, totalValue, supplierInvoice };
}
