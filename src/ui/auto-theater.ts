export { AUTO_THEATER_STORAGE_KEY, DEFAULT_AUTO_THEATER as DEFAULT_AUTO_ENTER_THEATER, AUTO_SKIP_COUNTDOWN_KEY as AUTO_THEATER_SKIP_COUNTDOWN_STORAGE_KEY,
  resolveSkipCountdown as resolveAutoTheaterSkipCountdown, resolveAutoEnterTheater } from '../auto-theater-preferences';

export type AutoTheaterVisit = { identity: string | null; entered: boolean };

export function updateAutoTheaterVisit(visit: AutoTheaterVisit, identity: string | null): AutoTheaterVisit {
  return visit.identity === identity ? visit : { identity, entered: false };
}

export type AutoTheaterDecision = {
  enabled: boolean;
  topLevel: boolean;
  policyAllowed: boolean;
  providerEnabled: boolean;
  fullscreen: boolean;
  editableFocused: boolean;
  theaterActive: boolean;
  transitioning: boolean;
  mainVideo: boolean;
  eligibleVideo: boolean;
  playing: boolean;
};

export function shouldAutoEnterTheater(visit: AutoTheaterVisit, facts: AutoTheaterDecision): boolean {
  return visit.identity !== null && !visit.entered
    && facts.enabled && facts.topLevel && facts.policyAllowed && facts.providerEnabled
    && !facts.fullscreen && !facts.editableFocused && !facts.theaterActive && !facts.transitioning
    && facts.mainVideo && facts.eligibleVideo && facts.playing;
}
