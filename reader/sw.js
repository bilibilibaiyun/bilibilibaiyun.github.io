// 寮€婧愰槄璇荤綉椤电増 - Service Worker CORS 浠ｇ悊 v2
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ====== 宸ュ叿鍑芥暟 ======
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

// 鍒ゆ柇鍐呭鏄惁鐪嬭捣鏉ュ儚浠ｇ爜/鍨冨溇锛堜笉鏄鏂囷級
function looksLikeGarbage(text) {
  const ratio = (text.match(/[{}=;:<>()[\]\/\\!@#$%^&*]/g) || []).length / Math.max(text.length, 1);
  return text.length < 50 || ratio > 0.15 || /^\s*(function|var |const |let |if\(|@media|\.css|document\.|window\.)/.test(text);
}

async function fetchHtml(url) {
  let currentUrl = url;
  for (let i = 0; i < 6; i++) {
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
    return { html: await resp.text(), url: currentUrl, ok: resp.ok };
  }
  return null;
}

// ====== 閫氱敤 HTML 瑙ｆ瀽鍣?======
function parseBookList(html, baseHost) {
  const results = [];
  const seen = new Set();

  // 灏濊瘯澶氱甯歌鐨勪功绫嶅垪琛?HTML 缁撴瀯
  const patterns = [
    // 缁撴瀯1: result-item 椋庢牸
    { 
      itemRx: /<div[^>]*class="[^"]*result-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>\s*){0,2}(?=<div[^>]*class="[^"]*result-item|$)/g,
      extract: (block) => {
        const a = block.match(/<a[^>]*href="([^"]+)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/);
        if (!a) return null;
        const title = (a[2] || a[3]?.replace(/<[^>]+>/g, '').trim() || '');
        const url = a[1];
        const author = (block.match(/<span[^>]*>([^<]{1,40})<\/span>/) || ['',''])[1];
        const cover = (block.match(/<img[^>]*src="([^"]+\.(?:jpg|png|webp|jpeg))"/i) || ['',''])[1];
        const intro = (block.match(/<p[^>]*class="[^"]*(?:desc|intro)[^"]*"[^>]*>([^<]*)<\/p>/) || ['',''])[1];
        return { title: title.trim(), author: author.trim(), cover: cover || '', intro: (intro || '').substring(0, 100), url };
      }
    },
    // 缁撴瀯2: dl/dt 椋庢牸
    {
      itemRx: /<dt>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/dt>/g,
      extract: (m) => ({ title: m[2].trim(), author: '', cover: '', intro: '', url: m[1] })
    },
    // 缁撴瀯3: li 鍒楄〃椋庢牸
    {
      itemRx: /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/li>/g,
      extract: (m) => ({ title: m[2].trim(), author: '', cover: '', intro: '', url: m[1] })
    }
  ];

  for (const pat of patterns) {
    let m;
    const rx = typeof pat.itemRx === 'object' ? pat.itemRx : new RegExp(pat.itemRx.source, pat.itemRx.flags);
    while ((m = rx.exec(html)) !== null) {
      const book = typeof pat.extract === 'function' 
        ? pat.extract(m[1] !== undefined ? m[1] : m)
        : pat.extract(m);
      if (!book || !book.title || !book.url || seen.has(book.url)) continue;
      book.url = book.url.startsWith('http') ? book.url : `https://${baseHost}${book.url}`;
      seen.add(book.url);
      results.push(book);
      if (results.length >= 30) break;
    }
    if (results.length > 0) break;
  }

  return results;
}

