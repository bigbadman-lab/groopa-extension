// Groopa storage service — sync for settings, local for operational data

// Sync: small settings only (fits quota)
const SYNC_KEYS = ['isPaidUser', 'keywords', 'soundEnabled', 'desktopAlertsEnabled'];

// Local: larger operational data (no strict quota per item)
const LOCAL_KEYS = ['detectedGroups', 'trackedGroups', 'detections', 'activityLog', 'lastFacebookContext', 'pagePostCandidates', 'groupLastScannedAt', 'monitoringState'];

const DEFAULTS = {
  isPaidUser: false,
  keywords: [],
  soundEnabled: true,
  trackedGroups: [],
  detectedGroups: [],
  detections: [],
  activityLog: [],
  lastFacebookContext: null,
  pagePostCandidates: [],
  groupLastScannedAt: {},
  monitoringState: {
    monitoringEnabled: false,
    monitorWindowId: null,
    monitorTabId: null,
    nextTrackedGroupIndex: 0,
    monitorLastRunAt: null,
  },
};

const MAX_ACTIVITY_LOG_ENTRIES = 100;

function getFromStorageSync(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

function setInStorageSync(items) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, resolve);
  });
}

function getFromStorageLocal(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function setInStorageLocal(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

/**
 * One-time migration: copy operational data from sync to local, then remove from sync (fixes quota).
 * Call from background onInstalled so existing data is preserved.
 */
async function migrateOperationalKeysFromSyncToLocal() {
  const raw = await getFromStorageSync(LOCAL_KEYS);
  const hasAny = LOCAL_KEYS.some((k) => raw[k] !== undefined);
  if (hasAny) {
    await setInStorageLocal(raw);
  }
  return new Promise((resolve) => {
    chrome.storage.sync.remove(LOCAL_KEYS, resolve);
  });
}

/**
 * Get all settings with normalized defaults (reads from sync + local).
 */
async function getSettings() {
  const [rawSync, rawLocal] = await Promise.all([
    getFromStorageSync(SYNC_KEYS),
    getFromStorageLocal(LOCAL_KEYS),
  ]);
  return {
    isPaidUser: rawSync.isPaidUser === true,
    keywords: Array.isArray(rawSync.keywords) ? rawSync.keywords : DEFAULTS.keywords,
    soundEnabled: rawSync.soundEnabled !== false,
    desktopAlertsEnabled: rawSync.desktopAlertsEnabled !== false,
    trackedGroups: Array.isArray(rawLocal.trackedGroups) ? rawLocal.trackedGroups : DEFAULTS.trackedGroups,
    detectedGroups: Array.isArray(rawLocal.detectedGroups) ? rawLocal.detectedGroups : DEFAULTS.detectedGroups,
    detections: Array.isArray(rawLocal.detections) ? rawLocal.detections : DEFAULTS.detections,
    activityLog: Array.isArray(rawLocal.activityLog) ? rawLocal.activityLog : DEFAULTS.activityLog,
    lastFacebookContext: rawLocal.lastFacebookContext != null ? rawLocal.lastFacebookContext : DEFAULTS.lastFacebookContext,
    pagePostCandidates: Array.isArray(rawLocal.pagePostCandidates) ? rawLocal.pagePostCandidates : DEFAULTS.pagePostCandidates,
    groupLastScannedAt: rawLocal.groupLastScannedAt != null && typeof rawLocal.groupLastScannedAt === 'object' ? rawLocal.groupLastScannedAt : DEFAULTS.groupLastScannedAt,
    monitoringState: rawLocal.monitoringState != null && typeof rawLocal.monitoringState === 'object' ? { ...DEFAULTS.monitoringState, ...rawLocal.monitoringState } : DEFAULTS.monitoringState,
  };
}

/**
 * Save settings. Only sync keys (isPaidUser, keywords, soundEnabled) are written to sync.
 * trackedGroups is not saved here — use saveTrackedGroups() after updating tracked list.
 */
async function saveSettings(data) {
  const current = await getSettings();
  const merged = {
    isPaidUser: data.isPaidUser !== undefined ? data.isPaidUser : current.isPaidUser,
    keywords: data.keywords !== undefined ? data.keywords : current.keywords,
    soundEnabled: data.soundEnabled !== undefined ? data.soundEnabled : current.soundEnabled,
    desktopAlertsEnabled: data.desktopAlertsEnabled !== undefined ? data.desktopAlertsEnabled : current.desktopAlertsEnabled,
  };
  await setInStorageSync(merged);
}

/**
 * @returns {Promise<object[]>}
 */
async function getTrackedGroups() {
  const raw = await getFromStorageLocal(['trackedGroups']);
  return Array.isArray(raw.trackedGroups) ? raw.trackedGroups : [];
}

/**
 * @param {object[]} trackedGroups
 */
async function saveTrackedGroups(trackedGroups) {
  await setInStorageLocal({ trackedGroups: Array.isArray(trackedGroups) ? trackedGroups : [] });
}

/**
 * True if two groups are the same (by id, slug, or normalized URL).
 * @param {object} a - { id?, slug?, url? }
 * @param {object} b - { id?, slug?, url? }
 */
function groupMatches(a, b) {
  const keyA = getNormalizedKey(a.id, a.slug, a.url);
  const keyB = getNormalizedKey(b.id, b.slug, b.url);
  if (keyA && keyB && keyA === keyB) return true;
  const normA = normalizeFacebookGroupUrl(a.url || '');
  const normB = normalizeFacebookGroupUrl(b.url || '');
  return !!normA && !!normB && normA === normB;
}

/**
 * Add a group to trackedGroups if not already present (deduped by id/slug/URL).
 * @param {object} group - { id, name, url } (slug optional)
 */
async function addTrackedGroup(group) {
  if (!group || (group.id == null && !group.url)) return;
  const list = await getTrackedGroups();
  if (list.some((g) => groupMatches(g, group))) return;
  list.push({
    id: group.id != null ? String(group.id) : getSlugFromGroupUrl(group.url || ''),
    name: (group.name != null && String(group.name).trim()) ? String(group.name).trim() : '',
    url: (group.url != null && String(group.url).trim()) ? String(group.url).trim() : '',
  });
  await saveTrackedGroups(list);
}

/**
 * Remove a group from trackedGroups (matched by id/slug/URL).
 * @param {object} group - { id?, slug?, url? }
 */
async function removeTrackedGroup(group) {
  if (!group || (group.id == null && !group.url)) return;
  const list = await getTrackedGroups();
  const filtered = list.filter((g) => !groupMatches(g, group));
  if (filtered.length === list.length) return;
  await saveTrackedGroups(filtered);
}

/**
 * @returns {Promise<object[]>}
 */
async function getDetections() {
  const raw = await getFromStorageLocal(['detections']);
  return Array.isArray(raw.detections) ? raw.detections : [];
}

/**
 * @param {object[]} detections
 */
async function saveDetections(detections) {
  await setInStorageLocal({ detections: Array.isArray(detections) ? detections : [] });
}

const MAX_DETECTIONS_STORED = 100;

/**
 * Merge incoming detection into existing, preferring stronger metadata (non-empty groupName, postUrl, etc.).
 * Does not change fingerprint, createdAt, status, or id-like fields; only improves display/metadata.
 */
function mergeDetectionMetadata(existing, incoming) {
  const out = { ...existing };
  if (incoming.groupName && String(incoming.groupName).trim() && (!existing.groupName || !String(existing.groupName).trim())) {
    out.groupName = String(incoming.groupName).trim();
  } else if (incoming.groupName && String(incoming.groupName).trim() && existing.groupName && String(existing.groupName).trim().length < String(incoming.groupName).trim().length) {
    out.groupName = String(incoming.groupName).trim();
  }
  if (incoming.postUrl && String(incoming.postUrl).trim() && (!existing.postUrl || !String(existing.postUrl).trim())) {
    out.postUrl = String(incoming.postUrl).trim();
  }
  if (incoming.pageUrl && String(incoming.pageUrl).trim() && (!existing.pageUrl || !String(existing.pageUrl).trim())) {
    out.pageUrl = String(incoming.pageUrl).trim();
  }
  if (incoming.groupIdentifier && String(incoming.groupIdentifier).trim() && (!existing.groupIdentifier || !String(existing.groupIdentifier).trim())) {
    out.groupIdentifier = String(incoming.groupIdentifier).trim();
  }
  return out;
}

/**
 * Append new detections, dedupe by postUrl (primary) and fingerprint, merge metadata when same lead seen again.
 * Same post permalink never creates a second lead; conflicting group attribution is merged into one record.
 * @param {object[]} newDetections - each must have .fingerprint (from buildDetectionFingerprint)
 * @returns {Promise<object[]>} the detections that were actually added (use this for badge + notifications)
 */
async function appendDetectionsIfNew(newDetections) {
  if (!Array.isArray(newDetections) || newDetections.length === 0) return [];
  const existing = await getDetections();
  const seen = new Set(
    existing.map(function (d) {
      return d && d.fingerprint ? String(d.fingerprint) : null;
    }).filter(Boolean)
  );
  const postUrlToIndex = {};
  for (let i = 0; i < existing.length; i++) {
    const d = existing[i];
    if (d && d.postUrl) {
      const norm = normalizePostUrl(d.postUrl);
      if (norm) postUrlToIndex[norm.toLowerCase()] = i;
    }
  }
  const toAdd = [];
  let list = existing.slice();
  for (let i = 0; i < newDetections.length; i++) {
    const d = newDetections[i];
    if (!d || typeof d !== 'object') continue;
    const postUrlNorm = d.postUrl ? normalizePostUrl(d.postUrl).toLowerCase() : '';
    if (postUrlNorm && postUrlToIndex[postUrlNorm] !== undefined) {
      const idx = postUrlToIndex[postUrlNorm];
      const existingLead = list[idx];
      if (existingLead && (existingLead.groupName !== d.groupName || existingLead.groupIdentifier !== d.groupIdentifier)) {
        if (typeof console !== 'undefined' && console.log) {
          console.log('[Groopa] Dedupe: same postUrl, different group attribution — merging into single lead');
        }
      }
      list[idx] = mergeDetectionMetadata(list[idx], d);
      continue;
    }
    const key = d.fingerprint != null ? String(d.fingerprint).trim() : '';
    if (!key) continue;
    if (seen.has(key)) {
      const idx = list.findIndex(function (x) { return x && x.fingerprint === key; });
      if (idx >= 0) list[idx] = mergeDetectionMetadata(list[idx], d);
      continue;
    }
    seen.add(key);
    toAdd.push(d);
    list.push(d);
  }
  const anyMerged = list.length !== existing.length || list.some(function (d, i) { return d !== existing[i]; });
  if (toAdd.length === 0 && !anyMerged) return [];
  const trimmed = list.slice(-MAX_DETECTIONS_STORED);
  await saveDetections(trimmed);
  return toAdd;
}

/**
 * Set a detection's status by fingerprint (e.g. "opened").
 * @param {string} fingerprint
 * @param {string} status - "new" | "opened"
 */
async function updateDetectionStatus(fingerprint, status) {
  if (!fingerprint) return;
  const list = await getDetections();
  const idx = list.findIndex((d) => d.fingerprint === fingerprint);
  if (idx < 0) return;
  list[idx] = { ...list[idx], status: status === 'opened' ? 'opened' : 'new' };
  await saveDetections(list);
}

/**
 * Mark all detections with status "new" as "opened". Used when the user opens the inbox (popup or settings).
 * Detections stay in the inbox; only their status changes so the badge count drops to zero.
 */
async function markAllNewDetectionsAsOpened() {
  const list = await getDetections();
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].status === 'new') {
      list[i] = { ...list[i], status: 'opened' };
      changed = true;
    }
  }
  if (changed) await saveDetections(list);
}

