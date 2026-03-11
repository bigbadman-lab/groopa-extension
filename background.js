// Groopa background service worker (Manifest V3)
importScripts('storage.js');

/** Escape special regex chars so keyword can be used in RegExp safely. */
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Simple variants for single-word keywords (e.g. plumber → plumbers, plumbing).
 * Used only for word-boundary matching; returns normalized forms to search for.
 */
function getKeywordVariants(normalizedWord) {
  if (!normalizedWord || typeof normalizedWord !== 'string') return [];
  const w = normalizedWord.trim().toLowerCase();
  if (w.length < 2) return [w];
  const out = [w];
  // er → ers, ing (plumber → plumbers, plumbing)
  if (w.length > 2 && w.slice(-2) === 'er') {
    const stem = w.slice(0, -2);
    if (stem.length >= 2) {
      out.push(w + 's');
      out.push(stem + 'ing');
    }
  }
  // ing → er, ers (plumbing → plumber, plumbers)
  if (w.length > 3 && w.slice(-3) === 'ing') {
    const stem = w.slice(0, -3);
    if (stem.length >= 2) {
      out.push(stem + 'er');
      out.push(stem + 'ers');
    }
  }
  // trailing s → singular (plumbers → plumber)
  if (w.length > 2 && w.slice(-1) === 's' && w.slice(-3) !== 'ers') {
    const singular = w.slice(0, -1);
    if (singular.length >= 2) out.push(singular);
  }
  return [...new Set(out)];
}

/** True if normalized text matches this keyword (word-boundary or phrase, with variants). */
function keywordMatchesText(normalizedText, kw) {
  if (!normalizedText || !kw) return false;
  const normalizedKw = normalizeTextForKeywordMatch(kw);
  if (!normalizedKw) return false;
  const words = normalizedKw.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const variantForms = getKeywordVariants(normalizedKw);
    for (let v = 0; v < variantForms.length; v++) {
      const form = variantForms[v];
      if (!form) continue;
      try {
        if (new RegExp('\\b' + escapeRegex(form) + '\\b').test(normalizedText)) return true;
      } catch (_) {
        if (normalizedText.indexOf(form) !== -1) return true;
      }
    }
    return false;
  }
  return normalizedText.indexOf(normalizedKw) !== -1;
}

/**
 * Keyword detection v1: full-text match with word-boundary (single-word), phrase (multi-word), and variants.
 * Returns original stored keyword strings so storage, dedupe, and UI are unchanged.
 */
function getMatchingKeywordsV1(fullText, keywords) {
  if (!fullText || typeof fullText !== 'string') return [];
  if (!Array.isArray(keywords) || keywords.length === 0) return [];
  const normalizedText = normalizeTextForKeywordMatch(fullText);
  if (!normalizedText) return [];
  const matched = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = (keywords[i] != null && typeof keywords[i] === 'string') ? keywords[i].trim() : '';
    if (kw.length === 0) continue;
    if (keywordMatchesText(normalizedText, kw)) matched.push(kw);
  }
  return matched;
}

/**
 * Returns which keywords appear in the normalized text. Uses same normalizer as fingerprint for consistency.
 * @deprecated Prefer getMatchingKeywordsV1 for new matching (full text, word-boundary, variants).
 */
function getMatchingKeywords(normalizedText, keywords) {
  if (!normalizedText || !Array.isArray(keywords)) return [];
  const matched = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = (keywords[i] != null && typeof keywords[i] === 'string') ? keywords[i].trim() : '';
    if (kw.length === 0) continue;
    if (normalizedText.indexOf(normalizeTextForFingerprint(kw)) !== -1) matched.push(kw);
  }
  return matched;
}

/**
 * Build a lightweight fingerprint for one post candidate (for feed freshness check).
 * Uses text preview and post URL only. Returns null if candidate is too empty to be reliable.
 * @param {object} candidate - { textPreview?, postUrl? }
 * @returns {string|null}
 */
function buildPostFingerprint(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const text = (candidate.textPreview != null ? String(candidate.textPreview) : '').trim();
  const url = (candidate.postUrl != null ? String(candidate.postUrl) : '').trim();
  const normalizedText = normalizeTextForFingerprint(text.slice(0, 150));
  const urlSlice = url.slice(0, 200);
  if (!normalizedText && !urlSlice) return null;
  return urlSlice + '|' + normalizedText;
}

/**
 * Get fingerprints for the first 2 candidates. Returns null if fewer than 2 reliable fingerprints.
 * @param {object[]} candidates
 * @returns {string[]|null}
 */
