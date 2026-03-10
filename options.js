// Groopa options page — dashboard layout, save/load via storage

const paidCheckbox = document.getElementById('paid-user');
const soundCheckbox = document.getElementById('sound-enabled');
const keywordInput = document.getElementById('keyword-input');
const keywordAddBtn = document.getElementById('keyword-add-btn');
const keywordsListEl = document.getElementById('keywords-list');
const keywordsEmptyEl = document.getElementById('keywords-empty');
const loadDemoBtn = document.getElementById('load-demo-btn');
const clearDemoBtn = document.getElementById('clear-demo-btn');
const demoMessageEl = document.getElementById('demo-message');
const detectedGroupsEl = document.getElementById('detected-groups');
const inboxListEl = document.getElementById('inbox-list');
const inboxEmptyStateEl = document.getElementById('inbox-empty-state');
const inboxTwoPanelsEl = document.getElementById('inbox-two-panels');
const inboxStatTotalEl = document.getElementById('inbox-stat-total');
const inboxStatNewEl = document.getElementById('inbox-stat-new');
const inboxDetailPlaceholderEl = document.getElementById('inbox-detail-placeholder');
const inboxDetailContentEl = document.getElementById('inbox-detail-content');
const inboxDetailBack = document.getElementById('inbox-detail-back');
const inboxDetailGroup = document.getElementById('inbox-detail-group');
const inboxDetailTime = document.getElementById('inbox-detail-time');
const inboxDetailText = document.getElementById('inbox-detail-text');
const inboxDetailKeywords = document.getElementById('inbox-detail-keywords');
const inboxDetailAiBtn = document.getElementById('inbox-detail-ai-btn');
const inboxReplyTextEl = document.getElementById('inbox-reply-text');
const inboxCopyReplyBtn = document.getElementById('inbox-copy-reply');
const inboxOpenPostLink = document.getElementById('inbox-open-post');
const addGroupUrlInput = document.getElementById('add-group-url');
const addGroupBtn = document.getElementById('add-group-btn');
const addGroupErrorEl = document.getElementById('add-group-error');
const addManuallyBtn = document.getElementById('add-manually-btn');
const addGroupFormEl = document.getElementById('add-group-form');
const addGroupCancelBtn = document.getElementById('add-group-cancel');
const accountPlanEl = document.getElementById('account-plan');
const accountVersionEl = document.getElementById('account-version');
const sidebarVersionEl = document.getElementById('sidebar-version');
const monitorStatusText = document.getElementById('monitor-status-text');
const monitorMeta = document.getElementById('monitor-meta');
const monitorStartBtn = document.getElementById('monitor-start-btn');
const monitorStopBtn = document.getElementById('monitor-stop-btn');
const monitorOpenWindowBtn = document.getElementById('monitor-open-window-btn');
const monitorWindowHint = document.getElementById('monitor-window-hint');
const monitorValidationMsg = document.getElementById('monitor-validation-msg');
const scanGroupsBtn = document.getElementById('scan-groups-btn');
const scanGroupsStatusEl = document.getElementById('scan-groups-status');
const summaryKeywordsCountEl = document.getElementById('summary-keywords-count');
const summaryGroupsCountEl = document.getElementById('summary-groups-count');
const summaryLeadsCountEl = document.getElementById('summary-leads-count');
const summaryLeadsCardEl = document.getElementById('summary-leads');
const openInboxBtn = document.getElementById('open-inbox-btn');

let detectedGroupsList = [];
let trackedGroupsList = [];
let keywordList = [];
let detectionsList = [];
let selectedInboxDetection = null;
let generatedReplyText = '';
let isScanningGroups = false;

