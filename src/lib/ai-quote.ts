import { z } from "zod";
import type { LineItem } from "./models";

export const aiEvidenceSchema = z.object({sourceId: z.string().min(1).max(100), page: z.number().int().min(1).max(40).nullable(), excerpt: z.string().min(1).max(500)}).strict();
const amount = z.number().finite().min(0).max(1000000);
export const aiOutputSchema = z.object({
  items: z.array(z.object({
    description: z.string().min(1).max(2000), section: z.string().min(1).max(200), scopeKey: z.string().max(200),
    quantity: amount.nullable(), unit: z.string().max(30),
    price: z.object({kind: z.enum(["unit", "total"]), amount, source: aiEvidenceSchema}).strict().nullable(),
    sources: z.array(aiEvidenceSchema).min(1).max(8),
    reason: z.string().max(1000), warnings: z.array(z.string().max(500)).max(10)
  }).strict()).max(200),
  warnings: z.array(z.string().max(500)).max(30)
}).strict();
export type AiOutput = z.infer<typeof aiOutputSchema>;
export type AiSource = {id: string; name: string; text?: string; pages: number};
export type AiDraftResult = {lineItems: LineItem[]; warnings: string[]; model: string; generatedAt: string; jobId: string};

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
function containsAmount(excerpt: string, value: number) {
  return [...excerpt.replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)].some(match => Math.abs(Number(match[0]) - value) < .000001);
}
/** Model output can propose a draft; it cannot choose companies, files, totals, or review approval. */
export function compileAiDraft(output: unknown, sources: AiSource[]): Pick<AiDraftResult, "lineItems" | "warnings"> {
  const parsed = aiOutputSchema.parse(output), allowed = new Map(sources.map(source => [source.id, source]));
  const warnings = new Set(parsed.warnings), items: LineItem[] = [];
  const seen = new Map<string, LineItem>();
  function evidence(value: z.infer<typeof aiEvidenceSchema>) {
    const source = allowed.get(value.sourceId);
    if (!source || (value.page !== null && value.page > source.pages)) throw new Error("The AI returned an unknown source reference.");
    if (source.text !== undefined && !normalize(source.text).includes(normalize(value.excerpt))) throw new Error("The AI returned source text that could not be verified.");
    return {...value, sourceName: source.name};
  }
  for (const item of parsed.items) {
    const references = item.sources.map(evidence), itemWarnings = [...item.warnings];
    let unitPrice = 0;
    if (item.price) {
      const priceSource = evidence(item.price.source);
      if (!containsAmount(priceSource.excerpt, item.price.amount)) itemWarnings.push("The quoted price could not be verified in its evidence. Enter the unit price manually.");
      else if (item.price.kind === "unit") unitPrice = item.price.amount;
      else if (item.quantity !== null && item.quantity > 0) {
        unitPrice = Math.round(item.price.amount / item.quantity * 100) / 100;
        itemWarnings.push("Unit price calculated from the supplied line total and quantity; check rounding.");
      } else itemWarnings.push("A source line total needs a confirmed quantity before a unit price can be calculated.");
      if (!references.some(reference => JSON.stringify(reference) === JSON.stringify(priceSource))) references.push(priceSource);
    } else itemWarnings.push("No supported price was found. Enter a unit price before approving.");
    if (item.quantity === null) itemWarnings.push("Quantity is missing. Enter it before approving.");
    const row: LineItem = {id: crypto.randomUUID(), description: item.description, section: item.section, quantity: item.quantity ?? 0, unit: item.unit || "EA", unitPrice,
      hiddenFromProposal: false, needsReview: true, sourceType: "AI source compilation", confidence: "Review required", sourceReferences: references,
      sourceReason: [item.reason, ...itemWarnings].filter(Boolean).join("\n").slice(0,5000)};
    // Only collapse an exact repeated item with identical scope and identical evidence. Different locations/occurrences remain separate.
    const key = JSON.stringify([normalize(item.scopeKey), normalize(item.description), normalize(item.section), row.quantity, normalize(row.unit), row.unitPrice, references.map(reference => JSON.stringify(reference)).sort()]);
    if (seen.has(key)) {warnings.add("An exact repeated item with identical source evidence was removed. Review repeated work at different locations."); continue;}
    seen.set(key, row); items.push(row);
    for (const warning of itemWarnings) warnings.add(warning);
  }
  if (!items.length) warnings.add("No supported billable scope was found. Review the sources and add missing items manually.");
  return {lineItems: items, warnings: [...warnings].slice(0,60)};
}
