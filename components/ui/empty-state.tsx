import { cn } from "@/lib/utils";

/** Estado vacío: qué falta, por qué importa y la acción para resolverlo. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 py-6" : "gap-3 rounded-2xl border border-dashed border-gray-line bg-card px-6 py-12",
        className,
      )}
    >
      <span className={cn("grid place-items-center rounded-full bg-info-soft", compact ? "size-10" : "size-12")}>
        <Icon className={cn("text-brand", compact ? "size-5" : "size-6")} />
      </span>
      <div className="space-y-1">
        <h3 className="font-semibold text-navy">{title}</h3>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
