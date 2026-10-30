import { parseRequestRecord, requestString } from '../../protocol/page-requests';

/** Isolated -> MAIN: switch Twitch's own closed captions; MAIN answers on the ack event. */
export const TWITCH_CC_EVENT = 'theater-everywhere-twitch-captions';
export const TWITCH_CC_ACK_EVENT = 'theater-everywhere-twitch-captions-ack';

export type TwitchCaptionsRequest = { enabled: boolean; requestId: string };

/** The detail crosses worlds as a JSON string, as every page request does (see `protocol/page-requests.ts`). */
export function encodeTwitchCaptions(request: TwitchCaptionsRequest): string {
  return JSON.stringify(request);
}

export function parseTwitchCaptions(raw: unknown): TwitchCaptionsRequest | null {
  const record = parseRequestRecord(raw);
  const requestId = record && requestString(record.requestId);
  if (!record || !requestId || typeof record.enabled !== 'boolean') return null;
  return { enabled: record.enabled, requestId };
}
