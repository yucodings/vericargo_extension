const PAGE_SIZE = 50;
const AUTOMATIC_SYNC_INTERVAL_MS = 60_000;

const CATEGORIES = [
  { id: "DOCUMENT_COMPARISON", icon: "⇄", label: "Document Comparison", note: "SI and Draft BL verification" },
  { id: "NEW_SI", icon: "+", label: "New SI Requests", note: "New shipping instructions" },
  { id: "INVOICE_QUERY", icon: "$", label: "Invoice Queries", note: "Invoice and payment related" },
  { id: "GENERAL", icon: "✉", label: "General Messages", note: "General operational messages" },
  { id: "SPAM", icon: "×", label: "Spam", note: "Irrelevant or promotional" },
  { id: "HUMAN_REVIEW", icon: "!", label: "Email Intent Uncertain", note: "Intent needs confirmation" },
];

const DOCUMENT_WORKFLOW = {
  MISSING_AMBIGUOUS: "MISSING_AMBIGUOUS_DOCUMENT",
  READY: "READY_FOR_COMPARISON",
  UNREADABLE_LOW_QUALITY: "UNREADABLE_LOW_QUALITY",
};

const HUMAN_REVIEW_OPTIONS = [
  { id: "HUMAN_REVIEW", label: "Email Intent Uncertain" },
  { id: DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS, label: "Missing/Ambiguous Document" },
  { id: DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY, label: "Unreadable/Low Quality" },
];

const INTENT_RESOLUTION_CATEGORIES = CATEGORIES.filter(({ id }) => id !== "HUMAN_REVIEW");

const COMPARISON_FIELDS = [
  { id: "shipper", label: "Shipper" },
  { id: "consignee", label: "Consignee" },
  { id: "notifyParty", label: "Notify Party" },
  { id: "portOfLoading", label: "Port of Loading" },
  { id: "portOfDischarge", label: "Port of Discharge" },
  { id: "containerCount", label: "Container Count" },
  { id: "grossWeightKg", label: "Gross Weight (kg)" },
];

const DRAFT_FIELD_ALIASES = new Map([
  ["shipper", "shipper"], ["exporter", "shipper"], ["shipper exporter", "shipper"],
  ["consignee", "consignee"], ["receiver", "consignee"],
  ["notify", "notifyParty"], ["notify party", "notifyParty"],
  ["port of loading", "portOfLoading"], ["loading port", "portOfLoading"], ["pol", "portOfLoading"],
  ["port of discharge", "portOfDischarge"], ["discharge port", "portOfDischarge"], ["pod", "portOfDischarge"],
  ["container count", "containerCount"], ["number of containers", "containerCount"], ["no of containers", "containerCount"],
  ["gross weight kg", "grossWeightKg"], ["gross weight", "grossWeightKg"], ["gross wt", "grossWeightKg"],
]);

const attachmentCache = new Map();
let activePreviewUrls = [];
let previewRequestId = 0;
let humanActivePreviewUrls = [];
let humanPreviewRequestId = 0;
let labelSyncPromise = null;
let automaticPostProcessingPromise = null;
let automaticSyncPromise = null;
let automaticSyncTimer = null;
let automaticUiRefreshPending = false;
let hostGmailTabId = null;

const state = {
  activeView: "summary",
  categoryFilter: "ALL",
  classification: { configured: false, error: "", loading: false, model: "", pipelineVersion: "", processed: 0, spamPolicyVersion: "", total: 0 },
  blDraft: { busy: false, dismissed: {}, edits: {}, format: "pdf", openId: null, status: "" },
  comparisonPage: 1,
  comparisonReview: { busy: false, status: "" },
  comparisonReviewFilter: "PENDING",
  comparisonSelectedId: null,
  connection: { connected: false, email: "", error: "", loading: false, status: "" },
  currentPage: 1,
  humanReview: { busy: false, drafts: {}, filter: "HUMAN_REVIEW", page: 1, selectedId: null, status: "" },
  labelChange: { busy: false, status: "" },
  messages: [],
  documents: { configured: false, error: "", loading: false, processed: 0, processorVersion: "", total: 0 },
  requestedCount: 0,
  searchQuery: "",
  selectedId: null,
  shownCount: 0,
};

const inbox = document.querySelector("#inbox");
const detail = document.querySelector("#detail");
const connectionStatus = document.querySelector("#connection-status");
const pagination = document.querySelector("#pagination");
const classificationStatus = document.querySelector("#classification-status");
const summaryDashboard = document.querySelector("#summary-dashboard");
const summaryView = document.querySelector("#summary-view");
const casesView = document.querySelector("#cases-view");
const appTabs = document.querySelector(".app-tabs");
const caseSearch = document.querySelector("#case-search");
const categoryFilters = document.querySelector("#category-filters");
const caseResultCount = document.querySelector("#case-result-count");
const comparisonView = document.querySelector("#comparison-view");
const comparisonList = document.querySelector("#comparison-list");
const comparisonPagination = document.querySelector("#comparison-pagination");
const comparisonDetail = document.querySelector("#comparison-detail");
const documentStatus = document.querySelector("#document-status");
const documentWorkflowDashboard = document.querySelector("#document-workflow-dashboard");
const humanReviewView = document.querySelector("#human-review-view");
const humanReviewFilters = document.querySelector("#human-review-filters");
const humanReviewList = document.querySelector("#human-review-list");
const humanReviewPagination = document.querySelector("#human-review-pagination");
const humanReviewDetail = document.querySelector("#human-review-detail");

const h = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const categoryLabel = (category) =>
  category === "UNCLASSIFIED"
    ? "Awaiting classification"
    : CATEGORIES.find((candidate) => candidate.id === category)?.label || "Email Intent Uncertain";

const confidenceBand = (score) => Number(score) < 50 ? "low" : Number(score) < 80 ? "medium" : "high";

const comparisonStatusLabel = (status) => status === "MATCH"
  ? "Match"
  : status === "MISMATCH"
    ? "Mismatch"
    : "Needs review";

const confidenceBarMarkup = (score, label = "confidence") => {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  return `<div class="confidence-meter ${confidenceBand(value)}" title="${h(`${value}% ${label}`)}"><span><i style="width:${value}%"></i></span><b>${value}%</b></div>`;
};

const caseComparisonMarkup = (message) => {
  const comparison = message.documentComparison;
  if (!comparison) {
    if (typeof message.confidence !== "number") return "";
    return `<div class="case-comparison-result">${confidenceBarMarkup(message.confidence, "classification confidence")}</div>`;
  }
  return `<div class="case-comparison-result"><span class="comparison-status status-${comparison.status.toLowerCase()}">${h(comparisonStatusLabel(comparison.status))}</span>${confidenceBarMarkup(comparison.confidence, "comparison confidence")}</div>`;
};

const isCurrentClassification = (message) => {
  if (message.classificationSource === "MANUAL_REVIEW") return true;
  const currentPipeline = message.classificationSource === "GEMINI"
    && message.classificationModel === state.classification.model
    && message.classificationPipelineVersion === state.classification.pipelineVersion;
  const currentSpamPolicy = message.category !== "SPAM"
    || !state.classification.spamPolicyVersion
    || message.classificationSpamPolicyVersion === state.classification.spamPolicyVersion;
  return currentPipeline && currentSpamPolicy;
};

const categoryFor = (message) =>
  isCurrentClassification(message) && CATEGORIES.some((category) => category.id === message.category)
    ? message.category
    : "UNCLASSIFIED";

const searchableText = (message) => [
  message.sender,
  message.senderAddress,
  message.subject,
  message.snippet,
  message.body,
  ...(message.attachments || []).map((attachment) => attachmentNameForSearch(attachment)),
].join(" ").toLocaleLowerCase();

function attachmentNameForSearch(attachment) {
  return typeof attachment === "string" ? attachment : attachment?.filename || "";
}

const filteredMessages = () => {
  const query = state.searchQuery.trim().toLocaleLowerCase();
  return state.messages.filter((message) => {
    const isWorkflowFilter = Object.values(DOCUMENT_WORKFLOW).includes(state.categoryFilter);
    const categoryMatches = state.categoryFilter === "ALL"
      || (isWorkflowFilter
        ? message.documentWorkflowStatus === state.categoryFilter
        : categoryFor(message) === state.categoryFilter);
    const searchMatches = !query || searchableText(message).includes(query);
    return categoryMatches && searchMatches;
  });
};

const allComparisonMessages = () => state.messages.filter(
  (message) => message.documentWorkflowStatus === DOCUMENT_WORKFLOW.READY
    && message.siDocument
    && message.draftBlDocument,
);

const comparisonReviewStatus = (message) => message?.comparisonReviewStatus === "COMPLETE"
  ? "COMPLETE"
  : "PENDING";

const comparisonMessages = () => allComparisonMessages().filter(
  (message) => comparisonReviewStatus(message) === state.comparisonReviewFilter,
);

const preferredComparisonValue = (message, id) => {
  const valueFrom = (field) => String(field?.normalizedValue ?? "").trim()
    || String(field?.rawValue ?? "").trim()
    || "Not available";
  const siValue = valueFrom(message.siDocument?.fields?.[id]);
  return siValue !== "Not available" ? siValue : valueFrom(message.draftBlDocument?.fields?.[id]);
};

const normalizedBlContent = (message) => {
  return [
    "VERICARGO NORMALIZED BILL OF LADING DRAFT",
    "",
    `Source email: ${message.subject || "(No subject)"}`,
    `Shipping Instruction: ${message.siDocument?.filename || "Not available"}`,
    `Draft Bill of Lading: ${message.draftBlDocument?.filename || "Not available"}`,
    "",
    ...COMPARISON_FIELDS.map(({ id, label }) => `${label}: ${preferredComparisonValue(message, id)}`),
    "",
    "Generated by VeriCargo for review. Verify all fields against the source documents before sending.",
  ].join("\n");
};

const comparisonKey = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleUpperCase();

const draftComparisonKey = (fieldId, value) => {
  const text = comparisonKey(value);
  if (fieldId === "grossWeightKg") {
    const number = Number(text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(number)) return text;
    const kilograms = /\b(?:METRIC TON|METRIC TONS|TONNE|TONNES|TON|TONS|MT)\b/.test(text)
      ? number * 1000
      : /\b(?:LB|LBS|POUND|POUNDS)\b/.test(text)
        ? number * 0.45359237
        : number;
    return String(Math.round(kilograms * 1000) / 1000);
  }
  if (fieldId === "containerCount") {
    return text.replace(/,/g, "").match(/\d+(?:\.\d+)?/)?.[0] || text;
  }
  if (fieldId === "portOfLoading" || fieldId === "portOfDischarge") {
    const aliases = [
      ["SINGAPORE", ["SGSIN", "SINGAPORE"]],
      ["PYEONGTAEK SOUTH KOREA", ["KRPTK", "PYEONGTAEK", "PYONGTAEK"]],
      ["BUSAN SOUTH KOREA", ["KRPUS", "BUSAN", "PUSAN"]],
      ["HO CHI MINH CITY VIETNAM", ["VNSGN", "HO CHI MINH", "HOCHIMINH", "CAT LAI"]],
    ];
    return aliases.find(([, patterns]) => patterns.some((pattern) => text.includes(pattern)))?.[0] || text;
  }
  return text.replace(/[^A-Z0-9]+/g, " ").trim();
};

