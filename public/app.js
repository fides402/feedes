'use strict';

// ============================================================
//  PULSE — Personal Feed  |  app.js
// ============================================================

// ---- CONFIG ------------------------------------------------
const CONFIG = {
  DISCOGS_TOKEN: 'fvYYQHvhAEHVshXGPHYtbAWSlTUNQpnNJcBBbYCB',
  TMDB_KEY: '85395f1f04d886e7ad3581f64d886026',

  YT_CHANNELS: [
    { name: 'Andra Navarro',        handle: '@andrenavarroII' },
    { name: 'Oleg Samples',         handle: '@oleg_samples' },
    { name: 'Libraries Soundtracks',handle: '@librariessountracksandrelated' },
    { name: 'Vinyle Archéologie',   handle: '@VinyleArcheologie' },
    { name: 'Music For Empty Rooms',handle: '@Musicforemptyrooms' },
    { name: 'Ruvido Show',          handle: '@Ruvido_show' },
  ],

  RSS_FEEDS: [
    { name: 'Music Aficionado', url: 'https://musicaficionado.blog/feed/', cat: 'web' },
    { name: 'AudioZ',           url: 'https://audioz.download/rss.xml',   cat: 'web', filter: item => !/request/i.test(item.title) },
  ],

  // Music discovery RSS feeds (incl. rap ita/usa + taste-matching)
  MUSIC_NEWS_FEEDS: [
    { name: 'Pitchfork Reviews',  url: 'https://pitchfork.com/rss/reviews/albums/',           cat: 'newmusic' },
    { name: 'Bandcamp Daily',     url: 'https://daily.bandcamp.com/feed',                     cat: 'newmusic' },
    { name: 'HipHopDX',          url: 'https://hiphopdx.com/rss',                             cat: 'newmusic' },
    { name: 'DJBooth',            url: 'https://djbooth.net/rss',                              cat: 'newmusic' },
    { name: 'Okayplayer',         url: 'https://www.okayplayer.com/feed',                     cat: 'newmusic' },
    { name: 'FACT Mag',           url: 'https://www.factmag.com/feed/',                       cat: 'newmusic' },
    { name: 'Rapologia (IT)',     url: 'https://www.rapologia.it/feed/',                       cat: 'newmusic' },
    { name: 'Bpm Magazine (IT)',  url: 'https://www.bpmmagazine.it/feed/',                    cat: 'newmusic' },
  ],

  // Discogs taste profile derived from liked.csv analysis
  // (Italian/Spanish/Latin 70s pop, Bossa, Soul, French pop, MPB)
  DISCOGS_STYLES: ['Bossa Nova', 'Soul', 'Chanson', 'MPB', 'Funk', 'Jazz', 'Latin', 'Exotica', 'Samba', 'Italian Pop'],

  // New releases — recent year filter on Discogs
  NEW_MUSIC_STYLES: ['Hip Hop', 'Boom Bap', 'Conscious', 'Abstract', 'Soul', 'Bossa Nova', 'MPB'],

  PROXY: '/api/proxy?url=',
};

// ---- STATE -------------------------------------------------
let allItems     = [];
let currentCat   = 'all';

const getDismissed = () => new Set(JSON.parse(localStorage.getItem('dismissed') || '[]'));
function dismissItem(link) {
  const d = getDismissed(); d.add(link);
  localStorage.setItem('dismissed', JSON.stringify([...d]));
  allItems = allItems.filter(i => i.link !== link);
  renderFeed();
}

// ---- DOM refs ----------------------------------------------
const feedEl       = document.getElementById('feed');
const loadingEl    = document.getElementById('loading-state');
const refreshBtn   = document.getElementById('refresh-btn');
const openPanelBtn = document.getElementById('open-panel-btn');
const closePanelBtn= document.getElementById('close-panel-btn');
const panelOverlay = document.getElementById('panel-overlay');
const panel        = document.getElementById('sources-panel');
const catBtns      = document.querySelectorAll('.cat-btn');
const panelTabs    = document.querySelectorAll('.ptab');