/**
 * @returns {Promise<object[]>}
 */
async function getDetectedGroups() {
  const raw = await getFromStorageLocal(['detectedGroups']);
  return Array.isArray(raw.detectedGroups) ? raw.detectedGroups : [];
}

/**
 * @param {object[]} detectedGroups
 */
async function saveDetectedGroups(detectedGroups) {
  await setInStorageLocal({ detectedGroups: Array.isArray(detectedGroups) ? detectedGroups : [] });
}

const UNKNOWN_GROUP_NAME = 'Unknown group';

/**
 * Reserved non-group path segments under /groups/ that must never be treated as real groups.
 * Applies to all URL variants (e.g. .../groups/joins, .../groups/joins/, .../groups/joins/?ref=...).
 * @param {string} slug - segment from path (e.g. "joins", "feed")
 * @returns {boolean}
 */
function isReservedGroupSlug(slug) {
  if (slug == null || String(slug).trim() === '') return false;
  const s = String(slug).trim().toLowerCase();
  return s === 'joins' || s === 'feed' || s === 'discover' || s === 'create';
}

/**
 * Normalize a Facebook group URL to a canonical form (no query, no trailing slash).
 * @param {string} url
 * @returns {string}
 */
function normalizeFacebookGroupUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim());
    if (u.hostname.indexOf('facebook.com') === -1) return url;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const match = path.match(/\/groups\/([^/]+)/i);
    if (!match) return url;
    const segment = match[1];
    if (isReservedGroupSlug(segment)) return '';
    return 'https://www.facebook.com/groups/' + segment;
  } catch (_) {
    return url;
  }
}

