import assert from "node:assert/strict";
import test from "node:test";

import { encryptSecret } from "../src/crypto-utils.js";
import { createGmailService } from "../src/gmail-service.js";

const response = (body) => ({ json: async () => body, ok: true, status: 200 });

test("migrates old VeriCargo labels to category-only labels and bulk-applies exactly one category label per message", async () => {
  const encryptionKey = Buffer.alloc(32, 7);
  const connectionWrites = [];
  const messageDocuments = [
    { data: () => ({ category: "DOCUMENT_COMPARISON", classificationSource: "GEMINI" }), id: "message-1" },
    { data: () => ({ category: "HUMAN_REVIEW", classificationSource: "GEMINI" }), id: "message-2" },
    { data: () => ({ category: "GENERAL", classificationSource: "MANUAL" }), id: "message-3" },
  ];
  const connectionReference = {
    collection: (name) => {
      assert.equal(name, "messages");
      return { get: async () => ({ docs: messageDocuments }) };
    },
    get: async () => ({
      data: () => ({
        encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
        gmailCategoryLabelSyncVersion: "vericargo-category-labels-v1",
      }),
      exists: true,
    }),
    set: async (value) => connectionWrites.push(value),
  };
  const createdLabels = [];
  const createdLabelBodies = [];
  const deletedLabels = [];
  const labelColorUpdates = [];
  const modifications = [];
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.endsWith("/labels") && (!options.method || options.method === "GET")) {
      return response({
        labels: [
          { id: "legacy-parent", name: "VeriCargo" },
          { id: "legacy-document", name: "VeriCargo/Document Comparison" },
          { id: "prefixed-review", name: "VeriCargo - Email Intent Uncertain" },
        ],
      });
    }
    if (url.endsWith("/labels") && options.method === "POST") {
      const label = JSON.parse(options.body);
      createdLabels.push(label.name);
      createdLabelBodies.push(label);
      return response({ id: `label-${createdLabels.length}`, name: label.name });
    }
    if (url.includes("/labels/") && options.method === "PATCH") {
      labelColorUpdates.push(JSON.parse(options.body));
      return response({});
    }
    if (url.includes("/labels/") && options.method === "DELETE") {
      deletedLabels.push(decodeURIComponent(url.split("/labels/")[1]));
      return response({});
    }
    if (url.endsWith("/messages/batchModify") && options.method === "POST") {
      modifications.push(JSON.parse(options.body));
      return response({});
    }
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: { collection: () => ({ doc: () => connectionReference }) },
    now: () => 123,
  });

  const result = await service.syncCategoryLabels("connection-1");

  assert.equal(result.applied, 2);
  assert.equal(result.labels, 6);
  assert.deepEqual(createdLabels, [
    "Document Comparison",
    "New SI Requests",
    "Invoice Queries",
    "General Messages",
    "Spam Email",
    "Email Intent Uncertain",
  ]);
  assert.equal(createdLabelBodies.every((label) => (
    label.color.backgroundColor === "#ff7537" && label.color.textColor === "#ffffff"
  )), true);
  assert.equal(labelColorUpdates.length, 6);
  assert.equal(labelColorUpdates.every(({ color }) => (
    color.backgroundColor === "#ff7537" && color.textColor === "#ffffff"
  )), true);
  assert.equal(modifications.length, 2);
  assert.deepEqual(modifications[0].ids, ["message-1"]);
  assert.deepEqual(modifications[1].ids, ["message-2"]);
  assert.equal(modifications.some((entry) => entry.removeLabelIds.includes("INBOX")), false);
  assert.deepEqual(deletedLabels, ["legacy-document", "prefixed-review", "legacy-parent"]);
  assert.equal(connectionWrites[0].gmailCategoryLabelSyncVersion, "vericargo-category-labels-v4-uniform-color");
});

const gmailMessage = (id, historyId = "100") => ({
  historyId,
  id,
  internalDate: "123",
  labelIds: ["INBOX"],
  payload: {
    body: { data: Buffer.from("Hello").toString("base64url") },
    headers: [
      { name: "Subject", value: "New shipping email" },
      { name: "From", value: "Customer <customer@example.com>" },
      { name: "Date", value: "Mon, 21 Sep 2026 10:00:00 +0800" },
    ],
    mimeType: "text/plain",
  },
  snippet: "Hello",
  threadId: `thread-${id}`,
});

