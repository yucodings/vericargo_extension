import { NextResponse } from "next/server";

import { gmailCases } from "@/data/fixtures/gmailCases";
import { buildSubmission } from "@/domain/submission/buildSubmission";

export function GET() {
  return NextResponse.json(buildSubmission(gmailCases));
}
