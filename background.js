// Groopa background service worker (Manifest V3)

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Groopa] Extension installed');
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Groopa] Extension started');
});
