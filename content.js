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

  const RESERVED_GROUP_SEGMENTS = ['feed', 'discover', 'create', 'joins'];

  function isReservedSegment(segment) {
    if (!segment) return true;
    return RESERVED_GROUP_SEGMENTS.indexOf(String(segment).toLowerCase()) !== -1;
  }

  /**
   * Parse group segment and build canonical URL/key. Returns null if reserved or invalid.
   */
  function parseGroupLinkFromHref(href) {
    if (!href || typeof href !== 'string') return null;
    try {
      const u = new URL(href.trim(), window.location.href);
      if (u.hostname.indexOf('facebook.com') === -1) return null;
      const match = u.pathname.match(/\/groups\/([^/]+)/i);
      if (!match || !match[1]) return null;
      const segment = match[1];
      if (isReservedSegment(segment)) return null;
      const canonicalUrl = 'https://www.facebook.com/groups/' + segment;
      const id = /^[0-9]+$/.test(segment) ? segment : undefined;
      const key = id ? 'id:' + id : 'url:' + canonicalUrl.toLowerCase();
      return { segment: segment, url: canonicalUrl, id: id, key: key };
    } catch (_) {
      return null;
    }
  }

  /**
   * Strip UI chrome from a candidate group name (members, posts, "Public group", etc.).
   */
  function cleanGroupNameForJoins(str) {
    if (!str || typeof str !== 'string') return '';
    let s = str.trim().replace(/\s+/g, ' ');
    // Remove "Last active X <unit> ago" (e.g. "Last active 12 weeks ago", "· Last active 2 days ago")
    s = s.replace(/\s*[·\-–]?\s*Last\s+active\s+\d+\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\s+ago\s*/gi, '');
    // Remove common suffixes: "· 5.2K members", "· 12 posts this week", "Public group", "Join", "Joined", "Leave"
    s = s.replace(/\s*·\s*[\d.,KkMm]+?\s*(members?|posts?\s*(this\s*week|today)?)\s*$/gi, '');
    s = s.replace(/\s*Public\s+group\s*$/gi, '');
    s = s.replace(/\s*(Join|Joined|Leave|Leave group)\s*$/gi, '');
    s = s.replace(/\s*\d+\s*(members?|posts?)\s*$/gi, '');
    s = s.replace(/\s*[·\-–]+\s*$/, '').replace(/^\s*[·\-–]+\s*/, '');
    return s.trim();
  }

  /**
   * Find the best container for a group link (card/list item). Tries multiple patterns for tolerance.
   */
  function getGroupContainer(linkEl) {
    if (!linkEl || !linkEl.closest) return null;
    const selectors = [
      '[role="listitem"]',
      'article',
      '[role="list"] > *',
      '[data-pagelet]',
      '[role="main"] div[style*="overflow"]',
    ];
    for (let s = 0; s < selectors.length; s++) {
      try {
        const found = linkEl.closest(selectors[s]);
        if (found && found !== linkEl && found.getBoundingClientRect && found.getBoundingClientRect().height > 15) return found;
      } catch (_) {}
    }
    let parent = linkEl.parentElement;
    for (let i = 0; i < 15 && parent; i++) {
      if (parent.getBoundingClientRect && parent.getBoundingClientRect().height > 20) return parent;
      parent = parent.parentElement;
    }
    return linkEl.parentElement;
  }

  /**
   * Extract the best available group name from a link and its container (heading, aria-label, link text).
   */
  function getBestGroupNameFromContainer(linkEl, container, segmentFallback) {
    const linkText = cleanGroupNameForJoins((linkEl.textContent || '').trim());
    if (linkText.length >= 2 && linkText.length <= 120) return linkText;
    if (!container || container === linkEl) return segmentFallback || '';
    const heading = container.querySelector('[role="heading"], h1, h2, h3, h4');
    if (heading) {
      const t = cleanGroupNameForJoins((heading.textContent || '').trim());
      if (t.length >= 2 && t.length <= 120) return t;
    }
    const ariaLabel = linkEl.getAttribute('aria-label') || container.getAttribute('aria-label') || linkEl.getAttribute('title');
    if (ariaLabel) {
      const t = cleanGroupNameForJoins(ariaLabel);
      if (t.length >= 2 && t.length <= 120) return t;
    }
    return segmentFallback || '';
  }

  /**
   * Dedicated collector for https://www.facebook.com/groups/joins/. Uses container-based
   * extraction and stronger name cleaning. Rescans full DOM each call.
   */
  function collectGroupsFromJoinsPage() {
    const byKey = {};
    const anchors = document.querySelectorAll('a[href*="/groups/"]');
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const parsed = parseGroupLinkFromHref(a.getAttribute('href') || '');
      if (!parsed) continue;
      const container = getGroupContainer(a);
      const name = getBestGroupNameFromContainer(a, container, parsed.segment);
      const existing = byKey[parsed.key];
      const useName = (name && name.length > 0) ? name : (existing && existing.name ? existing.name : '');
      if (!existing || (useName.length > 0 && (!existing.name || existing.name.length < useName.length))) {
        byKey[parsed.key] = {
          id: parsed.id,
          name: useName,
          url: parsed.url,
          sourceUrl: window.location.href,
        };
      } else if (!existing.name && useName) {
        existing.name = useName;
      }
    }
    return byKey;
  }

  /**
   * Generic collector (fallback for non-joins pages). Normalizes URLs, skips reserved segments.
   */
  function collectGroupsFromPage() {
    const anchors = document.querySelectorAll('a[href*="/groups/"]');
    const byKey = {};
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const parsed = parseGroupLinkFromHref(a.getAttribute('href') || '');
      if (!parsed) continue;
      const name = cleanGroupNameForJoins((a.textContent || '').trim());
      if (!byKey[parsed.key]) {
        byKey[parsed.key] = { id: parsed.id, name: name, url: parsed.url, sourceUrl: window.location.href };
      } else if (name && (!byKey[parsed.key].name || byKey[parsed.key].name.length < name.length)) {
        byKey[parsed.key].name = name;
      }
    }
    return byKey;
  }

  const MAX_SCROLL_CYCLES = 60;
  const SCROLL_WAIT_MS = 2200;
  const NO_NEW_CYCLES_STOP = 5;
  const SAME_HEIGHT_CYCLES_STOP = 3;

  /**
   * Heuristic: find the scrollable element that likely contains the joined-groups list.
   * Prefers an element with overflow scroll/auto, scrollHeight > clientHeight, that contains group links.
   */
  function findScrollContainer() {
    const minHeight = 200;
    const candidates = [];
    const divs = document.querySelectorAll('div');
    for (let i = 0; i < divs.length && candidates.length < 50; i++) {
      const el = divs[i];
      if (el.clientHeight < minHeight || el.scrollHeight <= el.clientHeight) continue;
      const style = window.getComputedStyle(el);
      const ov = (style.overflowY || '') + (style.overflow || '');
      if (ov.indexOf('auto') === -1 && ov.indexOf('scroll') === -1) continue;
      const links = el.querySelectorAll('a[href*="/groups/"]');
      let validLinks = 0;
      for (let j = 0; j < links.length; j++) {
        if (parseGroupLinkFromHref(links[j].getAttribute('href'))) validLinks++;
      }
      if (validLinks > 0) candidates.push({ el: el, scrollHeight: el.scrollHeight, validLinks: validLinks });
    }
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) {
      if (b.validLinks !== a.validLinks) return b.validLinks - a.validLinks;
      return b.scrollHeight - a.scrollHeight;
    });
    return candidates[0].el;
  }

  /**
   * Run joined-groups scan with auto-scroll on /groups/joins/. Uses internal scroll container when found.
   * Rescans full DOM each cycle. Stops after 5 no-new cycles, 3 same-height cycles, or 60 cycles.
   */
  function scanJoinedGroupsPage() {
    return new Promise(function (resolve) {
      if (!isExtensionContextValid()) {
        resolve({ groups: [], cycleStats: [] });
        return;
      }
      const pathname = (window.location.pathname || '').toLowerCase();
      const isJoinsPage = pathname.indexOf('/groups/joins') !== -1;
      const collector = isJoinsPage ? collectGroupsFromJoinsPage : collectGroupsFromPage;

      const scrollContainer = isJoinsPage ? findScrollContainer() : null;
      const scrollTargetType = scrollContainer ? 'container' : 'window';
      const allByKey = {};
      let noNewCount = 0;
      let lastScrollHeight = 0;
      let sameHeightCount = 0;
      let cycle = 0;
      const cycleStats = [];

      function getScrollHeight() {
        if (scrollContainer) return scrollContainer.scrollHeight;
        const docEl = document.documentElement;
        const body = document.body;
        return Math.max(docEl.scrollHeight || 0, body.scrollHeight || 0);
      }
      function getScrollTop() {
        if (scrollContainer) return scrollContainer.scrollTop;
        return window.scrollY || document.documentElement.scrollTop || 0;
      }
      function doScroll(heightOrPosition) {
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        } else {
          window.scrollTo(0, heightOrPosition);
        }
      }

      function runCycle() {
        if (!isExtensionContextValid()) {
          resolve({ groups: Object.keys(allByKey).map(function (k) { return allByKey[k]; }), cycleStats: cycleStats });
          return;
        }

        const beforeCount = Object.keys(allByKey).length;
        const pageGroups = collector();
        const candidateLinksCount = isJoinsPage ? document.querySelectorAll('a[href*="/groups/"]').length : 0;
        for (const k in pageGroups) {
          const incoming = pageGroups[k];
          if (!allByKey[k]) {
            allByKey[k] = incoming;
          } else if (incoming.name && (!allByKey[k].name || allByKey[k].name.length < incoming.name.length)) {
            allByKey[k] = { ...allByKey[k], name: incoming.name };
          }
        }
        const uniqueCount = Object.keys(allByKey).length;
        const newThisCycle = uniqueCount - beforeCount;
        const scrollHeight = getScrollHeight();
        const scrollTop = getScrollTop();

        const stats = {
          cycle: cycle,
          scrollTargetType: scrollTargetType,
          scrollContainerFound: !!scrollContainer,
          uniqueCount: uniqueCount,
          newThisCycle: newThisCycle,
          scrollHeight: scrollHeight,
          scrollTop: scrollTop,
          candidateLinksCount: candidateLinksCount,
        };
        cycleStats.push(stats);
        console.log(PREFIX, 'Scan cycle', stats);

        if (newThisCycle === 0) {
          noNewCount++;
          if (noNewCount >= NO_NEW_CYCLES_STOP) {
            resolve({ groups: Object.keys(allByKey).map(function (k) { return allByKey[k]; }), cycleStats: cycleStats });
            return;
          }
        } else {
          noNewCount = 0;
        }

        if (scrollHeight === lastScrollHeight) {
          sameHeightCount++;
          if (sameHeightCount >= SAME_HEIGHT_CYCLES_STOP) {
            resolve({ groups: Object.keys(allByKey).map(function (k) { return allByKey[k]; }), cycleStats: cycleStats });
            return;
          }
        } else {
          sameHeightCount = 0;
        }
        lastScrollHeight = scrollHeight;

        cycle++;
        if (cycle >= MAX_SCROLL_CYCLES) {
          resolve({ groups: Object.keys(allByKey).map(function (k) { return allByKey[k]; }), cycleStats: cycleStats });
          return;
        }

        doScroll(scrollHeight);
        setTimeout(runCycle, SCROLL_WAIT_MS);
      }

      runCycle();
    });
  }

  // ----- Experimental: /groups/feed per-post group extraction (debug only) -----

  function isReservedGroupSegment(segment) {
    if (!segment) return true;
    const s = String(segment).toLowerCase();
    return s === 'feed' || s === 'joins' || s === 'discover' || s === 'create';
  }

  /**
   * Best-effort extract group segment and canonical URL from an anchor href.
   * Returns null if reserved or invalid.
   */
  function parseGroupLink(href) {
    if (!href || typeof href !== 'string') return null;
    try {
      const u = new URL(href.trim(), window.location.href);
      if (u.hostname.indexOf('facebook.com') === -1) return null;
      const match = u.pathname.match(/\/groups\/([^/]+)/i);
      if (!match || !match[1]) return null;
      const segment = match[1];
      if (isReservedGroupSegment(segment)) return null;
      const canonicalUrl = 'https://www.facebook.com/groups/' + segment;
      const key = /^[0-9]+$/.test(segment) ? 'id:' + segment : 'url:' + canonicalUrl.toLowerCase();
      return { segment: segment, url: canonicalUrl, key: key };
    } catch (_) {
      return null;
    }
  }

  // Generic UI phrases we do not want to treat as group names (experiment heuristics)
  var GROUP_FEED_GENERIC_PHRASES = [
    'see more', 'see less', 'more', '…', 'group', 'groups', 'feed', 'join', 'joined',
    'share', 'comment', 'like', 'relevance', 'recent', 'top posts', 'sort',
  ];

  function looksLikeGenericUi(text) {
    if (!text || typeof text !== 'string') return true;
    var t = text.trim().toLowerCase().slice(0, 50);
    if (t.length === 0) return true;
    for (var g = 0; g < GROUP_FEED_GENERIC_PHRASES.length; g++) {
      if (t === GROUP_FEED_GENERIC_PHRASES[g] || t.indexOf(GROUP_FEED_GENERIC_PHRASES[g] + ' ') === 0) return true;
    }
    return false;
  }

  var MAX_GROUP_LINK_CANDIDATES_PER_ARTICLE = 15;

  /**
   * Experimental: scan visible posts on /groups/feed and try to extract per-post source group.
   * Collects ALL valid group-link candidates per article, then picks one by simple heuristics.
   * Results are for inspection only; do not feed into production detection pipeline.
   */
  function runGroupFeedExperiment() {
    const pathname = window.location.pathname || '';
    if (pathname.indexOf('/groups/feed') === -1) return [];
    const articles = document.querySelectorAll('[role="article"]');
    const results = [];
    const previewLen = 120;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const text = (article.innerText || article.textContent || '').trim().replace(/\s+/g, ' ').slice(0, previewLen);
      const linkEls = article.querySelectorAll('a[href*="/groups/"]');
      const groupLinkCandidates = [];

      for (let j = 0; j < linkEls.length && groupLinkCandidates.length < MAX_GROUP_LINK_CANDIDATES_PER_ARTICLE; j++) {
        const a = linkEls[j];
        const href = a.getAttribute('href') || '';
        const parsed = parseGroupLink(href);
        if (!parsed) continue;
        const linkText = (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150);
        groupLinkCandidates.push({
          positionIndex: j,
          href: href,
          normalizedUrl: parsed.url,
          key: parsed.key,
          text: linkText,
          isNumeric: /^[0-9]+$/.test(parsed.segment),
        });
      }

      // Heuristic pick: prefer non-empty text, text that looks like a name, and earlier position
      let chosen = null;
      let bestScore = -1;
      for (let k = 0; k < groupLinkCandidates.length; k++) {
        const c = groupLinkCandidates[k];
        let score = 0;
        if (c.text.length > 0) score += 2;
        if (c.text.length >= 2 && c.text.length <= 100) score += 1;
        if (looksLikeGenericUi(c.text)) score -= 2;
        score -= c.positionIndex * 0.1;
        if (score > bestScore) {
          bestScore = score;
          chosen = c;
        }
      }
      if (!chosen && groupLinkCandidates.length > 0) chosen = groupLinkCandidates[0];

      const extractedGroupName = chosen && chosen.text ? chosen.text : '';
      const extractedGroupUrl = chosen ? chosen.normalizedUrl : '';
      const extractedGroupKey = chosen ? chosen.key : '';

      results.push({
        articleIndex: i,
        textPreview: text || '',
        extractedGroupName: extractedGroupName,
        extractedGroupUrl: extractedGroupUrl,
        extractedGroupKey: extractedGroupKey,
        groupLinkCandidates: groupLinkCandidates,
      });
    }

    return results;
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!isExtensionContextValid()) return false;
    if (message && message.type === 'RUN_GROUP_MEMBERSHIP_SCAN') {
      scanJoinedGroupsPage()
        .then(function (result) {
          const groups = (result && result.groups) ? result.groups : [];
          const cycleStats = (result && result.cycleStats) ? result.cycleStats : [];
          sendResponse({ ok: true, groups: groups, cycleStats: cycleStats });
        })
        .catch(function (err) {
          sendResponse({ ok: false, error: err && err.message ? err.message : 'Scan failed' });
        });
      return true;
    }
    if (message && message.type === 'RUN_GROUP_FEED_EXPERIMENT') {
      const pathname = (window.location.pathname || '').toLowerCase();
      if (pathname.indexOf('/groups/feed') === -1) {
        sendResponse({ ok: false, error: 'Not on /groups/feed. Open https://www.facebook.com/groups/feed first.' });
        return true;
      }
      const candidates = runGroupFeedExperiment();
      console.log(PREFIX, 'Group feed experiment — candidates:', candidates);
      sendResponse({ ok: true, candidates: candidates });
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

  /**
   * Try to find a post permalink inside an article (timestamp/post-detail link).
   * Prefers links with /posts/, /permalink/, or story_fbid; otherwise first facebook.com link that looks like a post.
   * @param {Element} article
   * @returns {string} absolute URL or ''
   */
  function extractPostUrlFromArticle(article) {
    if (!article || !article.querySelectorAll) return '';
    const anchors = article.querySelectorAll('a[href]');
    let best = '';
    let fallback = '';
    for (let i = 0; i < anchors.length; i++) {
      const href = (anchors[i].getAttribute('href') || '').trim();
      if (!href || href === '#') continue;
      let abs = '';
      try {
        abs = new URL(href, window.location.href).href;
      } catch (_) {
        continue;
      }
      if (abs.indexOf('facebook.com') === -1) continue;
      const lower = abs.toLowerCase();
      if (lower.indexOf('/posts/') !== -1 || lower.indexOf('/permalink') !== -1 || lower.indexOf('story_fbid') !== -1) {
        best = abs;
        break;
      }
      if (!fallback && lower.indexOf('/groups/') !== -1 && (lower.indexOf('/posts/') !== -1 || lower.split('/groups/')[1].split('/').filter(Boolean).length > 1)) {
        fallback = abs;
      } else if (!fallback && (lower.indexOf('story_fbid') !== -1 || lower.indexOf('pc_id') !== -1)) {
        fallback = abs;
      }
    }
    const chosen = best || fallback;
    if (!chosen) return '';
    try {
      const u = new URL(chosen);
      u.hash = '';
      return u.href;
    } catch (_) {
      return chosen;
    }
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

      const postUrl = extractPostUrlFromArticle(node);
      if (postUrl) console.log(PREFIX, 'article', i + 1, '— postUrl:', postUrl.slice(0, 80) + (postUrl.length > 80 ? '…' : ''));

      candidates.push({
        textPreview: cleaned.length > MAX_PREVIEW_LEN ? cleaned.slice(0, MAX_PREVIEW_LEN) + '…' : cleaned,
        postUrl: postUrl || undefined,
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
