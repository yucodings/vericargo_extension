export const officialFields = [
  "shipper",
  "consignee",
  "notify_party",
  "port_of_loading",
  "port_of_discharge",
  "container_count",
  "gross_weight_kg",
] as const;

export type OfficialField = (typeof officialFields)[number];

export type EmailCategory =
  | "DOCUMENT_COMPARISON"
  | "NEW_SI"
  | "INVOICE_QUERY"
  | "GENERAL"
  | "SPAM";

export type ReviewReason =
  | "LOW_EMAIL_CLASSIFICATION_CONFIDENCE"
  | "UNABLE_TO_DETERMINE_EMAIL_INTENT"
  | "LOW_DOCUMENT_TYPE_CONFIDENCE"
  | "UNREADABLE_ATTACHMENT"
  | "MISSING_REQUIRED_DOCUMENT"
  | "UNREADABLE_DOCUMENT"
  | "PROCESSING_FAILURE"
  | "REPEATED_PROCESSING_FAILURE"
  | "MISSING_REQUIRED_VALUE"
  | "LOW_EXTRACTION_CONFIDENCE"
  | "CONTRADICTORY_EVIDENCE"
  | "NORMALIZATION_UNRESOLVED"
  | "AMBIGUOUS_NORMALIZATION"
  | "UNABLE_TO_DETERMINE"
  | "LOW_CONFIDENCE"
  | "CRITICAL_GATE_FAILURE";

export type Comparison = "MATCH" | "MISMATCH" | "UNRESOLVED";
export type SuggestedResult = "MATCH" | "MISMATCH" | null;
export type WorkflowStatus = "CLASSIFIED" | "SUGGESTED" | "HUMAN_REVIEW" | "VERIFIED";
export type ProcessingStage =
  | "EMAIL_TRIAGE"
  | "ATTACHMENT_TRIAGE"
  | "IDENTIFY_DOCUMENTS"
  | "PROCESS_DOCUMENTS"
  | "EXTRACT"
  | "NORMALIZE"
  | "VERIFY"
  | "GROUND"
  | "ASSESS_RISK"
  | "FINAL_RESULT";

export interface AttachmentRef {
  id: string;
  filename: string;
  mimeType: string;
  documentType: "SI" | "DRAFT_BL" | "INVOICE" | "OTHER" | "UNKNOWN";
  documentTypeConfidence: number;
  quality: "MACHINE_READABLE" | "SCANNED" | "UNREADABLE";
}

export interface SourceEvidence {
  rawValue: string;
  normalizedValue: string;
  document: string;
  page: number | null;
  evidenceText: string;
  confidence: number;
}

export interface FieldComparison {
  field: OfficialField;
  label: string;
  comparison: Comparison;
  decisionConfidence: number;
  reason: string;
  normalizationMethod: string;
  si: SourceEvidence;
  draftBl: SourceEvidence;
  suggestedValue?: string;
}

export interface GmailCase {
  emailId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  sender: string;
  senderName: string;
  recipients: string[];
  subject: string;
  body: string;
  receivedAt: string;
  category: EmailCategory;
  categoryConfidence: number;
  triageEvidence: string[];
  attachments: AttachmentRef[];
  workflowStatus: WorkflowStatus;
  processingStage: ProcessingStage;
  suggestedResult: SuggestedResult;
  decisionConfidence: number | null;
  reviewReason: ReviewReason | null;
  reviewDetail: string | null;
  criticalGateFailures: string[];
  evidenceComplete: boolean;
  processingRuns: number;
  fields: FieldComparison[];
  ignoredSuggestions: OfficialField[];
  reviewerDecision: "MATCH" | "MISMATCH" | null;
}

export interface RiskSignals {
  emailClassificationConfidence: number;
  documentTypeConfidence: number;
  extractionConfidence: number;
  evidenceComplete: boolean;
  requiredDocumentsPresent: boolean;
  processingSucceeded: boolean;
  criticalGateFailures?: string[];
}

export interface RiskAssessment {
  suggestedResult: SuggestedResult;
  decisionConfidence: number;
  requiresHumanReview: boolean;
  reviewReason: ReviewReason | null;
  criticalGateFailures: string[];
}
