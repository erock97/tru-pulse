/** receipt-jcs-sha256-v1: RFC 8785 serialization, UTF-8, SHA-256.
 * Hash the submitted JSON object, not the lossy/coerced display payload. */
export const HASH_SCHEME = 'receipt-jcs-sha256-v1';
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > 100) throw new Error('JSON nesting exceeds 100');
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Unpaired surrogate');
      } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error('Unpaired surrogate');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Unsupported number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(v => canonicalJson(v, depth + 1)).join(',') + ']';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => canonicalJson(k) + ':' + canonicalJson((value as Record<string, unknown>)[k], depth + 1)).join(',') + '}';
  }
  throw new Error('Unsupported JSON value');
}
export async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Reject duplicate object keys before JSON.parse can discard them. */
export function parseReceiptJson(text: string): unknown {
  let i = 0;
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') i++;
      else if (c === '"') return JSON.parse(text.slice(start, i));
    }
    throw new Error('Unterminated string');
  };
  const visit = (depth: number) => {
    if (depth > 100) throw new Error('JSON nesting exceeds 100');
    ws();
    if (text[i] === '{') {
      i++; ws(); const keys = new Set<string>();
      if (text[i] === '}') { i++; return; }
      while (i < text.length) {
        ws(); if (text[i] !== '"') throw new Error('Expected object key');
        const key = string(); if (keys.has(key)) throw new Error('Duplicate object key'); keys.add(key);
        ws(); if (text[i++] !== ':') throw new Error('Expected colon'); visit(depth + 1); ws();
        const c = text[i++]; if (c === '}') return; if (c !== ',') throw new Error('Expected comma');
      }
    } else if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      while (i < text.length) { visit(depth + 1); ws(); const c = text[i++]; if (c === ']') return; if (c !== ',') throw new Error('Expected comma'); }
    } else if (text[i] === '"') { string(); return; }
    else { const start = i; while (i < text.length && !/[\s,\]}]/.test(text[i])) i++; if (start === i) throw new Error('Expected value'); JSON.parse(text.slice(start, i)); return; }
    throw new Error('Incomplete JSON');
  };
  visit(0); ws(); if (i !== text.length) throw new Error('Trailing JSON');
  const value = JSON.parse(text); canonicalJson(value); return value;
}
