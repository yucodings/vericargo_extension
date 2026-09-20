import { createApp } from "./app.js";
import { Firestore } from "@google-cloud/firestore";
import { loadConfig } from "./config.js";
import { createGmailService } from "./gmail-service.js";
import { createOAuthService } from "./oauth-service.js";
import { createClassificationService } from "./classification-service.js";
import { createDocumentService } from "./document-service.js";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
let oauthService = null;
let gmailService = null;
let classificationService = null;
let documentService = null;

try {
  const config = loadConfig();
  const firestore = new Firestore();
  oauthService = createOAuthService({ config, firestore });
  gmailService = createGmailService({ config, firestore });
  if (config.geminiApiKey) {
    classificationService = createClassificationService({
      attachmentLoader: (connectionId, messageId, attachmentId) =>
        gmailService.getAttachment(connectionId, messageId, attachmentId),
      attachmentMetadataLoader: (connectionId, messageId) =>
        gmailService.getAttachmentMetadata(connectionId, messageId),
      config,
      firestore,
    });
    documentService = createDocumentService({
      attachmentLoader: (connectionId, messageId, attachmentId) =>
        gmailService.getAttachment(connectionId, messageId, attachmentId),
      attachmentMetadataLoader: (connectionId, messageId) =>
        gmailService.getAttachmentMetadata(connectionId, messageId),
      config,
      firestore,
    });
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: "oauth_configuration_failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
}

const server = createApp({ classificationService, documentService, gmailService, oauthService });

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "server_started", port }));
});

const shutdown = (signal) => {
  console.log(JSON.stringify({ event: "server_stopping", signal }));
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
