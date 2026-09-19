(function initializeGmailClient() {
  const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
  const CLIENT_PLACEHOLDER = "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID";

  function configuration() {
    const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
    const clientId = manifest.oauth2?.client_id || "";
    return {
      clientId,
      configured: Boolean(clientId && !clientId.includes(CLIENT_PLACEHOLDER)),
      scope: manifest.oauth2?.scopes?.[0] || "",
    };
  }

  async function getToken(interactive) {
    const config = configuration();
    if (!config.configured) {
      throw new Error("Add your Google OAuth client ID to chrome-extension/manifest.json first.");
    }
    const result = await chrome.identity.getAuthToken({ interactive });
    const token = typeof result === "string" ? result : result?.token;
    if (!token) throw new Error("Chrome did not return a Gmail access token.");
    return token;
  }

  async function gmailRequest(path, token) {
    const response = await fetch(`${GMAIL_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      await chrome.identity.removeCachedAuthToken({ token });
      throw new Error("Gmail authorization expired. Connect again to continue.");
    }
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.error?.message || `Gmail API request failed (${response.status}).`);
    }
    return response.json();
  }

  function header(message, name) {
    return message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value || "";
  }

  function walkParts(part, visit) {
    if (!part) return;
    visit(part);
    (part.parts || []).forEach((child) => walkParts(child, visit));
  }

  function decodeBase64Url(value) {
    if (!value) return "";
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function messageText(message) {
    const textParts = [];
    walkParts(message.payload, (part) => {
      if (part.mimeType === "text/plain" && part.body?.data) textParts.push(decodeBase64Url(part.body.data));
    });
    if (!textParts.length && message.payload?.body?.data) textParts.push(decodeBase64Url(message.payload.body.data));
    return textParts.join("\n").slice(0, 12000);
  }

  function attachmentNames(message) {
    const names = [];
    walkParts(message.payload, (part) => {
      if (part.filename) names.push(part.filename);
    });
    return names;
  }

  function classify(subject, body, attachments) {
    const text = `${subject} ${body} ${attachments.join(" ")}`.toLowerCase();
    const hasDraft = /draft\s*(bl|bill of lading)|bill of lading/.test(text);
    const hasSi = /shipping instruction|\bsi\b/.test(text);
    if (hasDraft && hasSi) return "DOCUMENT_COMPARISON";
    if (/invoice|payment|remittance/.test(text)) return "INVOICE_QUERY";
    if (hasSi) return "NEW_SI";
    if (/unsubscribe|limited offer|promotion/.test(text)) return "SPAM";
    return "GENERAL";
  }

  function senderName(from) {
    const named = from.match(/^\s*"?([^"<]+)"?\s*</);
    return named?.[1]?.trim() || from.split("@")[0] || "Unknown sender";
  }

  function toCase(message) {
    const subject = header(message, "Subject") || "(No subject)";
    const from = header(message, "From") || "Unknown sender";
    const received = header(message, "Date");
    const text = messageText(message);
    const attachments = attachmentNames(message);
    const category = classify(subject, text || message.snippet || "", attachments);
    const isComparison = category === "DOCUMENT_COMPARISON";
    return {
      id: message.id,
      threadId: message.threadId,
      sender: senderName(from),
      senderAddress: from,
      time: received ? new Date(received).toLocaleString([], { month: "short", day: "numeric" }) : "Gmail",
      subject,
      body: message.snippet || text.slice(0, 240) || "No text preview available.",
      category,
      status: isComparison ? "HUMAN_REVIEW" : "CLASSIFIED",
      result: null,
      confidence: isComparison ? 0 : 92,
      reviewReason: isComparison ? "Document Processing Not Configured" : null,
      fields: [],
      attachments,
      source: "GMAIL",
    };
  }

  async function loadMessages({ interactive }) {
    const token = await getToken(interactive);
    const query = 'newer_than:90d (shipping OR shipment OR "bill of lading" OR "shipping instruction" OR invoice)';
    const params = new URLSearchParams({ maxResults: "20", q: query });
    const [profile, list] = await Promise.all([
      gmailRequest("/profile", token),
      gmailRequest(`/messages?${params.toString()}`, token),
    ]);
    const details = await Promise.all(
      (list.messages || []).map((item) => gmailRequest(`/messages/${item.id}?format=full`, token)),
    );
    return {
      emailAddress: profile.emailAddress,
      cases: details.map(toCase),
    };
  }

  async function disconnect() {
    await chrome.identity.clearAllCachedAuthTokens();
  }

  globalThis.BlinkGmail = { configuration, loadMessages, disconnect };
})();
