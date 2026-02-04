chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "capture") {
    chrome.tabs.captureVisibleTab(
      null,
      { format: "png" },
      (image) => {
        downloadImage(image);
      }
    );
  }
});

function downloadImage(dataUrl) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `screenshot-${Date.now()}.png`;
  a.click();
}