const canonicalDraftFieldId = (label) => DRAFT_FIELD_ALIASES.get(
  String(label || "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
) || null;

const parsedDraftFields = (text) => {
  const values = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const fieldId = canonicalDraftFieldId(line.slice(0, separator));
    if (fieldId) values.set(fieldId, line.slice(separator + 1).trim());
  }
  return values;
};

const longestDraftConsonantRun = (word) => (
  word.toLocaleLowerCase().match(/[b-df-hj-np-tv-z]+/g) || []
).reduce((longest, run) => Math.max(longest, run.length), 0);

const suspiciousDraftWord = (word) => {
  const lower = word.toLocaleLowerCase();
  if (/(.)\1{5,}/.test(lower)) return true;
  if (/(?:asdf|qwer|zxcv|hjkl|uiop){2,}/.test(lower)) return true;
  if (/^(.{2,6})\1{2,}$/.test(lower)) return true;
  if (lower.length < 12) return false;
  const vowelRatio = (lower.match(/[aeiouy]/g) || []).length / lower.length;
  return longestDraftConsonantRun(lower) >= 7 || vowelRatio < 0.14 || vowelRatio > 0.8;
};

const draftContentIssues = (text) => {
  const issues = [];
  let footerSeen = false;
  String(text || "").split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("Generated by VeriCargo")) {
      footerSeen = true;
      return;
    }
    if (footerSeen) {
      issues.push({ excerpt: trimmed.slice(0, 80), line: index + 1 });
      return;
    }
    const suspiciousWords = (trimmed.match(/[A-Za-z]{4,}/g) || []).filter(suspiciousDraftWord);
    const compact = trimmed.replace(/\s/g, "");
    const symbolRatio = compact.length
      ? compact.replace(/[A-Za-z0-9]/g, "").length / compact.length
      : 0;
    if (!suspiciousWords.length && !(compact.length >= 12 && symbolRatio > 0.65)) return;
    issues.push({ excerpt: trimmed.slice(0, 80), line: index + 1 });
  });
  return issues.slice(0, 3);
};

const allDraftFieldSuggestions = (message, text) => {
  const currentFields = parsedDraftFields(text);
  return COMPARISON_FIELDS.flatMap(({ id, label }) => {
    const expectedValue = preferredComparisonValue(message, id);
    const currentValue = currentFields.get(id) ?? "";
    if (draftComparisonKey(id, currentValue) === draftComparisonKey(id, expectedValue)) return [];
    return [{ currentValue, expectedValue, id, label }];
  });
};

const visibleDraftFieldSuggestions = (message, text) => {
  const dismissed = state.blDraft.dismissed[message.id] || {};
  return allDraftFieldSuggestions(message, text).filter(
    (suggestion) => dismissed[suggestion.id] !== draftComparisonKey(suggestion.id, suggestion.currentValue),
  );
};

const draftFieldSuggestionsMarkup = (message, text) => {
  const allSuggestions = allDraftFieldSuggestions(message, text);
  const suggestions = visibleDraftFieldSuggestions(message, text);
  if (!allSuggestions.length) {
    return '<div class="writing-suggestions-ok"><span aria-hidden="true">✓</span><p><strong>Structured fields match</strong><small>The seven Draft BL fields match the normalized SI/BL comparison.</small></p></div>';
  }
  if (!suggestions.length) {
    return '<div class="writing-suggestions-ok kept"><span aria-hidden="true">✓</span><p><strong>Manual changes kept</strong><small>You chose to keep the current field values for this draft.</small></p></div>';
  }
  return `<div class="writing-suggestions-heading"><strong>${suggestions.length} field suggestion${suggestions.length === 1 ? "" : "s"}</strong><span>Compared with normalized SI/BL data</span></div>${suggestions.map((suggestion) => `
    <article class="writing-suggestion">
      <div><strong>${h(suggestion.label)} differs</strong><p>Current: ${h(suggestion.currentValue || "Missing from draft")}</p><p>Normalized: ${h(suggestion.expectedValue)}</p></div>
      <div class="writing-suggestion-actions">
        <button data-bl-apply="${h(suggestion.id)}" type="button">Use normalized</button>
        <button data-bl-keep="${h(suggestion.id)}" type="button">Keep my edit</button>
      </div>
    </article>`).join("")}`;
};

const writingSuggestionsMarkup = (message, text) => {
  const contentIssues = draftContentIssues(text);
  const qualityMarkup = contentIssues.length ? `
    <div class="writing-quality-error">
      <strong>Possible gibberish detected</strong>
      <p>Correct or remove the suspicious text before downloading, composing, or completing this review.</p>
      ${contentIssues.map((issue) => `<small>Line ${issue.line}: ${h(issue.excerpt)}</small>`).join("")}
    </div>` : "";
  return `${qualityMarkup}${draftFieldSuggestionsMarkup(message, text)}`;
};

const replaceDraftField = (text, fieldId, label, value) => {
  const lines = String(text || "").split(/\r?\n/);
  const index = lines.findIndex((line) => canonicalDraftFieldId(line.split(":", 1)[0]) === fieldId);
  if (index >= 0) lines[index] = `${label}: ${value}`;
  else {
    const footerIndex = lines.findIndex((line) => line.startsWith("Generated by VeriCargo"));
    lines.splice(footerIndex >= 0 ? footerIndex : lines.length, 0, `${label}: ${value}`);
  }
  return lines.join("\n");
};

const base64Bytes = (value) => {
  const binary = atob(String(value || "").replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const pendingDocumentMessages = () => state.messages.filter(
  (message) => categoryFor(message) === "DOCUMENT_COMPARISON"
    && message.documentProcessingVersion !== state.documents.processorVersion,
);

function normalizeCaseSelection() {
  const messages = filteredMessages();
  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);
  if (!messages.some((message) => message.id === state.selectedId)) {
    state.selectedId = messages[(state.currentPage - 1) * PAGE_SIZE]?.id || messages[0]?.id || null;
  }
}

const wasResolvedFromIntentReview = (message) => (
  categoryFor(message) !== "HUMAN_REVIEW"
  && message.manualCategoryUndo?.category === "HUMAN_REVIEW"
);

const humanReviewQueues = (filter = state.humanReview.filter) => {
  if (filter === "HUMAN_REVIEW") {
    return {
      pending: state.messages.filter((message) => categoryFor(message) === "HUMAN_REVIEW"),
      reviewed: state.messages.filter(wasResolvedFromIntentReview),
    };
  }
  const matching = state.messages.filter((message) => message.documentWorkflowStatus === filter);
  return {
    pending: matching.filter((message) => !(
      message.humanReviewDraftIssueType === filter && message.humanReviewDraftCreatedAt
    )),
    reviewed: matching.filter((message) => (
      message.humanReviewDraftIssueType === filter && message.humanReviewDraftCreatedAt
    )),
  };
};

const messagesForHumanReview = (filter = state.humanReview.filter) => {
  const queues = humanReviewQueues(filter);
  return [...queues.pending, ...queues.reviewed];
};

function normalizeHumanReviewSelection() {
  const messages = messagesForHumanReview();
  if (!messages.some((message) => message.id === state.humanReview.selectedId)) {
    state.humanReview.selectedId = messages[0]?.id || null;
  }
}

const displayTime = (message) => {
  if (!message.internalDateMs) return "Gmail";
  return new Date(message.internalDateMs).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  });
};

const attachmentDetails = (attachment) => {
  if (typeof attachment === "string") return { attachmentId: "", filename: attachment, mimeType: "File", size: 0 };
  return {
    attachmentId: attachment?.attachmentId || "",
    filename: attachment?.filename || "Unnamed attachment",
    mimeType: attachment?.mimeType || "File",
    size: Number(attachment?.size || 0),
  };
};