/**
 * Get the slug or id segment from a Facebook group URL path.
 * @param {string} url
 * @returns {string}
 */
function getSlugFromGroupUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim());
    const match = u.pathname.match(/\/groups\/([^/]+)/i);
    const slug = match ? match[1] : '';
    return isReservedGroupSlug(slug) ? '' : slug;
  } catch (_) {
    return '';
  }
}

/**
 * Strip unstable Facebook UI noise from extracted post text so the same post
 * produces the same fingerprint across scans. Removes relative times (54m, 1h, 3d)
 * and action labels (Like, Reply, Share). Use the result only for fingerprinting;
 * keep raw textPreview for display.
 */
function cleanPostTextForFingerprint(text) {
  if (text == null || typeof text !== 'string') return '';
  var s = String(text)
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .trim();
  // Trailing action labels (e.g. "Like Reply Share", "Comment Send")
  s = s.replace(/\s*(?:like|reply|share|comment|send)(?:\s*(?:like|reply|share|comment|send))*\s*$/gi, '');
  // Relative time at end (54m, 1h, 3d, 2w, 5 hrs, 2 days, Just now, Yesterday, Today)
  s = s.replace(/\s*\d+\s*[mhdw]\b\s*$/gi, '');
  s = s.replace(/\s*\d+\s*hrs?\s*$/gi, '');
  s = s.replace(/\s*\d+\s*days?\s*$/gi, '');
  s = s.replace(/\s*just\s+now\s*$/gi, '');
  s = s.replace(/\s*yesterday\s*$/gi, '');
  s = s.replace(/\s*today\s*$/gi, '');
  // Any remaining standalone relative time tokens elsewhere (54m, 1h, etc.)
  s = s.replace(/\b\d+\s*[mhdw]\b/gi, '');
  s = s.replace(/\b\d+\s*hrs?\b/gi, '');
  s = s.replace(/\b\d+\s*days?\b/gi, '');
  s = s.replace(/\bjust\s+now\b/gi, '');
  s = s.replace(/\byesterday\b/gi, '');
  s = s.replace(/\btoday\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Strong normalization for fingerprint/dedupe only: lowercase, trim, collapse whitespace,
 * remove zero-width/invisible chars, strip trailing ellipsis so same post always has same fingerprint.
 * Used by buildDetectionFingerprint and for consistent keyword normalization.
 */
function normalizeTextForFingerprint(text) {
  if (text == null || typeof text !== 'string') return '';
  return String(text)
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\u2026$|\.\.\.$/g, '')
    .toLowerCase();
}

const FINGERPRINT_PREVIEW_LEN = 200;

/**
 * Normalize a post/permalink URL for stable identity (strip hash, one canonical form).
 * @param {string} url
 * @returns {string}
 */
function normalizePostUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim());
    u.hash = '';
    return u.href;
  } catch (_) {
    return '';
  }
}

