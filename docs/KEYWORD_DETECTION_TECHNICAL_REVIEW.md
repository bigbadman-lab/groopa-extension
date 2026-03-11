# Groopa Chrome Extension — Keyword Detection System: Full Technical Review

This document describes how post text is matched against tracked keywords, where each step lives in the codebase, current weaknesses, and where to plug in an improved matching layer without breaking the pipeline.

---

## 1. Where tracked keywords are stored

| Aspect | Detail |
|--------|--------|
| **File** | **storage.js** |
| **API** | `getSettings()` reads settings; `saveSettings(data)` writes them. Keywords are one of the merged keys. |
| **Storage format** | **chrome.storage.sync**: key `keywords`, value **array of strings** (e.g. `["plumber", "roof repair", "AC repair"]`). Sync is used so keywords follow the user across devices. |
| **Defaults** | `DEFAULTS.keywords = []` (storage.js line 11). |
| **Retrieval** | `const settings = await getSettings();` then `settings.keywords`. In **storage.js** `getSettings()` (lines 81–102): reads from sync + local, returns `keywords: Array.isArray(rawSync.keywords) ? rawSync.keywords : DEFAULTS.keywords`. |
| **Persistence** | `saveSettings({ keywords: keywordList })` (options.js when adding/removing/clearing). **storage.js** `saveSettings()` (109–118) merges `data.keywords` into current and calls `setInStorageSync(merged)`. |

**Other references:** options.js keeps an in-memory copy `keywordList` loaded from `settings.keywords` in `loadPage()`; popup.js reads `settings.keywords` for counts and setup state. The **single source of truth** for “what to match against” is `settings.keywords` as returned by `getSettings()` in the background script when processing candidates.

---

## 2. Where Facebook post text is extracted

All extraction happens in the **content script**, which runs on Facebook pages.

| Function | File | Role |
|----------|------|------|
| **getTextFromNode(node)** | content.js ~572 | Gets raw text: `node.innerText` or `node.textContent`, then `.trim()` and `.replace(/\s+/g, ' ')` (collapse whitespace). No stripping of leading/trailing words. |
| **getPostOnlyText(node)** | content.js ~585 | Clones node, removes nested `[role="article"]` (comments/replies), then `getTextFromNode(clone)`. Used when the node has nested articles so the “post” part is isolated. |
| **getPostTextOnly(node)** | content.js | Returns original post text only: `getPostOnlyText(node)` when node has nested `[role="article"]`, else `getTextFromNode(node)`. Comments are not scanned or used. |
| **extractVisiblePostCandidates()** | content.js | Uses `findBestPostNodes()`. For each node: `getPostTextOnly(node)` → post-only text; filters with `isLikelyRealPostText(postTrimmed)`; dedupes by post text slice; **textPreview** = post-only (or slice + '…'). Sends **candidates** with `textPreview`, `postUrl`, `postText` (no comment content). |

**Cleaning/normalization in content script:** Only trim and collapse spaces. No lowercase, no punctuation stripping, no stemming. The **text sent to the background** is “raw” post-only (no comment content); normalization is done in the background.

---

## 3. Where keyword matching currently happens

| Item | Location | Behavior |
|------|----------|----------|
| **Matching function** | **background.js** — **getMatchingKeywords(normalizedText, keywords)** (lines 7–16) |
| **Normalizer used for both text and keywords** | **storage.js** — **normalizeTextForFingerprint(text)** (lines 517–525), imported/used by background via `importScripts('storage.js')`. |

**getMatchingKeywords (background.js):**

```javascript
function getMatchingKeywords(normalizedText, keywords) {
  if (!normalizedText || !Array.isArray(keywords)) return [];
  const matched = [];
  for (let i = 0; i < keywords.length; i++) {
    const kw = (keywords[i] != null && typeof keywords[i] === 'string') ? keywords[i].trim() : '';
    if (kw.length === 0) continue;
    if (normalizedText.indexOf(normalizeTextForFingerprint(kw)) !== -1) matched.push(kw);
  }
  return matched;
}
```

**normalizeTextForFingerprint (storage.js):**

```javascript
function normalizeTextForFingerprint(text) {
  if (text == null || typeof text !== 'string') return '';
  return String(text)
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')  // zero-width / soft hyphen
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\u2026$|\.\.\.$/g, '')               // trailing ellipsis
    .toLowerCase();
}
```

**Matching logic:** Substring containment: the **normalized** post text is searched for the **normalized** keyword using `indexOf`. No word boundaries, no regex, no stemming, no typo tolerance. If the user’s keyword is stored as `"plumber"`, only the string `"plumber"` (after the same normalization) is sought in the normalized text.

