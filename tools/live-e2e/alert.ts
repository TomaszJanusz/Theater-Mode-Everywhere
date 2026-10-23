/** The rolling-issue state machine: one issue per failing page type, closed after enough green nights. */
export const GREEN_NIGHTS_TO_CLOSE = 3;
export const ISSUE_LABEL = 'live-e2e';

export interface ExistingIssue { number: number; state: 'OPEN' | 'CLOSED'; body: string }

export type Action =
  | { type: 'create'; title: string; body: string }
  | { type: 'reopen'; number: number }
  | { type: 'update'; number: number; body: string }
  | { type: 'comment'; number: number; body: string }
  | { type: 'close'; number: number };

export const issueTitle = (pageType: string): string => `Live E2E: ${pageType}`;
const MARKER = /<!-- live-e2e-green: (\d+) -->/;
const withGreen = (body: string, n: number): string =>
  MARKER.test(body) ? body.replace(MARKER, `<!-- live-e2e-green: ${n} -->`) : `${body}\n\n<!-- live-e2e-green: ${n} -->`;
const greenNights = (issue: ExistingIssue): number => Number(MARKER.exec(issue.body)?.[1] ?? 0);

/**
 * What to do for one page type after a night. Skipped nights change nothing: an environment
 * block is neither evidence of a fix nor of a regression.
 */
export interface Night { pageType: string; status: 'passed' | 'failed' | 'skipped'; runUrl: string; detail: string }

export function decide({ pageType, status, runUrl, detail }: Night, issue: ExistingIssue | undefined): Action[] {
  if (status === 'skipped') return [];
  if (status === 'failed') {
    const note = `Failed in ${runUrl}\n\n${detail}`;
    if (!issue) return [{ type: 'create', title: issueTitle(pageType), body: withGreen(`The extension's live contract checks failed for page type \`${pageType}\`.\n\n${note}`, 0) }];
    return [
      ...(issue.state === 'CLOSED' ? [{ type: 'reopen', number: issue.number } as const] : []),
      { type: 'update', number: issue.number, body: withGreen(issue.body, 0) },
      { type: 'comment', number: issue.number, body: note }
    ];
  }
  if (!issue || issue.state === 'CLOSED') return [];
  const green = greenNights(issue) + 1;
  if (green >= GREEN_NIGHTS_TO_CLOSE) {
    return [{ type: 'comment', number: issue.number, body: `Green for ${green} nights (${runUrl}). Closing.` }, { type: 'close', number: issue.number }];
  }
  return [{ type: 'update', number: issue.number, body: withGreen(issue.body, green) }, { type: 'comment', number: issue.number, body: `Green night ${green}/${GREEN_NIGHTS_TO_CLOSE} (${runUrl}).` }];
}
