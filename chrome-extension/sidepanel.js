const FIELD_LABELS = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  container_count: "Container count",
  gross_weight_kg: "Gross weight",
};

const baseFields = [
  ["shipper", "Northstar Exports Sdn. Bhd.", "NORTHSTAR EXPORTS SDN BHD", "MATCH", 97],
  ["consignee", "Harbor Retail Pte Ltd, Singapore", "HARBOR RETAIL PTE LTD SINGAPORE", "MATCH", 97],
  ["notify_party", "Atlantic Brokers Ltd.", "ATLANTIC BROKERS LTD", "MATCH", 97],
  ["port_of_loading", "Port Klang, Malaysia", "PORT KLANG MY", "MATCH", 97],
  ["port_of_discharge", "Singapore", "Singapore Port", "MATCH", 97],
  ["container_count", "3 x 40HC", "3 containers", "MATCH", 98],
  ["gross_weight_kg", "22 MT", "22,000 KGS", "MATCH", 97],
];

function fields(overrides = {}) {
  return baseFields.map(([key, si, draft, comparison, confidence]) => {
    const value = overrides[key] || {};
    return { key, label: FIELD_LABELS[key], si, draft, comparison, confidence, ...value };
  });
}

const seedCases = [
  {
    id: "email_001", sender: "Northstar Logistics", time: "10:24 AM",
    subject: "Please verify Draft BL before release",
    body: "Please compare the attached draft Bill of Lading with our final shipping instruction.",
    category: "DOCUMENT_COMPARISON", status: "SUGGESTED", result: "MATCH", confidence: 96,
    fields: fields(),
  },
  {
    id: "email_002", sender: "Pacific Goods", time: "9:58 AM",
    subject: "Draft BL check - container quantity",
    body: "Please check the attached Draft BL against the final SI. The container quantity needs particular attention.",
    category: "DOCUMENT_COMPARISON", status: "SUGGESTED", result: "MISMATCH", confidence: 98,
    fields: fields({ container_count: { draft: "4 x 40HC", comparison: "MISMATCH", confidence: 98 } }),
  },
  {
    id: "email_003", sender: "Meridian Trade", time: "9:35 AM",
    subject: "Verify shipment weight on Draft BL",
    body: "The SI uses metric tonnes while the carrier draft uses kilograms.",
    category: "DOCUMENT_COMPARISON", status: "SUGGESTED", result: "MATCH", confidence: 97,
    fields: fields(),
  },
  {
    id: "email_004", sender: "Blue Harbor", time: "9:12 AM", subject: "Documents",
    body: "Please take a look when you can.", category: "GENERAL", status: "HUMAN_REVIEW",
    result: null, confidence: 64, reviewReason: "Unable to Determine Email Intent", fields: [],
  },
  {
    id: "email_005", sender: "Atlas Marine", time: "8:44 AM",
    subject: "Please compare attached shipment files", body: "Please verify the instruction against the carrier draft.",
    category: "DOCUMENT_COMPARISON", status: "HUMAN_REVIEW", result: null, confidence: 88,
    reviewReason: "Missing Required Document", fields: fields(),
  },
  {
    id: "email_006", sender: "Kencana Exports", time: "Yesterday",
    subject: "Shipping Instruction - BK-7824", body: "Attached is the new SI for booking BK-7824.",
    category: "NEW_SI", status: "CLASSIFIED", result: null, confidence: 98, fields: [],
  },
];

const state = { cases: structuredClone(seedCases), selectedId: "email_002", filter: "ALL", query: "", tab: "comparison" };
const inbox = document.querySelector("#inbox");
const detail = document.querySelector("#detail");
const search = document.querySelector("#search");
const localStore = globalThis.chrome?.storage?.local ?? {
  get: async () => ({}),
  set: async () => undefined,
};

function categoryLabel(category) {
  return ({ DOCUMENT_COMPARISON: "Document Comparison", NEW_SI: "New SI", GENERAL: "General" })[category] || category;
}

