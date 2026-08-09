"use client";
import { Suspense } from "react";
import { PartnerListPage } from "@/components/PartnerPages";
export default function SuppliersPage() {
  return <Suspense><PartnerListPage kind="suppliers" /></Suspense>;
}
