import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { ISSUE_LABEL, decide, issueTitle, type Action, type ExistingIssue } from './alert';

// Usage: tsx tools/live-e2e/alert-cli.ts <results.json>   (needs gh, GH_TOKEN, RUN_URL)
const results = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { pageTypes: Array<{ pageType: string; status: 'passed' | 'failed' | 'skipped'; results: Array<{ capability: string; status: string; detail?: string }> }> };
const runUrl = process.env.RUN_URL ?? '(unknown run)';

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
for (const { pageType, status, results: specs } of results.pageTypes) {
  const detail = specs.filter(s => s.status === 'failed').map(s => `- ${s.capability}: ${s.detail ?? 'failed'}`).join('\n');
  for (const action of decide({ pageType, status, runUrl, detail }, find(pageType))) apply(action);
}
