import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE: Record<StatusTone, string> = {
  neutral: "border-gray-line bg-cloud text-muted-foreground",
  info: "border-info-border bg-info-soft text-brand",
  success: "border-success-border bg-success-soft text-success",
  warning: "border-warning-border bg-warning-soft text-warning",
  danger: "border-danger-border bg-danger-soft text-destructive",
};

const DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground/60",
  info: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/** Etiqueta de estado con colores que pasan AA sobre su propio fondo. */
export function StatusBadge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}