**Where it’s called:** In the `PAGE_POST_CANDIDATES_DETECTED` handler (background.js):

- Match on **postText** only: `matchText = postText.trim()`, `matchedKeywords = getMatchingKeywordsV1(textForMatch, keywords)`.
- If `matchedKeywords.length === 0` the candidate is skipped; otherwise a detection is built and later deduped and stored.

Matching and lead creation use postText only; comment content is never used.

---

## 4. Full pipeline: Facebook DOM → extraction → match → storage → notification

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 1. CONTENT SCRIPT (content.js) — Facebook page                                   │
│    • findBestPostNodes() → [role="article"] (or fallback selectors)              │
│    • For each node: getPostTextOnly(node) → post-only text (no comments)        │
│    • getTextFromNode / getPostOnlyText: innerText/textContent, trim, \s+ → ' '   │
│    • extractVisiblePostCandidates(): textPreview = post-only (or slice + '…')    │
│    • runPostCandidateScan() → chrome.runtime.sendMessage(                        │
│        { type: 'PAGE_POST_CANDIDATES_DETECTED', candidates, sourceContext } )     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 2. BACKGROUND (background.js) — PAGE_POST_CANDIDATES_DETECTED                    │
│    • settings = await getSettings()  →  keywords = settings.keywords             │
│    • If group not tracked → return                                               │
│    • For each candidate: match on postText only (comment content ignored)        │
│        matchText = c.postText; textForMatch = truncate if needed                 │
│        matchedKeywords = getMatchingKeywordsV1(textForMatch, keywords)            │
│    • If matchedKeywords.length === 0 → skip candidate                            │
│    • Else: build fingerprint, push to newDetections (textPreview/postText only)  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 3. STORAGE (storage.js)                                                         │
│    • appendDetectionsIfNew(newDetections)                                        │
│    • Dedupe by canonical key (postUrl) or fingerprint (group + normalized text   │
│      preview + normalized keywords). Same post → merge metadata, no second lead. │
│    • getDetections() / saveDetections() persist list                             │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ 4. NOTIFICATION (background.js)                                                 │
│    • handleNewLeadAlert(added) — only for detections that were actually new      │
│    • Truly-new filter by getCanonicalLeadKey (avoid duplicate alerts)           │
│    • preview = cleanLeadDisplayText(rawPreview).slice(0, 80)  [display only]     │
│    • chrome.notifications.create(...)                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Data flow summary:** Raw DOM → **post-only text** (getPostTextOnly; no comment scanning) → textPreview/postText → sent to background → match on **postText** only → getMatchingKeywordsV1 → if match, detection created → appendDetectionsIfNew (dedupe) → store → notification with post-only preview.

---

## 5. Weaknesses in the current keyword detection

| Weakness | Explanation |
|----------|-------------|
| **Substring, not word-boundary** | `indexOf(normalizedKw)` matches inside words. Example: keyword `"car"` matches “**car**pet”, “**car**dio”, “s**car**”. Can cause false positives. |
| **No phrase/order** | Multi-word keyword “AC repair” is matched as the substring “ac repair” in normalized text. If the user wants exact phrase only, that’s satisfied; if they want “repair” and “AC” in any order, that’s not supported. |
| **Exact substring only** | No stemming: “plumber” does not match “plumbing”, “plumbers”; “repair” does not match “repairs”, “repaired”. Missed variants. |
| **Case handled, punctuation not** | `normalizeTextForFingerprint` lowercases and collapses spaces but does **not** strip punctuation. So “plumber” matches “plumber.” or “plumber!” (same substring), but “plumber's” stays “plumber's” and still contains “plumber”. Hyphens/ apostrophes can break word-boundary expectations (e.g. “non-plumber” contains “plumber”). |
| **No typo tolerance** | “plumer”, “plumbur” never match “plumber”. |
| **Truncation** | content.js sends at most 150 characters as `textPreview`. Matching runs on that truncated string. Long posts: only the first 150 chars are matched; keywords appearing only later are missed. |
| **Duplicate detections** | Handled by **appendDetectionsIfNew** (fingerprint + postUrl/canonical key). Same post in same group with same matched keywords → one lead. Different groups or different fingerprint (e.g. text preview changed) could theoretically create duplicates; in practice dedupe is strong. |
| **Match source (post-only)** | “Post” vs “comment” Only original post text is used; comments are not scanned or matched. |

---

## 6. Suggestions for improving keyword detection (MVP-friendly)

- **Normalization (quick win)**  
  In the **same** normalizer used for matching (or a shared one), strip punctuation and normalize apostrophes so that word boundaries are consistent. Example: replace `[^\w\s]` (or a safe subset) with space, then collapse spaces. Keep lowercase and whitespace collapse. Use this for both the text and the keyword when matching. Reduces “plumber's” vs “plumber” and hyphen issues.

