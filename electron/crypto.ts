import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
export function derive(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, 'hex'), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export const salt = () => randomBytes(16).toString('hex');
export function encrypt(value: string, key: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
}
export function decrypt(value: string, key: Buffer) {
  const data = JSON.parse(value);
  if (data.v !== 1) throw new Error('Format enkripsi tidak didukung.');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data.data, 'base64')), cipher.final()]).toString('utf8');
}
