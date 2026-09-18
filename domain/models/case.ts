export const officialFields = [
  "shipper", "consignee", "notify_party", "port_of_loading",
  "port_of_discharge", "container_count", "gross_weight_kg",
] as const;

export type Comparison = "MATCH" | "MISMATCH" | "UNRESOLVED";
export type Suggestion = "SUGGESTED_MATCH" | "SUGGESTED_MISMATCH" | "HUMAN_REVIEW";
export type ReviewStatus = "PENDING_REVIEW" | "IN_REVIEW" | "CONFIRMED";

export interface BlinkCase {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  category: "DOCUMENT_COMPARISON" | "NEW_SHIPPING_INSTRUCTION" | "INVOICE_QUERY" | "GENERAL" | "SPAM";
  suggestion: Suggestion;
  confidence: number | null;
  reviewStatus: ReviewStatus;
  reason: string;
  mismatchCount: number;
  evidenceComplete: boolean;
}