const makeSyncFirestore = (connectionData, shownCount, storedMessageIds = []) => {
  const batchWrites = [];
  const connectionWrites = [];
  const messageReferences = new Map();
  const messagesCollection = {
    count: () => ({ get: async () => ({ data: () => ({ count: shownCount }) }) }),
    doc: (id) => {
      if (!messageReferences.has(id)) messageReferences.set(id, { id });
      return messageReferences.get(id);
    },
    get: async () => ({
      docs: [...messageReferences.values()].map((reference) => ({ id: reference.id, ref: reference })),
    }),
  };
  for (const messageId of storedMessageIds) messagesCollection.doc(messageId);
  const connectionReference = {
    collection: (name) => {
      assert.equal(name, "messages");
      return messagesCollection;
    },
    get: async () => ({ data: () => connectionData, exists: true }),
    set: async (value) => connectionWrites.push(value),
  };
  return {
    batchWrites,
    connectionReference,
    connectionWrites,
    firestore: {
      batch: () => ({
        commit: async () => undefined,
        delete: (target) => batchWrites.push({ operation: "delete", target }),
        set: (target, value) => batchWrites.push({ operation: "set", target, value }),
      }),
      collection: () => ({ doc: () => connectionReference }),
    },
  };
};

test("completed mailboxes use Gmail history and fetch only newly added messages", async () => {
  const encryptionKey = Buffer.alloc(32, 8);
  const setup = makeSyncFirestore({
    encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
    gmailHistoryId: "100",
    inboxReconciliationVersion: "vericargo-inbox-reconciliation-v1",
    importedMessageCount: 2,
    inboxMessageCount: 2,
    initialSyncCompleted: true,
    status: "SYNCED",
    syncPageToken: null,
  }, 3);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.includes("/history?")) {
      assert.match(url, /startHistoryId=100/);
      return response({
        history: [{ messagesAdded: [{ message: { id: "message-new" } }] }],
        historyId: "105",
      });
    }
    if (url.includes("/messages/message-new?format=full")) return response(gmailMessage("message-new", "105"));
    if (url.endsWith("/labels/INBOX")) return response({ messagesTotal: 3 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: setup.firestore,
    now: () => 123,
  });

  const result = await service.syncNextBatch("connection-1");

  assert.deepEqual(result, { done: true, imported: 1, mode: "incremental", requested: 3, shown: 3 });
  assert.equal(requests.some((url) => /\/messages\?/.test(url)), false);
  const connectionUpdate = setup.batchWrites.find(({ target }) => target === setup.connectionReference).value;
  assert.equal(connectionUpdate.gmailHistoryId, "105");
  assert.equal(connectionUpdate.initialSyncCompleted, true);
  assert.equal(setup.batchWrites.some(({ target }) => target.id === "message-new"), true);
});

test("removes a message when Gmail moves it out of Inbox and into Trash", async () => {
  const encryptionKey = Buffer.alloc(32, 12);
  const setup = makeSyncFirestore({
    encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
    gmailHistoryId: "100",
    inboxMessageCount: 2,
    inboxReconciliationVersion: "vericargo-inbox-reconciliation-v1",
    initialSyncCompleted: true,
    status: "SYNCED",
  }, 1, ["message-trashed"]);
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.includes("/history?")) {
      assert.equal(url.includes("historyTypes=messageAdded"), false);
      return response({
        history: [{
          labelsAdded: [{ labelIds: ["TRASH"], message: { id: "message-trashed" } }],
          labelsRemoved: [{ labelIds: ["INBOX"], message: { id: "message-trashed" } }],
        }],
        historyId: "106",
      });
    }
    if (url.includes("/messages/message-trashed?format=full")) {
      return response({ ...gmailMessage("message-trashed", "106"), labelIds: ["TRASH"] });
    }
    if (url.endsWith("/labels/INBOX")) return response({ messagesTotal: 1 });
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: setup.firestore,
    now: () => 123,
  });

  const result = await service.syncNextBatch("connection-1");

  assert.deepEqual(result, { done: true, imported: 0, mode: "incremental", requested: 1, shown: 1 });
  assert.equal(setup.batchWrites.some(({ operation, target }) => (
    operation === "delete" && target.id === "message-trashed"
  )), true);
  assert.equal(setup.batchWrites.some(({ operation, target }) => (
    operation === "set" && target.id === "message-trashed"
  )), false);
});

