// Groopa options page — dashboard layout, save/load via storage

const paidCheckbox = document.getElementById('paid-user');
const soundCheckbox = document.getElementById('sound-enabled');
const desktopAlertsCheckbox = document.getElementById('desktop-alerts-enabled');
const keywordInput = document.getElementById('keyword-input');
const keywordAddBtn = document.getElementById('keyword-add-btn');
const keywordsListEl = document.getElementById('keywords-list');
const keywordsEmptyEl = document.getElementById('keywords-empty');
const loadDemoBtn = document.getElementById('load-demo-btn');
const clearDemoBtn = document.getElementById('clear-demo-btn');
const demoMessageEl = document.getElementById('demo-message');
const runFeedExperimentBtn = document.getElementById('run-feed-experiment-btn');
const feedExperimentMessageEl = document.getElementById('feed-experiment-message');
const detectedGroupsEl = document.getElementById('detected-groups');
const inboxListEl = document.getElementById('inbox-list');
const inboxLayoutEl = document.getElementById('inbox-layout');
const inboxEmptyStateEl = document.getElementById('inbox-empty-state');
const inboxTwoPanelsEl = document.getElementById('inbox-two-panels');
const inboxStatTotalEl = document.getElementById('inbox-stat-total');
const inboxStatNewEl = document.getElementById('inbox-stat-new');
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
const groupsScanningStateEl = document.getElementById('groups-scanning-state');
const summaryKeywordsCountEl = document.getElementById('summary-keywords-count');
const summaryGroupsCountEl = document.getElementById('summary-groups-count');
const summaryLeadsCountEl = document.getElementById('summary-leads-count');
const summaryLeadsCardEl = document.getElementById('summary-leads');
const openInboxBtn = document.getElementById('open-inbox-btn');
const suggestedKeywordsWrapEl = document.getElementById('suggested-keywords-wrap');
const suggestedKeywordsListEl = document.getElementById('suggested-keywords-list');
const suggestedAddAllBtn = document.getElementById('suggested-add-all-btn');
const telegramEnabledCheckbox = document.getElementById('telegram-enabled');
const telegramStatusTextEl = document.getElementById('telegram-status-text');
const telegramConnectBtn = document.getElementById('telegram-connect-btn');

let detectedGroupsList = [];
let trackedGroupsList = [];
let keywordList = [];
let detectionsList = [];
let selectedInboxDetection = null;
let generatedReplyText = '';
let isScanningGroups = false;
/** Suggestions for the last-added keyword; only shown in UI, not stored until user clicks Add. */
let currentSuggestions = [];

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
 * Normalize keyword for duplicate check (trim, lowercase).
 */
function normalizeKeywordForCompare(kw) {
  return (kw != null ? String(kw).trim() : '').toLowerCase();
}

/**
 * Generate 5–12 related keyword suggestions for Facebook lead phrasing.
 * Local template-based MVP: direct variants, recommendation phrases, problem/urgency phrases.
 * Does not call any API; safe to run in extension without backend.
 */
function getKeywordSuggestions(keyword) {
  const raw = (keyword != null ? String(keyword).trim() : '');
  if (!raw) return [];
  const k = raw.toLowerCase();
  const cap = (s) => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);
  const stem = k.replace(/er$/i, '').replace(/s$/i, '');
  const stemCap = stem.length > 0 ? stem[0].toUpperCase() + stem.slice(1) : stem;
  const stemIng = stem ? stem + (stem.endsWith('e') ? 'ing' : 'ing') : '';
  const stemIngCap = stemIng ? stemIng[0].toUpperCase() + stemIng.slice(1) : stemIng;
  const wordCap = cap(raw);
  const templates = [
    stemCap + ' repair',
    stemIngCap + ' company',
    'leaking ' + stemCap,
    stemCap + ' tiles',
    'recommend a ' + wordCap,
    'anyone know a ' + wordCap,
    'emergency ' + wordCap,
    wordCap + ' repair',
    wordCap + ' company',
    'looking for ' + wordCap,
    'need a ' + wordCap,
    'good ' + wordCap,
    'best ' + wordCap,
    wordCap + ' near me',
    wordCap + ' recommendation',
  ];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < templates.length && out.length < 12; i++) {
    const t = templates[i].trim();
    const n = normalizeKeywordForCompare(t);
    if (n && n !== normalizeKeywordForCompare(raw) && !seen.has(n)) {
      seen.add(n);
      out.push(t);
    }
  }
  return out.slice(0, 12);
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