/**
 * One deterministic fingerprint per lead. When postUrl is present, uses it as the primary identity
 * so the same post is never stored twice with different group attribution.
 * @param {object} opts
 * @param {string} [opts.postUrl] - post permalink; when present used as identity anchor (prevents group-name duplicates)
 * @param {string} [opts.groupId] - stable group id if known
 * @param {string} [opts.groupSlug] - slug from URL
 * @param {string} [opts.pageUrl] - fallback to derive group from URL
 * @param {string} opts.textPreview - raw post text
 * @param {string[]} opts.matchedKeywords - matched keywords
 * @returns {string}
 */
function buildDetectionFingerprint(opts) {
  if (!opts || typeof opts !== 'object') return '';
  const postUrl = opts.postUrl != null ? String(opts.postUrl).trim() : '';
  const groupId = opts.groupId != null ? String(opts.groupId).trim() : '';
  const groupSlug = opts.groupSlug != null ? String(opts.groupSlug).trim() : '';
  const pageUrl = opts.pageUrl != null ? opts.pageUrl : '';
  const textPreview = opts.textPreview != null ? String(opts.textPreview) : '';
  const matchedKeywords = Array.isArray(opts.matchedKeywords) ? opts.matchedKeywords : [];

  let identityKey = '';
  if (postUrl) {
    identityKey = normalizePostUrl(postUrl).toLowerCase();
    if (!identityKey) identityKey = '';
  }
  if (!identityKey) {
    if (groupId) identityKey = groupId.toLowerCase();
    else if (groupSlug) identityKey = groupSlug.toLowerCase();
    else {
      const slug = getSlugFromGroupUrl(pageUrl);
      if (slug) identityKey = slug.toLowerCase();
      else identityKey = (normalizeFacebookGroupUrl(pageUrl) || '').toLowerCase();
    }
  }

  var cleaned = cleanPostTextForFingerprint(textPreview);
  const preview = normalizeTextForFingerprint(cleaned).slice(0, FINGERPRINT_PREVIEW_LEN);
  const kws = matchedKeywords
    .map(function (k) {
      return (k != null && String(k).trim()) ? normalizeTextForFingerprint(String(k).trim()) : '';
    })
    .filter(Boolean)
    .sort()
    .join(',');

  return identityKey + '|' + preview + '|' + kws;
}

