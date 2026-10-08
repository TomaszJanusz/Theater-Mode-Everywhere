// Research only. Not imported by the extension or included in its bundles.
// Run these functions in the chat document's MAIN world, e.g. frame.evaluate.
// Capture both palettes through YouTube's real Appearance menu in a disposable
// profile. This intentionally does not solve acquisition in a user's session.
export function capturePalette() {
  const names = new Set();
  const references = new Set();
  let build;
  for (const sheet of document.styleSheets) {
    if (sheet.href?.includes('live_chat_base')) {
      build = sheet.href.split('/am=')[0];
    }
    const visit = rules => {
      for (const rule of rules) {
        if (rule.style) {
          for (const property of rule.style) {
            if (/^--t[0-9a-f]+$/.test(property)) names.add(property);
            for (const token of rule.style.getPropertyValue(property).match(/--t[0-9a-f]+/g) || []) {
              references.add(token);
            }
          }
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    // An unreadable sheet invalidates this research capture; no partial palette.
    visit(sheet.cssRules);
  }
  const computed = getComputedStyle(document.documentElement);
  return {
    build,
    nativeDark: document.documentElement.hasAttribute('dark'),
    aliases: Object.fromEntries([...names].map(name => [name, computed.getPropertyValue(name).trim()])),
    references: [...references],
  };
}

export function applyPalettePrototype({ light, dark, theme, referencedOnly = false }) {
  if (!light.build || light.build !== dark.build || light.nativeDark || !dark.nativeDark) {
    throw new Error('Expected native light/dark captures from the same CSS build');
  }
  const lightKeys = Object.keys(light.aliases).sort();
  if (JSON.stringify(lightKeys) !== JSON.stringify(Object.keys(dark.aliases).sort())) {
    throw new Error('Palette token sets differ');
  }
  const app = document.querySelector('yt-live-chat-app')?.polymerController;
  if (typeof app?.setGlobalDarkTheme !== 'function') throw new Error('Native theme method unavailable');
  const originalDark = document.documentElement.hasAttribute('dark');
  const keys = lightKeys.filter(key => light.aliases[key] !== dark.aliases[key]
    && (!referencedOnly || light.references.includes(key) || dark.references.includes(key)));
  const style = document.createElement('style');
  style.dataset.tmeThemeResearch = '';
  document.head.append(style);
  let disposed = false;
  const setTheme = value => {
    if (disposed) throw new Error('Prototype already restored');
    if (value !== 'light' && value !== 'dark') throw new Error('Unknown theme');
    const palette = value === 'dark' ? dark : light;
    // :root:root declarations also occur in the native sheet. A plain :root
    // patch loses that cascade. This priority is sufficient for the tested build.
    style.textContent = ':root:root:root{' + keys.map(key => key + ':' + palette.aliases[key] + ';').join('') + '}';
    app.setGlobalDarkTheme(value === 'dark');
    return { properties: keys.length, cssBytes: new TextEncoder().encode(style.textContent).length };
  };
  const restore = () => {
    if (disposed) return;
    style.remove();
    app.setGlobalDarkTheme(originalDark);
    disposed = true;
  };
  try {
    return { ...setTheme(theme), setTheme, restore };
  } catch (error) {
    restore();
    throw error;
  }
}
