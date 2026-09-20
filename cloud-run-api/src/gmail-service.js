import { createHash } from "node:crypto";

import { decryptSecret } from "./crypto-utils.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const BATCH_SIZE = 10;
const GMAIL_CONCURRENCY = 2;
const MAX_GMAIL_RETRIES = 5;
const CATEGORY_LABEL_SYNC_VERSION = "vericargo-category-labels-v3-category-only";

const CATEGORY_LABELS = {
  DOCUMENT_COMPARISON: "Document Comparison",
  NEW_SI: "New SI Requests",
  INVOICE_QUERY: "Invoice Queries",
  GENERAL: "General Messages",
  SPAM: "Spam Email",
  HUMAN_REVIEW: "Email Intent Uncertain",
};

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

  return {
    async syncCategoryLabels(connectionId) {
      const { data, reference } = await connection(connectionId);
      const snapshot = await reference.collection("messages").get();
      const categorized = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }))
        .filter((message) => CATEGORY_LABELS[message.category] && message.classificationSource === "GEMINI");
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
      for (const name of Object.values(CATEGORY_LABELS)) {
        if (labelsByName.has(name)) continue;
        const created = await gmailRequest("/labels", token, {
          body: { labelListVisibility: "labelShow", messageListVisibility: "show", name },
          method: "POST",
        });
        labelsByName.set(created.name, created);
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
      const batch = firestore.batch();
      for (const message of messages) {
        batch.set(reference.collection("messages").doc(message.id), normalizeMessage(message), { merge: true });
      }
      const done = !list.nextPageToken;
      batch.set(
        reference,
        {
          lastSyncedAt: new Date(now()),
          inboxMessageCount: requested,
          status: done ? "SYNCED" : "SYNCING",
          syncPageToken: list.nextPageToken || null,
        },
        { merge: true },
      );
      await batch.commit();
      const countSnapshot = await reference.collection("messages").count().get();
      const shown = countSnapshot.data().count;
      const stableRequested = Math.max(requested, shown);
      await reference.set({ importedMessageCount: shown, inboxMessageCount: stableRequested }, { merge: true });
      return { done, imported: messages.length, requested: stableRequested, shown };
    },

    async listMessages(connectionId) {
      const { data, reference } = await connection(connectionId);
      const snapshot = await reference
        .collection("messages")
        .orderBy("internalDateMs", "desc")
        .get();
      const messages = snapshot.docs.map((document) => document.data());
      return {
        messages,
        requested: Number(data.inboxMessageCount || messages.length),
        shown: messages.length,
      };
    },
  };
}
