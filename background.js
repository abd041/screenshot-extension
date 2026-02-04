chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === "capture") {
    chrome.tabs.captureVisibleTab(
      null,
      { format: "png" },
      (image) => {
 chrome.downloads.download({
          url: image,
          filename: `screenshot-${Date.now()}.png`,
          saveAs: true
        });      }
    );
  }
});
