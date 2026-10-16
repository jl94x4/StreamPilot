const fs = require('fs');
const path = require('path');

const staticDir = path.join(__dirname, '..', 'static');

/** esbuild entry + code-split chunks written to static/ on npm run build:js */
const BUILD_ARTIFACT = /^(index\.js|chunk-[A-Z0-9]+\.js|bundle\.js|release-notes\.json|[A-Za-z][A-Za-z0-9]+-[A-Z0-9]{6,10}\.js)$/;

if (!fs.existsSync(staticDir)) {
    process.exit(0);
}

let removed = 0;
for (const name of fs.readdirSync(staticDir)) {
    const fullPath = path.join(staticDir, name);
    if (!fs.statSync(fullPath).isFile()) continue;
    if (!BUILD_ARTIFACT.test(name)) continue;
    fs.unlinkSync(fullPath);
    removed += 1;
}

if (removed > 0) {
    console.log(`Removed ${removed} stale static build artifact(s).`);
}
