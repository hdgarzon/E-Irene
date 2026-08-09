"use client";

import { useActionState, useState } from "react";
import { submitVerificationAction, type VerificationState } from "@/app/(app)/verificacion/actions";
import { createClient } from "@/lib/supabase/client";
import {
  ACCEPTED_DOCUMENT_TYPES,
  DOCUMENTS_BUCKET,
  buildDocumentPath,
  validateDocumentFile,
  type DocumentKind,
} from "@/lib/verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

export function VerificationForm({
  clinicId,
  userId,
  resubmit = false,
}: {
  clinicId: string;
  userId: string;
  resubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState<VerificationState, FormData>(
    submitVerificationAction,
    {},
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * Sube los dos archivos a Supabase Storage antes de invocar el action, que
   * solo recibe las rutas. Evita el límite de 1 MB del body de un Server Action
   * y mantiene los bytes fuera del servidor de Next.
   */
  async function handleSubmit(formData: FormData) {
    setUploadError(null);

    const files: Record<DocumentKind, { file: File | null; label: string }> = {
      cedula: { file: formData.get("idDocument") as File | null, label: "tu cédula" },
      tarjeta: {
        file: formData.get("licenseDocument") as File | null,
        label: "tu tarjeta profesional",
      },
    };

    for (const { file, label } of Object.values(files)) {
      const error = validateDocumentFile(file, label);
      if (error) {
        setUploadError(error);
        return;
      }
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const paths: Partial<Record<DocumentKind, string>> = {};

      for (const [kind, { file }] of Object.entries(files) as [
        DocumentKind,
        { file: File },
      ][]) {
        const path = buildDocumentPath({ clinicId, userId, kind, fileName: file.name });
        const { error } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: true });
        if (error) throw error;
        paths[kind] = path;
      }

      // Los archivos ya están arriba: el action solo lleva texto.
      formData.delete("idDocument");
      formData.delete("licenseDocument");
      formData.set("idDocumentPath", paths.cedula!);
      formData.set("licenseDocumentPath", paths.tarjeta!);

      formAction(formData);
    } catch {
      setUploadError("No pudimos subir tus archivos. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  const busy = pending || uploading;

  return (
    <form action={handleSubmit} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="profession">Profesión</Label>
          <Input id="profession" name="profession" required placeholder="Psicología clínica" />
          <FieldError message={state.fieldErrors?.profession} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="licenseNumber">Número de tarjeta profesional</Label>
          <Input id="licenseNumber" name="licenseNumber" required placeholder="123456" />
          <FieldError message={state.fieldErrors?.licenseNumber} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="document">Número de cédula</Label>
        <Input id="document" name="document" required inputMode="numeric" />
        <p className="text-xs text-muted-foreground">
          Se guarda cifrada y solo la usamos para verificar tu habilitación.
        </p>
        <FieldError message={state.fieldErrors?.document} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="idDocument">Cédula (foto o PDF)</Label>
          <Input
            id="idDocument"
            name="idDocument"
            type="file"
            required
            accept={ACCEPTED_DOCUMENT_TYPES.join(",")}
          />
          <FieldError message={state.fieldErrors?.idDocumentPath} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="licenseDocument">Tarjeta profesional (foto o PDF)</Label>
          <Input
            id="licenseDocument"
            name="licenseDocument"
            type="file"
            required
            accept={ACCEPTED_DOCUMENT_TYPES.join(",")}
          />
          <FieldError message={state.fieldErrors?.licenseDocumentPath} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Máximo 5 MB por archivo. Formatos aceptados: JPG, PNG, WEBP o PDF.
      </p>

      <div className="rounded-lg bg-cloud p-4 text-sm text-muted-foreground">
        Al enviar declaro, bajo la gravedad del juramento, que soy profesional de la salud
        habilitado para ejercer en Colombia, que no me encuentro suspendido ni inhabilitado, y
        que los documentos que aporto son auténticos y vigentes.
      </div>

      {(state.error || uploadError) && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {uploadError ?? state.error}
        </p>
      )}

      <Button type="submit" disabled={busy}>
        {uploading
          ? "Subiendo documentos…"
          : pending
            ? "Enviando…"
            : resubmit
              ? "Reenviar documentos"
              : "Enviar para verificación"}
      </Button>
    </form>
  );
}
