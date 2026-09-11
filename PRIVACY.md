# Privacy Policy — Theater Mode Everywhere

**Last updated: 2026-09-11**

## Summary

Theater Mode Everywhere does not collect, transmit, or share any personal data. All extension data remains on your device.

## Data Collection

This extension collects **no personal data**. We do not:

- Track browsing history or visited URLs
- Collect analytics or usage statistics
- Transmit any data to the extension developer
- Use cookies or fingerprinting techniques

Theater mode may request caption files or timeline preview images **directly from the site you are already watching** (for example YouTube caption tracks or storyboard sprites already referenced by the player). Those requests stay between your browser and that provider. Captions and preview images are kept only in memory for the current playback session and are never stored, synced, or sent to us.

## Data Stored Locally

The extension stores the following data **exclusively on your device** using Chrome's `chrome.storage.sync` API:

- **Keyboard shortcuts** — your configured key bindings (e.g. which key activates theater mode)
- **Domain blocklist** — domains where you have disabled the extension
- **Caption appearance** — subtitle text, size, shadow, and background choices
- **Caption language by site** — whether subtitles are on and which language code (for example `en` or `pl`) to use on that site. This is not a watch history and does not store video titles.

This data is synced across your Chrome/Firefox profile devices via your browser account (if signed in) but is never sent to the extension developer or any third party.

## Permissions

| Permission | Reason |
|---|---|
| `storage` | Save your keyboard shortcut, domain blocklist, and caption preferences |
| `tabs` | Read the current tab's URL in the popup to show/update per-domain toggle status |
| `<all_urls>` (host permission) | Inject the content script into pages to detect and enhance video players |
| `theme` (Firefox only) | Read the browser theme colors to match the extension UI to your Firefox theme |

## Contact

If you have questions about this privacy policy, contact: tomasz.janusz@gmail.com
