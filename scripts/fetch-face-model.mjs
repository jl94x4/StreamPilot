#!/usr/bin/env node
/**
 * Who's on screen (test) needs FaceNet in the APK assets. It is 24 MB, so it is not committed:
 * this fetches it once and checks its SHA-256. Source: shubham0204/FaceRecognition_With_FaceNet_Android
 * (Apache-2.0), converted from David Sandberg's FaceNet (MIT) via nyoki-mtl/keras-facenet.
 *
 *   node scripts/fetch-face-model.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ = 'https://raw.githubusercontent.com/shubham0204/FaceRecognition_With_FaceNet_Android/master/app/src/main/assets/facenet.tflite';
const SHA256 = 'd7c1f7f130376982c7004920ddc41925ac2e5aecf6522f476c8bbb3669db7013';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'plex-client/android/app/src/main/assets/models/facenet.tflite');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
    console.log('FaceNet model already in place.');
    process.exit(0);
}
const res = await fetch(URL_);
if (!res.ok) throw new Error(`Download failed: ${res.status}`);
const bytes = Buffer.from(await res.arrayBuffer());
if (sha(bytes) !== SHA256) throw new Error('FaceNet model checksum mismatch; not saved.');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, bytes);
console.log(`FaceNet model saved (${bytes.length} bytes).`);
