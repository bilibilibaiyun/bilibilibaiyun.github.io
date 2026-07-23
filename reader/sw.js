// 寮€婧愰槄璇?- Service Worker CORS 浠ｇ悊
// Service Worker 涓嶅彈娴忚鍣?CORS 闄愬埗,鍙互鐩存帴璇锋眰浠绘剰缃戠珯

const SOURCES = [
  {
    name: 'biquge',
    searchUrl: (kw) => `https://www.biquge.info/search.php?keyword=${encodeURIComponent(kw)}`,
    parseSearch: (html) => {
      const results = [];
      const itemRegex = /<div class="result-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
      let match;
      while ((match = itemRegex.exec(html)) !== null) {
        const block = match[1];
        const titleM = block.match(/<a[^>]*title="([^"]*)"[^>]*>/) || block.match(/<a[^>]*>([^<]+)<\/a>/);
        const urlM = block.match(/href="([^"]+)"/);
        const authorM = block.match(/<span[^>]*>([^<]{1,30})<\/span>/);
        const coverM = block.match(/<img[^>]*src="([^"]+\.(?:jpg|png|webp|jpeg))"/i);
        const introM = block.match(/<p class="result-game-item-desc[^"]*"[^>]*>([^<]*)<\/p>/);
        if (urlM && titleM) {
          results.push({
            title: (titleM[1] || titleM[2] || '').trim(),
            author: authorM ? authorM[1].trim() : '',
            cover: coverM ? coverM[1] : '',
            intro: introM ? introM[1].trim().substring(0, 100) : '',
            url: urlM[1].startsWith('http') ? urlM[1] : 'https://www.biquge.info' + urlM[1]
          });
          if (results.length >= 20) break;
        }
      }
      return results;
    },
    parseDetail: (html, baseUrl) => {
      const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/) || ['', ''])[1].trim();
      const author = (html.match(/浣滆€匸锛?]\s*([^<>\n]{1,30})/) || ['', ''])[1].trim();
      const cover = (html.match(/<img[^>]*src="([^"]+\.(?:jpg|png|webp|jpeg))"/i) || ['', ''])[1];
      const intro = cleanHtml(html.match(/id="intro"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '');
      
      const chapters = [];
      const listBlock = (html.match(/id="list"[\s\S]*?<\/div>/) || [''])[0];
      if (listBlock) {
        const chRegex = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
        let cm;
        while ((cm = chRegex.exec(listBlock)) !== null) {
          chapters.push({
            title: cm[2].trim(),
            url: cm[1].startsWith('http') ? cm[1] : new URL(cm[1], baseUrl).href
          });
        }
      }
      return { title, author, cover, intro, chapters };
    },
    parseContent: (html) => {
      let content = html.match(/id="content"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
      content = cleanHtml(content);
      return content || '绔犺妭鍐呭鍔犺浇涓?..';
    }
  }
];

function cleanHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchWithRedirects(url, maxRedirects = 5) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
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
  for (const src of SOURCES) {
    try {
      const result = await fetchWithRedirects(src.searchUrl(keyword));
      if (!result || result.status !== 200) continue;
      const books = src.parseSearch(result.html);
      if (books.length > 0) return books;
    } catch(e) { continue; }
  }
  return [];
}

async function getBookDetail(bookUrl) {
  const result = await fetchWithRedirects(bookUrl);
  if (!result) throw new Error('鏃犳硶鑾峰彇涔︾睄璇︽儏');
  for (const src of SOURCES) {
    try {
      return src.parseDetail(result.html, bookUrl);
    } catch(e) { continue; }
  }
  throw new Error('瑙ｆ瀽澶辫触');
}

async function getChapterContent(chapterUrl) {
  const result = await fetchWithRedirects(chapterUrl);
  if (!result) throw new Error('鏃犳硶鑾峰彇绔犺妭');
  for (const src of SOURCES) {
    try {
      const content = src.parseContent(result.html);
      if (content) return { content };
    } catch(e) { continue; }
  }
  return { content: '鍐呭鍔犺浇澶辫触' };
}

async function getHotBooks() {
  const result = await fetchWithRedirects('https://www.biquge.info/');
  if (!result) return [];
  const html = result.html;
  const books = [];
  const hotBlock = html.match(/id="hotcontent"[\s\S]*?<\/div>/)?.[0] || '';
  const itemRegex = /<dt>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/dt>/g;
  let m;
  while ((m = itemRegex.exec(hotBlock)) !== null) {
    books.push({
      title: m[2].trim(),
      author: '',
      cover: '',
      intro: '',
      url: m[1].startsWith('http') ? m[1] : 'https://www.biquge.info' + m[1]
    });
    if (books.length >= 20) break;
  }
  return books;
}

// Service Worker 瀹夎
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// 鎷︽埅璇锋眰
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 鍙鐞?api/novels/ 璺緞 (鍙兘鍦ㄥ瓙鐩綍涓?
  if (!url.pathname.includes('/api/novels/')) return;
  
  const params = Object.fromEntries(url.searchParams);
  const path = url.pathname.split('/api/novels/')[1];
  
  let promise;
  switch (path) {
    case 'search':
      promise = searchBooks(params.keyword || '').then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message, data: [] }));
      break;
    case 'detail':
      promise = getBookDetail(params.url).then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message }));
      break;
    case 'content':
      promise = getChapterContent(params.url).then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message }));
      break;
    case 'hot':
      promise = getHotBooks().then(data => ({ ok: true, data })).catch(e => ({ ok: false, error: e.message, data: [] }));
      break;
    default:
      promise = Promise.resolve({ ok: false, error: 'Unknown endpoint' });
  }
  
  const response = promise.then(body => 
    new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  );
  
  event.respondWith(response);
});