function filteredCases() {
  const query = state.query.toLowerCase();
  return state.cases.filter((item) => {
    const matchesQuery = `${item.sender} ${item.subject} ${item.body}`.toLowerCase().includes(query);
    const matchesFilter = state.filter === "ALL"
      || (state.filter === "HUMAN_REVIEW" && item.status === "HUMAN_REVIEW")
      || item.category === state.filter;
    return matchesQuery && matchesFilter;
  });
}

function renderInbox() {
  const items = filteredCases();
  inbox.innerHTML = items.length ? items.map((item) => `
    <button class="mail-row ${item.id === state.selectedId ? "selected" : ""}" data-email-id="${item.id}">
      <span class="mail-line"><span class="sender">${item.sender}</span><span class="time">${item.time}</span></span>
      <span class="subject">${item.subject}</span>
      <span class="preview">${item.body}</span>
      <span class="badges">
        <span class="badge ${item.category === "DOCUMENT_COMPARISON" ? "compare" : "other"}">${categoryLabel(item.category)}</span>
        ${item.status === "HUMAN_REVIEW" ? '<span class="badge review">Human Review</span>' : ""}
      </span>
    </button>
  `).join("") : '<div class="empty-list">No matching demo emails.</div>';
}

function comparisonPanel(item) {
  if (item.status === "HUMAN_REVIEW") {
    return `<div class="panel"><div class="result review"><strong>Human Review</strong><p>Reason: ${item.reviewReason}</p></div>${item.fields.length ? fieldList(item) : ""}</div>`;
  }
  if (item.category !== "DOCUMENT_COMPARISON") {
    return `<div class="panel"><div class="result match"><strong>${categoryLabel(item.category)}</strong><p>This email does not continue to SI versus Draft BL verification.</p></div></div>`;
  }
  const matched = item.fields.filter((field) => field.comparison === "MATCH").length;
  const tone = item.result === "MISMATCH" ? "mismatch" : "match";
  const resultTitle = item.status === "VERIFIED"
    ? `Reviewer verified ${item.result.toLowerCase()}`
    : `Suggested ${item.result.toLowerCase()} — ${item.confidence}%`;
  const resultDetail = item.status === "VERIFIED"
    ? "The local review record has been updated."
    : "Review the evidence before confirming the final result.";
  return `<div class="panel">
    <div class="result ${tone}"><strong>${resultTitle}</strong><p>${resultDetail}</p></div>
    <div class="progress-label"><span>Field agreement</span><span>${matched} / 7 fields</span></div>
    <div class="progress"><span style="width:${(matched / 7) * 100}%"></span></div>
    ${fieldList(item)}
    <div class="actions"><button class="primary" data-action="verify">Verify result</button><button class="secondary" data-action="review">Human Review</button></div>
  </div>`;
}

function fieldList(item) {
  return `<div class="fields">${item.fields.map((field) => `
    <div class="field ${field.comparison.toLowerCase()}">
      <span class="field-icon">${field.comparison === "MATCH" ? "✓" : "×"}</span>
      <span class="field-copy"><strong>${field.label}</strong><span>SI: ${field.si} · BL: ${field.draft}</span></span>
      <span class="confidence">${field.confidence}%</span>
    </div>`).join("")}</div>`;
}

function evidencePanel(item) {
  if (!item.fields.length) return '<div class="panel"><div class="empty-list">No SI versus Draft BL evidence for this category.</div></div>';
  const field = item.fields.find((entry) => entry.comparison === "MISMATCH") || item.fields[0];
  const normalize = (value) => field.key === "gross_weight_kg" ? "22000" : field.key === "container_count" ? value.match(/\d+/)?.[0] : value.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return `<div class="panel">
    <div class="evidence-card"><h3>Shipping Instruction · Page 2</h3><p>Shipping_Instruction.pdf</p><div class="quote">${field.si}</div><div class="value-grid"><div><span>Raw</span><strong>${field.si}</strong></div><div><span>Normalized</span><strong>${normalize(field.si)}</strong></div></div></div>
    <div class="evidence-card"><h3>Draft Bill of Lading · Page 1</h3><p>Draft_BL.pdf</p><div class="quote">${field.label}: ${field.draft}</div><div class="value-grid"><div><span>Raw</span><strong>${field.draft}</strong></div><div><span>Normalized</span><strong>${normalize(field.draft)}</strong></div></div></div>
  </div>`;
}

