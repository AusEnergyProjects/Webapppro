import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';

import { UPLOAD_PART_BYTES } from '@/lib/config';

const FILE_KEY_NAME = 'aea-field-upload-key-v1';
const UPLOAD_DIRECTORY = new Directory(Paths.document, 'field-uploads');

async function encryptionKey() {
  const existing = await SecureStore.getItemAsync(FILE_KEY_NAME);
  if (existing) return AESEncryptionKey.import(existing, 'hex');
  const generated = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(FILE_KEY_NAME, await generated.encoded('hex'), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return generated;
}

function bundleFiles(value: string) {
  try { return JSON.parse(value) as string[]; }
  catch { return value ? [value] : []; }
}

export async function encryptFileForQueue(sourceUri: string, uploadId: string) {
  if (!UPLOAD_DIRECTORY.exists) UPLOAD_DIRECTORY.create({ intermediates: true, idempotent: true });
  const source = new File(sourceUri);
  const key = await encryptionKey();
  const encryptedFiles: string[] = [];
  for (let start = 0, part = 1; start < source.size; start += UPLOAD_PART_BYTES, part += 1) {
    const plaintext = new Uint8Array(await source.slice(start, Math.min(start + UPLOAD_PART_BYTES, source.size)).arrayBuffer());
    const sealed = await aesEncryptAsync(plaintext, key);
    const combined = await sealed.combined();
    const target = new File(UPLOAD_DIRECTORY, `${uploadId}.${part}.aeaenc`);
    target.create({ overwrite: true });
    target.write(combined);
    encryptedFiles.push(target.uri);
  }
  try { source.delete(); } catch { /* Picker file may be managed outside this app. */ }
  return JSON.stringify(encryptedFiles);
}

export async function decryptQueuedPart(bundle: string, partNumber: number) {
  const files = bundleFiles(bundle);
  const encrypted = new File(files[partNumber - 1]);
  if (!encrypted.exists) throw new Error('An encrypted upload part is missing from this device.');
  const key = await encryptionKey();
  const sealed = AESSealedData.fromCombined(await encrypted.bytes());
  const plaintext = await aesDecryptAsync(sealed, key);
  if (typeof plaintext === 'string') throw new Error('The encrypted upload part could not be opened.');
  return plaintext;
}

export function encryptedBundleExists(bundle: string, totalParts: number) {
  const files = bundleFiles(bundle);
  return files.length === totalParts && files.every((uri) => new File(uri).exists);
}

export function deleteEncryptedBundle(bundle: string) {
  for (const uri of bundleFiles(bundle)) {
    try { new File(uri).delete(); } catch { /* Encrypted part was already removed. */ }
  }
}

export async function purgeEncryptionKey() {
  await SecureStore.deleteItemAsync(FILE_KEY_NAME);
}

export function purgeEncryptedFiles() {
  try { if (UPLOAD_DIRECTORY.exists) UPLOAD_DIRECTORY.delete(); } catch { /* Directory was already removed. */ }
}
