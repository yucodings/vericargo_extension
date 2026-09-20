# VeriCargo Chrome Extension

This folder contains the Manifest V3 side-panel extension for the Cloud Run-backed VeriCargo Gmail workflow. It has one data path: a user authorizes Gmail through the VeriCargo Cloud Run service, Cloud Run imports Inbox messages, and the extension reads the imported records through an authenticated session.

No sample inbox, mock cases, direct Gmail API token handling, or Demo mode is included.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Choose this `chrome-extension` folder.
5. Pin the extension and open its side panel.
6. Select **Connect Gmail** and complete Google authorization in the tab that opens.
7. Return to the side panel. It imports the Inbox through Cloud Run in resumable batches.

## Architecture

- `manifest.json` permits access only to the VeriCargo Cloud Run origin.
- `cloud-client.js` manages the Cloud Run connection attempt, extension session, synchronization, and message requests.
- `sidepanel.js` renders Cloud Run-backed Inbox messages and connection state.
- `service-worker.js` opens the side panel when the toolbar action is selected.

Google OAuth credentials and Gmail refresh tokens are not stored in this extension. The OAuth client secret is mounted into Cloud Run from Secret Manager, and refresh tokens are encrypted before Firestore storage.

## Development

After editing extension files, return to `chrome://extensions` and select **Reload** on the extension card.