function getTopFeedFingerprints(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) return null;
  const fp0 = buildPostFingerprint(candidates[0]);
  const fp1 = buildPostFingerprint(candidates[1]);
  if (fp0 == null || fp1 == null) return null;
  return [fp0, fp1];
}

/**
 * True if the top of the feed is unchanged (same first 2 fingerprints in order).
 * @param {string[]} previous - stored [fp0, fp1]
 * @param {string[]} current - current [fp0, fp1]
 * @returns {boolean}
 */
function isFeedUnchanged(previous, current) {
  if (!Array.isArray(previous) || previous.length < 2 || !Array.isArray(current) || current.length < 2) return false;
  return previous[0] === current[0] && previous[1] === current[1];
}

/**
 * Returns true if the current Facebook context is a group that the user is tracking.
 * Uses group ID, slug from URL, and normalized URL (storage.js helpers).
 * @param {object|null} context - lastFacebookContext (isGroupPage, groupIdentifier, url)
 * @param {object[]} trackedGroups - list of { id, name, url }
 */
function isCurrentGroupTracked(context, trackedGroups) {
  if (!context || context.isGroupPage !== true) return false;
  if (!Array.isArray(trackedGroups) || trackedGroups.length === 0) return false;

  const currentId = (context.groupIdentifier != null && String(context.groupIdentifier).trim()) ? String(context.groupIdentifier).trim().toLowerCase() : '';
  const currentUrl = context.url != null ? context.url : '';
  const currentNormalized = normalizeFacebookGroupUrl(currentUrl);
  const currentSlug = getSlugFromGroupUrl(currentUrl) || currentId;

  for (let i = 0; i < trackedGroups.length; i++) {
    const t = trackedGroups[i];
    const trackedId = (t.id != null && String(t.id).trim()) ? String(t.id).trim().toLowerCase() : '';
    const trackedUrl = t.url != null ? t.url : '';
    const trackedNormalized = normalizeFacebookGroupUrl(trackedUrl);
    const trackedSlug = (t.slug != null && String(t.slug).trim()) ? String(t.slug).trim().toLowerCase() : getSlugFromGroupUrl(trackedUrl).toLowerCase();

    if (currentId && trackedId && currentId === trackedId) return true;
    if (currentSlug && trackedSlug && currentSlug.toLowerCase() === trackedSlug) return true;
    if (currentNormalized && trackedNormalized && currentNormalized === trackedNormalized) return true;
  }
  return false;
}

const SCAN_HEARTBEAT_ALARM_NAME = 'groopa-scan-heartbeat';
const SCAN_HEARTBEAT_INTERVAL_MINUTES = 0.5; // 30 seconds (one-shot reschedule; Chrome min period is 1 min)

// Joined-groups scan: use /groups/joins/ as source of truth; reuse monitor window/tab
const FACEBOOK_JOINED_GROUPS_URL = 'https://www.facebook.com/groups/joins/';
let membershipScanInProgress = false;

function scheduleScanHeartbeat() {
  chrome.alarms.create(SCAN_HEARTBEAT_ALARM_NAME, { delayInMinutes: SCAN_HEARTBEAT_INTERVAL_MINUTES });
}

/**
 * Ensure the Groopa monitoring window exists; create if missing. Single dedicated window only.
 */
async function ensureMonitorWindow() {
  const state = await getMonitoringState();
  if (state.monitorWindowId != null) {
    try {
      await chrome.windows.get(state.monitorWindowId);
      return { windowId: state.monitorWindowId };
    } catch (_) {
      await updateMonitoringState({ monitorWindowId: null, monitorTabId: null, workerTabId: null });
    }
  }
  const win = await chrome.windows.create({
    url: 'about:blank',
    type: 'popup',
    width: 420,
    height: 700,
    left: 20,
    top: 20,
    focused: false,
  });
  if (!win || win.id == null) throw new Error('Could not create monitor window');
  const tabs = await chrome.tabs.query({ windowId: win.id });
  if (tabs && tabs.length > 0) {
    await updateMonitoringState({ monitorWindowId: win.id, monitorTabId: tabs[0].id, workerTabId: tabs[0].id });
  } else {
    await updateMonitoringState({ monitorWindowId: win.id });
  }
  return { windowId: win.id };
}

/**
 * Ensure exactly one worker tab exists in the monitoring window. Reuse if valid; create only if missing. active: false.
 */
