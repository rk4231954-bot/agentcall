import { Suspense } from "react";
import { OAuthCallback } from "@/components/app/oauth-callback";

export default function Page() {
  return (
    <Suspense>
      <OAuthCallback provider="slack" />
    </Suspense>
  );
}
