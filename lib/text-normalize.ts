/**
 * Normaliza texto para búsqueda: minúsculas + sin tildes/diacríticos, para
 * que "andres" encuentre "Andrés" (común al escribir rápido en español).
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
