"use client";

import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export const ease = [0.22, 0.8, 0.24, 1] as const;

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`animate-spin ${className}`} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type ButtonProps = HTMLMotionProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
  children?: ReactNode;
};

const variants = {
  primary: "bg-white text-black hover:bg-neutral-200 cta",
  secondary: "border border-white/12 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.07]",
  ghost: "text-neutral-400 hover:text-white",
  danger: "border border-red-500/30 text-red-300 hover:border-red-400/60 hover:bg-red-500/10",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", loading, disabled, className = "", children, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      disabled={disabled || loading}
      className={`relative inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${variants[variant]} ${className}`}
      {...props}
    >
      <span className={`inline-flex items-center gap-2 transition-opacity ${loading ? "opacity-0" : ""}`}>{children}</span>
      {loading && <Spinner className="absolute" />}
    </motion.button>
  );
});

export function FieldError({ message }: { message?: string }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease }}
          className="overflow-hidden text-[13px] text-red-300"
          role="alert"
        >
          <span className="block pt-1.5">{message}</span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

const fieldClass =
  "w-full rounded-xl border bg-white/[0.03] px-3.5 text-[15px] text-white placeholder:text-neutral-600 outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:bg-white/[0.05] focus:border-gold/60 focus:shadow-[0_0_0_4px_rgb(246_195_91_/_0.12)]";

type FieldProps = { label: string; hint?: ReactNode; error?: string; trailing?: ReactNode };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input(
  { label, hint, error, trailing, className = "", id, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-neutral-300">
        {label}
        {hint && <span className="text-xs font-normal text-neutral-500">{hint}</span>}
      </label>
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          className={`${fieldClass} h-11 ${trailing ? "pr-11" : ""} ${error ? "border-red-400/50" : "border-white/10"}`}
          {...props}
        />
        {trailing && <div className="absolute inset-y-0 right-1.5 flex items-center">{trailing}</div>}
      </div>
      <FieldError message={error} />
    </div>
  );
});

export function Textarea({
  label,
  hint,
  error,
  className = "",
  id,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-neutral-300">
        {label}
        {hint && <span className="text-xs font-normal text-neutral-500">{hint}</span>}
      </label>
      <textarea
        id={inputId}
        aria-invalid={Boolean(error)}
        className={`${fieldClass} min-h-24 resize-y py-3 leading-relaxed ${error ? "border-red-400/50" : "border-white/10"}`}
        {...props}
      />
      <FieldError message={error} />
    </div>
  );
}

export function Banner({ tone = "error", children }: { tone?: "error" | "info" | "success"; children?: ReactNode }) {
  const tones = {
    error: "border-red-500/25 bg-red-500/[0.07] text-red-200",
    info: "border-white/10 bg-white/[0.03] text-neutral-300",
    success: "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-200",
  };
  return (
    <AnimatePresence initial={false}>
      {children && (
        <motion.div
          initial={{ opacity: 0, y: -6, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -6, height: 0 }}
          transition={{ duration: 0.25, ease }}
          className="overflow-hidden"
          role={tone === "error" ? "alert" : "status"}
        >
          <div className={`rounded-xl border px-3.5 py-2.5 text-sm ${tones[tone]}`}>{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A check that draws itself. */
export function Check({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, ease }}
      />
    </svg>
  );
}

export function Card({ className = "", children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      className={`rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.045] to-white/[0.015] shadow-[0_30px_80px_-30px_rgb(0_0_0_/_0.9)] ${className}`}
    >
      {children}
    </div>
  );
}
