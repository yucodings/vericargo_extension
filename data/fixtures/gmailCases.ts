import type {
  AttachmentRef,
  EmailCategory,
  FieldComparison,
  GmailCase,
  OfficialField,
  ReviewReason,
  WorkflowStatus,
} from "../../domain/models/workflow.ts";
import { compareValues, normalizeField } from "../../domain/workflow/verification.ts";

const fieldLabels: Record<OfficialField, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  container_count: "Container count",
  gross_weight_kg: "Gross weight",
};

const defaults: Record<OfficialField, [string, string]> = {
  shipper: ["Northstar Exports Sdn. Bhd.", "NORTHSTAR EXPORTS SDN BHD"],
  consignee: ["Harbor Retail Pte Ltd, Singapore", "HARBOR RETAIL PTE LTD SINGAPORE"],
  notify_party: ["Atlantic Brokers Ltd.", "ATLANTIC BROKERS LTD"],
  port_of_loading: ["Port Klang, Malaysia", "PORT KLANG MY"],
  port_of_discharge: ["Singapore", "Singapore Port"],
  container_count: ["3 x 40HC", "3 containers"],
  gross_weight_kg: ["22 MT", "22,000 KGS"],
};

function evidence(rawValue: string, normalizedValue: string, document: string, page: number, confidence: number) {
  return {
    rawValue,
    normalizedValue,
    document,
    page,
    evidenceText: rawValue,
    confidence,
  };
}

function comparisonField(
  field: OfficialField,
  values: [string, string] = defaults[field],
  confidence = 0.97,
  override?: Partial<FieldComparison>,
): FieldComparison {
  const comparison = compareValues(field, values[0], values[1]);
  return {
    field,
    label: fieldLabels[field],
    comparison,
    decisionConfidence: confidence,
    reason: comparison === "MATCH"
      ? "Values are equivalent after safe normalization"
      : comparison === "MISMATCH"
        ? "Canonical values differ"
        : "One or both values could not be normalized safely",
    normalizationMethod: field === "gross_weight_kg"
      ? "Metric unit conversion to kilograms"
      : field === "container_count"
        ? "Container notation to numeric count"
        : field.startsWith("port_")
          ? "Approved port alias mapping"
          : "Unicode, case, whitespace and punctuation normalization",
    si: evidence(values[0], normalizeField(field, values[0]), "Shipping_Instruction.pdf", field === "container_count" || field === "gross_weight_kg" ? 2 : 1, confidence),
    draftBl: evidence(values[1], normalizeField(field, values[1]), "Draft_BL.pdf", 1, confidence),
    suggestedValue: comparison === "MISMATCH" ? values[0] : undefined,
    ...override,
  };
}

function matchedFields() {
  return (Object.keys(defaults) as OfficialField[]).map((field) => comparisonField(field));
}

function attachments(options?: { missingDraft?: boolean; scanned?: boolean; unreadable?: boolean }): AttachmentRef[] {
  const values: AttachmentRef[] = [{
    id: "att_si",
    filename: "Shipping_Instruction.pdf",
    mimeType: "application/pdf",
    documentType: "SI",
    documentTypeConfidence: 0.98,
    quality: "MACHINE_READABLE",
  }];
  if (!options?.missingDraft) {
    values.push({
      id: "att_bl",
      filename: options?.scanned ? "Draft_BL_scan.pdf" : "Draft_BL.pdf",
      mimeType: "application/pdf",
      documentType: "DRAFT_BL",
      documentTypeConfidence: options?.unreadable ? 0.61 : 0.97,
      quality: options?.unreadable ? "UNREADABLE" : options?.scanned ? "SCANNED" : "MACHINE_READABLE",
    });
  }
  return values;
}

interface CaseOptions {
  emailId: string;
  sender: string;
  senderName: string;
  subject: string;
  body: string;
  receivedAt: string;
  category?: EmailCategory;
  categoryConfidence?: number;
  workflowStatus?: WorkflowStatus;
  suggestedResult?: "MATCH" | "MISMATCH" | null;
  decisionConfidence?: number | null;
  reviewReason?: ReviewReason | null;
  reviewDetail?: string | null;
  criticalGateFailures?: string[];
  evidenceComplete?: boolean;
  processingStage?: GmailCase["processingStage"];
  processingRuns?: number;
  attachments?: AttachmentRef[];
  fields?: FieldComparison[];
  triageEvidence?: string[];
}

