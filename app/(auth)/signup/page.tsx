import { SignupForm } from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="font-heading text-2xl font-bold text-navy">Crea tu cuenta</h1>
        <p className="text-sm text-muted-foreground">
          Empieza gratis. Sin tarjeta de crédito.
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
