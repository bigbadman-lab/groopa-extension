# Groopa Chrome Extension – Text Extraction Pipeline Audit

**Purpose:** Trace where post text flows from raw DOM to display and identify why the **first word** of some Facebook posts is lost.  
**Date:** 2026-03-10  
**Scope:** content.js → background.js → storage.js → options/popup/notifications (display only).

---

## 1. Files and functions in the text pipeline

| File | Function | Role |
|------|----------|------|
| **content.js** | `getTextFromNode(node)` | Raw text from node: `innerText`/`textContent` → trim → collapse whitespace. |
| **content.js** | `getPostOnlyText(node)` | Clone, remove nested `[role="article"]`, then `getTextFromNode(clone)`. |
| **content.js** | `getPostTextOnly(node)` | Returns original post text only; comments are not scanned or used. |
| **content.js** | `extractVisiblePostCandidates()` | Builds candidates from post-only text: `textPreview`, `postUrl`, `postText` (no comment content). |
| **content.js** | `runPostCandidateScan()` | Calls `extractVisiblePostCandidates`, sends `PAGE_POST_CANDIDATES_DETECTED` with `candidates`. |
| **background.js** | `PAGE_POST_CANDIDATES_DETECTED` handler | Receives `candidates`; uses `c.textPreview` for keyword matching and for `newDetections` (`textPreview`, `text`). |
| **background.js** | Notification preview | `preview = cleanLeadDisplayText(rawPreview).slice(0, 80)`. |
| **storage.js** | `cleanLeadDisplayText(rawText)` | **Display-only.** Strips trailing UI junk and **optionally 1–2 leading title-case words** (see below). |
| **storage.js** | `cleanPostTextForFingerprint` / `normalizeTextForFingerprint` | Used for **fingerprinting/dedupe only**; do not alter stored or displayed post text. |
| **options.js** | Inbox list/detail | `rawText = d.text ?? d.textPreview` → `text = cleanLeadDisplayText(rawText)` → snippet. |
| **popup.js** | Lead list/detail | Same: `cleanLeadDisplayText(rawText)` for displayed snippet. |

---

## 2. Full execution path for post text

```
1. content.js
   Raw DOM (article node)
   → getTextFromNode / getPostOnlyText / getPostTextOnly
   → post-only text (no comment content)
   → extractVisiblePostCandidates: textPreview = post-only (or slice + '…')
   → candidates[] sent via PAGE_POST_CANDIDATES_DETECTED

2. background.js
   Receives candidates; for each: textPreview = c.textPreview (unchanged)
   → keyword match on normalizeTextForFingerprint(textPreview)
   → newDetections.push({ textPreview, text: textPreview, ... })
   → saveDetections() → stored as-is (textPreview / text)

3. Display (options, popup, notifications)
   rawText = detection.text ?? detection.textPreview
   → cleanLeadDisplayText(rawText)  ← ONLY place that can drop the first word
   → slice(0, N) for snippet/preview
   → UI
```

**Stored text is never modified.** The first word is lost only in **display**, when `cleanLeadDisplayText()` strips a leading prefix.

---

## 3. Most likely location where the first word is lost

**storage.js – `cleanLeadDisplayText()` (lines ~471–479)**

```javascript
const leadingNameMatch = s.match(/^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(.+)$/);
if (leadingNameMatch) {
  const remainder = leadingNameMatch[2].trim();
  if (remainder.length >= 20) {
    s = remainder;  // first 1–2 words discarded
    s = s.replace(/\s+/g, ' ').trim();
  }
}
```

- **Intent:** Remove a leading “author name” (1–2 title-case words) when the rest of the string is long (≥ 20 chars).
- **Effect:** Any post that **starts with one or two capitalized words** (e.g. “Looking for a plumber…”, “Anyone know…”, “Need help…”) can have that word (or two) removed and only the remainder shown in inbox, popup, and notification previews.
- **Not used for:** Stored `textPreview`/`text`; fingerprinting. Only for **display** in options, popup, and background notification preview.

No other pipeline step removes leading words. Slicing elsewhere is `slice(0, N)` (keeps the start).

---

## 4. Temporary debug logs added

All logs use the prefix `[Groopa]` or the content script `PREFIX` plus `[text-pipeline]` so you can filter in DevTools.

| Location | Log |
|----------|-----|
| **content.js** `getTextFromNode` | `[text-pipeline] getTextFromNode raw first80= … → out first80= …` (when non-empty). |
| **content.js** | Post-only extraction; no combined/comment log. |
| **content.js** `extractVisiblePostCandidates` | `[text-pipeline] candidate textPreview first80= …` (per candidate). |
| **background.js** `PAGE_POST_CANDIDATES_DETECTED` | `[text-pipeline] background received textPreview first80= …` (first candidate only). |
| **storage.js** `cleanLeadDisplayText` | `[text-pipeline] cleanLeadDisplayText in first80= … out first80= … leadingStripped= true/false` (only when output differs from input or leading prefix was stripped). |

**How to use:** Reproduce one problematic post (e.g. “Looking for…”), open DevTools (page console for content.js; extension service worker for background; options page for options). Compare the same post’s text at each stage; when `leadingStripped=true` and the first word disappears between `in first80` and `out first80`, the cause is confirmed.

---

## 5. Risky regexes / transformations

| Location | Pattern / logic | Risk |
|----------|------------------|------|
| **storage.js** `cleanLeadDisplayText` | `^\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(.+)$` | **High.** Strips 1–2 leading title-case words when remainder ≥ 20 chars; matches normal post openers (“Looking”, “Anyone”, “Need”), not just names. |
| **storage.js** `cleanLeadDisplayText` | Trailing regexes (times, “Like · Reply · Share”) | Low; they trim the end only. |
| **content.js** | `slice(0, MAX_PREVIEW_LEN)` | None; keeps the start. |
| **storage.js** `cleanPostTextForFingerprint` / `normalizeTextForFingerprint` | Trailing junk, lowercase | Used only for fingerprinting; do not change stored or displayed text. |

---

## 6. Recommendation for the safest fix

- **Do not** change content.js extraction, background.js candidate handling, or how `textPreview`/`text` are stored.
- **Do** fix display-only behavior in **storage.js `cleanLeadDisplayText()`**:
  - **Option A (safest for MVP):** Remove the `leadingNameMatch` block entirely so no leading words are ever stripped. Restore it later only if you have a clear signal for “author name” (e.g. separate field from Facebook).
  - **Option B (if you keep it):** Restrict the regex to cases where the leading part looks like “FirstName LastName” (e.g. two words only, both title-case) and the remainder is a full sentence, and/or only apply it when you have an explicit “author name” from the DOM to strip. Avoid matching generic openers like “Looking for”, “Anyone know”, “Need help”.

After changing `cleanLeadDisplayText`, run through one previously-broken post and confirm in the new debug logs that `leadingStripped` is false and the first word appears in `out first80`.
