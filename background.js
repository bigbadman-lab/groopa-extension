// Groopa background service worker (Manifest V3)
importScripts('storage.js');

/**
 * Returns which keywords appear in the normalized text. Uses same normalizer as fingerprint for consistency.
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

// Joined-groups scan: use /groups/joins/ as source of truth; reuse monitor window/tab
const FACEBOOK_JOINED_GROUPS_URL = 'https://www.facebook.com/groups/joins/';
let membershipScanInProgress = false;

function scheduleScanHeartbeat() {
  chrome.alarms.create(SCAN_HEARTBEAT_ALARM_NAME, { delayInMinutes: SCAN_HEARTBEAT_INTERVAL_MINUTES });
}

/**
 * Ensure the Groopa monitor window exists; create if missing. Clears stale IDs.
 * When we create a new window with url: 'about:blank', Chrome creates exactly one tab;
 * we store that tab's ID so we reuse it (single monitor tab, no extra blank tab).
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
  // One window, one tab: create window with one blank tab and adopt that tab as the monitor tab
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
    await updateMonitoringState({ monitorWindowId: win.id, monitorTabId: tabs[0].id });
  } else {
    await updateMonitoringState({ monitorWindowId: win.id });
  }
  return { windowId: win.id };
}

/**
 * Ensure we have exactly one scan tab in the given monitor window. Reuse existing tab if valid;
 * otherwise adopt the window's first tab (if any) or create one. Never create a second tab
 * when the window already has a tab.
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
  const preview = (d.textPreview && String(d.textPreview).trim()) ? String(d.textPreview).trim().slice(0, 80) : '';
  const title = trulyNew.length > 1 ? trulyNew.length + ' new Groopa leads' : 'New Groopa lead';
  const message =
    trulyNew.length > 1
      ? 'Latest: ' + groupLabel + (preview ? ' — ' + preview.slice(0, 60) + (preview.length > 60 ? '…' : '') : '')
      : preview ? groupLabel + ': ' + preview + (preview.length >= 80 ? '…' : '') : groupLabel;
  const notificationId = 'groopa-lead-' + Date.now();
  await setNotificationContext({ notificationId, pageUrl: d.postUrl || d.pageUrl || '' });
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

chrome.notifications.onClicked.addListener(() => {
  setOpenInboxOnNextLoad();
  chrome.runtime.openOptionsPage();
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) {
    setOpenInboxOnNextLoad();
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
        const groupSlugFromUrl = getSlugFromGroupUrl(pageUrl || '');
        const now = new Date().toISOString();
        const newDetections = [];

        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          const textPreview = (c && c.textPreview != null) ? String(c.textPreview) : '';
          const normalized = normalizeTextForFingerprint(textPreview);
          const matchedKeywords = getMatchingKeywords(normalized, keywords);
          if (matchedKeywords.length === 0) continue;

          const postUrl = (c && c.postUrl && String(c.postUrl).trim()) ? String(c.postUrl).trim() : undefined;
          const fingerprint = buildDetectionFingerprint({
            postUrl: postUrl,
            groupId: groupIdentifier,
            groupSlug: groupSlugFromUrl,
            pageUrl: pageUrl,
            textPreview: textPreview,
            matchedKeywords: matchedKeywords,
          });
          let matchSource = 'post';
          const postText = (c && c.postText != null) ? String(c.postText) : '';
          const commentText = (c && c.commentText != null) ? String(c.commentText) : '';
          if (postText || commentText) {
            const normPost = normalizeTextForFingerprint(postText);
            const normComment = normalizeTextForFingerprint(commentText);
            const inPost = matchedKeywords.some((kw) => normPost.indexOf(normalizeTextForFingerprint(kw)) !== -1);
            const inComment = matchedKeywords.some((kw) => normComment.indexOf(normalizeTextForFingerprint(kw)) !== -1);
            matchSource = inPost && inComment ? 'both' : inComment ? 'comment' : 'post';
          }
          newDetections.push({
            matchedKeywords,
            textPreview,
            groupName,
            groupIdentifier,
            pageUrl,
            postUrl: postUrl,
            matchSource: matchSource,
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
