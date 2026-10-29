import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture } from '../../test-utils/video-fixtures';

const browsers = sharedEngineBrowsers();
const media = readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
const bundle = bundlePlayer([
  "import './providers/soop/isolated';",
  "export { installSoopPlayback } from './providers/soop/playback';"
]);
const fixture = `<!doctype html><style>video { width:960px; height:540px } .nextvideo { width:300px; height:100px }</style>
<div id="webplayer"><div id="player" class="play_start"><video id="livePlayer" muted playsinline src="data:video/webm;base64,${media}"></video>
<div class="nextvideo">Play broadcast</div></div></div><script>
  window.starts = 0;
  document.querySelector('.nextvideo').onclick = () => {
    window.starts++;
    document.querySelector('.nextvideo').style.display = 'none';
    const video = document.querySelector('video');
    video.src = URL.createObjectURL(new Blob([Uint8Array.from(atob('${media}'), c => c.charCodeAt(0))], { type: 'video/webm' }));
    video.loop = true;
    video.play();
  };
</script>`;

for (const engine of testEngines()) describe(`${engine} SOOP paused-on-load playback`, () => {
  for (const action of ['Space', 'k', 'button']) it(`starts the broadcast from theater with ${action}`, async t => {
    const tab = await (await browsers[engine].newContext(t)).newPage();
    await serveFixture(tab, fixture, 'https://play.sooplive.com/battleland/297994793');
    await tab.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
    await bootPlayer(tab, { bundle, mainWorld: true, settings: {
      keepControlsVisible: true, soopIntegrationEnabled: action !== 'k', shortcuts: { playPause: action === 'k' ? 'k' : 'Space' }
    } });
    await tab.evaluate('window.stopSoopPlayback = TheaterTest.installSoopPlayback()');
    await enterTheater(tab);
    assert.equal(await tab.evaluate(() => document.querySelector('video')!.paused), true);
    if (action === 'button') await tab.locator('.play-pause-btn').click();
    else await tab.keyboard.press(action);
    await tab.waitForFunction(() => {
      const video = document.querySelector('video')!;
      return video.currentSrc.startsWith('blob:') && !video.paused && video.readyState >= 2;
    });
    assert.equal(await tab.evaluate('window.starts'), 1);
    await tab.locator('.play-pause-btn').click();
    await tab.waitForFunction(() => document.querySelector('video')!.paused);
    await tab.locator('.play-pause-btn').click();
    await tab.waitForFunction(() => !document.querySelector('video')!.paused);
    assert.equal(await tab.evaluate('window.starts'), 1, 'normal stream pause/resume never reloads the host');
    await tab.keyboard.press('Escape');
    await tab.evaluate('window.stopSoopPlayback()');
  });

  it('ignores playback outside theater, ads, stale videos and routes, hidden overlays, and cleans up', async t => {
    const tab = await (await browsers[engine].newContext(t)).newPage();
    await serveFixture(tab, fixture, 'https://play.sooplive.com/battleland/297994793');
    await tab.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
    await bootPlayer(tab, { bundle });
    const starts = await tab.evaluate(`(() => {
      const stop = TheaterTest.installSoopPlayback();
      const video = document.querySelector('video');
      const overlay = document.querySelector('.nextvideo');
      overlay.onclick = () => window.starts++;
      const play = () => video.dispatchEvent(new Event('play'));
      play();
      video.classList.add('theater-everywhere-video-active');
      video.id = 'adVideo'; play(); video.id = 'livePlayer';
      video.remove(); play(); document.querySelector('#player').prepend(video);
      history.pushState(null, '', '/other'); play();
      history.pushState(null, '', '/battleland/297994793');
      overlay.style.display = 'none'; play(); overlay.style.display = '';
      stop(); stop(); play();
      return window.starts;
    })()`);
    assert.equal(starts, 0);
  });
});
