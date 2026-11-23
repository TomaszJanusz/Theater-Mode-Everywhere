import { openProviderSettings } from '../../options/provider-settings';
import { providerAuthorHosts } from '../providers/author-byline';
import { mountAuthorByline } from '../providers/author-byline-view';
import { mountPlaylistPanel } from '../providers/playlist-panel-view';
import { createProviderSettings, type ProviderSettingsStore } from '../providers/settings';
import { bindMenuPopover } from '../ui/menu-popover';
import { createModal, type Modal } from '../ui/modal';

import { controlButton, type SurfaceRegistration } from './component-surface';
import { fakePlaylistSource, playlistBar, samplePlaylist } from './playlist-panel-fixture';

// The surface registry: one entry per top-layer surface. A new surface gets the conformance cases
// (ui/surfaces.component.test.ts) and the accessibility matrix (ui/accessibility.component.test.ts) by registering here.
export const surfaceRegistrations: SurfaceRegistration[] = [
  {
    name: 'provider settings modal',
    policy: 'modal',
    mount({ root, stage, owner }) {
      const provider = { id: 'sample', name: 'Sample', settings: [{ id: 'enabled', type: 'boolean' as const,
        default: true, label: 'providerShowRecommendations', description: 'providerShowRecommendationsDescription' }] };
      const store = createProviderSettings([provider]);
      owner.add(() => store.dispose());
      const trigger = controlButton('Settings');
      stage.append(trigger);
      let modal: ReturnType<typeof openProviderSettings> | undefined;
      owner.listen(trigger, 'click', () => {
        modal = openProviderSettings(provider, store, { mount: overlay => root.append(overlay), signal: owner.signal });
      });
      return { trigger, surface: () => modal?.overlay ?? null, close: () => modal?.close() };
    }
  },
  {
    name: 'modal',
    policy: 'modal',
    mount({ root, stage, owner }) {
      const trigger = controlButton('Open dialog');
      stage.append(trigger);
      let modal: Modal | undefined;
      owner.listen(trigger, 'click', () => {
        modal = createModal({
          title: 'Surface', closeLabel: 'Close', content: 'Body',
          actions: [{ label: 'Cancel', kind: 'secondary', value: false }, { label: 'Confirm', kind: 'primary', value: true }],
          mount: overlay => root.append(overlay),
          signal: owner.signal
        });
      });
      return { trigger, surface: () => modal?.overlay ?? null, close: () => modal?.close() };
    }
  },
  {
    name: 'settings menu',
    policy: 'anchored-menu',
    mount({ stage, owner }) {
      const host = document.createElement('div');
      host.className = 'theater-settings-container';
      const trigger = controlButton('Settings');
      trigger.className = 'theater-control-btn';
      const panel = document.createElement('div');
      panel.className = 'theater-settings-menu';
      panel.append(controlButton('First row'), controlButton('Second row'));
      host.append(trigger, panel);
      stage.append(host);
      const menu = bindMenuPopover({ host, trigger, panel, scope: owner });
      return { trigger, surface: () => host, close: () => { menu.close(); } };
    }
  },
  // Before the playlist panel, which stays the anchored-menu representative on hostile pages (its rows are buttons).
  {
    name: 'author popup',
    policy: 'anchored-menu',
    mount({ stage, owner }) {
      // The title plate in its header at the top of the player, as the title HUD builds it (a plate takes pointer
      // input only in a visible header), with the provider setting and the global switch already loaded and on.
      const header = document.createElement('div');
      header.className = 'theater-everywhere-header-hud visible';
      const plate = document.createElement('div');
      plate.className = 'theater-everywhere-title-hud theater-hud-plate';
      plate.append(Object.assign(document.createElement('div'), { className: 'theater-title-hud-viewport', textContent: 'A video' }));
      header.append(plate);
      stage.append(header);
      const settings = { loaded: true, values: { sample: { showAuthor: true } }, subscribe: () => () => {}, dispose() {} } as unknown as ProviderSettingsStore;
      const global = { enabled: true, ready: Promise.resolve(), subscribe: () => () => {}, dispose() {} };
      const byline = mountAuthorByline({ scope: owner, bindMenu: bindMenuPopover }, {
        provider: 'sample', settings, global, hosts: providerAuthorHosts([{ domain: 'example.com', includeSubdomains: true }], [])
      });
      byline.render([1, 2].map(index => ({ id: String(index), name: `Channel ${index}`, url: `https://www.example.com/c/${index}`,
        avatarUrl: null, verified: false, stat: null })), plate);
      const host = plate.querySelector<HTMLElement>('.theater-byline')!;
      const trigger = host.querySelector<HTMLButtonElement>(':scope > button')!;
      return { trigger, surface: () => host, close: () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } };
    }
  },
  {
    name: 'playlist panel',
    policy: 'anchored-menu',
    mount({ stage, owner }) {
      const panel = mountPlaylistPanel(fakePlaylistSource(samplePlaylist()).source, playlistBar(owner));
      // The list-menu shell places its notch with the control bar's variables (shadow.css).
      panel.host.style.cssText = '--theater-menu-notch:48px;--theater-menu-notch-overlap:32px';
      stage.append(panel.host);
      panel.syncAvailability();
      const trigger = panel.host.querySelector<HTMLButtonElement>(':scope > button')!;
      return { trigger, surface: () => panel.host, close: () => { panel.close(); } };
    }
  }
];
