/**
 * What 2.0.8 left in storage when it ran `onInstalled` on an untouched profile. Recorded by bundling the v2.0.8
 * `src/entries/background.ts` and firing the event against empty in-memory storage (timestamps kept as recorded),
 * not written by hand: the keys are exactly what that build stores.
 */
export const RECORDED_208 = {
  /** Reason `install`: a store install of 2.0.8, with nothing changed since. */
  install: {
    local: {
      'migration:bound-whats-new-auto-open:v1': true,
      newFeaturesWindow: { generation: '2.0', firstShownAt: 1793541846470 },
      newFeaturesSeenItems: [],
      newFeaturesSeenThrough: '2.0'
    },
    sync: {
      shortcuts: { toggle: 'T', exit: 'Escape', seekBack: 'ArrowLeft', seekForward: 'ArrowRight' },
      blacklist: []
    }
  },
  /** Reason `update` from 2.0.7: the profile an older install carries into 2.0.8. */
  update: {
    local: {
      'migration:bound-whats-new-auto-open:v1': true,
      newFeaturesWindow: { generation: '2.0', firstShownAt: 1793541846472 },
      newFeaturesSeenItems: [],
      whatsNewAutoOpened: { releaseId: '2.0', version: '2.0.8' },
      'migration:remove-legacy-youtube-exclusion:v1': true
    },
    /** An update writes no defaults: a profile that predates the sync defaults has nothing in sync. */
    sync: {}
  }
} as const;
