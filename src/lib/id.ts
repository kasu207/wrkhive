const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Short random id. Works in the browser outside secure contexts too
 * (crypto.randomUUID is only available on HTTPS / localhost).
 */
export function newId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
