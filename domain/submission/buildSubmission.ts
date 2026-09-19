import type { EmailCategory, GmailCase, OfficialField, ReviewReason } from "../models/workflow.ts";

export interface SubmissionRecord {
  category: EmailCategory;
  status: "OK" | "HUMAN_REVIEW";
  review_reason: ReviewReason | null;
  defect_fields: OfficialField[];
  has_defect: boolean;
}

export type SubmissionPayload = Record<string, SubmissionRecord>;

export function buildSubmission(cases: GmailCase[]): SubmissionPayload {
  return Object.fromEntries(cases.map((item) => {
    const defectFields = item.category === "DOCUMENT_COMPARISON"
      ? item.fields.filter((field) => field.comparison === "MISMATCH").map((field) => field.field)
      : [];
    return [item.emailId, {
      category: item.category,
      status: item.workflowStatus === "HUMAN_REVIEW" ? "HUMAN_REVIEW" : "OK",
      review_reason: item.reviewReason,
      defect_fields: defectFields,
      has_defect: defectFields.length > 0,
    } satisfies SubmissionRecord];
  }));
}