function parseBookDetail(html, baseUrl) {
  const u = new URL(baseUrl);
  const host = u.hostname;
  
  // 涔﹀悕
  let title = '';
  const t1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  if (t1) title = cleanHtml(t1[1]);
  if (!title) {
    const t2 = html.match(/<title>([^<]*)<\/title>/);
    if (t2) title = t2[1].replace(/[-_|].*$/, '').trim();
  }
  
  // 浣滆€?  let author = '';
  const a1 = html.match(/(?:浣滆€厊钁?[锛?]\s*([^<>\n]{1,40})/);
  if (a1) author = a1[1].trim();
  
  // 灏侀潰
  const cover = (html.match(/<img[^>]*src="([^"]+\.(?:jpg|png|webp|jpeg))"/i) || ['',''])[1];
  
  // 绠€浠?  let intro = '';
  const introBlocks = [
    html.match(/id="intro"[^>]*>([\s\S]*?)<\/div>/),
    html.match(/class="intro"[^>]*>([\s\S]*?)<\/div>/),
    html.match(/name="description"\s+content="([^"]+)"/)
  ];
  for (const b of introBlocks) {
    if (b && b[1]) { intro = cleanHtml(b[1]).substring(0, 300); break; }
  }
  
  // 绔犺妭鍒楄〃 - 灏濊瘯澶氱缁撴瀯
  const chapters = [];
  const chapterPatterns = [
    /id="list"[\s\S]*?<\/div>/,
    /class="[^"]*chapter[^"]*"[\s\S]*?<\/div>/,
    /<dl[^>]*>[\s\S]*?<\/dl>/,
    /<div[^>]*id="[^"]*catalog[^"]*"[\s\S]*?<\/div>/
  ];
  
  for (const cp of chapterPatterns) {
    const block = html.match(cp);
    if (!block) continue;
    const chRx = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let cm;
    while ((cm = chRx.exec(block[0])) !== null) {
      const chTitle = cleanHtml(cm[2]);
      if (chTitle.length < 2) continue;
      chapters.push({
        title: chTitle,
        url: cm[1].startsWith('http') ? cm[1] : new URL(cm[1], baseUrl).href
      });
    }
    if (chapters.length > 10) break;
    chapters.length = 0; // reset if we got too few
  }
  
  return { title: title || '鏈煡涔﹀悕', author: author || '鏈煡浣滆€?, cover: cover || '', intro: intro || '', chapters };
}

function parseChapterContent(html) {
  // 灏濊瘯鎵惧埌鍐呭鍧楋紙澶氱鍙兘鐨?id/class锛?  const contentPatterns = [
    /id="content"[^>]*>([\s\S]*?)<\/div>/,
    /id="contents"[^>]*>([\s\S]*?)<\/div>/,
    /id="chaptercontent"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*txt[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    /id="TextContent"[^>]*>([\s\S]*?)<\/div>/,
  ];
  
  for (const pat of contentPatterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      const content = cleanHtml(m[1]);
      if (!looksLikeGarbage(content) && content.length > 50) return content;
    }
  }
  
  // 鏈€鍚庣殑灏濊瘯锛氬彇 body 鏂囨湰
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (bodyMatch) {
    const content = cleanHtml(bodyMatch[1]);
    // 灏濊瘯浠?body 涓彁鍙栨鏂囷紙閫氬父姝ｆ枃鍦ㄤ腑闂翠綅缃紝澶ч噺涓枃锛?    const lines = content.split('\n').filter(l => {
      const cn = (l.match(/[\u4e00-\u9fff]/g) || []).length;
      return cn > 10 && l.length > 20 && !looksLikeGarbage(l);
    });
    if (lines.length > 0) return lines.join('\n\n');
  }
  
  return '';
}

// ====== 涔︽簮閫傞厤 ======
const SEARCH_HOSTS = [
  { host: 'www.biquge.info', path: '/search.php?keyword=' },
  { host: 'www.biqugeu.net', path: '/search.php?keyword=' },
  { host: 'www.ibiquge.net', path: '/search.php?keyword=' },
];

const HOT_HOSTS = [
  'www.biquge.info',
  'www.biqugeu.net',
  'www.ibiquge.net',
];

async function searchBooks(keyword) {
  for (const sh of SEARCH_HOSTS) {
    try {
      const url = `https://${sh.host}${sh.path}${encodeURIComponent(keyword)}`;
      const result = await fetchHtml(url);
      if (!result || !result.ok) continue;
      const books = parseBookList(result.html, sh.host);
      if (books.length > 0) return books;
    } catch(e) { continue; }
  }
  return [];
}

async function getBookDetail(bookUrl) {
  const result = await fetchHtml(bookUrl);
  if (!result) throw new Error('鏃犳硶鍔犺浇');
  const detail = parseBookDetail(result.html, bookUrl);
  return detail;
}

async function getChapterContent(chapterUrl) {
  const result = await fetchHtml(chapterUrl);
  if (!result) throw new Error('鏃犳硶鍔犺浇');
  const content = parseChapterContent(result.html);
  if (!content) throw new Error('瑙ｆ瀽澶辫触');
  return { content };
}

async function getHotBooks() {
  for (const host of HOT_HOSTS) {
    try {
      const result = await fetchHtml(`https://${host}/`);
      if (!result || !result.ok) continue;
      const books = parseBookList(result.html, host);
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
