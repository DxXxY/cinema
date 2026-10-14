// Room ids: 10 characters without look-alike letters (no 0/o, 1/l).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ALPHABET[b % 32]).join('');

export const roomPath = (id, key = '') => `/room/${encodeURIComponent(id)}${key ? `?key=${encodeURIComponent(key)}` : ''}`;
