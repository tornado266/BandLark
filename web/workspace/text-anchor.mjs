// Report anchors are offsets into the unchanged UTF-16 browser string. Only the
// search copy is normalized; expansions/composed characters retain raw ranges.
const whitespace = /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const typography = (value) => value.replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"').replace(/[‐‑‒–—]/gu, '-');
export const normalizeAnchorText = (value) => typography(String(value ?? '').normalize('NFKC').toLowerCase())
  .replace(/[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu, ' ').replace(/^ +| +$/gu, '');

const shaConstants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));

// Synchronous because both screen and print renderers are synchronous. This is
// a source-identity check, never an authentication or authorization primitive.
export function sourceTextSha256(value) {
  const input = new TextEncoder().encode(String(value ?? ''));
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64);
  bytes.set(input); bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(bytes.length - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(bytes.length - 4, (input.length * 8) >>> 0);
  const hash = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15], b = words[i - 2];
      words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10));
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + shaConstants[i] + words[i]) | 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + first) | 0; d = c; c = b; b = a; a = (first + second) | 0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, i) => { hash[i] = (hash[i] + value) | 0; });
  }
  return hash.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

function normalizedMap(text) {
  const segments = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', {granularity: 'grapheme'}).segment(text)]
    : [...text.matchAll(/\P{M}\p{M}*|\p{M}+/gu)].map(match => ({segment: match[0], index: match.index}));
  let compatible = '';
  const rawRanges = [];
  for (const {segment, index} of segments) {
    const normalized = segment.normalize('NFKC');
    compatible += normalized;
    for (let i = 0; i < normalized.length; i++) rawRanges.push([index, index + segment.length]);
  }
  // Lowercase the complete string so contextual forms (e.g. final sigma) have
  // the same result as the server. A character's expansion supplies the map.
  const lower = compatible.toLowerCase(), lowerRanges = [];
  let cursor = 0;
  for (const character of compatible) {
    const range = rawRanges[cursor];
    for (let i = 0; i < character.toLowerCase().length; i++) lowerRanges.push(range);
    cursor += character.length;
  }
  let normalized = '';
  const ranges = [];
  for (let i = 0; i < lower.length; i++) {
    const character = typography(lower[i]), range = lowerRanges[i];
    if (whitespace.test(character)) {
      if (!normalized.length) continue;
      if (normalized.endsWith(' ')) ranges[ranges.length - 1] = [ranges[ranges.length - 1][0], range[1]];
      else { normalized += ' '; ranges.push([...range]); }
    } else { normalized += character; ranges.push(range); }
  }
  if (normalized.endsWith(' ')) { normalized = normalized.slice(0, -1); ranges.pop(); }
  return {normalized, ranges};
}

const isBoundary = (text, position) => !(position > 0 && position < text.length
  && /[\uD800-\uDBFF]/u.test(text[position - 1]) && /[\uDC00-\uDFFF]/u.test(text[position]));

export function createTextAnchorIndex(value) {
  const text = String(value ?? ''), map = normalizedMap(text), cache = new Map();
  let digest;
  const matches = (quote) => {
    const needle = normalizeAnchorText(quote);
    if (!needle) return [];
    if (cache.has(needle)) return cache.get(needle).map(range => [...range]);
    const found = [];
    for (let offset = map.normalized.indexOf(needle); offset !== -1; offset = map.normalized.indexOf(needle, offset + 1)) {
      const start = map.ranges[offset][0], end = map.ranges[offset + needle.length - 1][1];
      // A partial expansion (e.g. "f" inside the single glyph "ﬀ") has no
      // faithful raw substring, so it cannot become a fabricated highlight.
      if (normalizeAnchorText(text.slice(start, end)) !== needle) continue;
      if (!found.some(range => range[0] === start && range[1] === end)) found.push([start, end]);
    }
    cache.set(needle, found);
    return found.map(range => [...range]);
  };
  const sourceSha256 = () => digest ??= sourceTextSha256(text);
  const resolve = (quote, anchor) => {
    if (anchor !== null && anchor !== undefined) {
      if (typeof anchor !== 'object' || Array.isArray(anchor) || anchor.version !== 1 || anchor.source_sha256 !== sourceSha256()) return null;
      const start = anchor.start_utf16, end = anchor.end_utf16;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length
        || !isBoundary(text, start) || !isBoundary(text, end)) return null;
      const needle = normalizeAnchorText(quote);
      return needle && normalizeAnchorText(text.slice(start, end)) === needle ? [start, end] : null;
    }
    const found = matches(quote);
    return found.length === 1 ? found[0] : null;
  };
  return {text, matches, resolve, get sourceSha256() { return sourceSha256(); }};
}

export const findTextRanges = (text, quote) => createTextAnchorIndex(text).matches(quote);
