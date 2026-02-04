/**
 * Background service worker — MV3.
 * Responsibilities: tabs, captureVisibleTab, downloads, messaging, offscreen lifecycle.
 * NO DOM access (no document, window, or canvas here).
 */

// --- Limits (Chrome Web Store & memory safety) ---
const MAX_CAPTURE_COUNT = 200;
const MAX_PAGE_HEIGHT_PX = 100000;
const OFFSCREEN_READY_TIMEOUT_MS = 10000;

// Offscreen document ready: we wait for this before sending STITCH so the listener is registered.
let offscreenReadyResolve = null;
let offscreenReadyPromise = new Promise((resolve) => {
  offscreenReadyResolve = resolve;
});
function resetOffscreenReady() {
  offscreenReadyPromise = new Promise((resolve) => {
    offscreenReadyResolve = resolve;
  });
}
// Accumulates tiles during full-page capture (content sends CAPTURE_NOW per scroll position).
let captureTiles = [];

/**
 * Create offscreen document for canvas stitching. Uses DOM_SCRAPING reason
 * with justification; canvas work runs in the offscreen document, not here.
 */
async function ensureOffscreenDocument() {
  const hasDoc = await chrome.offscreen.hasDocument();
  if (hasDoc) return;
  resetOffscreenReady();
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["DOM_SCRAPING"],
    justification: "Stitching full-page screenshot tiles on a canvas; canvas requires a document context.",
  });
  // Offscreen will send OFFSCREEN_READY when its script has registered the STITCH listener.
  await Promise.race([
    offscreenReadyPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Offscreen ready timeout")), OFFSCREEN_READY_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Single message router. All extension messaging flows through here for clarity and error handling.
 */
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== "string") {
      sendResponse?.({ ok: false, error: "Invalid message" });
      return true;
    }

    const handle = async () => {
      try {
        switch (msg.type) {
          case "VISIBLE":
            return await handleVisible();
          case "FULL":
            return await handleFull();
          case "READY":
            return await handleReady(msg);
          case "CAPTURE_NOW":
            return await handleCaptureNow(sender);
          case "CAPTURE_DONE":
            return await handleCaptureDone(msg, sender);
          case "OFFSCREEN_READY":
            if (offscreenReadyResolve) {
              offscreenReadyResolve();
              offscreenReadyResolve = null;
            }
            return { ok: true };
          case "DOWNLOAD":
            return await handleDownload(msg);
          case "ERROR":
            if (typeof msg.error === "string") {
              console.warn("[Screenshot extension]", msg.error);
            }
            return { ok: true };
          default:
            return { ok: false, error: "Unknown message type" };
        }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    };

    handle().then(sendResponse).catch(() => sendResponse?.({ ok: false, error: "Handler failed" }));
    return true; // Keep channel open for async sendResponse
  }
);

/** Capture visible viewport and download. Requires user gesture (popup click) → activeTab. */
async function handleVisible() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab?.windowId) {
    throw new Error("No active tab");
  }
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (!dataUrl) throw new Error("Capture failed");
  await chrome.downloads.download({
    url: dataUrl,
    filename: `screenshot-${Date.now()}.png`,
    saveAs: true,
  });
  return { ok: true };
}

/** Inject content script to measure page and scroll; it will send POSITIONS back. */
async function handleFull() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    throw new Error("Cannot capture this page");
  }
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
  return { ok: true };
}

/**
 * Capture one tile at current scroll position. Content script scrolls first, then sends CAPTURE_NOW.
 * We use sender.tab.windowId so we capture the correct window.
 */
async function handleCaptureNow(sender) {
  const tab = sender?.tab;
  if (!tab?.windowId) throw new Error("No tab context");
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  if (!dataUrl) throw new Error("Capture failed");
  captureTiles.push(dataUrl);
  return { ok: true };
}

/** Stitch collected tiles and trigger download. Called after content sends CAPTURE_DONE. */
async function handleCaptureDone(msg, sender) {
  const tab = sender?.tab;
  if (!tab?.windowId) throw new Error("No tab context");
  const { width, height, viewportHeight } = msg;
  if (!captureTiles.length) throw new Error("No tiles captured");
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(viewportHeight)) {
    throw new Error("Missing or invalid width/height/viewportHeight");
  }
  if (height > MAX_PAGE_HEIGHT_PX) {
    throw new Error(`Page height exceeds limit (max ${MAX_PAGE_HEIGHT_PX}px)`);
  }

  const tiles = captureTiles.splice(0, captureTiles.length);
  await ensureOffscreenDocument();
  chrome.runtime.sendMessage({
    type: "STITCH",
    screenshots: tiles,
    width,
    height,
    viewportHeight,
  });
  return { ok: true };
}

/** Validate full-page request and clear previous tiles. Content sends this before scrolling. */
async function handleReady(msg) {
  const { positions, width, height, viewportHeight } = msg;
  if (!Array.isArray(positions)) throw new Error("Invalid READY message");
  if (positions.length > MAX_CAPTURE_COUNT) {
    throw new Error(`Page too long (max ${MAX_CAPTURE_COUNT} tiles)`);
  }
  if (!Number.isFinite(height) || height > MAX_PAGE_HEIGHT_PX) {
    throw new Error(`Page height exceeds limit (max ${MAX_PAGE_HEIGHT_PX}px)`);
  }
  captureTiles = [];
  return { ok: true };
}

/** Save stitched image (called by offscreen document). */
async function handleDownload(msg) {
  if (!msg.image || typeof msg.image !== "string") {
    throw new Error("Invalid DOWNLOAD message");
  }
  await chrome.downloads.download({
    url: msg.image,
    filename: `fullpage-${Date.now()}.png`,
    saveAs: true,
  });
  return { ok: true };
}
