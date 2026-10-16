export const VIDEO_ACTIVATOR_STORAGE_KEY = 'videoActivator';
export const DEFAULT_VIDEO_ACTIVATOR = false;

/** Only an explicit `true` enables the optional launcher. */
export function resolveVideoActivator(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_VIDEO_ACTIVATOR;
}

export const VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY = 'videoActivatorPromptAnswer';

export function shouldOfferVideoActivator(settings: Record<string, unknown>): boolean {
  return !resolveVideoActivator(settings[VIDEO_ACTIVATOR_STORAGE_KEY])
    && typeof settings[VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY] !== 'boolean';
}