async function ensureSingleWorkerTab(windowId) {
  const state = await getMonitoringState();
  const candidateId = state.workerTabId != null ? state.workerTabId : state.monitorTabId;
  if (candidateId != null) {
    try {
      const tab = await chrome.tabs.get(candidateId);
      if (tab && tab.windowId === windowId) {
        await updateMonitoringState({ workerTabId: tab.id, monitorTabId: tab.id });
        return { tabId: tab.id };
      }
    } catch (_) {}
    await updateMonitoringState({ workerTabId: null, monitorTabId: null });
  }
  const existingTabs = await chrome.tabs.query({ windowId });
  if (existingTabs && existingTabs.length > 0) {
    const tabId = existingTabs[0].id;
    await updateMonitoringState({ workerTabId: tabId, monitorTabId: tabId });
    return { tabId };
  }
  const tab = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
  if (tab && tab.id != null) {
    await updateMonitoringState({ workerTabId: tab.id, monitorTabId: tab.id });
    return { tabId: tab.id };
  }
  throw new Error('Could not create worker tab');
}

/**
 * Ensure we have exactly one scan tab in the given monitor window. Used by group membership scan (non-monitoring).
 */
async function ensureMonitorTab(windowId) {
  const state = await getMonitoringState();
  if (state.monitorTabId != null) {
    try {
      const tab = await chrome.tabs.get(state.monitorTabId);
      if (tab.windowId === windowId) return { tabId: tab.id };
    } catch (_) {}
    await updateMonitoringState({ monitorTabId: null });
  }
  const existingTabs = await chrome.tabs.query({ windowId });
  if (existingTabs && existingTabs.length > 0) {
    await updateMonitoringState({ monitorTabId: existingTabs[0].id });
    return { tabId: existingTabs[0].id };
  }
  const tab = await chrome.tabs.create({ windowId, url: 'about:blank' });
  if (tab && tab.id != null) {
    await updateMonitoringState({ monitorTabId: tab.id });
    return { tabId: tab.id };
  }
  throw new Error('Could not create monitor tab');
}

/**
 * Build a Facebook group URL for a tracked group. Returns null if invalid.
 */
function getGroupUrlForRotation(group) {
  if (!group) return null;
  const url = group.url != null && String(group.url).trim() ? String(group.url).trim() : '';
  if (url && url.indexOf('facebook.com') !== -1 && url.indexOf('/groups/') !== -1) return url;
  const id = group.id != null && String(group.id).trim() ? String(group.id).trim() : '';
  if (id) return 'https://www.facebook.com/groups/' + encodeURIComponent(id);
  return null;
}

/** Resolve when tab status is 'complete' or timeout. */
function waitForTabLoad(tabId, timeoutMs) {
  timeoutMs = timeoutMs || 25000;
  return new Promise((resolve) => {
    const done = () => {
      try {
        chrome.tabs.onUpdated.removeListener(listener);
      } catch (_) {}
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, change) => {
      if (id === tabId && change.status === 'complete') done();
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab && tab.status === 'complete') done();
    }).catch(done);
  });
}

async function runHeartbeatScan() {
  try {
    const state = await getMonitoringState();
    if (!state.monitoringEnabled) {
      scheduleScanHeartbeat();
      return;
    }

    const trackedGroups = await getTrackedGroups();
    if (trackedGroups.length === 0) {
      scheduleScanHeartbeat();
      return;
    }

    let windowId = state.monitorWindowId;
    try {
      if (windowId != null) await chrome.windows.get(windowId);
    } catch (_) {
      windowId = null;
    }
    if (windowId == null) {
      const r = await ensureMonitorWindow();
      windowId = r.windowId;
    }

    let tabId = state.workerTabId != null ? state.workerTabId : state.monitorTabId;
    try {
      if (tabId != null) {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || tab.windowId !== windowId) tabId = null;
      }
    } catch (_) {
      tabId = null;
    }
    if (tabId == null) {
      const r = await ensureSingleWorkerTab(windowId);
      tabId = r.tabId;
    }

    const currentIndex = state.currentGroupIndex;
    const group = trackedGroups[currentIndex % trackedGroups.length];
    const url = getGroupUrlForRotation(group);
    if (url) {
      try {
        await chrome.tabs.update(tabId, { url, active: false });
      } catch (_) {}
    }

    await waitForTabLoad(tabId);

    try {
      await chrome.tabs.sendMessage(tabId, { type: 'RUN_GROUP_SCAN' });
    } catch (e) {
      if (e && e.message && e.message.indexOf('Receiving end does not exist') === -1) {
        console.warn('[Groopa] RUN_GROUP_SCAN worker', tabId, e.message);
      }
    }

    const nextIndex = (currentIndex + 1) % Math.max(1, trackedGroups.length);
    await updateMonitoringState({ currentGroupIndex: nextIndex, monitorLastRunAt: new Date().toISOString() });
    scheduleScanHeartbeat();
  } catch (err) {
    console.error('[Groopa] runHeartbeatScan error', err);
  } finally {
    scheduleScanHeartbeat();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Groopa] Extension installed');
  migrateOperationalKeysFromSyncToLocal().then(() => {
    console.log('[Groopa] Migration: operational data now in local storage');
  });
  cleanupReservedDetectedGroups();
  scheduleScanHeartbeat();
  updateUnreadBadge();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Groopa] Extension started');
  cleanupReservedDetectedGroups();
  scheduleScanHeartbeat();
  updateUnreadBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === SCAN_HEARTBEAT_ALARM_NAME) {
    runHeartbeatScan();
  }
});

