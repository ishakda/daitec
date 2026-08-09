import { makeSimpleCrud, nameSchema } from "@/lib/simpleCrud";
const crud = makeSimpleCrud({
  table: "brands", entityType: "brand",
  viewPerm: "products.view", managePerm: "products.edit",
  columns: { name: "name" }, schema: nameSchema.partial(),
});
export const PATCH = crud.update;
export const DELETE = crud.remove;
