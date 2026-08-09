"use client";
import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

const DispatchMap = dynamic(() => import("./DispatchMap"), {
  ssr: false,
  loading: () => <Spinner />,
});

export default function MapPage() {
  return <DispatchMap />;
}
