import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { confirmAction } from "./actions";

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash, type, next } = await searchParams;

  if (!token_hash || !type) {
    redirect("/auth/auth-code-error");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Confirma tu cuenta</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Por seguridad, confirma manualmente para activar tu cuenta y continuar.
      </p>
      <form action={confirmAction}>
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <Button type="submit">Confirmar cuenta</Button>
      </form>
    </div>
  );
}
