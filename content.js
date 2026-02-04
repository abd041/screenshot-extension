/**
 * Content script — runs in the page context (injected by background on full-page capture).
 * Responsibilities: measure page, scroll to each tile position, request capture at each step.
 * Does NOT do capture or canvas; only DOM/scroll and messaging.
 */

(function runFullPageCapture() {
  const SCROLL_SETTLE_MS = 300;
  const MAX_CAPTURE_COUNT = 200;
  const MAX_PAGE_HEIGHT_PX = 100000;
  const FULL_PAGE_TIMEOUT_MS = 120000;

  function sendToBackground(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, ...payload }, (response) => {
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

  async function main() {
    const deadline = Date.now() + FULL_PAGE_TIMEOUT_MS;
    const checkTimeout = () => {
      if (Date.now() > deadline) throw new Error("Full-page capture timed out");
    };
    // Use documentElement for full scroll dimensions; body can be smaller on some pages.
    const totalHeight = Math.max(
      document.body?.scrollHeight ?? 0,
      document.documentElement.scrollHeight,
      document.body?.offsetHeight ?? 0,
      document.documentElement.offsetHeight
    );
    const viewportHeight = window.innerHeight;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth ?? 0,
      document.body?.scrollWidth ?? 0
    );

    if (totalHeight <= 0 || viewportHeight <= 0) {
      throw new Error("Invalid page dimensions");
    }

    // Build scroll positions: 0, viewportHeight, 2*viewportHeight, ... (no overlap).
    const positions = [];
    let y = 0;
    while (y < totalHeight && positions.length < MAX_CAPTURE_COUNT) {
      positions.push(y);
      y += viewportHeight;
    }

    if (totalHeight > MAX_PAGE_HEIGHT_PX) {
      throw new Error(`Page too tall (max ${MAX_PAGE_HEIGHT_PX}px)`);
    }

    checkTimeout();
    // Tell background we're ready; it validates and clears previous tiles.
    await sendToBackground("READY", {
      positions,
      width: scrollWidth,
      height: totalHeight,
      viewportHeight,
    });

    // Capture at each position: scroll → wait for layout/paint → request capture.
    for (let i = 0; i < positions.length; i++) {
      checkTimeout();
      window.scrollTo(0, positions[i]);
      await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));
      await sendToBackground("CAPTURE_NOW", {});
    }

    checkTimeout();
    await sendToBackground("CAPTURE_DONE", {
      width: scrollWidth,
      height: totalHeight,
      viewportHeight,
    });
  }

  main().catch((err) => {
    chrome.runtime.sendMessage({
      type: "ERROR",
      error: err?.message ?? String(err),
    });
  });
})();