const senderGreetingName = (message) => {
  const sender = String(message.sender || "")
    .replace(/[<>].*$/, "")
    .replace(/[_.]+/g, " ")
    .trim();
  if (!sender || /unknown sender/i.test(sender)) return "there";
  const firstName = sender.split(/\s+/)[0].replace(/[^\p{L}\p{N}'-]/gu, "");
  if (!firstName) return "there";
  if (/^\p{L}{1,2}$/u.test(firstName)) return firstName.toLocaleUpperCase();
  return firstName.charAt(0).toLocaleUpperCase() + firstName.slice(1);
};

const affectedDocumentLabels = (message, mode) => {
  const artifacts = Array.isArray(message.documentArtifacts) ? message.documentArtifacts : [];
  const labelForType = (type) => type === "SHIPPING_INSTRUCTION"
    ? "Shipping Instruction"
    : type === "DRAFT_BILL_OF_LADING"
      ? "Draft Bill of Lading"
      : "attachment";
  if (mode === DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY) {
    const labels = artifacts.filter((artifact) => artifact.qualitySufficient === false)
      .map((artifact) => labelForType(artifact.documentType));
    return [...new Set(labels.length ? labels : ["attachment"])];
  }
  const siCount = artifacts.filter((artifact) => artifact.documentType === "SHIPPING_INSTRUCTION").length;
  const blCount = artifacts.filter((artifact) => artifact.documentType === "DRAFT_BILL_OF_LADING").length;
  const missing = [];
  if (siCount === 0) missing.push("Shipping Instruction");
  if (blCount === 0) missing.push("Draft Bill of Lading");
  return missing;
};

const humanReviewEmailDraft = (message, mode) => {
  const name = senderGreetingName(message);
  const affected = affectedDocumentLabels(message, mode);
  const joined = affected.length === 2
    ? `${affected[0]} and ${affected[1]}`
    : affected[0] || "Shipping Instruction and Draft Bill of Lading";
  if (mode === DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY) {
    const verb = affected.length === 2 ? "are" : "is";
    return [
      `Dear ${name},`,
      "",
      `Thank you for your email. We received your documents, but the ${joined} ${verb} unreadable or too low quality to verify.`,
      "",
      "Kindly reply with clear, readable copies of both the Shipping Instruction and Draft Bill of Lading so we can continue the comparison.",
      "",
      "Regards,",
      "VeriCargo",
    ].join("\n");
  }
  const issue = affected.length
    ? `the ${joined} ${affected.length === 2 ? "are" : "is"} missing`
    : "we could not clearly identify one Shipping Instruction and one Draft Bill of Lading";
  return [
    `Dear ${name},`,
    "",
    `Thank you for your email. During our document review, we found that ${issue}.`,
    "",
    "Kindly reply with both the Shipping Instruction and Draft Bill of Lading attached so we can continue the comparison.",
    "",
    "Regards,",
    "VeriCargo",
  ].join("\n");
};

const formatBytes = (bytes) => {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function renderConnection() {
  const requested = Math.max(0, Number(state.requestedCount) || 0);
  const shown = Math.max(0, Number(state.shownCount) || 0);
  const progress = requested ? Math.min(100, Math.round((shown / requested) * 100)) : 0;
  const progressState = state.connection.error
    ? "paused"
    : state.connection.loading || shown < requested
      ? "loading"
      : "complete";
  const progressLabel = requested
    ? `${shown} of ${requested} emails loaded`
    : `${shown} emails loaded`;
  const progressBar = state.connection.connected
    ? `<progress class="sync-progress ${progressState}" max="100" value="${progress}" aria-label="${h(progressLabel)}"></progress>`
    : "";
  if (state.connection.loading) {
    const heading = state.connection.connected
      ? `Signed in: ${state.connection.email}`
      : state.connection.status || "Connecting to Gmail…";
    const status = state.connection.connected
      ? state.connection.status || progressLabel
      : state.connection.error || "Keep this window open while synchronization completes.";
    connectionStatus.innerHTML = `<div class="status-copy"><strong>${h(heading)}</strong><p>${h(status)}</p>${progressBar}</div><div class="connection-actions"><button class="connection-button" data-connection="restart">Cancel</button></div>`;
    return;
  }
  if (state.connection.connected) {
    connectionStatus.innerHTML = `<div class="status-copy"><strong>Signed in: ${h(state.connection.email)}</strong><p>${h(state.connection.error || progressLabel)}</p>${progressBar}</div><div class="connection-actions"><button class="connection-button primary" data-connection="refresh">Refresh</button><button class="connection-button" data-connection="disconnect">Sign out</button></div>`;
    return;
  }
  connectionStatus.innerHTML = `<div class="status-copy"><strong>Connect Gmail</strong><p>${h(state.connection.error || "Authorize once to import your Inbox through Cloud Run.")}</p></div><div class="connection-actions"><button class="connection-button primary" data-connection="connect">Connect</button></div>`;
}

function renderTabs() {
  for (const button of appTabs.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === state.activeView);
    button.setAttribute("aria-selected", String(button.dataset.view === state.activeView));
  }
  summaryView.hidden = state.activeView !== "summary";
  casesView.hidden = state.activeView !== "cases";
  humanReviewView.hidden = state.activeView !== "human-review";
  comparisonView.hidden = state.activeView !== "comparison";
}

function renderClassificationStatus() {
  if (!state.connection.connected) {
    classificationStatus.innerHTML = '<div><strong>AI inbox classification</strong><p>Connect Gmail to classify your messages.</p></div>';
    return;
  }
  if (!state.classification.configured) {
    classificationStatus.innerHTML = '<div><strong>Google AI setup required</strong><p>Your messages are ready. Add the API key to Cloud Run to start classification.</p></div><span class="status-pill pending">Not configured</span>';
    return;
  }
  if (state.classification.loading) {
    classificationStatus.innerHTML = `<div><strong>Classifying Inbox…</strong><p>${h(`${state.classification.processed} of ${state.classification.total || state.shownCount} processed`)}</p></div><span class="status-pill running">Running</span>`;
    return;
  }
  if (state.classification.error) {
    classificationStatus.innerHTML = `<div><strong>Classification needs attention</strong><p>${h(state.classification.error)}</p></div><button class="classification-button" data-classification="start">Retry</button>`;
    return;
  }
  const pending = state.messages.filter((message) => !isCurrentClassification(message)).length;
  classificationStatus.innerHTML = pending
    ? `<div><strong>${pending} message${pending === 1 ? "" : "s"} queued for classification</strong><p>${h(state.classification.model || "Gemini")} will classify new Inbox mail automatically.</p></div><span class="status-pill pending">Automatic</span>`
    : `<div><strong>Inbox classification complete</strong><p>${state.shownCount} messages classified by ${h(state.classification.model || "Gemini")}.</p></div><span class="status-pill complete">Complete</span>`;
}

function renderCaseControls() {
  const options = [
    { id: "ALL", label: "All" },
    ...CATEGORIES.map(({ id, label }) => ({ id, label })),
    { id: "UNCLASSIFIED", label: "Awaiting AI" },
    { id: DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS, label: "Missing/Ambiguous Document" },
    { id: DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY, label: "Unreadable/Low Quality" },
  ];
  const counts = Object.fromEntries(options.map(({ id }) => [id, 0]));
  counts.ALL = state.messages.length;
  for (const message of state.messages) {
    counts[categoryFor(message)] += 1;
    if (message.documentWorkflowStatus && counts[message.documentWorkflowStatus] !== undefined) {
      counts[message.documentWorkflowStatus] += 1;
    }
  }
  categoryFilters.innerHTML = options.map((option) => `
    <button class="filter-chip ${["HUMAN_REVIEW", DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS, DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY].includes(option.id) ? "alert-filter" : ""} ${state.categoryFilter === option.id ? "active" : ""}" data-filter-category="${option.id}" type="button">
      ${h(option.label)} <span>${counts[option.id]}</span>
    </button>`).join("");
  const results = filteredMessages();
  caseResultCount.innerHTML = `<strong>${results.length}</strong> result${results.length === 1 ? "" : "s"}${state.categoryFilter !== "ALL" || state.searchQuery ? ' <button data-clear-filters type="button">Clear filters</button>' : ""}`;
  if (caseSearch.value !== state.searchQuery) caseSearch.value = state.searchQuery;
}

function renderSummary() {
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category.id, 0]));
  let awaitingClassification = 0;
  for (const message of state.messages) {
    const category = categoryFor(message);
    if (category === "UNCLASSIFIED") awaitingClassification += 1;
    else counts[category] += 1;
  }
  summaryDashboard.innerHTML = `
    <div class="summary-heading">
      <div><span class="eyebrow">Inbox overview</span><h1>${state.shownCount} messages</h1><p>Every imported email is included. Categories update after AI classification.</p></div>
      <div class="summary-metrics"><span class="summary-total">${state.requestedCount} requested</span>${awaitingClassification ? `<span class="summary-total pending-total">${awaitingClassification} awaiting AI</span>` : ""}</div>
    </div>
    <div class="category-grid">
      ${CATEGORIES.map((category) => `
        <button class="category-card category-${category.id.toLowerCase()}" data-category="${category.id}" type="button">
          <span class="category-icon">${category.icon}</span>
          <span class="category-copy"><strong>${h(category.label)}</strong><small>${h(category.note)}</small></span>
          <span class="category-count">${counts[category.id]}</span>
        </button>`).join("")}
    </div>`;
}

function renderDocumentStatus() {
  const documentCases = state.messages.filter((message) => categoryFor(message) === "DOCUMENT_COMPARISON");
  const pending = pendingDocumentMessages().length;
  if (!state.connection.connected) {
    documentStatus.innerHTML = '<div><strong>SI/BL document processing</strong><p>Connect Gmail to process document-comparison cases.</p></div>';
    return;
  }
  if (!state.documents.configured) {
    documentStatus.innerHTML = '<div><strong>Document processing unavailable</strong><p>The Cloud Run document processor is not configured.</p></div>';
    return;
  }
  if (state.documents.loading) {
    documentStatus.innerHTML = `<div><strong>Processing SI and Draft BL documents…</strong><p>${h(`${state.documents.processed} of ${state.documents.total || documentCases.length} cases processed`)}</p></div><span class="status-pill running">Running</span>`;
    return;
  }
  if (state.documents.error) {
    documentStatus.innerHTML = `<div><strong>Document processing needs attention</strong><p>${h(state.documents.error)}</p></div><button class="classification-button" data-documents="start">Retry</button>`;
    return;
  }
  documentStatus.innerHTML = pending
    ? `<div><strong>${pending} document-comparison cases queued</strong><p>Automatic processing will identify SI and Draft BL files, parse machine-readable content or use Gemini OCR, then extract seven fields.</p></div><span class="status-pill pending">Automatic</span>`
    : `<div><strong>Document processing complete</strong><p>${documentCases.length} document-comparison cases checked.</p></div><span class="status-pill complete">Complete</span>`;
}

function renderDocumentWorkflowDashboard() {
  const missing = state.messages.filter(
    (message) => message.documentWorkflowStatus === DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS,
  ).length;
  const unreadable = state.messages.filter(
    (message) => message.documentWorkflowStatus === DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY,
  ).length;
  const ready = allComparisonMessages().length;
  documentWorkflowDashboard.innerHTML = `
    <div class="workflow-heading"><div><span class="eyebrow">Document workflow</span><h2>SI and Draft BL processing</h2><p>Review document exceptions or open completed seven-field extractions.</p></div><span class="summary-total">${ready} ready</span></div>
    <div class="workflow-grid">
      <button class="workflow-card" data-workflow-status="${DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS}" type="button">
        <span class="workflow-icon">!</span><span><strong>Human Review – Missing/Ambiguous Document</strong><small>SI or Draft BL could not be identified clearly</small></span><b>${missing}</b>
      </button>
      <button class="workflow-card" data-workflow-status="${DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY}" type="button">
        <span class="workflow-icon">!</span><span><strong>Human Review – Unreadable/Low Quality</strong><small>Parser or Gemini OCR could not obtain reliable content</small></span><b>${unreadable}</b>
      </button>
    </div>`;
}

