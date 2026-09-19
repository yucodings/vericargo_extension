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

The current extension uses local demo cases and `chrome.storage.local`; it does not read or transmit Gmail account data. Gmail API/OAuth integration should be added only when production credentials and scopes are available.