const DEMO_NOW = new Date().toISOString();
const DEMO_DETECTED_GROUPS = [
  { id: '1', name: 'Demo Group A', url: 'https://www.facebook.com/groups/demoa', normalizedKey: '1', slug: 'demoa', source: 'demo', firstDetectedAt: DEMO_NOW, lastSeenAt: DEMO_NOW },
  { id: '2', name: 'Demo Group B', url: 'https://www.facebook.com/groups/demob', normalizedKey: '2', slug: 'demob', source: 'demo', firstDetectedAt: DEMO_NOW, lastSeenAt: DEMO_NOW },
  { id: '3', name: 'Demo Group C', url: 'https://www.facebook.com/groups/democ', normalizedKey: '3', slug: 'democ', source: 'demo', firstDetectedAt: DEMO_NOW, lastSeenAt: DEMO_NOW },
];
const DEMO_TRACKED_GROUP_IDS = ['1', '2'];
const DEMO_DETECTIONS = [
  { id: 'd1', groupName: 'Demo Group A', author: 'Jane Doe', text: 'Has anyone seen the latest alert?', keywordMatched: 'alert', createdAt: '2024-01-15T10:30:00Z' },
  { id: 'd2', groupName: 'Demo Group B', author: 'John Smith', text: 'Urgent: please check the pinned post.', keywordMatched: 'urgent', createdAt: '2024-01-15T09:00:00Z' },
  { id: 'd3', groupName: 'Demo Group A', author: 'Alex Lee', text: 'Reminder: meeting tomorrow at 9am.', keywordMatched: 'reminder', createdAt: '2024-01-14T16:00:00Z' },
];

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

/**
 * Validate and parse a Facebook group URL. Returns { slug, url } or null if invalid.
 */
function parseFacebookGroupUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  const slug = getSlugFromGroupUrl(raw);
  if (!slug) return null;
  const normalizedUrl = normalizeFacebookGroupUrl(raw);
  if (!normalizedUrl || normalizedUrl.indexOf('/groups/') === -1) return null;
  return { slug, url: normalizedUrl };
}

/**
 * Update the dashboard summary counts (Keywords, Groups, Leads) from current in-memory state.
 * Called on load and whenever storage or in-page actions change these counts.
 */
function updateSummaryCounts() {
  const keywords = typeof keywordList !== 'undefined' && Array.isArray(keywordList) ? keywordList.length : 0;
  const groups = typeof trackedGroupsList !== 'undefined' && Array.isArray(trackedGroupsList) ? trackedGroupsList.length : 0;
  const leads = typeof detectionsList !== 'undefined' && Array.isArray(detectionsList) ? detectionsList.length : 0;
  if (summaryKeywordsCountEl) summaryKeywordsCountEl.textContent = String(keywords);
  if (summaryGroupsCountEl) summaryGroupsCountEl.textContent = String(groups);
  if (summaryLeadsCountEl) summaryLeadsCountEl.textContent = String(leads);
}

/**
 * Switch the settings view to a panel by id (e.g. 'monitoring', 'inbox').
 * Updates sidebar active state and panel visibility.
 */
function switchToPanel(panelId) {
  if (!panelId) return;
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('nav-item--active', b.dataset.panel === panelId);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('panel--active', p.id === 'panel-' + panelId);
  });
  if (panelId === 'inbox') {
    try {
      chrome.runtime.sendMessage({ type: 'INBOX_OPENED' });
    } catch (_) {}
  }
}

function setScanGroupsStatus(state, extra) {
  if (!scanGroupsStatusEl) return;
  if (state === 'scanning') {
    scanGroupsStatusEl.textContent = 'Scanning your Facebook groups...';
  } else if (state === 'success') {
    const count = typeof extra === 'number' ? extra : 0;
    scanGroupsStatusEl.textContent = 'Found ' + count + ' group' + (count === 1 ? '' : 's');
  } else if (state === 'error') {
    scanGroupsStatusEl.textContent = extra || 'Could not scan your groups. Please make sure you are logged into Facebook.';
  } else {
    scanGroupsStatusEl.textContent = '';
  }
}

