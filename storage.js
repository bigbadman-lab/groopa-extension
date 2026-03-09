// Groopa storage service — shared helpers for chrome.storage.sync

const STORAGE_KEYS = ['isPaidUser', 'keywords', 'soundEnabled', 'trackedGroups', 'detectedGroups', 'detections', 'activityLog', 'lastFacebookContext'];

const DEFAULTS = {
  isPaidUser: false,
  keywords: [],
  soundEnabled: true,
  trackedGroups: [],
  detectedGroups: [],
  detections: [],
  activityLog: [],
  lastFacebookContext: null,
};

const MAX_ACTIVITY_LOG_ENTRIES = 100;

function getFromStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

function setInStorage(items) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, resolve);
  });
}

/**
 * Get all settings with normalized defaults.
 * @returns {Promise<{ isPaidUser: boolean, keywords: string[], soundEnabled: boolean, trackedGroups: object[], detections: object[] }>}
 */
async function getSettings() {
  const raw = await getFromStorage(STORAGE_KEYS);
  return {
    isPaidUser: raw.isPaidUser === true,
    keywords: Array.isArray(raw.keywords) ? raw.keywords : DEFAULTS.keywords,
    soundEnabled: raw.soundEnabled !== false,
    trackedGroups: Array.isArray(raw.trackedGroups) ? raw.trackedGroups : DEFAULTS.trackedGroups,
    detectedGroups: Array.isArray(raw.detectedGroups) ? raw.detectedGroups : DEFAULTS.detectedGroups,
    detections: Array.isArray(raw.detections) ? raw.detections : DEFAULTS.detections,
    activityLog: Array.isArray(raw.activityLog) ? raw.activityLog : DEFAULTS.activityLog,
    lastFacebookContext: raw.lastFacebookContext != null ? raw.lastFacebookContext : DEFAULTS.lastFacebookContext,
  };
}

/**
 * Save settings. Merges with existing so you can pass only the keys you change.
 * @param {object} data - { isPaidUser?, keywords?, soundEnabled?, trackedGroups? }
 */
async function saveSettings(data) {
  const current = await getSettings();
  const merged = {
    isPaidUser: data.isPaidUser !== undefined ? data.isPaidUser : current.isPaidUser,
    keywords: data.keywords !== undefined ? data.keywords : current.keywords,
    soundEnabled: data.soundEnabled !== undefined ? data.soundEnabled : current.soundEnabled,
    trackedGroups: data.trackedGroups !== undefined ? data.trackedGroups : current.trackedGroups,
  };
  await setInStorage(merged);
}

/**
 * @returns {Promise<object[]>}
 */
async function getTrackedGroups() {
  const raw = await getFromStorage(['trackedGroups']);
  return Array.isArray(raw.trackedGroups) ? raw.trackedGroups : [];
}

/**
 * @param {object[]} trackedGroups
 */
async function saveTrackedGroups(trackedGroups) {
  await setInStorage({ trackedGroups: Array.isArray(trackedGroups) ? trackedGroups : [] });
}

/**
 * @returns {Promise<object[]>}
 */
async function getDetections() {
  const raw = await getFromStorage(['detections']);
  return Array.isArray(raw.detections) ? raw.detections : [];
}

/**
 * @param {object[]} detections
 */
async function saveDetections(detections) {
  await setInStorage({ detections: Array.isArray(detections) ? detections : [] });
}

/**
 * @returns {Promise<object[]>}
 */
async function getDetectedGroups() {
  const raw = await getFromStorage(['detectedGroups']);
  return Array.isArray(raw.detectedGroups) ? raw.detectedGroups : [];
}

/**
 * @param {object[]} detectedGroups
 */
async function saveDetectedGroups(detectedGroups) {
  await setInStorage({ detectedGroups: Array.isArray(detectedGroups) ? detectedGroups : [] });
}

/**
 * Add or update a group in detectedGroups by id (groupIdentifier).
 * @param {object} group - { id, name, url, lastSeenAt? }
 */
async function upsertDetectedGroup(group) {
  const id = group && (group.id != null) ? String(group.id) : null;
  if (!id) return;
  const list = await getDetectedGroups();
  const entry = {
    id,
    name: group.name != null ? group.name : '',
    url: group.url != null ? group.url : '',
    lastSeenAt: group.lastSeenAt != null ? group.lastSeenAt : new Date().toISOString(),
  };
  const idx = list.findIndex((g) => String(g.id) === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.push(entry);
  }
  await saveDetectedGroups(list);
}

/**
 * Clear tracked groups, detected groups, and detections (demo data reset).
 */
async function clearDemoData() {
  await setInStorage({ trackedGroups: [], detectedGroups: [], detections: [] });
}

/**
 * @returns {Promise<object[]>}
 */
async function getActivityLog() {
  const raw = await getFromStorage(['activityLog']);
  return Array.isArray(raw.activityLog) ? raw.activityLog : [];
}

/**
 * @param {object[]} activityLog
 */
async function saveActivityLog(activityLog) {
  await setInStorage({ activityLog: Array.isArray(activityLog) ? activityLog : [] });
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
  const raw = await getFromStorage(['lastFacebookContext']);
  return raw.lastFacebookContext != null ? raw.lastFacebookContext : null;
}

/**
 * @param {object|null} lastFacebookContext
 */
async function saveLastFacebookContext(lastFacebookContext) {
  await setInStorage({ lastFacebookContext: lastFacebookContext != null ? lastFacebookContext : null });
}
