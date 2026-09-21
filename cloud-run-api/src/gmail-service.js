import { createHash } from "node:crypto";

import { createBlDocument } from "./bl-draft-service.js";
import { decryptSecret } from "./crypto-utils.js";
import { enrichDocumentComparison } from "./document-comparison.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const BATCH_SIZE = 10;
const GMAIL_CONCURRENCY = 2;
const MAX_GMAIL_RETRIES = 5;
const CATEGORY_LABEL_SYNC_VERSION = "vericargo-category-labels-v5-category-colors";
const INBOX_RECONCILIATION_VERSION = "vericargo-inbox-reconciliation-v1";

const headerSafe = (value) => String(value || "").replace(/[\r\n]+/g, " ").trim();
const encodedHeader = (value) => `=?UTF-8?B?${Buffer.from(headerSafe(value), "utf8").toString("base64")}?=`;
const foldBase64 = (value) => value.match(/.{1,76}/g)?.join("\r\n") || "";

const createDraftMime = ({ attachment, body, subject, to }) => {
  const boundary = `vericargo_${createHash("sha256").update(`${Date.now()}:${attachment.filename}`).digest("hex").slice(0, 24)}`;
  return [
    `To: ${headerSafe(to)}`,
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(body, "utf8").toString("base64")),
    `--${boundary}`,
    `Content-Type: ${attachment.mimeType}`,
    `Content-Disposition: attachment; filename="${headerSafe(attachment.filename).replaceAll('"', "'")}"`,
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(attachment.buffer.toString("base64")),
    `--${boundary}--`,
    "",
  ].join("\r\n");
};

const createTextDraftMime = ({ body, subject, to }) => [
  `To: ${headerSafe(to)}`,
  `Subject: ${encodedHeader(subject)}`,
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="UTF-8"',
  "Content-Transfer-Encoding: base64",
  "",
  foldBase64(Buffer.from(body, "utf8").toString("base64")),
  "",
].join("\r\n");

const CATEGORY_LABELS = {
  DOCUMENT_COMPARISON: "Document Comparison",
  NEW_SI: "New SI Requests",
  INVOICE_QUERY: "Invoice Queries",
  GENERAL: "General Messages",
  SPAM: "Spam Email",
  HUMAN_REVIEW: "Email Intent Uncertain",
};

// Gmail accepts only its predefined label palette. These are exact where available and
// the closest supported Gmail shades for the requested blue, red, purple, and grey.
const CATEGORY_LABEL_COLORS = Object.freeze({
  DOCUMENT_COMPARISON: Object.freeze({ backgroundColor: "#ff7537", textColor: "#ffffff" }),
  HUMAN_REVIEW: Object.freeze({ backgroundColor: "#285bac", textColor: "#ffffff" }),
  GENERAL: Object.freeze({ backgroundColor: "#cc3a21", textColor: "#ffffff" }),
  INVOICE_QUERY: Object.freeze({ backgroundColor: "#16a765", textColor: "#ffffff" }),
  NEW_SI: Object.freeze({ backgroundColor: "#8e63ce", textColor: "#ffffff" }),
  SPAM: Object.freeze({ backgroundColor: "#666666", textColor: "#ffffff" }),
});

const CATEGORY_UNDO_FIELDS = [
  "attachmentAssisted",
  "category",
  "classificationModel",
  "classificationPipelineVersion",
  "classificationReason",
  "classificationSource",
  "classificationSpamPolicyVersion",
  "classificationStatus",
  "classifiedAt",
  "confidence",
  "humanReviewedAt",
  "reviewReason",
  "status",
];

const categoryUndoSnapshot = (message) => Object.fromEntries(
  CATEGORY_UNDO_FIELDS
    .filter((fieldName) => message[fieldName] !== undefined)
    .map((fieldName) => [fieldName, message[fieldName]]),
);

const LEGACY_CATEGORY_LABELS = [
  "VeriCargo/Document Comparison",
  "VeriCargo/New SI Requests",
  "VeriCargo/Invoice Queries",
  "VeriCargo/General Messages",
  "VeriCargo/Spam",
  "VeriCargo/Email Intent Uncertain",
  "VeriCargo - Document Comparison",
  "VeriCargo - New SI Requests",
  "VeriCargo - Invoice Queries",
  "VeriCargo - General Messages",
  "VeriCargo - Spam",
  "VeriCargo - Email Intent Uncertain",
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

const decodeBase64Url = (value) => {
  if (!value) return "";
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
};

const walkParts = (part, visit) => {
  if (!part) return;
  visit(part);
  for (const child of part.parts || []) walkParts(child, visit);
};

const header = (message, name) =>
  message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value || "";

const senderName = (from) => {
  const named = from.match(/^\s*"?([^"<]+)"?\s*</);
  return named?.[1]?.trim() || from.split("@")[0] || "Unknown sender";
};

