/** A reused XHR has one observer, reading the URL belonging to its latest open(). */
export function installXhrHarvest(
  prototype: XMLHttpRequest,
  harvest: (xhr: XMLHttpRequest, url: string) => void
): void {
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const requestUrls = new WeakMap<XMLHttpRequest, string>();
  const observed = new WeakSet<XMLHttpRequest>();
  prototype.open = function(this: XMLHttpRequest) {
    const result = originalOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest['open']>);
    requestUrls.set(this, String(arguments[1] || ''));
    return result;
  };
  prototype.send = function(this: XMLHttpRequest) {
    if (!observed.has(this)) {
      observed.add(this);
      this.addEventListener('loadend', function(this: XMLHttpRequest) {
        if (this.status < 200 || this.status >= 300) return;
        try {
          harvest(this, this.responseURL || requestUrls.get(this) || '');
        } catch {
          // Metadata parsing must never break the host's request completion.
        }
      });
    }
    return originalSend.apply(this, arguments as unknown as Parameters<XMLHttpRequest['send']>);
  };
}
