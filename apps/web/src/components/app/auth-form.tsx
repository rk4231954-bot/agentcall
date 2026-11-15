"use client";

import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Singularity } from "@/components/singularity";
import { api, ApiError, errorMessage, type User } from "@/lib/api";
import { Banner, Button, Card, ease, Input } from "./ui";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [banner, setBanner] = useState<string>();

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading(true);
    setError(null);
    setBanner(undefined);
    try {
      const { user } = await api<{ user: User }>(`/auth/${mode}`, {
        body: Object.fromEntries(form.entries()),
      });
      const next = params.get("next");
      router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : user.onboarded ? "/dashboard" : "/onboarding");
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError && err.code === "validation_failed") setError(err);
      else setBanner(errorMessage(err));
    }
  };

  const signup = mode === "signup";
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-12">
      <Backdrop />
      <motion.div
        initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease }}
        className="relative w-full max-w-[400px]"
      >
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-2.5 text-sm font-semibold tracking-tight">
          <Singularity size={26} />
          agentcall
        </Link>
        <Card className="p-7 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{signup ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1.5 text-sm text-neutral-400">
            {signup ? "Your agents are a few steps away." : "Sign in to your agents."}
          </p>
          <form onSubmit={submit} className="mt-7 space-y-4" noValidate>
            {signup && (
              <Input label="Name" name="name" autoComplete="name" placeholder="Ada Lovelace" required error={error?.field("name")} autoFocus />
            )}
            <Input
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              error={error?.field("email")}
              autoFocus={!signup}
            />
            <Input
              label="Password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
              placeholder={signup ? "At least 8 characters" : "••••••••"}
              hint={signup ? "8+ characters" : undefined}
              required
              minLength={signup ? 8 : undefined}
              error={error?.field("password")}
              trailing={
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="grid size-8 place-items-center rounded-lg text-neutral-500 transition-colors hover:text-white"
                  aria-label={show ? "Hide password" : "Show password"}
                >
                  <HugeiconsIcon icon={show ? ViewOffSlashIcon : ViewIcon} size={18} />
                </button>
              }
            />
            <Banner>{banner}</Banner>
            <Button type="submit" loading={loading} className="mt-2 w-full">
              {signup ? "Create account" : "Sign in"}
            </Button>
          </form>
        </Card>
        <p className="mt-6 text-center text-sm text-neutral-500">
          {signup ? "Already have an account? " : "New to agentcall? "}
          <Link
            href={`${signup ? "/login" : "/signup"}${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}
            className="font-medium text-neutral-200 transition-colors hover:text-gold"
          >
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </motion.div>
    </main>
  );
}

/** The faint glow of the landing page's black hole, behind auth and onboarding. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0">
      <div className="absolute left-1/2 top-[-30vmin] size-[110vmin] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(246_195_91_/_0.10),rgb(232_137_44_/_0.04)_45%,transparent_72%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255_/_0.035)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_at_top,#000_20%,transparent_70%)]" />
    </div>
  );
}
