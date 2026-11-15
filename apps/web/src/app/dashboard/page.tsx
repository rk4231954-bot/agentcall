import type { Metadata } from "next";
import { Dashboard } from "@/components/app/dashboard";

export const metadata: Metadata = { title: "Dashboard · agentcall" };

export default function Page() {
  return <Dashboard />;
}
