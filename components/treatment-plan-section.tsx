import { ClipboardCheck, Circle, CheckCircle2 } from "lucide-react";
import type { TreatmentPlan } from "@/lib/db/treatment-plans";
import {
  createPlanAction,
  addItemAction,
  toggleItemAction,
} from "@/app/(app)/patients/[id]/treatment-plan/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const TYPE_LABEL = { objetivo: "Objetivo", checkpoint: "Checkpoint" } as const;

export function TreatmentPlanSection({
  patientId,
  plan,
}: {
  patientId: string;
  plan: TreatmentPlan | null;
}) {
  if (!plan) {
    const create = createPlanAction.bind(null, patientId);
    return (
      <div className="rounded-2xl border border-gray-line bg-card p-6">
        <h2 className="mb-3 flex items-center gap-2 font-heading font-semibold text-navy">
          <ClipboardCheck className="size-4 text-purple" />
          Plan de tratamiento
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Aún no hay un plan de tratamiento activo para este paciente.
        </p>
        <form action={create} className="flex gap-2">
          <Input name="title" placeholder="Título del plan (p. ej. Manejo de ansiedad social)" required />
          <Button type="submit" size="sm">
            Crear plan
          </Button>
        </form>
      </div>
    );
  }

  const addItem = addItemAction.bind(null, plan.id, patientId);

  return (
    <div className="rounded-2xl border border-gray-line bg-card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-heading font-semibold text-navy">
          <ClipboardCheck className="size-4 text-purple" />
          Plan de tratamiento
        </h2>
        <Badge className="bg-purple/15 text-purple capitalize">{plan.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-navy">{plan.title}</p>

      {plan.items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {plan.items.map((item) => {
            const toggle = toggleItemAction.bind(null, item.id, patientId, item.status);
            const done = item.status === "logrado";
            return (
              <li key={item.id} className="flex items-start gap-2 rounded-lg border border-gray-line px-3 py-2">
                <form action={toggle}>
                  <button type="submit" className="mt-0.5" aria-label="Cambiar estado">
                    {done ? (
                      <CheckCircle2 className="size-4 text-mint" />
                    ) : (
                      <Circle className="size-4 text-muted-foreground" />
                    )}
                  </button>
                </form>
                <div className="flex-1">
                  <p className={`text-sm ${done ? "text-muted-foreground line-through" : "text-navy"}`}>
                    {item.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {TYPE_LABEL[item.type]}
                    {item.targetDate && ` · meta: ${new Date(item.targetDate).toLocaleDateString("es-CO")}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form action={addItem} className="mt-4 grid gap-2 sm:grid-cols-[auto_1fr_auto_auto]">
        <select
          name="type"
          defaultValue="objetivo"
          className="flex h-9 rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="objetivo">Objetivo</option>
          <option value="checkpoint">Checkpoint</option>
        </select>
        <Input name="description" placeholder="Descripción" required />
        <Input name="targetDate" type="date" className="sm:w-auto" />
        <Button type="submit" size="sm" variant="outline">
          Agregar
        </Button>
      </form>
    </div>
  );
}
