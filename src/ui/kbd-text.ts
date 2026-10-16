/** Renders localized text whose `<kbd>key</kbd>` spans become shared key-cap elements. */
export function renderKbdText(el: HTMLElement, rawText: string): void {
  el.textContent = '';
  const kbdRe = /<kbd>(.*?)<\/kbd>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = kbdRe.exec(rawText)) !== null) {
    if (m.index > last) el.appendChild(document.createTextNode(rawText.slice(last, m.index)));
    const kbd = document.createElement('kbd');
    kbd.textContent = m[1];
    el.appendChild(kbd);
    last = m.index + m[0].length;
  }
  if (last < rawText.length) el.appendChild(document.createTextNode(rawText.slice(last)));
}
