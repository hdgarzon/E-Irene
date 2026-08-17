import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const { redirect } = await searchParams;
  return (
    <div className="space-y-6 text-center">
      <div className="space-y-1.5">
        <h1
          style={{
            fontFamily: "var(--font-landing-serif)",
            fontWeight: 400,
            fontSize: 30,
            letterSpacing: "-0.5px",
            color: "#12283f",
          }}
        >
          Bienvenido de vuelta
        </h1>
        <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 14, color: "#46617d" }}>
          Ingresa a tu cuenta de E-Irene
        </p>
      </div>
      <LoginForm redirect={redirect ?? "/dashboard"} />
    </div>
  );
}
