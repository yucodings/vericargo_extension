import assert from "node:assert/strict";
import test from "node:test";

import { gmailCases } from "../data/fixtures/gmailCases.ts";
import { officialFields } from "../domain/models/workflow.ts";
import { buildSubmission } from "../domain/submission/buildSubmission.ts";
import {
  assessRisk,
  compareValues,
  normalizeWeightKg,
  reprocessAfterDraftEdit,
  validateOfficialFieldCoverage,
} from "../domain/workflow/verification.ts";

test("normalizes equivalent metric weights without creating a false mismatch", () => {
  assert.equal(normalizeWeightKg("22 MT"), "22000");
  assert.equal(normalizeWeightKg("22,000 KGS"), "22000");
  assert.equal(compareValues("gross_weight_kg", "22 MT", "22,000 KGS"), "MATCH");
});

test("keeps a material container discrepancy as a mismatch", () => {
  assert.equal(compareValues("container_count", "3 x 40HC", "2 containers"), "MISMATCH");
});

test("routes low confidence, unresolved evidence, and missing documents to Human Review", () => {
  const fields = gmailCases[0].fields;
  const baseSignals = {
    emailClassificationConfidence: 0.98,
    documentTypeConfidence: 0.98,
    extractionConfidence: 0.98,
    evidenceComplete: true,
    requiredDocumentsPresent: true,
    processingSucceeded: true,
  };

  assert.equal(assessRisk(fields, { ...baseSignals, extractionConfidence: 0.89 }).reviewReason, "LOW_CONFIDENCE");
  assert.equal(assessRisk(fields, { ...baseSignals, requiredDocumentsPresent: false }).reviewReason, "MISSING_REQUIRED_DOCUMENT");

  const unresolvedFields = fields.map((field, index) => index === 0 ? { ...field, comparison: "UNRESOLVED" as const } : field);
  assert.equal(assessRisk(unresolvedFields, baseSignals).reviewReason, "UNABLE_TO_DETERMINE");
});

test("an accepted Draft BL correction performs a fresh Phase 5+ run", () => {
  const mismatchCase = gmailCases.find((item) => item.emailId === "email_008");
  assert.ok(mismatchCase);

  const beforeRuns = mismatchCase.processingRuns;
  const corrected = reprocessAfterDraftEdit(mismatchCase, "consignee", "Harbor Retail Pte Ltd, Singapore");

  assert.equal(corrected.processingRuns, beforeRuns + 1);
  assert.equal(corrected.fields.find((field) => field.field === "consignee")?.comparison, "MATCH");
  assert.equal(corrected.suggestedResult, "MATCH");
  assert.equal(corrected.workflowStatus, "SUGGESTED");
  assert.equal(validateOfficialFieldCoverage(corrected.fields), true);
});

test("exports every email using the documented submission record shape", () => {
  const submission = buildSubmission(gmailCases);
  assert.deepEqual(Object.keys(submission).sort(), gmailCases.map((item) => item.emailId).sort());
  assert.deepEqual(Object.keys(submission.email_002).sort(), [
    "category",
    "defect_fields",
    "has_defect",
    "review_reason",
    "status",
  ]);
  assert.deepEqual(submission.email_002.defect_fields, ["container_count"]);
  assert.equal(submission.email_002.has_defect, true);
  assert.equal(new Set(officialFields).size, 7);
});
