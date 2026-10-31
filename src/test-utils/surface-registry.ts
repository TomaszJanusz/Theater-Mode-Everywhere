import { openProviderSettings } from '../../options/provider-settings';
import { createProviderSettings } from '../providers/settings';
import { bindMenuPopover } from '../ui/menu-popover';
import { createModal, type Modal } from '../ui/modal';

import { controlButton, type SurfaceRegistration } from './component-surface';

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
  }
];
