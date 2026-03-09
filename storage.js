// Groopa storage service — shared helpers for chrome.storage.sync

const STORAGE_KEYS = ['isPaidUser', 'keywords', 'soundEnabled', 'trackedGroups', 'detections'];

const DEFAULTS = {
  isPaidUser: false,
  keywords: [],
  soundEnabled: true,
  trackedGroups: [],
  detections: [],
};

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
    detections: Array.isArray(raw.detections) ? raw.detections : DEFAULTS.detections,
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
 * Clear tracked groups and detections (demo data reset).
 */
async function clearDemoData() {
  await setInStorage({ trackedGroups: [], detections: [] });
}
