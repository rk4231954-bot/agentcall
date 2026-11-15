import type { Metadata } from "next";
import { Suspense } from "react";
import { Onboarding } from "@/components/app/onboarding";

export const metadata: Metadata = { title: "Set up · agentcall" };

export default function Page() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}
