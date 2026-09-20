import assert from "node:assert/strict";
import test from "node:test";

import { createClassificationService } from "../src/classification-service.js";

const makeFirestore = (messages) => {
  const writes = [];
  const docs = messages.map((message) => ({
    data: () => message,
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

test("Gemini classifications are saved with structured category metadata", async () => {
  const { firestore, writes } = makeFirestore([{
    body: "Please compare the attached shipping instruction with the draft BL.",
    classificationStatus: "PENDING",
    senderAddress: "customer@example.com",
    subject: "Check draft BL",
  }]);
  let request;
  const fetchImpl = async (_url, options) => {
    request = options;
    return {
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          category: "DOCUMENT_COMPARISON",
          confidence: 97,
          reason: "The sender requests an SI and Draft BL comparison.",
        }) }] } }],
      }),
      ok: true,
    };
  };
  const service = createClassificationService({
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl,
    firestore,
    now: () => 123,
  });

  const result = await service.classifyNextBatch("connection-1");

  assert.equal(result.classified, 1);
  assert.equal(result.done, true);
  assert.equal(writes[0].value.category, "DOCUMENT_COMPARISON");
  assert.equal(writes[0].value.classificationSource, "GEMINI");
  assert.equal(writes[0].value.confidence, 97);
  assert.equal(request.headers["x-goog-api-key"], "test-key");
  assert.equal(JSON.parse(request.body).generationConfig.responseMimeType, "application/json");
});

test("confidence below 90 percent is routed to Human Review", async () => {
  const { firestore, writes } = makeFirestore([{ body: "Maybe this is an SI.", subject: "Question" }]);
  const service = createClassificationService({
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => ({
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          category: "NEW_SI",
          confidence: 72,
          reason: "The intent is ambiguous.",
        }) }] } }],
      }),
      ok: true,
    }),
    firestore,
  });

  await service.classifyNextBatch("connection-1");

  assert.equal(writes[0].value.category, "HUMAN_REVIEW");
  assert.equal(writes[0].value.status, "HUMAN_REVIEW");
  assert.match(writes[0].value.classificationReason, /Low confidence/);
});

test("Gemini authentication failures stop the batch without misclassifying email", async () => {
  const { firestore, writes } = makeFirestore([{ body: "Shipping instruction", subject: "New SI" }]);
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
