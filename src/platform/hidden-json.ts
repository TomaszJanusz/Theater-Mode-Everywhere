export function publishHiddenJson(id: string, payload: unknown | null): void {
  const existing = document.getElementById(id);
  if (payload == null) {
    existing?.remove();
    return;
  }
  const el = existing || document.createElement('div');
  el.id = id;
  el.setAttribute('hidden', '');
  el.textContent = JSON.stringify(payload);
  if (!existing) {
    (document.documentElement || document.head || document.body)?.appendChild(el);
  }
}
