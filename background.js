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

function makeDetectionFingerprint(pageUrl, normalizedPreview, matchedKeywords) {
  const preview = (normalizedPreview || '').slice(0, 200);
  const kws = Array.isArray(matchedKeywords) ? matchedKeywords.slice().sort().join(',') : '';
  return (pageUrl || '') + '|' + preview + '|' + kws;
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

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Groopa] Extension installed');
  migrateOperationalKeysFromSyncToLocal().then(() => {
    console.log('[Groopa] Migration: operational data now in local storage');
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Groopa] Extension started');
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
            author: 'Page scan',
            text: textPreview,
            keywordMatched: matchedKeywords[0] || matchedKeywords.join(', '),
          });
        }

        if (newDetections.length > 0) {
          await appendDetectionsIfNew(newDetections);
        }
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Groopa] PAGE_POST_CANDIDATES_DETECTED error', err);
        sendResponse({ error: String(err.message) });
      }
    })();
    return true;
  }
});