function renderComparison() {
  const allMessages = allComparisonMessages();
  const messages = comparisonMessages();
  const pendingCount = allMessages.filter((message) => comparisonReviewStatus(message) === "PENDING").length;
  const completeCount = allMessages.length - pendingCount;
  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  state.comparisonPage = Math.min(totalPages, Math.max(1, state.comparisonPage));
  if (!messages.some((message) => message.id === state.comparisonSelectedId)) {
    state.comparisonSelectedId = messages[(state.comparisonPage - 1) * PAGE_SIZE]?.id || null;
  }
  const selectedIndex = messages.findIndex((message) => message.id === state.comparisonSelectedId);
  if (selectedIndex >= 0) state.comparisonPage = Math.floor(selectedIndex / PAGE_SIZE) + 1;
  const startIndex = (state.comparisonPage - 1) * PAGE_SIZE;
  const visibleMessages = messages.slice(startIndex, startIndex + PAGE_SIZE);
  comparisonList.innerHTML = `<div class="comparison-list-toolbar">
      <div class="comparison-list-heading"><strong>Processed cases</strong><span>${allMessages.length}</span></div>
      <div class="comparison-review-filters" role="group" aria-label="Filter processed cases by review status">
        <button class="comparison-review-filter pending ${state.comparisonReviewFilter === "PENDING" ? "active" : ""}" data-review-filter="PENDING" type="button" aria-pressed="${state.comparisonReviewFilter === "PENDING"}">
          <span>Pending</span><b>${pendingCount}</b>
        </button>
        <button class="comparison-review-filter complete ${state.comparisonReviewFilter === "COMPLETE" ? "active" : ""}" data-review-filter="COMPLETE" type="button" aria-pressed="${state.comparisonReviewFilter === "COMPLETE"}">
          <span>Complete</span><b>${completeCount}</b>
        </button>
      </div>
      ${state.comparisonReview.status ? `<p class="comparison-review-feedback" aria-live="polite">${h(state.comparisonReview.status)}</p>` : ""}
    </div>${messages.length
    ? visibleMessages.map((message) => `
        <button class="comparison-case ${message.id === state.comparisonSelectedId ? "active" : ""}" data-comparison-id="${h(message.id)}" type="button">
          <strong>${h(message.subject)}</strong><span>${h(message.sender)} · ${h(displayTime(message))}</span>${caseComparisonMarkup(message)}
        </button>`).join("")
    : `<div class="empty-list">No ${state.comparisonReviewFilter === "PENDING" ? "pending" : "complete"} cases in this filter.</div>`}`;

  if (messages.length <= PAGE_SIZE) {
    comparisonPagination.replaceChildren();
  } else {
    const pageStart = startIndex + 1;
    const pageEnd = Math.min(startIndex + PAGE_SIZE, messages.length);
    comparisonPagination.innerHTML = `
      <button class="pagination-button" data-comparison-page="previous" ${state.comparisonPage === 1 ? "disabled" : ""}>Previous</button>
      <span class="pagination-info">${pageStart}–${pageEnd} of ${messages.length}</span>
      <button class="pagination-button" data-comparison-page="next" ${state.comparisonPage === totalPages ? "disabled" : ""}>Next</button>`;
  }

  const message = messages.find((candidate) => candidate.id === state.comparisonSelectedId);
  if (!message) {
    comparisonDetail.innerHTML = '<div class="empty-state"><div class="empty-icon">&#8644;</div><h2>Select a processed case</h2><p>The seven extracted SI and Draft BL fields will appear here.</p></div>';
    return;
  }
  const comparison = message.documentComparison || null;
  const fieldDecisionMarkup = (fieldId) => {
    const decision = comparison?.fields?.[fieldId];
    if (!decision) return "";
    return `<div class="field-decision status-${decision.status.toLowerCase()}"><span>${h(comparisonStatusLabel(decision.status))}</span>${confidenceBarMarkup(decision.confidence, `${COMPARISON_FIELDS.find(({ id }) => id === fieldId)?.label || "field"} comparison confidence`)}</div>`;
  };
  const fieldCell = (field) => {
    const originalValue = String(field?.rawValue ?? "").trim() || "Not found in attachment";
    const normalizedValue = String(field?.normalizedValue ?? "").trim() || originalValue;
    const evidence = field?.evidence ? `Evidence: ${field.evidence}` : "No evidence snippet available.";
    return `<div class="comparison-value"><strong>${h(normalizedValue)}</strong><small>${h(`${field?.confidence || 0}% · ${field?.page ? `Page ${field.page}` : "Location unavailable"}`)}</small><p class="comparison-original" title="${h(evidence)}"><b>Original attachment:</b> ${h(originalValue)}</p></div>`;
  };
  const draftIsOpen = state.blDraft.openId === message.id;
  const draftText = Object.hasOwn(state.blDraft.edits, message.id)
    ? state.blDraft.edits[message.id]
    : normalizedBlContent(message);
  const draftHasContentIssues = draftContentIssues(draftText).length > 0;
  const draftPanel = draftIsOpen ? `
      <div class="bl-draft-panel">
        <p class="bl-draft-note">Generated from the normalized SI/BL comparison. Edit and review every field before sending.</p>
        <label class="bl-draft-format">File format
          <select data-bl-format ${state.blDraft.busy ? "disabled" : ""}>
            <option value="pdf" ${state.blDraft.format === "pdf" ? "selected" : ""}>PDF</option>
            <option value="docx" ${state.blDraft.format === "docx" ? "selected" : ""}>DOCX</option>
            <option value="txt" ${state.blDraft.format === "txt" ? "selected" : ""}>TXT</option>
          </select>
        </label>
        <label class="bl-draft-preview-label" for="bl-draft-preview">Draft content</label>
        <textarea id="bl-draft-preview" class="bl-draft-preview" data-bl-editor lang="en" maxlength="20000" spellcheck="true" autocapitalize="sentences" autocomplete="off" ${state.blDraft.busy ? "disabled" : ""}>${h(draftText)}</textarea>
        <p class="bl-writing-help"><span aria-hidden="true">✓</span> Writing suggestions are on. Spelling errors are underlined; shipping-field changes are checked against normalized SI/BL data.</p>
        <div class="writing-suggestions" data-writing-suggestions aria-live="polite">${writingSuggestionsMarkup(message, draftText)}</div>
        <div class="bl-draft-actions">
          <button class="secondary-button" data-bl-reset type="button" ${state.blDraft.busy ? "disabled" : ""}>Reset to normalized</button>
          <button class="secondary-button" data-bl-download type="button" ${state.blDraft.busy || draftHasContentIssues ? "disabled" : ""}>Download file</button>
          <button class="primary-button" data-bl-compose type="button" ${state.blDraft.busy || draftHasContentIssues ? "disabled" : ""}>Compose email in Gmail</button>
        </div>
        <p class="bl-draft-status" data-bl-status aria-live="polite">${h(state.blDraft.status)}</p>
      </div>` : "";
  const reviewStatus = comparisonReviewStatus(message);
  const reviewIsComplete = reviewStatus === "COMPLETE";
  comparisonDetail.innerHTML = `
    <div class="comparison-header"><span class="eyebrow">SI/BL document comparison</span><h1>${h(message.subject)}</h1><p>${h(message.senderAddress)} · ${h(displayTime(message))}</p></div>
    <div class="document-pair">
      <div><strong>Shipping Instruction</strong><span>${h(message.siDocument.filename)}</span><small>${h(message.siDocument.processingMethod)} · ${h(`${message.siDocument.qualityScore}% quality`)}</small></div>
      <div><strong>Draft Bill of Lading</strong><span>${h(message.draftBlDocument.filename)}</span><small>${h(message.draftBlDocument.processingMethod)} · ${h(`${message.draftBlDocument.qualityScore}% quality`)}</small></div>
    </div>
    ${comparison ? `<div class="comparison-summary status-${comparison.status.toLowerCase()}">
      <div><span class="comparison-status status-${comparison.status.toLowerCase()}">${h(comparisonStatusLabel(comparison.status))}</span><strong>${h(`${comparison.matchedCount} matched · ${comparison.mismatchCount} mismatched · ${comparison.unresolvedCount} unresolved`)}</strong></div>
      <div><small>Comparison confidence</small>${confidenceBarMarkup(comparison.confidence, "comparison confidence")}</div>
    </div>` : ""}
    <div class="comparison-table" role="table" aria-label="Seven extracted SI and Draft BL fields">
      <div class="comparison-row comparison-table-head" role="row"><div>Field</div><div>Shipping Instruction</div><div>Draft Bill of Lading</div></div>
      ${COMPARISON_FIELDS.map(({ id, label }) => `<div class="comparison-row ${comparison?.fields?.[id] ? `row-${comparison.fields[id].status.toLowerCase()}` : ""}" role="row"><div class="comparison-field"><strong>${h(label)}</strong>${fieldDecisionMarkup(id)}</div>${fieldCell(message.siDocument.fields?.[id])}${fieldCell(message.draftBlDocument.fields?.[id])}</div>`).join("")}
    </div>
    <section class="bl-draft-section">
      <button class="bl-draft-toggle" data-bl-toggle type="button" aria-expanded="${draftIsOpen}">${draftIsOpen ? "Hide Draft BL" : "Draft BL"}</button>
      ${draftPanel}
    </section>
    <section class="comparison-review-action ${reviewIsComplete ? "complete" : "pending"}">
      <div><strong>${reviewIsComplete ? "Complete" : "Pending"}</strong><p>${reviewIsComplete ? "This case has been reviewed and is filed under Complete." : draftHasContentIssues ? "Correct the possible gibberish before marking this review complete." : "Confirm the comparison and Draft BL before marking it complete."}</p></div>
      <button data-review-status-toggle type="button" ${state.comparisonReview.busy ? "disabled" : ""}>${state.comparisonReview.busy ? "Saving…" : reviewIsComplete ? "Pending" : "Complete"}</button>
    </section>`;
  const reviewStatusButton = comparisonDetail.querySelector("[data-review-status-toggle]");
  if (reviewStatusButton && !reviewIsComplete && draftHasContentIssues) reviewStatusButton.disabled = true;
}

function renderInbox() {
  if (!state.connection.connected) {
    inbox.innerHTML = '<div class="empty-list">Connect Gmail to load your Inbox.</div>';
    return;
  }
  const start = (state.currentPage - 1) * PAGE_SIZE;
  const messages = filteredMessages().slice(start, start + PAGE_SIZE);
  inbox.innerHTML = messages.length
    ? messages.map((message) => {
      const category = categoryFor(message);
      return `
        <button class="mail-row ${message.id === state.selectedId ? "selected" : ""}" data-email-id="${h(message.id)}">
          <span class="mail-line"><span class="sender">${h(message.sender)}</span><span class="time">${h(displayTime(message))}</span></span>
          <span class="subject">${h(message.subject)}</span>
          <span class="preview">${h(message.snippet || message.body)}</span>
          <span class="badges"><span class="badge badge-${category.toLowerCase()}">${h(categoryLabel(category))}</span></span>
          ${caseComparisonMarkup(message)}
        </button>`;
    }).join("")
    : '<div class="empty-list">No messages match the current filters.</div>';
}

