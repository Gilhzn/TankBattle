import { randomBytes, randomInt, randomUUID } from 'node:crypto';

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newId(): string {
  return randomUUID();
}

/** 5-char room code from an unambiguous alphabet. */
export function newJoinCode(length = 5): string {
  let s = '';
  for (let i = 0; i < length; i++) s += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  return s;
}

/** Random url-safe nonce (resume tokens, ad session ids, ...). */
export function newNonce(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Random 31-bit positive simulation seed. */
export function newSeed(): number {
  return randomInt(1, 0x7fffffff);
}
