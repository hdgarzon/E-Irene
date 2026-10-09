"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { submitPqrAction, type PqrState } from "@/app/pqr/actions";
import { PQR_KIND_LABEL, PQR_KINDS } from "@/lib/pqr";
import { POLICY_PATH, SIC_URL } from "@/lib/legal-documents/urls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

export function PqrForm() {
  const [state, formAction, pending] = useActionState<PqrState, FormData>(submitPqrAction, {});

  if (state.receipt) {
    const r = state.receipt;
    return (
      <div className="space-y-4 rounded-2xl border border-mint/40 bg-mint/5 p-6" role="status">
        <p className="flex items-center gap-2 font-heading text-lg font-semibold text-navy">
          <CheckCircle2 className="size-5 text-mint" />
          Solicitud radicada
        </p>
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-muted-foreground">Radicado</dt>
          <dd className="font-mono font-semibold text-navy">{r.radicado}</dd>
          <dt className="text-muted-foreground">Presentada</dt>
          <dd>{r.submittedAt}</dd>
          <dt className="text-muted-foreground">Respuesta a más tardar</dt>
          <dd>{r.dueDate}</dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          Te enviamos esta constancia a {r.email}. Guarda el número de radicado. El plazo de
          respuesta es de quince (15) días hábiles, sin perjuicio de tu derecho a acudir
          directamente a la{" "}
          <a href={SIC_URL} className="text-primary hover:underline">
            Superintendencia de Industria y Comercio
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Tipo de solicitud *</legend>
        <div className="flex flex-wrap gap-3">
          {PQR_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-line px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand/5"
            >
              <input type="radio" name="kind" value={kind} required className="accent-brand" />
              {PQR_KIND_LABEL[kind]}
            </label>
          ))}
        </div>
        <FieldError message={state.fieldErrors?.kind} />
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Nombre completo *</Label>
          <Input id="fullName" name="fullName" required autoComplete="name" />
          <FieldError message={state.fieldErrors?.fullName} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Correo *</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
          <FieldError message={state.fieldErrors?.email} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Teléfono (opcional)</Label>
          <Input id="phone" name="phone" type="tel" autoComplete="tel" />
          <FieldError message={state.fieldErrors?.phone} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="message">Tu solicitud *</Label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          maxLength={5000}
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          No incluyas información clínica tuya ni de tus pacientes: no es necesaria para tramitar la
          solicitud.
        </p>
        <FieldError message={state.fieldErrors?.message} />
      </div>

      {/* Política de tratamiento 3.1 bis: la autorización se otorga al enviar el
          formulario. Sin marcar por defecto. */}
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input type="checkbox" name="dataAuthorization" required className="mt-0.5 size-4 shrink-0 accent-brand" />
        <span>
          Autorizo a E-IRENE S.A.S. a tratar mis datos personales para tramitar y responder esta
          solicitud, conforme a la{" "}
          <Link href={POLICY_PATH} target="_blank" className="text-primary hover:underline">
            Política de Tratamiento de Datos Personales
          </Link>
          .
        </span>
      </label>
      <FieldError message={state.fieldErrors?.dataAuthorization} />

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Radicando…" : "Radicar solicitud"}
      </Button>
    </form>
  );
}