function renderPagination() {
  const total = filteredMessages().length;
  if (!state.connection.connected || total <= PAGE_SIZE) {
    pagination.replaceChildren();
    return;
  }
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const start = (state.currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(state.currentPage * PAGE_SIZE, total);
  pagination.innerHTML = `
    <button class="pagination-button" data-page="previous" ${state.currentPage === 1 ? "disabled" : ""}>Previous</button>
    <span class="pagination-info">${start}–${end} of ${total}</span>
    <button class="pagination-button" data-page="next" ${state.currentPage === totalPages ? "disabled" : ""}>Next</button>`;
}

function renderDetail() {
  previewRequestId += 1;
  for (const url of activePreviewUrls) URL.revokeObjectURL(url);
  activePreviewUrls = [];
  const message = state.messages.find((candidate) => candidate.id === state.selectedId);
  if (!message) {
    detail.replaceChildren(document.querySelector("#empty-state").content.cloneNode(true));
    return;
  }
  const category = categoryFor(message);
  const previousCategory = message.manualCategoryUndo?.category;
  const canRevokeLabelChange = Boolean(
    previousCategory && CATEGORIES.some(({ id }) => id === previousCategory),
  );
  const classificationInsight = category === "UNCLASSIFIED"
    ? '<div class="classification-insight pending"><div><strong>Awaiting AI classification</strong><span>Pending</span></div><p>This result will update automatically when its classification batch completes.</p></div>'
    : `<div class="classification-insight ${category === "HUMAN_REVIEW" ? "review" : ""}"><div><strong>${h(categoryLabel(category))}</strong><span>${h(`${message.confidence ?? 0}% confidence`)}</span></div><p>${h(message.classificationReason || "Classified by Gemini.")}</p>${message.attachmentAssisted ? '<small>Attachment-assisted classification</small>' : ""}${category === "HUMAN_REVIEW" ? '<button class="open-human-review-button" data-open-human-review="HUMAN_REVIEW" type="button">Open Human Review</button>' : ""}</div>`;
  const documentInsight = message.documentWorkflowStatus === DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS
    ? `<div class="document-insight review"><strong>Human Review – Missing/Ambiguous Document</strong><p>${h(message.documentReviewReason)}</p><button class="open-human-review-button" data-open-human-review="${DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS}" type="button">Open Human Review</button></div>`
    : message.documentWorkflowStatus === DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY
      ? `<div class="document-insight review"><strong>Human Review – Unreadable/Low Quality</strong><p>${h(message.documentReviewReason)}</p><button class="open-human-review-button" data-open-human-review="${DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY}" type="button">Open Human Review</button></div>`
      : message.documentWorkflowStatus === DOCUMENT_WORKFLOW.READY
        ? `<div class="document-insight ready ${message.documentComparison ? `status-${message.documentComparison.status.toLowerCase()}` : ""}"><div><strong>${h(message.documentComparison ? `SI/BL ${comparisonStatusLabel(message.documentComparison.status)}` : "Seven fields extracted")}</strong>${message.documentComparison ? confidenceBarMarkup(message.documentComparison.confidence, "comparison confidence") : ""}</div><button data-open-comparison type="button">Open SI/BL Document Comparison</button></div>`
        : "";
  const attachments = (message.attachments || []).map(attachmentDetails);
  const attachmentCards = attachments.length
    ? attachments.map((attachment, index) => `
        <article class="attachment-preview" data-attachment-index="${index}">
          <div class="file-preview" data-preview><span>${attachment.mimeType.includes("pdf") ? "PDF" : "FILE"}</span></div>
          <strong title="${h(attachment.filename)}">${h(attachment.filename)}</strong>
          <small>${h(attachment.mimeType)} · ${h(formatBytes(attachment.size))}</small>
          <p data-preview-status>${attachment.attachmentId ? "Loading secure preview…" : "Preview is unavailable for this attachment."}</p>
        </article>`).join("")
    : '<div class="no-attachments">No attachments on this email.</div>';
  detail.innerHTML = `
    <div class="case-header">
      <div class="case-title-row"><div><span class="eyebrow">${h(categoryLabel(category))}</span><h1>${h(message.subject)}</h1></div><div class="case-header-actions">${canRevokeLabelChange ? `<button class="revoke-label-button" data-revoke-label-change type="button" ${state.labelChange.busy ? "disabled" : ""}>${state.labelChange.busy ? "Revokingâ€¦" : "Revoke label change"}</button>` : ""}<button class="view-gmail-button" data-view-gmail type="button">View Email in Gmail</button></div></div>
      <p>${h(message.senderAddress)} · ${h(displayTime(message))}</p>
      ${canRevokeLabelChange ? `<p class="label-change-status">Changed from ${h(categoryLabel(previousCategory))} to ${h(categoryLabel(category))}. ${h(state.labelChange.status)}</p>` : ""}
    </div>
    ${classificationInsight}
    ${documentInsight}
    <div class="detail-body">
      <section class="message-content"><h2>Email content</h2><p>${h(message.body)}</p></section>
      <section class="attachments-section"><div class="section-heading"><h2>Files</h2><span>${attachments.length}</span></div><div class="attachment-grid">${attachmentCards}</div></section>
    </div>`;
  void loadAttachmentPreviews(message, attachments, previewRequestId);
}

function renderHumanReview() {
  normalizeHumanReviewSelection();
  const counts = Object.fromEntries(HUMAN_REVIEW_OPTIONS.map(({ id }) => [id, humanReviewQueues(id).pending.length]));
  humanReviewFilters.innerHTML = HUMAN_REVIEW_OPTIONS.map((option) => `
    <button class="human-review-filter ${state.humanReview.filter === option.id ? "active" : ""}" data-human-filter="${option.id}" type="button" aria-pressed="${state.humanReview.filter === option.id}">
      <span>${h(option.label)}</span><b>${counts[option.id]}</b>
    </button>`).join("");

  const queues = humanReviewQueues();
  const messages = [...queues.pending, ...queues.reviewed];
  const activeLabel = HUMAN_REVIEW_OPTIONS.find(({ id }) => id === state.humanReview.filter)?.label || "Human Review";
  const queueRows = (queue, reviewed) => queue.length
    ? queue.map((message) => {
      const currentCategory = categoryFor(message);
      const badgeLabel = reviewed && state.humanReview.filter === "HUMAN_REVIEW"
        ? categoryLabel(currentCategory)
        : activeLabel;
      return `
        <button class="mail-row ${reviewed ? "reviewed" : "pending"} ${message.id === state.humanReview.selectedId ? "selected" : ""}" data-human-message-id="${h(message.id)}" type="button">
          <span class="mail-line"><span class="sender">${h(message.sender)}</span><span class="time">${h(displayTime(message))}</span></span>
          <span class="subject">${h(message.subject)}</span>
          <span class="preview">${h(message.snippet || message.body)}</span>
          <span class="badges"><span class="badge ${reviewed ? "badge-reviewed" : "badge-human_review"}">${h(reviewed ? `Reviewed · ${badgeLabel}` : badgeLabel)}</span></span>
        </button>`;
    }).join("")
    : `<div class="empty-list compact">${reviewed ? "No reviewed emails yet." : `No cases currently require ${h(activeLabel.toLowerCase())} review.`}</div>`;
  humanReviewList.innerHTML = `
    <section class="human-review-queue pending-queue">
      <header><span>Pending</span><b>${queues.pending.length}</b></header>
      <div class="human-review-queue-body" data-human-queue="pending">${queueRows(queues.pending, false)}</div>
    </section>
    <section class="human-review-queue reviewed-queue">
      <header><span>Reviewed</span><b>${queues.reviewed.length}</b></header>
      <div class="human-review-queue-body" data-human-queue="reviewed">${queueRows(queues.reviewed, true)}</div>
    </section>`;
  humanReviewPagination.replaceChildren();

  humanPreviewRequestId += 1;
  for (const url of humanActivePreviewUrls) URL.revokeObjectURL(url);
  humanActivePreviewUrls = [];
  const message = messages.find((candidate) => candidate.id === state.humanReview.selectedId);
  if (!message) {
    humanReviewDetail.innerHTML = '<div class="empty-state"><div class="empty-icon">!</div><h2>No review case selected</h2><p>Select another Human Review queue or wait for a new case.</p></div>';
    return;
  }

  const attachments = (message.attachments || []).map(attachmentDetails);
  const attachmentCards = attachments.length
    ? attachments.map((attachment, index) => `
        <article class="attachment-preview" data-human-attachment-index="${index}">
          <div class="file-preview" data-human-preview><span>${attachment.mimeType.includes("pdf") ? "PDF" : "FILE"}</span></div>
          <strong title="${h(attachment.filename)}">${h(attachment.filename)}</strong>
          <small>${h(attachment.mimeType)} · ${h(formatBytes(attachment.size))}</small>
          <p data-human-preview-status>${attachment.attachmentId ? "Loading secure preview…" : "Preview is unavailable for this attachment."}</p>
        </article>`).join("")
    : '<div class="no-attachments">No attachments on this email.</div>';
  const isIntentReview = state.humanReview.filter === "HUMAN_REVIEW";
  const isReviewedIntent = isIntentReview && wasResolvedFromIntentReview(message);
  let actionMarkup;
  if (isReviewedIntent) {
    actionMarkup = `<section class="human-review-action reviewed-action">
      <h2>Label review completed</h2>
      <p>This email was changed from ${h(categoryLabel("HUMAN_REVIEW"))} to ${h(categoryLabel(categoryFor(message)))}.</p>
      <p class="human-review-action-status" aria-live="polite">${h(state.humanReview.status)}</p>
    </section>`;
  } else if (isIntentReview) {
    actionMarkup = `<section class="human-review-action">
      <h2>Choose the correct email label</h2>
      <p>Selecting a label resolves this review, updates the case, and applies the matching Gmail label.</p>
      <div class="intent-label-actions">
        ${INTENT_RESOLUTION_CATEGORIES.map((category) => `<button class="intent-label-button label-${category.id.toLowerCase()}" data-resolve-category="${category.id}" type="button" ${state.humanReview.busy ? "disabled" : ""}>${h(category.label)}</button>`).join("")}
      </div>
      <p class="human-review-action-status" aria-live="polite">${h(state.humanReview.status)}</p>
    </section>`;
  } else {
    const draftText = Object.hasOwn(state.humanReview.drafts, message.id)
      ? state.humanReview.drafts[message.id]
      : humanReviewEmailDraft(message, state.humanReview.filter);
    actionMarkup = `<section class="human-review-action">
      <h2>Request corrected documents</h2>
      <p>Review and edit this sender-aware response before creating the Gmail draft.</p>
      <label class="review-email-label" for="review-email-editor">Response email</label>
      <textarea id="review-email-editor" class="review-email-editor" data-review-email-editor maxlength="20000" spellcheck="true" ${state.humanReview.busy ? "disabled" : ""}>${h(draftText)}</textarea>
      <button class="review-email-compose" data-compose-review-email type="button" ${state.humanReview.busy ? "disabled" : ""}>${state.humanReview.busy ? "Creating Gmail draft…" : "Compose Response in Gmail"}</button>
      <p class="human-review-action-status" aria-live="polite">${h(state.humanReview.status)}</p>
    </section>`;
  }
  humanReviewDetail.innerHTML = `
    <div class="case-header">
      <div class="case-title-row"><div><span class="eyebrow">${h(isReviewedIntent ? `Reviewed · ${categoryLabel(categoryFor(message))}` : activeLabel)}</span><h1>${h(message.subject)}</h1></div><div class="case-header-actions">${isReviewedIntent ? `<button class="revoke-label-button" data-human-revoke-label-change type="button" ${state.humanReview.busy ? "disabled" : ""}>${state.humanReview.busy ? "Revoking…" : "Revoke label change"}</button>` : ""}<button class="view-gmail-button" data-human-view-gmail type="button">View Email in Gmail</button></div></div>
      <p>${h(message.senderAddress)} · ${h(displayTime(message))}</p>
    </div>
    <div class="classification-insight ${isReviewedIntent ? "reviewed" : "review"}"><div><strong>${h(isReviewedIntent ? `Reviewed as ${categoryLabel(categoryFor(message))}` : activeLabel)}</strong><span>${h(`${message.confidence ?? 0}% confidence`)}</span></div><p>${h(isIntentReview ? message.classificationReason || message.reviewReason || "The email intent needs confirmation." : message.documentReviewReason || "The document issue needs manual review.")}</p></div>
    <div class="detail-body">
      <section class="message-content"><h2>Email content</h2><p>${h(message.body)}</p></section>
      <section class="attachments-section"><div class="section-heading"><h2>Files</h2><span>${attachments.length}</span></div><div class="attachment-grid">${attachmentCards}</div></section>
    </div>
    ${actionMarkup}`;
  void loadHumanAttachmentPreviews(message, attachments, humanPreviewRequestId);
}

const decodeAttachment = (data) => {
  const base64 = data.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(data.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

async function loadAttachmentPreviews(message, attachments, requestId) {
  await Promise.all(attachments.map(async (attachment, index) => {
    if (!attachment.attachmentId) return;
    const card = detail.querySelector(`[data-attachment-index="${index}"]`);
    const preview = card?.querySelector("[data-preview]");
    const status = card?.querySelector("[data-preview-status]");
    if (!preview || !status) return;
    try {
      const cacheKey = `${message.id}:${attachment.attachmentId}`;
      let payload = attachmentCache.get(cacheKey);
      if (!payload) {
        payload = await globalThis.VeriCargoCloud.attachment(message.id, attachment.attachmentId);
        attachmentCache.set(cacheKey, payload);
      }
      if (requestId !== previewRequestId) return;
      const bytes = decodeAttachment(payload.data);
      const mimeType = payload.mimeType || attachment.mimeType;
      if (mimeType.startsWith("text/")) {
        const content = document.createElement("pre");
        content.className = "text-preview";
        content.textContent = new TextDecoder().decode(bytes).slice(0, 12000);
        preview.replaceChildren(content);
      } else {
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        activePreviewUrls.push(objectUrl);
        if (mimeType.startsWith("image/")) {
          const image = document.createElement("img");
          image.alt = payload.filename || attachment.filename;
          image.src = objectUrl;
          preview.replaceChildren(image);
        } else if (mimeType === "application/pdf") {
          const frame = document.createElement("iframe");
          frame.src = objectUrl;
          frame.title = `Preview of ${payload.filename || attachment.filename}`;
          preview.replaceChildren(frame);
        } else {
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = payload.filename || attachment.filename;
          link.textContent = "Open file";
          preview.replaceChildren(link);
        }
      }
      status.textContent = "Loaded securely from Gmail.";
    } catch (error) {
      if (requestId !== previewRequestId) return;
      status.textContent = error instanceof Error ? error.message : "Preview could not be loaded.";
      preview.classList.add("preview-error");
    }
  }));
}

async function loadHumanAttachmentPreviews(message, attachments, requestId) {
  await Promise.all(attachments.map(async (attachment, index) => {
    if (!attachment.attachmentId) return;
    const card = humanReviewDetail.querySelector(`[data-human-attachment-index="${index}"]`);
    const preview = card?.querySelector("[data-human-preview]");
    const status = card?.querySelector("[data-human-preview-status]");
    if (!preview || !status) return;
    try {
      const cacheKey = `${message.id}:${attachment.attachmentId}`;
      let payload = attachmentCache.get(cacheKey);
      if (!payload) {
        payload = await globalThis.VeriCargoCloud.attachment(message.id, attachment.attachmentId);
        attachmentCache.set(cacheKey, payload);
      }
      if (requestId !== humanPreviewRequestId) return;
      const bytes = decodeAttachment(payload.data);
      const mimeType = payload.mimeType || attachment.mimeType;
      if (mimeType.startsWith("text/")) {
        const content = document.createElement("pre");
        content.className = "text-preview";
        content.textContent = new TextDecoder().decode(bytes).slice(0, 12000);
        preview.replaceChildren(content);
      } else {
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        humanActivePreviewUrls.push(objectUrl);
        if (mimeType.startsWith("image/")) {
          const image = document.createElement("img");
          image.alt = payload.filename || attachment.filename;
          image.src = objectUrl;
          preview.replaceChildren(image);
        } else if (mimeType === "application/pdf") {
          const frame = document.createElement("iframe");
          frame.src = objectUrl;
          frame.title = `Preview of ${payload.filename || attachment.filename}`;
          preview.replaceChildren(frame);
        } else {
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = payload.filename || attachment.filename;
          link.textContent = "Open file";
          preview.replaceChildren(link);
        }
      }
      status.textContent = "Loaded securely from Gmail.";
    } catch (error) {
      if (requestId !== humanPreviewRequestId) return;
      status.textContent = error instanceof Error ? error.message : "Preview could not be loaded.";
      preview.classList.add("preview-error");
    }
  }));
}

function render() {
  normalizeCaseSelection();
  renderConnection();
  renderTabs();
  renderClassificationStatus();
  renderSummary();
  renderDocumentStatus();
  renderDocumentWorkflowDashboard();
  renderCaseControls();
  renderInbox();
  renderPagination();
  renderDetail();
  renderHumanReview();
  renderComparison();
}

async function loadMessages() {
  const result = await globalThis.VeriCargoCloud.messages();
  state.messages = result.messages;
  state.requestedCount = result.requested;
  state.shownCount = result.shown;
  normalizeCaseSelection();
}

async function loadClassificationStatus() {
  const result = await globalThis.VeriCargoCloud.classificationStatus();
  state.classification.configured = result.configured;
  state.classification.model = result.model || "";
  state.classification.pipelineVersion = result.pipelineVersion || "";
  state.classification.spamPolicyVersion = result.spamPolicyVersion || "";
}

async function loadDocumentStatus() {
  const result = await globalThis.VeriCargoCloud.documentStatus();
  state.documents.configured = result.configured;
  state.documents.processorVersion = result.processorVersion || "";
}

async function syncGmailCategoryLabels() {
  if (!state.connection.connected) return;
  if (labelSyncPromise) return labelSyncPromise;
  labelSyncPromise = globalThis.VeriCargoCloud.syncCategoryLabels()
    .catch((error) => {
      state.connection.error = `Gmail labels could not be synchronized: ${error instanceof Error ? error.message : String(error)}`;
      renderConnection();
    })
    .finally(() => {
      labelSyncPromise = null;
    });
  return labelSyncPromise;
}

async function runAutomaticPostProcessing() {
  if (automaticPostProcessingPromise) return automaticPostProcessingPromise;
  automaticPostProcessingPromise = (async () => {
    const pendingClassification = state.messages.some((message) => !isCurrentClassification(message));
    if (pendingClassification && state.classification.configured) {
      await classifyInbox({ runFollowUp: false });
    }
    if (state.classification.error) return;
    await syncGmailCategoryLabels();
    await processDocuments();
  })().finally(() => {
    automaticPostProcessingPromise = null;
  });
  return automaticPostProcessingPromise;
}

async function classifyInbox({ runFollowUp = true } = {}) {
  if (!state.classification.configured || state.classification.loading) return;
  state.classification.loading = true;
  state.classification.error = "";
  state.classification.processed = 0;
  state.classification.total = state.messages.filter((message) => !isCurrentClassification(message)).length;
  renderClassificationStatus();
  try {
    await globalThis.VeriCargoCloud.classifyAll(({ processed, total, updates }) => {
      const updatesById = new Map((updates || []).map((update) => [update.id, update]));
      state.messages = state.messages.map((message) => updatesById.has(message.id)
        ? { ...message, ...updatesById.get(message.id) }
        : message);
      state.classification.processed = processed;
      state.classification.total = total;
      const selectedBeforeUpdate = state.selectedId;
      normalizeCaseSelection();
      renderClassificationStatus();
      renderSummary();
      renderCaseControls();
      renderInbox();
      renderPagination();
      renderHumanReview();
      if (selectedBeforeUpdate !== state.selectedId || updatesById.has(state.selectedId)) renderDetail();
    });
    await loadMessages();
  } catch (error) {
    state.classification.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.classification.loading = false;
    render();
  }
  if (!state.classification.error && runFollowUp) void runAutomaticPostProcessing();
}

async function processDocuments() {
  if (!state.documents.configured || state.documents.loading || !pendingDocumentMessages().length) return;
  state.documents.loading = true;
  state.documents.error = "";
  state.documents.processed = 0;
  state.documents.total = state.messages.filter((message) => categoryFor(message) === "DOCUMENT_COMPARISON").length;
  renderDocumentStatus();
  try {
    await globalThis.VeriCargoCloud.processDocumentsAll(({ processed, total, updates }) => {
      const selectedBeforeUpdate = state.selectedId;
      const updatesById = new Map((updates || []).map((update) => [update.id, update]));
      state.messages = state.messages.map((message) => updatesById.has(message.id)
        ? { ...message, ...updatesById.get(message.id) }
        : message);
      state.documents.processed = processed;
      state.documents.total = total;
      normalizeCaseSelection();
      renderDocumentStatus();
      renderDocumentWorkflowDashboard();
      renderCaseControls();
      renderInbox();
      renderPagination();
      renderHumanReview();
      renderComparison();
      if (selectedBeforeUpdate !== state.selectedId || updatesById.has(state.selectedId)) renderDetail();
    });
    await loadMessages();
  } catch (error) {
    state.documents.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.documents.loading = false;
    render();
  }
}

const preserveWorkspaceScroll = () => {
  const targets = [
    document.scrollingElement,
    inbox,
    detail,
    comparisonList,
    comparisonDetail,
    humanReviewList,
    humanReviewDetail,
  ].filter(Boolean);
  return targets.map((element) => ({ element, left: element.scrollLeft, top: element.scrollTop }));
};

const restoreWorkspaceScroll = (positions) => {
  for (const { element, left, top } of positions) element.scrollTo({ left, top });
};

const userIsEditing = () => document.activeElement?.matches("input, textarea, select, [contenteditable='true']");

async function synchronize({ automatic = false } = {}) {
  if (automatic) {
    if (
      automaticSyncPromise
      || !state.connection.connected
      || state.connection.loading
      || state.classification.loading
      || state.documents.loading
      || state.blDraft.busy
      || state.humanReview.busy
      || state.comparisonReview.busy
      || userIsEditing()
    ) return automaticSyncPromise;
    automaticSyncPromise = (async () => {
      const previousShown = state.shownCount;
      const result = await globalThis.VeriCargoCloud.syncAll();
      if (result.imported === 0 && result.shown === previousShown && !automaticUiRefreshPending) return;
      if (userIsEditing()) {
        automaticUiRefreshPending = true;
        return;
      }
      automaticUiRefreshPending = false;
      const scrollPositions = preserveWorkspaceScroll();
      await loadMessages();
      render();
      restoreWorkspaceScroll(scrollPositions);
      void runAutomaticPostProcessing();
    })()
      .catch((error) => console.warn("Automatic Gmail synchronization was deferred.", error))
      .finally(() => {
        automaticSyncPromise = null;
      });
    return automaticSyncPromise;
  }

  if (automaticSyncPromise) await automaticSyncPromise;
  state.connection.loading = true;
  state.connection.status = "Synchronizing Inbox…";
  renderConnection();
  await globalThis.VeriCargoCloud.syncAll(({ imported, mode, requested, shown }) => {
    state.requestedCount = requested;
    state.shownCount = shown;
    state.connection.status = mode === "incremental"
      ? `Checking for new email… ${imported} new message${imported === 1 ? "" : "s"} imported`
      : `Synchronizing Inbox… ${shown} of ${requested} messages imported`;
    renderConnection();
  });
  await loadMessages();
  await Promise.all([loadClassificationStatus(), loadDocumentStatus()]);
  state.connection.loading = false;
  render();
  void runAutomaticPostProcessing();
}

function startAutomaticSync() {
  if (automaticSyncTimer) clearInterval(automaticSyncTimer);
  automaticSyncTimer = setInterval(() => {
    if (document.visibilityState === "visible") void synchronize({ automatic: true });
  }, AUTOMATIC_SYNC_INTERVAL_MS);
}

function stopAutomaticSync() {
  if (!automaticSyncTimer) return;
  clearInterval(automaticSyncTimer);
  automaticSyncTimer = null;
}

async function completeConnection({ start }) {
  state.connection.loading = true;
  state.connection.error = "";
  state.connection.status = start ? "Opening Google authorization…" : "Waiting for Google authorization…";
  render();
  try {
    if (start) await globalThis.VeriCargoCloud.startConnection();
    const result = await globalThis.VeriCargoCloud.waitForConnection(() => {
      state.connection.status = "Waiting for Google authorization…";
      renderConnection();
    });
    state.connection.connected = true;
    state.connection.email = result.email;
    await synchronize();
    startAutomaticSync();
  } catch (error) {
    state.connection.loading = false;
    state.connection.error = error instanceof Error ? error.message : String(error);
    if (await globalThis.VeriCargoCloud.hasSession()) {
      try {
        const connection = await globalThis.VeriCargoCloud.connection();
        state.connection.connected = true;
        state.connection.email = connection.email;
        await Promise.all([loadMessages(), loadClassificationStatus(), loadDocumentStatus()]);
      } catch {
        state.connection.connected = false;
      }
    } else {
      state.connection.connected = false;
    }
    render();
  }
}

appTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  state.activeView = button.dataset.view;
  renderTabs();
});

summaryDashboard.addEventListener("click", (event) => {
  const card = event.target.closest("[data-category]");
  if (!card) return;
  state.categoryFilter = card.dataset.category;
  state.searchQuery = "";
  state.currentPage = 1;
  normalizeCaseSelection();
  state.activeView = "cases";
  render();
});

caseSearch.addEventListener("input", () => {
  state.searchQuery = caseSearch.value;
  state.currentPage = 1;
  normalizeCaseSelection();
  renderCaseControls();
  renderInbox();
  renderPagination();
  renderDetail();
});

casesView.addEventListener("click", (event) => {
  const category = event.target.closest("[data-filter-category]");
  const clear = event.target.closest("[data-clear-filters]");
  if (!category && !clear) return;
  state.categoryFilter = category?.dataset.filterCategory || "ALL";
  if (clear) state.searchQuery = "";
  state.currentPage = 1;
  normalizeCaseSelection();
  renderCaseControls();
  renderInbox();
  renderPagination();
  renderDetail();
});

humanReviewFilters.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-human-filter]");
  if (!filter) return;
  state.humanReview.filter = filter.dataset.humanFilter;
  state.humanReview.page = 1;
  state.humanReview.selectedId = null;
  state.humanReview.status = "";
  humanReviewList.scrollTop = 0;
  renderHumanReview();
});

