/** Text measurement waits for bundled fonts, but unavailable fonts must not hide the preview. */
export async function waitForFonts(doc: Document): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(['400', '500', '600', '700'].map(weight => doc.fonts.load(`${weight} 16px Roboto`))),
      new Promise<void>(resolve => { timeout = setTimeout(resolve, 3000); })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
