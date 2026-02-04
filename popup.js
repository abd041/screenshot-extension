/**
 * Popup — UI only. Sends messages to background; no capture, no DOM of the page.
 */

(function () {
  const visibleBtn = document.getElementById("visible");
  const fullBtn = document.getElementById("full");
  const statusEl = document.getElementById("status");

  function showStatus(text, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.style.color = isError ? "#c00" : "#333";
  }

  function send(type) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.ok === false && response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    });
  }

  visibleBtn.addEventListener("click", async () => {
    showStatus("");
    try {
      await send("VISIBLE");
      showStatus("Download started.");
    } catch (e) {
      showStatus(e?.message ?? "Failed", true);
    }
  });

  fullBtn.addEventListener("click", async () => {
    showStatus("");
    try {
      await send("FULL");
      showStatus("Scrolling & capturing…");
    } catch (e) {
      showStatus(e?.message ?? "Failed", true);
    }
  });
})();
