import { cn } from "@/lib/utils";
import type { StatusTone } from "@/components/ui/status-badge";

const TONE: Record<StatusTone, { box: string; icon: string; title: string }> = {
  neutral: { box: "border-gray-line bg-card", icon: "text-muted-foreground", title: "text-navy" },
  info: { box: "border-info-border bg-info-soft", icon: "text-brand", title: "text-navy" },
  success: { box: "border-success-border bg-success-soft", icon: "text-success", title: "text-navy" },
  warning: { box: "border-warning-border bg-warning-soft", icon: "text-warning", title: "text-warning" },
  danger: { box: "border-danger-border bg-danger-soft", icon: "text-destructive", title: "text-destructive" },
};

/**
 * Aviso en bloque. El tono comunica severidad: `danger` se reserva para riesgo
 * clínico y errores; un descargo informativo va en `info` o `neutral`, para
 * que el rojo no pierda significado.
 */
export function Callout({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  className,
  ...props
}: {
  tone?: StatusTone;
  icon?: React.ComponentType<{ className?: string }>;
  title?: React.ReactNode;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<"div">, "title">) {
  const t = TONE[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm", t.box, className)} {...props}>
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", t.icon)} />}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className={cn("font-semibold", t.title)}>{title}</p>}
        {children && <div className="text-foreground/85">{children}</div>}
      </div>
    </div>
  );
}
