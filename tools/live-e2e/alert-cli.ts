import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { ISSUE_LABEL, decide, failureDetail, issueTitle, type Action, type ExistingIssue, type Night } from './alert';
import { LANE_ID } from './model';

// Usage: tsx tools/live-e2e/alert-cli.ts <results.json>   (needs gh, GH_TOKEN, RUN_URL; BUILD_RESULT is the build job's result)
type PageTypeResult = { pageType: string; status: Night['status']; results: Array<{ capability: string; status: string; detail?: string }> };
const resultsPath = process.argv[2];
const results = existsSync(resultsPath) ? (JSON.parse(readFileSync(resultsPath, 'utf8')) as { pageTypes: PageTypeResult[] }) : undefined;
const runUrl = process.env.RUN_URL ?? '(unknown run)';

// The lane's own health is a page type too: a failed build, or a live job that wrote no results,
// would otherwise leave the nightly silently dark.
let laneBroken: string | undefined;
if (process.env.BUILD_RESULT !== 'success') laneBroken = 'the build job did not succeed';
else if (!results) laneBroken = 'the live job wrote no results';
const nights: Night[] = [
  { pageType: LANE_ID, status: laneBroken ? 'failed' : 'passed', runUrl, detail: laneBroken ? `- ${laneBroken}` : '' },
  ...(results?.pageTypes ?? []).map(({ pageType, status, results: specs }) => ({ pageType, status, runUrl, detail: failureDetail(specs) }))
];

// gh is preinstalled at this path on GitHub-hosted runners; GH_PATH overrides it elsewhere.
const GH = process.env.GH_PATH ?? '/usr/bin/gh';
const gh = (...args: string[]): string => execFileSync(GH, args, { encoding: 'utf8' });

function find(pageType: string): ExistingIssue | undefined {
  const rows = JSON.parse(gh('issue', 'list', '--label', ISSUE_LABEL, '--state', 'all', '--limit', '200', '--json', 'number,state,title,body')) as Array<ExistingIssue & { title: string }>;
  return rows.find(row => row.title === issueTitle(pageType));
}

function apply(action: Action): void {
  switch (action.type) {
    case 'create': gh('issue', 'create', '--title', action.title, '--body', action.body, '--label', ISSUE_LABEL); break;
    case 'reopen': gh('issue', 'reopen', String(action.number)); break;
    case 'update': gh('issue', 'edit', String(action.number), '--body', action.body); break;
    case 'comment': gh('issue', 'comment', String(action.number), '--body', action.body); break;
    case 'close': gh('issue', 'close', String(action.number)); break;
  }
}

gh('label', 'create', ISSUE_LABEL, '--description', 'Nightly live E2E lane', '--force');
for (const night of nights) for (const action of decide(night, find(night.pageType))) apply(action);