const greetingName = (message) => {
  const candidate = String(message.sender || senderName(message.senderAddress || ""))
    .replace(/[_\.]+/g, " ")
    .trim()
    .split(/\s+/)[0];
  if (!candidate || /^(unknown|customer)$/i.test(candidate)) return "Customer";
  return candidate.charAt(0).toLocaleUpperCase() + candidate.slice(1);
};

const messageText = (message) => {
  const textParts = [];
  walkParts(message.payload, (part) => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      textParts.push(decodeBase64Url(part.body.data));
    }
  });
  if (!textParts.length && message.payload?.body?.data) {
    textParts.push(decodeBase64Url(message.payload.body.data));
  }
  return textParts.join("\n").slice(0, 20000);
};

const attachmentMetadata = (message, { includeInlineData = false } = {}) => {
  const attachments = [];
  walkParts(message.payload, (part) => {
    if (part.filename) {
      const attachment = {
        attachmentId: part.body?.attachmentId || "",
        filename: part.filename,
        mimeType: part.mimeType || "application/octet-stream",
        size: Number(part.body?.size || 0),
      };
      if (includeInlineData && !attachment.attachmentId && part.body?.data) {
        attachment.data = part.body.data;
      }
      attachments.push(attachment);
    }
  });
  return attachments;
};

const normalizeMessage = (message) => {
  const subject = header(message, "Subject") || "(No subject)";
  const from = header(message, "From") || "Unknown sender";
  const received = header(message, "Date");
  const text = messageText(message);
  const attachments = attachmentMetadata(message);
  return {
    attachments,
    body: text || message.snippet || "No text preview available.",
    fields: [],
    id: message.id,
    internalDateMs: Number(message.internalDate || 0),
    labelIds: message.labelIds || [],
    received,
    result: null,
    sender: senderName(from),
    senderAddress: from,
    snippet: message.snippet || "",
    source: "GMAIL",
    subject,
    threadId: message.threadId,
  };
};

async function jsonRequest(fetchImpl, url, options, failureMessage) {
  const response = await fetchImpl(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error_description || body.error?.message || failureMessage);
    error.retryable = [429, 500, 502, 503, 504].includes(response.status) || /quota|rate limit/i.test(error.message);
    error.statusCode = response.status === 401 ? 401 : response.status === 429 ? 429 : 502;
    error.upstreamStatus = response.status;
    throw error;
  }
  return body;
}

