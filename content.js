// Groopa content script — runs on Facebook pages
console.log('[Groopa] Content script loaded on Facebook');

chrome.runtime.sendMessage(
  {
    type: 'CONTENT_SCRIPT_PING',
    url: window.location.href,
    title: document.title || '',
  },
  (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[Groopa] Ping failed:', chrome.runtime.lastError.message);
    }
  }
);
