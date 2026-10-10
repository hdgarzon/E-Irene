import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { parseInline, type LegalBlock, type LegalDocument } from "@/lib/legal-documents";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: "#0a2540", lineHeight: 1.5 },
  brandBar: { height: 4, backgroundColor: "#635bff", marginBottom: 16 },
  title: { fontSize: 17, fontWeight: 700 },
  meta: { fontSize: 9, color: "#5b6b7c", marginTop: 4, marginBottom: 14 },
  h2: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 4 },
  h3: { fontSize: 10.5, fontWeight: 700, marginTop: 8, marginBottom: 3 },
  p: { marginBottom: 6 },
  note: { marginBottom: 6, fontStyle: "italic", color: "#3c4b5c" },
  bold: { fontWeight: 700 },
  link: { color: "#635bff" },
  listItem: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 16 },
  listText: { flex: 1 },
  table: { borderTop: "1px solid #e3e8ee", borderLeft: "1px solid #e3e8ee", marginBottom: 8 },
  row: { flexDirection: "row" },
  cell: {
    flex: 1,
    padding: 4,
    fontSize: 8.5,
    borderRight: "1px solid #e3e8ee",
    borderBottom: "1px solid #e3e8ee",
  },
  headCell: { backgroundColor: "#f0f4f8", fontWeight: 700 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#5b6b7c",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === "bold") {
          return (
            <Text key={i} style={styles.bold}>
              {part.text}
            </Text>
          );
        }
        if (part.kind === "link") {
          return (
            <Link key={i} src={part.href} style={styles.link}>
              {part.text}
            </Link>
          );
        }
        return <Text key={i}>{part.text}</Text>;
      })}
    </>
  );
}

function List({ items, ordered }: { items: string[]; ordered: boolean }) {
  return (
    <View style={{ marginBottom: 6 }}>
      {items.map((item, i) => (
        <View key={i} style={styles.listItem} wrap={false}>
          <Text style={styles.bullet}>{ordered ? `${i + 1}.` : "•"}</Text>
          <Text style={styles.listText}>
            <Inline text={item} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "h2":
      return (
        <Text style={styles.h2} minPresenceAhead={40}>
          <Inline text={block.text} />
        </Text>
      );
    case "h3":
      return (
        <Text style={styles.h3} minPresenceAhead={30}>
          <Inline text={block.text} />
        </Text>
      );
    case "p":
      return (
        <Text style={styles.p}>
          <Inline text={block.text} />
        </Text>
      );
    case "note":
      return (
        <Text style={styles.note}>
          <Inline text={block.text} />
        </Text>
      );
    case "ul":
      return <List items={block.items} ordered={false} />;
    case "ol":
      return <List items={block.items} ordered />;
    case "table":
      return (
        <View style={styles.table}>
          <View style={styles.row} wrap={false}>
            {block.head.map((h, i) => (
              <Text key={i} style={[styles.cell, styles.headCell]}>
                {h}
              </Text>
            ))}
          </View>
          {block.rows.map((row, r) => (
            <View key={r} style={styles.row} wrap={false}>
              {row.map((cell, c) => (
                <Text key={c} style={styles.cell}>
                  <Inline text={cell} />
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

function LegalPdf({ doc }: { doc: LegalDocument }) {
  return (
    <Document title={doc.title} author="E-Irene" language="es">
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brandBar} fixed />
        <Text style={styles.title}>{doc.title}</Text>
        <Text style={styles.meta}>
          {doc.subtitle ? `${doc.subtitle} · ` : ""}Versión {doc.version} · Vigente desde{" "}
          {doc.effectiveDate}
        </Text>
        {doc.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        <View style={styles.footer} fixed>
          <Text>
            {doc.title} · v{doc.version}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderLegalDocumentPdf(doc: LegalDocument): Promise<Buffer> {
  return renderToBuffer(<LegalPdf doc={doc} />);
}