function makeCase(options: CaseOptions): GmailCase {
  return {
    emailId: options.emailId,
    gmailMessageId: `gmail-${options.emailId}`,
    gmailThreadId: `thread-${options.emailId}`,
    sender: options.sender,
    senderName: options.senderName,
    recipients: ["shipping.ops@averis.example"],
    subject: options.subject,
    body: options.body,
    receivedAt: options.receivedAt,
    category: options.category ?? "DOCUMENT_COMPARISON",
    categoryConfidence: options.categoryConfidence ?? 0.96,
    triageEvidence: options.triageEvidence ?? ["The subject asks for a Draft BL check", "SI and Draft BL attachment names are present"],
    attachments: options.attachments ?? attachments(),
    workflowStatus: options.workflowStatus ?? "SUGGESTED",
    processingStage: options.processingStage ?? "ASSESS_RISK",
    suggestedResult: options.suggestedResult ?? "MATCH",
    decisionConfidence: options.decisionConfidence ?? 0.96,
    reviewReason: options.reviewReason ?? null,
    reviewDetail: options.reviewDetail ?? null,
    criticalGateFailures: options.criticalGateFailures ?? [],
    evidenceComplete: options.evidenceComplete ?? true,
    processingRuns: options.processingRuns ?? 1,
    fields: options.fields ?? matchedFields(),
    ignoredSuggestions: [],
    reviewerDecision: null,
  };
}

const containerMismatchFields = matchedFields().map((field) => field.field === "container_count"
  ? comparisonField("container_count", ["3 x 40HC", "4 x 40HC"], 0.98)
  : field);

const lowExtractionFields = matchedFields().map((field) => field.field === "notify_party"
  ? comparisonField("notify_party", ["Atlantic Brokers Ltd.", "ATLANTIC BR?KERS L?D"], 0.58, {
      comparison: "UNRESOLVED",
      reason: "OCR could not distinguish two characters in the Draft BL",
      suggestedValue: "Atlantic Brokers Ltd.",
      draftBl: evidence("ATLANTIC BR?KERS L?D", "UNRESOLVED", "Draft_BL_scan.pdf", 1, 0.58),
    })
  : field);

const editorCorrectionFields = matchedFields().map((field) => field.field === "consignee"
  ? comparisonField("consignee", ["Harbor Retail Pte Ltd, Singapore", "Harbor Retail Pte, Singapore"], 0.96)
  : field);

function classifiedCase(
  emailId: string,
  category: EmailCategory,
  subject: string,
  senderName: string,
  sender: string,
  body: string,
  receivedAt: string,
): GmailCase {
  return makeCase({
    emailId,
    category,
    subject,
    senderName,
    sender,
    body,
    receivedAt,
    workflowStatus: "CLASSIFIED",
    processingStage: "FINAL_RESULT",
    suggestedResult: null,
    decisionConfidence: 0.97,
    fields: [],
    attachments: category === "NEW_SI" ? attachments({ missingDraft: true }) : [],
    triageEvidence: [`Subject and body align with ${category.replaceAll("_", " ").toLowerCase()}`],
  });
}