function setScanningUI(scanning) {
  if (groupsScanningStateEl) groupsScanningStateEl.hidden = !scanning;
  if (scanGroupsBtn) {
    scanGroupsBtn.disabled = scanning;
    scanGroupsBtn.textContent = scanning ? 'Scanning…' : 'Scan my groups';
  }
  const card = scanGroupsBtn && scanGroupsBtn.closest('.card-groups');
  if (card) card.classList.toggle('is-scanning', !!scanning);
}

function setScanGroupsStatus(state, extra) {
  if (state === 'scanning') {
    setScanningUI(true);
  } else if (state === 'success' || state === 'error' || state === '') {
    setScanningUI(false);
  }
  if (!scanGroupsStatusEl) return;
  if (state === 'scanning') {
    scanGroupsStatusEl.textContent = 'Scanning your Facebook groups…';
  } else if (state === 'status') {
    scanGroupsStatusEl.textContent = extra || 'Scanning…';
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
  if (desktopAlertsCheckbox) desktopAlertsCheckbox.checked = settings.desktopAlertsEnabled !== false;
  const telegram = settings.telegram;
  if (telegramEnabledCheckbox) telegramEnabledCheckbox.checked = telegram && telegram.enabled === true;
  if (telegramStatusTextEl) telegramStatusTextEl.textContent = getTelegramStatusLabel(telegram);
  keywordList = Array.isArray(settings.keywords) ? settings.keywords.slice() : [];
  detectedGroupsList = Array.isArray(settings.detectedGroups) ? settings.detectedGroups.slice() : [];
  trackedGroupsList = Array.isArray(settings.trackedGroups) ? settings.trackedGroups.slice() : [];

  renderKeywords();
  renderSuggestedKeywords();
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

/**
 * Map telegram.status to user-facing status text. If connected and username exists, show "Connected as @username".
 */
function getTelegramStatusLabel(telegram) {
  const prefix = 'Status: ';
  if (!telegram || typeof telegram !== 'object') return prefix + 'Not connected';
  const status = String(telegram.status || 'disconnected').toLowerCase();
  const map = {
    disconnected: 'Not connected',
    pending: 'Connecting…',
    connected: 'Connected',
    error: 'Connection error',
  };
  const label = map[status] || 'Not connected';
  if (status === 'connected' && telegram.username) {
    const user = String(telegram.username).replace(/^@/, '');
    return prefix + 'Connected as @' + user;
  }
  return prefix + label;
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
      renderSuggestedKeywords();
      updateSummaryCounts();
    });
  });
}

/**
 * Render suggested keywords (from last added keyword). Hides suggestions already in keywordList.
 * Only suggestions that are not yet tracked are shown; each has Add, and Add all adds the rest.
 */
function renderSuggestedKeywords() {
  if (!suggestedKeywordsListEl || !suggestedKeywordsWrapEl) return;
  const existingSet = new Set(keywordList.map(normalizeKeywordForCompare));
  const toShow = currentSuggestions.filter((s) => !existingSet.has(normalizeKeywordForCompare(s)));
  suggestedKeywordsListEl.innerHTML = '';
  if (toShow.length === 0) {
    suggestedKeywordsWrapEl.hidden = true;
    return;
  }
  suggestedKeywordsWrapEl.hidden = false;
  toShow.forEach((phrase) => {
    const chip = document.createElement('div');
    chip.className = 'suggestion-chip';
    const text = document.createElement('span');
    text.className = 'suggestion-chip-text';
    text.textContent = phrase;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary suggestion-chip-add';
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', async () => {
      const norm = normalizeKeywordForCompare(phrase);
      if (keywordList.some((kw) => normalizeKeywordForCompare(kw) === norm)) return;
      keywordList.push(phrase);
      await saveSettings({ keywords: keywordList });
      renderKeywords();
      renderSuggestedKeywords();
      updateSummaryCounts();
    });
    chip.appendChild(text);
    chip.appendChild(addBtn);
    suggestedKeywordsListEl.appendChild(chip);
  });
  if (suggestedAddAllBtn) {
    suggestedAddAllBtn.onclick = async () => {
      const existingSet2 = new Set(keywordList.map(normalizeKeywordForCompare));
      const toAdd = currentSuggestions.filter((s) => !existingSet2.has(normalizeKeywordForCompare(s)));
      toAdd.forEach((s) => {
        const n = normalizeKeywordForCompare(s);
        if (!keywordList.some((kw) => normalizeKeywordForCompare(kw) === n)) keywordList.push(s);
      });
      await saveSettings({ keywords: keywordList });
      renderKeywords();
      renderSuggestedKeywords();
      updateSummaryCounts();
    };
  }
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
    const norm = normalizeKeywordForCompare(raw);
    if (keywordList.some((kw) => normalizeKeywordForCompare(kw) === norm)) {
      keywordInput.value = '';
      return;
    }
    keywordList.push(raw);
    await saveSettings({ keywords: keywordList });
    renderKeywords();
    updateSummaryCounts();
    keywordInput.value = '';
    currentSuggestions = getKeywordSuggestions(raw);
    renderSuggestedKeywords();
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
if (desktopAlertsCheckbox) {
  desktopAlertsCheckbox.addEventListener('change', async () => {
    await saveSettings({ desktopAlertsEnabled: desktopAlertsCheckbox.checked });
  });
}
if (telegramEnabledCheckbox) {
  telegramEnabledCheckbox.addEventListener('change', async () => {
    if (typeof updateTelegramSettings === 'function') {
      await updateTelegramSettings({ enabled: telegramEnabledCheckbox.checked });
    }
  });
}
if (telegramConnectBtn) {
  telegramConnectBtn.addEventListener('click', () => {
    console.log('[Groopa] Connect Telegram clicked (placeholder)');
    if (telegramStatusTextEl) {
      const prev = telegramStatusTextEl.textContent;
      telegramStatusTextEl.textContent = 'Status: Connecting…';
      setTimeout(() => {
        telegramStatusTextEl.textContent = prev;
      }, 1500);
    }
  });
}

