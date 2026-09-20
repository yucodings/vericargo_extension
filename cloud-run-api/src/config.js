import fs from "node:fs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export function loadConfig() {
  const oauthConfigPath = required("GOOGLE_OAUTH_CONFIG_PATH");
  const oauthFile = JSON.parse(fs.readFileSync(oauthConfigPath, "utf8"));
  const web = oauthFile.web;

  if (!web?.client_id || !web?.client_secret) {
    throw new Error("The Google OAuth secret is not a Web application credential.");
  }

  const encryptionKey = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
  if (encryptionKey.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  const allowedEmails = new Set(
    required("ALLOWED_GMAIL_EMAILS")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const baseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");

  return {
    allowedEmails,
    baseUrl,
    clientId: web.client_id,
    clientSecret: web.client_secret,
    encryptionKey,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite",
    redirectUri: `${baseUrl}/oauth/callback`,
  };
}
