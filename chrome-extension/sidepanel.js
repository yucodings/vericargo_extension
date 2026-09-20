const PAGE_SIZE = 50;

const CATEGORIES = [
  { id: "DOCUMENT_COMPARISON", icon: "⇄", label: "Document Comparison", note: "SI and Draft BL verification" },
  { id: "NEW_SI", icon: "+", label: "New SI Requests", note: "New shipping instructions" },
  { id: "INVOICE_QUERY", icon: "$", label: "Invoice Queries", note: "Invoice and payment related" },
  { id: "GENERAL", icon: "✉", label: "General Messages", note: "General operational messages" },
  { id: "SPAM", icon: "×", label: "Spam", note: "Irrelevant or promotional" },
  { id: "HUMAN_REVIEW", icon: "!", label: "Human Review", note: "Needs manual attention" },
];

const attachmentCache = new Map();
let activePreviewUrls = [];
let previewRequestId = 0;

const state = {
  activeView: "summary",
  classification: { configured: false, error: "", loading: false, model: "", processed: 0, total: 0 },
  connection: { connected: false, email: "", error: "", loading: false, status: "" },
  currentPage: 1,
  messages: [],
  requestedCount: 0,
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
    : CATEGORIES.find((candidate) => candidate.id === category)?.label || "Human Review";

const categoryFor = (message) =>
  message.classificationSource === "GEMINI" && CATEGORIES.some((category) => category.id === message.category)
    ? message.category
    : "UNCLASSIFIED";

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
  const pending = state.messages.filter((message) => message.classificationSource !== "GEMINI").length;
  classificationStatus.innerHTML = pending
    ? `<div><strong>Ready to classify ${pending} messages</strong><p>${h(state.classification.model || "Gemini")} will assign one of six categories.</p></div><button class="classification-button" data-classification="start">Classify Inbox</button>`
    : `<div><strong>Inbox classification complete</strong><p>${state.shownCount} messages classified by ${h(state.classification.model || "Gemini")}.</p></div><span class="status-pill complete">Complete</span>`;
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

function renderInbox() {
  if (!state.connection.connected) {
    inbox.innerHTML = '<div class="empty-list">Connect Gmail to load your Inbox.</div>';
    return;
  }
  const start = (state.currentPage - 1) * PAGE_SIZE;
  const messages = state.messages.slice(start, start + PAGE_SIZE);
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
    : '<div class="empty-list">No Inbox messages have been imported yet.</div>';
}

function renderPagination() {
  const total = state.messages.length;
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
      <span class="eyebrow">${h(categoryLabel(category))}</span>
      <h1>${h(message.subject)}</h1>
      <p>${h(message.senderAddress)} · ${h(displayTime(message))}</p>
    </div>
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
  renderConnection();
  renderTabs();
  renderClassificationStatus();
  renderSummary();
  renderInbox();
  renderPagination();
  renderDetail();
}

async function loadMessages() {
  const result = await globalThis.VeriCargoCloud.messages();
  state.messages = result.messages;
  state.requestedCount = result.requested;
  state.shownCount = result.shown;
  state.currentPage = Math.min(state.currentPage, Math.max(1, Math.ceil(state.messages.length / PAGE_SIZE)));
  state.selectedId = state.messages.some((message) => message.id === state.selectedId)
    ? state.selectedId
    : state.messages[0]?.id || null;
}

async function loadClassificationStatus() {
  const result = await globalThis.VeriCargoCloud.classificationStatus();
  state.classification.configured = result.configured;
  state.classification.model = result.model || "";
}

async function classifyInbox() {
  if (!state.classification.configured || state.classification.loading) return;
  state.classification.loading = true;
  state.classification.error = "";
  state.classification.processed = 0;
  state.classification.total = state.messages.length;
  renderClassificationStatus();
  try {
    await globalThis.VeriCargoCloud.classifyAll(({ classified, total }) => {
      state.classification.processed = classified;
      state.classification.total = total;
      renderClassificationStatus();
    });
    await loadMessages();
  } catch (error) {
    state.classification.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.classification.loading = false;
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
  await loadClassificationStatus();
  state.connection.loading = false;
  render();
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
        await Promise.all([loadMessages(), loadClassificationStatus()]);
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
  const index = state.messages.findIndex((message) => categoryFor(message) === card.dataset.category);
  if (index >= 0) {
    state.currentPage = Math.floor(index / PAGE_SIZE) + 1;
    state.selectedId = state.messages[index].id;
  }
  state.activeView = "cases";
  render();
});

classificationStatus.addEventListener("click", async (event) => {
  if (event.target.closest('[data-classification="start"]')) await classifyInbox();
});

inbox.addEventListener("click", (event) => {
  const row = event.target.closest("[data-email-id]");
  if (!row) return;
  state.selectedId = row.dataset.emailId;
  renderInbox();
  renderDetail();
});

pagination.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  const totalPages = Math.max(1, Math.ceil(state.messages.length / PAGE_SIZE));
  state.currentPage = button.dataset.page === "next"
    ? Math.min(totalPages, state.currentPage + 1)
    : Math.max(1, state.currentPage - 1);
  state.selectedId = state.messages[(state.currentPage - 1) * PAGE_SIZE]?.id || null;
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
    state.classification = { configured: false, error: "", loading: false, model: "", processed: 0, total: 0 };
    state.currentPage = 1;
    state.messages = [];
    state.requestedCount = 0;
    state.selectedId = null;
    state.shownCount = 0;
    state.activeView = "summary";
    render();
  }
});

async function initialize() {
  await chrome.storage.local.remove(["blinkCases", "blinkGmailCases", "blinkGmailEmail", "blinkMode"]);
  render();
  try {
    if (await globalThis.VeriCargoCloud.hasSession()) {
      const connection = await globalThis.VeriCargoCloud.connection();
      state.connection.connected = true;
      state.connection.email = connection.email;
      await Promise.all([loadMessages(), loadClassificationStatus()]);
      render();
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
