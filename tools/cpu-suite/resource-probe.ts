/** Installed before the bundles, after Playwright's clock. No strong DOM registry:
 * retaining observer targets here would manufacture the leak we want to inspect. */
export const RESOURCE_PROBE = String.raw`(() => {
  const totals = Object.create(null), timers = new Map(), observing = new WeakSet(), idleWaiters = [];
  let activeObservers = 0, pendingReads = 0;
  const add = (key, n = 1) => { totals[key] = (totals[key] || 0) + n; };
  const wrap = (owner, name, key) => {
    const original = owner[name];
    owner[name] = function(...args) { add(key); return Reflect.apply(original, this, args); };
  };
  for (const prototype of [Document.prototype, Element.prototype, DocumentFragment.prototype]) {
    for (const method of ['querySelector', 'querySelectorAll']) {
      const original = prototype[method];
      prototype[method] = function(...args) {
        add(method);
        if (args[0] === 'video') { add('videoQueries'); if (this === document.body || this === document.documentElement) add('bodyHtmlVideoQueries'); }
        return Reflect.apply(original, this, args);
      };
    }
  }
  wrap(Element.prototype, 'getBoundingClientRect', 'rect');
  wrap(window, 'getComputedStyle', 'computedStyle');
  const OriginalObserver = MutationObserver;
  window.MutationObserver = class extends OriginalObserver {
    constructor(callback) { super((records, observer) => { add('observerCallbacks'); add('mutationRecords', records.length); callback(records, observer); }); }
    observe(...args) { super.observe(...args); if (!observing.has(this)) { observing.add(this); activeObservers++; } }
    disconnect() { super.disconnect(); if (observing.delete(this)) activeObservers--; }
  };
  for (const [create, clear, repeated] of [['setTimeout', 'clearTimeout', false], ['setInterval', 'clearInterval', true], ['requestAnimationFrame', 'cancelAnimationFrame', false]]) {
    const schedule = window[create], cancel = window[clear];
    window[create] = function(callback, ...args) {
      let id;
      const invoke = (...values) => {
        if (!repeated) timers.delete((create === 'requestAnimationFrame' ? 'raf/' : 'timer/') + id);
        add(create + 'Callbacks');
        if (typeof callback === 'function') return callback(...values);
        return (0, eval)(String(callback));
      };
      id = Reflect.apply(schedule, window, [invoke, ...args]);
      timers.set((create === 'requestAnimationFrame' ? 'raf/' : 'timer/') + id, create); add(create); return id;
    };
    window[clear] = function(id) { timers.delete((clear === 'cancelAnimationFrame' ? 'raf/' : 'timer/') + id); return Reflect.apply(cancel, window, [id]); };
  }
  wrap(Response.prototype, 'clone', 'responseClone');
  for (const name of ['arrayBuffer', 'text', 'json']) {
    const original = Response.prototype[name];
    Response.prototype[name] = function(...args) {
      add('response' + name); pendingReads++;
      return Reflect.apply(original, this, args).then(value => {
        if (name === 'arrayBuffer') add('bodyBytes', value.byteLength);
        if (name === 'text') add('bodyCharacters', value.length);
        return value;
      }).finally(() => { pendingReads--; if (!pendingReads) for (const resolve of idleWaiters.splice(0)) resolve(); });
    };
  }
  wrap(JSON, 'stringify', 'stringify');
  const decode = TextDecoder.prototype.decode;
  TextDecoder.prototype.decode = function(input, ...args) {
    add('decode'); add('decodedBytes', input?.byteLength || 0);
    return Reflect.apply(decode, this, [input, ...args]);
  };
  window.__resourceProbe = {
    idle() { return pendingReads ? new Promise(resolve => idleWaiters.push(resolve)) : Promise.resolve(); },
    snapshot() {
      const active = { observers: activeObservers, timeouts: 0, intervals: 0, raf: 0, pendingReads };
      for (const kind of timers.values()) active[kind === 'setTimeout' ? 'timeouts' : kind === 'setInterval' ? 'intervals' : 'raf']++;
      return { totals: { ...totals }, active };
    }
  };
})();`;
export type Counters = { totals: Record<string, number>; active: { observers: number; timeouts: number; intervals: number; raf: number; pendingReads: number } };
export function counterDelta(before: Counters, after: Counters): Record<string, number> {
  return Object.fromEntries([...new Set([...Object.keys(before.totals), ...Object.keys(after.totals)])]
    .map(key => [key, (after.totals[key] ?? 0) - (before.totals[key] ?? 0)]));
}
export function validateCounters(value: unknown): asserts value is Counters {
  if (!value || typeof value !== 'object' || !('totals' in value) || !('active' in value)) throw new Error('Missing counters');
  for (const group of [value.totals, value.active]) {
    if (!group || typeof group !== 'object' || Array.isArray(group)
      || Object.values(group).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw new Error('Invalid counter');
  }
  if (!value.active || typeof value.active !== 'object') throw new Error('Missing active counters');
  for (const key of ['observers', 'timeouts', 'intervals', 'raf', 'pendingReads']) {
    if (!(key in value.active)) throw new Error(`Missing active counter: ${key}`);
  }
}
