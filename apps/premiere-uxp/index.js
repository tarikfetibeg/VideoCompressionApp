const { entrypoints, shell, storage } = require('uxp');
const ppro = require('premierepro');

let manifest = null;

function element(id) {
  return document.getElementById(id);
}

function setMessage(message, error = false) {
  const node = element('message');
  node.textContent = message;
  node.style.color = error ? '#ff9b9b' : '#b8d7ff';
}

function basename(path) {
  return String(path || '').replace(/\\/g, '/').split('/').pop();
}

function seconds(milliseconds) {
  return (Number(milliseconds || 0) / 1000).toFixed(2);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderManifest() {
  const summary = element('job-summary');
  const storyboard = manifest?.roughCut?.items || [];
  summary.classList.remove('empty');
  summary.innerHTML = `
    <h2>${escapeHtml(manifest.title || 'Edit job')}</h2>
    <p>${escapeHtml(manifest.brief || 'Bez briefa.')}</p>
    <div class="summary-grid">
      <div class="metric"><span>Materijal</span><strong>${(manifest.media || []).length}</strong></div>
      <div class="metric"><span>OFF</span><strong>${(manifest.off || []).length}</strong></div>
      <div class="metric"><span>Storyboard</span><strong>${storyboard.length} stavki</strong></div>
      <div class="metric"><span>Job</span><strong>${escapeHtml(manifest.jobId || 'N/A')}</strong></div>
    </div>
  `;
  element('connection-state').textContent = 'Workspace spreman';
  element('import-button').disabled = !(manifest.media || []).length;
  element('folder-button').disabled = !manifest.workspacePath;
  element('storyboard-section').hidden = storyboard.length === 0;
  element('storyboard-version').textContent = manifest.roughCut?.version ? `v${manifest.roughCut.version}` : '';
  element('storyboard-list').innerHTML = storyboard.map((item) => `
    <li>
      <div class="clip-name">${escapeHtml(item.fileName || item.videoId)}</div>
      <div class="clip-range">IN ${seconds(item.inMs)}s / OUT ${seconds(item.outMs)}s</div>
      ${item.note ? `<div class="clip-note">${escapeHtml(item.note)}</div>` : ''}
    </li>
  `).join('');
}

async function prepareInDesktop() {
  const jobId = element('job-id').value.trim();
  if (!/^[a-f0-9]{24}$/i.test(jobId)) {
    setMessage('Unesi ispravan job ID.', true);
    return;
  }
  const result = await shell.openExternal(
    `vca://job/${encodeURIComponent(jobId)}?action=premiere`,
    'Otvaram Aplikaciju v2 da sigurno pripremi lokalni Premiere workspace.'
  );
  setMessage(result === '' ? 'Desktop aplikacija priprema workspace.' : result, result !== '');
}

async function chooseManifest() {
  try {
    const file = await storage.localFileSystem.getFileForOpening({ types: ['json'] });
    if (!file) return;
    const parsed = JSON.parse(await file.read());
    if (parsed.schema !== 'vca-premiere-workspace/v1' || !parsed.jobId || !Array.isArray(parsed.media)) {
      throw new Error('Odabrani JSON nije Aplikacija v2 workspace manifest.');
    }
    manifest = { ...parsed, manifestPath: file.nativePath };
    renderManifest();
    setMessage('Manifest je učitan.');
  } catch (error) {
    setMessage(error.message || String(error), true);
  }
}

async function openWorkspaceFolder() {
  if (!manifest?.workspacePath) return;
  const result = await shell.openPath(manifest.workspacePath, 'Otvaram lokalni job workspace i Exports folder.');
  setMessage(result || 'Workspace folder je otvoren.', Boolean(result));
}

async function addStoryboardMarkers(project, sequence) {
  const roughCutItems = manifest?.roughCut?.items || [];
  if (!roughCutItems.length || !ppro.Markers || !ppro.TickTime) return 0;
  const markers = await ppro.Markers.getMarkers(sequence);
  let timelineSeconds = 0;
  project.executeTransaction((compoundAction) => {
    roughCutItems.forEach((item, index) => {
      const clipDuration = Math.max(0, Number(item.outMs || 0) - Number(item.inMs || 0)) / 1000;
      const start = ppro.TickTime.createWithSeconds(timelineSeconds);
      const duration = ppro.TickTime.createWithSeconds(Math.max(clipDuration, 0.04));
      compoundAction.addAction(markers.createAddMarkerAction(
        `${index + 1}. ${item.fileName || 'Klip'}`,
        'Comment',
        start,
        duration,
        `Izvor IN ${seconds(item.inMs)}s / OUT ${seconds(item.outMs)}s${item.note ? `\n${item.note}` : ''}`
      ));
      timelineSeconds += clipDuration;
    });
  }, 'Aplikacija v2 Storyboard markeri');
  return roughCutItems.length;
}

async function importWorkspace() {
  if (!manifest?.media?.length) return;
  element('import-button').disabled = true;
  setMessage('Importujem medije u aktivni Premiere projekt...');
  try {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error('Prvo otvori Premiere projekt.');
    const targetBin = await project.getInsertionBin();
    const before = new Set((await targetBin.getItems()).map((item) => item.getId()));
    const mediaPaths = manifest.media.map((item) => item.path);
    const imported = await project.importFiles(mediaPaths, true, targetBin, false);
    if (!imported) throw new Error('Premiere nije potvrdio import medija.');

    const importedItems = (await targetBin.getItems()).filter((item) => !before.has(item.getId()));
    const byName = new Map(importedItems.map((item) => [String(item.name || '').toLowerCase(), item]));
    const ordered = manifest.media
      .map((media) => byName.get(basename(media.path).toLowerCase()))
      .filter(Boolean)
      .map((item) => ppro.ClipProjectItem.cast(item));
    const clips = ordered.length ? ordered : importedItems.map((item) => ppro.ClipProjectItem.cast(item));
    const sequence = await project.createSequenceFromMedia(`${manifest.title || 'VCA Job'} - Storyboard`, clips, targetBin);
    const markerCount = await addStoryboardMarkers(project, sequence);
    await project.openSequence(sequence);
    setMessage(`Importovano ${clips.length} klipova; kreiran sequence i ${markerCount} Storyboard markera.`);
  } catch (error) {
    setMessage(error.message || String(error), true);
  } finally {
    element('import-button').disabled = false;
  }
}

function wireUi() {
  element('prepare-button').addEventListener('click', prepareInDesktop);
  element('manifest-button').addEventListener('click', chooseManifest);
  element('folder-button').addEventListener('click', openWorkspaceFolder);
  element('import-button').addEventListener('click', importWorkspace);
}

entrypoints.setup({
  panels: {
    'vca-job-panel': {
      show() {
        if (!element('prepare-button').dataset.ready) {
          wireUi();
          element('prepare-button').dataset.ready = 'true';
        }
      },
    },
  },
});