const NOTIFICATION_CONTEXT_MAP_KEY = 'groopaNotificationContextMap';
const NOTIFICATION_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

function getNotificationContextMap() {
  return new Promise((resolve) => {
    chrome.storage.local.get(NOTIFICATION_CONTEXT_MAP_KEY, (raw) => {
      const v = raw[NOTIFICATION_CONTEXT_MAP_KEY];
      resolve(v && typeof v === 'object' ? v : {});
    });
  });
}

function setNotificationContextFor(notificationId, data) {
  return new Promise((resolve) => {
    getNotificationContextMap().then((map) => {
      const now = Date.now();
      map[notificationId] = { pageUrl: data.pageUrl, createdAt: now };
      const cutoff = now - NOTIFICATION_CONTEXT_TTL_MS;
      const keys = Object.keys(map);
      for (let i = 0; i < keys.length; i++) {
        if (map[keys[i]] && map[keys[i]].createdAt < cutoff) delete map[keys[i]];
      }
      chrome.storage.local.set({ [NOTIFICATION_CONTEXT_MAP_KEY]: map }, resolve);
      if (typeof console !== 'undefined' && console.log) {
        console.log('[Groopa] Notification context stored for', notificationId);
      }
    });
  });
}

function getNotificationContext(notificationId) {
  return new Promise((resolve) => {
    getNotificationContextMap().then((map) => {
      const ctx = notificationId && map[notificationId] ? map[notificationId] : null;
      resolve(ctx);
    });
  });
}

function clearNotificationContext(notificationId) {
  if (!notificationId) return Promise.resolve();
  return new Promise((resolve) => {
    getNotificationContextMap().then((map) => {
      delete map[notificationId];
      chrome.storage.local.set({ [NOTIFICATION_CONTEXT_MAP_KEY]: map }, () => {
        if (typeof console !== 'undefined' && console.log) {
          console.log('[Groopa] Notification context cleaned up for', notificationId);
        }
        resolve();
      });
    });
  });
}

async function updateUnreadBadge() {
  try {
    const list = await getDetections();
    const count = list.filter((d) => d.status === 'new').length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#0b65fe' });
  } catch (e) {
    console.warn('[Groopa] updateUnreadBadge failed', e);
  }
}

const OPEN_INBOX_ON_NEXT_LOAD_KEY = 'groopaOpenInboxOnNextLoad';

const OFFSCREEN_PATH = 'offscreen.html';
const LEAD_SOUND_COOLDOWN_MS = 10000;
let lastLeadSoundAt = 0;
let creatingOffscreen = null;

/**
 * Ensure the offscreen document exists for audio playback (MV3 service workers cannot play audio).
 */
async function ensureOffscreenAudioDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });
  if (existing.length > 0) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play notification sound when a new lead is detected.',
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

/**
 * Play the new-lead sound via the offscreen document if sound is enabled and cooldown has passed.
 */
async function playNewLeadSound() {
  const settings = await getSettings();
  if (!settings.soundEnabled) return;
  const now = Date.now();
  if (now - lastLeadSoundAt < LEAD_SOUND_COOLDOWN_MS) return;
  try {
    await ensureOffscreenAudioDocument();
    chrome.runtime.sendMessage({ type: 'PLAY_LEAD_SOUND' });
    lastLeadSoundAt = now;
  } catch (e) {
    console.warn('[Groopa] Lead sound playback failed', e);
  }
}

/**
 * Central handler for new lead alerts: badge update, browser notification, and optional sound.
 * Call only after leads have been confirmed new and stored (e.g. from appendDetectionsIfNew).
 * Second safety: only alert for leads whose canonical key appears exactly once (no duplicate).
 * @param {object[]} added - detections that were actually added (truly new)
 */