/**
 * Build a stable key for deduping (id or slug, lowercased).
 * @param {string} id
 * @param {string} slug
 * @param {string} url
 * @returns {string}
 */
function getNormalizedKey(id, slug, url) {
  if (id != null && String(id).trim() !== '') return String(id).trim().toLowerCase();
  if (slug != null && String(slug).trim() !== '') return String(slug).trim().toLowerCase();
  const fromUrl = getSlugFromGroupUrl(url);
  return fromUrl ? fromUrl.toLowerCase() : '';
}

/**
 * Prefer the better name (non-empty and not "Unknown group").
 * @param {string} existing
 * @param {string} incoming
 * @returns {string}
 */
function preferBetterName(existing, incoming) {
  const hasExisting = existing != null && String(existing).trim() !== '' && String(existing).trim() !== UNKNOWN_GROUP_NAME;
  const hasIncoming = incoming != null && String(incoming).trim() !== '' && String(incoming).trim() !== UNKNOWN_GROUP_NAME;
  if (hasIncoming) return String(incoming).trim();
  if (hasExisting) return String(existing).trim();
  return (incoming != null && String(incoming).trim()) ? String(incoming).trim() : (existing != null ? String(existing).trim() : '');
}

/**
 * Add or update a group in detectedGroups. Dedupes by id, normalizedKey, normalized URL, and slug.
 * Keeps firstDetectedAt stable; updates lastSeenAt; prefers better names over "Unknown group".
 * @param {object} group - { id, name, url, slug?, source?, firstDetectedAt?, lastSeenAt? }
 */
