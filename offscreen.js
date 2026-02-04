/**
 * Offscreen document — canvas and image stitching only.
 * Runs in a hidden document so we can use canvas (service workers cannot).
 * Listens for STITCH, draws tiles, sends DOWNLOAD; sends OFFSCREEN_READY on load.
 */

(function () {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Signal to background that we're ready to receive STITCH (avoids race on first use).
  chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" }).catch(() => {});

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "STITCH") return;

    const { screenshots, width, height, viewportHeight } = msg;
    if (!Array.isArray(screenshots) || screenshots.length === 0 ||
        !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(viewportHeight)) {
      sendResponse?.({ ok: false, error: "Invalid STITCH message" });
      return;
    }

    (async () => {
      try {
        canvas.width = width;
        canvas.height = height;

        let y = 0;
        for (const src of screenshots) {
          const img = new Image();
          img.src = src;
          await img.decode();
          // Draw one viewport: scale so this tile (which may be high-DPR) maps to viewportHeight px.
          // Avoids overlap/gaps on high-DPI and zoom; final image is in CSS pixel dimensions.
          ctx.drawImage(img, 0, 0, img.width, img.height, 0, y, width, viewportHeight);
          y += viewportHeight;
          img.src = ""; // Release reference to allow GC of decoded image
        }

        const dataUrl = canvas.toDataURL("image/png");
        chrome.runtime.sendMessage({ type: "DOWNLOAD", image: dataUrl });
        sendResponse?.({ ok: true });
      } catch (err) {
        sendResponse?.({ ok: false, error: err?.message ?? String(err) });
      }
    })();
    return true; // Keep channel open for async sendResponse
  });
})();
