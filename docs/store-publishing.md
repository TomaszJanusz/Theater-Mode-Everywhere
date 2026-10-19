# Store publishing

The release workflow can publish the same release packages to AMO, Chrome Web Store, and Microsoft Edge Add-ons after it creates the GitHub Release.

Publishing is opt-in per store through repository variables. Keep a store disabled until the first manual listing exists and the matching credentials are configured.

## Repository variables

| Name | Purpose |
| --- | --- |
| `AMO_PUBLISH_ENABLED` | Set to `true` to submit `dist/theater-everywhere-firefox.zip` to Mozilla Add-ons. |
| `CWS_PUBLISH_ENABLED` | Set to `true` to upload and publish `dist/theater-everywhere-chrome.zip` to Chrome Web Store. |
| `CWS_EXTENSION_ID` | Chrome Web Store extension ID. |
| `CWS_PUBLISHER_ID` | Chrome Web Store publisher ID from the Developer Dashboard. |
| `EDGE_PUBLISH_ENABLED` | Set to `true` to upload and publish `dist/theater-everywhere-chrome.zip` to Microsoft Edge Add-ons. |
| `EDGE_PRODUCT_ID` | Microsoft Edge Add-ons product ID from Partner Center. |
| `EDGE_CLIENT_ID` | Microsoft Edge Add-ons Publish API client ID. |

## Repository secrets

| Name | Purpose |
| --- | --- |
| `AMO_JWT_ISSUER` | Mozilla Add-ons JWT issuer key used by `web-ext sign --api-key`. |
| `AMO_JWT_SECRET` | Mozilla Add-ons JWT secret used by `web-ext sign --api-secret`. |
| `CWS_CLIENT_ID` | Google OAuth client ID with Chrome Web Store API access. |
| `CWS_CLIENT_SECRET` | Google OAuth client secret. |
| `CWS_REFRESH_TOKEN` | Google OAuth refresh token with `https://www.googleapis.com/auth/chromewebstore` scope. |
| `EDGE_API_KEY` | Microsoft Edge Add-ons Publish API key. |

## Optional variables

| Name | Default | Purpose |
| --- | --- | --- |
| `CWS_POLL_ATTEMPTS` | `30` | Number of Chrome Web Store upload status checks before failing. |
| `CWS_POLL_INTERVAL_SECONDS` | `10` | Delay between Chrome Web Store upload status checks. |
| `EDGE_POLL_ATTEMPTS` | `30` | Number of Edge upload/publish status checks before failing. |
| `EDGE_POLL_INTERVAL_SECONDS` | `10` | Delay between Edge upload/publish status checks. |

## Notes

- AMO publishing uses `web-ext sign --channel=listed` against `dist/firefox-unpacked` and uploads a source archive generated from `HEAD`. That archive includes [building.md](building.md), which is the reproduction path for the minified packages.
- Chrome Web Store publishing uses the official v2 API: refresh OAuth token, upload package, then publish the item for review.
- Microsoft Edge Add-ons publishing uses the v1.1 API: upload package, poll upload status, publish draft submission, then poll publish status.
- Chrome and Edge listing metadata still has to be maintained manually in their dashboards; their package update APIs do not update store descriptions.

## Listing copy

- `store-listings/chrome/<locale>.txt` holds only the long description for the Chrome Web Store and Edge (16,000-character limit). English is the source; keep other languages factually aligned with it. The Chrome Web Store has no keywords field, so none are stored.
- The name and short description are the `extensionName` and `extensionDescription` messages in `_locales/<locale>/messages.json`, which also feed the manifest `name` and `description`. They are the single source of truth for the store dashboards; limits are 75 characters for the name and 132 for the short description, enforced by `scripts/store-listings.test.ts`. Run `pnpm store:chrome:print -- <locale>` (or `-- --all`) to print the Name, Short description and Long description blocks with character counts, ready to paste into the dashboard.
- `extensionName` is the manifest name used by Chrome and Edge. Every language appends its translation of the slogan “One player to rule them all.” in the form `Theater Mode Everywhere — <slogan>` (36–65 characters). The sibling extension Privacy Thing ships Chromium names of 51–58 characters through the same manifest name to both Chrome and Edge without problems, so Edge has been observed accepting longer names; still confirm the name in Edge Partner Center before publishing. Firefox packages use `extensionNameCompact` instead (see `scripts/build.ts`), because AMO limits names to 50 characters; the AMO listing name is that compact name.
- Each language's description names exactly four supported services and no others, with YouTube in every pack. The Chrome Web Store rejects descriptions that list too many brand names as keyword spam, so each pack is chosen for regional relevance and every one of its four services appears with its real capability in the Rich Theater Experience paragraph. The full list of supported services stays in the extension's settings. The packs live in `SERVICE_PACKS` in `scripts/store-listings.test.ts`, which checks the Chrome text; the AMO description equals it. To change a pack, edit the locale's Chrome and AMO files together with that table, and keep other service names out of generic sentences.
- `store-listings/amo/<locale>.md` keeps the single-file format read by `scripts/update-amo-listings.ts`; its summary must match `extensionDescription` and its description the flat Chrome long description.
