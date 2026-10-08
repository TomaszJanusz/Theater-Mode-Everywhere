import {
  ChatController,
  DEFAULT_CHAT_WIDTH_PX,
  MAX_CHAT_WIDTH_PX,
  MIN_CHAT_WIDTH_PX,
  type ChatPreference,
  type ChatProvider,
  type ChatState,
  type ChatTheme,
  normalizeChatTheme
} from '../chat';
import type { DisposableScope } from '../core/disposable-scope';
import type { PlayerChromeContext } from './runtime-context';
import { queryPlayerUi } from './root';

export const CHAT_PREFERENCES_STORAGE_KEY = 'nativeChatPreferences';
type ChatPreferences = Partial<Record<ChatProvider, ChatPreference>>;

let preferences: ChatPreferences = {};
let controller: ChatController | null = null;
const subscribers = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function notify(): void {
  for (const subscriber of subscribers) subscriber();
}

function schedulePersist(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        void chrome.storage.sync.set({ [CHAT_PREFERENCES_STORAGE_KEY]: preferences }).catch(() => {});
      }
    } catch { /* Native chat remains usable when extension storage is unavailable. */ }
  }, 350);
}

function storedTheme(provider: ChatProvider): ChatTheme {
  return normalizeChatTheme(preferences[provider]?.theme);
}

function displayedTheme(state: ChatState | null): ChatTheme {
  if (state?.theme === 'light' || state?.theme === 'native' || state?.theme === 'dark') return state.theme;
  const provider = state?.surface?.provider;
  return provider ? storedTheme(provider) : 'native';
}

export function hydrateChatPreferences(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const candidate = value as Record<string, unknown>;
  const next: ChatPreferences = {};
  for (const provider of ['twitch', 'youtube'] as const) {
    const entry = candidate[provider];
    if (!entry || typeof entry !== 'object') continue;
    const pref = entry as Partial<ChatPreference>;
    if (typeof pref.visible === 'boolean' && typeof pref.width === 'number' && Number.isFinite(pref.width)) {
      next[provider] = {
        visible: pref.visible,
        width: Math.min(MAX_CHAT_WIDTH_PX, Math.max(MIN_CHAT_WIDTH_PX, pref.width)),
        theme: normalizeChatTheme(pref.theme)
      };
    }
  }
  preferences = next;
}

export function nativeChatState(): ChatState | null {
  return controller?.state ?? null;
}

export function startNativeChatSession(onLayoutChange: () => void): void {
  stopNativeChatSession();
  controller = new ChatController({
    document,
    href: () => window.location.href,
    initialPreferences: preferences,
    onChange: notify,
    onLayoutChange,
    focusToggle: () => queryPlayerUi<HTMLButtonElement>('.theater-chat-toggle')?.focus(),
    persistPreference: (provider, preference) => {
      const theme = 'theme' in preference ? normalizeChatTheme(preference.theme) : storedTheme(provider);
      preferences[provider] = { visible: preference.visible, width: preference.width, theme };
      schedulePersist();
    }
  });
  notify();
}

export function stopNativeChatSession(): void {
  controller?.dispose();
  controller = null;
  notify();
}

export function mountNativeChatControls(
  ctx: PlayerChromeContext,
  scope: DisposableScope,
  toolbar: HTMLElement,
  settingsPanel: HTMLElement,
  tooltip: (button: HTMLButtonElement, text: () => string) => void
): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theater-control-btn theater-chat-toggle';
  ctx.actions.setIcon(button, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>');
  const label = () => ctx.t(nativeChatState()?.visible ? 'hideNativeChat' : 'showNativeChat');
  tooltip(button, label);
  scope.listen(button, 'click', () => {
    controller?.toggle();
    ctx.actions.showToolbar();
  });
  toolbar.append(button);

  const widthRow = document.createElement('label');
  widthRow.className = 'theater-chat-width-row';
  const widthLabel = document.createElement('span');
  widthLabel.textContent = ctx.t('nativeChatWidth');
  const widthValue = document.createElement('output');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(MIN_CHAT_WIDTH_PX);
  slider.max = String(MAX_CHAT_WIDTH_PX);
  slider.step = '10';
  slider.setAttribute('aria-label', ctx.t('nativeChatWidth'));
  slider.className = 'theater-chat-width-slider';
  widthRow.append(widthLabel, widthValue, slider);
  settingsPanel.querySelector('.theater-settings-body')?.append(widthRow);
  scope.listen(slider, 'input', () => controller?.setWidth(Number(slider.value)));

  const themeRow = document.createElement('label');
  themeRow.className = 'theater-chat-theme-row';
  const themeLabel = document.createElement('span');
  themeLabel.textContent = ctx.t('nativeChatTheme');
  const themeSelect = document.createElement('select');
  themeSelect.className = 'theater-chat-theme-select';
  themeSelect.setAttribute('aria-label', ctx.t('nativeChatTheme'));
  for (const [value, messageName] of [
    ['light', 'nativeChatThemeLight'],
    ['native', 'nativeChatThemeNative'],
    ['dark', 'nativeChatThemeDark']
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = ctx.t(messageName);
    themeSelect.append(option);
  }
  const themeHint = document.createElement('span');
  themeHint.className = 'theater-chat-theme-hint';
  themeHint.id = 'theater-chat-theme-hint';
  themeHint.textContent = ctx.t('nativeChatThemeYouTubeNative');
  themeRow.append(themeLabel, themeSelect, themeHint);
  settingsPanel.querySelector('.theater-settings-body')?.append(themeRow);
  scope.listen(themeSelect, 'change', () => controller?.setTheme(normalizeChatTheme(themeSelect.value)));

  const update = () => {
    const state = nativeChatState();
    button.hidden = !state?.available;
    button.setAttribute('aria-expanded', String(Boolean(state?.visible)));
    button.setAttribute('aria-label', label());
    button.classList.toggle('active', Boolean(state?.visible));
    widthRow.hidden = !state?.available || state.dock !== 'right';
    slider.disabled = !state?.visible;
    slider.value = String(state?.width ?? DEFAULT_CHAT_WIDTH_PX);
    widthValue.value = slider.value + ' px';
    themeRow.hidden = !state?.available;
    const serviceThemeOnly = state?.surface?.provider === 'youtube';
    themeSelect.disabled = !state?.available || serviceThemeOnly;
    themeHint.hidden = !serviceThemeOnly;
    if (serviceThemeOnly) themeSelect.setAttribute('aria-describedby', themeHint.id);
    else themeSelect.removeAttribute('aria-describedby');
    const theme = displayedTheme(state);
    if (themeSelect.value !== theme) themeSelect.value = theme;
  };
  subscribers.add(update);
  scope.add(() => subscribers.delete(update));
  update();
}