// ============================================================
//  PROXY & FETCH UTILS
// ============================================================
async function proxyFetch(url) {
  try {
    const r = await fetch(`${CONFIG.PROXY}${encodeURIComponent(url)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    console.warn(`proxyFetch failed: ${url}`, e.message);
    return null;
  }
}

async function apiGet(url, headers = {}) {
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn(`apiGet failed: ${url}`, e.message);
    return null;
  }
}

// ============================================================
//  RSS PARSER
// ============================================================
function parseRSS(xml, sourceName, cat = 'web') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return [];

  const isAtom = !!doc.querySelector('feed');
  const items = [];
  const els = doc.querySelectorAll(isAtom ? 'entry' : 'item');

  els.forEach((el, i) => {
    if (i >= 10) return;
    const title = el.querySelector('title')?.textContent?.trim();
    const link  = isAtom
      ? (el.querySelector('link[rel="alternate"]')?.getAttribute('href') || el.querySelector('link')?.getAttribute('href') || el.querySelector('link')?.textContent?.trim())
      : el.querySelector('link')?.textContent?.trim();
    const date  = el.querySelector(isAtom ? 'published,updated' : 'pubDate')?.textContent;
    const desc  = el.querySelector(isAtom ? 'summary,content' : 'description,content\\:encoded')?.textContent;
    const img   = el.querySelector('enclosure[type^="image"]')?.getAttribute('url')
                || el.querySelector('thumbnail')?.getAttribute('url')
                || extractImgFromHTML(desc);

    if (title && link) {
      items.push({
        type: cat,
        source: sourceName,
        title,
        link,
        date: parseDate(date),
        snippet: stripHTML(desc).slice(0, 160),
        image: img,
        id: `${cat}-${sourceName}-${i}`,
      });
    }
  });
  return items;
}

function extractImgFromHTML(html) {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function stripHTML(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function parseDate(str) {
  if (!str) return new Date(0).toISOString();
  const d = new Date(str);
  return isNaN(d) ? new Date(0).toISOString() : d.toISOString();
}

// ============================================================
//  YOUTUBE
// ============================================================
async function fetchYoutube() {
  const cachedIds = JSON.parse(localStorage.getItem('yt_ids') || '{}');
  const customYT  = JSON.parse(localStorage.getItem('custom_youtube') || '[]');
  const channels  = [...CONFIG.YT_CHANNELS, ...customYT];

  // Resolve all handles in parallel, then fetch all RSS feeds in parallel
  const resolved = await Promise.all(channels.map(async (ch) => {
    let channelId = cachedIds[ch.handle];
    if (!channelId) {
      channelId = await resolveYTHandle(ch.handle);
      if (channelId) cachedIds[ch.handle] = channelId;
    }
    return { ...ch, channelId };
  }));
  localStorage.setItem('yt_ids', JSON.stringify(cachedIds));

  const feeds = await Promise.all(
    resolved.filter(ch => ch.channelId).map(async (ch) => {
      const xml = await proxyFetch(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channelId}`
      );
      if (!xml) return [];
      const doc     = new DOMParser().parseFromString(xml, 'application/xml');
      const entries = doc.querySelectorAll('entry');
      const items   = [];
      entries.forEach((entry, i) => {
        if (i >= 5) return;
        const rawId   = entry.querySelector('id')?.textContent || '';
        const videoId = rawId.replace('yt:video:', '').trim();
        const link    = entry.querySelector('link')?.getAttribute('href') || '';
        const vid     = videoId || link.match(/v=([^&]+)/)?.[1];
        const title   = entry.querySelector('title')?.textContent?.trim();
        const date    = entry.querySelector('published')?.textContent;
        if (vid && title) items.push({
          type: 'youtube', channel: ch.name, title, videoId: vid,
          thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`,
          date: parseDate(date), link: `https://www.youtube.com/watch?v=${vid}`,
          id: `yt-${vid}`,
        });
      });
      return items;
    })
  );

  return feeds.flat().sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function resolveYTHandle(handle) {
  const html = await proxyFetch(`https://www.youtube.com/${handle}`);
  if (!html) return null;
  const m = html.match(/"channelId":"(UC[^"]+)"/);
  return m ? m[1] : null;
}

