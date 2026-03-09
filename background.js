// Groopa background service worker (Manifest V3)
importScripts('storage.js');

function normalizeText(text) {
  if (text == null || typeof text !== 'string') return '';
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getMatchingKeywords(normalizedText, keywords) {
  if (!normalizedText || !Array.isArray(keywords)) return [];
  const matched = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = (keywords[i] != null && typeof keywords[i] === 'string') ? keywords[i].trim() : '';
    if (kw.length === 0) continue;
    if (normalizedText.indexOf(normalizeText(kw)) !== -1) matched.push(kw);
  }
  return matched;
}

/**
 * Build a stable fingerprint for dedupe. Uses only:
 * - canonical group URL (normalized, no query/hash so same group = same string)
 * - normalized post text preview (first 200 chars)
 * - matched keywords in sorted order
 * Does NOT use: createdAt, source, timestamps, or array index.
 */
function makeDetectionFingerprint(pageUrl, normalizedPreview, matchedKeywords) {
  const groupUrl = normalizeFacebookGroupUrl(pageUrl || '') || (pageUrl || '').trim();
  const preview = (normalizedPreview || '').slice(0, 200);
  const kws = Array.isArray(matchedKeywords) ? matchedKeywords.slice().sort().join(',') : '';
  return groupUrl + '|' + preview + '|' + kws;
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

/**
 * Returns true if tabUrl is a Facebook group page that matches one of the tracked groups.
 * Used by the heartbeat to find tabs to send RUN_GROUP_SCAN to.
 */
function tabUrlMatchesTrackedGroup(tabUrl, trackedGroups) {
  if (!tabUrl || typeof tabUrl !== 'string' || !Array.isArray(trackedGroups) || trackedGroups.length === 0) return false;
  if (tabUrl.indexOf('facebook.com') === -1 || tabUrl.indexOf('/groups/') === -1) return false;
  const slug = getSlugFromGroupUrl(tabUrl);
  if (!slug) return false;
  const slugLower = slug.toLowerCase();
  const tabNorm = normalizeFacebookGroupUrl(tabUrl);
  for (let i = 0; i < trackedGroups.length; i++) {
    const t = trackedGroups[i];
    const trackedId = (t.id != null && String(t.id).trim()) ? String(t.id).trim().toLowerCase() : '';
    const trackedSlug = (t.slug != null && String(t.slug).trim()) ? String(t.slug).trim().toLowerCase() : getSlugFromGroupUrl(t.url || '').toLowerCase();
    const trackedNormalized = normalizeFacebookGroupUrl(t.url || '');
    if (trackedId && trackedId === slugLower) return true;
    if (trackedSlug && trackedSlug === slugLower) return true;
    if (trackedNormalized && tabNorm && trackedNormalized === tabNorm) return true;
  }
  return false;
}

const SCAN_HEARTBEAT_ALARM_NAME = 'groopa-scan-heartbeat';
const SCAN_HEARTBEAT_INTERVAL_MINUTES = 0.5; // 30 seconds (one-shot reschedule; Chrome min period is 1 min)

function scheduleScanHeartbeat() {
  chrome.alarms.create(SCAN_HEARTBEAT_ALARM_NAME, { delayInMinutes: SCAN_HEARTBEAT_INTERVAL_MINUTES });
}

/**
 * Ensure the Groopa monitor window exists; create if missing. Clears stale IDs.
 */
async function ensureMonitorWindow() {
  const state = await getMonitoringState();
  if (state.monitorWindowId != null) {
    try {
      await chrome.windows.get(state.monitorWindowId);
      return { windowId: state.monitorWindowId };
    } catch (_) {
      await updateMonitoringState({ monitorWindowId: null, monitorTabId: null });
    }
  }
  const win = await chrome.windows.create({
    url: 'about:blank',
    type: 'normal',
    focused: false,
  });
  if (win && win.id != null) {
    await updateMonitoringState({ monitorWindowId: win.id });
    return { windowId: win.id };
  }
  throw new Error('Could not create monitor window');
}

/**
 * Ensure the scan tab exists in the given window; create if missing. Clears stale tab ID.
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

async function runHeartbeatScan() {
  try {
    const state = await getMonitoringState();

    if (state.monitoringEnabled) {
      const trackedGroups = await getTrackedGroups();
      if (trackedGroups.length === 0) {
        scheduleScanHeartbeat();
        return;
      }
      const { windowId } = await ensureMonitorWindow();
      const { tabId } = await ensureMonitorTab(windowId);
      const idx = state.nextTrackedGroupIndex % trackedGroups.length;
      const group = trackedGroups[idx];
      const url = getGroupUrlForRotation(group);
      if (url) {
        await chrome.tabs.update(tabId, { url });
        const nextIdx = (idx + 1) % trackedGroups.length;
        await updateMonitoringState({
          nextTrackedGroupIndex: nextIdx,
          monitorLastRunAt: new Date().toISOString(),
        });
      } else {
        const nextIdx = (idx + 1) % trackedGroups.length;
        await updateMonitoringState({ nextTrackedGroupIndex: nextIdx });
      }
      scheduleScanHeartbeat();
      return;
    }

    // Legacy: scan open tracked group tabs when managed monitoring is off
    const trackedGroups = await getTrackedGroups();
    if (trackedGroups.length === 0) {
      scheduleScanHeartbeat();
      return;
    }
    const tabs = await new Promise((resolve) => {
      chrome.tabs.query({ url: 'https://*.facebook.com/*' }, resolve);
    });
    if (tabs && tabs.length > 0) {
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        if (!tab.id || !tab.url) continue;
        if (!tabUrlMatchesTrackedGroup(tab.url, trackedGroups)) continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'RUN_GROUP_SCAN' });
        } catch (e) {
          if (e && e.message && e.message.indexOf('Receiving end does not exist') === -1) {
            console.warn('[Groopa] Heartbeat send to tab', tab.id, e.message);
          }
        }
      }
    }
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
  scheduleScanHeartbeat();
  updateUnreadBadge();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Groopa] Extension started');
  scheduleScanHeartbeat();
  updateUnreadBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === SCAN_HEARTBEAT_ALARM_NAME) {
    runHeartbeatScan();
  }
});

const NOTIFICATION_CONTEXT_KEY = 'groopaNotificationContext';

function getNotificationContext() {
  return new Promise((resolve) => {
    chrome.storage.local.get(NOTIFICATION_CONTEXT_KEY, (raw) => {
      const v = raw[NOTIFICATION_CONTEXT_KEY];
      resolve(v && typeof v === 'object' ? v : null);
    });
  });
}

function setNotificationContext(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [NOTIFICATION_CONTEXT_KEY]: data }, resolve);
  });
}

function clearNotificationContext() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(NOTIFICATION_CONTEXT_KEY, resolve);
  });
}

async function updateUnreadBadge() {
  try {
    const list = await getDetections();
    const count = list.filter((d) => d.status === 'new').length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#1877f2' });
  } catch (e) {
    console.warn('[Groopa] updateUnreadBadge failed', e);
  }
}

chrome.notifications.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (buttonIndex === 1) {
    getNotificationContext().then((ctx) => {
      if (ctx && ctx.pageUrl) {
        chrome.tabs.create({ url: ctx.pageUrl });
      }
      clearNotificationContext();
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
        sendResponse({
          isPaidUser: settings.isPaidUser,
          soundEnabled: settings.soundEnabled,
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
        const pageUrl = message.url != null ? message.url : (sender.tab && sender.tab.url ? sender.tab.url : '');

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
        const ctx = await getLastFacebookContext();
        const trackedGroups = settings.trackedGroups || [];

        if (!isCurrentGroupTracked(ctx, trackedGroups)) {
          sendResponse({ ok: true });
          return;
        }

        const keywords = settings.keywords;
        const groupName = (ctx && ctx.isGroupPage && ctx.groupName) ? ctx.groupName : '';
        const groupIdentifier = (ctx && ctx.isGroupPage && ctx.groupIdentifier) ? ctx.groupIdentifier : '';
        const now = new Date().toISOString();
        const newDetections = [];

        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const textPreview = (c && c.textPreview != null) ? String(c.textPreview) : '';
          const normalized = normalizeText(textPreview);
          const matchedKeywords = getMatchingKeywords(normalized, keywords);
          if (matchedKeywords.length === 0) continue;

          const fingerprint = makeDetectionFingerprint(pageUrl, normalized, matchedKeywords);
          newDetections.push({
            matchedKeywords,
            textPreview,
            groupName,
            groupIdentifier,
            pageUrl,
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
          const groupKey = (groupIdentifier && String(groupIdentifier).trim()) ? String(groupIdentifier).trim().toLowerCase() : getSlugFromGroupUrl(pageUrl || '').toLowerCase();
          if (groupKey) {
            await setGroupLastScannedAt(groupKey, now);
          }
        }

        if (added.length > 0) {
          await updateUnreadBadge();
          if (settings.soundEnabled !== false) {
            const d = added[0];
            const groupLabel = (d.groupName && String(d.groupName).trim()) ? String(d.groupName).trim() : 'Facebook group';
            const preview = (d.textPreview && String(d.textPreview).trim()) ? String(d.textPreview).trim().slice(0, 80) : '';
            const title = added.length > 1 ? added.length + ' new Groopa leads detected' : 'New Groopa lead detected';
            const message =
              added.length > 1
                ? 'Latest: ' + groupLabel + (preview ? ' — ' + preview.slice(0, 60) + (preview.length > 60 ? '…' : '') : '')
                : preview ? groupLabel + ': ' + preview + (preview.length >= 80 ? '…' : '') : groupLabel;
            const notificationId = 'groopa-scan-' + Date.now();
            await setNotificationContext({ notificationId, pageUrl: d.pageUrl || '' });
            try {
              chrome.notifications.create(notificationId, {
                type: 'basic',
                title,
                message,
                buttons: [{ title: 'Open Lead' }, { title: 'Open Facebook Post' }],
              });
            } catch (notifErr) {
              console.warn('[Groopa] Notification create failed', notifErr);
            }
          }
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

  if (message.type === 'START_MONITORING') {
    (async () => {
      try {
        await updateMonitoringState({ monitoringEnabled: true });
        const { windowId } = await ensureMonitorWindow();
        await ensureMonitorTab(windowId);
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
        await updateMonitoringState({ monitoringEnabled: false });
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
        await chrome.windows.update(windowId, { focused: true });
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] OPEN_MONITOR_WINDOW error', err);
        sendResponse({ ok: false, error: err && err.message ? err.message : 'Failed to open window' });
      }
    })();
    return true;
  }

  if (message.type === 'INBOX_OPENED') {
    (async () => {
      try {
        await chrome.action.setBadgeText({ text: '' });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }
});
