/** Short enough that a digit ticking once a second stays sharp for most of that second. */
export const TIME_DIGIT_TRANSITION_MS = 180;

export type TimeShape = {
  hourDigits: number;
  minuteDigits: number;
};

export function timeShape(spanSeconds: number): TimeShape {
  const span = Number.isFinite(spanSeconds) && spanSeconds > 0 ? spanSeconds : 0;
  if (span >= 3600) {
    return {
      hourDigits: Math.max(1, String(Math.floor(span / 3600)).length),
      minuteDigits: 2
    };
  }
  const minutes = Math.floor(span / 60);
  const minuteDigits = span >= 600 ? 2 : Math.max(1, String(minutes).length);
  return { hourDigits: 0, minuteDigits };
}

export function formatClock(seconds: number, shape: TimeShape): string {
  const secs = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const sStr = String(s).padStart(2, '0');
  const mStr = String(m).padStart(shape.minuteDigits, '0');
  if (shape.hourDigits > 0) {
    return `${String(h).padStart(shape.hourDigits, '0')}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
}

/** Elapsed on the left, remaining or duration on the right. Both edges keep a stable width. */
export function clockLabels(current: number, end: number, showTotal: boolean): { elapsed: string; edge: string } {
  const safeEnd = Number.isFinite(end) && end > 0 ? end : 0;
  const safeCur = Number.isFinite(current) && current > 0 ? current : 0;
  const shape = timeShape(Math.max(safeEnd, safeCur));
  const elapsed = formatClock(safeCur, shape);
  const edge = showTotal
    ? ` ${formatClock(safeEnd, shape)}`
    : `-${formatClock(Math.max(0, safeEnd - safeCur), shape)}`;
  return { elapsed, edge };
}

type SlotKind = 'digit' | 'sep' | 'sign';

function slotKind(ch: string): SlotKind {
  if (ch === ':') return 'sep';
  if (ch >= '0' && ch <= '9') return 'digit';
  return 'sign';
}

function maskFor(value: string): string {
  return [...value].map((ch) => slotKind(ch)[0]).join('');
}

function makeGlyph(doc: Document, ch: string): HTMLSpanElement {
  const glyph = doc.createElement('span');
  glyph.className = 'theater-time-glyph';
  glyph.textContent = ch === ' ' ? '' : ch;
  return glyph;
}

function setSlotChar(slot: HTMLElement, next: string, animate: boolean): void {
  if (slot.dataset.ch === next && slot.childElementCount > 0) return;
  const doc = slot.ownerDocument;
  const view = doc.defaultView;
  const reduce = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const previous = slot.dataset.ch;
  if (!animate || reduce || previous === undefined) {
    slot.replaceChildren(makeGlyph(doc, next));
    slot.dataset.ch = next;
    return;
  }

  for (const glyph of [...slot.querySelectorAll('.theater-time-glyph')]) {
    if (glyph.classList.contains('is-leaving')) {
      glyph.remove();
      continue;
    }
    glyph.classList.remove('is-entering');
    glyph.classList.add('is-leaving');
    glyph.setAttribute('aria-hidden', 'true');
    const remove = () => glyph.remove();
    glyph.addEventListener('animationend', remove, { once: true });
    view?.setTimeout(remove, TIME_DIGIT_TRANSITION_MS + 80);
  }

  const incoming = makeGlyph(doc, next);
  incoming.classList.add('is-entering');
  slot.appendChild(incoming);
  slot.dataset.ch = next;
}

export function renderTimeReadout(host: HTMLElement, value: string, animate: boolean): void {
  const mask = maskFor(value);
  const doc = host.ownerDocument;
  host.dataset.mode = 'clock';
  if (host.dataset.mask !== mask) {
    host.dataset.mask = mask;
    host.replaceChildren();
    for (const ch of value) {
      const slot = doc.createElement('span');
      const kind = slotKind(ch);
      slot.className = `theater-time-slot${kind === 'digit' ? '' : ` is-${kind}`}`;
      host.appendChild(slot);
      setSlotChar(slot, ch, false);
    }
    return;
  }
  const slots = host.querySelectorAll<HTMLElement>('.theater-time-slot');
  for (let i = 0; i < value.length; i += 1) {
    const slot = slots[i];
    if (slot) setSlotChar(slot, value[i], animate);
  }
}

export function renderLiveBadge(host: HTMLElement, label: string): void {
  if (host.dataset.mode === 'badge' && host.dataset.badge === label) return;
  host.dataset.mode = 'badge';
  host.dataset.badge = label;
  host.dataset.mask = '';
  host.replaceChildren(label);
}
