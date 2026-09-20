import assert from "node:assert/strict";
import test from "node:test";

import { CLASSIFICATION_PIPELINE_VERSION, createClassificationService } from "../src/classification-service.js";

const makeFirestore = (messages) => {
  const writes = [];
  const docs = messages.map((message, index) => ({
    data: () => message,
    id: message.id || `message-${index + 1}`,
    ref: {
      set: async (value, options) => writes.push({ options, value }),
    },
  }));
  return {
    firestore: {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            orderBy: () => ({ get: async () => ({ docs }) }),
          }),
        }),
      }),
    },
    writes,
  };
};

const geminiResponse = (overrides = {}) => ({
  json: async () => ({
    candidates: [{ content: { parts: [{ text: JSON.stringify({
      attachmentIndexes: [],
      category: "DOCUMENT_COMPARISON",
      confidence: 97,
      evidence: "The email asks to compare an SI with a Draft BL.",
      evidenceSufficient: true,
      reason: "The sender requests an SI and Draft BL comparison.",
      ...overrides,
    }) }] } }],
  }),
  ok: true,
});

test("email-only Gemini classifications are saved and returned as progressive updates", async () => {
  const { firestore, writes } = makeFirestore([{
    body: "Please compare the attached shipping instruction with the draft BL.",
    id: "message-1",
    senderAddress: "customer@example.com",
    subject: "Check draft BL",
  }]);
  let request;
  const service = createClassificationService({
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async (_url, options) => {
      request = options;
      return geminiResponse();
    },
    firestore,
    now: () => 123,
  });

  const result = await service.classifyNextBatch("connection-1");

  assert.equal(result.classified, 1);
  assert.equal(result.done, true);
  assert.equal(result.updates[0].id, "message-1");
  assert.equal(result.updates[0].category, "DOCUMENT_COMPARISON");
  assert.equal(writes[0].value.classificationPipelineVersion, CLASSIFICATION_PIPELINE_VERSION);
  assert.equal(writes[0].value.attachmentAssisted, false);
  assert.equal(request.headers["x-goog-api-key"], "test-key");
  assert.equal(JSON.parse(request.body).generationConfig.responseMimeType, "application/json");
});

test("ambiguous email triggers a second multimodal pass with the requested attachment", async () => {
  const { firestore, writes } = makeFirestore([{
    attachments: [{ attachmentId: "attachment-1", filename: "SI.pdf", mimeType: "application/pdf", size: 1024 }],
    body: "Please see attached.",
    id: "message-1",
    subject: "Documents",
  }]);
  const requests = [];
  const responses = [
    geminiResponse({
      attachmentIndexes: [0],
      category: "HUMAN_REVIEW",
      confidence: 55,
      evidence: "The email text does not state the intent.",
      evidenceSufficient: false,
      reason: "Attachment content is required.",
    }),
    geminiResponse({
      attachmentIndexes: [],
      category: "NEW_SI",
      confidence: 96,
      evidence: "The PDF is a completed Shipping Instruction.",
      evidenceSufficient: true,
      reason: "The attachment establishes a new SI request.",
    }),
  ];
  const service = createClassificationService({
    attachmentLoader: async (connectionId, messageId, attachmentId) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(attachmentId, "attachment-1");
      return { data: "cGRm", filename: "SI.pdf", mimeType: "application/pdf", size: 1024 };
    },
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return responses.shift();
    },
    firestore,
  });

  const result = await service.classifyNextBatch("connection-1");

  assert.equal(requests.length, 2);
  assert.equal(requests[1].contents[0].parts[2].inlineData.mimeType, "application/pdf");
  assert.equal(writes[0].value.category, "NEW_SI");
  assert.equal(writes[0].value.attachmentAssisted, true);
  assert.equal(writes[0].value.attachmentEvidence[0].filename, "SI.pdf");
  assert.equal(result.updates[0].category, "NEW_SI");
});

test("insufficient evidence without a usable attachment is routed to Human Review", async () => {
  const { firestore, writes } = makeFirestore([{ body: "Maybe this is an SI.", id: "message-1", subject: "Question" }]);
  const service = createClassificationService({
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => geminiResponse({
      category: "NEW_SI",
      confidence: 72,
      evidence: "The intent is unclear.",
      evidenceSufficient: false,
      reason: "The intent is ambiguous.",
    }),
    firestore,
  });

  await service.classifyNextBatch("connection-1");

  assert.equal(writes[0].value.category, "HUMAN_REVIEW");
  assert.equal(writes[0].value.status, "HUMAN_REVIEW");
  assert.match(writes[0].value.classificationReason, /no attachment was available/i);
});

test("Gemini authentication failures stop the batch without misclassifying email", async () => {
  const { firestore, writes } = makeFirestore([{ body: "Shipping instruction", id: "message-1", subject: "New SI" }]);
  const service = createClassificationService({
    config: { geminiApiKey: "invalid-key", geminiModel: "gemini-test" },
    fetchImpl: async () => ({
      json: async () => ({ error: { message: "API key is invalid." } }),
      ok: false,
      status: 403,
    }),
    firestore,
  });

  await assert.rejects(() => service.classifyNextBatch("connection-1"), /API key is invalid/);
  assert.equal(writes.length, 0);
});
