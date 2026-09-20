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

Never copy an OAuth client secret or downloaded `client_secret*.json` file into this directory.
