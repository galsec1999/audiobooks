import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const output = path.join(root, '_site');
const config = JSON.parse(fs.readFileSync(path.join(root, 'site.config.json'), 'utf8'));
const htmlFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
  .map((entry) => entry.name);

if (!htmlFiles.includes(config.homepage)) {
  throw new Error(`Configured homepage does not exist: ${config.homepage}`);
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const filename of htmlFiles) {
  fs.copyFileSync(path.join(root, filename), path.join(output, filename));
}

fs.copyFileSync(path.join(root, config.homepage), path.join(output, 'index.html'));
fs.copyFileSync(path.join(root, '.nojekyll'), path.join(output, '.nojekyll'));
fs.copyFileSync(path.join(root, 'robots.txt'), path.join(output, 'robots.txt'));

console.log(`Built ${htmlFiles.length} source page(s) in _site; ${config.homepage} is index.html.`);