async function loadPage() {
  const settings = await getSettings();
  paidCheckbox.checked = settings.isPaidUser;
  soundCheckbox.checked = settings.soundEnabled;
  keywordList = Array.isArray(settings.keywords) ? settings.keywords.slice() : [];
  detectedGroupsList = Array.isArray(settings.detectedGroups) ? settings.detectedGroups.slice() : [];
  trackedGroupsList = Array.isArray(settings.trackedGroups) ? settings.trackedGroups.slice() : [];

  renderKeywords();
  renderDetectedGroups();
  await refreshInboxFromStorage();
  updateSummaryCounts();
  renderMonitorStatus(settings);
  updateAccountPanel(settings.isPaidUser);

  try {
    const manifest = chrome.runtime.getManifest();
    const ver = manifest.version || '0.1.0';
    if (accountVersionEl) accountVersionEl.textContent = ver;
    if (sidebarVersionEl) sidebarVersionEl.textContent = 'v' + ver;
  } catch (_) {
    if (accountVersionEl) accountVersionEl.textContent = '0.1.0';
    if (sidebarVersionEl) sidebarVersionEl.textContent = 'v0.1.0';
  }

  // INBOX_OPENED is sent when the user opens the Inbox panel (see switchToPanel) or the popup
}

function updateAccountPanel(isPaidUser) {
  if (accountPlanEl) {
    accountPlanEl.textContent = isPaidUser ? 'Paid' : 'Free';
  }
}

function renderMonitorStatus(settings) {
  const count = Array.isArray(settings.trackedGroups) ? settings.trackedGroups.length : 0;
  const mon = settings.monitoringState != null ? settings.monitoringState : {};
  const enabled = mon.monitoringEnabled === true;

  if (monitorStatusText) {
    if (count === 0) {
      monitorStatusText.textContent = 'No tracked groups';
    } else if (enabled) {
      monitorStatusText.textContent = 'Active';
    } else {
      monitorStatusText.textContent = 'Paused';
    }
  }

  const metaParts = [];
  metaParts.push(count + ' tracked group' + (count !== 1 ? 's' : ''));
  if (count > 0) {
    const cycleSec = count * 30;
    metaParts.push('Full cycle: ~' + (cycleSec < 60 ? cycleSec + 's' : Math.round(cycleSec / 60) + ' min'));
  }
  if (mon.monitorLastRunAt) {
    try {
      const d = new Date(mon.monitorLastRunAt);
      if (!isNaN(d.getTime())) {
        metaParts.push('Last run: ' + formatRelativeTime(mon.monitorLastRunAt));
      }
    } catch (_) {}
  }
  if (monitorMeta) {
    monitorMeta.textContent = metaParts.join(' · ');
  }

  if (monitorStartBtn) {
    monitorStartBtn.disabled = count === 0 || enabled;
  }
  if (monitorStopBtn) {
    monitorStopBtn.disabled = !enabled;
  }
  if (monitorOpenWindowBtn) {
    monitorOpenWindowBtn.hidden = !enabled;
  }
  if (monitorWindowHint) {
    monitorWindowHint.hidden = enabled;
  }
  if (monitorValidationMsg) {
    monitorValidationMsg.hidden = count > 0;
    if (count === 0) {
      const body = monitorValidationMsg.querySelector('.monitor-validation-body');
      if (body) {
        body.textContent =
          'Groopa needs at least one tracked Facebook group before monitoring can begin. Visit a group on Facebook so Groopa can detect it, or add one manually.';
      }
    }
  }
}

async function refreshMonitorStatus() {
  const settings = await getSettings();
  renderMonitorStatus(settings);
}

function formatRelativeTime(isoDateString) {
  if (!isoDateString) return '—';
  try {
    const d = new Date(isoDateString);
    if (isNaN(d.getTime())) return '—';
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return diffSec + 's ago';
    if (diffMin < 60) return diffMin + ' min ago';
    if (diffHr < 24) return diffHr + ' hr ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '—';
  }
}

function renderKeywords() {
  keywordsListEl.innerHTML = '';
  keywordList.forEach((kw, index) => {
    const tag = document.createElement('span');
    tag.className = 'keyword-tag';
    tag.innerHTML = escapeOpt(kw) + ' <button type="button" class="keyword-tag-remove" data-index="' + index + '" aria-label="Remove">×</button>';
    keywordsListEl.appendChild(tag);
  });
  keywordsListEl.querySelectorAll('.keyword-tag-remove').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index, 10);
      keywordList = keywordList.filter((_, i) => i !== index);
      await saveSettings({ keywords: keywordList });
      renderKeywords();
      updateSummaryCounts();
    });
  });
}

