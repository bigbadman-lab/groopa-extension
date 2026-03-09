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

// Current tracked groups (updated when checkboxes change)
let trackedGroupsList = [];

// Demo data for UI testing
const DEMO_TRACKED_GROUPS = [
  { id: '1', name: 'Demo Group A', url: 'https://www.facebook.com/groups/demoa', selected: true },
  { id: '2', name: 'Demo Group B', url: 'https://www.facebook.com/groups/demob', selected: true },
  { id: '3', name: 'Demo Group C', url: 'https://www.facebook.com/groups/democ', selected: false },
];

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
  trackedGroupsList = settings.trackedGroups.slice();
  renderDetectedGroups();
}

loadPage();

function renderDetectedGroups() {
  if (trackedGroupsList.length === 0) {
    detectedGroupsEl.innerHTML = '<p class="groups-empty">No detected groups yet. Load demo data or detect groups from Facebook.</p>';
    return;
  }
  detectedGroupsEl.innerHTML = trackedGroupsList
    .map(
      (g, index) =>
        `<div class="group-row" data-index="${index}">
          <div class="group-info">
            <div class="group-name">${escapeOpt(g.name || '')}</div>
            <div class="group-url"><a href="${escapeOpt(g.url || '#')}" target="_blank" rel="noopener">${escapeOpt(g.url || '')}</a></div>
          </div>
          <div class="track-option">
            <input type="checkbox" id="track-${g.id}" ${g.selected ? 'checked' : ''} data-index="${index}" />
            <label for="track-${g.id}">Track</label>
          </div>
        </div>`
    )
    .join('');

  detectedGroupsEl.querySelectorAll('.track-option input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const index = parseInt(cb.dataset.index, 10);
      if (!isNaN(index) && trackedGroupsList[index]) {
        trackedGroupsList[index].selected = cb.checked;
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

// Save when user clicks Save Settings
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
    trackedGroups: trackedGroupsList,
  });
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
  trackedGroupsList = DEMO_TRACKED_GROUPS.slice();
  await saveTrackedGroups(DEMO_TRACKED_GROUPS);
  await saveDetections(DEMO_DETECTIONS);
  renderDetectedGroups();
  showDemoMessage('Demo data loaded. Open the popup to see it.');
});

clearDemoBtn.addEventListener('click', async () => {
  trackedGroupsList = [];
  await clearDemoData();
  renderDetectedGroups();
  showDemoMessage('Demo data cleared.');
});
