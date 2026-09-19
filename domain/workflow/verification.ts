import {
  officialFields,
  type FieldComparison,
  type GmailCase,
  type OfficialField,
  type ReviewReason,
  type RiskAssessment,
  type RiskSignals,
  type SourceEvidence,
} from "../models/workflow.ts";

export const CONFIDENCE_THRESHOLD = 0.9;

const portAliases: Record<string, string> = {
  "PORT KLANG MY": "PORT KLANG",
  "PORT KLANG MALAYSIA": "PORT KLANG",
  "SINGAPORE PORT": "SINGAPORE",
  "PORT OF SINGAPORE": "SINGAPORE",
};

export function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePort(value: string) {
  const normalized = normalizeText(value);
  return portAliases[normalized] ?? normalized;
}

export function normalizeContainerCount(value: string) {
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? String(Number(match[0])) : "UNRESOLVED";
}

export function normalizeWeightKg(value: string) {
  const normalized = value
    .replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const number = normalized.match(/\d+(?:\.\d+)?/);
  if (!number) return "UNRESOLVED";
  const amount = Number(number[0]);
  if (/\b(MT|TONNE|TONNES|METRIC TON|METRIC TONS)\b/.test(normalized)) return String(amount * 1000);
  if (/\b(KG|KGS|KILOGRAM|KILOGRAMS)\b/.test(normalized)) return String(amount);
  return "UNRESOLVED";
}

export function normalizeField(field: OfficialField, value: string) {
  if (field === "gross_weight_kg") return normalizeWeightKg(value);
  if (field === "container_count") return normalizeContainerCount(value);
  if (field === "port_of_loading" || field === "port_of_discharge") return normalizePort(value);
  return normalizeText(value);
}

export function compareValues(field: OfficialField, siValue: string, draftBlValue: string) {
  const si = normalizeField(field, siValue);
  const draftBl = normalizeField(field, draftBlValue);
  if (si === "UNRESOLVED" || draftBl === "UNRESOLVED") return "UNRESOLVED" as const;
  return si === draftBl ? ("MATCH" as const) : ("MISMATCH" as const);
}

function lowestFieldConfidence(fields: FieldComparison[]) {
  if (fields.length === 0) return 1;
  return fields.reduce((lowest, field) => Math.min(lowest, field.decisionConfidence), 1);
}

export function assessRisk(fields: FieldComparison[], signals: RiskSignals): RiskAssessment {
  const gateFailures = [...(signals.criticalGateFailures ?? [])];
  if (!signals.requiredDocumentsPresent) gateFailures.push("Missing required SI or Draft BL");
  if (!signals.processingSucceeded) gateFailures.push("Document processing failed");
  if (!signals.evidenceComplete) gateFailures.push("Source evidence unavailable");

  const unresolved = fields.some((field) => field.comparison === "UNRESOLVED");
  const suggestedResult = fields.some((field) => field.comparison === "MISMATCH") ? "MISMATCH" : "MATCH";
  const confidence = Math.min(
    signals.emailClassificationConfidence,
    signals.documentTypeConfidence,
    signals.extractionConfidence,
    lowestFieldConfidence(fields),
  );

  let reviewReason: ReviewReason | null = null;
  if (!signals.requiredDocumentsPresent) reviewReason = "MISSING_REQUIRED_DOCUMENT";
  else if (!signals.processingSucceeded) reviewReason = "PROCESSING_FAILURE";
  else if (unresolved) reviewReason = "UNABLE_TO_DETERMINE";
  else if (gateFailures.length > 0) reviewReason = "CRITICAL_GATE_FAILURE";
  else if (confidence < CONFIDENCE_THRESHOLD) reviewReason = "LOW_CONFIDENCE";

  return {
    suggestedResult: reviewReason ? null : suggestedResult,
    decisionConfidence: confidence,
    requiresHumanReview: reviewReason !== null,
    reviewReason,
    criticalGateFailures: gateFailures,
  };
}

function updatedSource(source: SourceEvidence, field: OfficialField, value: string): SourceEvidence {
  return {
    ...source,
    rawValue: value,
    normalizedValue: normalizeField(field, value),
    evidenceText: `${field.replaceAll("_", " ")}: ${value}`,
    confidence: 0.99,
  };
}

export function reprocessAfterDraftEdit(item: GmailCase, field: OfficialField, value: string): GmailCase {
  const fields = item.fields.map((entry) => {
    if (entry.field !== field) return entry;
    const draftBl = updatedSource(entry.draftBl, field, value);
    const comparison = compareValues(field, entry.si.rawValue, value);
    return {
      ...entry,
      draftBl,
      comparison,
      decisionConfidence: comparison === "UNRESOLVED" ? 0.5 : 0.99,
      reason: comparison === "MATCH"
        ? "Updated Draft BL value matches the SI after fresh processing"
        : comparison === "MISMATCH"
          ? "Updated Draft BL value still differs from the SI"
          : "Updated value could not be normalized safely",
      suggestedValue: comparison === "MATCH" ? undefined : entry.si.rawValue,
    } satisfies FieldComparison;
  });

  const risk = assessRisk(fields, {
    emailClassificationConfidence: item.categoryConfidence,
    documentTypeConfidence: Math.min(...item.attachments.map((attachment) => attachment.documentTypeConfidence), 1),
    extractionConfidence: Math.min(...fields.map((entry) => entry.decisionConfidence), 1),
    evidenceComplete: fields.every((entry) => Boolean(entry.si.evidenceText && entry.draftBl.evidenceText)),
    requiredDocumentsPresent: item.attachments.some((attachment) => attachment.documentType === "SI")
      && item.attachments.some((attachment) => attachment.documentType === "DRAFT_BL"),
    processingSucceeded: true,
  });

  return {
    ...item,
    fields,
    processingRuns: item.processingRuns + 1,
    processingStage: "ASSESS_RISK",
    workflowStatus: risk.requiresHumanReview ? "HUMAN_REVIEW" : "SUGGESTED",
    suggestedResult: risk.suggestedResult,
    decisionConfidence: risk.decisionConfidence,
    reviewReason: risk.reviewReason,
    reviewDetail: risk.reviewReason ? "The edited document still needs a reviewer decision." : null,
    criticalGateFailures: risk.criticalGateFailures,
    evidenceComplete: fields.every((entry) => Boolean(entry.si.evidenceText && entry.draftBl.evidenceText)),
    reviewerDecision: null,
  };
}

export function validateOfficialFieldCoverage(fields: FieldComparison[]) {
  return officialFields.every((field) => fields.some((entry) => entry.field === field));
}
