(() => {
  if (window.top !== window || window.__amEbayVariationWatcherLoaded) {
    return;
  }
  window.__amEbayVariationWatcherLoaded = true;

  let stopRequested = false;
  let activeObserver = null;

  window.AmEbayVariationWatcher = {
    buildVariations,
    stop
  };

  async function buildVariations(context) {
    const assistant = window.AmEbayAssistant || {};
    const log = context.log || assistant.log || console.log;
    const product = context.product || {};
    const dimensions = variationDimensions(product);
    const variations = (product.variations || []).filter((variation) => variation.selected !== false);

    stopRequested = false;
    if (!variations.length || !dimensions.length) {
      log("No selected variations are available to build.");
      return;
    }

    log("Build Variations started.");
    context.setBuyItNow();
    await waitFor(900);

    const status = context.debugVariationStatus ? context.debugVariationStatus() : {};
    log(`Variation section found: ${status.variationSectionFound ? "yes" : "no"}`);
    log(`Buy It Now active: ${status.buyItNowActive ? "yes" : "no"}; format value: ${status.formatSelectValue || "unknown"}`);

    const tsv = variantsToTsv(product);
    await copyToClipboard(tsv, log);

    const editor = findVariationEditor() || await openVariationEditor(log);
    if (!editor || stopRequested) {
      log("Variation editor not detected within 20 seconds. TSV is copied; manually open Create/Edit variations and click Build Variations again.");
      logEditorDiagnostics(log);
      return;
    }

    log(`Editor opened: yes (${editor.contextName})`);
    logEditorDiagnostics(log, editor.container);

    const dimensionsFilled = await fillDimensions(editor, dimensions, variations, log);
    log(`Dimension fill attempt: ${dimensionsFilled ? "fields updated" : "no matching fields found"}.`);

    await clickGenerateIfAvailable(editor, log);
    await waitFor(700);

    const tableFilled = fillVariationTable(editor, product, log);
    if (!tableFilled) {
      const pasted = await pasteTsv(editor, tsv, log);
      log(`TSV paste attempt: ${pasted ? "sent" : "no paste target found"}.`);
    }

    await waitFor(1000);
    const verified = verifyVariationRows(editor, variations, dimensions);
    log(`Variation table verification: ${verified ? "values detected" : "not enough values detected"}.`);

    if (verified) {
      clickSaveDone(editor, log);
    } else {
      log("Leaving editor open for review. Use the copied TSV if eBay requires manual paste.");
    }
  }

  function stop() {
    stopRequested = true;
    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }
  }

  async function openVariationEditor(log) {
    const section = findVariationSection();
    if (section) {
      log("Variation section found: yes.");
      const editButton = findButtonByText(["edit variations", "create variations", "add variations", "add variation", "variations"], section);
      if (editButton) {
        editButton.click();
        log(`Clicked variation control: ${labelOf(editButton) || "button"}.`);
      } else {
        section.click();
        log("Clicked variation section/header.");
      }
    } else {
      log("Variation section found: no. Searching page-level variation buttons.");
      const pageButton = findButtonByText(["edit variations", "create variations", "add variations", "add variation"]);
      if (pageButton) {
        pageButton.click();
        log(`Clicked page-level variation button: ${labelOf(pageButton)}.`);
      }
    }

    return waitForEditor(20000, log);
  }

  function waitForEditor(timeoutMs, log) {
    return new Promise((resolve) => {
      const existing = findVariationEditor();
      if (existing) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        if (activeObserver) {
          activeObserver.disconnect();
          activeObserver = null;
        }
        resolve(findVariationEditor());
      }, timeoutMs);

      activeObserver = new MutationObserver(() => {
        if (stopRequested) {
          clearTimeout(timer);
          activeObserver.disconnect();
          activeObserver = null;
          resolve(null);
          return;
        }
        const editor = findVariationEditor();
        if (editor) {
          clearTimeout(timer);
          activeObserver.disconnect();
          activeObserver = null;
          resolve(editor);
        }
      });

      activeObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true
      });

      log("Waiting up to 20 seconds for variation editor/drawer/modal/iframe.");
    });
  }

  async function fillDimensions(editor, dimensions, variations, log) {
    let touched = false;
    const root = editor.container;
    const valuesByDimension = new Map(dimensions.map((dimension) => [
      dimension,
      uniqueStrings(variations.map((variation) => (variation.options || {})[dimension]).filter(Boolean))
    ]));

    for (const dimension of dimensions) {
      if (stopRequested) {
        break;
      }

      const values = valuesByDimension.get(dimension) || [];
      if (!values.length) {
        continue;
      }

      const hasDimensionText = textOf(root).toLowerCase().includes(dimension.toLowerCase());
      if (!hasDimensionText) {
        const addButton = findButtonByText(["add option", "add variation", "add detail", "add name", "custom"], root);
        if (addButton) {
          addButton.click();
          touched = true;
          await waitFor(350);
          log(`Clicked Add option for ${dimension}.`);
        }
      }

      const nameInput = findLikelyEmptyInput(root, ["variation name", "option name", "name", "attribute"]);
      if (nameInput && !hasDimensionText) {
        setNativeValue(nameInput, dimension);
        touched = true;
      }

      const valueField = findLikelyEmptyInput(root, ["option value", "values", "value", dimension]);
      if (valueField) {
        const joined = values.join(", ");
        setNativeValue(valueField, joined);
        touched = true;
        log(`Added ${values.length} values for ${dimension}.`);
        continue;
      }

      for (const value of values) {
        const addValueButton = findButtonByText(["add value", "add option value", "add"], root);
        if (addValueButton) {
          addValueButton.click();
          await waitFor(250);
        }
        const input = findLikelyEmptyInput(root, ["value", "option"]);
        if (input) {
          setNativeValue(input, value);
          touched = true;
        }
      }
    }

    return touched;
  }

  async function clickGenerateIfAvailable(editor, log) {
    const button = findButtonByText([
      "generate variations",
      "create variations",
      "continue",
      "next",
      "add variations"
    ], editor.container);
    if (button) {
      button.click();
      log(`Clicked ${labelOf(button)} after adding dimensions.`);
    }
  }

  function fillVariationTable(editor, product, log) {
    const dimensions = variationDimensions(product);
    const variations = (product.variations || []).filter((variation) => variation.selected !== false);
    const tables = allElementsDeep(editor.container)
      .filter((node) => node.tagName === "TABLE" || /grid|table/i.test(node.getAttribute("role") || ""))
      .filter((node) => /sku|price|quantity|qty|variation|option/i.test(textOf(node)));

    for (const table of tables) {
      const rows = [...table.querySelectorAll("tbody tr, [role='row']")]
        .filter((row) => row.querySelector("input, textarea, select, [contenteditable='true']"));
      if (!rows.length) {
        continue;
      }

      const headers = inferHeaders(table, dimensions);
      let filledCells = 0;
      variations.forEach((variation, index) => {
        const row = rows[index];
        if (!row) {
          return;
        }
        const fields = [...row.querySelectorAll("input, textarea, select, [contenteditable='true']")].filter(isVisible);
        if (!fields.length) {
          return;
        }

        const data = rowData(variation, product, dimensions);
        fields.forEach((field, fieldIndex) => {
          const key = headers[fieldIndex] || guessFieldKey(field, fieldIndex, dimensions);
          const value = data[key];
          if (value !== undefined && value !== "") {
            setFieldValue(field, value);
            filledCells += 1;
          }
        });
      });

      if (filledCells > 0) {
        log(`Filled ${filledCells} visible variation table cells.`);
        return true;
      }
    }

    return false;
  }

  async function pasteTsv(editor, tsv, log) {
    const target = findPasteTarget(editor.container);
    if (!target) {
      return false;
    }

    target.focus();
    if (target.matches("textarea, input")) {
      setNativeValue(target, tsv);
      return true;
    }

    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", tsv);
    clipboardData.setData("text/tab-separated-values", tsv);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData
    });
    target.dispatchEvent(event);
    log("Dispatched TSV paste event to first editable variation cell.");
    return true;
  }

  function verifyVariationRows(editor, variations, dimensions) {
    const text = textOf(editor.container).toLowerCase();
    if (!variations.length) {
      return false;
    }

    const sample = variations.slice(0, Math.min(5, variations.length));
    let hits = 0;
    sample.forEach((variation) => {
      const data = [
        variation.sku,
        variation.price,
        variation.quantity,
        ...dimensions.map((dimension) => (variation.options || {})[dimension])
      ].filter(Boolean);
      if (data.some((value) => text.includes(String(value).toLowerCase()))) {
        hits += 1;
      }
    });
    return hits >= Math.min(2, sample.length);
  }

  function clickSaveDone(editor, log) {
    const button = findButtonByText(["save", "done", "apply", "continue"], editor.container);
    if (button) {
      button.click();
      log(`Clicked ${labelOf(button)} after variation values were detected.`);
    } else {
      log("Save/Done button not found; leaving editor open for manual review.");
    }
  }

  function logEditorDiagnostics(log, container = document) {
    const editor = container === document ? findVariationEditor() : { container };
    const root = editor ? editor.container : document;
    const buttons = allElementsDeep(root)
      .filter((node) => /^(BUTTON|A)$/i.test(node.tagName) || node.getAttribute("role") === "button")
      .filter(isVisible)
      .map(labelOf)
      .filter(Boolean)
      .slice(0, 60);
    const inputs = allElementsDeep(root)
      .filter((node) => /^(INPUT|TEXTAREA|SELECT)$/i.test(node.tagName) || node.isContentEditable)
      .filter(isVisible);

    log(`Iframes found count: ${document.querySelectorAll("iframe").length}`);
    log(`Dialogs found count: ${document.querySelectorAll("[role='dialog'], dialog, [class*='drawer' i], [class*='modal' i]").length}`);
    log(`Inputs inside editor count: ${inputs.length}`);
    log(`Buttons inside editor: ${buttons.join(" | ") || "none"}`);
  }

  function findVariationEditor() {
    const candidates = [
      ...document.querySelectorAll("[role='dialog'], dialog, [class*='drawer' i], [class*='modal' i], [class*='variation' i], [data-testid*='variation' i]")
    ]
      .filter(isVisible)
      .map((container) => ({ container, contextName: "main DOM" }));

    for (const iframe of document.querySelectorAll("iframe")) {
      try {
        const doc = iframe.contentDocument;
        if (!doc) {
          continue;
        }
        const frameCandidates = [
          ...doc.querySelectorAll("[role='dialog'], dialog, body, [class*='variation' i], [data-testid*='variation' i]")
        ].filter((node) => isVisibleInDocument(node, doc))
          .map((container) => ({ container, contextName: "iframe" }));
        candidates.push(...frameCandidates);
      } catch (error) {
        // Cross-origin frames cannot be inspected from a content script.
      }
    }

    const shadowCandidates = allElementsDeep(document)
      .filter((node) => /dialog|drawer|modal|variation/i.test(`${node.tagName} ${node.className || ""} ${node.id || ""}`))
      .filter(isVisible)
      .map((container) => ({ container, contextName: "shadow/main DOM" }));
    candidates.push(...shadowCandidates);

    return candidates
      .filter(({ container }) => /variation|option|sku|price|quantity|generate|done|save/i.test(textOf(container)))
      .sort((a, b) => scoreEditor(b.container) - scoreEditor(a.container))[0] || null;
  }

  function scoreEditor(container) {
    const text = textOf(container).toLowerCase();
    let score = container.querySelectorAll("input, textarea, select, [contenteditable='true']").length * 2;
    if (text.includes("variation")) score += 10;
    if (text.includes("sku")) score += 4;
    if (text.includes("price")) score += 3;
    if (text.includes("quantity")) score += 3;
    if (container.matches("[role='dialog'], dialog, [class*='drawer' i], [class*='modal' i]")) score += 8;
    return score;
  }

  function findVariationSection() {
    const selectors = [
      ".summary__variations",
      "[_track*='VARIATIONS' i]",
      "[data-testid*='variation' i]",
      "[class*='variation' i]"
    ];
    const direct = selectors.map((selector) => document.querySelector(selector)).find((node) => node && isVisible(node));
    if (direct) {
      return direct;
    }
    const heading = [...document.querySelectorAll("h1, h2, h3, legend, button, a")]
      .filter(isVisible)
      .find((node) => /^variations?$/i.test(textOf(node)));
    return heading ? heading.closest("section, div, fieldset") || heading : null;
  }

  function findButtonByText(terms, root = document) {
    const lowerTerms = terms.map((term) => String(term).toLowerCase());
    return allElementsDeep(root)
      .filter((node) => /^(BUTTON|A)$/i.test(node.tagName) || node.getAttribute("role") === "button")
      .filter(isVisible)
      .find((button) => {
        const text = labelOf(button).toLowerCase();
        return lowerTerms.some((term) => text.includes(term));
      });
  }

  function findLikelyEmptyInput(root, labels) {
    const lowerLabels = labels.map((label) => String(label).toLowerCase());
    return allElementsDeep(root)
      .filter((node) => /^(INPUT|TEXTAREA)$/i.test(node.tagName) || node.isContentEditable)
      .filter(isVisible)
      .find((input) => {
        const value = input.isContentEditable ? textOf(input) : input.value;
        if (String(value || "").trim()) {
          return false;
        }
        const label = fieldLabel(input).toLowerCase();
        return lowerLabels.some((term) => label.includes(term));
      }) || allElementsDeep(root)
      .filter((node) => /^(INPUT|TEXTAREA)$/i.test(node.tagName) || node.isContentEditable)
      .filter(isVisible)
      .find((input) => !String(input.isContentEditable ? textOf(input) : input.value || "").trim());
  }

  function findPasteTarget(root) {
    const tableEditable = allElementsDeep(root)
      .filter((node) => node.matches && node.matches("td, [role='gridcell'], [contenteditable='true'], textarea, input"))
      .filter(isVisible)
      .find((node) => /sku|price|quantity|variation|option/i.test(textOf(node.closest("table, [role='grid'], div") || node)));
    if (tableEditable) {
      return tableEditable;
    }
    return allElementsDeep(root)
      .filter((node) => node.matches && node.matches("[contenteditable='true'], textarea, input"))
      .filter(isVisible)[0] || null;
  }

  function inferHeaders(table, dimensions) {
    const headerTexts = [...table.querySelectorAll("thead th, [role='columnheader'], th")]
      .map((header) => textOf(header).toLowerCase());
    if (!headerTexts.length) {
      return [];
    }
    return headerTexts.map((text) => {
      if (/sku|custom label/.test(text)) return "sku";
      if (/price/.test(text)) return "price";
      if (/qty|quantity|available/.test(text)) return "quantity";
      if (/image|photo/.test(text)) return "image";
      return dimensions.find((dimension) => text.includes(dimension.toLowerCase())) || "";
    });
  }

  function guessFieldKey(field, index, dimensions) {
    const label = fieldLabel(field).toLowerCase();
    if (/sku|custom label/.test(label)) return "sku";
    if (/price/.test(label)) return "price";
    if (/qty|quantity|available/.test(label)) return "quantity";
    if (/image|photo/.test(label)) return "image";
    const dimension = dimensions.find((name) => label.includes(name.toLowerCase()));
    if (dimension) return dimension;
    return ["sku", ...dimensions, "price", "quantity", "image"][index] || "";
  }

  function rowData(variation, product, dimensions) {
    const data = {
      sku: variation.sku || "",
      price: variation.price || product.price || "",
      quantity: variation.quantity || product.quantity || "",
      image: variation.image || ""
    };
    dimensions.forEach((dimension) => {
      data[dimension] = (variation.options || {})[dimension] || "";
    });
    return data;
  }

  function setFieldValue(field, value) {
    if (field.tagName === "SELECT") {
      const option = [...field.options].find((item) => {
        const text = `${item.textContent} ${item.value}`.toLowerCase();
        return text.includes(String(value).toLowerCase());
      });
      if (option) {
        field.value = option.value;
        option.selected = true;
        dispatchAll(field);
      }
      return;
    }

    if (field.isContentEditable) {
      field.textContent = value;
      dispatchAll(field);
      return;
    }

    setNativeValue(field, value);
  }

  function setNativeValue(element, value) {
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
    const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
    if (descriptor && descriptor.set) {
      descriptor.set.call(element, value);
    } else if ("value" in element) {
      element.value = value;
    } else {
      element.textContent = value;
    }
    dispatchAll(element);
  }

  function dispatchAll(element) {
    ["input", "change", "blur"].forEach((type) => {
      element.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function variantsToTsv(product) {
    const dimensions = variationDimensions(product);
    const header = ["SKU", ...dimensions, "Price", "Quantity", "Image"];
    const rows = (product.variations || [])
      .filter((variation) => variation.selected !== false)
      .map((variation) => [
        variation.sku || "",
        ...dimensions.map((dimension) => (variation.options || {})[dimension] || ""),
        variation.price || product.price || "",
        variation.quantity || product.quantity || "",
        variation.image || ""
      ]);
    return [header, ...rows]
      .map((row) => row.map((cell) => String(cell || "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"))
      .join("\n");
  }

  function variationDimensions(product) {
    return [...new Set([
      ...(product.variationDimensions || []),
      ...(product.variations || []).flatMap((variation) => Object.keys(variation.options || {}))
    ].map((name) => String(name || "").trim()).filter(Boolean))];
  }

  function allElementsDeep(root) {
    const start = root && root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root;
    if (!start) {
      return [];
    }

    const elements = [];
    const stack = [start];
    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        stack.push(...[...node.children].reverse());
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }
      elements.push(node);
      if (node.shadowRoot) {
        stack.push(node.shadowRoot);
      }
      if (node.children) {
        stack.push(...[...node.children].reverse());
      }
    }
    return elements;
  }

  function fieldLabel(field) {
    const parts = [
      field.getAttribute("aria-label"),
      field.getAttribute("placeholder"),
      field.getAttribute("name"),
      field.id
    ];
    if (field.id) {
      const label = field.ownerDocument.querySelector(`label[for="${cssEscape(field.id)}"]`);
      if (label) {
        parts.push(textOf(label));
      }
    }
    const wrapping = field.closest("label");
    if (wrapping) {
      parts.push(textOf(wrapping));
    }
    const row = field.closest("tr, li, [class*='field' i], [class*='row' i], div");
    if (row) {
      parts.push(textOf(row).slice(0, 150));
    }
    return parts.filter(Boolean).join(" ");
  }

  function isVisible(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }
    const doc = node.ownerDocument || document;
    return isVisibleInDocument(node, doc);
  }

  function isVisibleInDocument(node, doc) {
    const view = doc.defaultView || window;
    const style = view.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(node) {
    return node ? String(node.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function labelOf(node) {
    return textOf(node) || node.getAttribute("aria-label") || node.getAttribute("title") || node.value || "";
  }

  function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function waitFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function copyToClipboard(text, log) {
    try {
      await navigator.clipboard.writeText(text);
      log("Variation TSV copied to clipboard for paste-assisted mode.");
    } catch (error) {
      log("Clipboard copy was blocked; Copy Variants button can be used manually.");
    }
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) {
      return CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }
})();