test("one-time reconciliation removes Inbox records missed by an older sync", async () => {
  const encryptionKey = Buffer.alloc(32, 13);
  const setup = makeSyncFirestore({
    encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
    gmailHistoryId: "100",
    inboxMessageCount: 2,
    initialSyncCompleted: true,
    status: "SYNCED",
  }, 1, ["message-kept", "message-stale"]);
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.includes("/history?")) return response({ history: [], historyId: "107" });
    if (url.endsWith("/labels/INBOX")) return response({ messagesTotal: 1 });
    if (url.includes("/messages?")) return response({ messages: [{ id: "message-kept" }] });
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: setup.firestore,
    now: () => 123,
  });

  await service.syncNextBatch("connection-1");

  assert.equal(setup.batchWrites.some(({ operation, target }) => (
    operation === "delete" && target.id === "message-stale"
  )), true);
  assert.equal(setup.batchWrites.some(({ operation, target }) => (
    operation === "delete" && target.id === "message-kept"
  )), false);
  assert.equal(setup.connectionWrites.some(({ inboxReconciliationVersion }) => (
    inboxReconciliationVersion === "vericargo-inbox-reconciliation-v1"
  )), true);
});

test("initial synchronization stores the newest message history cursor", async () => {
  const encryptionKey = Buffer.alloc(32, 9);
  const setup = makeSyncFirestore({
    encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
    gmailHistoryId: "90",
    importedMessageCount: 0,
    status: "CONNECTED",
    syncPageToken: null,
  }, 1);
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.includes("/messages?")) return response({ messages: [{ id: "message-1" }], resultSizeEstimate: 1 });
    if (url.endsWith("/labels/INBOX")) return response({ messagesTotal: 1 });
    if (url.includes("/messages/message-1?format=full")) return response(gmailMessage("message-1", "100"));
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: setup.firestore,
    now: () => 123,
  });

  const result = await service.syncNextBatch("connection-1");

  assert.equal(result.mode, "full");
  const connectionUpdate = setup.batchWrites.find(({ target }) => target === setup.connectionReference).value;
  assert.equal(connectionUpdate.gmailHistoryId, "100");
  assert.equal(connectionUpdate.initialSyncCompleted, true);
});

