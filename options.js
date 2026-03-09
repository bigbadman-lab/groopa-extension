// Groopa options page — save/load settings with chrome.storage.sync

const paidCheckbox = document.getElementById('paid-user');
const keywordsTextarea = document.getElementById('keywords');
const soundCheckbox = document.getElementById('sound-enabled');
const saveBtn = document.getElementById('save-btn');
const saveMessage = document.getElementById('save-message');
const loadDemoBtn = document.getElementById('load-demo-btn');
const clearDemoBtn = document.getElementById('clear-demo-btn');
const demoMessage = document.getElementById('demo-message');

// Demo data for UI testing
const DEMO_TRACKED_GROUPS = [
  { id: '1', name: 'Demo Group A', url: 'https://www.facebook.com/groups/demoa', selected: true },
  { id: '2', name: 'Demo Group B', url: 'https://www.facebook.com/groups/demob', selected: true },
  { id: '3', name: 'Demo Group C', url: 'https://www.facebook.com/groups/democ', selected: false },
];

const DEMO_DETECTIONS = [
  { id: 'd1', groupName: 'Demo Group A', author: 'Jane Doe', text: 'Has anyone seen the latest alert?', keywordMatched: 'alert', createdAt: '2024-01-15T10:30:00Z' },
  { id: 'd2', groupName: 'Demo Group B', author: 'John Smith', text: 'Urgent: please check the pinned post.', keywordMatched: 'urgent', createdAt: '2024-01-15T09:00:00Z' },
  { id: 'd3', groupName: 'Demo Group A', author: 'Alex Lee', text: 'Reminder: meeting tomorrow at 9am.', keywordMatched: 'reminder', createdAt: '2024-01-14T16:00:00Z' },
];

// Load saved values when page opens
chrome.storage.sync.get(['isPaidUser', 'keywords', 'soundEnabled'], (result) => {
  paidCheckbox.checked = result.isPaidUser === true;
  const keywords = result.keywords || [];
  keywordsTextarea.value = Array.isArray(keywords) ? keywords.join('\n') : '';
  soundCheckbox.checked = result.soundEnabled !== false;
});

// Save when user clicks Save Settings
saveBtn.addEventListener('click', () => {
  const isPaidUser = paidCheckbox.checked;
  const keywordsText = keywordsTextarea.value || '';
  const keywords = keywordsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const soundEnabled = soundCheckbox.checked;

  chrome.storage.sync.set({ isPaidUser, keywords, soundEnabled }, () => {
    saveMessage.style.display = 'block';
    setTimeout(() => {
      saveMessage.style.display = 'none';
    }, 2000);
  });
});

function showDemoMessage(text) {
  demoMessage.textContent = text;
  demoMessage.style.display = 'block';
  setTimeout(() => {
    demoMessage.style.display = 'none';
  }, 2500);
}

loadDemoBtn.addEventListener('click', () => {
  chrome.storage.sync.set(
    { trackedGroups: DEMO_TRACKED_GROUPS, detections: DEMO_DETECTIONS },
    () => showDemoMessage('Demo data loaded. Open the popup to see it.')
  );
});

clearDemoBtn.addEventListener('click', () => {
  chrome.storage.sync.set({ trackedGroups: [], detections: [] }, () =>
    showDemoMessage('Demo data cleared.')
  );
});
