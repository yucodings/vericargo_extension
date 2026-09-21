import type { VeriCargoCase } from "@/domain/models/case";

export const cases: VeriCargoCase[] = [
  { id: "BL-1028", sender: "ops@northstar-logistics.com", subject: "Check draft BL before release", receivedAt: "Today, 09:41", category: "DOCUMENT_COMPARISON", suggestion: "SUGGESTED_MISMATCH", confidence: 0.98, reviewStatus: "PENDING_REVIEW", reason: "Container count differs: SI 3 / Draft BL 4", mismatchCount: 1, evidenceComplete: true },
  { id: "BL-1027", sender: "shipping@meridian-trade.my", subject: "Draft BL verification – BK-7842", receivedAt: "Today, 09:18", category: "DOCUMENT_COMPARISON", suggestion: "SUGGESTED_MATCH", confidence: 0.97, reviewStatus: "PENDING_REVIEW", reason: "All seven fields are equivalent after normalization", mismatchCount: 0, evidenceComplete: true },
  { id: "BL-1026", sender: "export@pacific-goods.com", subject: "Documents", receivedAt: "Today, 08:52", category: "DOCUMENT_COMPARISON", suggestion: "HUMAN_REVIEW", confidence: 0.68, reviewStatus: "IN_REVIEW", reason: "Notify party is partially unreadable in the Draft BL", mismatchCount: 0, evidenceComplete: false },
  { id: "BL-1025", sender: "freight@atlas-marine.com", subject: "Please compare attached shipment files", receivedAt: "Yesterday, 16:33", category: "DOCUMENT_COMPARISON", suggestion: "HUMAN_REVIEW", confidence: null, reviewStatus: "PENDING_REVIEW", reason: "Required Draft BL attachment is missing", mismatchCount: 0, evidenceComplete: false },
  { id: "BL-1024", sender: "booking@eastbay.com", subject: "Verify load port wording", receivedAt: "Yesterday, 15:06", category: "DOCUMENT_COMPARISON", suggestion: "SUGGESTED_MATCH", confidence: 0.95, reviewStatus: "PENDING_REVIEW", reason: "Load Port and Port of Loading refer to Port Klang", mismatchCount: 0, evidenceComplete: true },
  { id: "BL-1023", sender: "accounts@seacrest.my", subject: "Invoice INV-882 payment status", receivedAt: "Yesterday, 13:24", category: "INVOICE_QUERY", suggestion: "HUMAN_REVIEW", confidence: null, reviewStatus: "CONFIRMED", reason: "Routed to Accounts; no BL verification required", mismatchCount: 0, evidenceComplete: false },
];

export const comparisonCases = cases.filter((item) => item.category === "DOCUMENT_COMPARISON");