// ============================================================
//  RSS FEEDS (web & music news)
// ============================================================
async function fetchRSSFeeds() {
  const customRSS = JSON.parse(localStorage.getItem('custom_rss') || '[]');
  const allFeeds  = [...CONFIG.RSS_FEEDS, ...customRSS, ...CONFIG.MUSIC_NEWS_FEEDS];
  const items     = [];

  const fetches = allFeeds.map(async (feed) => {
    const xml = await proxyFetch(feed.url);
    if (!xml) return;
    let parsed = parseRSS(xml, feed.name, feed.cat || 'web');
    if (feed.filter) parsed = parsed.filter(feed.filter);
    items.push(...parsed);
  });

  await Promise.allSettled(fetches);
  return items.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ============================================================
//  TMDB — Film & Serie
// ============================================================
async function fetchMovies() {
  const base = 'https://api.themoviedb.org/3';
  const key  = CONFIG.TMDB_KEY;
  const [mov, tv] = await Promise.all([
    apiGet(`${base}/trending/movie/week?api_key=${key}&language=it-IT`),
    apiGet(`${base}/trending/tv/week?api_key=${key}&language=it-IT`),
  ]);

  const items = [];
  (mov?.results || []).slice(0, 12).forEach(m => items.push({
    type: 'movie',
    mediaType: 'Film',
    title: m.title,
    overview: m.overview?.slice(0, 200),
    date: parseDate(m.release_date),
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
    rating: Math.round(m.vote_average * 10) / 10,
    link: `https://www.themoviedb.org/movie/${m.id}`,
    id: `movie-${m.id}`,
  }));
  (tv?.results || []).slice(0, 10).forEach(t => items.push({
    type: 'movie',
    mediaType: 'Serie TV',
    title: t.name,
    overview: t.overview?.slice(0, 200),
    date: parseDate(t.first_air_date),
    poster: t.poster_path ? `https://image.tmdb.org/t/p/w300${t.poster_path}` : null,
    rating: Math.round(t.vote_average * 10) / 10,
    link: `https://www.themoviedb.org/tv/${t.id}`,
    id: `tv-${t.id}`,
  }));

  return items.sort((a, b) => b.rating - a.rating);
}

// ============================================================
//  DISCOGS — Raccomandazioni per gusto
// ============================================================
async function fetchDiscogs() {
  const cached = sessionStorage.getItem('discogs_rare');
  if (cached) return JSON.parse(cached);

  const headers = {
    'Authorization': `Discogs token=${CONFIG.DISCOGS_TOKEN}`,
    'User-Agent': 'PulseFeed/1.0',
  };
  const items = [];
  const seen  = new Set();

  // Sort by have ascending (fewest copies in collections = rarest)
  // Keep records with have 5–500 and want > 5 (desired but hard to find)
  for (const style of CONFIG.DISCOGS_STYLES.slice(0, 6)) {
    const data = await apiGet(
      `https://api.discogs.com/database/search?style=${encodeURIComponent(style)}&sort=have&sort_order=asc&per_page=25&format=Vinyl`,
      headers
    );
    await sleep(600);
    for (const r of (data?.results || [])) {
      if (seen.has(r.id)) continue;
      const have = r.community?.have || 0;
      const want = r.community?.want || 0;
      // Rare: few owners (5–500), at least a handful of people want it
      if (have < 5 || have > 500 || want < 5) continue;
      seen.add(r.id);
      const cover = r.cover_image;
      if (cover?.includes('spacer')) continue;
      items.push({
        type:  'discogs',
        title: r.title,
        year:  r.year,
        style,
        cover: cover || null,
        link:  `https://www.discogs.com${r.uri}`,
        want,
        have,
        id:    `discogs-${r.id}`,
      });
    }
  }

  sessionStorage.setItem('discogs_rare', JSON.stringify(items));
  return items;
}

// ============================================================
//  DISCOGS — Nuove Uscite musicali per gusto
// ============================================================
async function fetchNewMusic() {
  const cached = sessionStorage.getItem('newmusic');
  if (cached) return JSON.parse(cached);

  const headers = {
    'Authorization': `Discogs token=${CONFIG.DISCOGS_TOKEN}`,
    'User-Agent': 'PulseFeed/1.0',
  };
  const items = [];
  const seen  = new Set();
  const curYear = new Date().getFullYear();
  const lastYear = curYear - 1;

  for (const style of CONFIG.NEW_MUSIC_STYLES.slice(0, 4)) {
    const data = await apiGet(
      `https://api.discogs.com/database/search?style=${encodeURIComponent(style)}&year=${lastYear}-${curYear}&sort=year&sort_order=desc&per_page=8`,
      headers
    );
    await sleep(600);
    for (const r of (data?.results || [])) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      if (r.cover_image?.includes('spacer')) continue;
      items.push({
        type: 'newmusic',
        title: r.title,
        year: r.year,
        style,
        cover: r.cover_image || null,
        link: `https://www.discogs.com${r.uri}`,
        want: r.community?.want || 0,
        id: `nm-${r.id}`,
      });
    }
  }

  sessionStorage.setItem('newmusic', JSON.stringify(items));
  return items;
}