- **Word-boundary matching (optional)**  
  For single-word keywords, require a word boundary: e.g. match `\bkeyword\b` in the normalized string (after replacing non-word chars with space). Reduces false positives like “car” in “carpet”. Can be a simple regex per keyword: `new RegExp('\\b' + escapeRegex(normalizedKw) + '\\b')`.

- **Keyword variants (MVP)**  
  Allow a keyword to expand to a small list of variants (e.g. “plumber” → [“plumber”, “plumbers”, “plumbing”]). Implement as: when building the list to match against, expand each stored keyword to 2–3 variants (suffix rules or a tiny map). Match if **any** variant appears. Keeps storage and UI unchanged (user still sees “plumber”) while improving recall.

- **Phrase matching**  
  Keep current behavior: multi-word keyword is one normalized substring. So “ac repair” is already phrase-ordered. For “repair” + “AC” in any order you’d need a different rule (e.g. “match all terms”); that can be a later option.

- **Typo tolerance (later)**  
  Levenshtein or similar is heavier; for MVP, optional “contains after 1-char ignore” or a small set of common substitutions (e.g. “plumer” → “plumber”) is possible but adds complexity. Recommend post-MVP.

**Recommended MVP set:** (1) Normalize punctuation (and optionally apostrophes) in the matching normalizer; (2) optional word-boundary for single-word keywords; (3) simple variant expansion (plumber → plumber, plumbers, plumbing) applied when matching. All of this can live behind a single function that returns whether a piece of text matches a keyword list, preserving the current `getMatchingKeywords` API shape.

---

## 7. Safest place to introduce an improved keyword matching engine

**Single point of use:** Keyword matching is used in exactly one place: **background.js**, inside the `PAGE_POST_CANDIDATES_DETECTED` handler, where:

- `normalized = normalizeTextForFingerprint(textPreview);`
- `matchedKeywords = getMatchingKeywords(normalized, keywords);`

**Safest insertion point:** Replace or extend **only** the matching layer used there, without changing:

- content.js (extraction, candidate shape, message type),
- storage.js (getSettings, saveSettings, appendDetectionsIfNew, buildDetectionFingerprint, getCanonicalLeadKey),
- or the rest of the background flow (group check, feed fingerprint, building newDetections, calling appendDetectionsIfNew, handleNewLeadAlert).

**Concrete approach:**

1. **Keep the same contract:** A function that takes “normalized post text” (or raw text + internal normalization) and “array of keyword strings” and returns “array of matched keyword strings” (the originals as stored, for display and fingerprint).
2. **Implement a new matcher** (e.g. in background.js or a small `keywordMatch.js` loaded by the worker) that:
   - Normalizes the text (and optionally keywords) with improved rules (punctuation, word boundaries, variants).
   - Returns the list of matched **stored** keywords (so UI and fingerprint still show the user’s chosen words).
3. **In background.js**, replace the two-line block:
   - Either keep `normalized = normalizeTextForFingerprint(textPreview)` and call a new `getMatchingKeywordsV2(normalized, keywords)`, **or**
   - Call a single new function `getMatchingKeywordsImproved(textPreview, keywords)` that does normalization + matching internally.
4. **Fingerprinting:** `buildDetectionFingerprint` and dedupe use `matchedKeywords` and normalized preview; they don’t care how `matchedKeywords` was computed. So as long as the new engine returns the same shape (array of strings from the original `keywords` list), no change is needed in storage.js for dedupe or display.

**What not to change:** content.js extraction, message payload, storage schema, appendDetectionsIfNew, getCanonicalLeadKey, handleNewLeadAlert, or options/popup keyword UI. That keeps the rest of the extension pipeline unchanged and limits risk to the matching logic only.

---

## File and function reference

| Purpose | File | Function(s) |
|---------|------|-------------|
| Keyword storage (read/write) | storage.js | getSettings, saveSettings, DEFAULTS.keywords, SYNC_KEYS |
| Text normalization for matching | storage.js | normalizeTextForFingerprint |
| Keyword matching | background.js | getMatchingKeywords |
| Post text extraction | content.js | getTextFromNode, getPostOnlyText, getPostTextOnly, extractVisiblePostCandidates (post-only) |
| Candidate handling & match call | background.js | PAGE_POST_CANDIDATES_DETECTED handler (settings.keywords, normalizeTextForFingerprint, getMatchingKeywords) |
| Dedupe & persistence | storage.js | appendDetectionsIfNew, buildDetectionFingerprint, getCanonicalLeadKey, getFingerprintContentPart |
| Notifications | background.js | handleNewLeadAlert, cleanLeadDisplayText (storage.js) for preview text |
