(function initializeCloudClient() {
  const API_BASE = "https://vericargo-api-8562721906.asia-southeast1.run.app";
  const SESSION_KEY = "vericargoCloudSession";
  const POLL_KEY = "vericargoConnectionPollToken";
  const storage = chrome.storage.local;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function stored(key) {
    const values = await storage.get([key]);
    return values[key] || "";
  }

  async function request(path, { body, method = "GET", session = true } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (session) {
      const token = await stored(SESSION_KEY);
      if (!token) throw new Error("Connect Gmail to continue.");
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers,
      method,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) await storage.remove(SESSION_KEY);
      throw new Error(result.message || `VeriCargo service request failed (${response.status}).`);
    }
    return result;
  }

  async function startConnection() {
    const result = await request("/api/connect/start", { method: "POST", session: false });
    await storage.set({ [POLL_KEY]: result.pollToken });
    await chrome.tabs.create({ url: result.authorizationUrl });
    return result;
  }

  async function waitForConnection(onWaiting) {
    const pollToken = await stored(POLL_KEY);
    if (!pollToken) throw new Error("Start Gmail authorization again.");
    for (let attempt = 0; attempt < 150; attempt += 1) {
      let result;
      try {
        result = await request("/api/connect/status", {
          body: { pollToken },
          method: "POST",
          session: false,
        });
      } catch (error) {
        await storage.remove(POLL_KEY);
        throw error;
      }
      if (result.status === "CONNECTED") {
        await storage.set({ [SESSION_KEY]: result.sessionToken });
        await storage.remove(POLL_KEY);
        return result;
      }
      onWaiting?.();
      await sleep(2000);
    }
    throw new Error("Authorization timed out. Start the connection again.");
  }

  async function cancelPendingConnection() {
    await storage.remove(POLL_KEY);
  }

  async function syncAll(onProgress) {
    let imported = 0;
    for (let batch = 0; batch < 1000; batch += 1) {
      const result = await request("/api/sync", { method: "POST" });
      imported += result.imported;
      onProgress?.({ imported, requested: result.requested, shown: result.shown });
      if (result.done) return { imported, requested: result.requested, shown: result.shown };
      await sleep(1200);
    }
    throw new Error("Inbox synchronization exceeded the supported batch count.");
  }

  async function classifyAll(onProgress) {
    let classified = 0;
    let processed = 0;
    let targetTotal = null;
    for (let batch = 0; batch < 1000; batch += 1) {
      const result = await request("/api/classify", { method: "POST" });
      classified += result.classified;
      processed += result.processed;
      targetTotal ??= result.processed + result.remaining;
      onProgress?.({ ...result, classified, processed, total: targetTotal });
      if (result.done) return { ...result, classified, processed, total: targetTotal };
      await sleep(300);
    }
    throw new Error("Email classification exceeded the supported batch count.");
  }

  async function disconnect() {
    try {
      if (await stored(SESSION_KEY)) await request("/api/disconnect", { method: "POST" });
    } finally {
      await storage.remove([SESSION_KEY, POLL_KEY]);
    }
  }

  globalThis.VeriCargoCloud = {
    attachment: (messageId, attachmentId) => request(`/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`),
    cancelPendingConnection,
    classificationStatus: () => request("/api/classification"),
    classifyAll,
    connection: () => request("/api/connection"),
    disconnect,
    hasPendingConnection: async () => Boolean(await stored(POLL_KEY)),
    hasSession: async () => Boolean(await stored(SESSION_KEY)),
    messages: () => request("/api/messages"),
    startConnection,
    syncAll,
    waitForConnection,
  };
})();
