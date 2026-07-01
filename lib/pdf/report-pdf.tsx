import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Report } from "@/lib/db/reports";

export interface PdfData {
  report: Report;
  patientName: string;
  clinicName: string;
  doctorName: string;
  date: string;
  reason?: string | null;
  transcript: string | null;
  validatedAt: string | null;
}

const PATTERN_LABEL: Record<string, string> = {
  primera_persona: "Uso de primera persona",
  negaciones: "Negaciones",
  dudas: "Expresiones de duda",
  intensidad_emocional: "Intensidad emocional",
};

const RISK_LABEL: Record<string, string> = {
  suicidal_ideation: "Ideación suicida",
  self_harm: "Autolesión",
  substance_use: "Consumo de sustancias",
  risk_to_others: "Riesgo a terceros",
};

const RISK_LEVEL_COLOR: Record<string, string> = {
  bajo: "#b7791f",
  moderado: "#ff6b6b",
  alto: "#c0392b",
};

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: "#0a2540", lineHeight: 1.5 },
  brandBar: { height: 4, backgroundColor: "#635bff", marginBottom: 16 },
  h1: { fontSize: 18, fontWeight: 700, color: "#0a2540" },
  meta: { fontSize: 9, color: "#5b6b7c", marginTop: 4 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#635bff",
    marginTop: 16,
    marginBottom: 6,
  },
  disclaimer: {
    backgroundColor: "#fff1f1",
    borderLeft: "3px solid #ff6b6b",
    padding: 8,
    marginTop: 12,
    fontSize: 9,
    color: "#7a2020",
  },
  doctorNotesBox: {
    backgroundColor: "#f0f4f8",
    borderLeft: "3px solid #635bff",
    padding: 8,
    marginTop: 4,
  },
  riskBox: {
    backgroundColor: "#fff1f1",
    border: "1px solid #ff6b6b",
    borderRadius: 4,
    padding: 8,
    marginTop: 12,
  },
  riskTitle: { fontSize: 11, fontWeight: 700, color: "#7a2020", marginBottom: 4 },
  riskItem: { marginBottom: 3 },
  riskLabel: { fontWeight: 700 },
  riskNone: {
    backgroundColor: "#f0f4f8",
    borderRadius: 4,
    padding: 8,
    marginTop: 12,
    fontSize: 9,
    color: "#5b6b7c",
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  tag: { marginRight: 8, color: "#635bff" },
  transcriptLine: { marginBottom: 3 },
  speaker: { color: "#635bff", fontWeight: 700 },
  footer: {
    marginTop: 24,
    paddingTop: 10,
    borderTop: "1px solid #e3e8ee",
    fontSize: 8,
    color: "#5b6b7c",
  },
  sign: { marginTop: 28, flexDirection: "row", justifyContent: "space-between" },
  signBox: { width: "45%", borderTop: "1px solid #0a2540", paddingTop: 4, fontSize: 9 },
});