function showAddGroupForm() {
  if (addGroupFormEl) {
    addGroupFormEl.hidden = false;
    addGroupUrlInput && addGroupUrlInput.focus();
  }
}

function hideAddGroupForm() {
  if (addGroupFormEl) addGroupFormEl.hidden = true;
  if (addGroupUrlInput) addGroupUrlInput.value = '';
  if (addGroupErrorEl) addGroupErrorEl.textContent = '';
}

if (addManuallyBtn) {
  addManuallyBtn.addEventListener('click', () => showAddGroupForm());
}

if (addGroupCancelBtn) {
  addGroupCancelBtn.addEventListener('click', () => hideAddGroupForm());
}

if (addGroupBtn && addGroupUrlInput) {
  addGroupBtn.addEventListener('click', async () => {
    if (addGroupErrorEl) addGroupErrorEl.textContent = '';
    const raw = (addGroupUrlInput.value || '').trim();
    const parsed = parseFacebookGroupUrl(raw);
    if (!parsed) {
      if (addGroupErrorEl) addGroupErrorEl.textContent = 'Please enter a valid Facebook group URL (e.g. https://www.facebook.com/groups/...).';
      return;
    }
    const group = { id: parsed.slug, name: '', url: parsed.url };
    try {
      await upsertDetectedGroup({ ...group, slug: parsed.slug, source: 'manual' });
      await addTrackedGroup(group);
      addGroupUrlInput.value = '';
      hideAddGroupForm();
      detectedGroupsList = await getDetectedGroups();
      trackedGroupsList = await getTrackedGroups();
      renderDetectedGroups();
      await refreshMonitorStatus();
    } catch (err) {
      if (addGroupErrorEl) addGroupErrorEl.textContent = err && err.message ? err.message : 'Could not add group.';
    }
  });
}

if (keywordAddBtn && keywordInput) {
  keywordAddBtn.addEventListener('click', async () => {
    const raw = (keywordInput.value || '').trim();
    if (!raw) return;
    if (keywordList.includes(raw)) {
      keywordInput.value = '';
      return;
    }
    keywordList.push(raw);
    await saveSettings({ keywords: keywordList });
    renderKeywords();
    updateSummaryCounts();
    keywordInput.value = '';
  });
  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      keywordAddBtn.click();
    }
  });
}

soundCheckbox.addEventListener('change', async () => {
  await saveSettings({ soundEnabled: soundCheckbox.checked });
});

paidCheckbox.addEventListener('change', async () => {
  await saveSettings({ isPaidUser: paidCheckbox.checked });
  updateAccountPanel(paidCheckbox.checked);
});

function isTracked(groupId) {
  return trackedGroupsList.some((g) => String(g.id) === String(groupId));
}

function renderDetectedGroups() {
  if (detectedGroupsList.length === 0) {
    detectedGroupsEl.innerHTML =
      '<div class="groups-empty-wrap">' +
      '<p class="groups-empty-title">No groups detected yet.</p>' +
      '<p class="groups-empty-hint">Visit Facebook groups you are already a member of, or join new ones, and Groopa will detect them here.</p>' +
      '</div>';
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
  const list = detectedGroupsList.slice().sort((a, b) => {
    const aTime = a && a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0;
    const bTime = b && b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0;
    return bTime - aTime;
  });
  detectedGroupsEl.innerHTML = list
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
      await refreshMonitorStatus();
      updateSummaryCounts();
    });
  });
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

/**
 * Update header stats (total and new count) and empty vs two-panel visibility.
 */
function updateInboxHeaderAndPanels() {
  const list = detectionsList || [];
  const total = list.length;
  const newCount = list.filter((d) => d && d.status === 'new').length;
  if (inboxStatTotalEl) inboxStatTotalEl.textContent = total === 1 ? '1 lead' : total + ' leads';
  if (inboxStatNewEl) {
    inboxStatNewEl.hidden = newCount === 0;
    inboxStatNewEl.textContent = newCount > 0 ? newCount + ' new' : '';
  }
  if (inboxEmptyStateEl) inboxEmptyStateEl.hidden = total > 0;
  if (inboxTwoPanelsEl) inboxTwoPanelsEl.hidden = total === 0;
}

/**
 * Apply selected state to list rows (add/remove inbox-row--selected by fingerprint).
 */