async function upsertDetectedGroup(group) {
  if (!group || (group.id == null && !group.url)) return;
  const now = new Date().toISOString();
  const rawUrl = group.url != null ? group.url : '';
  const segmentFromUrl = (rawUrl.match(/\/groups\/([^/]+)/i) || [])[1] || '';
  if (isReservedGroupSlug(segmentFromUrl)) return;
  const normalizedUrl = normalizeFacebookGroupUrl(rawUrl);
  if (!normalizedUrl) return;
  const slug = (group.slug != null && String(group.slug).trim() !== '') ? String(group.slug).trim() : getSlugFromGroupUrl(rawUrl || normalizedUrl);
  const id = group.id != null ? String(group.id).trim() : slug;
  if (isReservedGroupSlug(slug) || isReservedGroupSlug(id)) return;
  if (!id && !slug) return;
  const normalizedKey = getNormalizedKey(id, slug, rawUrl || normalizedUrl);
  if (!normalizedKey) return;

  const list = await getDetectedGroups();
  const lastSeenAt = group.lastSeenAt != null ? group.lastSeenAt : now;
  const source = group.source != null ? group.source : 'facebook_page';

  function matchesExisting(g) {
    if (normalizedKey && getNormalizedKey(g.id, g.slug, g.url).toLowerCase() === normalizedKey) return true;
    if (id && String(g.id).toLowerCase() === id.toLowerCase()) return true;
    if (slug && g.slug && String(g.slug).toLowerCase() === slug.toLowerCase()) return true;
    if (normalizedUrl && normalizeFacebookGroupUrl(g.url || '') === normalizedUrl) return true;
    return false;
  }

  const idx = list.findIndex(matchesExisting);
  const displayUrl = normalizedUrl || rawUrl || '';
  const displayName = group.name != null ? String(group.name).trim() : '';

  if (idx >= 0) {
    const existing = list[idx];
    const name = preferBetterName(existing.name, displayName);
    list[idx] = {
      id: existing.id || id,
      name: name || existing.name || '',
      url: displayUrl || existing.url || '',
      normalizedKey: normalizedKey,
      slug: slug || existing.slug || '',
      source: existing.source || source,
      firstDetectedAt: existing.firstDetectedAt || now,
      lastSeenAt,
    };
  } else {
    list.push({
      id: id || slug,
      name: displayName || '',
      url: displayUrl,
      normalizedKey,
      slug: slug || '',
      source,
      firstDetectedAt: group.firstDetectedAt != null ? group.firstDetectedAt : now,
      lastSeenAt,
    });
  }
  await saveDetectedGroups(list);
}

/**
 * Remove reserved non-group entries (e.g. /groups/joins, /groups/feed) from detectedGroups.
 * Extracts the path segment from each URL so all variants (joins, joins/, m.facebook.com/...) are caught.
 * Called after scans and on extension load so bad entries are removed immediately.
 */
async function cleanupReservedDetectedGroups() {
  const list = await getDetectedGroups();
  const filtered = list.filter((g) => {
    const url = g.url || '';
    const segment = (url.match(/\/groups\/([^/]+)/i) || [])[1] || '';
    return !isReservedGroupSlug(segment);
  });
  if (filtered.length !== list.length) {
    await saveDetectedGroups(filtered);
  }
}

/**
 * Clear tracked groups, detected groups, and detections (demo data reset). Uses local storage.
 */
async function clearDemoData() {
  await setInStorageLocal({ trackedGroups: [], detectedGroups: [], detections: [] });
}

/**
 * @returns {Promise<object[]>}
 */
async function getActivityLog() {
  const raw = await getFromStorageLocal(['activityLog']);
  return Array.isArray(raw.activityLog) ? raw.activityLog : [];
}

/**
 * @param {object[]} activityLog
 */
