import type { Suggestion } from "@/domain/models/case";

export interface RiskAssessment {
  suggestion: Suggestion;
  confidence: number | null;
  reviewRequired: true;
  canFinalizeAutomatically: false;
}

export function assessRisk(suggestion: Suggestion, confidence: number | null): RiskAssessment {
  return { suggestion, confidence, reviewRequired: true, canFinalizeAutomatically: false };
}
