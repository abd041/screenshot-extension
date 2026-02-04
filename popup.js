document.getElementById("captureBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "capture" });
});