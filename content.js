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

  // Try these in order; first selector with nodes that have readable text wins
  const POST_SELECTORS = [
    '[role="article"]',
    'div[aria-posinset]',
    'div[data-pagelet*="FeedUnit"]',
    'div[role="feed"] > div',
    'div[data-ad-preview="message"]',
  ];

  function getTextFromNode(node) {
    const raw = node.innerText != null ? node.innerText : (node.textContent || '');
    return raw.trim().replace(/\s+/g, ' ');
  }

  function countNodesWithText(nodes) {
    var count = 0;
    for (var j = 0; j < nodes.length; j++) {
      if (getTextFromNode(nodes[j]).length >= MIN_TEXT_LEN) count++;
    }
    return count;
  }

  function findBestPostNodes() {
    for (var s = 0; s < POST_SELECTORS.length; s++) {
      var selector = POST_SELECTORS[s];
      var nodes = [];
      try {
        nodes = document.querySelectorAll(selector);
      } catch (e) {
        console.warn(PREFIX, 'Selector failed:', selector, e);
        continue;
      }
      var total = nodes.length;
      var withText = countNodesWithText(nodes);
      console.log(PREFIX, 'selector', selector, '— total nodes:', total, 'with readable text:', withText);
      if (total > 0 && withText > 0) {
        return { nodes: nodes, selector: selector };
      }
    }
    return { nodes: [], selector: 'none' };
  }

  function extractVisiblePostCandidates() {
    const { nodes, selector } = findBestPostNodes();
    const nodeCount = nodes.length;
    const candidates = [];
    const seen = new Set(); // avoid duplicate text

    for (let i = 0; i < nodeCount && candidates.length < MAX_CANDIDATES; i++) {
      const node = nodes[i];
      const cleaned = getTextFromNode(node);
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
