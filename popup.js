// Groopa popup — dashboard: live status from background + storage for lists

const headerStatusEl = document.getElementById('header-status');
const headerSublineEl = document.getElementById('header-subline');
const countKeywords = document.getElementById('count-keywords');
const countGroups = document.getElementById('count-groups');
const countDetections = document.getElementById('count-detections');
const keywordsChips = document.getElementById('keywords-chips');
const trackedGroupsEl = document.getElementById('tracked-groups');
const recentDetectionsEl = document.getElementById('recent-detections');
const facebookContextEl = document.getElementById('facebook-context');
const visiblePostCandidatesEl = document.getElementById('visible-post-candidates');
const openSettingsBtn = document.getElementById('open-settings');
const inboxListEl = document.getElementById('inbox-list');
const leadDetailViewEl = document.getElementById('lead-detail-view');
const detectionDetailBack = document.getElementById('lead-detail-back');
const leadDetailGroup = document.getElementById('lead-detail-group');
const leadDetailTime = document.getElementById('lead-detail-time');
const leadDetailText = document.getElementById('lead-detail-text');
const leadDetailKeywords = document.getElementById('lead-detail-keywords');
const leadDetailAiBtn = document.getElementById('lead-detail-ai-btn');
const leadDetailOpenFb = document.getElementById('lead-detail-open-fb');
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

// Simple product-style header: Active | Ready | Inactive + one short subline
function getHeaderState(isPaidUser, trackedCount) {
  const count = typeof trackedCount === 'number' ? trackedCount : 0;
  if (!isPaidUser) {
    return { status: 'Inactive', statusClass: 'header-status--inactive', subline: 'Enable in Settings' };
  }
  if (count > 0) {
    return { status: 'Active', statusClass: 'header-status--active', subline: 'Tracking ' + count + ' group' + (count === 1 ? '' : 's') };
  }
  return { status: 'Ready', statusClass: 'header-status--ready', subline: 'Add groups in Settings' };
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

  const isPaidUser = status && !status.error ? status.isPaidUser : settings.isPaidUser;
  const trackedCount = status && !status.error && status.selectedGroupCount != null
    ? status.selectedGroupCount
    : trackedGroupsList.length;

  if (headerStatusEl) {
    const header = getHeaderState(isPaidUser, trackedCount);
    headerStatusEl.textContent = header.status;
    headerStatusEl.className = 'header-status ' + header.statusClass;
  }
  if (headerSublineEl) {
    headerSublineEl.textContent = getHeaderState(isPaidUser, trackedCount).subline;
  }

  if (status && !status.error) {
    countKeywords.textContent = status.keywordCount;
    countGroups.textContent = trackedCount;
    countDetections.textContent = status.detectionCount;
  } else {
    countKeywords.textContent = keywordList.length;
    countGroups.textContent = trackedCount;
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

  // Inbox: full-width lead cards (single column)
  lastDetectionsList = detectionsList;
  if (detectionsList.length === 0) {
    recentDetectionsEl.className = 'placeholder-content inbox-cards';
    recentDetectionsEl.innerHTML = '<p class="placeholder-text">No detections yet.</p>';
  } else {
    recentDetectionsEl.className = 'inbox-cards';
    const previewLen = 120;
    recentDetectionsEl.innerHTML = detectionsList
      .map((d) => {
        const groupLabel = d.groupName || d.groupIdentifier || 'Group';
        const text = d.text != null ? d.text : (d.textPreview != null ? d.textPreview : '');
        const preview = text.length > previewLen ? text.slice(0, previewLen) + '…' : text;
        const keywordLabel = d.keywordMatched != null ? d.keywordMatched : (Array.isArray(d.matchedKeywords) ? d.matchedKeywords.join(', ') : '');
        const isNew = d.status !== 'opened';
        const newBadge = isNew ? '<span class="lead-card-new">New</span>' : '';
        return `<button type="button" class="lead-card" data-fingerprint="${escapeHtml(d.fingerprint || '')}">
            <div class="lead-card-group">${escapeHtml(groupLabel)} ${newBadge}</div>
            <div class="lead-card-preview">${escapeHtml(preview)}</div>
            <div class="lead-card-meta">
              <span class="lead-card-keywords">${escapeHtml(keywordLabel)}</span>
              <span>${escapeHtml(formatDate(d.createdAt))}</span>
            </div>
          </button>`;
      })
      .join('');

    recentDetectionsEl.querySelectorAll('.lead-card').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const fingerprint = btn.dataset.fingerprint;
        const detection = lastDetectionsList.find((d) => d.fingerprint === fingerprint);
        if (!detection) return;
        const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'MARK_DETECTION_OPENED', fingerprint }, r));
        if (!chrome.runtime.lastError && res && res.ok) {
          detection.status = 'opened';
        }
        showLeadDetail(detection);
      });
    });
  }
  if (inboxListEl && leadDetailViewEl && !leadDetailViewEl.hidden) return;
  if (inboxListEl) inboxListEl.hidden = false;
  if (leadDetailViewEl) leadDetailViewEl.hidden = true;
}

function showLeadDetail(detection) {
  const groupLabel = detection.groupName || detection.groupIdentifier || 'Group';
  const text = detection.text != null ? detection.text : (detection.textPreview != null ? detection.textPreview : '');
  const keywordLabel = detection.keywordMatched != null ? detection.keywordMatched : (Array.isArray(detection.matchedKeywords) ? detection.matchedKeywords.join(', ') : '');
  leadDetailGroup.textContent = groupLabel;
  leadDetailTime.textContent = 'Detected ' + formatDate(detection.createdAt);
  leadDetailText.textContent = text || '—';
  leadDetailKeywords.textContent = 'Matched: ' + keywordLabel;
  leadDetailOpenFb.dataset.url = detection.pageUrl || '';
  inboxListEl.hidden = true;
  leadDetailViewEl.hidden = false;
}

function showInboxList() {
  leadDetailViewEl.hidden = true;
  inboxListEl.hidden = false;
  loadAndRender();
}

if (detectionDetailBack) {
  detectionDetailBack.addEventListener('click', (e) => {
    e.preventDefault();
    showInboxList();
  });
}
if (leadDetailOpenFb) {
  leadDetailOpenFb.addEventListener('click', () => {
    const url = leadDetailOpenFb.dataset.url;
    if (url) chrome.tabs.create({ url });
  });
}
if (leadDetailAiBtn) {
  leadDetailAiBtn.addEventListener('click', () => {
    // Placeholder: AI response generation will be implemented later
  });
}

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