humanReviewList.addEventListener("click", (event) => {
  const row = event.target.closest("[data-human-message-id]");
  if (!row) return;
  state.humanReview.selectedId = row.dataset.humanMessageId;
  state.humanReview.status = "";
  renderHumanReview();
});

humanReviewDetail.addEventListener("input", (event) => {
  const editor = event.target.closest("[data-review-email-editor]");
  if (!editor || !state.humanReview.selectedId) return;
  state.humanReview.drafts[state.humanReview.selectedId] = editor.value;
  state.humanReview.status = "Response updated locally.";
  const status = humanReviewDetail.querySelector(".human-review-action-status");
  if (status) status.textContent = state.humanReview.status;
});

humanReviewDetail.addEventListener("click", async (event) => {
  const message = state.messages.find((candidate) => candidate.id === state.humanReview.selectedId);
  if (!message) return;
  const revokeLabelButton = event.target.closest("[data-human-revoke-label-change]");
  if (revokeLabelButton && !state.humanReview.busy) {
    state.humanReview.busy = true;
    state.humanReview.status = "Restoring Email Intent Uncertain…";
    renderHumanReview();
    try {
      const result = await globalThis.VeriCargoCloud.revokeMessageCategory(message.id);
      state.messages = state.messages.map((candidate) => candidate.id === message.id
        ? { ...candidate, ...result.message }
        : candidate);
      state.humanReview.status = "Previous label restored. This email is pending review again.";
      state.humanReview.selectedId = message.id;
    } catch (error) {
      state.humanReview.status = error instanceof Error ? error.message : "The label change could not be revoked.";
    } finally {
      state.humanReview.busy = false;
      render();
    }
    return;
  }
  if (event.target.closest("[data-human-view-gmail]")) {
    if (hostGmailTabId === null) {
      state.humanReview.status = "The original Gmail tab is no longer available. Reopen VeriCargo from Gmail.";
      renderHumanReview();
      return;
    }
    try {
      const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(state.connection.email)}#all/${encodeURIComponent(message.id)}`;
      await chrome.tabs.update(hostGmailTabId, { active: true, url });
    } catch {
      hostGmailTabId = null;
      state.humanReview.status = "The original Gmail tab is no longer available. Reopen VeriCargo from Gmail.";
      renderHumanReview();
    }
    return;
  }

  const categoryButton = event.target.closest("[data-resolve-category]");
  if (categoryButton && !state.humanReview.busy) {
    const category = categoryButton.dataset.resolveCategory;
    state.humanReview.busy = true;
    state.humanReview.status = `Applying ${categoryLabel(category)}…`;
    renderHumanReview();
    try {
      const result = await globalThis.VeriCargoCloud.setMessageCategory(message.id, category);
      state.messages = state.messages.map((candidate) => candidate.id === message.id
        ? { ...candidate, ...result.message }
        : candidate);
      state.humanReview.status = `Resolved as ${categoryLabel(category)}.`;
      state.humanReview.selectedId = message.id;
      render();
      if (category === "DOCUMENT_COMPARISON") void processDocuments();
    } catch (error) {
      state.humanReview.status = error instanceof Error ? error.message : "The email label could not be updated.";
      renderHumanReview();
    } finally {
      state.humanReview.busy = false;
      renderHumanReview();
    }
    return;
  }

  const composeButton = event.target.closest("[data-compose-review-email]");
  if (!composeButton || state.humanReview.busy) return;
  if (hostGmailTabId === null) {
    state.humanReview.status = "The original Gmail tab is no longer available. Reopen VeriCargo from Gmail.";
    renderHumanReview();
    return;
  }
  const editor = humanReviewDetail.querySelector("[data-review-email-editor]");
  const body = editor?.value || humanReviewEmailDraft(message, state.humanReview.filter);
  state.humanReview.drafts[message.id] = body;
  state.humanReview.busy = true;
  state.humanReview.status = "Creating the response in Gmail…";
  renderHumanReview();
  try {
    const result = await globalThis.VeriCargoCloud.createHumanReviewDraft(message.id, state.humanReview.filter, body);
    state.messages = state.messages.map((candidate) => candidate.id === message.id
      ? {
        ...candidate,
        humanReviewDraftCreatedAt: new Date().toISOString(),
        humanReviewDraftId: result.draftId,
        humanReviewDraftIssueType: state.humanReview.filter,
        humanReviewDraftMessageId: result.gmailMessageId,
      }
      : candidate);
    await chrome.tabs.update(hostGmailTabId, { active: true, url: result.gmailUrl });
    state.humanReview.status = "Response draft created in Gmail.";
  } catch (error) {
    if (/tab|Tabs cannot be edited/i.test(error?.message || "")) hostGmailTabId = null;
    state.humanReview.status = error instanceof Error ? error.message : "The response draft could not be created.";
  } finally {
    state.humanReview.busy = false;
    renderHumanReview();
  }
});