paidCheckbox.addEventListener('change', async () => {
  await saveSettings({ isPaidUser: paidCheckbox.checked });
  updateAccountPanel(paidCheckbox.checked);
});

function isTracked(groupId) {
  return trackedGroupsList.some((g) => String(g.id) === String(groupId));
}

function renderDetectedGroups() {
  if (detectedGroupsList.length === 0) {
    detectedGroupsEl.innerHTML = '';
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
      (g, index) => {
        const tracked = isTracked(g.id);
        return `<div class="group-row${tracked ? ' group-row--tracked' : ''}" data-index="${index}" role="button" tabindex="0" aria-pressed="${tracked}" aria-label="Toggle track ${escapeOpt(g.name || 'group')}">
          <div class="group-info">
            <div class="group-name">${escapeOpt(g.name || '')}</div>
            <div class="group-url"><a href="${escapeOpt(g.url || '#')}" target="_blank" rel="noopener">${escapeOpt(g.url || '')}</a></div>
            <div class="group-meta">Source: ${escapeOpt(g.source || '—')} · Last seen: ${formatOptDate(g.lastSeenAt)}</div>
          </div>
          <div class="track-option">
            <input type="checkbox" id="track-${index}" ${tracked ? 'checked' : ''} data-id="${escapeOpt(g.id)}" data-name="${escapeOpt(g.name || '')}" data-url="${escapeOpt(g.url || '')}" aria-hidden="true" tabindex="-1" />
            <span class="track-option-label">Track</span>
          </div>
        </div>`;
      }
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
      const row = cb.closest('.group-row');
      if (row) {
        row.classList.toggle('group-row--tracked', cb.checked);
        row.setAttribute('aria-pressed', cb.checked ? 'true' : 'false');
      }
    });
  });
}

