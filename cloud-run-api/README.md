# VeriCargo Cloud Run API

This service is the server-side boundary for VeriCargo Gmail authorization and synchronization. It uses Google's web-server OAuth flow to receive an offline Gmail refresh token. The OAuth credential is mounted from Secret Manager and refresh tokens are encrypted before being stored in Firestore.

Use the generated service URL to register this redirect URI in Google Auth Platform:

```text
https://YOUR-CLOUD-RUN-URL/oauth/callback
```

## Local verification

```bash
npm test
npm start
```

Then open `http://localhost:8080/health`.

Required runtime configuration:

- `GOOGLE_OAUTH_CONFIG_PATH`: mounted Web application OAuth JSON file
- `TOKEN_ENCRYPTION_KEY`: base64-encoded 32-byte key supplied by Secret Manager
- `ALLOWED_GMAIL_EMAILS`: comma-separated Gmail allowlist
- `PUBLIC_BASE_URL`: canonical Cloud Run URL without a trailing slash

Optional AI classification configuration:

- `GEMINI_API_KEY`: Google AI Studio API key supplied by Secret Manager
- `GEMINI_MODEL`: Gemini model ID; defaults to `gemini-3.1-flash-lite`

The API key stays in Cloud Run. It is never shipped in the Chrome extension. The authenticated
`POST /api/classify` endpoint processes Gmail messages in small batches and stores the category,
confidence, evidence, model, pipeline version, and classification timestamp in Firestore. The
first pass uses email text and attachment metadata. Only when that evidence is insufficient does
Cloud Run retrieve up to two supported Gmail attachments for a second pass. Machine-readable text,
PDF, and XLSX content uses the lightweight parser; scanned PDFs and images use Gemini Vision/OCR.

Gmail synchronization performs a full Inbox import only for the initial connection. It stores the
newest Gmail `historyId`, then later refreshes use `history.list` to retrieve only changed messages.
New or restored Inbox messages are imported, while messages archived, moved to Spam or Trash, or
deleted are removed from the extension store. A versioned one-time reconciliation cleans up stale
records created before removal tracking was introduced. The history cursor and page token are
persisted between requests. If Gmail reports that the cursor has expired, the service safely falls
back to a new full synchronization. While the side panel is open, the extension runs this incremental
sync automatically every minute and sends only newly imported messages through classification and
document processing; the active view, selection, scroll positions, and in-progress edits are retained.

For messages classified as Document Comparison, `POST /api/documents/process` processes one case
at a time so the extension can display progressive results. It identifies one Shipping Instruction
and one Draft Bill of Lading and extracts the seven comparison fields. It does not look up or reuse
previous extraction artifacts. Machine-readable PDFs, text, and XLSX workbooks use a lightweight
parser followed by Gemini semantic field extraction. Scanned PDFs and images use Gemini vision/OCR.
Missing or ambiguous documents and unreadable or low-quality documents are stored as separate
human-review outcomes.
An unsupported or individually invalid attachment is recorded as an unreadable/low-quality outcome
so it cannot stop the remaining cases in the mailbox.

The seven comparison fields are shipper, consignee, notify party, port of loading, port of
discharge, container count, and gross weight in kilograms. Each field includes the raw value,
normalized value, confidence, page/location, and evidence snippet for both documents.
After extraction, a deterministic comparison engine maps common field aliases to canonical names,
standardizes party and port text, resolves known port names/UN/LOCODEs, extracts container counts,
and converts kilograms, metric tons/tonnes, and pounds to kilograms. It then records a per-field
`MATCH`, `MISMATCH`, or `UNRESOLVED` decision and a conservative confidence score based on both
source extractions. Overall comparison confidence is the mean of the seven field-decision scores;
the extension displays scores below 50 in red, 50–79 in yellow, and 80–100 in green.

For a completed comparison, `GET /api/messages/:id/bl-file?format=pdf|docx|txt` generates a
review-only normalized Draft BL download. `POST /api/messages/:id/bl-draft` accepts the same
format and creates a Gmail draft addressed to the source sender with the generated file attached.
The extension then opens that saved draft in the connected Gmail account. The generated content
prefers normalized Shipping Instruction values and falls back to Draft BL values when an SI field
is unavailable.

`POST /api/messages/:id/review-status` accepts `PENDING` or `COMPLETE` and persists the review
workflow for a processed comparison. Cases without an explicit status are treated as pending, so
existing and newly processed cases enter the Pending Review filter until a reviewer completes them.

`POST /api/messages/:id/category` resolves an uncertain email intent with a human-selected category,
persists the decision, and immediately applies the matching Gmail label. Human decisions are excluded
from later automatic reclassification. `POST /api/messages/:id/review-draft` creates an editable,
sender-addressed Gmail response draft for missing, ambiguous, unreadable, or low-quality document cases.

`POST /api/labels/sync` creates six top-level category labels (`Document Comparison`,
`New SI Requests`, `Invoice Queries`, `General Messages`, `Spam Email`, and `Email Intent Uncertain`)
with one consistent VeriCargo orange color and applies the appropriate label to every
Gemini-classified Gmail message in bulk. It migrates
both the legacy `VeriCargo/<category>` sublabels and `VeriCargo - <category>` labels, removes the
obsolete category labels, and preserves `INBOX` and all unrelated Gmail labels.

Never copy an OAuth client secret or downloaded `client_secret*.json` file into this directory.
