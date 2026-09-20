import http from "node:http";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

const corsHeaders = (request) => {
  const origin = request.headers.origin || "";
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return {};
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
};

const json = (request, response, statusCode, body) => {
  response.writeHead(statusCode, {
    ...securityHeaders,
    ...corsHeaders(request),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
};

const html = (response, statusCode, title, message) => {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  response.writeHead(statusCode, {
    ...securityHeaders,
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(message)}</p></main></body></html>`);
};

const readJson = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
};

export function createApp({ classificationService = null, documentService = null, oauthService = null, gmailService = null } = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const isApi = url.pathname.startsWith("/api/");

    try {
      if (request.method === "OPTIONS" && isApi) {
        response.writeHead(204, { ...securityHeaders, ...corsHeaders(request) });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        json(request, response, 200, { service: "vericargo-api", status: "ok" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        json(request, response, 200, {
          service: "vericargo-api",
          status: "ready",
          aiConfigured: Boolean(classificationService),
          documentProcessingConfigured: Boolean(documentService),
          oauthConfigured: Boolean(oauthService && gmailService),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/oauth/start") {
        if (!oauthService) {
          json(request, response, 503, { code: "OAUTH_NOT_CONFIGURED", message: "Google OAuth is not configured." });
          return;
        }
        const authorizationUrl = await oauthService.start();
        response.writeHead(302, { ...securityHeaders, Location: authorizationUrl });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/oauth/callback") {
        if (!oauthService) {
          json(request, response, 503, { code: "OAUTH_NOT_CONFIGURED", message: "Google OAuth is not configured." });
          return;
        }
        const result = await oauthService.callback({
          code: url.searchParams.get("code"),
          error: url.searchParams.get("error"),
          state: url.searchParams.get("state"),
        });
        html(response, 200, "VeriCargo Gmail connected", `${result.email} authorized Gmail access. Return to the extension to continue.`);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/connect/start") {
        json(request, response, 200, await oauthService.startExtension());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/connect/status") {
        const body = await readJson(request);
        json(request, response, 200, await oauthService.pollExtension(body.pollToken));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/connection") {
        const session = await oauthService.authenticate(request.headers.authorization);
        json(request, response, 200, await gmailService.status(session.connectionId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sync") {
        const session = await oauthService.authenticate(request.headers.authorization);
        json(request, response, 200, await gmailService.syncNextBatch(session.connectionId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/messages") {
        const session = await oauthService.authenticate(request.headers.authorization);
        json(request, response, 200, await gmailService.listMessages(session.connectionId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/labels/sync") {
        const session = await oauthService.authenticate(request.headers.authorization);
        json(request, response, 200, await gmailService.syncCategoryLabels(session.connectionId));
        return;
      }

      const attachmentRoute = url.pathname.match(/^\/api\/messages\/([^/]+)\/attachments\/([^/]+)$/);
      if (request.method === "GET" && attachmentRoute) {
        const session = await oauthService.authenticate(request.headers.authorization);
        json(
          request,
          response,
          200,
          await gmailService.getAttachment(
            session.connectionId,
            decodeURIComponent(attachmentRoute[1]),
            decodeURIComponent(attachmentRoute[2]),
          ),
        );
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/classification") {
        await oauthService.authenticate(request.headers.authorization);
        json(request, response, 200, {
          configured: Boolean(classificationService),
          model: classificationService?.model || null,
          pipelineVersion: classificationService?.pipelineVersion || null,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/classify") {
        const session = await oauthService.authenticate(request.headers.authorization);
        if (!classificationService) {
          json(request, response, 503, {
            code: "AI_NOT_CONFIGURED",
            message: "Google AI classification is not configured yet.",
          });
          return;
        }
        json(request, response, 200, await classificationService.classifyNextBatch(session.connectionId));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/documents/status") {
        await oauthService.authenticate(request.headers.authorization);
        json(request, response, 200, {
          configured: Boolean(documentService),
          processorVersion: documentService?.processorVersion || null,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/documents/process") {
        const session = await oauthService.authenticate(request.headers.authorization);
        if (!documentService) {
          json(request, response, 503, {
            code: "DOCUMENT_PROCESSING_NOT_CONFIGURED",
            message: "Document processing is not configured yet.",
          });
          return;
        }
        json(request, response, 200, await documentService.processNextBatch(session.connectionId));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/disconnect") {
        const session = await oauthService.authenticate(request.headers.authorization);
        await oauthService.disconnect(session);
        json(request, response, 200, { disconnected: true });
        return;
      }

      json(request, response, 404, { code: "NOT_FOUND", message: "Route not found." });
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
      const publicMessage = error?.publicMessage || (statusCode >= 500 ? "The service could not complete the request." : error.message);
      console.error(JSON.stringify({
        event: "request_failed",
        message: error instanceof Error ? error.message : String(error),
        path: url.pathname,
        statusCode,
      }));
      if (isApi) {
        json(request, response, statusCode, { code: "REQUEST_FAILED", message: publicMessage });
      } else {
        html(response, statusCode, "VeriCargo authorization failed", publicMessage);
      }
    }
  });
}