function updateInboxRowSelection() {
  if (!inboxListEl) return;
  const fp = selectedInboxDetection && selectedInboxDetection.fingerprint ? selectedInboxDetection.fingerprint : '';
  inboxListEl.querySelectorAll('.inbox-row-btn').forEach((btn) => {
    btn.classList.toggle('inbox-row--selected', btn.dataset.fingerprint === fp);
  });
}

function renderInbox() {
  if (!inboxListEl) return;
  const list = detectionsList.slice(0, 50);
  updateInboxHeaderAndPanels();

  if (list.length === 0) {
    inboxListEl.innerHTML = '';
    selectedInboxDetection = null;
    return;
  }

  const snippetLen = 72;
  inboxListEl.innerHTML = list
    .map((d, index) => {
      const groupLabel = escapeOpt(d.groupName || d.groupIdentifier || 'Group');
      const text = d.text != null ? d.text : (d.textPreview != null ? d.textPreview : '');
      const snippet = text.length > snippetLen ? text.slice(0, snippetLen) + '…' : text;
      const keywordLabel = escapeOpt(d.keywordMatched != null ? d.keywordMatched : (Array.isArray(d.matchedKeywords) ? d.matchedKeywords.join(', ') : ''));
      const dateStr = formatOptDate(d.createdAt);
      const relativeTime = formatRelativeTime(d.createdAt);
      const isUnread = d.status === 'new';
      const fp = (d.fingerprint != null ? String(d.fingerprint) : '') || 'idx-' + index;
      const unreadClass = isUnread ? ' inbox-row--unread' : '';
      return `<button type="button" class="inbox-row inbox-row-btn${unreadClass}" data-index="${index}" data-fingerprint="${escapeOpt(fp)}" role="listitem">
        <div class="inbox-row-top">
          <span class="inbox-row-group">${groupLabel}</span>
          <span class="inbox-row-date">${escapeOpt(relativeTime)}</span>
        </div>
        <div class="inbox-row-snippet">${escapeOpt(snippet)}</div>
        <div class="inbox-row-meta">
          <span class="inbox-row-keyword">${keywordLabel}</span>
        </div>
      </button>`;
    })
    .join('');

  inboxListEl.querySelectorAll('.inbox-row-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      const detection = detectionsList[index];
      if (detection) {
        selectedInboxDetection = detection;
        showInboxDetailContent(detection);
        updateInboxRowSelection();
      }
    });
  });

  // If selection is no longer in list (e.g. after storage refresh), clear it
  if (selectedInboxDetection && list.findIndex((d) => d.fingerprint === selectedInboxDetection.fingerprint) < 0) {
    selectedInboxDetection = null;
    if (inboxDetailPlaceholderEl) inboxDetailPlaceholderEl.hidden = false;
    if (inboxDetailContentEl) inboxDetailContentEl.hidden = true;
  }
  // Auto-select first lead when none selected
  if (list.length > 0 && !selectedInboxDetection) {
    selectedInboxDetection = list[0];
    showInboxDetailContent(list[0]);
  }
  updateInboxRowSelection();
}

function showInboxDetailContent(detection) {
  if (!detection) return;
  generatedReplyText = '';
  const groupLabel = detection.groupName || detection.groupIdentifier || 'Group';
  const text = detection.text != null ? detection.text : (detection.textPreview != null ? detection.textPreview : '');
  const keywordLabel = detection.keywordMatched != null ? detection.keywordMatched : (Array.isArray(detection.matchedKeywords) ? detection.matchedKeywords.join(', ') : '');
  if (inboxDetailGroup) inboxDetailGroup.textContent = groupLabel;
  if (inboxDetailTime) inboxDetailTime.textContent = 'Detected ' + formatOptDate(detection.createdAt);
  if (inboxDetailKeywords) inboxDetailKeywords.textContent = 'Matched: ' + keywordLabel;
  if (inboxDetailText) inboxDetailText.textContent = text || '—';
  if (inboxReplyTextEl) inboxReplyTextEl.textContent = 'Reply will appear here after you click Generate AI Reply.';
  if (inboxOpenPostLink) {
    inboxOpenPostLink.href = detection.pageUrl || '#';
    inboxOpenPostLink.style.display = detection.pageUrl ? 'inline-block' : 'none';
  }
  if (inboxDetailPlaceholderEl) inboxDetailPlaceholderEl.hidden = true;
  if (inboxDetailContentEl) inboxDetailContentEl.hidden = false;
}