export function createGmailService({ config, fetchImpl = fetch, firestore, now = () => Date.now() }) {
  const connections = firestore.collection("gmail_connections");

  async function connection(connectionId) {
    const reference = connections.doc(connectionId);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      const error = new Error("Gmail connection was not found.");
      error.statusCode = 404;
      throw error;
    }
    return { data: snapshot.data(), reference };
  }

  async function accessToken(connectionData) {
    const refreshToken = decryptSecret(connectionData.encryptedRefreshToken, config.encryptionKey);
    const token = await jsonRequest(
      fetchImpl,
      GOOGLE_TOKEN_ENDPOINT,
      {
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      },
      "Google could not refresh Gmail access.",
    );
    return token.access_token;
  }

  const gmailRequest = async (path, token, { body, method = "GET" } = {}) => {
    for (let attempt = 0; attempt <= MAX_GMAIL_RETRIES; attempt += 1) {
      try {
        return await jsonRequest(
          fetchImpl,
          `${GMAIL_API}${path}`,
          {
            body: body === undefined ? undefined : JSON.stringify(body),
            headers: {
              Authorization: `Bearer ${token}`,
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            method,
          },
          "Gmail API request failed.",
        );
      } catch (error) {
        if (!error.retryable || attempt === MAX_GMAIL_RETRIES) {
          if (error.retryable) {
            error.statusCode = 429;
            error.message = "Gmail rate limit reached. Synchronization is paused; retry shortly to resume.";
          }
          throw error;
        }
        const delay = Math.min(16000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        await sleep(delay);
      }
    }
    throw new Error("Gmail request retry loop ended unexpectedly.");
  };

  async function finishSync(reference, { imported, mode, requested }) {
    const countSnapshot = await reference.collection("messages").count().get();
    const shown = countSnapshot.data().count;
    const stableRequested = Math.max(Number(requested || 0), shown);
    await reference.set({ importedMessageCount: shown, inboxMessageCount: stableRequested }, { merge: true });
    return { done: true, imported, mode, requested: stableRequested, shown };
  }

  async function reconcileInboxMessages(reference, token) {
    const inboxMessageIds = new Set();
    let pageToken = null;
    do {
      const params = new URLSearchParams({
        includeSpamTrash: "false",
        labelIds: "INBOX",
        maxResults: "500",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const page = await gmailRequest(`/messages?${params}`, token);
      for (const message of page.messages || []) inboxMessageIds.add(message.id);
      pageToken = page.nextPageToken || null;
    } while (pageToken);

    const storedMessages = await reference.collection("messages").get();
    const staleReferences = storedMessages.docs
      .filter((document) => !inboxMessageIds.has(document.id))
      .map((document) => document.ref || reference.collection("messages").doc(document.id));
    for (let offset = 0; offset < staleReferences.length; offset += 400) {
      const batch = firestore.batch();
      for (const staleReference of staleReferences.slice(offset, offset + 400)) batch.delete(staleReference);
      await batch.commit();
    }
    return { inboxMessageCount: inboxMessageIds.size, removed: staleReferences.length };
  }

  async function syncFullMailbox(data, reference, token) {
    const params = new URLSearchParams({
      includeSpamTrash: "false",
      labelIds: "INBOX",
      maxResults: String(BATCH_SIZE),
    });
    if (data.syncPageToken) params.set("pageToken", data.syncPageToken);

    const list = await gmailRequest(`/messages?${params}`, token);
    let requested = Number(data.inboxMessageCount || list.resultSizeEstimate || 0);
    if (!data.syncPageToken) {
      const inboxLabel = await gmailRequest("/labels/INBOX", token);
      requested = Number(inboxLabel.messagesTotal || list.resultSizeEstimate || 0);
    }
    const messages = await mapWithConcurrency(
      list.messages || [],
      GMAIL_CONCURRENCY,
      (item) => gmailRequest(`/messages/${encodeURIComponent(item.id)}?format=full`, token),
    );
    const fullSyncHistoryId = data.syncPageToken
      ? data.fullSyncHistoryId || data.gmailHistoryId || null
      : messages[0]?.historyId || data.gmailHistoryId || null;
    const done = !list.nextPageToken;
    const batch = firestore.batch();
    for (const message of messages) {
      batch.set(reference.collection("messages").doc(message.id), normalizeMessage(message), { merge: true });
    }
    batch.set(
      reference,
      {
        fullSyncHistoryId: done ? null : fullSyncHistoryId,
        gmailHistoryId: done ? fullSyncHistoryId : data.gmailHistoryId || null,
        historyPageToken: null,
        initialSyncCompleted: done,
        lastSyncedAt: new Date(now()),
        inboxMessageCount: requested,
        status: done ? "SYNCED" : "SYNCING",
        syncPageToken: list.nextPageToken || null,
      },
      { merge: true },
    );
    await batch.commit();
    if (done) {
      const reconciliation = await reconcileInboxMessages(reference, token);
      requested = reconciliation.inboxMessageCount;
      await reference.set({ inboxReconciliationVersion: INBOX_RECONCILIATION_VERSION }, { merge: true });
      return finishSync(reference, { imported: messages.length, mode: "full", requested });
    }

    const countSnapshot = await reference.collection("messages").count().get();
    const shown = countSnapshot.data().count;
    const stableRequested = Math.max(requested, shown);
    await reference.set({ importedMessageCount: shown, inboxMessageCount: stableRequested }, { merge: true });
    return { done: false, imported: messages.length, mode: "full", requested: stableRequested, shown };
  }

  async function syncIncrementalMailbox(data, reference, token) {
    const params = new URLSearchParams({
      maxResults: String(BATCH_SIZE),
      startHistoryId: String(data.gmailHistoryId),
    });
    if (data.historyPageToken) params.set("pageToken", data.historyPageToken);

    let history;
    try {
      history = await gmailRequest(`/history?${params}`, token);
    } catch (error) {
      if (error.upstreamStatus !== 404) throw error;
      await reference.set({
        fullSyncHistoryId: null,
        gmailHistoryId: null,
        historyPageToken: null,
        initialSyncCompleted: false,
        status: "SYNCING",
        syncPageToken: null,
      }, { merge: true });
      return syncFullMailbox({ ...data, fullSyncHistoryId: null, gmailHistoryId: null, syncPageToken: null }, reference, token);
    }

    const messageIds = new Set();
    const labelEvents = [];
    const addMessageIds = (entries, include = () => true) => {
      for (const entry of entries || []) {
        if (include(entry) && entry.message?.id) messageIds.add(entry.message.id);
      }
    };
    for (const record of history.history || []) {
      addMessageIds(record.messagesAdded);
      addMessageIds(record.messagesDeleted);
      addMessageIds(record.labelsRemoved, (entry) => (entry.labelIds || []).includes("INBOX"));
      addMessageIds(record.labelsAdded, (entry) => (
        (entry.labelIds || []).includes("INBOX") || (entry.labelIds || []).includes("TRASH")
      ));
      for (const entry of record.labelsAdded || []) {
        labelEvents.push({ labelIds: entry.labelIds || [], messageId: entry.message?.id, type: "ADDED" });
      }
      for (const entry of record.labelsRemoved || []) {
        labelEvents.push({ labelIds: entry.labelIds || [], messageId: entry.message?.id, type: "REMOVED" });
      }
    }

    const systemLabelIds = new Set([
      "CHAT", "DRAFT", "IMPORTANT", "INBOX", "SENT", "SPAM", "STARRED", "TRASH", "UNREAD",
      "CATEGORY_FORUMS", "CATEGORY_PERSONAL", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES",
    ]);
    const hasCustomLabelChange = labelEvents.some(({ labelIds }) => (
      labelIds.some((labelId) => !systemLabelIds.has(labelId))
    ));
    const categoryByLabelId = new Map();
    if (hasCustomLabelChange) {
      const gmailLabels = await gmailRequest("/labels", token);
      const categoryByName = new Map(Object.entries(CATEGORY_LABELS).map(([category, name]) => [name, category]));
      for (const label of gmailLabels.labels || []) {
        const category = categoryByName.get(label.name);
        if (category) categoryByLabelId.set(label.id, category);
      }
    }
    const gmailCategoryChanges = new Map();
    for (const event of labelEvents) {
      const categories = event.labelIds.map((labelId) => categoryByLabelId.get(labelId)).filter(Boolean);
      if (!event.messageId || !categories.length) continue;
      messageIds.add(event.messageId);
      const change = gmailCategoryChanges.get(event.messageId) || { lastAddedCategory: null };
      if (event.type === "ADDED") change.lastAddedCategory = categories.at(-1);
      gmailCategoryChanges.set(event.messageId, change);
    }
    const fetched = await mapWithConcurrency(
      [...messageIds],
      GMAIL_CONCURRENCY,
      async (messageId) => {
        try {
          return await gmailRequest(`/messages/${encodeURIComponent(messageId)}?format=full`, token);
        } catch (error) {
          if (error.upstreamStatus === 404) return null;
          throw error;
        }
      },
    );
    const inboxMessages = fetched.filter((message) => (
      message
      && (message.labelIds || []).includes("INBOX")
      && !(message.labelIds || []).includes("TRASH")
    ));
    const inboxMessageIds = new Set(inboxMessages.map((message) => message.id));
    let requested = Number(data.inboxMessageCount || 0);
    if (!data.historyPageToken) {
      const inboxLabel = await gmailRequest("/labels/INBOX", token);
      requested = Number(inboxLabel.messagesTotal || requested);
    }
    const done = !history.nextPageToken;
    const batch = firestore.batch();
    for (const messageId of messageIds) {
      if (!inboxMessageIds.has(messageId)) batch.delete(reference.collection("messages").doc(messageId));
    }
    for (const message of inboxMessages) {
      const messageReference = reference.collection("messages").doc(message.id);
      let update = normalizeMessage(message);
      const gmailChange = gmailCategoryChanges.get(message.id);
      if (gmailChange) {
        const activeCategories = (message.labelIds || [])
          .map((labelId) => categoryByLabelId.get(labelId))
          .filter(Boolean);
        const resolvedCategory = activeCategories.includes(gmailChange.lastAddedCategory)
          ? gmailChange.lastAddedCategory
          : activeCategories.length === 1
            ? activeCategories[0]
            : null;
        if (resolvedCategory) {
          const storedSnapshot = await messageReference.get();
          const storedMessage = storedSnapshot.exists ? storedSnapshot.data() : {};
          if (storedMessage.category !== resolvedCategory) {
            const changedAt = new Date(now());
            update = {
              ...update,
              category: resolvedCategory,
              classificationReason: `Updated from the Gmail label ${CATEGORY_LABELS[resolvedCategory]}.`,
              classificationSource: "MANUAL_REVIEW",
              classificationStatus: "CLASSIFIED",
              confidence: 100,
              humanReviewedAt: changedAt,
              manualCategoryChangeSource: "GMAIL",
              manualCategoryChangedAt: changedAt,
              manualCategoryUndo: categoryUndoSnapshot(storedMessage),
              reviewReason: resolvedCategory === "HUMAN_REVIEW" ? "Intent needs confirmation." : null,
              status: "CLASSIFIED",
            };
          }
        }
      }
      batch.set(messageReference, update, { merge: true });
    }
    batch.set(
      reference,
      {
        gmailHistoryId: done ? history.historyId || data.gmailHistoryId : data.gmailHistoryId,
        historyPageToken: history.nextPageToken || null,
        initialSyncCompleted: true,
        lastSyncedAt: new Date(now()),
        inboxMessageCount: requested,
        status: done ? "SYNCED" : "SYNCING",
        syncPageToken: null,
      },
      { merge: true },
    );
    await batch.commit();
    if (done) {
      if (data.inboxReconciliationVersion !== INBOX_RECONCILIATION_VERSION) {
        const reconciliation = await reconcileInboxMessages(reference, token);
        requested = reconciliation.inboxMessageCount;
        await reference.set({ inboxReconciliationVersion: INBOX_RECONCILIATION_VERSION }, { merge: true });
      }
      return finishSync(reference, { imported: inboxMessages.length, mode: "incremental", requested });
    }

    const countSnapshot = await reference.collection("messages").count().get();
    const shown = countSnapshot.data().count;
    const stableRequested = Math.max(requested, shown);
    await reference.set({ importedMessageCount: shown, inboxMessageCount: stableRequested }, { merge: true });
    return { done: false, imported: inboxMessages.length, mode: "incremental", requested: stableRequested, shown };
  }

  return {
    async syncCategoryLabels(connectionId) {
      const { data, reference } = await connection(connectionId);
      const snapshot = await reference.collection("messages").get();
      const categorized = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }))
        .filter((message) => CATEGORY_LABELS[message.category] && ["GEMINI", "MANUAL_REVIEW"].includes(message.classificationSource));
      const fingerprint = createHash("sha256")
        .update(categorized.map((message) => `${message.id}:${message.category}`).sort().join("\n"))
        .digest("hex");
      if (
        data.gmailCategoryLabelSyncVersion === CATEGORY_LABEL_SYNC_VERSION
        && data.gmailCategoryLabelFingerprint === fingerprint
      ) {
        return { applied: 0, labels: Object.keys(CATEGORY_LABELS).length, skipped: true };
      }

      const token = await accessToken(data);
      const existing = await gmailRequest("/labels", token);
      const labelsByName = new Map((existing.labels || []).map((label) => [label.name, label]));
      for (const [category, name] of Object.entries(CATEGORY_LABELS)) {
        if (labelsByName.has(name)) continue;
        const created = await gmailRequest("/labels", token, {
          body: {
            color: CATEGORY_LABEL_COLORS[category],
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
            name,
          },
          method: "POST",
        });
        labelsByName.set(created.name, created);
      }

      for (const [category, name] of Object.entries(CATEGORY_LABELS)) {
        const label = labelsByName.get(name);
        await gmailRequest(`/labels/${encodeURIComponent(label.id)}`, token, {
          body: { color: CATEGORY_LABEL_COLORS[category] },
          method: "PATCH",
        });
      }

      const categoryLabelIds = Object.fromEntries(
        Object.entries(CATEGORY_LABELS).map(([category, name]) => [category, labelsByName.get(name).id]),
      );
      const legacyLabelIds = LEGACY_CATEGORY_LABELS
        .map((name) => labelsByName.get(name)?.id)
        .filter(Boolean);
      for (const category of Object.keys(CATEGORY_LABELS)) {
        const ids = categorized.filter((message) => message.category === category).map((message) => message.id);
        if (!ids.length) continue;
        const removeLabelIds = Object.entries(categoryLabelIds)
          .filter(([candidate]) => candidate !== category)
          .map(([, id]) => id)
          .concat(legacyLabelIds);
        for (let offset = 0; offset < ids.length; offset += 1000) {
          await gmailRequest("/messages/batchModify", token, {
            body: {
              addLabelIds: [categoryLabelIds[category]],
              ids: ids.slice(offset, offset + 1000),
              removeLabelIds,
            },
            method: "POST",
          });
        }
      }
      for (const labelId of legacyLabelIds) {
        await gmailRequest(`/labels/${encodeURIComponent(labelId)}`, token, { method: "DELETE" });
      }
      const legacyParent = labelsByName.get("VeriCargo");
      const hasUnrelatedLegacyChildren = [...labelsByName.keys()].some(
        (name) => name.startsWith("VeriCargo/") && !LEGACY_CATEGORY_LABELS.includes(name),
      );
      if (
        legacyParent
        && data.gmailCategoryLabelSyncVersion === "vericargo-category-labels-v1"
        && !hasUnrelatedLegacyChildren
      ) {
        await gmailRequest(`/labels/${encodeURIComponent(legacyParent.id)}`, token, { method: "DELETE" });
      }
      await reference.set({
        gmailCategoryLabelFingerprint: fingerprint,
        gmailCategoryLabelIds: categoryLabelIds,
        gmailCategoryLabelsSyncedAt: new Date(now()),
        gmailCategoryLabelSyncVersion: CATEGORY_LABEL_SYNC_VERSION,
      }, { merge: true });
      return {
        applied: categorized.length,
        labels: Object.keys(CATEGORY_LABELS).length,
        skipped: false,
      };
    },

    async getAttachmentMetadata(connectionId, messageId) {
      const { data, reference } = await connection(connectionId);
      const token = await accessToken(data);
      const message = await gmailRequest(`/messages/${encodeURIComponent(messageId)}?format=full`, token);
      const processingAttachments = attachmentMetadata(message, { includeInlineData: true });
      const storedAttachments = processingAttachments.map(({ data: _data, ...attachment }) => attachment);
      await reference.collection("messages").doc(messageId).set({ attachments: storedAttachments }, { merge: true });
      return processingAttachments;
    },

    async getAttachment(connectionId, messageId, attachmentId) {
      const { data, reference } = await connection(connectionId);
      const messageSnapshot = await reference.collection("messages").doc(messageId).get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      const attachment = (messageSnapshot.data().attachments || []).find(
        (candidate) => typeof candidate === "object" && candidate.attachmentId === attachmentId,
      );
      if (!attachment) {
        const error = new Error("Email attachment was not found.");
        error.statusCode = 404;
        throw error;
      }
      const token = await accessToken(data);
      const payload = await gmailRequest(
        `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        token,
      );
      return {
        data: payload.data || "",
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: Number(payload.size || attachment.size || 0),
      };
    },

    async getBlFile(connectionId, messageId, format, editedText) {
      const { reference } = await connection(connectionId);
      const messageSnapshot = await reference.collection("messages").doc(messageId).get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      const message = enrichDocumentComparison({ id: messageId, ...messageSnapshot.data() });
      if (message.documentWorkflowStatus !== "READY_FOR_COMPARISON") {
        const error = new Error("This case does not have a completed SI/BL comparison yet.");
        error.statusCode = 409;
        throw error;
      }
      const document = createBlDocument(message, format, editedText);
      return {
        data: document.buffer.toString("base64"),
        filename: document.filename,
        mimeType: document.mimeType,
        size: document.buffer.length,
      };
    },

    async createBlDraft(connectionId, messageId, format, editedText) {
      const { data, reference } = await connection(connectionId);
      const messageReference = reference.collection("messages").doc(messageId);
      const messageSnapshot = await messageReference.get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      const message = enrichDocumentComparison({ id: messageId, ...messageSnapshot.data() });
      if (message.documentWorkflowStatus !== "READY_FOR_COMPARISON") {
        const error = new Error("This case does not have a completed SI/BL comparison yet.");
        error.statusCode = 409;
        throw error;
      }
      const document = createBlDocument(message, format, editedText);
      const body = [
        `Dear ${greetingName(message)},`,
        "",
        "Thank you for your email.",
        "",
        "Please find the normalized Draft Bill of Lading attached for your review.",
        "",
        "Kindly verify all details against the source documents and let us know if any amendments are required.",
        "",
        "Thank you.",
        "",
        "Regards,",
        "VeriCargo",
      ].join("\n");
      const raw = Buffer.from(createDraftMime({
        attachment: document,
        body,
        subject: `Draft BL - ${message.subject || "Shipping documents"}`,
        to: message.senderAddress,
      }), "utf8").toString("base64url");
      const token = await accessToken(data);
      const draft = await gmailRequest("/drafts", token, {
        body: { message: { raw } },
        method: "POST",
      });
      const gmailMessageId = draft.message?.id || "";
      await messageReference.set({
        blDraftCreatedAt: new Date(now()),
        blDraftFilename: document.filename,
        blDraftFormat: document.format,
        gmailDraftId: draft.id || "",
        gmailDraftMessageId: gmailMessageId,
      }, { merge: true });
      return {
        draftId: draft.id || "",
        filename: document.filename,
        gmailMessageId,
        gmailUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(data.email || "")}#drafts/${encodeURIComponent(gmailMessageId)}`,
      };
    },

    async setMessageCategory(connectionId, messageId, category) {
      const resolvedCategory = String(category || "").trim().toUpperCase();
      const allowedCategories = Object.keys(CATEGORY_LABELS).filter((candidate) => candidate !== "HUMAN_REVIEW");
      if (!allowedCategories.includes(resolvedCategory)) {
        const error = new Error("Select a valid resolved email category.");
        error.statusCode = 400;
        throw error;
      }
      const { data, reference } = await connection(connectionId);
      const messageReference = reference.collection("messages").doc(messageId);
      const messageSnapshot = await messageReference.get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      if (messageSnapshot.data().category !== "HUMAN_REVIEW") {
        const error = new Error("This email no longer requires intent review.");
        error.statusCode = 409;
        throw error;
      }

      const token = await accessToken(data);
      const existing = await gmailRequest("/labels", token);
      const labelsByName = new Map((existing.labels || []).map((label) => [label.name, label]));
      const targetName = CATEGORY_LABELS[resolvedCategory];
      if (!labelsByName.has(targetName)) {
        const created = await gmailRequest("/labels", token, {
          body: {
            color: CATEGORY_LABEL_COLORS[resolvedCategory],
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
            name: targetName,
          },
          method: "POST",
        });
        labelsByName.set(created.name, created);
      }
      const targetLabel = labelsByName.get(targetName);
      await gmailRequest(`/labels/${encodeURIComponent(targetLabel.id)}`, token, {
        body: { color: CATEGORY_LABEL_COLORS[resolvedCategory] },
        method: "PATCH",
      });
      const removeLabelIds = Object.values(CATEGORY_LABELS)
        .filter((name) => name !== targetName)
        .map((name) => labelsByName.get(name)?.id)
        .filter(Boolean);
      await gmailRequest(`/messages/${encodeURIComponent(messageId)}/modify`, token, {
        body: { addLabelIds: [targetLabel.id], removeLabelIds },
        method: "POST",
      });

      const reviewedAt = new Date(now());
      const previousMessage = messageSnapshot.data();
      const update = {
        category: resolvedCategory,
        classificationReason: `Resolved by a human reviewer as ${targetName}.`,
        classificationSource: "MANUAL_REVIEW",
        classificationStatus: "CLASSIFIED",
        confidence: 100,
        humanReviewedAt: reviewedAt,
        manualCategoryChangeSource: "EXTENSION",
        manualCategoryChangedAt: reviewedAt,
        manualCategoryUndo: categoryUndoSnapshot(previousMessage),
        reviewReason: null,
        status: "CLASSIFIED",
      };
      await messageReference.set(update, { merge: true });
      return {
        message: { ...update, humanReviewedAt: reviewedAt.toISOString() },
        messageId,
      };
    },

    async revokeMessageCategory(connectionId, messageId) {
      const { data, reference } = await connection(connectionId);
      const messageReference = reference.collection("messages").doc(messageId);
      const messageSnapshot = await messageReference.get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      const message = messageSnapshot.data();
      const undo = message.manualCategoryUndo;
      const restoredCategory = String(undo?.category || "").trim().toUpperCase();
      if (!CATEGORY_LABELS[restoredCategory]) {
        const error = new Error("There is no label change available to revoke.");
        error.statusCode = 409;
        throw error;
      }

      const token = await accessToken(data);
      const existing = await gmailRequest("/labels", token);
      const labelsByName = new Map((existing.labels || []).map((label) => [label.name, label]));
      const targetName = CATEGORY_LABELS[restoredCategory];
      if (!labelsByName.has(targetName)) {
        const created = await gmailRequest("/labels", token, {
          body: {
            color: CATEGORY_LABEL_COLORS[restoredCategory],
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
            name: targetName,
          },
          method: "POST",
        });
        labelsByName.set(created.name, created);
      }
      const targetLabel = labelsByName.get(targetName);
      await gmailRequest(`/labels/${encodeURIComponent(targetLabel.id)}`, token, {
        body: { color: CATEGORY_LABEL_COLORS[restoredCategory] },
        method: "PATCH",
      });
      const removeLabelIds = Object.values(CATEGORY_LABELS)
        .filter((name) => name !== targetName)
        .map((name) => labelsByName.get(name)?.id)
        .filter(Boolean);
      await gmailRequest(`/messages/${encodeURIComponent(messageId)}/modify`, token, {
        body: { addLabelIds: [targetLabel.id], removeLabelIds },
        method: "POST",
      });

      const update = {
        ...undo,
        manualCategoryChangeSource: null,
        manualCategoryChangedAt: null,
        manualCategoryUndo: null,
      };
      if (restoredCategory === "HUMAN_REVIEW") {
        Object.assign(update, {
          comparisonReviewStatus: null,
          comparisonReviewUpdatedAt: null,
          comparisonReviewedAt: null,
          documentComparison: null,
          documentProcessedAt: null,
          documentProcessingError: null,
          documentProcessingVersion: null,
          documentReviewReason: null,
          documentWorkflowStatus: null,
          draftBlDocument: null,
          siDocument: null,
        });
      }
      await messageReference.set(update, { merge: true });
      return { message: update, messageId };
    },

    async createHumanReviewDraft(connectionId, messageId, issueType, editedBody) {
      const supportedIssues = new Set(["MISSING_AMBIGUOUS_DOCUMENT", "UNREADABLE_LOW_QUALITY"]);
      const normalizedIssue = String(issueType || "").trim().toUpperCase();
      if (!supportedIssues.has(normalizedIssue)) {
        const error = new Error("This review type does not support a document response draft.");
        error.statusCode = 400;
        throw error;
      }
      const body = String(editedBody || "").trim();
      if (!body || body.length > 20000) {
        const error = new Error("The response email must contain between 1 and 20,000 characters.");
        error.statusCode = 400;
        throw error;
      }
      const { data, reference } = await connection(connectionId);
      const messageReference = reference.collection("messages").doc(messageId);
      const messageSnapshot = await messageReference.get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      const message = messageSnapshot.data();
      if (message.documentWorkflowStatus !== normalizedIssue) {
        const error = new Error("This document issue has already changed. Refresh the review queue and try again.");
        error.statusCode = 409;
        throw error;
      }
      const subject = /^\s*re:/i.test(message.subject || "")
        ? message.subject
        : `Re: ${message.subject || "Shipping documents"}`;
      const raw = Buffer.from(createTextDraftMime({
        body,
        subject,
        to: message.senderAddress,
      }), "utf8").toString("base64url");
      const token = await accessToken(data);
      const draft = await gmailRequest("/drafts", token, {
        body: { message: { raw } },
        method: "POST",
      });
      const gmailMessageId = draft.message?.id || "";
      const createdAt = new Date(now());
      await messageReference.set({
        humanReviewDraftCreatedAt: createdAt,
        humanReviewDraftId: draft.id || "",
        humanReviewDraftIssueType: normalizedIssue,
        humanReviewDraftMessageId: gmailMessageId,
      }, { merge: true });
      return {
        draftId: draft.id || "",
        gmailMessageId,
        gmailUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(data.email || "")}#drafts/${encodeURIComponent(gmailMessageId)}`,
      };
    },

    async setComparisonReviewStatus(connectionId, messageId, status) {
      const reviewStatus = String(status || "").trim().toUpperCase();
      if (!new Set(["PENDING", "COMPLETE"]).has(reviewStatus)) {
        const error = new Error("Review status must be PENDING or COMPLETE.");
        error.statusCode = 400;
        throw error;
      }
      const { reference } = await connection(connectionId);
      const messageReference = reference.collection("messages").doc(messageId);
      const messageSnapshot = await messageReference.get();
      if (!messageSnapshot.exists) {
        const error = new Error("Email message was not found.");
        error.statusCode = 404;
        throw error;
      }
      const message = enrichDocumentComparison({ id: messageId, ...messageSnapshot.data() });
      if (message.documentWorkflowStatus !== "READY_FOR_COMPARISON") {
        const error = new Error("This case does not have a completed SI/BL comparison yet.");
        error.statusCode = 409;
        throw error;
      }
      const updatedAt = new Date(now());
      const reviewedAt = reviewStatus === "COMPLETE" ? updatedAt : null;
      await messageReference.set({
        comparisonReviewStatus: reviewStatus,
        comparisonReviewUpdatedAt: updatedAt,
        comparisonReviewedAt: reviewedAt,
      }, { merge: true });
      return {
        messageId,
        reviewedAt: reviewedAt?.toISOString() || null,
        status: reviewStatus,
        updatedAt: updatedAt.toISOString(),
      };
    },

    async status(connectionId) {
      const { data } = await connection(connectionId);
      return {
        email: data.email,
        lastSyncedAt: data.lastSyncedAt?.toDate?.()?.toISOString?.() || null,
        status: data.status,
      };
    },

    async syncNextBatch(connectionId) {
      const { data, reference } = await connection(connectionId);
      const token = await accessToken(data);
      const canUseIncrementalSync = Boolean(data.gmailHistoryId)
        && !data.syncPageToken
        && (data.initialSyncCompleted === true
          || (data.status === "SYNCED" && Number(data.importedMessageCount || 0) > 0));
      return canUseIncrementalSync
        ? syncIncrementalMailbox(data, reference, token)
        : syncFullMailbox(data, reference, token);
    },

    async listMessages(connectionId) {
      const { data, reference } = await connection(connectionId);
      const snapshot = await reference
        .collection("messages")
        .orderBy("internalDateMs", "desc")
        .get();
      const messages = snapshot.docs.map((document) => enrichDocumentComparison(document.data()));
      return {
        messages,
        requested: Number(data.inboxMessageCount || messages.length),
        shown: messages.length,
      };
    },
  };
}
