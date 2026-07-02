import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { Patient } from "@/lib/db/patient-mappers";
import type { Consent } from "@/lib/db/consents";
import type { Consultation } from "@/lib/db/consultations";
import type { PatientSessionReport } from "@/lib/db/reports";
import type { SoapNote } from "@/lib/db/soap-notes";
import type { Assessment } from "@/lib/db/assessments";
import type { TreatmentPlan } from "@/lib/db/treatment-plans";
import { ASSESSMENT_LABEL, ASSESSMENT_MAX_SCORE } from "@/lib/psychometrics";

export interface PatientRecordData {
  patient: Patient;
  clinicName: string;
  consent: Consent | null;
  consultations: Consultation[];
  reportsByConsultation: Map<string, PatientSessionReport>;
  soapNotesByConsultation: Map<string, SoapNote>;
  assessments: Assessment[];
  treatmentPlan: TreatmentPlan | null;
  generatedAt: string;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#0a2540", lineHeight: 1.5 },
  brandBar: { height: 4, backgroundColor: "#635bff", marginBottom: 16 },
  h1: { fontSize: 18, fontWeight: 700, color: "#0a2540" },
  meta: { fontSize: 9, color: "#5b6b7c", marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: "#635bff", marginTop: 18, marginBottom: 6 },
  subTitle: { fontSize: 10, fontWeight: 700, color: "#0a2540", marginTop: 10, marginBottom: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  label: { color: "#5b6b7c" },
  box: { backgroundColor: "#f0f4f8", borderRadius: 4, padding: 8, marginTop: 4 },
  riskBox: {
    backgroundColor: "#fff1f1",
    border: "1px solid #ff6b6b",
    borderRadius: 4,
    padding: 6,
    marginTop: 4,
  },
  sessionBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid #e3e8ee",
  },
  footer: {
    marginTop: 20,
    paddingTop: 10,
    borderTop: "1px solid #e3e8ee",
    fontSize: 8,
    color: "#5b6b7c",
  },
  disclaimer: {
    backgroundColor: "#fff1f1",
    borderLeft: "3px solid #ff6b6b",
    padding: 8,
    marginTop: 8,
    fontSize: 9,
    color: "#7a2020",
  },
});

const RISK_LABEL: Record<string, string> = {
  suicidal_ideation: "Ideación suicida",
  self_harm: "Autolesión",
  substance_use: "Consumo de sustancias",
  risk_to_others: "Riesgo a terceros",
};

function Header({ clinicName }: { clinicName: string }) {
  return (
    <>
      <View style={styles.brandBar} />
      <Text style={styles.meta}>{clinicName} — Expediente clínico</Text>
    </>
  );
}

