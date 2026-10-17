const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const parser = require(path.join(root, 'frontend/node_modules/@babel/parser'));
const output = path.join(root, 'analysis/qa/inventory');
fs.mkdirSync(output, { recursive: true });

function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
const sources = files(path.join(root, 'frontend/src')).filter((file) => !/\.(test|spec)\./.test(file));
const edges = new Map();
const actions = [];
const dependencies = new Set();
for (const file of sources.filter((name) => name.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const imports = [];
  walk(tree, (node) => {
    if (node.type === 'ImportDeclaration' || (node.type === 'CallExpression' && node.callee?.type === 'Import')) {
      const target = node.source?.value || node.arguments?.[0]?.value;
      if (!target) return;
      if (target.startsWith('.')) {
        const candidate = path.resolve(path.dirname(file), target);
        imports.push([candidate, candidate + '.js', path.join(candidate, 'index.js')].find((name) => fs.existsSync(name)) || candidate);
      } else dependencies.add(target.startsWith('@') ? target.split('/').slice(0, 2).join('/') : target.split('/')[0]);
    }
    if (node.type === 'JSXOpeningElement' && ['Button', 'IconButton', 'Tab', 'Tabs', 'MenuItem', 'Select', 'TextField', 'Checkbox', 'ListItemButton', 'Pagination', 'TablePagination', 'Switch', 'Radio', 'Slider', 'AccordionSummary', 'input', 'button', 'select', 'textarea', 'form', 'a'].includes(node.name?.name)) {
      actions.push({ id: `UI-${String(actions.length + 1).padStart(4, '0')}`, file: path.relative(root, file).replace(/\\/g, '/'), line: node.loc.start.line, component: node.name.name,
        attributes: node.attributes.filter((a) => a.name).map((a) => a.name.name),
        handler: node.attributes.find((a) => /^on(Click|Change|Submit|KeyDown)$/.test(a.name?.name))?.value ? source.slice(node.attributes.find((a) => /^on(Click|Change|Submit|KeyDown)$/.test(a.name?.name)).start, node.attributes.find((a) => /^on(Click|Change|Submit|KeyDown)$/.test(a.name?.name)).end).replace(/\s+/g, ' ').slice(0, 240) : '',
        status: 'inventory-only; handler/API/role runtime review required',
      });
    }
  });
  edges.set(file, imports);
}
const reachable = new Set();
function reach(file) { if (reachable.has(file)) return; reachable.add(file); for (const target of edges.get(file) || []) reach(target); }
reach(path.join(root, 'frontend/src/index.js'));
const candidates = sources.filter((file) => !reachable.has(file)).map((file) => path.relative(root, file).replace(/\\/g, '/'));
const endpoints = [];
for (const file of files(path.join(root, 'backend/routes')).filter((file) => file.endsWith('.js'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/router\.(get|post|patch|put|delete|head)\(\s*['"]([^'"]+)['"]/g)) endpoints.push({ module: path.basename(file, '.js'), method: match[1].toUpperCase(), path: match[2], line: source.slice(0, match.index).split('\n').length, status: 'coverage required' });
}
const hash = crypto.createHash('sha256');
for (const file of [...sources.filter((f) => f.endsWith('.js')), ...files(path.join(root, 'backend')).filter((f) => f.endsWith('.js') && !f.includes('node_modules'))].sort()) hash.update(path.relative(root, file)).update(fs.readFileSync(file));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'frontend/package.json')));
const dependencyCandidates = Object.keys(packageJson.dependencies).filter((name) => !dependencies.has(name));
const summary = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceHash: hash.digest('hex'), node: process.version, reachableFiles: reachable.size, actions: actions.length, endpoints: endpoints.length, unreachableCandidates: candidates, dependencyCandidates, warning: 'AST reachability is evidence for review, not permission to remove business features or config/test dependencies.' };
fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(output, 'ui-controls.json'), JSON.stringify(actions, null, 2));
fs.writeFileSync(path.join(output, 'api-endpoints.json'), JSON.stringify(endpoints, null, 2));
fs.writeFileSync(path.join(output, 'FEATURE_UI_MATRICA.csv'), 'id,file,line,component,attributes,status\n' + actions.map((a) => [a.id, a.file, a.line, a.component, a.attributes.join(' '), 'needs-runtime-mapping'].join(',')).join('\n'));
console.log(JSON.stringify(summary, null, 2));
