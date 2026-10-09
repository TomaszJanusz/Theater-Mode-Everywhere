import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installXhrHarvest } from './xhr-harvest';

function fixture() {
  class FakeXhr extends EventTarget {
    status = 0;
    responseURL = '';
    responseText = '';
    listenerCount = 0;
    throwSend = false;
    open(_method: string, _url: string): void {}
    send(): void { if (this.throwSend) throw new Error('InvalidStateError'); }
    override addEventListener(...args: Parameters<EventTarget['addEventListener']>): void {
      this.listenerCount += 1;
      super.addEventListener(...args);
    }
    complete(status: number, body: string, responseURL = ''): void {
      this.status = status;
      this.responseText = body;
      this.responseURL = responseURL;
      this.dispatchEvent(new Event('loadend'));
    }
  }
  const harvested: Array<[string, string]> = [];
  installXhrHarvest(FakeXhr.prototype as unknown as XMLHttpRequest, (xhr, url) => harvested.push([url, xhr.responseText]));
  return { xhr: new FakeXhr(), harvested };
}

describe('main-world reusable XHR harvest', () => {
  it('harvests each of three successful requests exactly once with its own latest URL', () => {
    const { xhr, harvested } = fixture();
    for (let index = 1; index <= 3; index += 1) {
      xhr.open('GET', `/request-${index}`);
      xhr.send();
      xhr.complete(200, `body-${index}`, index === 2 ? '/redirect-2' : '');
    }
    assert.deepEqual(harvested, [['/request-1', 'body-1'], ['/redirect-2', 'body-2'], ['/request-3', 'body-3']]);
    assert.equal(xhr.listenerCount, 1);
  });

  it('keeps one observer across a failed request and a subsequent successful reuse', () => {
    const { xhr, harvested } = fixture();
    for (const [index, status] of [[1, 200], [2, 0], [3, 200]]) {
      xhr.open('GET', `/request-${index}`);
      xhr.send();
      xhr.complete(status, `body-${index}`);
    }
    assert.deepEqual(harvested, [['/request-1', 'body-1'], ['/request-3', 'body-3']]);
    assert.equal(xhr.listenerCount, 1);
  });

  it('does not add another listener after send throws synchronously', () => {
    const { xhr, harvested } = fixture();
    xhr.throwSend = true;
    xhr.open('GET', '/failed');
    assert.throws(() => xhr.send(), /InvalidStateError/);
    xhr.throwSend = false;
    xhr.open('GET', '/retry');
    xhr.send();
    xhr.complete(200, 'retry');
    assert.deepEqual(harvested, [['/retry', 'retry']]);
    assert.equal(xhr.listenerCount, 1);
  });
});