function showInboxDetail(detection) {
  selectedInboxDetection = detection;
  if (detection) showInboxDetailContent(detection);
  else {
    if (inboxDetailPlaceholderEl) inboxDetailPlaceholderEl.hidden = false;
    if (inboxDetailContentEl) inboxDetailContentEl.hidden = true;
  }
  updateInboxRowSelection();
}

function showInboxList() {
  selectedInboxDetection = null;
  generatedReplyText = '';
  if (inboxDetailPlaceholderEl) inboxDetailPlaceholderEl.hidden = false;
  if (inboxDetailContentEl) inboxDetailContentEl.hidden = true;
  updateInboxRowSelection();
}

if (inboxDetailBack) {
  inboxDetailBack.addEventListener('click', () => showInboxList());
}

if (inboxDetailAiBtn) {
  inboxDetailAiBtn.addEventListener('click', () => {
    generatedReplyText = 'AI reply will be tailored to your business. This is a placeholder until the AI is connected.';
    if (inboxReplyTextEl) inboxReplyTextEl.textContent = generatedReplyText;
  });
}

if (inboxCopyReplyBtn) {
  inboxCopyReplyBtn.addEventListener('click', () => {
    const text = generatedReplyText || (inboxReplyTextEl ? inboxReplyTextEl.textContent : '');
    if (!text || text.startsWith('Reply will appear')) return;
    navigator.clipboard.writeText(text).then(() => {
      inboxCopyReplyBtn.textContent = 'Copied!';
      setTimeout(() => { inboxCopyReplyBtn.textContent = 'Copy Reply'; }, 1500);
    }).catch(() => {});
  });
}

if (inboxOpenPostLink) {
  inboxOpenPostLink.addEventListener('click', (e) => {
    if (!selectedInboxDetection || !selectedInboxDetection.pageUrl) e.preventDefault();
  });
}

function showDemoMessage(text) {
  if (demoMessageEl) {
    demoMessageEl.textContent = text;
    setTimeout(() => {
      if (demoMessageEl) demoMessageEl.textContent = '';
    }, 2500);
  }
}

loadDemoBtn.addEventListener('click', async () => {
  detectedGroupsList = DEMO_DETECTED_GROUPS.slice();
  trackedGroupsList = DEMO_DETECTED_GROUPS.filter((g) => DEMO_TRACKED_GROUP_IDS.indexOf(String(g.id)) !== -1).map((g) => ({ id: g.id, name: g.name, url: g.url }));
  await saveDetectedGroups(detectedGroupsList);
  await saveTrackedGroups(trackedGroupsList);
  await saveDetections(DEMO_DETECTIONS);
  detectionsList = DEMO_DETECTIONS.slice();
  renderDetectedGroups();
  renderInbox();
  updateSummaryCounts();
  await refreshMonitorStatus();
  showDemoMessage('Demo data loaded. Open the popup to see it.');
});

clearDemoBtn.addEventListener('click', async () => {
  detectedGroupsList = [];
  trackedGroupsList = [];
  detectionsList = [];
  await clearDemoData();
  renderDetectedGroups();
  renderInbox();
  updateSummaryCounts();
  await refreshMonitorStatus();
  showDemoMessage('Demo data cleared.');
});

