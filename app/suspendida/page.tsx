import { AlertOctagon } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export default function SuspendedPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-cloud px-4 text-center">
      <AlertOctagon className="size-10 text-destructive" />
      <h1 className="font-heading text-2xl font-bold text-navy">Cuenta suspendida</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        El acceso de tu clínica a E-Irene está temporalmente suspendido. Si crees que es un
        error, comunícate con el administrador de la plataforma.
      </p>
      <form action={signOutAction}>
        <Button type="submit" variant="outline">
          Cerrar sesión
        </Button>
      </form>
    </div>
  );
}
