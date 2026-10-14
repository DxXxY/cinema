// Converts regular VK / YouTube / Twitch links into embeddable player URLs.
export function isVkEmbedUrl(raw) {
  try {
    const u = new URL(raw);
    return /(^|\.)vk\.com$|(^|\.)vkvideo\.ru$|(^|\.)vk\.ru$/i.test(u.hostname) && /video_ext\.php/i.test(u.pathname);
  } catch { return false; }
}

export function makeEmbedUrl(raw) {
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;
  const currentHost = location.hostname || 'localhost';

  // YouTube: watch, youtu.be, Shorts and already-embedded links.
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host)) {
    let id = '';
    if (host === 'youtu.be') id = path.split('/').filter(Boolean)[0] || '';
    else if (path.startsWith('/embed/')) id = path.split('/')[2] || '';
    else if (path.startsWith('/shorts/')) id = path.split('/')[2] || '';
    else id = u.searchParams.get('v') || '';
    if (id && /^[\w-]{6,}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?enablejsapi=1`;
  }

  // Twitch channel, VOD, and clips. Twitch requires the current host in parent.
  if (['twitch.tv', 'm.twitch.tv', 'clips.twitch.tv'].includes(host)) {
    const parts = path.split('/').filter(Boolean);
    const params = new URLSearchParams(); params.set('parent', currentHost);
    if (host === 'clips.twitch.tv') { const slug = parts[0]; if (slug) return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&parent=${encodeURIComponent(currentHost)}`; }
    if (parts[0] === 'videos' && parts[1]) { params.set('video', `v${parts[1]}`); params.set('autoplay', 'false'); return `https://player.twitch.tv/?${params.toString()}`; }
    if (parts[0] === 'clip' && parts[1]) return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(parts[1])}&parent=${encodeURIComponent(currentHost)}`;
    if (parts[0] && !['directory', 'downloads', 'settings', 'p', 'turbo'].includes(parts[0])) { params.set('channel', parts[0]); params.set('autoplay', 'false'); return `https://player.twitch.tv/?${params.toString()}`; }
  }

  // VK: support video pages, shared ?z=video... URLs, and official video_ext URLs.
  if (['vk.com', 'vkvideo.ru', 'm.vk.com', 'vk.ru', 'm.vk.ru'].includes(host)) {
    if (/video_ext\.php$/i.test(path)) {
      u.searchParams.set('js_api', '1');
      return u.toString();
    }
    const matchPath = path.match(/video(-?\d+)_(\d+)/i);
    const matchZ = (u.searchParams.get('z') || '').match(/video(-?\d+)_(\d+)/i);
    const matchQuery = `${u.searchParams.get('oid') || ''}_${u.searchParams.get('id') || ''}`.match(/^(-?\d+)_(\d+)$/);
    const match = matchPath || matchZ || matchQuery;
    if (match) {
      const params = new URLSearchParams({ oid: match[1], id: match[2] });
      // hash must come from VK's Share -> Embed code when the video requires it.
      const hash = u.searchParams.get('hash');
      if (hash) params.set('hash', hash);
      if (u.searchParams.get('hd')) params.set('hd', u.searchParams.get('hd'));
      params.set('js_api', '1');
      return `https://vkvideo.ru/video_ext.php?${params.toString()}`;
    }
  }
  // Accept an embed URL from another service unchanged.
  return raw;
}
