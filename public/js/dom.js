export const $ = id => document.getElementById(id);

export function setHint(text) { $('hint').textContent = text; }

let toastTimer;
export function toast(text) {
  setHint(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setHint('● Плеер готов к запуску'), 2600);
}

// Small popup at the bottom of the screen (e.g. after copying the invite link).
let popupTimer;
export function showPopup({ title, detail = '', value = '', error = false }) {
  let el = $('popup');
  if (!el) {
    el = document.createElement('div');
    el.id = 'popup'; el.className = 'popup'; el.setAttribute('role', 'status');
    el.innerHTML = '<div class="popup-icon"></div><div class="popup-body"><strong></strong><span></span><code></code></div>';
    el.onclick = () => el.classList.remove('show');
    document.body.append(el);
  }
  el.classList.toggle('error', error);
  el.querySelector('.popup-icon').textContent = error ? '!' : '✓';
  el.querySelector('strong').textContent = title;
  el.querySelector('span').textContent = detail;
  el.querySelector('code').textContent = value;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation when shown again
  el.classList.add('show');
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => el.classList.remove('show'), error ? 8000 : 3000);
}

export function showError(message) {
  const box = $('error');
  box.textContent = message;
  box.hidden = false;
}

// Loads a third-party script once, only when it is actually needed.
const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = resolve;
      el.onerror = () => { scripts.delete(src); el.remove(); reject(new Error(`Failed to load ${src}`)); };
      document.head.append(el);
    }));
  }
  return scripts.get(src);
}