async function saveActivityLog(activityLog) {
  await setInStorageLocal({ activityLog: Array.isArray(activityLog) ? activityLog : [] });
}

/**
 * Append one entry and trim log to max size.
 * @param {object} entry - e.g. { timestamp, url, title }
 */
async function addActivityLogEntry(entry) {
  const log = await getActivityLog();
  log.push({ ...entry, timestamp: entry.timestamp || new Date().toISOString() });
  const trimmed = log.slice(-MAX_ACTIVITY_LOG_ENTRIES);
  await saveActivityLog(trimmed);
}

/**
 * @returns {Promise<object|null>} Last detected Facebook context or null
 */
async function getLastFacebookContext() {
  const raw = await getFromStorageLocal(['lastFacebookContext']);
  return raw.lastFacebookContext != null ? raw.lastFacebookContext : null;
}

/**
 * @param {object|null} lastFacebookContext
 */
async function saveLastFacebookContext(lastFacebookContext) {
  await setInStorageLocal({ lastFacebookContext: lastFacebookContext != null ? lastFacebookContext : null });
}

/**
 * @returns {Promise<object[]>} Page post candidates (e.g. [{ textPreview }])
 */
async function getPagePostCandidates() {
  const raw = await getFromStorageLocal(['pagePostCandidates']);
  return Array.isArray(raw.pagePostCandidates) ? raw.pagePostCandidates : [];
}

/**
 * @param {object[]} pagePostCandidates
 */
async function savePagePostCandidates(pagePostCandidates) {
  await setInStorageLocal({ pagePostCandidates: Array.isArray(pagePostCandidates) ? pagePostCandidates : [] });
}

/**
 * Get last scan timestamps per group (key -> ISO date string).
 * @returns {Promise<object>}
 */
async function getGroupLastScannedAt() {
  const raw = await getFromStorageLocal(['groupLastScannedAt']);
  return raw.groupLastScannedAt != null && typeof raw.groupLastScannedAt === 'object' ? raw.groupLastScannedAt : {};
}

/**
 * Set last scanned time for a group (e.g. group id or normalized key).
 * @param {string} groupKey - stable key (id, slug, or normalized identifier)
 * @param {string} isoDateString - e.g. new Date().toISOString()
 */
async function setGroupLastScannedAt(groupKey, isoDateString) {
  if (!groupKey || !isoDateString) return;
  const current = await getGroupLastScannedAt();
  const next = { ...current, [String(groupKey).toLowerCase()]: isoDateString };
  await setInStorageLocal({ groupLastScannedAt: next });
}

/**
 * Get Groopa monitor window/tab state (operational, local storage).
 * @returns {Promise<{monitoringEnabled: boolean, monitorWindowId: number|null, monitorTabId: number|null, nextTrackedGroupIndex: number, monitorLastRunAt: string|null}>}
 */
async function getMonitoringState() {
  const raw = await getFromStorageLocal(['monitoringState']);
  const s = raw.monitoringState != null && typeof raw.monitoringState === 'object' ? raw.monitoringState : {};
  return {
    monitoringEnabled: s.monitoringEnabled === true,
    monitorWindowId: s.monitorWindowId != null ? Number(s.monitorWindowId) : null,
    monitorTabId: s.monitorTabId != null ? Number(s.monitorTabId) : null,
    nextTrackedGroupIndex: Math.max(0, parseInt(s.nextTrackedGroupIndex, 10) || 0),
    monitorLastRunAt: s.monitorLastRunAt != null && typeof s.monitorLastRunAt === 'string' ? s.monitorLastRunAt : null,
  };
}

/**
 * Update monitoring state (merge partial into current).
 * @param {Partial<{monitoringEnabled: boolean, monitorWindowId: number|null, monitorTabId: number|null, nextTrackedGroupIndex: number, monitorLastRunAt: string|null}>} partial
 */
async function updateMonitoringState(partial) {
  const current = await getMonitoringState();
  const next = { ...current, ...partial };
  await setInStorageLocal({ monitoringState: next });
}
