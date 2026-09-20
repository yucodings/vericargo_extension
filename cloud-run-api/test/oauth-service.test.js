import assert from "node:assert/strict";
import test from "node:test";

import { createOAuthService } from "../src/oauth-service.js";

test("authorization requests only the configured full-mailbox scope", async () => {
  const firestore = {
    collection: () => ({
      doc: () => ({
        create: async () => undefined,
      }),
    }),
  };
  const service = createOAuthService({
    config: {
      clientId: "client-id",
      redirectUri: "https://example.test/oauth/callback",
    },
    firestore,
  });

  const authorizationUrl = new URL(await service.start());
  assert.equal(authorizationUrl.searchParams.get("scope"), "https://mail.google.com/");
  assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    "https://example.test/oauth/callback",
  );
});
