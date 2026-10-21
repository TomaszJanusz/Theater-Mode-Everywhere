/**
 * A changed digit rolls through its slot and is sharp for most of the second.
 * Glyphs keep the clock color at full opacity; a mask on the slot window does
 * the fading, so the ink never dims or flashes brighter.
 */
import { isMotionReduced } from '../appearance-runtime';

import type { UiClock } from './ui-clock';

export const TIME_DIGIT_TRANSITION_MS = 320;
/** Each changing digit starts this much after the one to its left. */
export const TIME_DIGIT_STAGGER_MS = 30;
/** Ranks beyond this share one delay, so a wide change stays inside the tick. */
const TIME_DIGIT_STAGGER_RANKS = 3;

export type DigitRoll = { delayMs: number; countsDown: boolean };

/**
 * Which slots roll between two readouts of the same shape, and how. Direction
 * is one per readout, from comparing the strings like the times they show, so
 * a carry (59 -> 00, 9 -> 0) rolls every digit the way the clock moves instead
 * of flipping the carried digit against its neighbours. The leftmost changing
 * digit starts first; each one to its right starts a stagger later.
 */
export function planDigitRolls(previous: string, next: string): Array<DigitRoll | null> {
  const countsDown = next < previous;
  let rank = 0;
  return [...next].map((ch, i) => {
    if (previous[i] === ch) return null;
    const delayMs = slotKind(ch) === 'digit' ? Math.min(rank++, TIME_DIGIT_STAGGER_RANKS) * TIME_DIGIT_STAGGER_MS : 0;
    return { delayMs, countsDown };
  });
}

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

const settleTimers = new WeakMap<HTMLElement, { id: number; clock: UiClock }>();

/** Separators never change, so they stay a plain glyph that sizes their slot. */
function slotWindow(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>(':scope > .theater-time-roll');
}

interface SlotUpdate { animate: boolean; roll: DigitRoll | null; clock?: UiClock }

function setSlotChar(slot: HTMLElement, next: string, { animate, roll, clock }: SlotUpdate): void {
  // Explicitly settling a readout must also finish an in-flight roll of the same value.
  if (slot.dataset.ch === next && slot.childElementCount > 0 && (animate || !slot.classList.contains('is-rolling'))) return;
  const doc = slot.ownerDocument;
  const view = doc.defaultView;
  const reduce = isMotionReduced(doc);
  const previous = slot.dataset.ch;
  slot.dataset.ch = next;
  const pending = settleTimers.get(slot);
  if (pending) {
    pending.clock.clearTimeout(pending.id);
    settleTimers.delete(slot);
  }
  const rollWindow = slotWindow(slot);
  const current = rollWindow?.querySelector<HTMLElement>(':scope > .theater-time-glyph:not(.is-leaving)');
  const interrupting = slot.classList.contains('is-rolling');
  if (!animate || reduce || previous === undefined || !rollWindow || !current || !roll) {
    (rollWindow ?? slot).replaceChildren(makeGlyph(doc, next));
    slot.classList.remove('is-rolling');
    slot.style.removeProperty('--theater-time-roll-delay');
    return;
  }

  for (const stale of rollWindow.querySelectorAll(':scope > .is-leaving')) stale.remove();
  current.classList.remove('is-entering');
  current.classList.add('is-leaving');
  const entering = makeGlyph(doc, next);
  entering.classList.add('is-entering');
  rollWindow.append(entering);
  slot.classList.toggle('is-counting-down', roll.countsDown);
  // A tick landing on a roll in flight answers at once; waiting out a stagger
  // would leave the old digit on screen while newer values pile up.
  const delayMs = interrupting ? 0 : roll.delayMs;
  slot.style.setProperty('--theater-time-roll-delay', `${delayMs}ms`);
  slot.classList.add('is-rolling');
  const settle = () => {
    settleTimers.delete(slot);
    current.remove();
    entering.classList.remove('is-entering');
    slot.classList.remove('is-rolling');
    slot.style.removeProperty('--theater-time-roll-delay');
  };
  const owner = clock ?? (view ? {
    setTimeout: (handler: () => void, delay: number) => view.setTimeout(handler, delay),
    clearTimeout: (id: number | undefined) => view.clearTimeout(id)
  } : undefined);
  const timer = owner?.setTimeout(settle, delayMs + TIME_DIGIT_TRANSITION_MS + 80);
  if (owner && timer !== undefined) settleTimers.set(slot, { id: timer, clock: owner });
}

export function renderTimeReadout(host: HTMLElement, value: string, animate: boolean, clock?: UiClock): void {
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
      if (kind !== 'sep') {
        const roll = doc.createElement('span');
        roll.className = 'theater-time-roll';
        slot.appendChild(roll);
      }
      host.appendChild(slot);
      setSlotChar(slot, ch, { animate: false, roll: null, clock });
    }
    return;
  }
  const slots = [...host.querySelectorAll<HTMLElement>('.theater-time-slot')];
  // Same mask, so the strings compare like the times they show.
  const plan = planDigitRolls(slots.map((slot) => slot.dataset.ch ?? '').join(''), value);
  for (let i = 0; i < value.length; i += 1) {
    const slot = slots[i];
    if (slot) setSlotChar(slot, value[i], { animate, roll: plan[i], clock });
  }
}

export function renderLiveBadge(host: HTMLElement, label: string): void {
  if (host.dataset.mode === 'badge' && host.dataset.badge === label) return;
  host.dataset.mode = 'badge';
  host.dataset.badge = label;
  host.dataset.mask = '';
  host.replaceChildren(label);
}
