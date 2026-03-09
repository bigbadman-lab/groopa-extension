// Groopa content script — runs on Facebook pages; detects context and group pages

(function () {
  const hostname = window.location.hostname || '';
  const pathname = window.location.pathname || '';
  const isFacebook = hostname.indexOf('facebook.com') !== -1 || hostname.indexOf('www.facebook.com') !== -1;

  const context = {
    isFacebook,
    isGroupPage: false,
    groupIdentifier: null,
    groupName: null,
    url: window.location.href,
    title: document.title || '',
    detectedAt: new Date().toISOString(),
  };

  if (!isFacebook) {
    chrome.runtime.sendMessage(
      { type: 'CONTENT_SCRIPT_PING', url: window.location.href, title: document.title || '' },
      function () {}
    );
    return;
  }

  // Detect group page: /groups/ in path (e.g. /groups/123456789/ or /groups/GroupSlug/)
  const groupsMatch = pathname.match(/\/groups\/([^/]+)/);
  if (groupsMatch) {
    context.isGroupPage = true;
    context.groupIdentifier = groupsMatch[1];
    // Derive group name: from document.title (often "Group Name | Facebook") or first h1
    let name = '';
    const title = (document.title || '').trim();
    const pipeIndex = title.indexOf('|');
    if (pipeIndex > 0) {
      name = title.slice(0, pipeIndex).trim();
    } else if (title) {
      name = title.replace(/\s*-\s*Facebook\s*$/i, '').trim();
    }
    if (!name) {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent) name = h1.textContent.trim();
    }
    context.groupName = name || null;
  }

  // Send context to background (saves context and adds one activity log entry)
  chrome.runtime.sendMessage(
    { type: 'FACEBOOK_CONTEXT_DETECTED', context },
    function () {
      if (chrome.runtime.lastError) console.warn('[Groopa] Context send failed:', chrome.runtime.lastError.message);
    }
  );
})();
