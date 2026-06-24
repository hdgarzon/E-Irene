import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-bold text-navy">Bienvenido de vuelta</h1>
        <p className="text-sm text-muted-foreground">Ingresa a tu cuenta de E-Irene</p>
      </div>
      <LoginForm redirect={redirect ?? "/dashboard"} />
    </div>
  );
}
