import assert from 'node:assert/strict';
import { it } from 'node:test';
import { bilibiliIntlVideoIdentity } from './watch-playback';

it('Bilibili.tv identities distinguish uploads and episodes, ignoring locale and tracking', () => {
  for (const locale of ['en', 'id', 'th', 'vi', 'es', 'pt', 'ar', 'ru', 'zh-Hant']) {
    assert.equal(bilibiliIntlVideoIdentity(new URL(`https://www.bilibili.tv/${locale}/video/4801285774384128?bstar_from=home`)), 'ugc:4801285774384128');
    assert.equal(bilibiliIntlVideoIdentity(new URL(`https://www.bilibili.tv/${locale}/play/1053337/11371243/`)), 'ogv:1053337:11371243');
  }
  for (const path of ['/en', '/en/search', '/en/play/1053337', '/en/video/0', '/en/video/123/extra', '/en/play/1/2/extra', '/en/video/NaN']) {
    assert.equal(bilibiliIntlVideoIdentity(new URL(`https://www.bilibili.tv${path}`)), null, path);
  }
  for (const origin of ['http://www.bilibili.tv', 'https://www.bilibili.com', 'https://www.bilibili.tv.evil.test']) {
    assert.equal(bilibiliIntlVideoIdentity(new URL(`${origin}/en/video/123`)), null);
  }
});
