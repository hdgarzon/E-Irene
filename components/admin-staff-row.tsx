"use client";

import { useActionState, useState, useTransition } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import {
  updateStaffAction,
  deleteStaffAction,
  type ActionState,
} from "@/app/admin/actions";
import type { AdminStaff } from "@/lib/db/platform-console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  doctor: "Doctor",
  secretaria: "Secretaría",
};

export function AdminStaffRow({ staff }: { staff: AdminStaff }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    updateStaffAction.bind(null, staff.id),
    {},
  );
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (state.ok && editing) setEditing(false);

  function onDelete() {
    if (!confirm(`¿Eliminar la cuenta de ${staff.fullName}? Esta acción no se puede deshacer.`)) return;
    setDeleteError(null);
    startDelete(async () => {
      const res = await deleteStaffAction(staff.id);
      if (res?.error) setDeleteError(res.error);
    });
  }

  if (editing) {
    return (
      <li className="py-3">
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <Input name="fullName" defaultValue={staff.fullName} className="w-48" required />
          <select
            name="role"
            defaultValue={staff.role}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="admin">Admin</option>
            <option value="doctor">Doctor</option>
            <option value="secretaria">Secretaría</option>
          </select>
          <span className="text-xs text-muted-foreground">{staff.email}</span>
          <Button type="submit" size="sm" disabled={pending}>
            <Check className="size-3.5" /> Guardar
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <X className="size-3.5" />
          </Button>
          {state.error && <span className="text-xs text-destructive">{state.error}</span>}
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="font-medium text-navy">{staff.fullName}</p>
        <p className="text-xs text-muted-foreground">
          {staff.email} · {staff.clinicName}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge className="bg-muted text-foreground/70">{ROLE_LABEL[staff.role] ?? staff.role}</Badge>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" /> Editar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={deletePending}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
        {deleteError && <span className="text-xs text-destructive">{deleteError}</span>}
      </div>
    </li>
  );
}
