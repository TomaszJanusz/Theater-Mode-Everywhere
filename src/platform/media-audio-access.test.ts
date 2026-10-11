import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mediaAudioAccess } from './media-audio-access';

const PAGE = 'https://watch.example';

function media(fields: Partial<Pick<HTMLMediaElement, 'currentSrc' | 'src' | 'crossOrigin' | 'readyState' | 'mediaKeys' | 'srcObject'>>): HTMLMediaElement {
  return { currentSrc: '', src: '', crossOrigin: null, readyState: 0, mediaKeys: null, srcObject: null, ...fields } as HTMLMediaElement;
}

describe('media audio access', () => {
  it('treats same-origin, blob, data and stream sources as audible to Web Audio', () => {
    assert.equal(mediaAudioAccess(media({ currentSrc: `${PAGE}/movie.mp4` }), PAGE), 'open');
    assert.equal(mediaAudioAccess(media({ currentSrc: `blob:${PAGE}/1234` }), PAGE), 'open');
    assert.equal(mediaAudioAccess(media({ src: 'data:audio/wav;base64,AA==' }), PAGE), 'open');
    assert.equal(mediaAudioAccess(media({ srcObject: {} as MediaStream }), PAGE), 'open');
  });

  it('requires a CORS load that has delivered metadata for cross-origin files', () => {
    const cdn = 'https://cdn.example/movie.mp4';
    assert.equal(mediaAudioAccess(media({ currentSrc: cdn, readyState: 4 }), PAGE), 'needs-cors');
    assert.equal(mediaAudioAccess(media({ currentSrc: cdn, crossOrigin: 'anonymous' }), PAGE), 'needs-cors');
    assert.equal(mediaAudioAccess(media({ currentSrc: cdn, crossOrigin: 'anonymous', readyState: 1 }), PAGE), 'open');
  });

  it('never routes encrypted media, whose decoded audio is silent to Web Audio', () => {
    assert.equal(mediaAudioAccess(media({ currentSrc: `blob:${PAGE}/1`, mediaKeys: {} as MediaKeys }), PAGE), 'protected');
  });
});
