// Film search by title: typing a name (not a link) into a link field shows
// VK Video suggestions under it. The list lives in <body> with fixed
// positioning, because the player stage and the panels clip overflow.

const DEBOUNCE_MS = 350;

export const looksLikeLink = text => /^https?:\/\//i.test(text) || /^[\w-]+(\.[\w-]+)+\/\S*$/i.test(text);

const formatDuration = s => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

const formatViews = n => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '').replace('.', ',')} млн просмотров`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} тыс. просмотров`;
  return `${n} просмотров`;
};

// Attaches suggestions to `input`; `onPick(item)` gets { title, url, ... }.
// Returns { submit } for the form: picks the highlighted (or first) result.
export function attachSearch(input, onPick) {
  const list = document.createElement('div');
  list.className = 'search-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  document.body.append(list);

  let items = [], active = -1, timer = 0, controller = null, lastQuery = '';

  const close = () => { list.hidden = true; active = -1; };

  const position = () => {
    if (list.hidden) return;
    const r = input.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 340), innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), innerWidth - width - 8);
    const below = innerHeight - r.bottom - 14, above = r.top - 14;
    const up = below < 260 && above > below;
    list.style.left = `${left}px`;
    list.style.width = `${width}px`;
    list.style.maxHeight = `${Math.min(440, up ? above : below)}px`;
    list.style.top = up ? '' : `${r.bottom + 6}px`;
    list.style.bottom = up ? `${innerHeight - r.top + 6}px` : '';
  };

  const showMessage = text => {
    items = []; active = -1;
    const note = document.createElement('div');
    note.className = 'search-note';
    note.textContent = text;
    list.replaceChildren(note);
    list.hidden = false;
    position();
  };

  const highlight = index => {
    active = index;
    [...list.querySelectorAll('.search-item')].forEach((el, i) => {
      el.classList.toggle('active', i === active);
      if (i === active) el.scrollIntoView({ block: 'nearest' });
    });
  };

  const pick = item => {
    close();
    input.value = '';
    input.blur();
    onPick(item);
  };

  const render = results => {
    items = results; active = -1;
    if (!items.length) return showMessage('Ничего не нашлось — попробуй другое название или вставь ссылку');
    const head = document.createElement('div');
    head.className = 'search-head';
    head.textContent = 'VK ВИДЕО — ВЫБЕРИ, И ФИЛЬМ ЗАПУСТИТСЯ У ВСЕХ';
    list.replaceChildren(head, ...items.map((item, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-item';
      row.setAttribute('role', 'option');
      const thumb = document.createElement('div');
      thumb.className = 'search-thumb';
      if (item.image) {
        const img = document.createElement('img');
        img.src = item.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.remove();
        thumb.append(img);
      }
      if (item.duration) {
        const time = document.createElement('span');
        time.className = 'search-duration';
        time.textContent = formatDuration(item.duration);
        thumb.append(time);
      }
      const text = document.createElement('div');
      text.className = 'search-text';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const meta = document.createElement('span');
      meta.textContent = [item.channel, item.views ? formatViews(item.views) : ''].filter(Boolean).join(' · ');
      text.append(title, meta);
      row.append(thumb, text);
      row.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input
      row.addEventListener('click', () => pick(item));
      row.addEventListener('mousemove', () => { if (active !== i) highlight(i); });
      return row;
    }));
    list.hidden = false;
    list.scrollTop = 0;
    position();
  };

  const search = async query => {
    controller?.abort();
    controller = new AbortController();
    lastQuery = query;
    if (!items.length) showMessage('Ищем…');
    list.classList.add('loading');
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (query === lastQuery && document.activeElement === input) render(data.results || []);
    } catch (err) {
      if (err.name !== 'AbortError') showMessage('Поиск сейчас не работает — вставь ссылку на видео');
    } finally {
      if (query === lastQuery) list.classList.remove('loading');
    }
  };

  const update = () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2 || looksLikeLink(query)) {
      controller?.abort(); lastQuery = ''; items = [];
      return close();
    }
    if (query === lastQuery && items.length) { list.hidden = false; return position(); }
    timer = setTimeout(() => search(query), DEBOUNCE_MS);
  };

  input.addEventListener('input', update);
  input.addEventListener('focus', update);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (list.hidden || !items.length) {
      if (e.key === 'Escape') close();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active <= 0 ? items.length - 1 : active - 1); }
    else if (e.key === 'Escape') close();
  });
  addEventListener('resize', position);
  addEventListener('scroll', position, true);

  return {
    // Called on form submit with text that is not a link.
    submit() {
      const query = input.value.trim();
      if (items.length && query === lastQuery) return pick(items[Math.max(active, 0)]);
      if (query.length < 2) return;
      input.focus(); // the submit button took focus; results show only while the field has it
      clearTimeout(timer);
      search(query);
    },
  };
}
