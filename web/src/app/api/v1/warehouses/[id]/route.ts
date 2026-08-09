import { z } from "zod";
import { makeSimpleCrud } from "@/lib/simpleCrud";
const schema = z.object({
  name: z.string().min(1).max(120),
  branchId: z.string().uuid().nullish(),
  address: z.string().max(300).nullish(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).partial();
const crud = makeSimpleCrud({
  table: "warehouses", entityType: "warehouse",
  viewPerm: "inventory.view", managePerm: "settings.manage",
  columns: { name: "name", branchId: "branch_id", address: "address", isDefault: "is_default", isActive: "is_active" },
  schema,
});
export const PATCH = crud.update;
export const DELETE = crud.remove;
