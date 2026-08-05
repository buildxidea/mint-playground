/** Deterministic non-crypto hash for geometry version invalidation. */
export function createHash(input: string): string {
  let h0 = 0x811c9dc5;
  let h1 = 0x1000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h0 ^= c;
    h0 = Math.imul(h0, 0x01000193);
    h1 ^= c;
    h1 = Math.imul(h1, 0x85ebca77);
  }
  const a = (h0 >>> 0).toString(16).padStart(8, "0");
  const b = (h1 >>> 0).toString(16).padStart(8, "0");
  return `geo_${a}${b}`;
}
