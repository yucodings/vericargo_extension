const PAGE_SIZE = 50;

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

const COMPARISON_FIELDS = [
  { id: "shipper", label: "Shipper" },
  { id: "consignee", label: "Consignee" },
  { id: "notifyParty", label: "Notify Party" },
  { id: "portOfLoading", label: "Port of Loading" },
  { id: "portOfDischarge", label: "Port of Discharge" },
  { id: "containerCount", label: "Container Count" },
  { id: "grossWeightKg", label: "Gross Weight (kg)" },
];

const attachmentCache = new Map();
let activePreviewUrls = [];
let previewRequestId = 0;
let labelSyncPromise = null;
let automaticPostProcessingPromise = null;
let hostGmailTabId = null;

const state = {
  activeView: "summary",
  categoryFilter: "ALL",
  classification: { configured: false, error: "", loading: false, model: "", pipelineVersion: "", processed: 0, total: 0 },
  comparisonSelectedId: null,
  connection: { connected: false, email: "", error: "", loading: false, status: "" },
  currentPage: 1,
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
const comparisonDetail = document.querySelector("#comparison-detail");
const documentStatus = document.querySelector("#document-status");
const documentWorkflowDashboard = document.querySelector("#document-workflow-dashboard");

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

const isCurrentClassification = (message) =>
  message.classificationSource === "GEMINI"
  && message.classificationModel === state.classification.model
  && message.classificationPipelineVersion === state.classification.pipelineVersion;

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

const comparisonMessages = () => state.messages.filter(
  (message) => message.documentWorkflowStatus === DOCUMENT_WORKFLOW.READY
    && message.siDocument
    && message.draftBlDocument,
);

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

const formatBytes = (bytes) => {
  if (!bytes) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

function renderConnection() {
  if (state.connection.loading) {
    connectionStatus.innerHTML = `<div class="status-copy"><strong>${h(state.connection.status || "Connecting to Gmail…")}</strong><p>${h(state.connection.error || "Keep this window open while synchronization completes.")}</p></div><div class="connection-actions"><button class="connection-button" data-connection="restart">Cancel</button></div>`;
    return;
  }
  if (state.connection.connected) {
    connectionStatus.innerHTML = `<div class="status-copy"><strong>Signed in: ${h(state.connection.email)}</strong><p>${h(state.connection.error || `${state.requestedCount} requested · ${state.shownCount} shown`)}</p></div><div class="connection-actions"><button class="connection-button primary" data-connection="refresh">Refresh</button><button class="connection-button" data-connection="disconnect">Sign out</button></div>`;
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
  const ready = comparisonMessages().length;
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
  const messages = comparisonMessages();
  if (!messages.some((message) => message.id === state.comparisonSelectedId)) {
    state.comparisonSelectedId = messages[0]?.id || null;
  }
  comparisonList.innerHTML = messages.length
    ? `<div class="comparison-list-heading"><strong>Processed cases</strong><span>${messages.length}</span></div>${messages.map((message) => `
        <button class="comparison-case ${message.id === state.comparisonSelectedId ? "active" : ""}" data-comparison-id="${h(message.id)}" type="button">
          <strong>${h(message.subject)}</strong><span>${h(message.sender)} · ${h(displayTime(message))}</span>
        </button>`).join("")}`
    : '<div class="empty-list">No completed SI/BL extractions yet. Process document-comparison cases from Inbox Summary.</div>';

  const message = messages.find((candidate) => candidate.id === state.comparisonSelectedId);
  if (!message) {
    comparisonDetail.innerHTML = '<div class="empty-state"><div class="empty-icon">&#8644;</div><h2>Select a processed case</h2><p>The seven extracted SI and Draft BL fields will appear here.</p></div>';
    return;
  }
  const fieldCell = (field) => `<div class="comparison-value"><strong>${h(field?.rawValue || "Not found")}</strong>${field?.normalizedValue && field.normalizedValue !== field.rawValue ? `<span>Normalized: ${h(field.normalizedValue)}</span>` : ""}<small>${h(`${field?.confidence || 0}% · ${field?.page ? `Page ${field.page}` : "Location unavailable"}`)}</small><p>${h(field?.evidence || "No evidence snippet available.")}</p></div>`;
  comparisonDetail.innerHTML = `
    <div class="comparison-header"><span class="eyebrow">SI/BL document comparison</span><h1>${h(message.subject)}</h1><p>${h(message.senderAddress)} · ${h(displayTime(message))}</p></div>
    <div class="document-pair">
      <div><strong>Shipping Instruction</strong><span>${h(message.siDocument.filename)}</span><small>${h(message.siDocument.processingMethod)} · ${h(`${message.siDocument.qualityScore}% quality`)}</small></div>
      <div><strong>Draft Bill of Lading</strong><span>${h(message.draftBlDocument.filename)}</span><small>${h(message.draftBlDocument.processingMethod)} · ${h(`${message.draftBlDocument.qualityScore}% quality`)}</small></div>
    </div>
    <div class="comparison-table" role="table" aria-label="Seven extracted SI and Draft BL fields">
      <div class="comparison-row comparison-table-head" role="row"><div>Field</div><div>Shipping Instruction</div><div>Draft Bill of Lading</div></div>
      ${COMPARISON_FIELDS.map(({ id, label }) => `<div class="comparison-row" role="row"><div class="comparison-field">${h(label)}</div>${fieldCell(message.siDocument.fields?.[id])}${fieldCell(message.draftBlDocument.fields?.[id])}</div>`).join("")}
    </div>`;
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
  const classificationInsight = category === "UNCLASSIFIED"
    ? '<div class="classification-insight pending"><div><strong>Awaiting AI classification</strong><span>Pending</span></div><p>This result will update automatically when its classification batch completes.</p></div>'
    : `<div class="classification-insight ${category === "HUMAN_REVIEW" ? "review" : ""}"><div><strong>${h(categoryLabel(category))}</strong><span>${h(`${message.confidence ?? 0}% confidence`)}</span></div><p>${h(message.classificationReason || "Classified by Gemini.")}</p>${message.attachmentAssisted ? '<small>Attachment-assisted classification</small>' : ""}</div>`;
  const documentInsight = message.documentWorkflowStatus === DOCUMENT_WORKFLOW.MISSING_AMBIGUOUS
    ? `<div class="document-insight review"><strong>Human Review – Missing/Ambiguous Document</strong><p>${h(message.documentReviewReason)}</p></div>`
    : message.documentWorkflowStatus === DOCUMENT_WORKFLOW.UNREADABLE_LOW_QUALITY
      ? `<div class="document-insight review"><strong>Human Review – Unreadable/Low Quality</strong><p>${h(message.documentReviewReason)}</p></div>`
      : message.documentWorkflowStatus === DOCUMENT_WORKFLOW.READY
        ? '<div class="document-insight ready"><strong>Seven fields extracted</strong><button data-open-comparison type="button">Open SI/BL Document Comparison</button></div>'
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
      <div class="case-title-row"><div><span class="eyebrow">${h(categoryLabel(category))}</span><h1>${h(message.subject)}</h1></div><button class="view-gmail-button" data-view-gmail type="button">View Email in Gmail</button></div>
      <p>${h(message.senderAddress)} · ${h(displayTime(message))}</p>
    </div>
    ${classificationInsight}
    ${documentInsight}
    <div class="detail-body">
      <section class="message-content"><h2>Email content</h2><p>${h(message.body)}</p></section>
      <section class="attachments-section"><div class="section-heading"><h2>Files</h2><span>${attachments.length}</span></div><div class="attachment-grid">${attachmentCards}</div></section>
    </div>`;
  void loadAttachmentPreviews(message, attachments, previewRequestId);
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

async function synchronize() {
  state.connection.loading = true;
  state.connection.status = "Synchronizing Inbox…";
  renderConnection();
  await globalThis.VeriCargoCloud.syncAll(({ requested, shown }) => {
    state.requestedCount = requested;
    state.shownCount = shown;
    state.connection.status = `Synchronizing Inbox… ${shown} of ${requested} messages imported`;
    renderConnection();
  });
  await loadMessages();
  await Promise.all([loadClassificationStatus(), loadDocumentStatus()]);
  state.connection.loading = false;
  render();
  void runAutomaticPostProcessing();
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
  const item = event.target.closest("[data-comparison-id]");
  if (!item) return;
  state.comparisonSelectedId = item.dataset.comparisonId;
  renderComparison();
});

inbox.addEventListener("click", (event) => {
  const row = event.target.closest("[data-email-id]");
  if (!row) return;
  state.selectedId = row.dataset.emailId;
  renderInbox();
  renderDetail();
});

detail.addEventListener("click", async (event) => {
  if (event.target.closest("[data-view-gmail]")) {
    const message = state.messages.find((candidate) => candidate.id === state.selectedId);
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
  if (!event.target.closest("[data-open-comparison]")) return;
  state.comparisonSelectedId = state.selectedId;
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
    await globalThis.VeriCargoCloud.disconnect();
    state.connection = { connected: false, email: "", error: "", loading: false, status: "" };
    state.classification = { configured: false, error: "", loading: false, model: "", pipelineVersion: "", processed: 0, total: 0 };
    state.categoryFilter = "ALL";
    state.comparisonSelectedId = null;
    state.currentPage = 1;
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

initialize();
