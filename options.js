// Groopa options page — save/load settings via storage service

const paidCheckbox = document.getElementById('paid-user');
const keywordsTextarea = document.getElementById('keywords');
const soundCheckbox = document.getElementById('sound-enabled');
const saveBtn = document.getElementById('save-btn');
const saveMessage = document.getElementById('save-message');
const loadDemoBtn = document.getElementById('load-demo-btn');
const clearDemoBtn = document.getElementById('clear-demo-btn');
const demoMessage = document.getElementById('demo-message');
const detectedGroupsEl = document.getElementById('detected-groups');

// Current state: detected = all candidates, tracked = ids we are monitoring
let detectedGroupsList = [];
let trackedGroupsList = [];

// Demo data for UI testing
const DEMO_NOW = new Date().toISOString();
const DEMO_DETECTED_GROUPS = [
  { id: '1', name: 'Demo Group A', url: 'https://www.facebook.com/groups/demoa', normalizedKey: '1', slug: 'demoa', source: 'demo', firstDetectedAt: DEMO_NOW, lastSeenAt: DEMO_NOW },
  { id: '2', name: 'Demo Group B', url: 'https://www.facebook.com/groups/demob', normalizedKey: '2', slug: 'demob', source: 'demo', firstDetectedAt: DEMO_NOW, lastSeenAt: DEMO_NOW },
  { id: '3', name: 'Demo Group C', url: 'https://www.facebook.com/groups/democ', normalizedKey: '3', slug: 'democ', source: 'demo', firstDetectedAt: DEMO_NOW, lastSeenAt: DEMO_NOW },
];

const DEMO_TRACKED_GROUP_IDS = ['1', '2']; // which demo groups are "tracked"

const DEMO_DETECTIONS = [
  { id: 'd1', groupName: 'Demo Group A', author: 'Jane Doe', text: 'Has anyone seen the latest alert?', keywordMatched: 'alert', createdAt: '2024-01-15T10:30:00Z' },
  { id: 'd2', groupName: 'Demo Group B', author: 'John Smith', text: 'Urgent: please check the pinned post.', keywordMatched: 'urgent', createdAt: '2024-01-15T09:00:00Z' },
  { id: 'd3', groupName: 'Demo Group A', author: 'Alex Lee', text: 'Reminder: meeting tomorrow at 9am.', keywordMatched: 'reminder', createdAt: '2024-01-14T16:00:00Z' },
];

// Load saved values when page opens
async function loadPage() {
  const settings = await getSettings();
  paidCheckbox.checked = settings.isPaidUser;
  keywordsTextarea.value = Array.isArray(settings.keywords) ? settings.keywords.join('\n') : '';
  soundCheckbox.checked = settings.soundEnabled;
  detectedGroupsList = Array.isArray(settings.detectedGroups) ? settings.detectedGroups.slice() : [];
  trackedGroupsList = Array.isArray(settings.trackedGroups) ? settings.trackedGroups.slice() : [];
  renderDetectedGroups();
}

loadPage();

function isTracked(groupId) {
  const id = groupId != null ? String(groupId) : '';
  return trackedGroupsList.some((g) => String(g.id) === id);
}

function renderDetectedGroups() {
  if (detectedGroupsList.length === 0) {
    detectedGroupsEl.innerHTML = '<p class="groups-empty">No detected groups yet. Visit Facebook group pages or load demo data.</p>';
    return;
  }
  function formatOptDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return iso;
    }
  }
  detectedGroupsEl.innerHTML = detectedGroupsList
    .map(
      (g, index) =>
        `<div class="group-row" data-index="${index}">
          <div class="group-info">
            <div class="group-name">${escapeOpt(g.name || '')}</div>
            <div class="group-url"><a href="${escapeOpt(g.url || '#')}" target="_blank" rel="noopener">${escapeOpt(g.url || '')}</a></div>
            <div class="group-meta">Source: ${escapeOpt(g.source || '—')} · Last seen: ${formatOptDate(g.lastSeenAt)}</div>
          </div>
          <div class="track-option">
            <input type="checkbox" id="track-${index}" ${isTracked(g.id) ? 'checked' : ''} data-id="${escapeOpt(g.id)}" data-name="${escapeOpt(g.name || '')}" data-url="${escapeOpt(g.url || '')}" />
            <label for="track-${index}">Track</label>
          </div>
        </div>`
    )
    .join('');

  detectedGroupsEl.querySelectorAll('.track-option input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const id = cb.dataset.id;
      const name = cb.dataset.name || '';
      const url = cb.dataset.url || '';
      if (!id) return;
      if (cb.checked) {
        if (!trackedGroupsList.some((g) => String(g.id) === id)) {
          trackedGroupsList.push({ id, name, url });
          await saveTrackedGroups(trackedGroupsList);
        }
      } else {
        trackedGroupsList = trackedGroupsList.filter((g) => String(g.id) !== id);
        await saveTrackedGroups(trackedGroupsList);
      }
    });
  });
}

function escapeOpt(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Save when user clicks Save Settings (sync: 3 keys; local: tracked groups)
saveBtn.addEventListener('click', async () => {
  const keywordsText = keywordsTextarea.value || '';
  const keywords = keywordsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  await saveSettings({
    isPaidUser: paidCheckbox.checked,
    keywords,
    soundEnabled: soundCheckbox.checked,
  });
  await saveTrackedGroups(trackedGroupsList);
  saveMessage.style.display = 'block';
  setTimeout(() => {
    saveMessage.style.display = 'none';
  }, 2000);
});

function showDemoMessage(text) {
  demoMessage.textContent = text;
  demoMessage.style.display = 'block';
  setTimeout(() => {
    demoMessage.style.display = 'none';
  }, 2500);
}

loadDemoBtn.addEventListener('click', async () => {
  detectedGroupsList = DEMO_DETECTED_GROUPS.slice();
  trackedGroupsList = DEMO_DETECTED_GROUPS.filter((g) => DEMO_TRACKED_GROUP_IDS.indexOf(String(g.id)) !== -1).map((g) => ({ id: g.id, name: g.name, url: g.url }));
  await saveDetectedGroups(detectedGroupsList);
  await saveTrackedGroups(trackedGroupsList);
  await saveDetections(DEMO_DETECTIONS);
  renderDetectedGroups();
  showDemoMessage('Demo data loaded. Open the popup to see it.');
});

clearDemoBtn.addEventListener('click', async () => {
  detectedGroupsList = [];
  trackedGroupsList = [];
  await clearDemoData();
  renderDetectedGroups();
  showDemoMessage('Demo data cleared.');
});
