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
    getAttachment: async (connectionId, messageId, attachmentId) => {
      assert.equal(connectionId, "connection-1");
      assert.equal(messageId, "message-1");
      assert.equal(attachmentId, "attachment-1");
      return { data: "dGVzdA", filename: "SI.txt", mimeType: "text/plain", size: 4 };
    },
    listMessages: async (connectionId) => {
      assert.equal(connectionId, "connection-1");
      return {
        messages: [{ id: "message-1", subject: "Shipping instruction" }],
        requested: 1,
        shown: 1,
      };
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
    assert.deepEqual(await statusResponse.json(), { configured: true, model: "gemini-test" });

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

test("unknown routes return JSON 404 responses", async () => {
  const response = await fetch(`${baseUrl}/missing`);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "NOT_FOUND");
});
