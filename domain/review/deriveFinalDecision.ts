import type { ReviewerDecision } from "@/domain/models/detail";

export function deriveFinalDecision(decision: ReviewerDecision) {
  if (decision === "CONFIRMED_MATCH") return "MATCH" as const;
  if (decision === "CONFIRMED_MISMATCH") return "MISMATCH" as const;
  return null;
}
