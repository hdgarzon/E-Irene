import { Fragment } from "react";
import { parseInline, type LegalBlock, type LegalDocument } from "@/lib/legal-documents";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === "bold") {
          return (
            <strong key={i} className="font-semibold text-navy">
              {part.text}
            </strong>
          );
        }
        if (part.kind === "link") {
          return (
            <a key={i} href={part.href} className="break-words text-primary underline-offset-2 hover:underline">
              {part.text}
            </a>
          );
        }
        return <Fragment key={i}>{part.text}</Fragment>;
      })}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.type) {
    case "h2":
      return (
        <h2 className="mt-8 font-heading text-lg font-semibold text-navy first:mt-0">
          <Inline text={block.text} />
        </h2>
      );
    case "h3":
      return (
        <h3 className="mt-5 font-heading text-base font-semibold text-navy">
          <Inline text={block.text} />
        </h3>
      );
    case "p":
      return (
        <p>
          <Inline text={block.text} />
        </p>
      );
    case "note":
      return (
        <p className="italic text-muted-foreground">
          <Inline text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="list-disc space-y-1.5 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal space-y-1.5 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} />
            </li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border border-gray-line">
          <table className="w-full min-w-[32rem] border-collapse text-left text-xs sm:text-sm">
            <thead className="bg-cloud">
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} className="border-b border-gray-line px-3 py-2 font-semibold text-navy">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="align-top">
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-gray-line px-3 py-2 last:border-b-0">
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Cuerpo de un documento legal (sin título): el mismo texto que se hashea. */
export function LegalDocumentBody({ doc }: { doc: LegalDocument }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      {doc.blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
