import { createProviderSettings, type SettingsProvider } from '../settings';

import descriptor from './provider.json';

// JSON widens literal string types; keep the descriptor checked against the boolean-only contract.
const provider: SettingsProvider = { id: descriptor.id, settings: descriptor.settings.map(setting => ({ ...setting, type: 'boolean' })) };
export const createYouTubeSettings = () => createProviderSettings([provider]);
