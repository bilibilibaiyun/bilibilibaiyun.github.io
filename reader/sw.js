// 寮€婧愰槄璇荤綉椤电増 - Service Worker CORS 浠ｇ悊 v3
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
    return { html: await resp.text(), url: currentUrl, status: resp.status };
  }
  return null;
}

async function searchBooks(keyword) {
  const hosts = [
    'https://www.biquge.info/search.php?keyword=',
    'https://www.ibiquge.net/search.php?keyword=',
    'https://www.biqugeu.net/search.php?keyword='
  ];
  for (const base of hosts) {
    try {
      const res = await fetchHtml(base + encodeURIComponent(keyword));
      if (!res || !res.html) continue;
      const html = res.html;
      const books = [];

      // 鎻愬彇鎵€鏈夊彲鑳界殑缁撴灉
      const titleRx = /<a[^>]*href="(https?:\/\/[^"']*)"[^>]*>([^<]{1,60})<\/a>/g;
      let m;
      while ((m = titleRx.exec(html)) !== null) {
        const url = m[1], title = cleanHtml(m[2]);
        if (!title || title.length < 2) continue;
        if (books.find(b => b.url === url)) continue;
        // 鎵句綔鑰?        const block = html.substring(Math.max(0, m.index - 300), m.index + 300);
        const author = (block.match(/(?:浣滆€厊钁?[锛?]\s*([^<>\n]{1,30})/) || ['',''])[1].trim();
        books.push({ title, author, cover: '', intro: '', url });
        if (books.length >= 20) break;
      }
      if (books.length > 0) return books;
    } catch(e) { continue; }
  }
  return [];
}

async function getBookDetail(bookUrl) {
  const res = await fetchHtml(bookUrl);
  if (!res) throw new Error('鍔犺浇澶辫触');
  const html = res.html;

  let title = '';
  const t1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (t1) title = cleanHtml(t1[1]);

  let author = '';
  const a1 = html.match(/(?:浣滆€厊钁?[锛?]\s*([^<>\n]{1,30})/);
  if (a1) author = a1[1].trim();

  const cover = (html.match(/<img[^>]*src="([^"]+\.(?:jpg|png|webp|jpeg))"/i) || ['',''])[1];

  let intro = '';
  const i1 = html.match(/id="intro"[^>]*>([\s\S]*?)<\/div>/);
  if (i1) intro = cleanHtml(i1[1]).substring(0, 300);

  // 绔犺妭 - 鎻愬彇 id="list" 鎴?class="list" 涓嬬殑鎵€鏈?a 鏍囩
  const chapters = [];
  const listBlock = html.match(/(?:id="list"|class="[^"]*list[^"]*"|id="chapters"|class="[^"]*chapter[^"]*")[\s\S]*?<\/div>/);
  if (listBlock) {
    const chRx = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let cm;
    while ((cm = chRx.exec(listBlock[0])) !== null) {
      const ct = cleanHtml(cm[2]);
      if (ct.length >= 2) {
        chapters.push({
          title: ct,
          url: cm[1].startsWith('http') ? cm[1] : new URL(cm[1], bookUrl).href
        });
      }
    }
  }

  // 濡傛灉杩樻病鎵惧埌绔犺妭锛屽皾璇?dd a 鎴?li a
  if (chapters.length === 0) {
    const ddRx = /<(?:dd|li)>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let cm;
    while ((cm = ddRx.exec(html)) !== null) {
      const ct = cleanHtml(cm[2]);
      if (ct.length >= 2 && !ct.includes('棣栭〉') && !ct.includes('涓婁竴椤?) && !ct.includes('涓嬩竴椤?)) {
        chapters.push({
          title: ct,
          url: cm[1].startsWith('http') ? cm[1] : new URL(cm[1], bookUrl).href
        });
      }
    }
  }

  return { title: title || '鏈煡', author, cover, intro, chapters };
}

async function getChapterContent(chapterUrl) {
  const res = await fetchHtml(chapterUrl);
  if (!res) throw new Error('鍔犺浇澶辫触');
  const html = res.html;

  // 灏濊瘯澶氫釜鍐呭鍖归厤
  const patterns = [
    /id="content"[^>]*>([\s\S]*?)<\/div>/,
    /id="contents"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*read-content[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*txt[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    /id="TextContent"[^>]*>([\s\S]*?)<\/div>/
  ];

  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) {
      const content = cleanHtml(m[1]);
      const cn = (content.match(/[\u4e00-\u9fff]/g) || []).length;
      if (cn > 10 && content.length > 50) return { content };
    }
  }

  // fallback: body 涓彁鍙栦腑鏂囨钀?  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (body) {
    const text = cleanHtml(body[1]);
    const lines = text.split('\n').filter(l => {
      const cn = (l.match(/[\u4e00-\u9fff]/g) || []).length;
      return cn > 15 && l.length > 30;
    });
    if (lines.length > 0) return { content: lines.join('\n\n') };
  }

  throw new Error('鍐呭鎻愬彇澶辫触');
}

async function getHotBooks() {
  const hosts = ['www.biquge.info', 'www.ibiquge.net', 'www.biqugeu.net'];
  for (const host of hosts) {
    try {
      const res = await fetchHtml(`https://${host}/`);
      if (!res) continue;
      const books = [];
      const rx = /<a[^>]*href="(https?:\/\/[^"']*\/[^"']*)"[^>]*>([^<]{1,60})<\/a>/g;
      let m;
      while ((m = rx.exec(res.html)) !== null) {
        const url = m[1], title = cleanHtml(m[2]);
        if (!title || title.length < 2) continue;
        if (books.find(b => b.url === url)) continue;
        books.push({ title, author: '', cover: '', intro: '', url });
        if (books.length >= 20) break;
      }
      if (books.length > 0) return books;
    } catch(e) { continue; }
  }
  return [];
}

// ====== Fetch 鎷︽埅 ======
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.includes('/api/novels/')) return;

  const params = Object.fromEntries(url.searchParams);
  const path = url.pathname.split('/api/novels/')[1];

  let promise;
  switch (path) {
    case 'search':
      promise = searchBooks(params.keyword || '').then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message, data: [] }));
      break;
    case 'detail':
      promise = getBookDetail(params.url).then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message }));
      break;
    case 'content':
      promise = getChapterContent(params.url).then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message }));
      break;
    case 'hot':
      promise = getHotBooks().then(d => ({ ok: true, data: d })).catch(e => ({ ok: false, error: e.message, data: [] }));
      break;
    default:
      promise = Promise.resolve({ ok: false, error: 'Unknown' });
  }

  event.respondWith(promise.then(body =>
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  ));
});
