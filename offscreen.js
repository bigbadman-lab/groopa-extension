// Groopa offscreen document — used only for playing notification sound (MV3 service workers cannot play audio)
(function () {
  const SOUND_URL = chrome.runtime.getURL('assets/sounds/Ping_WAV.wav');
  let audio = null;

  function playSound() {
    try {
      if (!audio) {
        audio = new Audio(SOUND_URL);
      }
      audio.currentTime = 0;
      audio.volume = 0.6;
      audio.play().catch(function () {});
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (message && message.type === 'PLAY_LEAD_SOUND') {
      playSound();
      sendResponse({ ok: true });
    }
    return true;
  });
})();
