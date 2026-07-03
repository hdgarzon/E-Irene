import { getPlanConfigs } from "@/lib/db/platform-console";
import { AdminPlanForm } from "@/components/admin-plan-form";

export default async function AdminPlanesPage() {
  const plans = await getPlanConfigs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-navy">Planes</h1>
        <p className="text-sm text-muted-foreground">
          Título, descripción y precio de cada plan (se muestran a las clínicas). Los límites de
          uso se configuran en código por seguridad de facturación.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((p) => (
          <AdminPlanForm key={p.plan} plan={p} />
        ))}
      </div>
    </div>
  );
}
