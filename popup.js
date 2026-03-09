// Groopa popup — dashboard: live status from background + storage for lists

const heroStatus = document.getElementById('hero-status');
const heroDetail = document.getElementById('hero-detail');
const countKeywords = document.getElementById('count-keywords');
const countGroups = document.getElementById('count-groups');
const countDetections = document.getElementById('count-detections');
const keywordsChips = document.getElementById('keywords-chips');
const trackedGroupsEl = document.getElementById('tracked-groups');
const recentDetectionsEl = document.getElementById('recent-detections');
const facebookContextEl = document.getElementById('facebook-context');
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

// Request live status from background; fallback to getSettings() if worker unavailable
function getExtensionStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_EXTENSION_STATUS' }, (response) => {
      if (chrome.runtime.lastError || (response && response.error)) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// Build hero detail line from status; if group page detected, mention it
function heroDetailFromStatus(status) {
  const parts = [];
  const ctx = status.lastFacebookContext;
  if (ctx && ctx.isGroupPage && (ctx.groupName || ctx.groupIdentifier)) {
    parts.push('Viewing group: ' + (ctx.groupName || ctx.groupIdentifier));
  }
  parts.push(status.soundEnabled ? 'Sound on' : 'Sound off');
  const sel = status.selectedGroupCount != null ? status.selectedGroupCount : 0;
  const det = status.detectedGroupCount != null ? status.detectedGroupCount : 0;
  parts.push(`${sel} of ${det} group${det === 1 ? '' : 's'} tracked`);
  if (status.activityCount != null && status.activityCount > 0) {
    parts.push(`${status.activityCount} page load${status.activityCount === 1 ? '' : 's'}`);
    if (status.latestActivity && status.latestActivity.url) {
      try {
        const short = new URL(status.latestActivity.url).pathname || status.latestActivity.url;
        parts.push(`Last: ${short}`);
      } catch (_) {
        parts.push('Last activity recorded');
      }
    }
  }
  return parts.join(' · ');
}

// Load from background (or fallback) and from storage, then render
async function loadAndRender() {
  const status = await getExtensionStatus();
  const settings = await getSettings();

  const keywordList = settings.keywords;
  const detectedGroupsList = settings.detectedGroups || [];
  const trackedGroupsList = settings.trackedGroups || [];
  const detectionsList = settings.detections;

  function isTracked(groupId) {
    const id = groupId != null ? String(groupId) : '';
    return trackedGroupsList.some((g) => String(g.id) === id);
  }

  if (status && !status.error) {
    // Live status from background
    heroStatus.textContent = status.isPaidUser ? 'Groopa is ready' : 'Paid access required';
    heroDetail.textContent = status.isPaidUser
      ? heroDetailFromStatus(status)
      : 'Enable paid user access in Settings to use Groopa.';
    countKeywords.textContent = status.keywordCount;
    countGroups.textContent = status.selectedGroupCount != null ? status.selectedGroupCount : trackedGroupsList.length;
    countDetections.textContent = status.detectionCount;
  } else {
    // Fallback: compute from settings
    const selectedCount = trackedGroupsList.length;
    const detectedCount = detectedGroupsList.length;
    heroStatus.textContent = settings.isPaidUser ? 'Groopa is ready' : 'Paid access required';
    heroDetail.textContent = settings.isPaidUser
      ? `${settings.soundEnabled ? 'Sound on' : 'Sound off'} · ${selectedCount} of ${detectedCount} groups tracked (background unavailable)`
      : 'Enable paid user access in Settings to use Groopa.';
    countKeywords.textContent = keywordList.length;
    countGroups.textContent = selectedCount;
    countDetections.textContent = detectionsList.length;
  }

  // Facebook context panel (from status or from settings when background unavailable)
  const ctx = (status && status.lastFacebookContext) ? status.lastFacebookContext : (settings.lastFacebookContext || null);
  if (!ctx || !ctx.isFacebook) {
    facebookContextEl.className = 'placeholder-content';
    facebookContextEl.innerHTML = '<p class="placeholder-text">No Facebook page detected yet. Visit a Facebook page to see context.</p>';
  } else {
    facebookContextEl.className = 'list-content';
    const rows = [];
    rows.push('<div class="list-item detection-item"><div class="detection-meta">Page type</div><div class="detection-text">' + (ctx.isGroupPage ? 'Group page' : 'Normal Facebook page') + '</div></div>');
    if (ctx.title) rows.push('<div class="list-item detection-item"><div class="detection-meta">Title</div><div class="detection-text">' + escapeHtml(ctx.title) + '</div></div>');
    if (ctx.isGroupPage) {
      if (ctx.groupName) rows.push('<div class="list-item detection-item"><div class="detection-meta">Group name</div><div class="detection-text">' + escapeHtml(ctx.groupName) + '</div></div>');
      if (ctx.groupIdentifier) rows.push('<div class="list-item detection-item"><div class="detection-meta">Group ID</div><div class="detection-keyword">' + escapeHtml(ctx.groupIdentifier) + '</div></div>');
    }
    facebookContextEl.innerHTML = rows.join('');
  }

  // Keyword chips
  keywordsChips.innerHTML = '';
  keywordList.forEach((keyword) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = keyword.trim() || '\u00A0';
    keywordsChips.appendChild(chip);
  });

  // Tracked groups list: show all detected groups, with Tracking enabled / Detected, not selected
  if (detectedGroupsList.length === 0) {
    trackedGroupsEl.className = 'placeholder-content';
    trackedGroupsEl.innerHTML = '<p class="placeholder-text">No groups detected yet. Visit Facebook group pages or add demo data in Settings.</p>';
  } else {
    trackedGroupsEl.className = 'list-content';
    trackedGroupsEl.innerHTML = detectedGroupsList
      .map(
        (g) => {
          const lastSeen = g.lastSeenAt ? formatDate(g.lastSeenAt) : '—';
          return `<div class="list-item group-item">
            <a class="group-name" href="${escapeHtml(g.url || '#')}" target="_blank" rel="noopener">${escapeHtml(g.name || '')}</a>
            <span class="group-status">${isTracked(g.id) ? 'Tracking enabled' : 'Detected, not selected'}</span>
            <span class="group-last-seen">Last seen: ${escapeHtml(lastSeen)}</span>
          </div>`;
        }
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