export const gmailCases: GmailCase[] = [
  makeCase({
    emailId: "email_001",
    sender: "ops@northstar-logistics.com",
    senderName: "Northstar Logistics",
    subject: "Please verify Draft BL before release",
    body: "Hi team, please compare the attached draft Bill of Lading with our shipping instruction before release. Thanks, Maya.",
    receivedAt: "10:24 AM",
    suggestedResult: "MATCH",
    decisionConfidence: 0.96,
  }),
  makeCase({
    emailId: "email_002",
    sender: "export@pacific-goods.com",
    senderName: "Pacific Goods",
    subject: "Draft BL check - container quantity",
    body: "Please check the attached Draft BL against the final SI. The container quantity needs particular attention.",
    receivedAt: "9:58 AM",
    suggestedResult: "MISMATCH",
    decisionConfidence: 0.98,
    fields: containerMismatchFields,
  }),
  makeCase({
    emailId: "email_003",
    sender: "docs@meridian-trade.my",
    senderName: "Meridian Trade",
    subject: "Verify shipment weight on Draft BL",
    body: "The SI uses metric tonnes while the carrier draft uses kilograms. Please confirm the documents agree.",
    receivedAt: "9:35 AM",
    suggestedResult: "MATCH",
    decisionConfidence: 0.97,
    triageEvidence: ["Message explicitly requests document verification", "Two shipping documents are attached"],
  }),
  makeCase({
    emailId: "email_004",
    sender: "operations@blueharbor.com",
    senderName: "Blue Harbor",
    subject: "Documents",
    body: "Please take a look when you can.",
    receivedAt: "9:12 AM",
    category: "GENERAL",
    categoryConfidence: 0.64,
    workflowStatus: "HUMAN_REVIEW",
    processingStage: "ATTACHMENT_TRIAGE",
    suggestedResult: null,
    decisionConfidence: 0.64,
    reviewReason: "UNABLE_TO_DETERMINE_EMAIL_INTENT",
    reviewDetail: "Email and attachment evidence do not establish a dependable intent.",
    fields: [],
    attachments: [{ id: "att_unknown", filename: "documents.pdf", mimeType: "application/pdf", documentType: "UNKNOWN", documentTypeConfidence: 0.59, quality: "SCANNED" }],
    triageEvidence: ["Generic subject", "No request type stated in the body", "Attachment type remains uncertain"],
  }),
  makeCase({
    emailId: "email_005",
    sender: "freight@atlas-marine.com",
    senderName: "Atlas Marine",
    subject: "Please compare attached shipment files",
    body: "Please verify the attached instruction against the carrier draft.",
    receivedAt: "8:44 AM",
    workflowStatus: "HUMAN_REVIEW",
    processingStage: "IDENTIFY_DOCUMENTS",
    suggestedResult: null,
    decisionConfidence: 0.99,
    reviewReason: "MISSING_REQUIRED_DOCUMENT",
    reviewDetail: "The Shipping Instruction is attached, but the Draft BL is missing.",
    criticalGateFailures: ["Missing Draft BL"],
    evidenceComplete: false,
    attachments: attachments({ missingDraft: true }),
    fields: [],
  }),
  makeCase({
    emailId: "email_006",
    sender: "shipping@coral-freight.com",
    senderName: "Coral Freight",
    subject: "Check scanned Draft BL",
    body: "Can you check the scan against the attached SI before we approve it?",
    receivedAt: "Yesterday",
    workflowStatus: "HUMAN_REVIEW",
    processingStage: "PROCESS_DOCUMENTS",
    suggestedResult: null,
    decisionConfidence: 0.61,
    reviewReason: "UNREADABLE_DOCUMENT",
    reviewDetail: "The Draft BL scan remains unreadable after OCR retry.",
    criticalGateFailures: ["Unreadable Draft BL"],
    evidenceComplete: false,
    attachments: attachments({ scanned: true, unreadable: true }),
    fields: [],
    processingRuns: 2,
  }),
  makeCase({
    emailId: "email_007",
    sender: "booking@eastbay.com",
    senderName: "Eastbay Shipping",
    subject: "Verify notify party on carrier draft",
    body: "Please compare the attached documents. The Draft BL was scanned from a faxed copy.",
    receivedAt: "Yesterday",
    workflowStatus: "HUMAN_REVIEW",
    processingStage: "EXTRACT",
    suggestedResult: null,
    decisionConfidence: 0.58,
    reviewReason: "LOW_EXTRACTION_CONFIDENCE",
    reviewDetail: "Notify party text is partially unreadable in the scanned Draft BL.",
    criticalGateFailures: ["Notify party extraction below threshold"],
    evidenceComplete: false,
    attachments: attachments({ scanned: true }),
    fields: lowExtractionFields,
  }),
  makeCase({
    emailId: "email_008",
    sender: "customer@harbor-retail.sg",
    senderName: "Harbor Retail",
    subject: "Draft BL requires consignee correction",
    body: "Please verify and correct the consignee name on the Draft BL using the SI as reference.",
    receivedAt: "Yesterday",
    suggestedResult: "MISMATCH",
    decisionConfidence: 0.96,
    fields: editorCorrectionFields,
  }),
  classifiedCase("email_009", "NEW_SI", "Shipping Instruction - BK-7824", "Kencana Exports", "docs@kencana.my", "Attached is the new SI for booking BK-7824.", "Yesterday"),
  classifiedCase("email_010", "INVOICE_QUERY", "Invoice INV-882 payment status", "Seacrest Accounts", "accounts@seacrest.my", "Could you confirm whether invoice INV-882 has been approved?", "Yesterday"),
  classifiedCase("email_011", "GENERAL", "Vessel schedule update", "Ocean Network", "service@ocean-network.com", "MV Horizon is now expected at Port Klang on Friday.", "Sep 17"),
  classifiedCase("email_012", "SPAM", "Limited freight promotion", "Cargo Deals", "offers@cargo-deals.example", "Act now for a limited promotional rate.", "Sep 16"),
];

export function getGmailCase(emailId: string) {
  return gmailCases.find((item) => item.emailId === emailId);
}
