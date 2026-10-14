export const $ = id => document.getElementById(id);

export function setHint(text) { $('hint').textContent = text; }

let toastTimer;
export function toast(text) {
  setHint(text);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setHint('● Плеер готов к запуску'), 2600);
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
