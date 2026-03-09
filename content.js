// Groopa content script — runs on Facebook pages; detects context and group pages

(function () {
  const PREFIX = '[Groopa]';

  function buildFacebookContext() {
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

    if (!isFacebook) return context;

    // Detect group page: /groups/ in path
    const groupsMatch = pathname.match(/\/groups\/([^/]+)/);
    if (groupsMatch) {
      context.isGroupPage = true;
      context.groupIdentifier = groupsMatch[1];
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
    return context;
  }

  const context = buildFacebookContext();

  if (!context.isFacebook) {
    chrome.runtime.sendMessage(
      { type: 'CONTENT_SCRIPT_PING', url: window.location.href, title: document.title || '' },
      function () {}
    );
    return;
  }

  // Send context to background
  chrome.runtime.sendMessage(
    { type: 'FACEBOOK_CONTEXT_DETECTED', context },
    function () {
      if (chrome.runtime.lastError) console.warn(PREFIX, 'Context send failed:', chrome.runtime.lastError.message);
    }
  );

  // ----- Visible post candidate detection (group pages only, with retries) -----
  if (!context.isGroupPage) return;

  const MAX_PREVIEW_LEN = 150;
  const MAX_CANDIDATES = 10;
  const MIN_TEXT_LEN = 25; // filter out empty or very short text
  const RETRY_DELAYS_MS = [1500, 4000, 8000];

  function getPostNodes() {
    let nodes = document.querySelectorAll('[role="article"]');
    if (nodes.length > 0) return { nodes, selector: '[role="article"]' };
    // Fallback: try common Facebook feed story container
    nodes = document.querySelectorAll('div[data-ad-comet-preview="feed_story"]');
    if (nodes.length > 0) return { nodes, selector: 'div[data-ad-comet-preview="feed_story"]' };
    nodes = document.querySelectorAll('div[data-ad-comet-preview]');
    if (nodes.length > 0) return { nodes, selector: 'div[data-ad-comet-preview]' };
    return { nodes: [], selector: 'none' };
  }

  function extractVisiblePostCandidates() {
    const { nodes, selector } = getPostNodes();
    const nodeCount = nodes.length;
    const candidates = [];
    const seen = new Set(); // avoid duplicate text

    for (let i = 0; i < nodeCount && candidates.length < MAX_CANDIDATES; i++) {
      const node = nodes[i];
      const raw = node.innerText != null ? node.innerText : (node.textContent || '');
      const cleaned = raw.trim().replace(/\s+/g, ' ');
      const len = cleaned.length;

      console.log(PREFIX, 'article', i + 1, '— raw length:', len, 'cleaned preview:', (cleaned.slice(0, 80) || '(empty)') + (cleaned.length > 80 ? '…' : ''));

      if (len < MIN_TEXT_LEN) continue;
      const key = cleaned.slice(0, 200).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        textPreview: cleaned.length > MAX_PREVIEW_LEN ? cleaned.slice(0, MAX_PREVIEW_LEN) + '…' : cleaned,
      });
    }
    return { candidates, nodeCount, selector };
  }

  function runPostCandidateScan(attemptLabel) {
    const { candidates, nodeCount, selector } = extractVisiblePostCandidates();
    console.log(PREFIX, attemptLabel, '— nodes found:', nodeCount, 'selector:', selector, 'candidates extracted:', candidates.length);
    if (candidates.length > 0) {
      chrome.runtime.sendMessage(
        {
          type: 'PAGE_POST_CANDIDATES_DETECTED',
          candidates,
          url: window.location.href,
        },
        function () {
          if (chrome.runtime.lastError) console.warn(PREFIX, 'Post candidates send failed:', chrome.runtime.lastError.message);
        }
      );
    }
  }

  // Run at 1.5s, 4s, and 8s so we catch content that loads after the first script run
  RETRY_DELAYS_MS.forEach(function (delayMs, index) {
    setTimeout(function () {
      runPostCandidateScan('scan ' + (index + 1) + ' @ ' + delayMs + 'ms');
    }, delayMs);
  });
})();
