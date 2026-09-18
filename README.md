# BLiNK Shipping Verification

BLiNK is a production-oriented shipping document verification interface. It demonstrates how an operations team can classify an email, compare a Shipping Instruction against a draft Bill of Lading, inspect grounded source evidence, and make a human-controlled final decision.

## Core rule

The system never finalizes a match or mismatch automatically. Every document-comparison case enters the human review queue, including high-confidence suggestions. Only an explicit reviewer action can produce the final result.

## Included experience

- Operations dashboard with review and mismatch metrics
- Searchable, filterable inbox and case routing
- Official seven-field SI and draft BL comparison
- Side-by-side evidence viewer with raw and normalized values
- Human review queue and reviewer workspace
- Confirm Match, Confirm Mismatch, Correct Value, and Retry Processing actions
- Audit timeline separating system suggestions from human decisions
- Responsive desktop and mobile layouts
- Six realistic hardcoded demo scenarios

## Official comparison scope

1. Shipper
2. Consignee
3. Notify party
4. Port of loading
5. Port of discharge
6. Container count
7. Gross weight in kilograms

## Application structure

- `app/` – routes, root layout, metadata, and providers
- `components/shared/` – BLiNK-specific shared components
- `components/ui/` – reusable interface primitives
- `features/` – dashboard, inbox, evidence, review, case detail, and audit screens
- `domain/` – case models, risk controls, and final-decision rules
- `data/fixtures/` – isolated demo case data
- `state/` – local interactive demo state

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Production build

```bash
npm run build
```

## Data and integration status

This version is a self-contained frontend demo. It uses fixtures and browser-local review state and makes no frontend API calls. A future production backend can replace the fixture repository with services for inbox ingestion, document processing, extraction, normalization, verification, evidence mapping, SQL persistence, and audit storage without changing the primary user flow.
