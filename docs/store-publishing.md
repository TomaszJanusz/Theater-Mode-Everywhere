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