classificationStatus.addEventListener("click", async (event) => {
  if (event.target.closest('[data-classification="start"]')) await classifyInbox();
});

documentStatus.addEventListener("click", async (event) => {
  if (event.target.closest('[data-documents="start"]')) await processDocuments();
});

documentWorkflowDashboard.addEventListener("click", (event) => {
  const card = event.target.closest("[data-workflow-status]");
  if (!card) return;
  state.categoryFilter = card.dataset.workflowStatus;
  state.searchQuery = "";
  state.currentPage = 1;
  normalizeCaseSelection();
  state.activeView = "cases";
  render();
});

comparisonList.addEventListener("click", (event) => {
  const filter = event.target.closest("[data-review-filter]");
  if (filter) {
    state.comparisonReviewFilter = filter.dataset.reviewFilter;
    state.comparisonPage = 1;
    state.comparisonSelectedId = null;
    state.comparisonReview.status = "";
    comparisonList.scrollTop = 0;
    renderComparison();
    return;
  }
  const item = event.target.closest("[data-comparison-id]");
  if (!item) return;
  state.comparisonSelectedId = item.dataset.comparisonId;
  state.comparisonReview.status = "";
  renderComparison();
});

function refreshWritingSuggestions() {
  const message = comparisonMessages().find((candidate) => candidate.id === state.comparisonSelectedId);
  const editor = comparisonDetail.querySelector("[data-bl-editor]");
  const suggestions = comparisonDetail.querySelector("[data-writing-suggestions]");
  if (!message || !editor || !suggestions) return;
  suggestions.innerHTML = writingSuggestionsMarkup(message, editor.value);
  const hasContentIssues = draftContentIssues(editor.value).length > 0;
  for (const button of comparisonDetail.querySelectorAll("[data-bl-download], [data-bl-compose]")) {
    button.disabled = state.blDraft.busy || hasContentIssues;
  }
  const reviewStatusButton = comparisonDetail.querySelector("[data-review-status-toggle]");
  const reviewCopy = comparisonDetail.querySelector(".comparison-review-action p");
  const selectedMessage = state.messages.find((candidate) => candidate.id === state.comparisonSelectedId);
  const reviewIsComplete = comparisonReviewStatus(selectedMessage) === "COMPLETE";
  if (reviewStatusButton && !reviewIsComplete) reviewStatusButton.disabled = state.comparisonReview.busy || hasContentIssues;
  if (reviewCopy && !reviewIsComplete) {
    reviewCopy.textContent = hasContentIssues
      ? "Correct the possible gibberish before marking this review complete."
      : "Confirm the comparison and Draft BL before marking it complete.";
  }
}

comparisonDetail.addEventListener("change", (event) => {
  const format = event.target.closest("[data-bl-format]");
  if (!format) return;
  state.blDraft.format = format.value;
  state.blDraft.status = "";
});

comparisonDetail.addEventListener("input", (event) => {
  const editor = event.target.closest("[data-bl-editor]");
  if (!editor || !state.comparisonSelectedId) return;
  state.blDraft.edits[state.comparisonSelectedId] = editor.value;
  state.blDraft.status = "Draft updated locally. Review writing and field suggestions before downloading or composing.";
  const status = comparisonDetail.querySelector("[data-bl-status]");
  if (status) status.textContent = state.blDraft.status;
  refreshWritingSuggestions();
});

