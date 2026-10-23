/** Capabilities with a spec in `specs.ts`; a target lists the ones its page type supports. */
export const CAPABILITIES = ['theater', 'active-video'] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** One private-config entry: an opaque page-type id (it names issues) and a public URL. */
export interface Target {
  pageType: string;
  url: string;
  capabilities: Capability[];
  videoSelector: string;
}

/** `skipped` means the environment, not the extension, blocked the check. */
export type Status = 'passed' | 'failed' | 'skipped';

export interface SpecResult {
  pageType: string;
  capability: Capability;
  status: Status;
  detail?: string;
}

export interface QuarantineEntry {
  pageType: string;
  owner: string;
  /** `YYYY-MM-DD`; an expired entry fails the run instead of hiding the page type forever. */
  expires: string;
  reason: string;
}

/** Reserved issue id for the lane itself (build or run produced nothing), as opposed to a page type. */
export const LANE_ID = 'lane';
