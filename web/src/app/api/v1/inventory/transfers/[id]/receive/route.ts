import { withApi, pathId } from "@/lib/api";
import { receiveTransfer } from "@/lib/domain/inventory";

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("inventory.transfer");
  const id = pathId(req, 1);
  const result = await receiveTransfer(db, companyId, session.userId, id);
  await audit({ action: "receive", entityType: "stock_transfer", entityId: id });
  return result;
});
