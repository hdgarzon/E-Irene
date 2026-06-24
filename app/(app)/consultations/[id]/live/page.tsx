import { notFound, redirect } from "next/navigation";
import { getConsultation } from "@/lib/db/consultations";
import { LiveConsultation } from "@/components/live-consultation";

export default async function LiveConsultationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const consultation = await getConsultation(id);
  if (!consultation) notFound();
  // Si ya terminó, no se puede volver a grabar.
  if (consultation.status !== "in_progress") redirect(`/consultations/${id}`);

  return <LiveConsultation consultationId={id} patientName={consultation.patientName} />;
}
