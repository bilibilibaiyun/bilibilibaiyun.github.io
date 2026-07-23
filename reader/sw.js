// 开源阅读网页版 - Service Worker v4
// 只做一件事：绕过 CORS 返回原始 HTML，解析交给前端
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

async function fetchHtml(url) {
  let currentUrl = url;
  for (let i = 0; i < 5; i++) {
    const resp = await fetch(currentUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) break;
      currentUrl = new URL(loc, currentUrl).href;
      continue;
    }
    return {
      html: await resp.text(),
      url: currentUrl,
      status: resp.status,
      ok: resp.ok,
      contentType: resp.headers.get('content-type') || ''
    };
  }
  return null;
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes('/api/novels/')) return;

  const params = Object.fromEntries(url.searchParams);
  const path = url.pathname.split('/api/novels/')[1];

  let promise;

  if (path === 'fetch') {
    promise = fetchHtml(params.url).then(r => {
      if (!r) return { ok: false, error: '无法连接到目标站点' };
      return {
        ok: r.ok,
        status: r.status,
        url: r.url,
        html: r.html.substring(0, 50000),
        contentType: r.contentType,
        len: r.html.length
      };
    }).catch(e => ({ ok: false, error: e.message }));
  } else {
    promise = Promise.resolve({ ok: false, error: 'unknown endpoint' });
  }

  event.respondWith(promise.then(body =>
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  ));
});
