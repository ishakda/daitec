"use client";
import { Suspense } from "react";
import { PartnerListPage } from "@/components/PartnerPages";
export default function CustomersPage() {
  return <Suspense><PartnerListPage kind="customers" /></Suspense>;
}
