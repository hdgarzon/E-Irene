"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { setPlanConfigAction, type ActionState } from "@/app/admin/actions";
import type { PlanConfig } from "@/lib/db/platform-console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AdminPlanForm({ plan }: { plan: PlanConfig }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    setPlanConfigAction.bind(null, plan.plan),
    {},
  );

  return (
    <form action={formAction} className="space-y-3 rounded-2xl border border-gray-line bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {plan.plan}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`label-${plan.plan}`}>Título</Label>
          <Input id={`label-${plan.plan}`} name="label" defaultValue={plan.label} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`price-${plan.plan}`}>Precio</Label>
          <Input id={`price-${plan.plan}`} name="price" defaultValue={plan.price} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`desc-${plan.plan}`}>Descripción</Label>
        <Textarea
          id={`desc-${plan.plan}`}
          name="description"
          rows={2}
          defaultValue={plan.description}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </Button>
        {state.ok && (
          <span className="flex items-center gap-1 text-xs text-mint">
            <Check className="size-3.5" /> Guardado
          </span>
        )}
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </form>
  );
}
