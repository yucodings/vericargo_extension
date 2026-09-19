import { NextResponse } from "next/server";

import { gmailCases } from "@/data/fixtures/gmailCases";

export async function POST(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  const item = gmailCases.find((candidate) => candidate.emailId === caseId);

  if (!item) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  return NextResponse.json({
    email_id: item.emailId,
    processed_fresh: true,
    processing_run: item.processingRuns + 1,
    starts_at_phase: 5,
    workflow_status: item.workflowStatus,
    suggested_result: item.suggestedResult,
    review_reason: item.reviewReason,
  });
}