function ReportDocument({ data }: { data: PdfData }) {
  const { report, patientName, clinicName, doctorName, date, reason, transcript, validatedAt } = data;
  const p = report.payload;
  const activeRisks = p.riskFlags
    ? Object.entries(p.riskFlags).filter(([, v]) => v.level !== "ninguno")
    : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.brandBar} />

        {/* 1. Información general */}
        <Text style={styles.h1}>Reporte de sesión clínica</Text>
        <Text style={styles.meta}>
          {clinicName} · Paciente: {patientName} · Profesional: {doctorName}
        </Text>
        <Text style={styles.meta}>Fecha: {date}</Text>
        {reason && (
          <Text style={{ ...styles.meta, marginTop: 6 }}>
            <Text style={{ fontWeight: 700 }}>Motivo de la consulta: </Text>
            {reason}
          </Text>
        )}

        {/* Alertas de riesgo — apoyo a la detección temprana, no diagnóstico */}
        {p.riskFlags &&
          (activeRisks.length > 0 ? (
            <View style={styles.riskBox}>
              <Text style={styles.riskTitle}>Alertas de riesgo identificadas</Text>
              {activeRisks.map(([key, v]) => (
                <Text key={key} style={styles.riskItem}>
                  <Text style={[styles.riskLabel, { color: RISK_LEVEL_COLOR[v.level] }]}>
                    {RISK_LABEL[key] ?? key} — nivel {v.level}:{" "}
                  </Text>
                  {v.evidence}
                </Text>
              ))}
              <Text style={{ marginTop: 4, fontSize: 8, color: "#7a2020" }}>
                Detección de apoyo basada en las palabras del paciente. Requiere valoración y
                decisión clínica del profesional tratante.
              </Text>
            </View>
          ) : (
            <Text style={styles.riskNone}>
              No se identificaron alertas de riesgo (ideación suicida, autolesión, consumo de
              sustancias, riesgo a terceros) en esta sesión.
            </Text>
          ))}

        {/* 2. Resumen ejecutivo */}
        <Text style={styles.sectionTitle}>Resumen ejecutivo</Text>
        <Text>{p.summary}</Text>

        {/* 3. Sentimiento */}
        <Text style={styles.sectionTitle}>Análisis de sentimiento</Text>
        <Text>
          Tono general: {p.sentiment.label} (puntaje {p.sentiment.score.toFixed(2)} en escala −1 a
          +1).
        </Text>

        {/* 4. Nube de palabras */}
        <Text style={styles.sectionTitle}>Palabras clave y temas</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          {p.keywords.map((k) => (
            <Text key={k.term} style={styles.tag}>
              {k.term}
            </Text>
          ))}
        </View>
        {p.topics.length > 0 && (
          <Text style={{ marginTop: 4 }}>Temas recurrentes: {p.topics.join(", ")}.</Text>
        )}

        {/* 5. Patrones lingüísticos */}
        <Text style={styles.sectionTitle}>Patrones lingüísticos</Text>
        {Object.entries(p.patterns).map(([key, value]) => (
          <View key={key} style={styles.row}>
            <Text>{PATTERN_LABEL[key] ?? key}</Text>
            <Text>{(value * 100).toFixed(1)}%</Text>
          </View>
        ))}

        {/* 6. Sugerencia preliminar */}
        <Text style={styles.sectionTitle}>Sugerencia preliminar</Text>
        <Text>{p.suggestion}</Text>
        <Text style={styles.disclaimer}>
          Este análisis es generado por IA como apoyo clínico. NO constituye un diagnóstico médico
          ni psicológico y debe ser interpretado y validado por el profesional tratante.
        </Text>

        {/* Notas del profesional — texto propio del doctor, no generado por IA */}
        {report.doctorNotes && (
          <>
            <Text style={styles.sectionTitle}>Notas del profesional</Text>
            <View style={styles.doctorNotesBox}>
              <Text>{report.doctorNotes}</Text>
            </View>
          </>
        )}

        {/* 8. Firma / validación */}
        <View style={styles.sign}>
          <View style={styles.signBox}>
            <Text>{doctorName}</Text>
            <Text style={{ color: "#5b6b7c" }}>Profesional tratante</Text>
          </View>
          <View style={styles.signBox}>
            <Text>
              {validatedAt
                ? `Validado el ${new Date(validatedAt).toLocaleDateString("es-CO")}`
                : "Pendiente de validación"}
            </Text>
            <Text style={{ color: "#5b6b7c" }}>Firma y fecha</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          Documento generado por E-Irene · Historia clínica electrónica (Ley 2015 de 2020). La
          información es confidencial y está protegida por el secreto profesional.
        </Text>
      </Page>

      {/* 7. Transcripción completa */}
      {transcript && (
        <Page size="A4" style={styles.page}>
          <View style={styles.brandBar} />
          <Text style={styles.sectionTitle}>Transcripción completa</Text>
          {transcript.split("\n").map((line, i) => {
            const [speaker, ...rest] = line.split(": ");
            return (
              <Text key={i} style={styles.transcriptLine}>
                <Text style={styles.speaker}>{speaker}: </Text>
                {rest.join(": ")}
              </Text>
            );
          })}
        </Page>
      )}
    </Document>
  );
}

export async function renderReportPdf(data: PdfData): Promise<Buffer> {
  return renderToBuffer(<ReportDocument data={data} />);
}
