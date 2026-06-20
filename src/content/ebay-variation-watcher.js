(function initEbayVariationWatcher() {
  if (window.__amEbayVariationWatcherLoaded) return;
  window.__amEbayVariationWatcherLoaded = true;

  let observer = null;
  let timeoutId = null;
  let running = false;
  let filling = false;

  window.addEventListener("am-ebay-start-variation-watcher", startWatcher);
  window.addEventListener("am-ebay-stop-variation-watcher", stopWatcher);

  window.__amEbayVariationWatcher = {
    start: startWatcher,
    stop: stopWatcher,
    isRunning: () => running
  };

  function startWatcher() {
    if (running) stopWatcher();
    running = true;
    filling = false;
    log("Variation Watcher Mode started. Open Create/Edit variations if it is not already open.");

    observer = new MutationObserver(() => {
      if (!running || filling) return;
      inspectAndFill();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "aria-hidden", "open"]
    });

    timeoutId = setTimeout(() => {
      if (!running) return;
      log("Variation Watcher Mode timed out after 20 seconds.");
      logDiagnostics();
      stopWatcher();
    }, 20000);

    inspectAndFill();
  }

  function stopWatcher() {
    running = false;
    filling = false;
    if (observer) observer.disconnect();
    observer = null;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    log("Variation Watcher Mode stopped.");
  }

  async function inspectAndFill() {
    const assistant = window.__amEbayAssistant;
    if (!assistant || typeof assistant.detectVariationEditor !== "function") {
      log("Variation watcher waiting for assistant API.");
      return;
    }

    const editor = assistant.detectVariationEditor();
    if (!editor) return;

    filling = true;
    log("Variation watcher detected an editor.");
    logDiagnostics(editor);
    try {
      const filled = await assistant.fillCurrentVariationEditor();
      log(filled ? "Variation watcher fill attempt completed." : "Variation watcher could not complete fill.");
    } catch (error) {
      log(`Variation watcher error: ${error.message || error}`);
    } finally {
      stopWatcher();
    }
  }

  function logDiagnostics(editor) {
    const dialogs = document.querySelectorAll("[role='dialog'], [aria-modal='true']").length;
    const iframes = document.querySelectorAll("iframe").length;
    const fields = editor?.root?.querySelectorAll?.("input, textarea, select, [contenteditable='true']").length || 0;
    const buttons = Array.from(editor?.root?.querySelectorAll?.("button, [role='button'], a") || [])
      .map((button) => cleanText(button.textContent || button.getAttribute("aria-label") || button.value || ""))
      .filter((label) => /add|continue|done|save|create|edit|option|value|generate|variation/i.test(label))
      .slice(0, 80);

    log(JSON.stringify({
      variationWatcher: true,
      editorOpened: Boolean(editor),
      editorType: editor?.type || "",
      dialogsFoundCount: dialogs,
      iframesFoundCount: iframes,
      inputsInsideEditorCount: fields,
      buttonsInsideEditor: buttons
    }, null, 2));
  }

  function log(message) {
    const assistant = window.__amEbayAssistant;
    if (assistant && typeof assistant.log === "function") {
      assistant.log(message);
    } else {
      console.info("[AM eBay Variation Watcher]", message);
    }
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
})();
