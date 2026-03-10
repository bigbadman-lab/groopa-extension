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

  /**
   * Safely check whether the extension context is still valid.
   * Content scripts can become stale after extension reload/update; delayed callbacks
   * may then run when chrome.runtime is invalidated and throw if we don't check.
   */
  function isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // ----- Joined-groups scan: /groups/joins/ with auto-scroll -----

  /**
   * Collect group links from the current DOM. Normalizes URLs, dedupes by id or URL.
   * Skips feed, discover, create, joins. Allows empty name (best-available from text).
   */
  function collectGroupsFromPage() {
    const anchors = document.querySelectorAll('a[href*="/groups/"]');
    const byKey = {};

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const rawHref = a.getAttribute('href') || '';
      if (!rawHref) continue;
      let absUrl = '';
      try {
        absUrl = new URL(rawHref, window.location.href).toString();
      } catch (_) {
        continue;
      }
      let u;
      try {
        u = new URL(absUrl);
      } catch (_) {
        continue;
      }
      if (u.hostname.indexOf('facebook.com') === -1) continue;
      const match = u.pathname.match(/\/groups\/([^/]+)/i);
      if (!match) continue;
      const segment = match[1];
      if (!segment) continue;
      const segLower = segment.toLowerCase();
      if (segLower === 'feed' || segLower === 'discover' || segLower === 'create' || segLower === 'joins') continue;

      const canonicalUrl = 'https://www.facebook.com/groups/' + segment;
      const id = /^[0-9]+$/.test(segment) ? segment : undefined;
      const name = (a.textContent || '').trim();

      const key = id ? 'id:' + id : 'url:' + canonicalUrl.toLowerCase();
      if (!byKey[key]) {
        byKey[key] = { id: id, name: name, url: canonicalUrl, sourceUrl: window.location.href };
      }
    }

    return byKey;
  }

  const MAX_SCROLL_CYCLES = 30;
  const SCROLL_WAIT_MS = 1500;
  const NO_NEW_CYCLES_STOP = 3;
  const SAME_HEIGHT_CYCLES_STOP = 2;

  /**
   * Run joined-groups scan with auto-scroll on /groups/joins/. Scrolls down, collects
   * groups, repeats. Stops when no new groups for 3 cycles, or height stable for 2, or max 30 cycles.
   */
  function scanJoinedGroupsPage() {
    return new Promise(function (resolve) {
      if (!isExtensionContextValid()) {
        resolve([]);
        return;
      }

      const allByKey = {};
      let noNewCount = 0;
      let lastHeight = 0;
      let sameHeightCount = 0;
      let cycle = 0;

      function runCycle() {
        if (!isExtensionContextValid()) {
          resolve(Object.keys(allByKey).map(function (k) { return allByKey[k]; }));
          return;
        }

        const beforeCount = Object.keys(allByKey).length;
        const pageGroups = collectGroupsFromPage();
        for (const k in pageGroups) {
          if (!allByKey[k]) allByKey[k] = pageGroups[k];
        }
        const newThisCycle = Object.keys(allByKey).length - beforeCount;

        if (newThisCycle === 0) {
          noNewCount++;
          if (noNewCount >= NO_NEW_CYCLES_STOP) {
            resolve(Object.keys(allByKey).map(function (k) { return allByKey[k]; }));
            return;
          }
        } else {
          noNewCount = 0;
        }

        const docEl = document.documentElement;
        const body = document.body;
        const scrollHeight = Math.max(docEl.scrollHeight || 0, body.scrollHeight || 0);
        if (scrollHeight === lastHeight) {
          sameHeightCount++;
          if (sameHeightCount >= SAME_HEIGHT_CYCLES_STOP) {
            resolve(Object.keys(allByKey).map(function (k) { return allByKey[k]; }));
            return;
          }
        } else {
          sameHeightCount = 0;
        }
        lastHeight = scrollHeight;

        cycle++;
        if (cycle >= MAX_SCROLL_CYCLES) {
          resolve(Object.keys(allByKey).map(function (k) { return allByKey[k]; }));
          return;
        }

        window.scrollTo(0, scrollHeight);
        setTimeout(runCycle, SCROLL_WAIT_MS);
      }

      runCycle();
    });
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!isExtensionContextValid()) return false;
    if (message && message.type === 'RUN_GROUP_MEMBERSHIP_SCAN') {
      scanJoinedGroupsPage()
        .then(function (groups) {
          sendResponse({ ok: true, groups: groups });
        })
        .catch(function (err) {
          sendResponse({ ok: false, error: err && err.message ? err.message : 'Scan failed' });
        });
      return true;
    }
    return false;
  });

  // ----- Visible post candidate detection (group pages only, with retries) -----
  if (!context.isGroupPage) return;

  const MAX_PREVIEW_LEN = 150;
  const MAX_CANDIDATES = 10;
  const MIN_TEXT_LEN = 25; // filter out empty or very short text
  const MIN_UNIQUENESS = 0.4; // unique words / total words (filters "Facebook Facebook Facebook")
  // Scheduled scans so we catch the feed after it renders (2s, 5s, 10s, 20s)
  const RETRY_DELAYS_MS = [2000, 5000, 10000, 20000];

  // Phrases that indicate feed controls or UI chrome, not real post content
  const JUNK_PHRASES = [
    'sort group feed',
    'sort feed by',
    'most relevant',
    'recent',
    'top posts',
    'see more',
    'see less',
    'write a comment',
    'sponsored',
    'promoted',
    'like · comment · share',
    'like comment share',
  ];

  function isLikelyRealPostText(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (t.length < MIN_TEXT_LEN) return false;

    const lower = t.toLowerCase();
    for (var p = 0; p < JUNK_PHRASES.length; p++) {
      if (lower.indexOf(JUNK_PHRASES[p]) !== -1) return false;
    }

    var words = t.split(/\s+/).filter(function (w) { return w.length > 0; });
    if (words.length >= 3) {
      var first = words[0].toLowerCase();
      var allSame = words.every(function (w) { return w.toLowerCase() === first; });
      if (allSame) return false;
    }
    if (words.length >= 5) {
      var seen = {};
      for (var i = 0; i < words.length; i++) {
        var w = words[i].toLowerCase();
        seen[w] = (seen[w] || 0) + 1;
      }
      var uniqueCount = Object.keys(seen).length;
      var ratio = uniqueCount / words.length;
      if (ratio < MIN_UNIQUENESS) return false;
    }
    return true;
  }

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
      if (isLikelyRealPostText(getTextFromNode(nodes[j]))) count++;
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
      const preview = (cleaned.slice(0, 80) || '(empty)') + (cleaned.length > 80 ? '…' : '');

      console.log(PREFIX, 'article', i + 1, '— raw length:', len, 'cleaned preview:', preview);

      if (!isLikelyRealPostText(cleaned)) {
        console.log(PREFIX, 'article', i + 1, '— skipped (short, UI chrome, or repetitive junk)');
        continue;
      }
      const key = typeof cleaned === 'string' ? cleaned.slice(0, 200).toLowerCase() : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        textPreview: cleaned.length > MAX_PREVIEW_LEN ? cleaned.slice(0, MAX_PREVIEW_LEN) + '…' : cleaned,
      });
    }
    return { candidates, nodeCount, selector };
  }

  function runPostCandidateScan(attemptLabel) {
    if (!isExtensionContextValid()) return;
    const { candidates, nodeCount, selector } = extractVisiblePostCandidates();
    console.log(PREFIX, attemptLabel, '— nodes found:', nodeCount, 'selector:', selector, 'candidates extracted:', candidates.length);
    if (candidates.length === 0) return;
    try {
      chrome.runtime.sendMessage(
        {
          type: 'PAGE_POST_CANDIDATES_DETECTED',
          candidates: candidates,
          url: window.location.href,
        },
        function sendMessageCallback() {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn(PREFIX, 'Post candidates send failed:', chrome.runtime.lastError.message);
          }
        }
      );
    } catch (err) {
      console.warn(PREFIX, 'runPostCandidateScan sendMessage error', err);
    }
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!isExtensionContextValid()) return false;
    if (message && message.type === 'RUN_GROUP_SCAN') {
      runPostCandidateScan('heartbeat');
      sendResponse({ ok: true });
    }
    return false;
  });

  // ----- Event-driven rescans (debounced) -----
  const MUTATION_DEBOUNCE_MS = 2500;
  const VISIBILITY_DELAY_MS = 500;
  const VISIBILITY_DEBOUNCE_MS = 2000;
  const SCROLL_DEBOUNCE_MS = 1500;

  let mutationScanTimer = null;
  let lastVisibilityScanAt = 0;
  let visibilityScanTimer = null;
  let scrollScanTimer = null;
  let feedObserver = null;

  function scheduleDebouncedMutationScan() {
    if (!isExtensionContextValid()) return;
    if (mutationScanTimer) clearTimeout(mutationScanTimer);
    mutationScanTimer = setTimeout(function () {
      mutationScanTimer = null;
      if (!isExtensionContextValid()) return;
      runPostCandidateScan('mutation');
    }, MUTATION_DEBOUNCE_MS);
  }

  function scheduleVisibilityRescan() {
    if (!isExtensionContextValid()) return;
    if (visibilityScanTimer) clearTimeout(visibilityScanTimer);
    visibilityScanTimer = setTimeout(function () {
      visibilityScanTimer = null;
      if (!isExtensionContextValid()) return;
      var now = Date.now();
      if (now - lastVisibilityScanAt >= VISIBILITY_DEBOUNCE_MS) {
        lastVisibilityScanAt = now;
        runPostCandidateScan('visibility');
      }
    }, VISIBILITY_DELAY_MS);
  }

  function scheduleDebouncedScrollScan() {
    if (!isExtensionContextValid()) return;
    if (scrollScanTimer) clearTimeout(scrollScanTimer);
    scrollScanTimer = setTimeout(function () {
      scrollScanTimer = null;
      if (!isExtensionContextValid()) return;
      runPostCandidateScan('scroll');
    }, SCROLL_DEBOUNCE_MS);
  }

  function startFeedObserver() {
    if (feedObserver) return;
    var root = document.body;
    if (!root) return;
    feedObserver = new MutationObserver(function (_mutations) {
      if (!isExtensionContextValid()) return;
      scheduleDebouncedMutationScan();
    });
    feedObserver.observe(root, { childList: true, subtree: true });
    console.log(PREFIX, 'MutationObserver attached for event-driven rescans');
  }

  function stopFeedObserver() {
    if (feedObserver) {
      feedObserver.disconnect();
      feedObserver = null;
      console.log(PREFIX, 'MutationObserver disconnected');
    }
  }

  if (document.body) {
    startFeedObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startFeedObserver);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      scheduleVisibilityRescan();
    }
  });

  window.addEventListener('scroll', function () {
    scheduleDebouncedScrollScan();
  }, { passive: true });

  // Run scheduled scans; each sends PAGE_POST_CANDIDATES_DETECTED (background dedupes detections)
  const retryTimerIds = [];
  RETRY_DELAYS_MS.forEach(function (delayMs, index) {
    const id = setTimeout(function () {
      if (!isExtensionContextValid()) return;
      runPostCandidateScan('scheduled scan ' + (index + 1) + ' @ ' + delayMs + 'ms');
    }, delayMs);
    retryTimerIds.push(id);
  });

  function clearAllScanTimers() {
    if (mutationScanTimer) {
      clearTimeout(mutationScanTimer);
      mutationScanTimer = null;
    }
    if (visibilityScanTimer) {
      clearTimeout(visibilityScanTimer);
      visibilityScanTimer = null;
    }
    if (scrollScanTimer) {
      clearTimeout(scrollScanTimer);
      scrollScanTimer = null;
    }
    retryTimerIds.forEach(clearTimeout);
    retryTimerIds.length = 0;
  }

  window.addEventListener('pagehide', clearAllScanTimers);
  window.addEventListener('beforeunload', clearAllScanTimers);
})();