test("an expired Gmail history cursor falls back to a full synchronization", async () => {
  const encryptionKey = Buffer.alloc(32, 10);
  const setup = makeSyncFirestore({
    encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
    gmailHistoryId: "expired",
    importedMessageCount: 1,
    inboxMessageCount: 1,
    initialSyncCompleted: true,
    status: "SYNCED",
    syncPageToken: null,
  }, 1);
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.includes("/history?")) {
      return { json: async () => ({ error: { message: "History ID is too old." } }), ok: false, status: 404 };
    }
    if (url.includes("/messages?")) return response({ messages: [{ id: "message-1" }], resultSizeEstimate: 1 });
    if (url.endsWith("/labels/INBOX")) return response({ messagesTotal: 1 });
    if (url.includes("/messages/message-1?format=full")) return response(gmailMessage("message-1", "200"));
    throw new Error(`Unexpected request: ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: setup.firestore,
    now: () => 123,
  });

  const result = await service.syncNextBatch("connection-1");

  assert.equal(result.mode, "full");
  assert.equal(requests.some((url) => url.includes("/history?")), true);
  assert.equal(requests.some((url) => url.includes("/messages?")), true);
});

test("creates a Gmail draft with the normalized BL attached", async () => {
  const encryptionKey = Buffer.alloc(32, 11);
  const messageWrites = [];
  const sourceMessage = {
    documentWorkflowStatus: "READY_FOR_COMPARISON",
    sender: "sandra_example",
    senderAddress: "Sandra Example <sandra@example.com>",
    subject: "Shipping documents",
    siDocument: {
      filename: "SI.txt",
      fields: { shipper: { normalizedValue: "APRIL FINE PAPER TRADING" } },
    },
    draftBlDocument: {
      filename: "Draft-BL.txt",
      fields: { consignee: { normalizedValue: "CLIFFORD PAPER INC" } },
    },
  };
  const messageReference = {
    get: async () => ({ data: () => sourceMessage, exists: true }),
    set: async (value) => messageWrites.push(value),
  };
  const connectionReference = {
    collection: () => ({ doc: () => messageReference }),
    get: async () => ({
      data: () => ({
        email: "vericargo@example.com",
        encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
      }),
      exists: true,
    }),
  };
  let submittedDraft;
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.endsWith("/drafts") && options.method === "POST") {
      submittedDraft = JSON.parse(options.body);
      return response({ id: "draft-1", message: { id: "gmail-message-1" } });
    }
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: { collection: () => ({ doc: () => connectionReference }) },
    now: () => 123,
  });

  const editedText = "USER-REVIEWED DRAFT BL\nShipper: Corrected shipper";
  const result = await service.createBlDraft("connection-1", "message-1", "txt", editedText);
  const mime = Buffer.from(submittedDraft.message.raw, "base64url").toString("utf8");
  const emailBodyBase64 = mime.match(/Content-Type: text\/plain; charset="UTF-8"[\s\S]*?Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/)?.[1] || "";
  const emailBody = Buffer.from(emailBodyBase64.replaceAll("\r\n", ""), "base64").toString("utf8");

  assert.equal(result.draftId, "draft-1");
  assert.match(result.gmailUrl, /authuser=vericargo%40example\.com#drafts\/gmail-message-1$/);
  assert.match(mime, /To: Sandra Example <sandra@example\.com>/);
  assert.match(emailBody, /^Dear Sandra,/);
  assert.match(emailBody, /Please find the normalized Draft Bill of Lading attached for your review\./);
  assert.match(emailBody, /let us know if any amendments are required\./);
  assert.doesNotMatch(emailBody, /Normalized Draft BL content|Corrected shipper/);
  assert.match(mime, /Content-Disposition: attachment; filename="VeriCargo-Draft-BL-Shipping documents\.txt"/);
  assert.match(mime, new RegExp(Buffer.from(editedText).toString("base64").slice(0, 20)));
  assert.equal(messageWrites[0].gmailDraftId, "draft-1");
  assert.equal(messageWrites[0].blDraftFormat, "txt");
});

test("persists comparison review status and supports moving a case back to pending", async () => {
  const writes = [];
  const sourceMessage = {
    documentWorkflowStatus: "READY_FOR_COMPARISON",
    draftBlDocument: { fields: {} },
    siDocument: { fields: {} },
  };
  const messageReference = {
    get: async () => ({ data: () => sourceMessage, exists: true }),
    set: async (value, options) => writes.push({ options, value }),
  };
  const connectionReference = {
    collection: () => ({ doc: () => messageReference }),
    get: async () => ({ data: () => ({ email: "vericargo@example.com" }), exists: true }),
  };
  const service = createGmailService({
    config: {},
    firestore: { collection: () => ({ doc: () => connectionReference }) },
    now: () => Date.parse("2026-09-21T00:00:00.000Z"),
  });

  const complete = await service.setComparisonReviewStatus("connection-1", "message-1", "complete");
  const pending = await service.setComparisonReviewStatus("connection-1", "message-1", "PENDING");

  assert.deepEqual(complete, {
    messageId: "message-1",
    reviewedAt: "2026-09-21T00:00:00.000Z",
    status: "COMPLETE",
    updatedAt: "2026-09-21T00:00:00.000Z",
  });
  assert.equal(writes[0].value.comparisonReviewStatus, "COMPLETE");
  assert.equal(writes[0].value.comparisonReviewedAt.toISOString(), "2026-09-21T00:00:00.000Z");
  assert.deepEqual(writes[0].options, { merge: true });
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.reviewedAt, null);
  assert.equal(writes[1].value.comparisonReviewedAt, null);
});

test("resolves uncertain intent with a manual category and updates its Gmail label", async () => {
  const encryptionKey = Buffer.alloc(32, 12);
  const writes = [];
  const gmailRequests = [];
  const messageReference = {
    get: async () => ({ data: () => ({ category: "HUMAN_REVIEW" }), exists: true }),
    set: async (value, options) => writes.push({ options, value }),
  };
  const connectionReference = {
    collection: () => ({ doc: () => messageReference }),
    get: async () => ({
      data: () => ({
        email: "vericargo@example.com",
        encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
      }),
      exists: true,
    }),
  };
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    gmailRequests.push({ options, url });
    if (url.endsWith("/labels") && options.method === "GET") {
      return response({ labels: [
        { id: "label-general", name: "General Messages" },
        { id: "label-review", name: "Email Intent Uncertain" },
      ] });
    }
    if (url.includes("/labels/label-general") && options.method === "PATCH") return response({});
    if (url.endsWith("/messages/message-1/modify") && options.method === "POST") return response({});
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: { collection: () => ({ doc: () => connectionReference }) },
    now: () => Date.parse("2026-09-21T01:00:00.000Z"),
  });

  const result = await service.setMessageCategory("connection-1", "message-1", "GENERAL");
  const modify = gmailRequests.find(({ url }) => url.endsWith("/messages/message-1/modify"));

  assert.equal(result.message.category, "GENERAL");
  assert.equal(result.message.classificationSource, "MANUAL_REVIEW");
  assert.equal(result.message.confidence, 100);
  assert.deepEqual(JSON.parse(modify.options.body), {
    addLabelIds: ["label-general"],
    removeLabelIds: ["label-review"],
  });
  assert.equal(writes[0].value.category, "GENERAL");
  assert.deepEqual(writes[0].options, { merge: true });
});

test("creates an editable human-review response as a Gmail draft", async () => {
  const encryptionKey = Buffer.alloc(32, 13);
  const writes = [];
  const messageReference = {
    get: async () => ({
      data: () => ({
        documentWorkflowStatus: "UNREADABLE_LOW_QUALITY",
        senderAddress: "Sandra Example <sandra@example.com>",
        subject: "Shipping documents",
      }),
      exists: true,
    }),
    set: async (value, options) => writes.push({ options, value }),
  };
  const connectionReference = {
    collection: () => ({ doc: () => messageReference }),
    get: async () => ({
      data: () => ({
        email: "vericargo@example.com",
        encryptedRefreshToken: encryptSecret("refresh-token", encryptionKey),
      }),
      exists: true,
    }),
  };
  let submittedDraft;
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://oauth2.googleapis.com/token") return response({ access_token: "access-token" });
    if (url.endsWith("/drafts") && options.method === "POST") {
      submittedDraft = JSON.parse(options.body);
      return response({ id: "draft-review-1", message: { id: "gmail-review-message-1" } });
    }
    throw new Error(`Unexpected request: ${options.method || "GET"} ${url}`);
  };
  const service = createGmailService({
    config: { clientId: "client", clientSecret: "secret", encryptionKey },
    fetchImpl,
    firestore: { collection: () => ({ doc: () => connectionReference }) },
    now: () => Date.parse("2026-09-21T02:00:00.000Z"),
  });
  const body = "Dear Sandra,\n\nPlease resend both readable documents.\n\nRegards,\nVeriCargo";

  const result = await service.createHumanReviewDraft(
    "connection-1",
    "message-1",
    "UNREADABLE_LOW_QUALITY",
    body,
  );
  const mime = Buffer.from(submittedDraft.message.raw, "base64url").toString("utf8");

  assert.equal(result.draftId, "draft-review-1");
  assert.match(result.gmailUrl, /authuser=vericargo%40example\.com#drafts\/gmail-review-message-1$/);
  assert.match(mime, /To: Sandra Example <sandra@example\.com>/);
  assert.match(mime, new RegExp(Buffer.from(body).toString("base64").slice(0, 24)));
  assert.equal(writes[0].value.humanReviewDraftIssueType, "UNREADABLE_LOW_QUALITY");
  assert.deepEqual(writes[0].options, { merge: true });
});
