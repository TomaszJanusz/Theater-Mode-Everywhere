# Privacy policy publishing

`PRIVACY.md` is the only place the policy is edited. The public copy at <https://theater.tomaszjanusz.dev/privacy-policy/> is rendered by the website repository, [`TomaszJanusz/tomaszjanusz.dev`](https://github.com/TomaszJanusz/tomaszjanusz.dev), from `packages/portfolio/content/legal/theater-everywhere-privacy-policy.md`. Do not edit that file by hand.

[`sync-privacy-policy.yml`](../.github/workflows/sync-privacy-policy.yml) runs when `PRIVACY.md` changes on `main` (or manually from `main`). It opens or updates one pull request in the website repository on the `automation/sync-theater-privacy-policy` branch. Merging that pull request deploys the page through Vercel, so the policy text is reviewed once more before it goes public. The workflow does nothing when the website already has the current text.

The Privacy Thing extension repository uses the same GitHub App but pushes directly to the website's default branch; this workflow opens a pull request instead.

## Setup

Reuse or create a GitHub App installed only on `TomaszJanusz/tomaszjanusz.dev` with repository permissions **Contents: read & write** and **Pull requests: read & write**, and nothing else. In this repository add to the `automation` environment:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `PUBLISH_APP_ID` | The App ID. |
| Secret | `PUBLISH_APP_PRIVATE_KEY` | A private key generated for the App. |

The workflow fails with an explicit error naming the missing variable or secret. The website repository must allow GitHub Actions/Apps to create pull requests and must not require checks the App cannot satisfy for its own branch.