// ============================================================
//  GITHUB — Trending repos
// ============================================================
async function fetchGithub() {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().split('T')[0];
  const data = await apiGet(
    `https://api.github.com/search/repositories?q=created:>${weekAgo}&sort=stars&order=desc&per_page=15`,
    { 'User-Agent': 'PulseFeed/1.0', 'Accept': 'application/vnd.github.v3+json' }
  );
  return (data?.items || []).map(r => ({
    type: 'github',
    name: r.full_name,
    description: r.description || 'No description',
    stars: r.stargazers_count,
    language: r.language,
    link: r.html_url,
    date: parseDate(r.created_at),
    topics: (r.topics || []).slice(0, 3),
    id: `gh-${r.id}`,
  }));
}

// ============================================================
//  CARD RENDERERS
// ============================================================
function dismissBtn(link) {
  return `<button class="dismiss-btn" onclick="event.preventDefault();dismissItem(${JSON.stringify(link)})" title="Nascondi">×</button>`;
}

function renderCard(item) {
  switch (item.type) {
    case 'youtube':  return renderYouTube(item);
    case 'web':      return renderWeb(item);
    case 'newmusic': return renderNewMusic(item);
    case 'movie':    return renderMovie(item);
    case 'github':   return renderGithub(item);
    case 'discogs':  return renderDiscogs(item);
    default:         return '';
  }
}

