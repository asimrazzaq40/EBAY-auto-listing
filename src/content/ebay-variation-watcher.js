(() => {
  const WATCHER = {
    activeRun: null
  };

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isVisible(element) {
    if (!element || !(element instanceof Element)) {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getAccessibleDocuments() {
    const documents = [document];
    const iframes = [...document.querySelectorAll("iframe")];
    for (const iframe of iframes) {
      try {
        if (iframe.contentDocument?.documentElement) {
          documents.push(iframe.contentDocument);
        }
      } catch (_error) {
        // Cross-origin frames are expected on eBay.
      }
    }
    return documents;
  }

  function collectRoots(doc) {
    const roots = [doc];
    const walker = doc.createTreeWalker(doc.documentElement || doc.body, NodeFilter.SHOW_ELEMENT);
    let current = walker.currentNode;
    while (current) {
      if (current.shadowRoot) {
        roots.push(current.shadowRoot);
      }
      current = walker.nextNode();
    }
    return roots;
  }

  function queryAllDeep(selector, includeHidden = false) {
    const results = [];
    for (const doc of getAccessibleDocuments()) {
      for (const root of collectRoots(doc)) {
        const matches = [...root.querySelectorAll(selector)];
        for (const match of matches) {
          if (includeHidden || isVisible(match)) {
            results.push(match);
          }
        }
      }
    }
    return results;
  }

  function getElementText(element) {
    const textParts = [
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("name"),
      element.getAttribute?.("id")
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean);
    return textParts.join(" | ");
  }

  function findByText(selector, patterns, includeHidden = false) {
    const nodes = queryAllDeep(selector, includeHidden);
    return nodes.find((node) => {
      const haystack = getElementText(node).toLowerCase();
      return patterns.some((pattern) => haystack.includes(pattern));
    });
  }

  function clickElement(element) {
    if (!element) {
      return false;
    }
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.click();
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return true;
  }

  function setFieldValue(field, value) {
    if (!field) {
      return false;
    }
    const textValue = String(value ?? "");
    if (field.isContentEditable) {
      field.focus();
      field.textContent = textValue;
    } else {
      field.focus();
      field.value = textValue;
    }
    ["input", "change", "blur"].forEach((eventName) => {
      field.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
    return true;
  }

  function detectEditorRoot() {
    const rootCandidates = queryAllDeep(
      '[role="dialog"], [aria-modal="true"], [class*="drawer"], [class*="modal"], [class*="layer"], section, div'
    );
    const buttonPatterns = [
      "add option",
      "add value",
      "generate variations",
      "create variations",
      "edit variations",
      "done",
      "save"
    ];

    for (const candidate of rootCandidates) {
      const text = normalizeText(candidate.textContent || "").toLowerCase();
      if (!text.includes("variation")) {
        continue;
      }
      const buttons = [...candidate.querySelectorAll("button, [role='button']")].filter((button) => {
        const buttonText = getElementText(button).toLowerCase();
        return buttonPatterns.some((pattern) => buttonText.includes(pattern));
      });
      const inputs = [...candidate.querySelectorAll("input, textarea, [contenteditable='true']")];
      if (buttons.length || inputs.length >= 3) {
        return candidate;
      }
    }
    return null;
  }

  function getVariationStatus() {
    const section =
      queryAllDeep(".summary__variations").find(Boolean) ||
      findByText("h2, h3, section, div", ["variations"], true) ||
      queryAllDeep('[*_track*="VARIATIONS"]', true)[0] ||
      null;

    const formatSelect = queryAllDeep('select[name="format"]', true)[0] || null;
    const visibleFormatButton = findByText("button, [role='button']", ["auction", "buy it now", "fixed price"], true);

    return {
      sectionFound: Boolean(section),
      section,
      formatExists: Boolean(formatSelect),
      formatValue: formatSelect?.value || "",
      visibleLabel: normalizeText(visibleFormatButton?.textContent || "")
    };
  }

  async function waitForEditor(timeoutMs, logger, run) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (run.aborted) {
        throw new Error("Variation build stopped.");
      }
      const root = detectEditorRoot();
      if (root) {
        return root;
      }
      await sleep(250);
    }
    logger("Editor opened: no");
    return null;
  }

  function summarizeEditor(editorRoot) {
    if (!editorRoot) {
      return {
        dialogs: 0,
        iframes: document.querySelectorAll("iframe").length,
        inputs: 0,
        buttons: []
      };
    }
    return {
      dialogs: queryAllDeep('[role="dialog"], [aria-modal="true"]', true).length,
      iframes: document.querySelectorAll("iframe").length,
      inputs: editorRoot.querySelectorAll("input, textarea, [contenteditable='true']").length,
      buttons: [...editorRoot.querySelectorAll("button, [role='button']")]
        .map((button) => normalizeText(button.textContent || button.getAttribute("aria-label") || ""))
        .filter(Boolean)
        .slice(0, 30)
    };
  }

  function findFieldCluster(editorRoot, predicate) {
    const fields = [...editorRoot.querySelectorAll("input, textarea, [contenteditable='true']")].filter((field) => {
      const descriptor = getElementText(field).toLowerCase();
      return predicate(descriptor, field);
    });
    return fields;
  }

  async function ensureOptionInputCount(editorRoot, targetCount, logger, run) {
    const addOptionPatterns = ["add option", "add another option", "add variation"];
    let nameFields = findFieldCluster(
      editorRoot,
      (descriptor, field) =>
        /name/.test(descriptor) &&
        !/price|quantity|sku|label|custom label|description|image/.test(descriptor) &&
        (field.tagName === "INPUT" || field.tagName === "TEXTAREA")
    );

    while (nameFields.length < targetCount) {
      if (run.aborted) {
        throw new Error("Variation build stopped.");
      }
      const addButton = [...editorRoot.querySelectorAll("button, [role='button']")].find((button) =>
        addOptionPatterns.some((pattern) => getElementText(button).toLowerCase().includes(pattern))
      );
      if (!addButton) {
        break;
      }
      clickElement(addButton);
      await sleep(250);
      nameFields = findFieldCluster(
        editorRoot,
        (descriptor, field) =>
          /name/.test(descriptor) &&
          !/price|quantity|sku|label|custom label|description|image/.test(descriptor) &&
          (field.tagName === "INPUT" || field.tagName === "TEXTAREA")
      );
    }

    logger(`Option name inputs found: ${nameFields.length}`);
    return nameFields;
  }

  async function fillDimensions(editorRoot, draft, logger, run) {
    const dimensions = (draft.variations?.dimensions || []).filter(
      (dimension) => dimension.enabled !== false && dimension.name && (dimension.values || []).length
    );
    if (!dimensions.length) {
      logger("No enabled variation dimensions to build.");
      return false;
    }

    const nameFields = await ensureOptionInputCount(editorRoot, dimensions.length, logger, run);
    const valueFields = findFieldCluster(
      editorRoot,
      (descriptor, field) =>
        /value|values|option value|add value/.test(descriptor) &&
        !/price|quantity|sku|label|custom label|description|image/.test(descriptor) &&
        (field.tagName === "INPUT" || field.tagName === "TEXTAREA" || field.isContentEditable)
    );

    logger(`Option value inputs found: ${valueFields.length}`);

    dimensions.forEach((dimension, index) => {
      const nameField = nameFields[index];
      if (nameField) {
        setFieldValue(nameField, dimension.name);
      }

      const valueField = valueFields[index];
      if (valueField) {
        setFieldValue(valueField, dimension.values.join(", "));
      } else {
        const nearbyButtons = [...editorRoot.querySelectorAll("button, [role='button']")].filter((button) =>
          /add value/.test(getElementText(button).toLowerCase())
        );
        if (nearbyButtons[index]) {
          clickElement(nearbyButtons[index]);
        }
      }
    });

    const generateButton = [...editorRoot.querySelectorAll("button, [role='button']")].find((button) =>
      /generate variations|create variations|continue/.test(getElementText(button).toLowerCase())
    );
    if (generateButton) {
      clickElement(generateButton);
      logger("Generate variations button clicked.");
      await sleep(800);
    } else {
      logger("Generate variations button not found.");
    }

    return true;
  }

  function buildTsv(draft) {
    const selectedRows = (draft.variations?.rows || []).filter((row) => row.selected !== false);
    const dimensions = (draft.variations?.dimensions || []).filter((dimension) => dimension.enabled !== false);
    const headers = ["SKU", ...dimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image"];
    const lines = [headers.join("\t")];
    for (const row of selectedRows) {
      lines.push(
        [
          row.sku || "",
          ...dimensions.map((dimension) => row.optionValues?.[dimension.name] || ""),
          row.price ?? "",
          row.quantity ?? "",
          row.imageUrl || ""
        ].join("\t")
      );
    }
    return lines.join("\n");
  }

  function matchRowToDraft(tableRow, draftRows) {
    const rowText = normalizeText(tableRow.textContent || "").toLowerCase();
    return (
      draftRows.find((row) => {
        const values = Object.values(row.optionValues || {}).filter(Boolean);
        return values.length && values.every((value) => rowText.includes(String(value).toLowerCase()));
      }) || null
    );
  }

  async function tryPasteMode(editorRoot, draft, logger) {
    const tsv = buildTsv(draft);
    try {
      await navigator.clipboard.writeText(tsv);
      logger("Variation TSV copied to clipboard.");
    } catch (_error) {
      logger("Clipboard write failed.");
    }

    const firstEditable = editorRoot.querySelector(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [contenteditable="true"]'
    );
    if (!firstEditable) {
      logger("Paste target cell not found.");
      return false;
    }

    firstEditable.focus();
    const transfer = new DataTransfer();
    transfer.setData("text/plain", tsv);
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", { value: transfer });
    firstEditable.dispatchEvent(pasteEvent);
    logger("Paste event dispatched to variation editor.");
    return true;
  }

  async function fillVariationTable(editorRoot, draft, logger) {
    const selectedRows = (draft.variations?.rows || []).filter((row) => row.selected !== false);
    if (!selectedRows.length) {
      logger("No selected variation rows to fill.");
      return false;
    }

    const tableRows = [
      ...editorRoot.querySelectorAll("tr, [role='row'], [class*='row'], [data-testid*='row']")
    ].filter((row) => row.querySelector("input, textarea, [contenteditable='true']"));

    logger(`Variation table rows found: ${tableRows.length}`);
    if (!tableRows.length) {
      return tryPasteMode(editorRoot, draft, logger);
    }

    let filled = 0;
    for (const rowElement of tableRows) {
      const draftRow = matchRowToDraft(rowElement, selectedRows);
      if (!draftRow) {
        continue;
      }

      const fields = [...rowElement.querySelectorAll("input, textarea, [contenteditable='true']")];
      const skuField = fields.find((field) => /sku|custom label/i.test(getElementText(field)));
      const priceField = fields.find((field) => /price/i.test(getElementText(field)));
      const quantityField = fields.find((field) => /qty|quantity/i.test(getElementText(field)));
      const imageField = fields.find((field) => /image/i.test(getElementText(field)));

      if (skuField) {
        setFieldValue(skuField, draftRow.sku || "");
      }
      if (priceField) {
        setFieldValue(priceField, draftRow.price ?? "");
      }
      if (quantityField) {
        setFieldValue(quantityField, draftRow.quantity ?? "");
      }
      if (imageField && draftRow.imageUrl) {
        setFieldValue(imageField, draftRow.imageUrl);
      }
      filled += 1;
    }

    if (!filled) {
      logger("Direct row matching failed, trying paste mode.");
      return tryPasteMode(editorRoot, draft, logger);
    }

    logger(`Variation rows filled: ${filled}`);
    return true;
  }

  function saveEditor(editorRoot, logger) {
    const saveButton = [...editorRoot.querySelectorAll("button, [role='button']")].find((button) =>
      /done|save|apply|confirm/.test(getElementText(button).toLowerCase())
    );
    if (!saveButton) {
      logger("Done/Save button not found.");
      return false;
    }
    clickElement(saveButton);
    logger("Done/Save button clicked.");
    return true;
  }

  async function buildVariations(draft, logger = console.log) {
    if (WATCHER.activeRun) {
      WATCHER.activeRun.aborted = true;
    }

    const run = { aborted: false, startedAt: Date.now() };
    WATCHER.activeRun = run;

    try {
      const status = getVariationStatus();
      logger(`Variation section found: ${status.sectionFound ? "yes" : "no"}`);
      logger(`Buy It Now active: ${status.formatValue === "FixedPrice" ? "yes" : "no"}`);
      logger(`Format select value: ${status.formatValue || "missing"}`);
      logger(`Visible format label: ${status.visibleLabel || "missing"}`);

      if (!status.sectionFound) {
        throw new Error("Variation section was not found on the page.");
      }

      const openButton =
        findByText("button, [role='button'], a", ["edit variations", "create variations", "add variations"], true) ||
        status.section;
      if (!clickElement(openButton)) {
        throw new Error("Unable to open the variation editor.");
      }
      logger("Variation editor open attempt made.");

      const editorRoot = await waitForEditor(20000, logger, run);
      if (!editorRoot) {
        throw new Error("Variation editor did not open within 20 seconds.");
      }

      const summary = summarizeEditor(editorRoot);
      logger(`Editor opened: yes`);
      logger(`Iframes found count: ${summary.iframes}`);
      logger(`Dialogs found count: ${summary.dialogs}`);
      logger(`Inputs inside editor count: ${summary.inputs}`);
      logger(`Buttons inside editor: ${summary.buttons.join(", ") || "none"}`);

      await fillDimensions(editorRoot, draft, logger, run);
      await sleep(1200);
      await fillVariationTable(editorRoot, draft, logger);
      saveEditor(editorRoot, logger);
      logger("Variation build attempt completed.");
      return { ok: true };
    } catch (error) {
      logger(error?.message || String(error));
      return { ok: false, error: error?.message || String(error) };
    } finally {
      if (WATCHER.activeRun === run) {
        WATCHER.activeRun = null;
      }
    }
  }

  function stopBuild(logger = console.log) {
    if (WATCHER.activeRun) {
      WATCHER.activeRun.aborted = true;
      logger("Variation build stopped.");
      return true;
    }
    logger("No active variation build.");
    return false;
  }

  window.__AM_EBAY_VARIATION_WATCHER__ = {
    buildVariations,
    stopBuild,
    getVariationStatus,
    detectEditorRoot
  };
})();