async function handleNewLeadAlert(added) {
  if (!Array.isArray(added) || added.length === 0) return;
  const list = await getDetections();
  const keyCount = {};
  for (let i = 0; i < list.length; i++) {
    const k = typeof getCanonicalLeadKey === 'function' ? getCanonicalLeadKey(list[i]) : '';
    if (k) keyCount[k] = (keyCount[k] || 0) + 1;
  }
  const trulyNew = added.filter(function (d) {
    const k = typeof getCanonicalLeadKey === 'function' ? getCanonicalLeadKey(d) : '';
    return k && keyCount[k] === 1;
  });
  if (trulyNew.length === 0) return;
  await updateUnreadBadge();
  playNewLeadSound();
  const settings = await getSettings();
  if (!settings.desktopAlertsEnabled) return;
  const d = trulyNew[0];
  const groupLabel = (d.groupName && String(d.groupName).trim()) ? String(d.groupName).trim() : 'Facebook group';
  const rawPreview = (d.textPreview && String(d.textPreview).trim()) ? String(d.textPreview).trim() : '';
  const preview = (typeof cleanLeadDisplayText === 'function' ? cleanLeadDisplayText(rawPreview) : rawPreview).slice(0, 80);
  const title = trulyNew.length > 1 ? trulyNew.length + ' new Groopa leads' : 'New Groopa lead';
  const message =
    trulyNew.length > 1
      ? 'Latest: ' + groupLabel + (preview ? ' — ' + preview.slice(0, 60) + (preview.length > 60 ? '…' : '') : '')
      : preview ? groupLabel + ': ' + preview + (preview.length >= 80 ? '…' : '') : groupLabel;
  const notificationId = 'groopa-lead-' + Date.now();
  await setNotificationContextFor(notificationId, { pageUrl: d.postUrl || d.pageUrl || '' });
  try {
    const iconUrl = chrome.runtime.getURL('icons/icon128.png');
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: iconUrl,
      title: title,
      message: (message && String(message).trim()) ? String(message).trim().slice(0, 200) : 'New lead detected.',
      buttons: [{ title: 'Open Inbox' }, { title: 'Open Facebook Post' }],
    });
  } catch (notifErr) {
    console.warn('[Groopa] Notification create failed', notifErr);
  }
}

function setOpenInboxOnNextLoad() {
  chrome.storage.local.set({ [OPEN_INBOX_ON_NEXT_LOAD_KEY]: true });
}

