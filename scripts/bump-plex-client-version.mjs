/**
 * Bump plex-client Android versionCode + versionName (1.0.N) before APK builds.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gradlePath = path.join(__dirname, '..', 'plex-client', 'android', 'app', 'build.gradle');

const src = fs.readFileSync(gradlePath, 'utf8');
const codeMatch = src.match(/versionCode\s+(\d+)/);
const nameMatch = src.match(/versionName\s+"([^"]+)"/);
if (!codeMatch || !nameMatch) {
    console.error('Could not find versionCode / versionName in', gradlePath);
    process.exit(1);
}

const prevCode = Number(codeMatch[1]);
const nextCode = prevCode + 1;
const prevName = nameMatch[1];
const nextName = /^1\.0\.\d+$/.test(prevName)
    ? `1.0.${nextCode}`
    : (() => {
        const parts = prevName.split('.');
        const last = parts[parts.length - 1];
        if (/^\d+$/.test(last)) {
            parts[parts.length - 1] = String(Number(last) + 1);
            return parts.join('.');
        }
        return `1.0.${nextCode}`;
    })();

const next = src
    .replace(/versionCode\s+\d+/, `versionCode ${nextCode}`)
    .replace(/versionName\s+"[^"]+"/, `versionName "${nextName}"`);

fs.writeFileSync(gradlePath, next, 'utf8');
console.log(`plex-client version ${prevName} (${prevCode}) → ${nextName} (${nextCode})`);
