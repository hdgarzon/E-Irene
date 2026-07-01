"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createPatient, updatePatient } from "@/lib/db/patients";
import { getClinicOverview } from "@/lib/db/clinic";
import { canAddPatient, limitLabel, PLANS } from "@/lib/plans";
import { logAudit } from "@/lib/db/audit";
import type { PatientInput } from "@/lib/db/patient-mappers";

export type PatientFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

const patientSchema = z.object({
  fullName: z.string().min(2, "Ingresa el nombre del paciente"),
  document: z.string().optional(),
  phone: z.string().optional(),
  email: z.union([z.literal(""), z.email("Correo inválido")]).optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  notes: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  history: z.string().optional(),
});

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function toInput(data: z.infer<typeof patientSchema>): PatientInput {
  const clean = (v?: string) => (v && v.trim() !== "" ? v.trim() : null);
  return {
    fullName: data.fullName.trim(),
    document: clean(data.document),
    phone: clean(data.phone),
    email: clean(data.email),
    birthDate: clean(data.birthDate),
    gender: clean(data.gender),
    notes: clean(data.notes),
    emergencyContactName: clean(data.emergencyContactName),
    emergencyContactPhone: clean(data.emergencyContactPhone),
    emergencyContactRelationship: clean(data.emergencyContactRelationship),
    history: clean(data.history),
  };
}

function parseForm(formData: FormData) {
  return patientSchema.safeParse({
    fullName: formData.get("fullName"),
    document: formData.get("document"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    birthDate: formData.get("birthDate"),
    gender: formData.get("gender"),
    notes: formData.get("notes"),
    emergencyContactName: formData.get("emergencyContactName"),
    emergencyContactPhone: formData.get("emergencyContactPhone"),
    emergencyContactRelationship: formData.get("emergencyContactRelationship"),
    history: formData.get("history"),
  });
}

export async function createPatientAction(
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const overview = await getClinicOverview();
  if (!canAddPatient(overview.plan, overview.patientCount)) {
    return {
      error: `Alcanzaste el límite de ${limitLabel(
        PLANS[overview.plan].maxPatients,
      )} pacientes del plan ${PLANS[overview.plan].label}. Mejora tu plan en Configuración.`,
    };
  }

  let patientId: string;
  try {
    const patient = await createPatient(user.clinicId, user.id, toInput(parsed.data));
    patientId = patient.id;
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "patient.created",
      entityType: "patient",
      entityId: patient.id,
    });
  } catch {
    return { error: "No se pudo crear el paciente. Intenta de nuevo." };
  }

  revalidatePath("/patients");
  redirect(`/patients/${patientId}`);
}

export async function updatePatientAction(
  patientId: string,
  _prev: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    await updatePatient(patientId, toInput(parsed.data));
    await logAudit({
      clinicId: user.clinicId,
      actorId: user.id,
      action: "patient.updated",
      entityType: "patient",
      entityId: patientId,
    });
  } catch {
    return { error: "No se pudo actualizar el paciente." };
  }

  revalidatePath(`/patients/${patientId}`);
  redirect(`/patients/${patientId}`);
}
