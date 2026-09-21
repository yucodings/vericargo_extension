import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp } from "../src/app.js";

const server = createApp();
let baseUrl;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health endpoint reports an operational service", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "vericargo-api",
    status: "ok",
  });
});

test("OAuth endpoint remains disabled when server configuration is missing", async () => {
  const response = await fetch(`${baseUrl}/oauth/start`);

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "OAUTH_NOT_CONFIGURED");
});

test("OAuth start redirects through the configured service", async () => {
  const oauthServer = createApp({
    oauthService: {
      start: async () => "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    },
  });
  await new Promise((resolve) => oauthServer.listen(0, "127.0.0.1", resolve));
  const address = oauthServer.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/oauth/start`, {
      redirect: "manual",
    });
    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get("location"),
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );
  } finally {
    await new Promise((resolve, reject) => {
      oauthServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("extension connection and message routes use backend sessions", async () => {
  const oauthService = {
    authenticate: async (header) => {
      assert.equal(header, "Bearer extension-session");
      return { connectionId: "connection-1" };
    },
    startExtension: async () => ({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      pollToken: "poll-token",
    }),
  };
  const gmailService = {
    createHumanReviewDraft: async (connectionId, messageId, issueType, body) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(issueType, "MISSING_AMBIGUOUS_DOCUMENT");
      assert.equal(body, "Dear Sandra, please resend the SI.");
      return { draftId: "review-draft-1", gmailUrl: "https://mail.google.com/review-draft" };
    },
    createBlDraft: async (connectionId, messageId, format, text) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(format, "docx");
      assert.equal(text, "Reviewed Draft BL");
      return { draftId: "draft-1", filename: "Draft.docx", gmailUrl: "https://mail.google.com/draft" };
    },
    getAttachment: async (connectionId, messageId, attachmentId) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(attachmentId, "attachment-1");
      return { data: "dGVzdA", filename: "SI.txt", mimeType: "text/plain", size: 4 };
    },
    getBlFile: async (connectionId, messageId, format, text) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      if (text !== undefined) {
        assert.equal(format, "txt");
        assert.equal(text, "Reviewed Draft BL");
        return { data: "UkVWSUVXRUQ=", filename: "Draft.txt", mimeType: "text/plain", size: 8 };
      }
      assert.equal(format, "pdf");
      return { data: "JVBERg==", filename: "Draft.pdf", mimeType: "application/pdf", size: 4 };
    },
    listMessages: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return {
        messages: [{ id: "message-1", subject: "Shipping instruction" }],
        requested: 1,
        shown: 1,
      };
    },
    setComparisonReviewStatus: async (connectionId, messageId, status) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(status, "COMPLETE");
      return { messageId, reviewedAt: "2026-09-21T00:00:00.000Z", status };
    },
    setMessageCategory: async (connectionId, messageId, category) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(category, "GENERAL");
      return { message: { category, classificationSource: "MANUAL_REVIEW" }, messageId };
    },
    revokeMessageCategory: async (connectionId, messageId) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      return { message: { category: "HUMAN_REVIEW", classificationSource: "GEMINI" }, messageId };
    },
    syncCategoryLabels: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return { applied: 1, labels: 6, skipped: false };
    },
  };
  const apiServer = createApp({ gmailService, oauthService });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const address = apiServer.address();
  const apiBase = `http://127.0.0.1:${address.port}`;

  try {
    const startResponse = await fetch(`${apiBase}/api/connect/start`, { method: "POST" });
    assert.equal(startResponse.status, 200);
    assert.equal((await startResponse.json()).pollToken, "poll-token");

    const messagesResponse = await fetch(`${apiBase}/api/messages`, {
      headers: { Authorization: "Bearer extension-session" },
    });
    assert.equal(messagesResponse.status, 200);
    assert.deepEqual(await messagesResponse.json(), {
      messages: [{ id: "message-1", subject: "Shipping instruction" }],
      requested: 1,
      shown: 1,
    });

    const attachmentResponse = await fetch(
      `${apiBase}/api/messages/message-1/attachments/attachment-1`,
      { headers: { Authorization: "Bearer extension-session" } },
    );
    assert.deepEqual(await attachmentResponse.json(), {
      data: "dGVzdA",
      filename: "SI.txt",
      mimeType: "text/plain",
      size: 4,
    });

    const blFileResponse = await fetch(`${apiBase}/api/messages/message-1/bl-file?format=pdf`, {
      headers: { Authorization: "Bearer extension-session" },
    });
    assert.deepEqual(await blFileResponse.json(), {
      data: "JVBERg==",
      filename: "Draft.pdf",
      mimeType: "application/pdf",
      size: 4,
    });

    const editedBlFileResponse = await fetch(`${apiBase}/api/messages/message-1/bl-file`, {
      body: JSON.stringify({ format: "txt", text: "Reviewed Draft BL" }),
      headers: { Authorization: "Bearer extension-session", "Content-Type": "application/json" },
      method: "POST",
    });
    assert.deepEqual(await editedBlFileResponse.json(), {
      data: "UkVWSUVXRUQ=",
      filename: "Draft.txt",
      mimeType: "text/plain",
      size: 8,
    });

    const blDraftResponse = await fetch(`${apiBase}/api/messages/message-1/bl-draft`, {
      body: JSON.stringify({ format: "docx", text: "Reviewed Draft BL" }),
      headers: { Authorization: "Bearer extension-session", "Content-Type": "application/json" },
      method: "POST",
    });
    assert.deepEqual(await blDraftResponse.json(), {
      draftId: "draft-1",
      filename: "Draft.docx",
      gmailUrl: "https://mail.google.com/draft",
    });

    const reviewStatusResponse = await fetch(`${apiBase}/api/messages/message-1/review-status`, {
      body: JSON.stringify({ status: "COMPLETE" }),
      headers: { Authorization: "Bearer extension-session", "Content-Type": "application/json" },
      method: "POST",
    });
    assert.deepEqual(await reviewStatusResponse.json(), {
      messageId: "message-1",
      reviewedAt: "2026-09-21T00:00:00.000Z",
      status: "COMPLETE",
    });

    const categoryResponse = await fetch(`${apiBase}/api/messages/message-1/category`, {
      body: JSON.stringify({ category: "GENERAL" }),
      headers: { Authorization: "Bearer extension-session", "Content-Type": "application/json" },
      method: "POST",
    });
    assert.deepEqual(await categoryResponse.json(), {
      message: { category: "GENERAL", classificationSource: "MANUAL_REVIEW" },
      messageId: "message-1",
    });

    const revokeCategoryResponse = await fetch(`${apiBase}/api/messages/message-1/category/revoke`, {
      headers: { Authorization: "Bearer extension-session" },
      method: "POST",
    });
    assert.deepEqual(await revokeCategoryResponse.json(), {
      message: { category: "HUMAN_REVIEW", classificationSource: "GEMINI" },
      messageId: "message-1",
    });

    const reviewDraftResponse = await fetch(`${apiBase}/api/messages/message-1/review-draft`, {
      body: JSON.stringify({
        body: "Dear Sandra, please resend the SI.",
        issueType: "MISSING_AMBIGUOUS_DOCUMENT",
      }),
      headers: { Authorization: "Bearer extension-session", "Content-Type": "application/json" },
      method: "POST",
    });
    assert.deepEqual(await reviewDraftResponse.json(), {
      draftId: "review-draft-1",
      gmailUrl: "https://mail.google.com/review-draft",
    });

    const labelsResponse = await fetch(`${apiBase}/api/labels/sync`, {
      headers: { Authorization: "Bearer extension-session" },
      method: "POST",
    });
    assert.deepEqual(await labelsResponse.json(), { applied: 1, labels: 6, skipped: false });
  } finally {
    await new Promise((resolve, reject) => {
      apiServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("classification routes expose setup status and process an authenticated batch", async () => {
  const oauthService = {
    authenticate: async (header) => {
      assert.equal(header, "Bearer extension-session");
      return { connectionId: "connection-1" };
    },
  };
  const classificationService = {
    model: "gemini-test",
    pipelineVersion: "test-pipeline",
    spamPolicyVersion: "test-spam-policy",
    classifyNextBatch: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return { classified: 5, done: false, processed: 5, remaining: 10, total: 15 };
    },
  };
  const apiServer = createApp({ classificationService, oauthService });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const address = apiServer.address();
  const apiBase = `http://127.0.0.1:${address.port}`;

  try {
    const headers = { Authorization: "Bearer extension-session" };
    const statusResponse = await fetch(`${apiBase}/api/classification`, { headers });
    assert.deepEqual(await statusResponse.json(), {
      configured: true,
      model: "gemini-test",
      pipelineVersion: "test-pipeline",
      spamPolicyVersion: "test-spam-policy",
    });

    const classifyResponse = await fetch(`${apiBase}/api/classify`, { headers, method: "POST" });
    assert.deepEqual(await classifyResponse.json(), {
      classified: 5,
      done: false,
      processed: 5,
      remaining: 10,
      total: 15,
    });
  } finally {
    await new Promise((resolve, reject) => {
      apiServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("document-processing routes expose status and process an authenticated case", async () => {
  const oauthService = {
    authenticate: async (header) => {
      assert.equal(header, "Bearer extension-session");
      return { connectionId: "connection-1" };
    },
  };
  const documentService = {
    processorVersion: "processor-test",
    processNextBatch: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return { done: true, processed: 1, remaining: 0, total: 1, updates: [{ id: "message-1" }] };
    },
  };
  const apiServer = createApp({ documentService, oauthService });
  await new Promise((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  const address = apiServer.address();
  const apiBase = `http://127.0.0.1:${address.port}`;

  try {
    const headers = { Authorization: "Bearer extension-session" };
    const statusResponse = await fetch(`${apiBase}/api/documents/status`, { headers });
    assert.deepEqual(await statusResponse.json(), { configured: true, processorVersion: "processor-test" });

    const processResponse = await fetch(`${apiBase}/api/documents/process`, { headers, method: "POST" });
    assert.deepEqual(await processResponse.json(), {
      done: true,
      processed: 1,
      remaining: 0,
      total: 1,
      updates: [{ id: "message-1" }],
    });
  } finally {
    await new Promise((resolve, reject) => {
      apiServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("unknown routes return JSON 404 responses", async () => {
  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "NOT_FOUND");
});
