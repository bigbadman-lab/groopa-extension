// Groopa storage service — sync for settings, local for operational data

// Sync: small settings only (fits quota)
const SYNC_KEYS = ['isPaidUser', 'keywords', 'soundEnabled'];

// Local: larger operational data (no strict quota per item)
const LOCAL_KEYS = ['detectedGroups', 'trackedGroups', 'detections', 'activityLog', 'lastFacebookContext', 'pagePostCandidates'];

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
    trackedGroups: Array.isArray(rawLocal.trackedGroups) ? rawLocal.trackedGroups : DEFAULTS.trackedGroups,
    detectedGroups: Array.isArray(rawLocal.detectedGroups) ? rawLocal.detectedGroups : DEFAULTS.detectedGroups,
    detections: Array.isArray(rawLocal.detections) ? rawLocal.detections : DEFAULTS.detections,
    activityLog: Array.isArray(rawLocal.activityLog) ? rawLocal.activityLog : DEFAULTS.activityLog,
    lastFacebookContext: rawLocal.lastFacebookContext != null ? rawLocal.lastFacebookContext : DEFAULTS.lastFacebookContext,
    pagePostCandidates: Array.isArray(rawLocal.pagePostCandidates) ? rawLocal.pagePostCandidates : DEFAULTS.pagePostCandidates,
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
 * Append new detections, dedupe by fingerprint, keep list under MAX_DETECTIONS_STORED.
 * @param {object[]} newDetections - each must have .fingerprint
 */
async function appendDetectionsIfNew(newDetections) {
  if (!Array.isArray(newDetections) || newDetections.length === 0) return;
  const existing = await getDetections();
  const seen = new Set(existing.map((d) => d.fingerprint).filter(Boolean));
  const toAdd = newDetections.filter((d) => d.fingerprint && !seen.has(d.fingerprint));
  if (toAdd.length === 0) return;
  const combined = [...existing, ...toAdd];
  const trimmed = combined.slice(-MAX_DETECTIONS_STORED);
  await saveDetections(trimmed);
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
    return match ? match[1] : '';
  } catch (_) {
    return '';
  }
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
  const normalizedUrl = normalizeFacebookGroupUrl(rawUrl);
  const slug = (group.slug != null && String(group.slug).trim() !== '') ? String(group.slug).trim() : getSlugFromGroupUrl(rawUrl || normalizedUrl);
  const id = group.id != null ? String(group.id).trim() : slug;
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
