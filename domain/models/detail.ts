import type { BlinkCase, Comparison } from "./case";

export interface SourceEvidence {
  rawValue: string;
  normalizedValue: string;
  source: string;
  page: number | null;
  evidence: string;
}

export interface FieldResult {
  key: string;
  label: string;
  comparison: Comparison;
  confidence: number | null;
  reason: string;
  normalization: string;
  si: SourceEvidence;
  bl: SourceEvidence;
}

export interface AuditEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  actor: "SYSTEM" | "REVIEWER";
  status: "COMPLETE" | "ATTENTION" | "PENDING";
}

export interface DetailedCase extends BlinkCase {
  emailBody: string;
  provider: string;
  messageId: string;
  documents: { name: string; type: "SI" | "DRAFT_BL"; quality: string; pages: number }[];
  fields: FieldResult[];
  audit: AuditEvent[];
}

export type ReviewerDecision = "CONFIRMED_MATCH" | "CONFIRMED_MISMATCH" | "CORRECTED" | "RETRY_REQUESTED";

export interface ReviewRecord {
  caseId: string;
  decision: ReviewerDecision;
  reviewedAt: string;
  reviewer: string;
  note: string;
}
