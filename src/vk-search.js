// Film search on VK Video. The official video.search method needs a user
// token, so this uses what the vkvideo.ru web app itself uses: an anonymous
// token and catalog.getVideoSearchWeb2. It is unofficial — if VK changes it,
// only the search breaks, links keep working.
// The app id and secret of the vkvideo.ru web app come from the environment
// (VK_CLIENT_ID, VK_CLIENT_SECRET on Render), not from the public repo.
const APP = { id: process.env.VK_CLIENT_ID || '', secret: process.env.VK_CLIENT_SECRET || '' };
const API = 'https://api.vk.com/method';
const VERSION = '5.274';
const HEADERS = { Origin: 'https://vkvideo.ru', Referer: 'https://vkvideo.ru/' };
const MAX_RESULTS = 12;
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_SIZE = 300;

let token = null; // { value, expiresAt }
const cache = new Map(); // query -> { at, results }

async function getToken(force = false) {
  if (!force && token && token.expiresAt - Date.now() > 5 * 60 * 1000) return token.value;
  const body = new URLSearchParams({
    client_id: APP.id,
    client_secret: APP.secret,
    scopes: 'video_anonymous',
    isApiOauthAnonymEnabled: 'false',
    version: '1',
    app_id: '6287487',
  });
  const res = await fetch('https://login.vk.com/?act=get_anonym_token', { method: 'POST', body, headers: HEADERS, signal: AbortSignal.timeout(8000) });
  const data = (await res.json())?.data;
  if (!data?.access_token) throw new Error('no anonymous token');
  token = { value: data.access_token, expiresAt: (data.expired_at || 0) * 1000 || Date.now() + 60 * 60 * 1000 };
  return token.value;
}

async function callApi(method, params, retried = false) {
  const body = new URLSearchParams({ ...params, access_token: await getToken(retried) });
  const res = await fetch(`${API}/${method}?v=${VERSION}&client_id=${APP.id}`, { method: 'POST', body, headers: HEADERS, signal: AbortSignal.timeout(10000) });
  const json = await res.json();
  if (json.error) {
    if (!retried && [5, 1114, 1116].includes(json.error.error_code)) return callApi(method, params, true); // token expired
    throw new Error(`VK ${json.error.error_code}: ${json.error.error_msg}`);
  }
  return json.response;
}

// A preview about 320px wide is enough for the suggestion list.
function pickImage(images = []) {
  const sorted = [...images].filter(i => i?.url).sort((a, b) => a.width - b.width);
  return (sorted.find(i => i.width >= 320) || sorted.at(-1))?.url || '';
}

function playerUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || !/video_ext\.php$/i.test(u.pathname)) return '';
    u.searchParams.delete('__ref');
    return u.toString();
  } catch { return ''; }
}

async function searchVkVideo(query) {
  if (!APP.id || !APP.secret) throw new Error('VK_CLIENT_ID / VK_CLIENT_SECRET are not set');
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.results;

  const r = await callApi('catalog.getVideoSearchWeb2', { q: query });
  const owners = new Map([
    ...(r.groups || []).map(g => [-g.id, g.name]),
    ...(r.profiles || []).map(p => [p.id, `${p.first_name} ${p.last_name}`]),
  ]);
  const results = [];
  const seen = new Set();
  // catalog_videos are the regular videos; r.videos are short clips.
  for (const { video: v } of r.catalog_videos || []) {
    const url = v && v.type !== 'short_video' ? playerUrl(v.player) : '';
    const id = url && `${v.owner_id}_${v.id}`;
    if (!url || seen.has(id)) continue;
    seen.add(id);
    results.push({
      title: String(v.title || 'Без названия').slice(0, 120),
      url,
      duration: v.duration || 0,
      views: v.views || 0,
      channel: owners.get(v.owner_id) || '',
      image: pickImage(v.image),
    });
    if (results.length >= MAX_RESULTS) break;
  }

  cache.set(key, { at: Date.now(), results });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return results;
}

module.exports = { searchVkVideo };
