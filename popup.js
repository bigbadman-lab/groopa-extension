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
const visiblePostCandidatesEl = document.getElementById('visible-post-candidates');
const openSettingsBtn = document.getElementById('open-settings');
const detectionDetailPanel = document.getElementById('detection-detail');
const detectionDetailBack = document.getElementById('detection-detail-back');
const detectionDetailGroup = document.getElementById('detection-detail-group');
const detectionDetailText = document.getElementById('detection-detail-text');
const detectionDetailKeywords = document.getElementById('detection-detail-keywords');
const detectionDetailOpenFb = document.getElementById('detection-detail-open-fb');
const detailPlaceholder = document.getElementById('detail-placeholder');
const toggleMoreBtn = document.getElementById('toggle-more');
const collapsibleContent = document.getElementById('collapsible-content');
const collapsibleSection = document.querySelector('.collapsible-section');
const recentScansEl = document.getElementById('recent-scans');

/** Last rendered detections list (used when opening a detection so we have the full object). */
let lastDetectionsList = [];

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

// Human-friendly relative time for "Last scan"
function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + ' min ago';
    if (diffHours < 24) return diffHours + ' hour' + (diffHours === 1 ? '' : 's') + ' ago';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    return formatDate(isoString);
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

// Build hero detail line from status; if group page detected, mention it and candidate count
function heroDetailFromStatus(status) {
  const parts = [];
  const ctx = status.lastFacebookContext;
  if (ctx && ctx.isGroupPage && (ctx.groupName || ctx.groupIdentifier)) {
    parts.push('Viewing group: ' + (ctx.groupName || ctx.groupIdentifier));
    const cand = status.pagePostCandidateCount != null ? status.pagePostCandidateCount : 0;
    if (cand > 0) parts.push(cand + ' post candidate' + (cand === 1 ? '' : 's') + ' on page');
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
  const pagePostCandidatesList = settings.pagePostCandidates || [];

  function isGroupTracked(group) {
    return trackedGroupsList.some((t) => groupMatches(t, group));
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
    const ctxFallback = settings.lastFacebookContext;
    let fallbackDetail = `${settings.soundEnabled ? 'Sound on' : 'Sound off'} · ${selectedCount} of ${detectedCount} groups tracked (background unavailable)`;
    if (ctxFallback && ctxFallback.isGroupPage && pagePostCandidatesList.length > 0) {
      fallbackDetail = pagePostCandidatesList.length + ' post candidate' + (pagePostCandidatesList.length === 1 ? '' : 's') + ' on page · ' + fallbackDetail;
    }
    heroStatus.textContent = settings.isPaidUser ? 'Groopa is ready' : 'Paid access required';
    heroDetail.textContent = settings.isPaidUser
      ? fallbackDetail
      : 'Enable paid user access in Settings to use Groopa.';
    countKeywords.textContent = keywordList.length;
    countGroups.textContent = selectedCount;
    countDetections.textContent = detectionsList.length;
  }

  // Latest group scans: detected groups sorted by lastSeenAt, top 5
  if (recentScansEl) {
    const withDate = (detectedGroupsList || [])
      .filter((g) => g && (g.lastSeenAt || g.name))
      .map((g) => ({ name: g.name || g.slug || 'Group', lastSeenAt: g.lastSeenAt || null }))
      .sort((a, b) => {
        if (!a.lastSeenAt) return 1;
        if (!b.lastSeenAt) return -1;
        return new Date(b.lastSeenAt) - new Date(a.lastSeenAt);
      })
      .slice(0, 5);
    if (withDate.length === 0) {
      recentScansEl.innerHTML = '<p class="placeholder-text">No recent scans yet.</p>';
    } else {
      recentScansEl.innerHTML = withDate
        .map(
          (g) =>
            `<div class="recent-scan-item">
              <span class="recent-scan-name">${escapeHtml(g.name)}</span>
              <span class="recent-scan-meta"><span class="recent-scan-label">Last scan</span> ${escapeHtml(formatRelativeTime(g.lastSeenAt))}</span>
            </div>`
        )
        .join('');
    }
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

  // Visible post candidates panel
  if (pagePostCandidatesList.length === 0) {
    visiblePostCandidatesEl.className = 'placeholder-content';
    visiblePostCandidatesEl.innerHTML = '<p class="placeholder-text">No post candidates yet. Open a Facebook group page to capture visible posts.</p>';
  } else {
    visiblePostCandidatesEl.className = 'list-content';
    visiblePostCandidatesEl.innerHTML = pagePostCandidatesList
      .map(
        (c) =>
          `<div class="list-item detection-item">
            <div class="detection-text">${escapeHtml((c && c.textPreview) ? c.textPreview : '')}</div>
          </div>`
      )
      .join('');
  }

  // Keyword chips
  keywordsChips.innerHTML = '';
  keywordList.forEach((keyword) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = keyword.trim() || '\u00A0';
    keywordsChips.appendChild(chip);
  });

  // Tracked groups list: show detected groups with Track / Untrack buttons
  if (detectedGroupsList.length === 0) {
    trackedGroupsEl.className = 'placeholder-content';
    trackedGroupsEl.innerHTML = '<p class="placeholder-title">No Facebook groups detected yet</p><p class="placeholder-text">Visit Facebook groups you are already a member of or join new ones. Groopa will automatically detect them. Once a group appears here, click Track to enable monitoring.</p>';
  } else {
    trackedGroupsEl.className = 'list-content';
    trackedGroupsEl.innerHTML = detectedGroupsList
      .map((g) => {
        const lastSeen = g.lastSeenAt ? formatDate(g.lastSeenAt) : '—';
        const tracked = isGroupTracked(g);
        const id = escapeHtml((g.id != null ? g.id : '').toString());
        const name = escapeHtml((g.name != null ? g.name : '').toString());
        const url = escapeHtml((g.url != null ? g.url : '').toString());
        const slug = escapeHtml((g.slug != null ? g.slug : '').toString());
        const btn = tracked
          ? `<button type="button" class="btn-untrack" data-group-id="${id}" data-group-name="${name}" data-group-url="${url}" data-group-slug="${slug}">Untrack</button>`
          : `<button type="button" class="btn-track" data-group-id="${id}" data-group-name="${name}" data-group-url="${url}">Track</button>`;
        return `<div class="list-item group-item">
            <a class="group-name" href="${escapeHtml(g.url || '#')}" target="_blank" rel="noopener">${escapeHtml(g.name || '')}</a>
            <span class="group-status">${tracked ? 'Tracking' : 'Not tracking'}</span>
            <span class="group-last-seen">Last seen: ${escapeHtml(lastSeen)}</span>
            ${btn}
          </div>`;
      })
      .join('');

    trackedGroupsEl.querySelectorAll('.btn-track').forEach((el) => {
      el.addEventListener('click', async () => {
        const group = { id: el.dataset.groupId, name: el.dataset.groupName, url: el.dataset.groupUrl };
        const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'TRACK_GROUP', group }, r));
        if (!chrome.runtime.lastError && !(res && res.error)) loadAndRender();
      });
    });
    trackedGroupsEl.querySelectorAll('.btn-untrack').forEach((el) => {
      el.addEventListener('click', async () => {
        const group = { id: el.dataset.groupId, slug: el.dataset.groupSlug, url: el.dataset.groupUrl };
        const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'UNTRACK_GROUP', group }, r));
        if (!chrome.runtime.lastError && !(res && res.error)) loadAndRender();
      });
    });
  }

  // Recent detections: inbox list (clickable rows) — list always visible; detail in right column
  lastDetectionsList = detectionsList;
  if (detectionsList.length === 0) {
    recentDetectionsEl.className = 'placeholder-content';
    recentDetectionsEl.innerHTML = '<p class="placeholder-text">No detections yet.</p>';
  } else {
    recentDetectionsEl.className = 'list-content';
    const previewLen = 80;
    recentDetectionsEl.innerHTML = detectionsList
      .map((d) => {
        const groupLabel = d.groupName || d.groupIdentifier || 'Group';
        const text = d.text != null ? d.text : (d.textPreview != null ? d.textPreview : '');
        const preview = text.length > previewLen ? text.slice(0, previewLen) + '…' : text;
        const keywordLabel = d.keywordMatched != null ? d.keywordMatched : (Array.isArray(d.matchedKeywords) ? d.matchedKeywords.join(', ') : '');
        const status = d.status === 'opened' ? 'opened' : 'new';
        const newBadge = status === 'new' ? '<span class="detection-new-badge">New</span>' : '';
        return `<button type="button" class="list-item detection-item inbox-item" data-fingerprint="${escapeHtml(d.fingerprint || '')}">
            <div class="detection-meta">${escapeHtml(groupLabel)} · ${formatDate(d.createdAt)} ${newBadge}</div>
            <div class="detection-text">${escapeHtml(preview)}</div>
            <div class="detection-keyword">${escapeHtml(keywordLabel)}</div>
          </button>`;
      })
      .join('');

    recentDetectionsEl.querySelectorAll('.inbox-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fingerprint = btn.dataset.fingerprint;
        const detection = lastDetectionsList.find((d) => d.fingerprint === fingerprint);
        if (!detection) return;
        const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'MARK_DETECTION_OPENED', fingerprint }, r));
        if (!chrome.runtime.lastError && res && res.ok) {
          detection.status = 'opened';
        }
        showDetectionDetail(detection);
      });
    });
  }
  // Right column: show placeholder when no detection selected, detail when one is selected
  if (detailPlaceholder) {
    detailPlaceholder.hidden = !detectionDetailPanel.hidden;
  }
}

