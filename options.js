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
const inboxListWrap = document.getElementById('inbox-list-wrap');
const inboxDetailEl = document.getElementById('inbox-detail');
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
const accountPlanEl = document.getElementById('account-plan');
const accountVersionEl = document.getElementById('account-version');
const sidebarVersionEl = document.getElementById('sidebar-version');

let detectedGroupsList = [];
let trackedGroupsList = [];
let keywordList = [];
let detectionsList = [];
let selectedInboxDetection = null;
let generatedReplyText = '';

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

async function loadPage() {
  const settings = await getSettings();
  paidCheckbox.checked = settings.isPaidUser;
  soundCheckbox.checked = settings.soundEnabled;
  keywordList = Array.isArray(settings.keywords) ? settings.keywords.slice() : [];
  detectedGroupsList = Array.isArray(settings.detectedGroups) ? settings.detectedGroups.slice() : [];
  trackedGroupsList = Array.isArray(settings.trackedGroups) ? settings.trackedGroups.slice() : [];
  detectionsList = Array.isArray(settings.detections) ? settings.detections.slice() : [];

  renderKeywords();
  renderDetectedGroups();
  renderInbox();
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
}

function updateAccountPanel(isPaidUser) {
  if (accountPlanEl) {
    accountPlanEl.textContent = isPaidUser ? 'Paid' : 'Free';
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
    });
  });
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
      detectedGroupsList = await getDetectedGroups();
      trackedGroupsList = await getTrackedGroups();
      renderDetectedGroups();
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

function formatOptDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return iso;
  }
}

function renderInbox() {
  if (!inboxListEl) return;
  const list = detectionsList.slice(0, 50);
  if (list.length === 0) {
    inboxListEl.innerHTML = '<p class="inbox-empty">No leads yet. Add keywords and track groups to start.</p>';
    return;
  }
  const previewLen = 80;
  inboxListEl.innerHTML = list
    .map((d, index) => {
      const groupLabel = escapeOpt(d.groupName || d.groupIdentifier || 'Group');
      const text = d.text != null ? d.text : (d.textPreview != null ? d.textPreview : '');
      const preview = text.length > previewLen ? text.slice(0, previewLen) + '…' : text;
      const keywordLabel = escapeOpt(d.keywordMatched != null ? d.keywordMatched : (Array.isArray(d.matchedKeywords) ? d.matchedKeywords.join(', ') : ''));
      const dateStr = formatOptDate(d.createdAt);
      return `<button type="button" class="inbox-row inbox-row-btn" data-index="${index}">
        <div class="inbox-row-main">
          <span class="inbox-row-group">${groupLabel}</span>
          <span class="inbox-row-keyword">${keywordLabel}</span>
          <span class="inbox-row-date">${dateStr}</span>
        </div>
        <div class="inbox-row-preview">${escapeOpt(preview)}</div>
      </button>`;
    })
    .join('');

  inboxListEl.querySelectorAll('.inbox-row-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      const detection = detectionsList[index];
      if (detection) showInboxDetail(detection);
    });
  });
}

function showInboxDetail(detection) {
  selectedInboxDetection = detection;
  generatedReplyText = '';
  const groupLabel = detection.groupName || detection.groupIdentifier || 'Group';
  const text = detection.text != null ? detection.text : (detection.textPreview != null ? detection.textPreview : '');
  const keywordLabel = detection.keywordMatched != null ? detection.keywordMatched : (Array.isArray(detection.matchedKeywords) ? detection.matchedKeywords.join(', ') : '');
  if (inboxDetailGroup) inboxDetailGroup.textContent = groupLabel;
  if (inboxDetailTime) inboxDetailTime.textContent = 'Detected ' + formatOptDate(detection.createdAt);
  if (inboxDetailText) inboxDetailText.textContent = text || '—';
  if (inboxDetailKeywords) inboxDetailKeywords.textContent = 'Matched: ' + keywordLabel;
  if (inboxReplyTextEl) inboxReplyTextEl.textContent = 'Reply will appear here after you click Generate AI Reply.';
  if (inboxOpenPostLink) {
    inboxOpenPostLink.href = detection.pageUrl || '#';
    inboxOpenPostLink.style.display = detection.pageUrl ? 'inline-block' : 'none';
  }
  if (inboxListEl) inboxListEl.hidden = true;
  if (inboxDetailEl) inboxDetailEl.hidden = false;
}

function showInboxList() {
  selectedInboxDetection = null;
  generatedReplyText = '';
  if (inboxListEl) inboxListEl.hidden = false;
  if (inboxDetailEl) inboxDetailEl.hidden = true;
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
  showDemoMessage('Demo data loaded. Open the popup to see it.');
});

clearDemoBtn.addEventListener('click', async () => {
  detectedGroupsList = [];
  trackedGroupsList = [];
  detectionsList = [];
  await clearDemoData();
  renderDetectedGroups();
  renderInbox();
  showDemoMessage('Demo data cleared.');
});

// Sidebar navigation
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const panelId = btn.dataset.panel;
    if (!panelId) return;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('nav-item--active'));
    btn.classList.add('nav-item--active');
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('panel--active', p.id === 'panel-' + panelId);
    });
  });
});

loadPage();