// Full-row click to toggle tracking (delegated)
if (detectedGroupsEl) {
  detectedGroupsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.group-row');
    if (!row) return;
    if (e.target.closest('a')) return;
    const cb = row.querySelector('.track-option input[type="checkbox"]');
    if (!cb) return;
    if (e.target === cb) return;
    e.preventDefault();
    cb.click();
  });
  detectedGroupsEl.addEventListener('keydown', (e) => {
    const row = e.target.closest('.group-row');
    if (!row || e.target.closest('a')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const cb = row.querySelector('.track-option input[type="checkbox"]');
      if (cb) cb.click();
    }
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
 * Update header stats (total and new count). When 0 leads, show only empty state and remove
 * the split layout from the DOM so no blank panel is visible. When 1+ leads, show split layout.
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
  if (total === 0) {
    if (inboxEmptyStateEl) inboxEmptyStateEl.hidden = false;
    if (inboxTwoPanelsEl && inboxTwoPanelsEl.parentNode && inboxLayoutEl) {
      inboxLayoutEl.removeChild(inboxTwoPanelsEl);
    }
  } else {
    if (inboxEmptyStateEl) inboxEmptyStateEl.hidden = true;
    if (inboxTwoPanelsEl && !inboxTwoPanelsEl.parentNode && inboxLayoutEl) {
      inboxLayoutEl.appendChild(inboxTwoPanelsEl);
    }
  }
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
      const rawText = d.text != null ? d.text : (d.textPreview != null ? d.textPreview : '');
      const text = typeof cleanLeadDisplayText === 'function' ? cleanLeadDisplayText(rawText) : rawText;
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
    if (inboxDetailContentEl) inboxDetailContentEl.hidden = true;
  }
  // Auto-select newest lead when none selected (list is already newest-first)
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
  const rawText = detection.text != null ? detection.text : (detection.textPreview != null ? detection.textPreview : '');
  const text = typeof cleanLeadDisplayText === 'function' ? cleanLeadDisplayText(rawText) : rawText;
  const keywordLabel = detection.keywordMatched != null ? detection.keywordMatched : (Array.isArray(detection.matchedKeywords) ? detection.matchedKeywords.join(', ') : '');
  if (inboxDetailGroup) inboxDetailGroup.textContent = groupLabel;
  if (inboxDetailTime) inboxDetailTime.textContent = 'Detected ' + formatOptDate(detection.createdAt);
  if (inboxDetailKeywords) inboxDetailKeywords.textContent = 'Matched: ' + keywordLabel;
  if (inboxDetailText) inboxDetailText.textContent = text || '—';
  if (inboxReplyTextEl) inboxReplyTextEl.textContent = 'Reply will appear here after you click Generate AI Reply.';
  if (inboxOpenPostLink) {
    const openUrl = detection.postUrl || detection.pageUrl || '#';
    inboxOpenPostLink.href = openUrl;
    inboxOpenPostLink.style.display = openUrl !== '#' ? 'inline-block' : 'none';
  }
  if (inboxDetailContentEl) inboxDetailContentEl.hidden = false;
}

function showInboxDetail(detection) {
  selectedInboxDetection = detection;
  if (detection) showInboxDetailContent(detection);
  else if (inboxDetailContentEl) inboxDetailContentEl.hidden = true;
  updateInboxRowSelection();
}

function showInboxList() {
  selectedInboxDetection = null;
  generatedReplyText = '';
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
    if (!selectedInboxDetection || !(selectedInboxDetection.postUrl || selectedInboxDetection.pageUrl)) e.preventDefault();
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

function handleStartMonitoring() {
  return (async () => {
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
  })();
}
if (monitorStartBtn) {
  monitorStartBtn.addEventListener('click', () => handleStartMonitoring());
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
 * Sorts newest first (by createdAt) so the inbox behaves like a real inbox.
 */
async function refreshInboxFromStorage() {
  const list = await getDetections();
  const raw = Array.isArray(list) ? list.slice() : [];
  detectionsList = raw.sort((a, b) => (new Date(b.createdAt || 0)).getTime() - (new Date(a.createdAt || 0)).getTime());
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
    renderSuggestedKeywords();
    updateSummaryCounts();
  }
});

// Refresh monitor section (e.g. "Last run: 2 min ago") every 8s so relative time stays current
const MONITOR_REFRESH_INTERVAL_MS = 8000;
setInterval(() => refreshMonitorStatus(), MONITOR_REFRESH_INTERVAL_MS);

loadPage().then(() => {
  chrome.storage.local.get(['groopaOpenInboxOnNextLoad'], (r) => {
    if (r.groopaOpenInboxOnNextLoad) {
      switchToPanel('inbox');
      chrome.storage.local.remove('groopaOpenInboxOnNextLoad');
    }
  });
});

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

if (runFeedExperimentBtn && feedExperimentMessageEl) {
  runFeedExperimentBtn.addEventListener('click', () => {
    feedExperimentMessageEl.textContent = 'Running… Open /groups/feed if prompted, then check console and Activity log.';
    runFeedExperimentBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'RUN_GROUP_FEED_EXPERIMENT' }, (response) => {
      runFeedExperimentBtn.disabled = false;
      if (chrome.runtime.lastError) {
        feedExperimentMessageEl.textContent = 'Error: ' + (chrome.runtime.lastError.message || 'Unknown');
        return;
      }
      if (response && response.ok) {
        const n = (response.candidates && response.candidates.length) || 0;
        feedExperimentMessageEl.textContent = 'Done. ' + n + ' candidate(s). Check DevTools console and Activity log for details.';
      } else {
        feedExperimentMessageEl.textContent = (response && response.error) || 'Experiment failed.';
      }
    });
  });
}

// Listen for membership scan status and completion from background
chrome.runtime.onMessage.addListener((message) => {
  if (!message || !message.type) return;
  if (message.type === 'GROUP_MEMBERSHIP_SCAN_STATUS' && message.message) {
    setScanGroupsStatus('status', message.message);
  } else if (message.type === 'GROUP_MEMBERSHIP_SCAN_COMPLETED') {
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