function showDetectionDetail(detection) {
  const groupLabel = detection.groupName || detection.groupIdentifier || 'Group';
  const text = detection.text != null ? detection.text : (detection.textPreview != null ? detection.textPreview : '');
  const keywordLabel = detection.keywordMatched != null ? detection.keywordMatched : (Array.isArray(detection.matchedKeywords) ? detection.matchedKeywords.join(', ') : '');
  detectionDetailGroup.textContent = groupLabel;
  detectionDetailText.textContent = text || '—';
  detectionDetailKeywords.textContent = 'Keywords: ' + keywordLabel;
  detectionDetailOpenFb.dataset.url = detection.pageUrl || '';
  detailPlaceholder.hidden = true;
  detectionDetailPanel.hidden = false;
}

function showDetectionsList() {
  detailPlaceholder.hidden = false;
  detectionDetailPanel.hidden = true;
  loadAndRender();
}

detectionDetailBack.addEventListener('click', showDetectionsList);
detectionDetailOpenFb.addEventListener('click', () => {
  const url = detectionDetailOpenFb.dataset.url;
  if (url) chrome.tabs.create({ url });
});

loadAndRender();

// Collapsible "Setup & debug" section
if (toggleMoreBtn && collapsibleContent && collapsibleSection) {
  toggleMoreBtn.addEventListener('click', () => {
    collapsibleContent.hidden = !collapsibleContent.hidden;
    const expanded = !collapsibleContent.hidden;
    toggleMoreBtn.setAttribute('aria-expanded', String(expanded));
    collapsibleSection.setAttribute('data-expanded', String(expanded));
  });
}

// Open options page
openSettingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