function editorPanel(item) {
  if (item.category !== "DOCUMENT_COMPARISON") return '<div class="panel"><div class="empty-list">Draft BL editing is available only for document-comparison emails.</div></div>';
  const suggestions = item.fields.filter((field) => field.comparison === "MISMATCH" && !(item.ignored || []).includes(field.key));
  if (!suggestions.length) return '<div class="panel"><div class="result match"><strong>No unresolved edit suggestions</strong><p>The latest Draft BL values match the SI.</p></div></div>';
  return `<div class="panel">${suggestions.map((field) => `
    <div class="suggestion"><h3>${field.label}</h3><dl><dt>Current</dt><dd>${field.draft}</dd><dt>SI</dt><dd>${field.si}</dd></dl><div class="actions"><button class="primary" data-action="apply" data-field="${field.key}">Apply</button><button class="secondary" data-action="ignore" data-field="${field.key}">Ignore</button></div></div>
  `).join("")}</div>`;
}

function renderDetail() {
  const item = state.cases.find((candidate) => candidate.id === state.selectedId);
  if (!item) {
    detail.replaceChildren(document.querySelector("#empty-state").content.cloneNode(true));
    return;
  }
  const panel = state.tab === "evidence" ? evidencePanel(item) : state.tab === "editor" ? editorPanel(item) : comparisonPanel(item);
  detail.innerHTML = `
    <div class="case-header"><span class="eyebrow">${categoryLabel(item.category)}</span><h1>${item.subject}</h1><p>${item.sender} · ${item.time}<br>${item.body}</p></div>
    <div class="tabs" role="tablist">
      <button class="tab ${state.tab === "comparison" ? "active" : ""}" data-tab="comparison">Comparison</button>
      <button class="tab ${state.tab === "evidence" ? "active" : ""}" data-tab="evidence">Evidence</button>
      <button class="tab ${state.tab === "editor" ? "active" : ""}" data-tab="editor">Draft BL</button>
    </div>${panel}`;
}

function render() { renderInbox(); renderDetail(); }

async function persist() {
  await localStore.set({ blinkCases: state.cases });
}

inbox.addEventListener("click", (event) => {
  const row = event.target.closest("[data-email-id]");
  if (!row) return;
  state.selectedId = row.dataset.emailId;
  state.tab = "comparison";
  render();
});

detail.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; renderDetail(); return; }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  const item = state.cases.find((candidate) => candidate.id === state.selectedId);
  if (!item) return;
  if (action.dataset.action === "apply") {
    const field = item.fields.find((candidate) => candidate.key === action.dataset.field);
    field.draft = field.si;
    field.comparison = "MATCH";
    field.confidence = 99;
    item.result = item.fields.some((candidate) => candidate.comparison === "MISMATCH") ? "MISMATCH" : "MATCH";
    item.confidence = Math.min(...item.fields.map((candidate) => candidate.confidence));
    state.tab = "comparison";
  } else if (action.dataset.action === "ignore") {
    item.ignored = [...new Set([...(item.ignored || []), action.dataset.field])];
    await persist();
    renderDetail();
    return;
  } else if (action.dataset.action === "review") {
    item.status = "HUMAN_REVIEW";
    item.reviewReason = "Reviewer Requested";
  } else if (action.dataset.action === "verify") {
    item.status = "VERIFIED";
  }
  await persist();
  render();
});

document.querySelector(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll(".filter").forEach((entry) => entry.classList.toggle("active", entry === button));
  renderInbox();
});

search.addEventListener("input", () => { state.query = search.value; renderInbox(); });

localStore.get("blinkCases").then(({ blinkCases }) => {
  if (Array.isArray(blinkCases) && blinkCases.length) state.cases = blinkCases;
  render();
});
