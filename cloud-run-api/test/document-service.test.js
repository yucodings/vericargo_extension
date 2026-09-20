import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentService, DOCUMENT_WORKFLOW_STATUS } from "../src/document-service.js";

const emptyField = {
  confidence: 0,
  evidence: "",
  normalizedValue: "",
  page: "",
  rawValue: "",
};

const analysis = (documentType, overrides = {}) => ({
  documentType,
  extractedText: `${documentType} extracted text`,
  fields: {
    shipper: { confidence: 98, evidence: "Shipper: ABC", normalizedValue: "ABC", page: "1", rawValue: "ABC" },
    consignee: emptyField,
    notifyParty: emptyField,
    portOfLoading: emptyField,
    portOfDischarge: emptyField,
    containerCount: emptyField,
    grossWeightKg: emptyField,
  },
  identificationEvidence: `Identified as ${documentType}`,
  qualityReason: "Readable document",
  qualityScore: 96,
  qualitySufficient: true,
  ...overrides,
});

const geminiResponse = (result) => ({
  json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }),
  ok: true,
});

const makeFirestore = (message) => {
  const messageWrites = [];
  const document = {
    data: () => message,
    id: message.id,
    ref: { set: async (value) => messageWrites.push(value) },
  };
  const connectionReference = {
    collection: (name) => {
      if (name === "messages") return { orderBy: () => ({ get: async () => ({ docs: [document] }) }) };
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
  return {
    firestore: { collection: () => ({ doc: () => connectionReference }) },
    messageWrites,
  };
};

const attachments = [
  { attachmentId: "si-1", filename: "SI.txt", mimeType: "text/plain", size: 200 },
  { attachmentId: "bl-1", filename: "Draft-BL.txt", mimeType: "text/plain", size: 200 },
];

const attachmentLoader = async (_connectionId, _messageId, attachmentId) => ({
  data: Buffer.from(`${attachmentId} `.repeat(30)).toString("base64url"),
  filename: attachmentId === "si-1" ? "SI.txt" : "Draft-BL.txt",
  mimeType: "text/plain",
  size: 200,
});

test("identifies one SI and one Draft BL and stores the seven-field extraction", async () => {
  const { firestore, messageWrites } = makeFirestore({
    attachments,
    category: "DOCUMENT_COMPARISON",
    id: "message-1",
  });
  const responses = [analysis("SHIPPING_INSTRUCTION"), analysis("DRAFT_BILL_OF_LADING")];
  const service = createDocumentService({
    attachmentLoader,
    attachmentMetadataLoader: async () => attachments,
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => geminiResponse(responses.shift()),
    firestore,
  });

  const result = await service.processNextBatch("connection-1");

  assert.equal(result.processed, 1);
  assert.equal(messageWrites[0].documentWorkflowStatus, DOCUMENT_WORKFLOW_STATUS.READY);
  assert.equal(messageWrites[0].siDocument.fields.shipper.normalizedValue, "ABC");
  assert.equal(messageWrites[0].draftBlDocument.documentType, "DRAFT_BILL_OF_LADING");
  assert.equal(messageWrites[0].siDocument.processingMethod, "GEMINI_TEXT_EXTRACTION");
  assert.equal(result.updates[0].documentWorkflowStatus, DOCUMENT_WORKFLOW_STATUS.READY);
});

test("routes a case with no Draft BL to Missing or Ambiguous Document", async () => {
  const { firestore, messageWrites } = makeFirestore({
    attachments: [attachments[0]],
    category: "DOCUMENT_COMPARISON",
    id: "message-1",
  });
  const service = createDocumentService({
    attachmentLoader,
    attachmentMetadataLoader: async () => [attachments[0]],
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => geminiResponse(analysis("SHIPPING_INSTRUCTION")),
    firestore,
  });

  await service.processNextBatch("connection-1");

  assert.equal(messageWrites[0].documentWorkflowStatus, DOCUMENT_WORKFLOW_STATUS.MISSING_AMBIGUOUS);
  assert.match(messageWrites[0].documentReviewReason, /0 Draft BL/);
});

test("routes an unreadable identified document to the low-quality review queue", async () => {
  const { firestore, messageWrites } = makeFirestore({
    attachments,
    category: "DOCUMENT_COMPARISON",
    id: "message-1",
  });
  const responses = [
    analysis("SHIPPING_INSTRUCTION", { qualityReason: "Blurred scan", qualityScore: 30, qualitySufficient: false }),
    analysis("DRAFT_BILL_OF_LADING"),
  ];
  const service = createDocumentService({
    attachmentLoader,
    attachmentMetadataLoader: async () => attachments,
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => geminiResponse(responses.shift()),
    firestore,
  });

  await service.processNextBatch("connection-1");

  assert.equal(messageWrites[0].documentWorkflowStatus, DOCUMENT_WORKFLOW_STATUS.UNREADABLE_LOW_QUALITY);
  assert.match(messageWrites[0].documentReviewReason, /Blurred scan/);
});

test("uses Gemini vision OCR for a scanned image attachment", async () => {
  const imageAttachment = {
    attachmentId: "scan-1",
    filename: "scanned-si.png",
    mimeType: "image/png",
    size: 256,
  };
  const { firestore, messageWrites } = makeFirestore({
    attachments: [imageAttachment],
    category: "DOCUMENT_COMPARISON",
    id: "message-1",
  });
  let requestBody;
  const service = createDocumentService({
    attachmentLoader: async () => ({
      data: Buffer.from("pretend scanned image bytes").toString("base64url"),
      filename: imageAttachment.filename,
      mimeType: imageAttachment.mimeType,
    }),
    attachmentMetadataLoader: async () => [imageAttachment],
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return geminiResponse(analysis("SHIPPING_INSTRUCTION"));
    },
    firestore,
  });

  await service.processNextBatch("connection-1");

  const parts = requestBody.contents[0].parts;
  assert.equal(parts[1].inlineData.mimeType, "image/png");
  assert.ok(parts[1].inlineData.data);
  assert.equal(messageWrites[0].documentArtifacts[0].processingMethod, "GEMINI_VISION_OCR");
});

test("routes an unsupported attachment to low-quality review without downloading it", async () => {
  const unsupportedDocument = {
    attachmentId: "document-1",
    filename: "shipping-instruction.doc",
    mimeType: "application/msword",
    size: 1000,
  };
  const { firestore, messageWrites } = makeFirestore({
    attachments: [unsupportedDocument],
    category: "DOCUMENT_COMPARISON",
    id: "message-1",
  });
  let downloadCalled = false;
  const service = createDocumentService({
    attachmentLoader: async () => {
      downloadCalled = true;
      throw new Error("should not download unsupported content");
    },
    attachmentMetadataLoader: async () => [unsupportedDocument],
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => { throw new Error("should not call Gemini"); },
    firestore,
  });

  await service.processNextBatch("connection-1");

  assert.equal(downloadCalled, false);
  assert.equal(messageWrites[0].documentWorkflowStatus, DOCUMENT_WORKFLOW_STATUS.UNREADABLE_LOW_QUALITY);
  assert.match(messageWrites[0].documentReviewReason, /Unsupported attachment format/);
});

test("records a file-specific Gemini invalid-argument response and continues the workflow", async () => {
  const imageAttachment = {
    attachmentId: "bad-scan",
    filename: "bad-scan.png",
    mimeType: "image/png",
    size: 256,
  };
  const { firestore, messageWrites } = makeFirestore({
    attachments: [imageAttachment],
    category: "DOCUMENT_COMPARISON",
    id: "message-1",
  });
  const service = createDocumentService({
    attachmentLoader: async () => ({
      data: Buffer.from("invalid image bytes").toString("base64url"),
      filename: imageAttachment.filename,
      mimeType: imageAttachment.mimeType,
    }),
    attachmentMetadataLoader: async () => [imageAttachment],
    config: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
    fetchImpl: async () => ({
      json: async () => ({ error: { message: "Request contains an invalid argument." } }),
      ok: false,
      status: 400,
    }),
    firestore,
  });

  const result = await service.processNextBatch("connection-1");

  assert.equal(result.processed, 1);
  assert.equal(messageWrites[0].documentWorkflowStatus, DOCUMENT_WORKFLOW_STATUS.UNREADABLE_LOW_QUALITY);
  assert.match(messageWrites[0].documentReviewReason, /invalid argument/);
});
