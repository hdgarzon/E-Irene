import Link from "next/link";

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">El enlace ya no es válido</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        El enlace de activación expiró o ya fue usado. Vuelve a registrarte para recibir uno
        nuevo.
      </p>
      <Link href="/signup" className="font-medium text-primary hover:underline">
        Volver al registro
      </Link>
    </div>
  );
}
