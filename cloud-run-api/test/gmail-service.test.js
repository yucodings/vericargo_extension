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
  const deletedLabels = [];
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
      return response({ id: `label-${createdLabels.length}`, name: label.name });
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
  assert.equal(modifications.length, 2);
  assert.deepEqual(modifications[0].ids, ["message-1"]);
  assert.deepEqual(modifications[1].ids, ["message-2"]);
  assert.equal(modifications.some((entry) => entry.removeLabelIds.includes("INBOX")), false);
  assert.deepEqual(deletedLabels, ["legacy-document", "prefixed-review", "legacy-parent"]);
  assert.equal(connectionWrites[0].gmailCategoryLabelSyncVersion, "vericargo-category-labels-v3-category-only");
});
