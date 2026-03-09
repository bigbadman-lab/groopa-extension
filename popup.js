// Groopa popup — dashboard: load settings and render

const heroStatus = document.getElementById('hero-status');
const heroDetail = document.getElementById('hero-detail');
const countKeywords = document.getElementById('count-keywords');
const countGroups = document.getElementById('count-groups');
const countDetections = document.getElementById('count-detections');
const keywordsChips = document.getElementById('keywords-chips');
const openSettingsBtn = document.getElementById('open-settings');

// Load from chrome.storage.sync and render dashboard
chrome.storage.sync.get(
  ['isPaidUser', 'keywords', 'soundEnabled', 'trackedGroups', 'detections'],
  (result) => {
    const isPaidUser = result.isPaidUser === true;
    const keywords = result.keywords || [];
    const soundEnabled = result.soundEnabled !== false;
    const trackedGroups = result.trackedGroups || [];
    const detections = result.detections || [];

    const keywordList = Array.isArray(keywords) ? keywords : [];
    const groupsList = Array.isArray(trackedGroups) ? trackedGroups : [];
    const detectionsList = Array.isArray(detections) ? detections : [];

    // Hero status
    if (!isPaidUser) {
      heroStatus.textContent = 'Paid access required';
      heroDetail.textContent = 'Enable paid user access in Settings to use Groopa.';
    } else {
      heroStatus.textContent = 'Groopa is ready';
      heroDetail.textContent = soundEnabled ? 'Sound notifications on' : 'Sound notifications off';
    }

    // Summary counts
    countKeywords.textContent = keywordList.length;
    countGroups.textContent = groupsList.length;
    countDetections.textContent = detectionsList.length;

    // Keyword chips
    keywordsChips.innerHTML = '';
    keywordList.forEach((keyword) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = keyword.trim() || '\u00A0';
      keywordsChips.appendChild(chip);
    });
  }
);

// Open options page
openSettingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
