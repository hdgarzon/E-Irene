import { ClipboardCheck, Circle, CheckCircle2 } from "lucide-react";
import type { TreatmentPlan } from "@/lib/db/treatment-plans";
import {
  createPlanAction,
  addItemAction,
  toggleItemAction,
  setApproachAction,
} from "@/app/(app)/patients/[id]/treatment-plan/actions";
import { THERAPEUTIC_APPROACHES, APPROACH_LABEL } from "@/lib/treatment-approach";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

const TYPE_LABEL = { objetivo: "Objetivo", checkpoint: "Checkpoint" } as const;

const SELECT_CLASS =
  "flex h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring sm:w-auto";

function ApproachSelect({ name, defaultValue }: { name: string; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={SELECT_CLASS}>
      <option value="">Enfoque terapéutico (opcional)</option>
      {THERAPEUTIC_APPROACHES.map((a) => (
        <option key={a} value={a}>
          {APPROACH_LABEL[a]}
        </option>
      ))}
    </select>
  );
}

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
      <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-navy">
          <ClipboardCheck className="size-4 text-brand" />
          Plan de tratamiento
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Aún no hay un plan de tratamiento activo para este paciente.
        </p>
        <form action={create} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input name="title" placeholder="Título del plan (p. ej. Manejo de ansiedad social)" required />
          <ApproachSelect name="approach" />
          <Button type="submit">
            Crear plan
          </Button>
        </form>
      </div>
    );
  }

  const addItem = addItemAction.bind(null, plan.id, patientId);
  const updateApproach = setApproachAction.bind(null, plan.id, patientId);

  return (
    <div className="rounded-2xl border border-gray-line bg-card p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-navy">
          <ClipboardCheck className="size-4 text-brand" />
          Plan de tratamiento
        </h2>
        <StatusBadge tone="info" className="capitalize">{plan.status}</StatusBadge>
      </div>
      <p className="mt-1 text-sm text-navy">{plan.title}</p>
      {plan.approach && (
        <p className="mt-1 text-xs text-muted-foreground">
          Enfoque: <span className="text-navy">{APPROACH_LABEL[plan.approach]}</span>
        </p>
      )}
      <form action={updateApproach} className="mt-2 flex items-center gap-2">
        <ApproachSelect name="approach" defaultValue={plan.approach ?? undefined} />
        <Button type="submit" size="sm" variant="outline">
          Guardar enfoque
        </Button>
      </form>

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
                      <CheckCircle2 className="size-4 text-success" />
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

      <form action={addItem} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
        <select
          name="type"
          defaultValue="objetivo"
          className={SELECT_CLASS}
        >
          <option value="objetivo">Objetivo</option>
          <option value="checkpoint">Checkpoint</option>
        </select>
        <Input name="description" placeholder="Descripción" required />
        <Input name="targetDate" type="date" className="sm:w-auto" />
        <Button type="submit" variant="outline">
          Agregar
        </Button>
      </form>
    </div>
  );
}
