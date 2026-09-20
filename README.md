# VeriCargo Gmail Shipping Assistant

VeriCargo is a Gmail-first prototype for triaging shipping emails and verifying Shipping Instructions (SI) against Draft Bills of Lading (Draft BL). The root experience is a three-pane Gmail work surface: inbox, email, and a contextual VeriCargo assistant.

A locally loadable Chrome Manifest V3 side-panel extension is available in `chrome-extension/`. It can be installed with Chrome's **Load unpacked** developer workflow and does not require Chrome Web Store publication. It has no Demo mode or mock mailbox: users authorize Gmail through the VeriCargo Cloud Run backend, which imports Inbox messages and serves them to authenticated extension sessions.

## What the prototype covers

- Classifies every email as `DOCUMENT_COMPARISON`, `NEW_SI`, `INVOICE_QUERY`, `GENERAL`, or `SPAM`.
- Treats Human Review as a workflow status with a specific reason, never as an email category.
- Compares SI and Draft BL only for document-comparison emails.
- Verifies exactly seven fields: shipper, consignee, notify party, ports of loading and discharge, container count, and gross weight in kilograms.
- Shows raw values, normalized values, page references, evidence text, and decision confidence.
- Uses “Suggested Match” or “Suggested Mismatch”; the reviewer verifies the final result.
- Routes confidence below 90%, unresolved values, missing documents, processing failures, and critical gates to Human Review.
- Supports Apply, Ignore, and manual Draft BL edits. Applying an edit performs a fresh Phase 5+ verification run.
- Exports one JSON record for every demo email.

The twelve fixtures cover a clean match, a material mismatch, a harmless metric-unit difference, ambiguous intent, missing Draft BL, unreadable scan, low extraction confidence, editor correction, and all non-comparison categories.

## Architecture

- `app/` — Next.js App Router pages and backend route handlers
- `features/gmail/` — Gmail-first user experience and reviewer interactions
- `domain/models/workflow.ts` — canonical categories, reasons, stages, and seven-field model
- `domain/workflow/verification.ts` — deterministic normalization, comparison, risk gating, and Phase 5+ reprocessing
- `domain/submission/buildSubmission.ts` — one-record-per-email export builder
- `data/fixtures/gmailCases.ts` — replaceable local demo repository
- `tests/workflow.test.ts` — workflow, normalization, reprocessing, and export-contract tests

Route handlers provide a boundary for production services:

- `GET /api/export` returns the current documented demo export shape.
- `POST /api/cases/:caseId/verify` demonstrates the fresh-processing contract and async Next.js 16 route parameters.

The UI currently uses fixtures so the demo remains reliable without credentials. A production adapter can replace them with Gmail OAuth/webhooks, document storage and OCR, model inference, SQL persistence, and an append-only audit log without changing the reviewer flow.

## Run and verify

```bash
npm install
npm run dev
npm test
npm run lint
npm run build
```

Node.js 22.13 or newer is required.

## Evaluation-data note

The project documents describe `sample_submission.json` as canonical, but that actual template file is not present in this workspace. The exporter implements the documented keys and includes every email. Before a formal submission, validate and adapt `domain/submission/buildSubmission.ts` against the provided canonical template without renaming its required keys.

## Production readiness boundary

This is a functional prototype, not a connected production mailbox. Real Gmail access, cloud document processing, hosted AI inference, durable audit storage, and production identity/authorization still require environment-specific credentials and deployment configuration.
