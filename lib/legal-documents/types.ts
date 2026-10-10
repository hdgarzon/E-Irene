/**
 * Documentos legales como datos, no como JSX ni como PDF suelto.
 *
 * De una sola fuente salen tres cosas que no pueden divergir: la página pública,
 * el PDF descargable y el texto cuyo SHA-256 se guarda como prueba de lo que se
 * aceptó. Si la página dijera una cosa y el hash correspondiera a otra, la
 * prueba no probaría nada.
 *
 * Marcado en línea admitido en cualquier texto: **negrita** y [enlace](url).
 */
export type LegalBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  /** Párrafo en cursiva: notas aclaratorias del propio documento. */
  | { type: "note"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] };

export interface LegalDocument {
  /** Ruta pública sin barra inicial, y nombre base del PDF. */
  slug: string;
  title: string;
  /** Versión visible en el documento ("1.0"). */
  version: string;
  /** Fecha de vigencia visible ("6 de octubre de 2026"). */
  effectiveDate: string;
  /** Línea bajo el título; opcional. */
  subtitle?: string;
  blocks: LegalBlock[];
}

/** Partes de un texto con marcado en línea, en orden. */
export type InlinePart =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) parts.push({ kind: "bold", text: m[1] });
    else parts.push({ kind: "link", text: m[2], href: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/**
 * Texto canónico del documento: lo que se hashea. Conserva el marcado tal cual
 * —es determinista y cualquier cambio de redacción, aunque sea de formato,
 * cambia la huella—.
 */
export function serializeDocument(doc: LegalDocument): string {
  const lines = [doc.title, `Versión: ${doc.version} · Vigente desde: ${doc.effectiveDate}`];
  if (doc.subtitle) lines.push(doc.subtitle);
  for (const b of doc.blocks) {
    switch (b.type) {
      case "h2":
      case "h3":
      case "p":
      case "note":
        lines.push(b.text);
        break;
      case "ul":
        for (const item of b.items) lines.push(`- ${item}`);
        break;
      case "ol":
        b.items.forEach((item, i) => lines.push(`${i + 1}. ${item}`));
        break;
      case "table":
        lines.push(b.head.join(" | "));
        for (const row of b.rows) lines.push(row.join(" | "));
        break;
    }
  }
  return lines.join("\n\n");
}
