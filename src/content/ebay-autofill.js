(() => {
  const PANEL_ID = "am-ebay-assistant-panel";
  const LOG_LIMIT = 80;
  const state = {
    draft: null,
    ebayState: null,
    logs: [],
    panelReady: false
  };

  const SPECIFIC_NAME_MAP = new Map([
    ["brand name", "Brand"],
    ["brand", "Brand"],
    ["material", "Material"],
    ["feature", "Features"],
    ["features", "Features"],
    ["model", "Model"],
    ["compatible brand", "Compatible Brand"],
    ["compatible model", "Compatible Model"],
    ["color", "Colour"],
    ["colour", "Colour"],
    ["size", "Size"],
    ["length", "Length"],
    ["type", "Type"],
    ["design", "Design/Finish"],
    ["finish", "Design/Finish"],
    ["control style", "Control Style"],
    ["lighting technology", "Lighting Technology"],
    ["sensor type", "Sensor Type"]
  ]);

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    state.logs.push(line);
    state.logs = state.logs.slice(-LOG_LIMIT);
    const logNode = document.querySelector(`#${PANEL_ID} .am-log`);
    if (logNode) {
      logNode.textContent = state.logs.join("\n");
      logNode.scrollTop = logNode.scrollHeight;
    }
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
    const docs = [document];
    for (const iframe of document.querySelectorAll("iframe")) {
      try {
        if (iframe.contentDocument?.documentElement) {
          docs.push(iframe.contentDocument);
        }
      } catch (_error) {
        // Cross-origin iframe.
      }
    }
    return docs;
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
    const output = [];
    for (const doc of getAccessibleDocuments()) {
      for (const root of collectRoots(doc)) {
        for (const node of root.querySelectorAll(selector)) {
          if (includeHidden || isVisible(node)) {
            output.push(node);
          }
        }
      }
    }
    return output;
  }

  function getDescriptor(element) {
    return [
      element.textContent,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("placeholder"),
      element.getAttribute?.("name"),
      element.getAttribute?.("id"),
      element.getAttribute?.("title")
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .join(" | ");
  }

  function findElementByPatterns(selector, patterns, includeHidden = false) {
    return queryAllDeep(selector, includeHidden).find((element) => {
      const haystack = getDescriptor(element).toLowerCase();
      return patterns.some((pattern) => haystack.includes(pattern));
    });
  }

  function dispatchInputEvents(element) {
    ["input", "change", "blur"].forEach((eventName) => {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    });
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
    dispatchInputEvents(field);
    return true;
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

  async function sendMessage(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) {
      throw new Error(response?.error || "Unexpected extension error.");
    }
    return response;
  }

  function normalizeSpecificName(name) {
    const key = normalizeText(name).toLowerCase();
    return SPECIFIC_NAME_MAP.get(key) || normalizeText(name);
  }

  function buildVariantTableText() {
    const dimensions = (state.draft?.variations?.dimensions || []).filter((dimension) => dimension.enabled !== false);
    const rows = (state.draft?.variations?.rows || []).filter((row) => row.selected !== false);
    const headers = ["SKU", ...dimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image"];
    return [
      headers.join("\t"),
      ...rows.map((row) =>
        [
          row.sku || "",
          ...dimensions.map((dimension) => row.optionValues?.[dimension.name] || ""),
          row.price ?? "",
          row.quantity ?? "",
          row.imageUrl || ""
        ].join("\t")
      )
    ].join("\n");
  }

  async function loadState() {
    const [draftResponse, ebayResponse] = await Promise.all([
      sendMessage("AM_GET_DRAFT"),
      sendMessage("AM_GET_EBAY_STATE")
    ]);
    state.draft = draftResponse.draft;
    state.ebayState = ebayResponse.ebayState;
  }

  async function updateEbayState(patch) {
    const response = await sendMessage("AM_SAVE_EBAY_STATE", { patch });
    state.ebayState = response.ebayState;
  }

  function renderPanelMeta() {
    const titleNode = document.querySelector(`#${PANEL_ID} .am-title`);
    const statusNode = document.querySelector(`#${PANEL_ID} .am-status`);
    if (titleNode) {
      titleNode.textContent = state.draft?.title || "No draft loaded";
    }
    if (statusNode) {
      statusNode.textContent = state.ebayState?.lastStatus || "Idle";
    }
  }

  function ensurePanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          top: 84px;
          right: 18px;
          width: 320px;
          z-index: 2147483646;
          background: rgba(2, 6, 23, 0.98);
          color: #e2e8f0;
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 16px;
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.32);
          font-family: Arial, Helvetica, sans-serif;
          font-size: 13px;
          overflow: hidden;
        }
        #${PANEL_ID} .am-head {
          padding: 14px 14px 8px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.18);
        }
        #${PANEL_ID} .am-name {
          font-weight: 700;
          font-size: 14px;
          margin-bottom: 6px;
        }
        #${PANEL_ID} .am-title {
          color: #bae6fd;
          font-size: 12px;
          margin-bottom: 6px;
        }
        #${PANEL_ID} .am-status {
          color: #94a3b8;
          font-size: 12px;
        }
        #${PANEL_ID} .am-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 12px 14px;
        }
        #${PANEL_ID} button {
          width: 100%;
          border: 1px solid rgba(148, 163, 184, 0.3);
          border-radius: 10px;
          background: #0f172a;
          color: #e2e8f0;
          cursor: pointer;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
        }
        #${PANEL_ID} button.primary {
          background: #38bdf8;
          color: #0f172a;
        }
        #${PANEL_ID} .am-log {
          margin: 0;
          padding: 12px 14px 14px;
          white-space: pre-wrap;
          max-height: 280px;
          overflow: auto;
          border-top: 1px solid rgba(148, 163, 184, 0.18);
          color: #cbd5e1;
          background: rgba(15, 23, 42, 0.7);
        }
      </style>
      <div class="am-head">
        <div class="am-name">AM eBay Listing Assistant</div>
        <div class="am-title">No draft loaded</div>
        <div class="am-status">Idle</div>
      </div>
      <div class="am-actions">
        <button data-action="autoStart" class="primary">Auto Start</button>
        <button data-action="fillNow" class="primary">Fill Now</button>
        <button data-action="setBuyItNow">Set Buy It Now</button>
        <button data-action="buildVariations">Build Variations</button>
        <button data-action="uploadImages">Upload Images</button>
        <button data-action="copyTitle">Copy Title</button>
        <button data-action="copyDescription">Copy Description</button>
        <button data-action="copyVariants">Copy Variants</button>
        <button data-action="debugFields">Debug Fields</button>
        <button data-action="stopVariation">Stop</button>
      </div>
      <pre class="am-log"></pre>
    `;

    document.body.append(panel);
    panel.addEventListener("click", async (event) => {
      const action = event.target?.getAttribute("data-action");
      if (!action) {
        return;
      }
      try {
        await loadState();
        renderPanelMeta();
        switch (action) {
          case "autoStart":
            await autoStart();
            break;
          case "fillNow":
            await fillNow();
            break;
          case "setBuyItNow":
            await setBuyItNow();
            break;
          case "buildVariations":
            await buildVariations();
            break;
          case "uploadImages":
            await uploadImages();
            break;
          case "copyTitle":
            await navigator.clipboard.writeText(state.draft?.title || "");
            log("Title copied to clipboard.");
            break;
          case "copyDescription":
            await navigator.clipboard.writeText(state.draft?.descriptionHtml || "");
            log("Description copied to clipboard.");
            break;
          case "copyVariants":
            await navigator.clipboard.writeText(buildVariantTableText());
            log("Variation table copied to clipboard.");
            break;
          case "debugFields":
            await debugFields();
            break;
          case "stopVariation":
            window.__AM_EBAY_VARIATION_WATCHER__?.stopBuild(log);
            break;
          default:
            break;
        }
      } catch (error) {
        log(error?.message || String(error));
      }
    });

    state.panelReady = true;
    renderPanelMeta();
    log("Floating assistant ready.");
  }

  function isAddItemPage() {
    return Boolean(
      queryAllDeep('select[name="format"]', true)[0] ||
        findElementByPatterns("input, textarea, select, [contenteditable='true']", [
          "custom label",
          "item specifics",
          "description",
          "condition"
        ])
    );
  }

  async function setBuyItNow() {
    const select = queryAllDeep('select[name="format"]', true)[0];
    if (select) {
      select.value = "FixedPrice";
      const option = select.querySelector('option[value="FixedPrice"]');
      if (option) {
        option.selected = true;
      }
      dispatchInputEvents(select);
      log(`Format select set to ${select.value}.`);
    } else {
      log('select[name="format"] not found.');
    }

    const visibleTriggers = queryAllDeep("button, [role='button']", true).filter((button) => {
      const text = getDescriptor(button).toLowerCase();
      return text.includes("format") || text.includes("auction") || text.includes("buy it now") || text.includes("fixed price");
    });
    if (visibleTriggers[0]) {
      clickElement(visibleTriggers[0]);
      await sleep(250);
      const fixedPriceOption = findElementByPatterns(
        "button, [role='option'], [role='menuitem'], li, div",
        ["buy it now", "fixed price"],
        true
      );
      if (fixedPriceOption) {
        clickElement(fixedPriceOption);
        log("Visible pricing format option clicked.");
      }
    }
    await updateEbayState({ lastStatus: "Buy It Now set" });
    renderPanelMeta();
  }

  function findTitleField() {
    return (
      queryAllDeep('input[name="title"], textarea[name="title"]')[0] ||
      findElementByPatterns("input, textarea, [contenteditable='true']", ["title"]) ||
      queryAllDeep('input[aria-label*="Title" i], textarea[aria-label*="Title" i]')[0] ||
      null
    );
  }

  async function autoStart() {
    if (!state.draft?.title) {
      log("No draft title available.");
      return;
    }

    const titleField = findTitleField();
    if (titleField) {
      setFieldValue(titleField, state.draft.title);
      log("Title entered for eBay start flow.");
    } else {
      log("Title input not found on this page.");
    }

    const startButton = findElementByPatterns("button, [role='button'], a", [
      "search",
      "start",
      "continue",
      "sell it yourself",
      "get started"
    ]);
    if (startButton) {
      clickElement(startButton);
      log("Start/search button clicked.");
    }

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const continueWithoutMatch = findElementByPatterns("button, [role='button'], a", [
        "continue without match",
        "continue without product match"
      ]);
      if (continueWithoutMatch) {
        clickElement(continueWithoutMatch);
        log("Continue without match clicked.");
        break;
      }
      if (isAddItemPage()) {
        break;
      }
      await sleep(400);
    }

    const addItem = isAddItemPage();
    await updateEbayState({
      autoStartArmed: !addItem,
      lastStatus: addItem ? "AddItem page ready" : "Auto start triggered"
    });
    renderPanelMeta();
  }

  function chooseOption(select, targetValue) {
    if (!select || !targetValue) {
      return false;
    }
    const lowerTarget = normalizeText(targetValue).toLowerCase();
    const options = [...select.options];
    const option = options.find((entry) => normalizeText(entry.textContent).toLowerCase() === lowerTarget) ||
      options.find((entry) => normalizeText(entry.textContent).toLowerCase().includes(lowerTarget));
    if (!option) {
      return false;
    }
    select.value = option.value;
    option.selected = true;
    dispatchInputEvents(select);
    return true;
  }

  function findFieldByLabel(labelText) {
    const lowered = normalizeText(labelText).toLowerCase();
    const candidates = queryAllDeep("label, [class*='label'], span, div", true);
    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent).toLowerCase();
      if (!text || !text.includes(lowered)) {
        continue;
      }
      if (candidate.htmlFor) {
        const direct = candidate.ownerDocument.getElementById(candidate.htmlFor);
        if (direct) {
          return direct;
        }
      }
      const field = candidate.closest("div, section, li")?.querySelector("input, textarea, select, [contenteditable='true']");
      if (field) {
        return field;
      }
    }
    return null;
  }

  function fillSimpleField(candidates, value, label) {
    const field = candidates.find(Boolean);
    if (!field || value === undefined || value === null || value === "") {
      return false;
    }
    const success = setFieldValue(field, value);
    if (success) {
      log(`${label} filled.`);
    }
    return success;
  }

  function findDescriptionTarget() {
    const directField = findElementByPatterns("textarea, [contenteditable='true'], iframe", ["description", "item description"], true);
    if (directField?.tagName === "IFRAME") {
      try {
        return directField.contentDocument?.body || null;
      } catch (_error) {
        return null;
      }
    }
    return directField;
  }

  async function fillDescription(html) {
    const target = findDescriptionTarget();
    if (!target) {
      log("Description editor not found.");
      return false;
    }
    if (target.tagName === "BODY" || target.isContentEditable) {
      target.innerHTML = html;
      dispatchInputEvents(target);
      log("Description HTML inserted.");
      return true;
    }
    return fillSimpleField([target], html, "Description");
  }

  async function fillCondition() {
    const targetValue = state.draft?.settings?.condition || "New";
    const select = findFieldByLabel("Condition") || findElementByPatterns("select, input, [role='combobox']", ["condition"]);
    if (!select) {
      log("Condition field not found.");
      return false;
    }
    if (select.tagName === "SELECT") {
      const success = chooseOption(select, targetValue) || chooseOption(select, "New");
      log(success ? "Condition selected." : "Condition select did not match requested option.");
      return success;
    }
    if (select.getAttribute("role") === "combobox" || /button/i.test(select.tagName)) {
      clickElement(select);
      await sleep(250);
      const option = findElementByPatterns("li, button, [role='option']", [targetValue.toLowerCase(), "new"], true);
      if (option) {
        clickElement(option);
        log("Condition option clicked.");
        return true;
      }
    }
    return fillSimpleField([select], targetValue, "Condition");
  }

  function getSpecificValueMap() {
    const map = new Map();
    for (const entry of state.draft?.specifics || []) {
      if (entry.enabled === false || !entry.name || !entry.value) {
        continue;
      }
      map.set(normalizeSpecificName(entry.name).toLowerCase(), normalizeText(entry.value));
    }
    return map;
  }

  async function fillItemSpecifics() {
    const specifics = getSpecificValueMap();
    if (!specifics.size) {
      log("No item specifics available.");
      return;
    }

    const protectedPatterns = ["title", "price", "quantity", "custom label", "sku", "shipping", "payment", "return"];
    const fields = queryAllDeep("input, textarea, select, [role='combobox']", true).filter((field) => {
      const descriptor = getDescriptor(field).toLowerCase();
      return descriptor && !protectedPatterns.some((pattern) => descriptor.includes(pattern));
    });

    let filledCount = 0;
    for (const [name, value] of specifics.entries()) {
      const field =
        findFieldByLabel(name) ||
        fields.find((candidate) => getDescriptor(candidate).toLowerCase().includes(name));
      if (!field) {
        continue;
      }
      if (field.tagName === "SELECT") {
        if (chooseOption(field, value)) {
          filledCount += 1;
        }
        continue;
      }
      if (field.getAttribute("role") === "combobox") {
        clickElement(field);
        await sleep(200);
        const option = findElementByPatterns("li, button, [role='option'], label", [value.toLowerCase()], true);
        if (option) {
          clickElement(option);
          filledCount += 1;
          continue;
        }
      }
      if (setFieldValue(field, value)) {
        filledCount += 1;
      }
    }

    const suggestionLabels = queryAllDeep("label, button, [role='checkbox'], [role='option']", true);
    const valuesToMatch = [
      ...specifics.values(),
      ...(state.draft?.title ? state.draft.title.split(/\s+/).filter((token) => token.length > 4) : [])
    ]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean);

    let suggestionClicks = 0;
    for (const label of suggestionLabels) {
      const text = normalizeText(label.textContent).toLowerCase();
      if (!text || !valuesToMatch.some((value) => text.includes(value))) {
        continue;
      }
      if (
        label.matches('input[type="checkbox"]') &&
        !label.checked
      ) {
        label.click();
        suggestionClicks += 1;
      } else if (label.getAttribute("role") === "checkbox" && label.getAttribute("aria-checked") !== "true") {
        clickElement(label);
        suggestionClicks += 1;
      }
    }

    log(`Item specifics filled: ${filledCount}; list-faster suggestions clicked: ${suggestionClicks}.`);
  }

  async function fillPolicies() {
    const policyFields = [
      ["Shipping Policy", state.draft?.settings?.shippingPolicy],
      ["Payment Policy", state.draft?.settings?.paymentPolicy],
      ["Return Policy", state.draft?.settings?.returnPolicy]
    ];
    for (const [label, value] of policyFields) {
      if (!value) {
        continue;
      }
      const field = findFieldByLabel(label) || findElementByPatterns("select, input, [role='combobox']", [label.toLowerCase()]);
      if (!field) {
        log(`${label} field not found.`);
        continue;
      }
      if (field.tagName === "SELECT") {
        chooseOption(field, value);
      } else if (field.getAttribute("role") === "combobox") {
        clickElement(field);
        await sleep(250);
        const option = findElementByPatterns("li, button, [role='option']", [normalizeText(value).toLowerCase()], true);
        if (option) {
          clickElement(option);
        }
      } else {
        setFieldValue(field, value);
      }
      log(`${label} filled.`);
    }
  }

  async function fetchImageAsFile(url, index) {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) {
      throw new Error(`Failed to fetch image ${index + 1}: ${response.status}`);
    }
    const blob = await response.blob();
    const extensionMatch = url.match(/\.(jpg|jpeg|png|webp|gif)(?=$|\?)/i);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "jpg";
    const fileName = `am-ebay-image-${index + 1}.${extension}`;
    return new File([blob], fileName, { type: blob.type || `image/${extension}` });
  }

  async function uploadImages() {
    const images = (state.draft?.images || []).filter((image) => image.selected !== false && image.url);
    if (!images.length) {
      log("No selected images available.");
      return;
    }

    const files = [];
    for (let index = 0; index < images.length; index += 1) {
      try {
        files.push(await fetchImageAsFile(images[index].url, index));
      } catch (error) {
        log(error?.message || String(error));
      }
    }

    if (!files.length) {
      log("Image fetch failed for all selected images.");
      return;
    }

    const fileInput = queryAllDeep('input[type="file"]', true)[0];
    if (fileInput) {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      fileInput.files = transfer.files;
      dispatchInputEvents(fileInput);
      log(`Assigned ${files.length} images to uploader input.`);
      return;
    }

    const dropTarget = findElementByPatterns("div, section, label", ["drop files here", "upload photos", "add photos"], true);
    if (dropTarget) {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      ["dragenter", "dragover", "drop"].forEach((type) => {
        const event = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer });
        dropTarget.dispatchEvent(event);
      });
      log(`Dispatched drag/drop upload with ${files.length} images.`);
      return;
    }

    const webUploadFallback = findElementByPatterns("button, [role='button'], a", ["upload from web"], true);
    if (webUploadFallback) {
      clickElement(webUploadFallback);
      log("Upload from web fallback opened; manual follow-up may be required.");
      return;
    }

    log("No image upload target found.");
  }

  async function fillNow() {
    if (!state.draft) {
      log("No draft loaded.");
      return;
    }

    await setBuyItNow();
    fillSimpleField([findTitleField()], state.draft.title, "Title");

    const skuField =
      queryAllDeep('input[name="customLabel"], input[name="sku"]')[0] ||
      findElementByPatterns("input, textarea", ["custom label", "sku"]);
    fillSimpleField([skuField], state.draft.sku || state.draft.skuPrefix, "Custom label / SKU");

    const priceField =
      queryAllDeep('input[name="price"]')[0] ||
      findElementByPatterns("input", ["buy it now", "fixed price", "price"]);
    fillSimpleField([priceField], state.draft.price, "Price");

    const quantityField =
      queryAllDeep('input[name="quantity"]')[0] ||
      findElementByPatterns("input", ["quantity", "qty"]);
    fillSimpleField([quantityField], state.draft.quantity, "Quantity");

    await fillCondition();
    await fillDescription(state.draft.descriptionHtml || "");
    await fillItemSpecifics();
    await fillPolicies();
    await uploadImages();

    await updateEbayState({ lastStatus: "Fill Now completed", autoStartArmed: false });
    renderPanelMeta();
  }

  async function buildVariations() {
    if (!state.draft?.variations?.rows?.length) {
      log("No variation rows available.");
      return;
    }
    await setBuyItNow();
    const result = await window.__AM_EBAY_VARIATION_WATCHER__?.buildVariations(state.draft, log);
    if (result?.ok) {
      await updateEbayState({ lastStatus: "Variation build attempted" });
      renderPanelMeta();
    }
  }

  async function debugFields() {
    const formatSelect = queryAllDeep('select[name="format"]', true)[0] || null;
    const visibleFormatButton = findElementByPatterns(
      "button, [role='button']",
      ["auction", "buy it now", "fixed price", "format"],
      true
    );
    const variationStatus = window.__AM_EBAY_VARIATION_WATCHER__?.getVariationStatus?.() || {};
    const editorRoot = window.__AM_EBAY_VARIATION_WATCHER__?.detectEditorRoot?.();

    const debugPayload = {
      url: location.href,
      extensionVersion: chrome.runtime.getManifest().version,
      productTitle: state.draft?.title || "",
      scrapedPrice: state.draft?.price || "",
      imagesCount: state.draft?.images?.length || 0,
      variationsCount: state.draft?.variations?.rows?.length || 0,
      specsCount: state.draft?.specifics?.length || 0,
      formatSelectStatus: {
        exists: Boolean(formatSelect),
        currentValue: formatSelect?.value || "",
        visibleLabel: normalizeText(visibleFormatButton?.textContent || ""),
        fixedPriceSelected: formatSelect?.value === "FixedPrice"
      },
      variationSectionStatus: {
        found: variationStatus.sectionFound || false,
        formatValue: variationStatus.formatValue || "",
        visibleLabel: variationStatus.visibleLabel || ""
      },
      variationEditorStatus: {
        opened: Boolean(editorRoot)
      },
      visibleInputs: queryAllDeep("input, textarea, [contenteditable='true']", true).slice(0, 120).map((field) => ({
        tag: field.tagName.toLowerCase(),
        name: field.getAttribute("name") || "",
        ariaLabel: field.getAttribute("aria-label") || "",
        placeholder: field.getAttribute("placeholder") || "",
        id: field.id || "",
        value: field.value || field.textContent || ""
      })),
      buttons: queryAllDeep("button, [role='button']", true).slice(0, 120).map((button) => normalizeText(button.textContent || button.getAttribute("aria-label") || "")),
      selectFields: queryAllDeep("select", true).map((select) => ({
        name: select.getAttribute("name") || "",
        selectedValue: select.value
      })),
      fileInputs: queryAllDeep('input[type="file"]', true).map((field) => ({
        name: field.getAttribute("name") || "",
        id: field.id || ""
      })),
      iframes: getAccessibleDocuments()
        .slice(1)
        .map((doc) => ({
          title: doc.title || "",
          fieldCount: doc.querySelectorAll("input, textarea, select, [contenteditable='true']").length
        }))
    };

    const text = JSON.stringify(debugPayload, null, 2);
    log(text);
    try {
      await navigator.clipboard.writeText(text);
      log("Debug payload copied to clipboard.");
    } catch (_error) {
      log("Debug payload could not be copied to clipboard.");
    }
  }

  async function bootstrap() {
    try {
      await loadState();
      ensurePanel();
      renderPanelMeta();
      if (state.ebayState?.autoStartArmed) {
        log("Auto-start state detected.");
        await autoStart();
      } else if (isAddItemPage()) {
        log("AddItem page detected.");
      }
    } catch (error) {
      ensurePanel();
      log(error?.message || String(error));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