if (monitorStartBtn) {
  monitorStartBtn.addEventListener('click', async () => {
    const settings = await getSettings();
    const tracked = Array.isArray(settings.trackedGroups) ? settings.trackedGroups : [];
    if (tracked.length === 0) {
      if (monitorValidationMsg) monitorValidationMsg.hidden = false;
      return;
    }
    try {
      const reply = await chrome.runtime.sendMessage({ type: 'START_MONITORING' });
      if (reply && reply.ok === false && reply.error) {
        if (monitorValidationMsg) {
          monitorValidationMsg.querySelector('.monitor-validation-body').textContent = reply.error;
          monitorValidationMsg.hidden = false;
        }
        return;
      }
      await refreshMonitorStatus();
    } catch (e) {
      console.error('Start monitoring failed', e);
      if (monitorValidationMsg) {
        monitorValidationMsg.querySelector('.monitor-validation-body').textContent =
          'Could not start monitoring. Try again or add a tracked group first.';
        monitorValidationMsg.hidden = false;
      }
    }
  });
}
if (monitorStopBtn) {
  monitorStopBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'STOP_MONITORING' });
      await refreshMonitorStatus();
    } catch (e) {
      console.error('Stop monitoring failed', e);
    }
  });
}
if (monitorOpenWindowBtn) {
  monitorOpenWindowBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_MONITOR_WINDOW' });
    } catch (e) {
      console.error('Open monitor window failed', e);
    }
  });
}

// Sidebar navigation: switch panel and optionally notify (e.g. INBOX_OPENED when opening Inbox)
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panelId = btn.dataset.panel;
    if (!panelId) return;
    switchToPanel(panelId);
  });
});

// One-click open Inbox from Monitoring: Leads card and Open Inbox button
if (summaryLeadsCardEl) {
  summaryLeadsCardEl.addEventListener('click', () => switchToPanel('inbox'));
  summaryLeadsCardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchToPanel('inbox');
    }
  });
}
if (openInboxBtn) {
  openInboxBtn.addEventListener('click', () => switchToPanel('inbox'));
}

/**
 * Reload detections from storage and re-render the inbox. Used on initial load and when storage changes.
 */
async function refreshInboxFromStorage() {
  const list = await getDetections();
  detectionsList = Array.isArray(list) ? list.slice() : [];
  renderInbox();
  updateSummaryCounts();
}

// When storage changes, update the UI and summary counts without full page refresh
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (!changes) return;
  if (areaName === 'local') {
    if (changes.detections) {
      refreshInboxFromStorage();
    }
    if (changes.detectedGroups) {
      const value = changes.detectedGroups.newValue;
      detectedGroupsList = Array.isArray(value) ? value.slice() : [];
      renderDetectedGroups();
    }
    if (changes.trackedGroups) {
      const value = changes.trackedGroups.newValue;
      trackedGroupsList = Array.isArray(value) ? value.slice() : [];
      updateSummaryCounts();
    }
  }
  if (areaName === 'sync' && changes.keywords) {
    const value = changes.keywords.newValue;
    keywordList = Array.isArray(value) ? value.slice() : [];
    renderKeywords();
    updateSummaryCounts();
  }
});

// Refresh monitor section (e.g. "Last run: 2 min ago") every 8s so relative time stays current
const MONITOR_REFRESH_INTERVAL_MS = 8000;
setInterval(() => refreshMonitorStatus(), MONITOR_REFRESH_INTERVAL_MS);

loadPage();

if (scanGroupsBtn) {
  scanGroupsBtn.addEventListener('click', () => {
    if (isScanningGroups) return;
    isScanningGroups = true;
    scanGroupsBtn.disabled = true;
    setScanGroupsStatus('scanning');
    try {
      chrome.runtime.sendMessage({ type: 'START_GROUP_MEMBERSHIP_SCAN' }, (response) => {
        if (chrome.runtime.lastError || (response && response.ok === false)) {
          isScanningGroups = false;
          scanGroupsBtn.disabled = false;
          const msg =
            (response && response.error) ||
            (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
            'Could not start group scan. Please try again.';
          setScanGroupsStatus('error', msg);
        }
      });
    } catch (e) {
      isScanningGroups = false;
      scanGroupsBtn.disabled = false;
      setScanGroupsStatus('error');
    }
  });
}

// Listen for membership scan completion from background and update status + button state
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === 'GROUP_MEMBERSHIP_SCAN_COMPLETED') {
    isScanningGroups = false;
    if (scanGroupsBtn) scanGroupsBtn.disabled = false;
    if (message.error) {
      setScanGroupsStatus('error', message.error);
    } else {
      const count = typeof message.count === 'number' ? message.count : 0;
      setScanGroupsStatus('success', count);
    }
  }
});
