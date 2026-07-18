const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pluginSource = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
new Function(pluginSource);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const required = ['manifestVersion', 'id', 'name', 'version', 'host', 'entrypoints'];
for (const key of required) {
  if (manifest[key] == null) throw new Error(`Manifest nema obavezno polje: ${key}`);
}
if (manifest.manifestVersion !== 5) throw new Error('Premiere UXP zahtijeva manifestVersion 5.');
if (manifest.host?.app !== 'premierepro') throw new Error('UXP host mora biti premierepro.');
if (Number.parseFloat(manifest.host?.minVersion) < 25.6) throw new Error('Minimalna Premiere verzija mora biti 25.6.');
for (const file of ['index.html', 'index.js', 'styles.css']) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Nedostaje ${file}.`);
}
console.log('Premiere UXP manifest je ispravan.');
