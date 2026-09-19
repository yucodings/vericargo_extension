# BLiNK Chrome Extension

This folder is a real Chrome Manifest V3 side-panel extension. It is designed for local, unpacked development and does not need to be published in the Chrome Web Store.

## Load it in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose this exact folder: `C:\Users\Asus\Desktop\Averis\blink-app\chrome-extension`.
5. Pin **BLiNK Gmail Shipping Assistant** from Chrome's Extensions menu.
6. Open Gmail, then click the BLiNK toolbar icon. The assistant opens in Chrome's side panel.

## Develop locally

Edit `sidepanel.html`, `sidepanel.css`, or `sidepanel.js`. After saving changes, return to `chrome://extensions` and press the Reload button on the BLiNK extension card.

The extension stores UI state locally with `chrome.storage.local`. Gmail data is accessed only after you configure OAuth, choose Working mode, and explicitly select **Connect Gmail**.

## Modes

- **Demo mode** uses the built-in sample inbox and never connects to Google.
- **Working mode** uses `chrome.identity` and the Gmail REST API with the read-only Gmail scope. It loads recent shipping-related messages, headers, body previews, and attachment filenames.

Working mode does not claim that real attachments were verified. Document-comparison messages are routed to Human Review until attachment download and document processing are connected.

## Configure real Gmail access

You do not need to publish the extension. Complete these steps once:

1. Load the unpacked extension, then open `chrome://extensions` and copy the extension's 32-character **ID**.
2. Create or select a project in [Google Cloud Console](https://console.cloud.google.com/).
3. Enable the **Gmail API** for that project.
4. Configure **Google Auth Platform** branding and audience. For local testing with an External audience, add your Gmail account as a test user.
5. Under **Google Auth Platform → Clients**, create an OAuth client with application type **Chrome Extension**.
6. Paste the unpacked extension ID into Google's **Item ID** field.
7. Copy the generated OAuth client ID.
8. Open `manifest.json` and replace:

   ```json
   "client_id": "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
   ```

   with the exact client ID from Google. Do not add a client secret; Chrome extensions use `chrome.identity`.
9. Return to `chrome://extensions`, reload BLiNK, open its side panel, choose **Working mode**, and select **Connect Gmail**.

The relevant implementation is split between:

- `manifest.json` — `identity` permission, Gmail host permission, OAuth client ID, and `gmail.readonly` scope.
- `gmail-client.js` — Chrome OAuth token handling and Gmail API requests.
- `sidepanel.js` — Demo/Working mode state, connection controls, and real-message rendering.

## Before production document verification

To analyze real SI and Draft BL files, extend `gmail-client.js` to retain each MIME part's `attachmentId`, request `users.messages.attachments.get`, and send the decoded file to a trusted document-processing backend. Keep OCR/model API secrets on that backend—never put secrets in extension JavaScript or `manifest.json`.