function renderYouTube(item) {
  return `
  <article class="card card-youtube" data-type="youtube">
    <div class="card-thumb" onclick="loadYTEmbed(this,'${item.videoId}')">
      <img src="${item.thumbnail}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%2260%22%3E%3Crect fill=%22%231a1a1a%22 width=%22100%25%22 height=%22100%25%22/%3E%3C/svg%3E'">
      <div class="play-btn"></div>
    </div>
    <div class="card-body">
      <span class="card-tag tag-youtube">▶ ${esc(item.channel)}</span>
      <h3 class="card-title"><a href="${item.link}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      <span class="card-date">${fmtDate(item.date)}</span>
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

function renderWeb(item) {
  const img = item.image
    ? `<div class="card-thumb" style="aspect-ratio:16/7;overflow:hidden;flex-shrink:0"><img src="${item.image}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.display='none'"></div>`
    : '';
  return `
  <article class="card" data-type="web">
    ${img}
    <div class="card-body">
      <span class="card-tag tag-web">● ${esc(item.source)}</span>
      <h3 class="card-title"><a href="${item.link}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      ${item.snippet ? `<p class="card-snippet">${esc(item.snippet)}</p>` : ''}
      <span class="card-date">${fmtDate(item.date)}</span>
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

function renderNewMusic(item) {
  const img = item.image
    ? `<div class="card-thumb" style="aspect-ratio:16/7;overflow:hidden"><img src="${item.image}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.style.display='none'"></div>`
    : '';
  return `
  <article class="card" data-type="newmusic">
    ${img}
    <div class="card-body">
      <span class="card-tag tag-newmusic">♪ ${esc(item.source)}</span>
      <h3 class="card-title"><a href="${item.link}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      ${item.snippet ? `<p class="card-snippet">${esc(item.snippet)}</p>` : ''}
      <span class="card-date">${fmtDate(item.date)}</span>
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

function renderMovie(item) {
  const poster = item.poster
    ? `<img src="${item.poster}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">`
    : `<div class="no-poster">🎬</div>`;
  return `
  <article class="card card-poster-row" data-type="movie">
    <div class="card-poster" style="height:150px">${poster}</div>
    <div class="card-body">
      <span class="card-tag tag-movie">${esc(item.mediaType)}</span>
      <h3 class="card-title">${esc(item.title)}</h3>
      <div class="card-meta">
        <span class="rating">★ ${item.rating}</span>
        <span class="card-date">${item.date?.slice(0,4) || ''}</span>
      </div>
      ${item.overview ? `<p class="card-snippet">${esc(item.overview)}</p>` : ''}
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

function renderGithub(item) {
  const topics = (item.topics || []).map(t => `<span class="topic">${esc(t)}</span>`).join('');
  return `
  <article class="card card-github" data-type="github">
    <div class="card-body">
      <span class="card-tag tag-github">⚡ GitHub</span>
      <h3 class="card-title"><a href="${item.link}" target="_blank" rel="noopener">${esc(item.name)}</a></h3>
      <p class="card-snippet">${esc(item.description)}</p>
      <div class="card-meta">
        <span class="stars">★ ${item.stars.toLocaleString()}</span>
        ${item.language ? `<span class="lang">${esc(item.language)}</span>` : ''}
        <span class="card-date">${fmtDate(item.date)}</span>
      </div>
      ${topics ? `<div class="topics">${topics}</div>` : ''}
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

function renderDiscogs(item) {
  const cover = item.cover
    ? `<img src="${item.cover}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<div class=no-disc>♪</div>'">`
    : `<div class="no-disc">♪</div>`;
  return `
  <article class="card" data-type="discogs">
    <div class="card-disc-thumb">${cover}</div>
    <div class="card-body">
      <span class="card-tag tag-discogs">♪ ${esc(item.style)}</span>
      <h3 class="card-title"><a href="${item.link}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      <div class="card-meta">
        ${item.year ? `<span>${item.year}</span>` : ''}
        <span class="want">♥ ${item.want}</span>
      </div>
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

function renderNewMusicDiscogs(item) {
  const cover = item.cover
    ? `<img src="${item.cover}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<div class=no-disc>♪</div>'">`
    : `<div class="no-disc">♪</div>`;
  return `
  <article class="card" data-type="newmusic">
    <div class="card-disc-thumb">${cover}</div>
    <div class="card-body">
      <span class="card-tag tag-newmusic">🆕 ${esc(item.style)}</span>
      <h3 class="card-title"><a href="${item.link}" target="_blank" rel="noopener">${esc(item.title)}</a></h3>
      <div class="card-meta">
        ${item.year ? `<span>${item.year}</span>` : ''}
        <span class="want">♥ ${item.want}</span>
      </div>
      ${dismissBtn(item.link)}
    </div>
  </article>`;
}

// YouTube embed on click
function loadYTEmbed(el, videoId) {
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  el.innerHTML = '';
  el.appendChild(iframe);
}

// ============================================================
//  RENDER FEED
// ============================================================
function updateTabCounts() {
  const counts = {};
  allItems.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
  counts['all'] = allItems.length;
  catBtns.forEach(btn => {
    const cat = btn.dataset.cat;
    const n   = counts[cat] || 0;
    // remove existing badge
    btn.querySelector('.tab-count')?.remove();
    if (n > 0) {
      const badge = document.createElement('span');
      badge.className = 'tab-count';
      badge.textContent = n;
      btn.appendChild(badge);
    }
  });
}

function renderFeed() {
  updateTabCounts();

  const dismissed = getDismissed();
  const items = (currentCat === 'all' ? allItems : allItems.filter(i => i.type === currentCat))
    .filter(i => !dismissed.has(i.link));

  if (items.length === 0) {
    feedEl.innerHTML = `<div class="empty-state"><p>Nessun contenuto${currentCat !== 'all' ? ' in questa categoria' : ''}.</p></div>`;
    return;
  }

  // Group by type for section headings
  const typeOrder = ['youtube','newmusic','web','discogs','movie','github'];
  const grouped   = {};
  items.forEach(it => { (grouped[it.type] = grouped[it.type] || []).push(it); });

  let html = '';
  if (currentCat === 'all') {
    typeOrder.forEach(type => {
      const group = grouped[type];
      if (!group?.length) return;
      const labels = { youtube:'Video', web:'Blog & Notizie', newmusic:'Nuove Uscite Musicali', discogs:'Rarità Consigliate', movie:'Film & Serie', github:'GitHub Trending' };
      html += `<div class="section-heading">${labels[type] || type}</div>`;
      group.forEach(item => {
        html += type === 'newmusic' && item.cover && !item.image
          ? renderNewMusicDiscogs(item)
          : renderCard(item);
      });
    });
  } else {
    items.forEach(item => {
      html += currentCat === 'newmusic' && item.cover && !item.image
        ? renderNewMusicDiscogs(item)
        : renderCard(item);
    });
  }

  feedEl.innerHTML = html;
}

// ============================================================
//  INIT — LOAD ALL
// ============================================================
async function loadAll() {
  feedEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Caricamento feed...</p></div>';
  refreshBtn.querySelector('svg').classList.add('spinning');

  try {
    const results = await Promise.allSettled([
      fetchYoutube(),
      fetchRSSFeeds(),
      fetchMovies(),
      fetchGithub(),
      fetchDiscogs(),
      fetchNewMusic(),
    ]);

    allItems = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  } catch (e) {
    console.error('loadAll error:', e);
  }

  refreshBtn.querySelector('svg').classList.remove('spinning');
  renderFeed();
}

// ============================================================
//  ADD SOURCES PANEL
// ============================================================
function openPanel() {
  panel.classList.add('open');
  panelOverlay.classList.add('visible');
  renderSourcesList();
}

function closePanel() {
  panel.classList.remove('open');
  panelOverlay.classList.remove('visible');
}

function setFeedback(id, msg, type = 'ok') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `panel-feedback ${type}`;
  if (type === 'ok') setTimeout(() => { el.textContent = ''; }, 3000);
}

async function addYouTubeChannel() {
  const input = document.getElementById('yt-url-input');
  const btn   = document.getElementById('add-yt-btn');
  const url   = input.value.trim();
  if (!url) { setFeedback('yt-feedback', 'Inserisci un URL', 'err'); return; }

  const handleMatch = url.match(/@([\w.-]+)/);
  if (!handleMatch) { setFeedback('yt-feedback', 'URL non valido. Usa https://youtube.com/@canale', 'err'); return; }

  const handle = `@${handleMatch[1]}`;
  const custom = JSON.parse(localStorage.getItem('custom_youtube') || '[]');
  if (custom.some(c => c.handle === handle) || CONFIG.YT_CHANNELS.some(c => c.handle === handle)) {
    setFeedback('yt-feedback', 'Canale già presente', 'err'); return;
  }

  btn.disabled = true;
  btn.textContent = 'Risoluzione...';
  setFeedback('yt-feedback', '');

  const channelId = await resolveYTHandle(handle);
  if (!channelId) {
    setFeedback('yt-feedback', 'Canale non trovato. Verifica l\'URL.', 'err');
    btn.disabled = false; btn.textContent = 'Aggiungi canale'; return;
  }

  // Extract channel name
  const html = await proxyFetch(`https://www.youtube.com/${handle}`);
  const nameMatch = html?.match(/"title":"([^"]+)","channelUrl"/);
  const name = nameMatch ? nameMatch[1] : handle;

  custom.push({ name, handle });
  localStorage.setItem('custom_youtube', JSON.stringify(custom));
  const ids = JSON.parse(localStorage.getItem('yt_ids') || '{}');
  ids[handle] = channelId;
  localStorage.setItem('yt_ids', JSON.stringify(ids));

  setFeedback('yt-feedback', `✓ "${name}" aggiunto`, 'ok');
  input.value = '';
  btn.disabled = false; btn.textContent = 'Aggiungi canale';
  renderSourcesList();

  // Immediately fetch and show the new channel's videos
  const feedXml = await proxyFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (feedXml) {
    const newItems = parseRSS(feedXml, name, 'youtube');
    allItems = [...newItems, ...allItems];
    renderFeed();
  }
}

async function addRSSFeed() {
  const urlInput  = document.getElementById('rss-url-input');
  const nameInput = document.getElementById('rss-name-input');
  const url  = urlInput.value.trim();
  const name = nameInput.value.trim() || new URL(url).hostname;

  if (!url) { setFeedback('rss-feedback', 'Inserisci un URL', 'err'); return; }

  const custom = JSON.parse(localStorage.getItem('custom_rss') || '[]');
  if (custom.some(f => f.url === url)) { setFeedback('rss-feedback', 'Feed già presente', 'err'); return; }

  document.getElementById('add-rss-btn').disabled = true;
  setFeedback('rss-feedback', 'Verifica feed...');

  const xml = await proxyFetch(url);
  if (!xml || xml.includes('<parsererror')) {
    setFeedback('rss-feedback', 'Feed non valido o non raggiungibile', 'err');
    document.getElementById('add-rss-btn').disabled = false; return;
  }

  custom.push({ name, url, cat: 'web' });
  localStorage.setItem('custom_rss', JSON.stringify(custom));
  setFeedback('rss-feedback', `✓ "${name}" aggiunto`, 'ok');
  urlInput.value = ''; nameInput.value = '';
  document.getElementById('add-rss-btn').disabled = false;
  renderSourcesList();

  // Immediately show the new feed's items without requiring a full refresh
  const newItems = parseRSS(xml, name, 'web');
  allItems = [...newItems, ...allItems];
  renderFeed();
}

function renderSourcesList() {
  const customYT  = JSON.parse(localStorage.getItem('custom_youtube') || '[]');
  const customRSS = JSON.parse(localStorage.getItem('custom_rss') || '[]');
  const customEl  = document.getElementById('custom-sources-list');
  const defaultEl = document.getElementById('default-sources-list');

  if (customEl) {
    if (!customYT.length && !customRSS.length) {
      customEl.innerHTML = '<p class="panel-desc" style="color:#444">Nessuna fonte personalizzata</p>';
    } else {
      customEl.innerHTML = [
        ...customYT.map((c, i) => `<div class="source-item"><span class="source-dot" style="background:var(--c-youtube)"></span><span class="source-name">${esc(c.name)}</span><span class="source-label">YouTube</span><button class="source-del" onclick="removeCustom('youtube',${i})">✕</button></div>`),
        ...customRSS.map((f, i) => `<div class="source-item"><span class="source-dot" style="background:var(--c-web)"></span><span class="source-name">${esc(f.name)}</span><span class="source-label">RSS</span><button class="source-del" onclick="removeCustom('rss',${i})">✕</button></div>`),
      ].join('');
    }
  }

  if (defaultEl) {
    defaultEl.innerHTML = [
      ...CONFIG.YT_CHANNELS.map(c => `<div class="source-item"><span class="source-dot" style="background:var(--c-youtube)"></span><span class="source-name">${esc(c.name)}</span><span class="source-label">YouTube</span></div>`),
      ...CONFIG.RSS_FEEDS.map(f => `<div class="source-item"><span class="source-dot" style="background:var(--c-web)"></span><span class="source-name">${esc(f.name)}</span><span class="source-label">RSS</span></div>`),
      ...CONFIG.MUSIC_NEWS_FEEDS.map(f => `<div class="source-item"><span class="source-dot" style="background:var(--c-newmusic)"></span><span class="source-name">${esc(f.name)}</span><span class="source-label">Musica</span></div>`),
    ].join('');
  }
}

function removeCustom(type, idx) {
  const key = type === 'youtube' ? 'custom_youtube' : 'custom_rss';
  const arr = JSON.parse(localStorage.getItem(key) || '[]');
  arr.splice(idx, 1);
  localStorage.setItem(key, JSON.stringify(arr));
  renderSourcesList();
}

// ============================================================
//  UTILS
// ============================================================
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso || iso.startsWith('1970')) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = Date.now();
  const diff = now - d;
  if (diff < 60_000)      return 'ora';
  if (diff < 3_600_000)   return `${Math.floor(diff/60_000)}m fa`;
  if (diff < 86_400_000)  return `${Math.floor(diff/3_600_000)}h fa`;
  if (diff < 604_800_000) return `${Math.floor(diff/86_400_000)}g fa`;
  return d.toLocaleDateString('it-IT', { day:'numeric', month:'short' });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
//  EVENTS
// ============================================================
function initEvents() {
  // Refresh
  refreshBtn.addEventListener('click', () => {
    sessionStorage.removeItem('discogs_rare');
    sessionStorage.removeItem('newmusic');
    loadAll();
  });

  // Panel open/close
  openPanelBtn.addEventListener('click', openPanel);
  closePanelBtn.addEventListener('click', closePanel);
  panelOverlay.addEventListener('click', closePanel);

  // Panel tab switching
  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      panelTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.panel-section').forEach(s => s.classList.add('hidden'));
      document.getElementById(`tab-${tab.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  // Category filter
  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCat = btn.dataset.cat;
      renderFeed();
    });
  });

  // Add YouTube
  document.getElementById('add-yt-btn')?.addEventListener('click', addYouTubeChannel);
  document.getElementById('yt-url-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') addYouTubeChannel(); });

  // Add RSS
  document.getElementById('add-rss-btn')?.addEventListener('click', addRSSFeed);

  // Expose globals for inline onclick handlers
  window.loadYTEmbed  = loadYTEmbed;
  window.removeCustom = removeCustom;
  window.dismissItem  = dismissItem;
}

// ============================================================
//  BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initEvents();
  loadAll();
});
