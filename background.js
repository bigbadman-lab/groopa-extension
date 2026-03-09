// Groopa background service worker (Manifest V3)
importScripts('storage.js');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Groopa] Extension installed');
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
        const selectedCount = settings.trackedGroups.filter((g) => g.selected).length;
        const latest = activityLog.length > 0 ? activityLog[activityLog.length - 1] : null;
        sendResponse({
          isPaidUser: settings.isPaidUser,
          soundEnabled: settings.soundEnabled,
          keywordCount: settings.keywords.length,
          selectedGroupCount: selectedCount,
          detectionCount: settings.detections.length,
          activityCount: activityLog.length,
          latestActivity: latest,
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
});
