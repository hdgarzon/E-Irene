import { connection } from "next/server";
import { SignupForm } from "@/components/auth/signup-form";

export default async function SignupPage() {
  // Ver comentario en app/(marketing)/page.tsx: la CSP con nonce por request
  // exige render dinámico. Sin esto, /signup se prerenderiza en build (era la
  // única página de (auth) sin una API dinámica que la forzara) y Vercel la
  // sirve cacheada con un nonce que ya no coincide con el header CSP fresco.
  await connection();

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
          Crea tu cuenta
        </h1>
        <p style={{ fontFamily: "var(--font-landing-sans)", fontWeight: 300, fontSize: 14, color: "#46617d" }}>
          Empieza gratis. Sin tarjeta de crédito.
        </p>
      </div>
      <SignupForm />
    </div>
  );
}