function PatientRecordDocument({ data }: { data: PatientRecordData }) {
  const {
    patient,
    clinicName,
    consent,
    consultations,
    reportsByConsultation,
    soapNotesByConsultation,
    assessments,
    treatmentPlan,
    generatedAt,
  } = data;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Header clinicName={clinicName} />
        <Text style={styles.h1}>Expediente clínico completo</Text>
        <Text style={styles.meta}>Generado el {generatedAt} · Para uso en remisiones o continuidad de atención</Text>

        <Text style={styles.sectionTitle}>Datos del paciente</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Nombre</Text>
          <Text>{patient.fullName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Documento</Text>
          <Text>{patient.document ?? "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Fecha de nacimiento</Text>
          <Text>
            {patient.birthDate ? new Date(patient.birthDate).toLocaleDateString("es-CO") : "—"}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Género</Text>
          <Text>{patient.gender ?? "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Teléfono</Text>
          <Text>{patient.phone ?? "—"}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Correo</Text>
          <Text>{patient.email ?? "—"}</Text>
        </View>

        {patient.history && (
          <>
            <Text style={styles.subTitle}>Antecedentes básicos</Text>
            <Text>{patient.history}</Text>
          </>
        )}

        {(patient.emergencyContactName || patient.emergencyContactPhone) && (
          <>
            <Text style={styles.subTitle}>Contacto de emergencia</Text>
            <Text>
              {patient.emergencyContactName ?? "—"} ({patient.emergencyContactRelationship ?? "—"}) ·{" "}
              {patient.emergencyContactPhone ?? "—"}
            </Text>
          </>
        )}

        <Text style={styles.sectionTitle}>Consentimiento informado</Text>
        {consent ? (
          <Text>
            Firmado por {consent.signerName}
            {consent.isMinor && ` (representante legal — ${consent.representativeRelationship})`} el{" "}
            {new Date(consent.signedAt).toLocaleDateString("es-CO")} · versión {consent.documentVersion}.
          </Text>
        ) : (
          <Text>Sin consentimiento registrado.</Text>
        )}

        {treatmentPlan && (
          <>
            <Text style={styles.sectionTitle}>Plan de tratamiento</Text>
            <Text style={styles.subTitle}>
              {treatmentPlan.title} ({treatmentPlan.status})
            </Text>
            {treatmentPlan.items.map((item) => (
              <View key={item.id} style={styles.row}>
                <Text>
                  [{item.type === "objetivo" ? "Objetivo" : "Checkpoint"}] {item.description}
                </Text>
                <Text style={styles.label}>{item.status}</Text>
              </View>
            ))}
          </>
        )}

        {assessments.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Escalas psicométricas</Text>
            {assessments.map((a) => (
              <View key={a.id} style={styles.row}>
                <Text>
                  {ASSESSMENT_LABEL[a.type]} — {new Date(a.administeredAt).toLocaleDateString("es-CO")}
                </Text>
                <Text style={styles.label}>
                  {a.result.totalScore}/{ASSESSMENT_MAX_SCORE[a.type]} · {a.result.severity}
                </Text>
              </View>
            ))}
          </>
        )}

        <Text style={styles.disclaimer}>
          Los resúmenes de sesión incluidos a continuación fueron generados con apoyo de IA y
          validados por el profesional tratante. NO constituyen un diagnóstico médico ni
          psicológico.
        </Text>

        <Text style={styles.footer}>E-Irene · Documento confidencial · Historia clínica electrónica (Ley 2015 de 2020)</Text>
      </Page>

      {consultations.length > 0 && (
        <Page size="A4" style={styles.page}>
          <Header clinicName={clinicName} />
          <Text style={styles.sectionTitle}>Historial de sesiones ({consultations.length})</Text>
          {consultations.map((c) => {
            const report = reportsByConsultation.get(c.id);
            const soap = soapNotesByConsultation.get(c.id);
            const activeRisks = report?.payload.riskFlags
              ? Object.entries(report.payload.riskFlags).filter(([, v]) => v.level !== "ninguno")
              : [];
            return (
              <View key={c.id} style={styles.sessionBlock}>
                <Text style={styles.subTitle}>
                  {new Date(c.startedAt).toLocaleDateString("es-CO")} — {c.doctorName}
                </Text>
                {c.reason && <Text>Motivo: {c.reason}</Text>}
                {report ? (
                  <>
                    <Text style={{ marginTop: 3 }}>{report.payload.summary}</Text>
                    <Text style={styles.label}>
                      Sentimiento: {report.payload.sentiment.label} ({report.payload.sentiment.score.toFixed(2)})
                    </Text>
                    {report.validatedAt && (
                      <Text style={styles.label}>
                        Sugerencia validada: {report.payload.suggestion}
                      </Text>
                    )}
                    {report.doctorNotes && (
                      <View style={styles.box}>
                        <Text>Notas del profesional: {report.doctorNotes}</Text>
                      </View>
                    )}
                    {activeRisks.length > 0 && (
                      <View style={styles.riskBox}>
                        <Text style={{ fontWeight: 700, color: "#7a2020" }}>Alertas de riesgo:</Text>
                        {activeRisks.map(([key, v]) => (
                          <Text key={key}>
                            {RISK_LABEL[key] ?? key} — {v.level}
                          </Text>
                        ))}
                      </View>
                    )}
                  </>
                ) : (
                  <Text style={styles.label}>Sin análisis de IA para esta sesión.</Text>
                )}
                {soap && (soap.subjective || soap.objective || soap.assessment || soap.plan) && (
                  <View style={styles.box}>
                    <Text style={{ fontWeight: 700 }}>Nota SOAP</Text>
                    {soap.subjective && <Text>S: {soap.subjective}</Text>}
                    {soap.objective && <Text>O: {soap.objective}</Text>}
                    {soap.assessment && <Text>A: {soap.assessment}</Text>}
                    {soap.plan && <Text>P: {soap.plan}</Text>}
                  </View>
                )}
              </View>
            );
          })}
          <Text style={styles.footer}>E-Irene · Documento confidencial · Historia clínica electrónica (Ley 2015 de 2020)</Text>
        </Page>
      )}
    </Document>
  );
}

export async function renderPatientRecordPdf(data: PatientRecordData): Promise<Buffer> {
  return renderToBuffer(<PatientRecordDocument data={data} />);
}
