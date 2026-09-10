/**
 * Bundles the built client into one self-contained HTML file for hosts that serve a single page
 * (e.g. a Claude Artifact). Emits page content only — no <html>/<head>/<body> wrapper — so it can be
 * dropped into a host-provided skeleton. Multiplayer and the store need the Node server; the app
 * falls back to its offline solo mode when /api is unreachable.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/client/dist');
const outDir = join(root, 'dist-demo');
const outFile = join(outDir, 'irongrid.html');

/** A closing tag inside string data would end the host element early. */
const safeForScript = (s) => s.replace(/<\/script/gi, '<\\/script');
const safeForStyle = (s) => s.replace(/<\/style/gi, '<\\/style');

const assets = readdirSync(join(dist, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (!jsName || !cssName) throw new Error(`expected one .js and one .css in ${dist}/assets, got ${assets.join(', ')}`);

const js = readFileSync(join(dist, 'assets', jsName), 'utf8');
const css = readFileSync(join(dist, 'assets', cssName), 'utf8');
const title = (readFileSync(join(dist, 'index.html'), 'utf8').match(/<title>([^<]*)<\/title>/) ?? [, 'IRONGRID'])[1];

const html = `<title>${title}</title>
<style>
${safeForStyle(css)}
</style>
<div id="app"></div>
<script type="module">
${safeForScript(js)}
</script>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, html);
console.log(`${outFile}  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB  (js ${jsName}, css ${cssName})`);
