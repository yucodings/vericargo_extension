import { encryptSecret, randomToken, sha256 } from "./crypto-utils.js";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const FULL_MAILBOX_SCOPE = "https://mail.google.com/";
const OAUTH_SCOPES = [FULL_MAILBOX_SCOPE];
const STATE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class OAuthError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const googleJsonRequest = async (url, options, failureMessage) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new OAuthError(body.error_description || body.error?.message || failureMessage, 502);
  }
  return body;
};

export function createOAuthService({ config, firestore, now = () => Date.now() }) {
  const states = firestore.collection("oauth_states");
  const attempts = firestore.collection("connection_attempts");
  const connections = firestore.collection("gmail_connections");
  const sessions = firestore.collection("extension_sessions");

  async function start({ attemptId = null } = {}) {
    const state = randomToken();
    await states.doc(sha256(state)).create({
      attemptId,
      createdAt: new Date(now()),
      expiresAt: new Date(now() + STATE_TTL_MS),
    });

    const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    authorizationUrl.search = new URLSearchParams({
      access_type: "offline",
      client_id: config.clientId,
      include_granted_scopes: "true",
      prompt: "consent",
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: OAUTH_SCOPES.join(" "),
      state,
    });
    return authorizationUrl.toString();
  }

  return {
    start,

    async startExtension() {
      const pollToken = randomToken();
      const attemptId = sha256(pollToken);
      await attempts.doc(attemptId).create({
        createdAt: new Date(now()),
        expiresAt: new Date(now() + STATE_TTL_MS),
        status: "PENDING",
      });
      return { authorizationUrl: await start({ attemptId }), pollToken };
    },

    async pollExtension(pollToken) {
      if (!pollToken) throw new OAuthError("Missing connection polling token.");
      const reference = attempts.doc(sha256(pollToken));
      const snapshot = await reference.get();
      if (!snapshot.exists) throw new OAuthError("Connection attempt was not found.", 404);
      const attempt = snapshot.data();
      if (attempt.expiresAt.toDate().getTime() < now()) {
        throw new OAuthError("Connection attempt expired. Start again.", 410);
      }
      if (attempt.status === "PENDING") return { status: "PENDING" };
      if (attempt.status === "FAILED") {
        throw new OAuthError(attempt.error || "Google authorization failed. Start again.", 403);
      }
      if (attempt.status !== "AUTHORIZED" || !attempt.connectionId) {
        throw new OAuthError("Connection attempt cannot be completed.", 409);
      }
      if (attempt.claimedAt) throw new OAuthError("Connection attempt was already completed.", 410);

      const sessionToken = randomToken();
      await sessions.doc(sha256(sessionToken)).create({
        connectionId: attempt.connectionId,
        createdAt: new Date(now()),
        expiresAt: new Date(now() + SESSION_TTL_MS),
      });
      await reference.update({ claimedAt: new Date(now()), status: "CLAIMED" });
      return { email: attempt.email, sessionToken, status: "CONNECTED" };
    },

    async authenticate(authorizationHeader) {
      const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader || "");
      if (!match) throw new OAuthError("Authentication is required.", 401);
      const reference = sessions.doc(sha256(match[1]));
      const snapshot = await reference.get();
      if (!snapshot.exists) throw new OAuthError("Session is invalid.", 401);
      const session = snapshot.data();
      if (session.expiresAt.toDate().getTime() < now()) {
        await reference.delete().catch(() => undefined);
        throw new OAuthError("Session expired. Connect Gmail again.", 401);
      }
      return { ...session, sessionReference: reference };
    },

    async disconnect(session) {
      await session.sessionReference.delete();
    },

    async callback({ code, error, state }) {
      if (error) throw new OAuthError(`Google authorization was not completed: ${error}`);
      if (!code || !state) throw new OAuthError("The OAuth response is missing its code or state.");

      const stateReference = states.doc(sha256(state));
      const stateSnapshot = await stateReference.get();
      await stateReference.delete().catch(() => undefined);
      if (!stateSnapshot.exists) throw new OAuthError("The authorization request is invalid or already used.");
      const stateData = stateSnapshot.data();
      if (stateData.expiresAt.toDate().getTime() < now()) {
        throw new OAuthError("The authorization request expired. Start again from the extension.");
      }

      const tokens = await googleJsonRequest(
        GOOGLE_TOKEN_ENDPOINT,
        {
          body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: config.redirectUri,
          }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        },
        "Google did not exchange the authorization code.",
      );
      if (!tokens.access_token || !tokens.refresh_token) {
        if (stateData.attemptId) {
          await attempts.doc(stateData.attemptId).update({
            error: "Google did not return offline Gmail authorization.",
            status: "FAILED",
          });
        }
        throw new OAuthError("Google did not return the required offline refresh token.", 502);
      }

      const grantedScopes = String(tokens.scope || "").split(" ").filter(Boolean);
      if (!grantedScopes.includes(FULL_MAILBOX_SCOPE)) {
        const message = "Full Gmail permission was not granted. Connect again and approve Gmail access.";
        if (stateData.attemptId) {
          await attempts.doc(stateData.attemptId).update({ error: message, status: "FAILED" });
        }
        throw new OAuthError(message, 403);
      }

      const profile = await googleJsonRequest(
        GMAIL_PROFILE_ENDPOINT,
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        "Gmail did not return the authorized profile.",
      );
      const email = String(profile.emailAddress || "").trim().toLowerCase();
      if (!config.allowedEmails.has("*") && !config.allowedEmails.has(email)) {
        throw new OAuthError("This Google account is not approved for VeriCargo.", 403);
      }

      const connectionId = sha256(email);
      await connections.doc(connectionId).set(
        {
          email,
          encryptedRefreshToken: encryptSecret(tokens.refresh_token, config.encryptionKey),
          gmailHistoryId: profile.historyId || null,
          scopes: grantedScopes,
          status: "CONNECTED",
          syncPageToken: null,
          updatedAt: new Date(now()),
        },
        { merge: true },
      );
      if (stateData.attemptId) {
        await attempts.doc(stateData.attemptId).update({
          connectionId,
          email,
          status: "AUTHORIZED",
        });
      }
      return { email };
    },
  };
}
