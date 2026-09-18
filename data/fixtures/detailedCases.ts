import { cases } from ".";
import type { DetailedCase, FieldResult } from "@/domain/models/detail";

const source = (rawValue: string, normalizedValue: string, sourceName: string, page: number | null, evidence = rawValue) => ({ rawValue, normalizedValue, source: sourceName, page, evidence });

const matchedFields: FieldResult[] = [
  { key: "shipper", label: "Shipper", comparison: "MATCH", confidence: 0.99, reason: "Exact value after punctuation normalization", normalization: "Whitespace and legal suffix normalization", si: source("Northstar Exports Sdn. Bhd.", "northstar exports sdn bhd", "Shipping_Instruction.pdf", 1), bl: source("NORTHSTAR EXPORTS SDN BHD", "northstar exports sdn bhd", "Draft_BL.pdf", 1) },
  { key: "consignee", label: "Consignee", comparison: "MATCH", confidence: 0.98, reason: "Names and addresses are equivalent", normalization: "Case and line-break normalization", si: source("Harbor Retail Pte Ltd\nSingapore", "harbor retail pte ltd singapore", "Shipping_Instruction.pdf", 1), bl: source("HARBOR RETAIL PTE LTD, SINGAPORE", "harbor retail pte ltd singapore", "Draft_BL.pdf", 1) },
  { key: "notify_party", label: "Notify party", comparison: "MATCH", confidence: 0.96, reason: "Same named party on both documents", normalization: "Case and punctuation normalization", si: source("Atlantic Brokers Ltd.", "atlantic brokers ltd", "Shipping_Instruction.pdf", 1), bl: source("ATLANTIC BROKERS LTD", "atlantic brokers ltd", "Draft_BL.pdf", 1) },
  { key: "port_of_loading", label: "Port of loading", comparison: "MATCH", confidence: 0.99, reason: "Approved port alias resolves to Port Klang", normalization: "PORT KLANG → Port Klang", si: source("PORT KLANG", "Port Klang", "Shipping_Instruction.pdf", 1), bl: source("Port Klang, MY", "Port Klang", "Draft_BL.pdf", 1) },
  { key: "port_of_discharge", label: "Port of discharge", comparison: "MATCH", confidence: 0.99, reason: "Exact canonical port", normalization: "Case normalization", si: source("SINGAPORE", "Singapore", "Shipping_Instruction.pdf", 1), bl: source("Singapore", "Singapore", "Draft_BL.pdf", 1) },
  { key: "container_count", label: "Container count", comparison: "MATCH", confidence: 0.99, reason: "Container notation resolves to a count of 3", normalization: "3 × 40HC → 3", si: source("3 × 40HC", "3", "Shipping_Instruction.pdf", 2, "CONTAINER: 3 X 40HC"), bl: source("3 CONTAINERS", "3", "Draft_BL.pdf", 1, "NO. OF CONTAINERS: 3") },
  { key: "gross_weight_kg", label: "Gross weight", comparison: "MATCH", confidence: 0.98, reason: "22 metric tonnes equals 22,000 kilograms", normalization: "22 MT → 22,000 kg", si: source("22 MT", "22,000 kg", "Shipping_Instruction.pdf", 2, "GROSS WEIGHT: 22 MT"), bl: source("22,000 KGS", "22,000 kg", "Draft_BL.pdf", 1, "GROSS WEIGHT: 22,000 KGS") },
];

function fieldsFor(caseId: string): FieldResult[] {
  const fields = matchedFields.map((field) => ({ ...field, si: { ...field.si }, bl: { ...field.bl } }));
  if (caseId === "BL-1028") {
    const container = fields.find((field) => field.key === "container_count")!;
    container.comparison = "MISMATCH";
    container.confidence = 0.99;
    container.reason = "Deterministic container-count difference with evidence on both documents";
    container.bl = source("4 × 40HC", "4", "Draft_BL.pdf", 1, "NO. OF CONTAINERS: 4 X 40HC");
  }
  if (caseId === "BL-1026") {
    const notify = fields.find((field) => field.key === "notify_party")!;
    notify.comparison = "UNRESOLVED";
    notify.confidence = 0.58;
    notify.reason = "OCR could not reliably distinguish the final company name";
    notify.normalization = "Not performed — source value uncertain";
    notify.bl = source("ATLANTIC BR?KERS L?D", "Unresolved", "Draft_BL_scan.pdf", 1, "NOTIFY: ATLANTIC BR?KERS L?D");
  }
  if (caseId === "BL-1025") {
    return fields.map((field) => ({ ...field, comparison: "UNRESOLVED", confidence: null, reason: "Draft BL attachment is missing", normalization: "Waiting for required document", bl: source("Missing", "Missing", "No attachment", null, "No source evidence available") }));
  }
  return fields;
}

export const detailedCases: DetailedCase[] = cases.filter((item) => item.category === "DOCUMENT_COMPARISON").map((item) => ({
  ...item,
  provider: "Outlook",
  messageId: `MSG-${item.id.replace("BL-", "92")}`,
  emailBody: item.id === "BL-1025" ? "Please check the attached shipping instruction against the draft bill of lading." : "Please verify the attached draft Bill of Lading against our shipping instruction before release.",
  documents: item.id === "BL-1025" ? [{ name: "Shipping_Instruction.pdf", type: "SI", quality: "Machine-readable", pages: 2 }] : [{ name: "Shipping_Instruction.pdf", type: "SI", quality: "Machine-readable", pages: 2 }, { name: item.id === "BL-1026" ? "Draft_BL_scan.pdf" : "Draft_BL.pdf", type: "DRAFT_BL", quality: item.id === "BL-1026" ? "OCR · low quality" : "Machine-readable", pages: 1 }],
  fields: fieldsFor(item.id),
  audit: [
    { id: `${item.id}-1`, time: "09:41:03", title: "Email received", detail: "Outlook message preserved with attachment metadata", actor: "SYSTEM", status: "COMPLETE" },
    { id: `${item.id}-2`, time: "09:41:04", title: "Intent classified", detail: "DOCUMENT_COMPARISON detected from email evidence", actor: "SYSTEM", status: "COMPLETE" },
    { id: `${item.id}-3`, time: "09:41:08", title: "Seven fields extracted", detail: "Raw values, page references and evidence recorded", actor: "SYSTEM", status: "COMPLETE" },
    { id: `${item.id}-4`, time: "09:41:09", title: item.suggestion === "SUGGESTED_MISMATCH" ? "Mismatch suggested" : item.suggestion === "SUGGESTED_MATCH" ? "Match suggested" : "Uncertainty detected", detail: item.reason, actor: "SYSTEM", status: item.suggestion === "HUMAN_REVIEW" ? "ATTENTION" : "COMPLETE" },
    { id: `${item.id}-5`, time: "09:41:10", title: "Sent to human review", detail: "No automated final decision was made", actor: "SYSTEM", status: "PENDING" },
  ],
}));

export function getDetailedCase(caseId: string) {
  return detailedCases.find((item) => item.id === caseId) ?? detailedCases[0];
}
