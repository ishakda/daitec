import { withApi, pathId } from "@/lib/api";
import { sendTransfer } from "@/lib/domain/inventory";

export const POST = withApi(async ({ req, db, companyId, session, require, audit }) => {
  await require("inventory.transfer");
  const id = pathId(req, 1);
  const result = await sendTransfer(db, companyId, session.userId, id);
  await audit({ action: "send", entityType: "stock_transfer", entityId: id });
  return result;
});