chrome.notifications.onClicked.addListener((notificationId) => {
  setOpenInboxOnNextLoad();
  chrome.runtime.openOptionsPage();
  clearNotificationContext(notificationId);
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    setOpenInboxOnNextLoad();
    chrome.runtime.openOptionsPage();
    clearNotificationContext(notificationId);
    return;
  }
  if (buttonIndex === 1) {
    getNotificationContext(notificationId).then((ctx) => {
      if (ctx && ctx.pageUrl) {
        if (typeof console !== 'undefined' && console.log) {
          console.log('[Groopa] Notification context used on click for', notificationId);
        }
        chrome.tabs.create({ url: ctx.pageUrl });
      }
      clearNotificationContext(notificationId);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_EXTENSION_STATUS') {
    (async () => {
      try {
        const settings = await getSettings();
        const activityLog = await getActivityLog();
        const lastFacebookContext = await getLastFacebookContext();
        const detectedGroups = await getDetectedGroups();
        const selectedCount = settings.trackedGroups.length;
        const latest = activityLog.length > 0 ? activityLog[activityLog.length - 1] : null;
        const pagePostCandidates = await getPagePostCandidates();
        const mon = settings.monitoringState != null ? settings.monitoringState : {};
        const monitoringEnabled = mon.monitoringEnabled === true;
        sendResponse({
          isPaidUser: settings.isPaidUser,
          soundEnabled: settings.soundEnabled,
          monitoringEnabled,
          keywordCount: settings.keywords.length,
          selectedGroupCount: selectedCount,
          detectedGroupCount: detectedGroups.length,
          detectionCount: settings.detections.length,
          pagePostCandidateCount: pagePostCandidates.length,
          activityCount: activityLog.length,
          latestActivity: latest,
          lastFacebookContext,
        });
      } catch (err) {
        console.error('[Groopa] GET_EXTENSION_STATUS error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'CONTENT_SCRIPT_PING') {
    (async () => {
      try {
        await addActivityLogEntry({
          timestamp: new Date().toISOString(),
          url: message.url != null ? message.url : (sender.tab && sender.tab.url ? sender.tab.url : ''),
          title: message.title != null ? message.title : (sender.tab && sender.tab.title ? sender.tab.title : ''),
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] CONTENT_SCRIPT_PING error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'FACEBOOK_CONTEXT_DETECTED') {
    (async () => {
      try {
        const context = message.context;
        if (!context) {
          sendResponse({ ok: false, error: 'Missing context' });
          return;
        }
        await saveLastFacebookContext(context);
        const isGroup = context.isGroupPage === true;
        if (isGroup && context.groupIdentifier) {
          await upsertDetectedGroup({
            id: context.groupIdentifier,
            name: context.groupName || '',
            url: context.url || '',
            slug: context.groupIdentifier,
            source: 'facebook_page',
            lastSeenAt: context.detectedAt || new Date().toISOString(),
          });
        }
        await addActivityLogEntry({
          timestamp: context.detectedAt || new Date().toISOString(),
          url: context.url || '',
          title: context.title || '',
          kind: isGroup ? 'facebook_group_page' : 'facebook_page',
          groupName: context.groupName || undefined,
          groupIdentifier: context.groupIdentifier || undefined,
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] FACEBOOK_CONTEXT_DETECTED error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'PAGE_POST_CANDIDATES_DETECTED') {
    (async () => {
      try {
        const MAX_CANDIDATES = 10;
        const raw = message.candidates || [];
        const list = Array.isArray(raw) ? raw.slice(0, MAX_CANDIDATES) : [];
        const sourceContext = message.sourceContext && typeof message.sourceContext === 'object' ? message.sourceContext : null;
        const pageUrl = (sourceContext && sourceContext.pageUrl) || (message.url != null ? message.url : (sender.tab && sender.tab.url ? sender.tab.url : ''));
        const groupName = (sourceContext && sourceContext.isGroupPage && sourceContext.groupName) ? String(sourceContext.groupName).trim() : '';
        const groupIdentifier = (sourceContext && sourceContext.isGroupPage && sourceContext.groupIdentifier) ? String(sourceContext.groupIdentifier).trim() : '';
        if (list.length > 0 && sourceContext) {
          const firstPost = list[0] && list[0].postUrl ? String(list[0].postUrl).slice(0, 50) + '…' : '';
          console.log('[Groopa] Candidates batch: source pageUrl=' + (pageUrl || '').slice(0, 70) + ' groupIdentifier=' + (groupIdentifier || '') + ' groupName=' + (groupName || '').slice(0, 35) + ' count=' + list.length + (firstPost ? ' firstPostUrl=' + firstPost : ''));
        } else if (list.length > 0 && !sourceContext) {
          console.warn('[Groopa] Candidates batch missing sourceContext; using page URL only for attribution. pageUrl=' + (pageUrl || '').slice(0, 70));
        }

        if (list.length > 0) {
          await savePagePostCandidates(list);
        }
        await addActivityLogEntry({
          timestamp: new Date().toISOString(),
          url: pageUrl,
          kind: 'page_post_candidates_captured',
          count: list.length,
        });

        const settings = await getSettings();
        const trackedGroups = settings.trackedGroups || [];
        const ctxForTrackedCheck = sourceContext ? {
          isGroupPage: !!sourceContext.isGroupPage,
          groupIdentifier: groupIdentifier || null,
          groupName: groupName || null,
          url: pageUrl,
        } : await getLastFacebookContext();

        if (!isCurrentGroupTracked(ctxForTrackedCheck, trackedGroups)) {
          sendResponse({ ok: true });
          return;
        }

        const groupKey = (groupIdentifier && String(groupIdentifier).trim())
          ? String(groupIdentifier).trim().toLowerCase()
          : (getSlugFromGroupUrl(pageUrl || '') || '').toLowerCase();
        const topFps = getTopFeedFingerprints(list);
        if (topFps && topFps.length >= 2) {
          const stored = await getGroupFeedFingerprints();
          const prev = stored[groupKey];
          if (Array.isArray(prev) && prev.length >= 2 && isFeedUnchanged(prev, topFps)) {
            console.log('[Groopa] Group feed unchanged, skipping full scan:', groupKey || groupName || pageUrl.slice(0, 50));
            sendResponse({ ok: true });
            return;
          }
        }

        const keywords = settings.keywords;
        const groupSlugFromUrl = getSlugFromGroupUrl(pageUrl || '');
        const now = new Date().toISOString();
        const newDetections = [];

        const existingDetections = await getDetections();
        const existingPostUrls = new Set();
        for (let j = 0; j < existingDetections.length; j++) {
          const d = existingDetections[j];
          if (d && d.postUrl) {
            const n = normalizePostUrl(d.postUrl);
            if (n) existingPostUrls.add(n.toLowerCase());
          }
        }
        const seenPostUrlsThisBatch = new Set();

        const MAX_FULL_TEXT_LEN = 10000;
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const postUrl = (c && c.postUrl && String(c.postUrl).trim()) ? String(c.postUrl).trim() : undefined;
          const postUrlNorm = postUrl ? normalizePostUrl(postUrl).toLowerCase() : '';
          if (postUrlNorm && (existingPostUrls.has(postUrlNorm) || seenPostUrlsThisBatch.has(postUrlNorm))) {
            continue;
          }

          const textPreview = (c && c.textPreview != null) ? String(c.textPreview) : '';
          const postText = (c && c.postText != null) ? String(c.postText) : '';
          const matchText = postText.trim();
          if (matchText.length === 0) continue;
          const textForMatch = matchText.length > MAX_FULL_TEXT_LEN ? matchText.slice(0, MAX_FULL_TEXT_LEN) : matchText;
          if (i === 0) {
            console.log('[Groopa] [text-pipeline] background matching on postText first80=', textForMatch.slice(0, 80));
          }
          const matchedKeywords = getMatchingKeywordsV1(textForMatch, keywords);
          if (matchedKeywords.length === 0) continue;

          if (postUrlNorm) seenPostUrlsThisBatch.add(postUrlNorm);
          const fingerprint = buildDetectionFingerprint({
            postUrl: postUrl,
            groupId: groupIdentifier,
            groupSlug: groupSlugFromUrl,
            pageUrl: pageUrl,
            textPreview: textPreview,
            matchedKeywords: matchedKeywords,
          });
          newDetections.push({
            matchedKeywords,
            textPreview,
            groupName,
            groupIdentifier,
            pageUrl,
            postUrl: postUrl,
            matchSource: 'post',
            createdAt: now,
            source: 'page_scan',
            type: 'keyword_match',
            fingerprint,
            status: 'new',
            author: 'Page scan',
            text: textPreview,
            keywordMatched: matchedKeywords[0] || matchedKeywords.join(', '),
          });
        }

        let added = [];
        if (newDetections.length > 0) {
          added = await appendDetectionsIfNew(newDetections);
          if (groupKey) {
            await setGroupLastScannedAt(groupKey, now);
          }
        }

        if (groupKey && topFps && topFps.length >= 2) {
          await setGroupFeedFingerprints(groupKey, topFps);
        }

        if (added.length > 0) {
          await handleNewLeadAlert(added);
        }
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] PAGE_POST_CANDIDATES_DETECTED error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'TRACK_GROUP') {
    (async () => {
      try {
        const group = message.group;
        if (!group) {
          sendResponse({ ok: false, error: 'Missing group' });
          return;
        }
        await addTrackedGroup({ id: group.id, name: group.name, url: group.url });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] TRACK_GROUP error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'UNTRACK_GROUP') {
    (async () => {
      try {
        const group = message.group;
        if (!group) {
          sendResponse({ ok: false, error: 'Missing group' });
          return;
        }
        await removeTrackedGroup({ id: group.id, slug: group.slug, url: group.url });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] UNTRACK_GROUP error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'MARK_DETECTION_OPENED') {
    (async () => {
      try {
        const fingerprint = message.fingerprint;
        if (!fingerprint) {
          sendResponse({ ok: false, error: 'Missing fingerprint' });
          return;
        }
        await updateDetectionStatus(fingerprint, 'opened');
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] MARK_DETECTION_OPENED error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }

  if (message.type === 'START_GROUP_MEMBERSHIP_SCAN') {
    (async () => {
      try {
        if (membershipScanInProgress) {
          sendResponse({ ok: false, error: 'A scan is already running. Please wait a moment.' });
          return;
        }
        membershipScanInProgress = true;
        sendResponse({ ok: true });

        function broadcastStatus(text) {
          try {
            chrome.runtime.sendMessage({ type: 'GROUP_MEMBERSHIP_SCAN_STATUS', message: text });
          } catch (_) {}
        }

        broadcastStatus('Opening Facebook…');
        const { windowId } = await ensureMonitorWindow();
        const { tabId } = await ensureMonitorTab(windowId);
        await chrome.tabs.update(tabId, { url: FACEBOOK_JOINED_GROUPS_URL, active: true });
        await chrome.windows.update(windowId, { focused: true });

        broadcastStatus('Loading joined groups page…');
        await new Promise((resolve) => setTimeout(resolve, 6000));

        broadcastStatus('Scanning and scrolling for groups…');
        const result = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'RUN_GROUP_MEMBERSHIP_SCAN' }, (response) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(response);
            }
          });
        });

        let count = 0;
        let error = null;

        if (!result || result.ok === false || !Array.isArray(result.groups)) {
          error =
            (result && result.error) ||
            'Could not read your groups. Make sure you are logged into Facebook and the page loaded.';
        } else {
          const now = new Date().toISOString();
          const groups = result.groups;
          count = groups.length;
          const cycleStats = Array.isArray(result.cycleStats) ? result.cycleStats : [];
          console.log('[Groopa] Membership scan completed:', count, 'groups,', cycleStats.length, 'cycles, stats:', cycleStats.slice(-15));
          if (cycleStats.length > 0) {
            await addActivityLogEntry({
              timestamp: now,
              kind: 'membership_scan_diagnostics',
              finalGroupCount: count,
              cycleCount: cycleStats.length,
              scrollTargetType: cycleStats[cycleStats.length - 1].scrollTargetType,
              scrollContainerFound: cycleStats[cycleStats.length - 1].scrollContainerFound,
              lastCycles: cycleStats.slice(-20),
            });
          }
          for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (!g || !g.url) continue;
            await upsertDetectedGroup({
              id: g.id,
              name: g.name || '',
              url: g.url,
              source: 'membership_scan',
              lastSeenAt: now,
            });
          }
        }

        // Also clean any previously stored reserved non-group entries.
        await cleanupReservedDetectedGroups();
        membershipScanInProgress = false;
        chrome.runtime.sendMessage({
          type: 'GROUP_MEMBERSHIP_SCAN_COMPLETED',
          count: count,
          error: error,
        });
      } catch (err) {
        membershipScanInProgress = false;
        console.error('[Groopa] START_GROUP_MEMBERSHIP_SCAN error', err);
        chrome.runtime.sendMessage({
          type: 'GROUP_MEMBERSHIP_SCAN_COMPLETED',
          count: 0,
          error: 'Something went wrong while scanning your groups. Please try again.',
        });
      }
    })();
    return true;
  }

  if (message.type === 'START_MONITORING') {
    (async () => {
      try {
        const trackedGroups = await getTrackedGroups();
        if (trackedGroups.length === 0) {
          sendResponse({ ok: false, error: 'Add at least one tracked group to start monitoring.' });
          return;
        }
        await updateMonitoringState({ monitoringEnabled: true, currentGroupIndex: 0 });
        const { windowId } = await ensureMonitorWindow();
        await ensureSingleWorkerTab(windowId);
        runHeartbeatScan();
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] START_MONITORING error', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Failed to start' });
      }
    })();
    return true;
  }

  if (message.type === 'STOP_MONITORING') {
    (async () => {
      try {
        const state = await getMonitoringState();
        if (state.monitorWindowId != null) {
          try {
            await chrome.windows.remove(state.monitorWindowId);
          } catch (_) {}
        }
        await updateMonitoringState({
          monitoringEnabled: false,
          monitorWindowId: null,
          monitorTabId: null,
          workerTabId: null,
          currentGroupIndex: 0,
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] STOP_MONITORING error', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Failed to stop' });
      }
    })();
    return true;
  }

  if (message.type === 'OPEN_MONITOR_WINDOW') {
    (async () => {
      try {
        const { windowId } = await ensureMonitorWindow();
        await chrome.windows.update(windowId, {
          width: 420,
          height: 700,
          left: 20,
          top: 20,
          focused: true,
        });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] OPEN_MONITOR_WINDOW error', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Failed to open window' });
      }
    })();
    return true;
  }

  if (message.type === 'RUN_GROUP_FEED_EXPERIMENT') {
    (async () => {
      try {
        const feedUrl = 'https://www.facebook.com/groups/feed/';
        let tabId = null;
        const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/groups/feed*' });
        if (tabs && tabs.length > 0) {
          tabId = tabs[0].id;
          await chrome.tabs.update(tabId, { active: true });
        } else {
          const tab = await chrome.tabs.create({ url: feedUrl, active: true });
          tabId = tab && tab.id != null ? tab.id : null;
        }
        if (!tabId) {
          sendResponse({ ok: false, error: 'Could not open /groups/feed tab' });
          return;
        }
        await new Promise((r) => setTimeout(r, 4000));
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'RUN_GROUP_FEED_EXPERIMENT' }, (res) => {
            if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
            else resolve(res);
          });
        });
        const candidates = (response && response.candidates) || [];
        console.log('[Groopa] Group feed experiment — candidate count:', candidates.length, 'candidates:', candidates);
        await addActivityLogEntry({
          timestamp: new Date().toISOString(),
          kind: 'group_feed_experiment',
          candidateCount: candidates.length,
          candidates: candidates.slice(0, 20),
        });
        sendResponse({ ok: response && response.ok, candidates: candidates, error: response && response.error });
      } catch (err) {
        console.error('[Groopa] RUN_GROUP_FEED_EXPERIMENT error', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Experiment failed' });
      }
    })();
    return true;
  }

  if (message.type === 'INBOX_OPENED') {
    (async () => {
      try {
        await markAllNewDetectionsAsOpened();
        await updateUnreadBadge();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
});
