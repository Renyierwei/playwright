/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { folio as baseFolio } from './fixtures';

const fixtures = baseFolio.extend();
fixtures.browserOptions.override(async ({ browserOptions }, run) => {
  await run({ ...browserOptions, proxy: { server: 'per-context' } });
});

const { it, expect } = fixtures.build();

it('should throw for missing global proxy', async ({ browserType, browserOptions, server }) => {
  delete browserOptions.proxy;
  const browser = await browserType.launch(browserOptions);
  const error = await browser.newContext({ proxy: { server: `localhost:${server.PORT}` } }).catch(e => e);
  expect(error.toString()).toContain('Browser needs to be launched with the global proxy');
  await browser.close();
});

it('should throw for bad server value', async ({ contextFactory, contextOptions }) => {
  const error = await contextFactory({
    ...contextOptions,
    // @ts-expect-error server must be a string
    proxy: { server: 123 }
  }).catch(e => e);
  expect(error.message).toContain('proxy.server: expected string, got number');
});

it('should use proxy', async ({ contextFactory, contextOptions, server }) => {
  server.setRoute('/target.html', async (req, res) => {
    res.end('<html><title>Served by the proxy</title></html>');
  });
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `localhost:${server.PORT}` }
  });
  const page = await browser.newPage();
  await page.goto('http://non-existent.com/target.html');
  expect(await page.title()).toBe('Served by the proxy');
  await browser.close();
});

it('should use proxy twice', async ({ contextFactory, contextOptions, server }) => {
  server.setRoute('/target.html', async (req, res) => {
    res.end('<html><title>Served by the proxy</title></html>');
  });
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `localhost:${server.PORT}` }
  });
  const page = await browser.newPage();
  await page.goto('http://non-existent.com/target.html');
  await page.goto('http://non-existent-2.com/target.html');
  expect(await page.title()).toBe('Served by the proxy');
  await browser.close();
});

it('should use proxy for second page', async ({contextFactory, contextOptions, server}) => {
  server.setRoute('/target.html', async (req, res) => {
    res.end('<html><title>Served by the proxy</title></html>');
  });
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `localhost:${server.PORT}` }
  });

  const page = await browser.newPage();
  await page.goto('http://non-existent.com/target.html');
  expect(await page.title()).toBe('Served by the proxy');

  const page2 = await browser.newPage();
  await page2.goto('http://non-existent.com/target.html');
  expect(await page2.title()).toBe('Served by the proxy');

  await browser.close();
});

it('should work with IP:PORT notion', async ({contextFactory, contextOptions, server}) => {
  server.setRoute('/target.html', async (req, res) => {
    res.end('<html><title>Served by the proxy</title></html>');
  });
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `127.0.0.1:${server.PORT}` }
  });
  const page = await browser.newPage();
  await page.goto('http://non-existent.com/target.html');
  expect(await page.title()).toBe('Served by the proxy');
  await browser.close();
});

it('should authenticate', async ({contextFactory, contextOptions, server}) => {
  server.setRoute('/target.html', async (req, res) => {
    const auth = req.headers['proxy-authorization'];
    if (!auth) {
      res.writeHead(407, 'Proxy Authentication Required', {
        'Proxy-Authenticate': 'Basic realm="Access to internal site"'
      });
      res.end();
    } else {
      res.end(`<html><title>${auth}</title></html>`);
    }
  });
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `localhost:${server.PORT}`, username: 'user', password: 'secret' }
  });
  const page = await browser.newPage();
  await page.goto('http://non-existent.com/target.html');
  expect(await page.title()).toBe('Basic ' + Buffer.from('user:secret').toString('base64'));
  await browser.close();
});

it('should exclude patterns', (test, { browserName, headful }) => {
  test.fixme(browserName === 'chromium' && headful, 'Chromium headful crashes with CHECK(!in_frame_tree_) in RenderFrameImpl::OnDeleteFrame.');
}, async ({contextFactory, contextOptions, server}) => {
  server.setRoute('/target.html', async (req, res) => {
    res.end('<html><title>Served by the proxy</title></html>');
  });
  // FYI: using long and weird domain names to avoid ATT DNS hijacking
  // that resolves everything to some weird search results page.
  //
  // @see https://gist.github.com/CollinChaffin/24f6c9652efb3d6d5ef2f5502720ef00
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `localhost:${server.PORT}`, bypass: '1.non.existent.domain.for.the.test, 2.non.existent.domain.for.the.test, .another.test' }
  });

  const page = await browser.newPage();
  await page.goto('http://0.non.existent.domain.for.the.test/target.html');
  expect(await page.title()).toBe('Served by the proxy');

  {
    const error = await page.goto('http://1.non.existent.domain.for.the.test/target.html').catch(e => e);
    expect(error.message).toBeTruthy();
  }

  {
    const error = await page.goto('http://2.non.existent.domain.for.the.test/target.html').catch(e => e);
    expect(error.message).toBeTruthy();
  }

  {
    const error = await page.goto('http://foo.is.the.another.test/target.html').catch(e => e);
    expect(error.message).toBeTruthy();
  }

  {
    await page.goto('http://3.non.existent.domain.for.the.test/target.html');
    expect(await page.title()).toBe('Served by the proxy');
  }

  await browser.close();
});

it('should use socks proxy', (test, { browserName, platform }) => {
  test.flaky(platform === 'darwin' && browserName === 'webkit', 'Intermittent page.goto: The network connection was lost error on bots');
}, async ({ contextFactory, contextOptions, socksPort }) => {
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `socks5://localhost:${socksPort}` }
  });
  const page = await browser.newPage();
  await page.goto('http://non-existent.com');
  expect(await page.title()).toBe('Served by the SOCKS proxy');
  await browser.close();
});

it('should use socks proxy in second page', (test, { browserName, platform }) => {
  test.flaky(platform === 'darwin' && browserName === 'webkit', 'Intermittent page.goto: The network connection was lost error on bots');
}, async ({ contextFactory, contextOptions, socksPort }) => {
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: `socks5://localhost:${socksPort}` }
  });

  const page = await browser.newPage();
  await page.goto('http://non-existent.com');
  expect(await page.title()).toBe('Served by the SOCKS proxy');

  const page2 = await browser.newPage();
  await page2.goto('http://non-existent.com');
  expect(await page2.title()).toBe('Served by the SOCKS proxy');

  await browser.close();
});

it('does launch without a port', async ({ contextFactory, contextOptions }) => {
  const browser = await contextFactory({
    ...contextOptions,
    proxy: { server: 'http://localhost' }
  });
  await browser.close();
});
