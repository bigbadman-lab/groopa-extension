# Groopa Extension

Groopa is a paid-only Chrome extension for monitoring Facebook groups.

## Setup

1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked** and select this folder (`groopa-extension`)

## What's included (Manifest V3)

- **manifest.json** — name, version, permissions, host_permissions, background worker, action popup, options page, content script
- **background.js** — service worker; logs install and startup
- **content.js** — runs on `https://*.facebook.com/*`; logs when loaded
- **popup.html / popup.js / popup.css** — popup with title, status card, next steps card, Open Settings button
- **options.html / options.js** — settings page with sound notification checkbox; saves `soundEnabled` to `chrome.storage.sync`