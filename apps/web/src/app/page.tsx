import { greet } from "@agentcall/shared";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiPhone01Icon } from "@hugeicons/core-free-icons";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8">
      <HugeiconsIcon icon={AiPhone01Icon} size={48} strokeWidth={1.5} className="text-indigo-500" />
      <h1 className="text-4xl font-semibold tracking-tight">agentcall</h1>
      <p className="text-neutral-500">{greet("web")}</p>
    </main>
  );
}
