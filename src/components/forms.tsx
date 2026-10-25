"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions/auth";

export function Submit({ children, className = "btn btn-primary", pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${className} disabled:opacity-60`} disabled={pending} aria-busy={pending}>
      {pending ? (pendingText ?? "Salvando…") : children}
    </button>
  );
}

/** Formulário ligado a uma Server Action com retorno { error | message }. */
export function ActionForm({
  action,
  children,
  className = "grid gap-4",
  resetOnSuccess = false,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.message) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className} noValidate>
      {children}
      <div aria-live="polite" className="min-h-0">
        {state?.error && <p className="rounded-lg bg-loss-soft px-3 py-2 text-sm text-loss">{state.error}</p>}
        {state?.message && <p className="rounded-lg bg-gain-soft px-3 py-2 text-sm text-gain">{state.message}</p>}
      </div>
    </form>
  );
}

export function ConfirmButton({ children, message, className = "text-sm text-loss underline-offset-2 hover:underline" }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
