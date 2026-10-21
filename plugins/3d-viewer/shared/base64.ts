// Base64 decoding without atob/Buffer, which are not available in every client runtime.

const LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let index = 0; index < alphabet.length; index++) table[alphabet.charCodeAt(index)] = index;
  return table;
})();

export function decodeBase64(text: string): Uint8Array {
  let length = text.length;
  while (length > 0 && text.charCodeAt(length - 1) === 61 /* = */) length--;
  const output = new Uint8Array(Math.floor((length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let written = 0;
  for (let index = 0; index < length; index++) {
    const value = LOOKUP[text.charCodeAt(index)];
    if (value === 255) throw new Error("Invalid base64 data");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[written++] = (buffer >> bits) & 0xff;
    }
  }
  return written === output.length ? output : output.subarray(0, written);
}