comparisonDetail.addEventListener("click", async (event) => {
  const reviewToggle = event.target.closest("[data-review-status-toggle]");
  if (reviewToggle && state.comparisonSelectedId && !state.comparisonReview.busy) {
    const messageId = state.comparisonSelectedId;
    const message = state.messages.find((candidate) => candidate.id === messageId);
    if (!message) return;
    const nextStatus = comparisonReviewStatus(message) === "COMPLETE" ? "PENDING" : "COMPLETE";
    const currentDraftText = Object.hasOwn(state.blDraft.edits, messageId)
      ? state.blDraft.edits[messageId]
      : normalizedBlContent(message);
    if (nextStatus === "COMPLETE" && draftContentIssues(currentDraftText).length) {
      state.blDraft.openId = messageId;
      state.blDraft.status = "Possible gibberish must be corrected or removed before completing this review.";
      renderComparison();
      comparisonDetail.scrollTop = comparisonDetail.scrollHeight;
      return;
    }
    const scrollTop = comparisonDetail.scrollTop;
    state.comparisonReview.busy = true;
    state.comparisonReview.status = "Saving review status…";
    renderComparison();
    comparisonDetail.scrollTop = scrollTop;
    try {
      const result = await globalThis.VeriCargoCloud.setComparisonReviewStatus(messageId, nextStatus);
      state.messages = state.messages.map((candidate) => candidate.id === messageId
        ? { ...candidate, comparisonReviewStatus: result.status, comparisonReviewedAt: result.reviewedAt }
        : candidate);
      state.comparisonReviewFilter = result.status;
      state.comparisonPage = 1;
      state.comparisonSelectedId = messageId;
      state.comparisonReview.status = result.status === "COMPLETE"
        ? "Case moved to Complete."
        : "Case moved back to Pending.";
    } catch (error) {
      state.comparisonReview.status = error instanceof Error ? error.message : "The review status could not be saved.";
    } finally {
      state.comparisonReview.busy = false;
      renderComparison();
      comparisonDetail.scrollTop = scrollTop;
    }
    return;
  }
  const toggle = event.target.closest("[data-bl-toggle]");
  if (toggle) {
    const opening = state.blDraft.openId !== state.comparisonSelectedId;
    state.blDraft.openId = opening ? state.comparisonSelectedId : null;
    state.blDraft.status = "";
    renderComparison();
    if (opening) comparisonDetail.scrollTop = comparisonDetail.scrollHeight;
    return;
  }
  const applySuggestion = event.target.closest("[data-bl-apply]");
  const keepSuggestion = event.target.closest("[data-bl-keep]");
  if ((applySuggestion || keepSuggestion) && state.comparisonSelectedId) {
    const message = comparisonMessages().find((candidate) => candidate.id === state.comparisonSelectedId);
    const editor = comparisonDetail.querySelector("[data-bl-editor]");
    const fieldId = (applySuggestion || keepSuggestion).dataset[applySuggestion ? "blApply" : "blKeep"];
    const field = COMPARISON_FIELDS.find((candidate) => candidate.id === fieldId);
    if (!message || !editor || !field) return;
    if (applySuggestion) {
      editor.value = replaceDraftField(editor.value, field.id, field.label, preferredComparisonValue(message, field.id));
      state.blDraft.edits[message.id] = editor.value;
      if (state.blDraft.dismissed[message.id]) delete state.blDraft.dismissed[message.id][field.id];
      state.blDraft.status = `${field.label} restored to the normalized value.`;
    } else {
      const currentValue = parsedDraftFields(editor.value).get(field.id) ?? "";
      state.blDraft.dismissed[message.id] ||= {};
      state.blDraft.dismissed[message.id][field.id] = draftComparisonKey(field.id, currentValue);
      state.blDraft.status = `${field.label}: keeping your manual edit.`;
    }
    const status = comparisonDetail.querySelector("[data-bl-status]");
    if (status) status.textContent = state.blDraft.status;
    refreshWritingSuggestions();
    return;
  }
  const reset = event.target.closest("[data-bl-reset]");
  if (reset && state.comparisonSelectedId) {
    delete state.blDraft.edits[state.comparisonSelectedId];
    delete state.blDraft.dismissed[state.comparisonSelectedId];
    state.blDraft.status = "Draft restored to the normalized comparison content.";
    renderComparison();
    comparisonDetail.scrollTop = comparisonDetail.scrollHeight;
    return;
  }
  const download = event.target.closest("[data-bl-download]");
  const compose = event.target.closest("[data-bl-compose]");
  if ((!download && !compose) || state.blDraft.busy || !state.comparisonSelectedId) return;
  const editor = comparisonDetail.querySelector("[data-bl-editor]");
  const editedText = editor?.value ?? state.blDraft.edits[state.comparisonSelectedId];
  state.blDraft.edits[state.comparisonSelectedId] = editedText;
  if (draftContentIssues(editedText).length) {
    state.blDraft.status = "Possible gibberish must be corrected or removed before creating the attachment.";
    refreshWritingSuggestions();
    const status = comparisonDetail.querySelector("[data-bl-status]");
    if (status) status.textContent = state.blDraft.status;
    return;
  }
  if (compose && hostGmailTabId === null) {
    state.blDraft.status = "The original Gmail tab is no longer available. Reopen VeriCargo from Gmail.";
    renderComparison();
    comparisonDetail.scrollTop = comparisonDetail.scrollHeight;
    return;
  }
  const scrollTop = comparisonDetail.scrollTop;
  state.blDraft.busy = true;
  state.blDraft.status = download ? "Generating the file…" : "Creating a Gmail draft with the file attached…";
  renderComparison();
  comparisonDetail.scrollTop = scrollTop;
  try {
    if (download) {
      const result = await globalThis.VeriCargoCloud.blFile(state.comparisonSelectedId, state.blDraft.format, editedText);
      const blobUrl = URL.createObjectURL(new Blob([base64Bytes(result.data)], { type: result.mimeType }));
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = result.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      state.blDraft.status = `${result.filename} downloaded.`;
    } else {
      const result = await globalThis.VeriCargoCloud.createBlDraft(state.comparisonSelectedId, state.blDraft.format, editedText);
      await chrome.tabs.update(hostGmailTabId, { active: true, url: result.gmailUrl });
      state.blDraft.status = `Draft created in Gmail with ${result.filename} attached.`;
    }
  } catch (error) {
    if (compose && /tab|Tabs cannot be edited/i.test(error?.message || "")) hostGmailTabId = null;
    state.blDraft.status = error instanceof Error ? error.message : "The Draft BL action could not be completed.";
  } finally {
    state.blDraft.busy = false;
    renderComparison();
    comparisonDetail.scrollTop = scrollTop;
  }
});

comparisonPagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-comparison-page]");
  if (!button || button.disabled) return;
  const messages = comparisonMessages();
  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  state.comparisonPage = button.dataset.comparisonPage === "next"
    ? Math.min(totalPages, state.comparisonPage + 1)
    : Math.max(1, state.comparisonPage - 1);
  state.comparisonSelectedId = messages[(state.comparisonPage - 1) * PAGE_SIZE]?.id || null;
  comparisonList.scrollTop = 0;
  renderComparison();
});

inbox.addEventListener("click", (event) => {
  const row = event.target.closest("[data-email-id]");
  if (!row) return;
  state.selectedId = row.dataset.emailId;
  state.labelChange.status = "";
  renderInbox();
  renderDetail();
});

detail.addEventListener("click", async (event) => {
  const message = state.messages.find((candidate) => candidate.id === state.selectedId);
  const revokeLabelButton = event.target.closest("[data-revoke-label-change]");
  if (revokeLabelButton && message && !state.labelChange.busy) {
    state.labelChange.busy = true;
    state.labelChange.status = "Restoring the previous labelâ€¦";
    renderDetail();
    try {
      const result = await globalThis.VeriCargoCloud.revokeMessageCategory(message.id);
      state.messages = state.messages.map((candidate) => candidate.id === message.id
        ? { ...candidate, ...result.message }
        : candidate);
      state.labelChange.status = "Previous label restored.";
      state.humanReview.filter = result.message.category === "HUMAN_REVIEW"
        ? "HUMAN_REVIEW"
        : state.humanReview.filter;
      state.humanReview.selectedId = result.message.category === "HUMAN_REVIEW" ? message.id : null;
      state.humanReview.page = 1;
      state.activeView = result.message.category === "HUMAN_REVIEW" ? "human-review" : "cases";
    } catch (error) {
      state.labelChange.status = error instanceof Error ? error.message : "The label change could not be revoked.";
    } finally {
      state.labelChange.busy = false;
      render();
    }
    return;
  }
  if (event.target.closest("[data-view-gmail]")) {
    if (message) {
      const account = encodeURIComponent(state.connection.email);
      const gmailMessageId = encodeURIComponent(message.id);
      const url = `https://mail.google.com/mail/?authuser=${account}#all/${gmailMessageId}`;
      if (hostGmailTabId === null) {
        state.connection.error = "The original Gmail tab is no longer available. Reopen VeriCargo from Gmail.";
        renderConnection();
        return;
      }
      try {
        await chrome.tabs.update(hostGmailTabId, { active: true, url });
      } catch {
        hostGmailTabId = null;
        state.connection.error = "The original Gmail tab is no longer available. Reopen VeriCargo from Gmail.";
        renderConnection();
      }
    }
    return;
  }
  const humanReviewButton = event.target.closest("[data-open-human-review]");
  if (humanReviewButton) {
    state.humanReview.filter = humanReviewButton.dataset.openHumanReview;
    state.humanReview.selectedId = state.selectedId;
    state.humanReview.status = "";
    const reviewIndex = messagesForHumanReview().findIndex((message) => message.id === state.humanReview.selectedId);
    state.humanReview.page = reviewIndex >= 0 ? Math.floor(reviewIndex / PAGE_SIZE) + 1 : 1;
    state.activeView = "human-review";
    render();
    return;
  }
  if (!event.target.closest("[data-open-comparison]")) return;
  state.comparisonSelectedId = state.selectedId;
  const selectedComparison = allComparisonMessages().find((message) => message.id === state.comparisonSelectedId);
  state.comparisonReviewFilter = comparisonReviewStatus(selectedComparison);
  state.comparisonReview.status = "";
  const comparisonIndex = comparisonMessages().findIndex((message) => message.id === state.comparisonSelectedId);
  state.comparisonPage = comparisonIndex >= 0 ? Math.floor(comparisonIndex / PAGE_SIZE) + 1 : 1;
  state.activeView = "comparison";
  render();
});

pagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  const messages = filteredMessages();
  const totalPages = Math.max(1, Math.ceil(messages.length / PAGE_SIZE));
  state.currentPage = button.dataset.page === "next"
    ? Math.min(totalPages, state.currentPage + 1)
    : Math.max(1, state.currentPage - 1);
  state.selectedId = messages[(state.currentPage - 1) * PAGE_SIZE]?.id || null;
  renderInbox();
  renderPagination();
  renderDetail();
  globalThis.scrollTo({ top: 0, behavior: "smooth" });
});

connectionStatus.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-connection]");
  if (!button) return;
  if (button.dataset.connection === "restart") {
    await globalThis.VeriCargoCloud.cancelPendingConnection();
    globalThis.location.reload();
    return;
  }
  if (state.connection.loading) return;
  if (button.dataset.connection === "connect") await completeConnection({ start: true });
  if (button.dataset.connection === "refresh") {
    try {
      state.connection.error = "";
      await synchronize();
    } catch (error) {
      state.connection.loading = false;
      state.connection.error = error instanceof Error ? error.message : String(error);
      render();
    }
  }
  if (button.dataset.connection === "disconnect") {
    stopAutomaticSync();
    await globalThis.VeriCargoCloud.disconnect();
    state.connection = { connected: false, email: "", error: "", loading: false, status: "" };
    state.classification = { configured: false, error: "", loading: false, model: "", pipelineVersion: "", processed: 0, spamPolicyVersion: "", total: 0 };
    state.blDraft = { busy: false, dismissed: {}, edits: {}, format: "pdf", openId: null, status: "" };
    state.categoryFilter = "ALL";
    state.comparisonPage = 1;
    state.comparisonReview = { busy: false, status: "" };
    state.comparisonReviewFilter = "PENDING";
    state.comparisonSelectedId = null;
    state.currentPage = 1;
    state.humanReview = { busy: false, drafts: {}, filter: "HUMAN_REVIEW", page: 1, selectedId: null, status: "" };
    state.labelChange = { busy: false, status: "" };
    state.messages = [];
    state.documents = { configured: false, error: "", loading: false, processed: 0, processorVersion: "", total: 0 };
    state.requestedCount = 0;
    state.searchQuery = "";
    state.selectedId = null;
    state.shownCount = 0;
    state.activeView = "summary";
    render();
  }
});

async function initialize() {
  await chrome.storage.local.remove(["blinkCases", "blinkGmailCases", "blinkGmailEmail", "blinkMode"]);
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  hostGmailTabId = activeTab?.id ?? null;
  render();
  try {
    if (await globalThis.VeriCargoCloud.hasSession()) {
      const connection = await globalThis.VeriCargoCloud.connection();
      state.connection.connected = true;
      state.connection.email = connection.email;
      await Promise.all([loadMessages(), loadClassificationStatus(), loadDocumentStatus()]);
      render();
      void runAutomaticPostProcessing();
      startAutomaticSync();
      return;
    }
    if (await globalThis.VeriCargoCloud.hasPendingConnection()) {
      await completeConnection({ start: false });
    }
  } catch (error) {
    state.connection.error = error instanceof Error ? error.message : String(error);
    render();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void synchronize({ automatic: true });
});

initialize();
