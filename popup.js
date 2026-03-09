// Groopa popup — dashboard: load settings and render (uses storage service)

const heroStatus = document.getElementById('hero-status');
const heroDetail = document.getElementById('hero-detail');
const countKeywords = document.getElementById('count-keywords');
const countGroups = document.getElementById('count-groups');
const countDetections = document.getElementById('count-detections');
const keywordsChips = document.getElementById('keywords-chips');
const trackedGroupsEl = document.getElementById('tracked-groups');
const recentDetectionsEl = document.getElementById('recent-detections');
const openSettingsBtn = document.getElementById('open-settings');

// Escape HTML so user content is safe to show
function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Format a date string for display
function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return isoString;
  }
}

// Load from storage and render dashboard
async function loadAndRender() {
  const settings = await getSettings();
  const isPaidUser = settings.isPaidUser;
  const keywordList = settings.keywords;
  const soundEnabled = settings.soundEnabled;
  const groupsList = settings.trackedGroups;
  const detectionsList = settings.detections;

  const selectedCount = groupsList.filter((g) => g.selected).length;

  // Hero status
  if (!isPaidUser) {
    heroStatus.textContent = 'Paid access required';
    heroDetail.textContent = 'Enable paid user access in Settings to use Groopa.';
  } else {
    heroStatus.textContent = 'Groopa is ready';
    const parts = [];
    if (soundEnabled) parts.push('Sound on');
    else parts.push('Sound off');
    parts.push(`${selectedCount} group${selectedCount === 1 ? '' : 's'} selected for monitoring`);
    heroDetail.textContent = parts.join(' · ');
  }

  // Summary counts (only selected groups in Tracked Groups card)
  countKeywords.textContent = keywordList.length;
  countGroups.textContent = selectedCount;
  countDetections.textContent = detectionsList.length;

  // Keyword chips (use textContent so no escaping needed)
  keywordsChips.innerHTML = '';
  keywordList.forEach((keyword) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = keyword.trim() || '\u00A0';
    keywordsChips.appendChild(chip);
  });

  // Tracked groups list (all detected groups; show tracking status)
  if (groupsList.length === 0) {
    trackedGroupsEl.className = 'placeholder-content';
    trackedGroupsEl.innerHTML = '<p class="placeholder-text">No groups added yet. Add groups in Settings.</p>';
  } else {
    trackedGroupsEl.className = 'list-content';
    trackedGroupsEl.innerHTML = groupsList
      .map(
        (g) =>
          `<div class="list-item group-item">
            <a class="group-name" href="${escapeHtml(g.url || '#')}" target="_blank" rel="noopener">${escapeHtml(g.name || '')}</a>
            <span class="group-status">${g.selected ? 'Tracking enabled' : 'Detected, not selected'}</span>
          </div>`
      )
      .join('');
  }

  // Recent detections list
  if (detectionsList.length === 0) {
    recentDetectionsEl.className = 'placeholder-content';
    recentDetectionsEl.innerHTML = '<p class="placeholder-text">No detections yet.</p>';
  } else {
    recentDetectionsEl.className = 'list-content';
    recentDetectionsEl.innerHTML = detectionsList
      .map(
        (d) =>
          `<div class="list-item detection-item">
            <div class="detection-meta">${escapeHtml(d.groupName || '')} · ${escapeHtml(d.author || '')} · ${formatDate(d.createdAt)}</div>
            <div class="detection-text">${escapeHtml(d.text || '')}</div>
            <div class="detection-keyword">Keyword: ${escapeHtml(d.keywordMatched || '')}</div>
          </div>`
      )
      .join('');
  }
}

loadAndRender();

// Open options page
openSettingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
