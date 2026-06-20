(() => {
  if (window.top !== window || window.__amEbayAutofillLoaded) {
    return;
  }
  window.__amEbayAutofillLoaded = true;

  const VERSION = "0.1.0";
  const PANEL_ID = "am-ebay-listing-assistant-panel";
  const PROTECTED_SPECIFIC_LABELS = new Set([
    "title",
    "subtitle",
    "custom label",
    "sku",
    "price",
    "quantity",
    "format",
    "duration",
    "shipping policy",
    "payment policy",
    "return policy"
  ]);

  const SPECIFIC_LABEL_MAP = new Map([
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

  let product = null;
  let settings = {};
  let logs = [];

  init();

  async function init() {
    await loadProduct();
    injectPanel();
    log(`Ready on ${location.hostname}`);
    if (looksLikeSellStartPage()) {
      log("Sell start page detected. Use Auto Start to begin the listing flow.");
    }
  }

  async function loadProduct() {
    const response = await sendRuntime({ type: "GET_PRODUCT_FOR_CONTENT" });
    product = response.product || {};
    settings = response.settings || {};
  }

  function injectPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const panel = document.createElement("aside");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <style>
        #${PANEL_ID} {
          position: fixed;
          top: 88px;
          right: 18px;
          z-index: 2147483647;
          width: 330px;
          max-height: calc(100vh - 110px);
          padding: 12px;
          overflow: auto;
          color: #101828;
          background: #fff;
          border: 1px solid #d8dee8;
          border-radius: 14px;
          box-shadow: 0 16px 44px rgb(16 24 40 / 22%);
          font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        #${PANEL_ID} h2 {
          margin: 0 0 6px;
          color: #123f8c;
          font-size: 15px;
        }
        #${PANEL_ID} .title {
          margin-bottom: 8px;
          overflow: hidden;
          color: #344054;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #${PANEL_ID} .grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        #${PANEL_ID} button {
          min-height: 34px;
          padding: 7px 8px;
          border: 0;
          border-radius: 8px;
          color: #fff;
          background: #123f8c;
          cursor: pointer;
          font: inherit;
          font-weight: 650;
        }
        #${PANEL_ID} button.secondary {
          color: #101828;
          border: 1px solid #d8dee8;
          background: #fff;
        }
        #${PANEL_ID} button.warning {
          color: #101828;
          background: #f3a51b;
        }
        #${PANEL_ID} button.danger {
          background: #b42318;
        }
        #${PANEL_ID} pre {
          max-height: 220px;
          margin: 10px 0 0;
          padding: 8px;
          overflow: auto;
          border-radius: 8px;
          color: #101828;
          background: #f8fafc;
          white-space: pre-wrap;
        }
      </style>
      <h2>AM eBay Listing Assistant</h2>
      <div class="title" title="${escapeAttribute(product.title || "")}">${escapeHtml(product.title || "No product loaded")}</div>
      <div class="grid">
        <button data-action="auto-start" class="warning">Auto Start</button>
        <button data-action="fill-now">Fill Now</button>
        <button data-action="set-buy-it-now">Set Buy It Now</button>
        <button data-action="build-variations">Build Variations</button>
        <button data-action="upload-images">Upload Images</button>
        <button data-action="copy-title" class="secondary">Copy Title</button>
        <button data-action="copy-description" class="secondary">Copy Description</button>
        <button data-action="copy-variants" class="secondary">Copy Variants</button>
        <button data-action="debug-fields" class="secondary">Debug Fields</button>
        <button data-action="stop-watcher" class="danger">Stop</button>
      </div>
      <pre data-role="logs"></pre>
    `;

    panel.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) {
        return;
      }
      const action = button.dataset.action;
      button.disabled = true;
      try {
        await handlePanelAction(action);
      } catch (error) {
        log(`ERROR: ${error && error.message ? error.message : String(error)}`);
      } finally {
        button.disabled = false;
      }
    });

    document.documentElement.appendChild(panel);
    renderLogs();
  }

  async function handlePanelAction(action) {
    await loadProduct();
    switch (action) {
      case "auto-start":
        await autoStart();
        break;
      case "fill-now":
        await fillNow();
        break;
      case "set-buy-it-now":
        setBuyItNow();
        break;
      case "build-variations":
        await ensureVariationBuilder().buildVariations({ product, settings, log, setBuyItNow, debugVariationStatus });
        break;
      case "upload-images":
        await uploadImages();
        break;
      case "copy-title":
        await copyText(product.title || "");
        log("Title copied.");
        break;
      case "copy-description":
        await copyText(product.descriptionHtml || "");
        log("Description copied.");
        break;
      case "copy-variants":
        await copyText(variantsToTsv(product));
        log("Variation TSV copied.");
        break;
      case "debug-fields":
        log(await debugFields());
        break;
      case "stop-watcher":
        if (window.AmEbayVariationWatcher && window.AmEbayVariationWatcher.stop) {
          window.AmEbayVariationWatcher.stop();
        }
        log("Stop requested.");
        break;
      default:
        log(`Unknown action: ${action}`);
    }
  }

  async function autoStart() {
    log("Auto Start running.");
    if (looksLikeSellStartPage()) {
      const titleField = findFirst([
        "input[name='title']",
        "input[aria-label*='title' i]",
        "textarea[aria-label*='title' i]",
        "input[placeholder*='title' i]"
      ]);
      if (titleField && product.title) {
        setNativeValue(titleField, product.title);
        log("Entered title on sell start page.");
      }

      const startButton = findButtonByText(["get started", "start", "search", "continue"]);
      if (startButton) {
        startButton.click();
        log(`Clicked ${textOf(startButton) || "start"} button.`);
      }
    }

    await waitFor(1200);
    const withoutMatch = findButtonByText([
      "continue without match",
      "continue without matching",
      "skip product",
      "create a new listing"
    ]);
    if (withoutMatch) {
      withoutMatch.click();
      log("Clicked Continue without match.");
    } else {
      log("No product-match prompt detected.");
    }
  }

  async function fillNow() {
    log("Fill Now started.");
    setBuyItNow();
    await waitFor(700);
    fillTitle();
    fillSku();
    fillCondition();
    fillPrice();
    fillQuantity();
    fillDescription();
    fillPolicies();
    fillItemSpecifics();
    await uploadImages();
    log("Fill Now completed. Review all fields before manually listing.");
  }

  function setBuyItNow() {
    const select = document.querySelector("select[name='format']");
    if (select) {
      select.value = "FixedPrice";
      const option = select.querySelector("option[value='FixedPrice']");
      if (option) {
        option.selected = true;
      }
      dispatchAll(select);
      log(`Format select set to ${select.value}.`);
    } else {
      log("Format select[name=format] not found.");
    }

    const formatRoot = closestByText(document.querySelectorAll(".se-field, fieldset, section, div"), "format");
    const visibleButton = formatRoot
      ? [...formatRoot.querySelectorAll("button, [role='button']")].find((button) => /auction|format|buy it now|fixed price/i.test(textOf(button) || button.value || ""))
      : null;

    if (visibleButton && /auction|format/i.test(textOf(visibleButton) || visibleButton.value || "")) {
      visibleButton.click();
      setTimeout(() => {
        const fixedOption = findButtonByText(["buy it now", "fixed price"]);
        if (fixedOption) {
          fixedOption.click();
          log("Clicked visible Buy It Now/Fixed Price option.");
        }
      }, 250);
    }
  }

  function fillTitle() {
    if (!product.title) {
      return;
    }
    const field = findFirst([
      "input[name='title']",
      "textarea[name='title']",
      "input[aria-label='Title']",
      "textarea[aria-label='Title']",
      "input[placeholder*='title' i]"
    ]);
    if (field) {
      setNativeValue(field, product.title.slice(0, 80));
      log("Title filled.");
    } else {
      log("Title field not found.");
    }
  }

  function fillSku() {
    const sku = product.sku || `${product.skuPrefix || "AX"}-1`;
    const field = findFirst([
      "input[name='customLabel']",
      "input[name*='customLabel' i]",
      "input[aria-label*='custom label' i]",
      "input[placeholder*='custom label' i]",
      "input[aria-label*='sku' i]"
    ]);
    if (field) {
      setNativeValue(field, sku);
      log("Custom label/SKU filled.");
    } else {
      log("Custom label/SKU field not found.");
    }
  }

  function fillPrice() {
    const price = product.price || "";
    if (!price) {
      return;
    }
    const field = findFirst([
      "input[name='price']",
      "input[name*='price' i]",
      "input[aria-label*='buy it now' i]",
      "input[aria-label*='price' i]"
    ], (input) => !/auction|start|reserve/i.test(labelTextFor(input)));
    if (field) {
      setNativeValue(field, String(price));
      log("Buy It Now price filled.");
    } else {
      log("Price field not found.");
    }
  }

  function fillQuantity() {
    if ((product.variations || []).some((variation) => variation.selected !== false)) {
      log("Variation rows present; quantity may be controlled per variation.");
    }
    const field = findFirst([
      "input[name='quantity']",
      "input[name*='quantity' i]",
      "input[aria-label*='quantity' i]"
    ]);
    if (field && !field.disabled) {
      setNativeValue(field, String(product.quantity || 1));
      log("Quantity filled.");
    }
  }

  function fillDescription() {
    const html = product.descriptionHtml || "";
    if (!html) {
      return;
    }

    const iframeEditor = findAccessibleFrames()
      .map((frame) => frame.document)
      .find((doc) => doc && (doc.body && (doc.body.isContentEditable || doc.querySelector("[contenteditable='true']"))));
    if (iframeEditor) {
      const target = iframeEditor.querySelector("[contenteditable='true']") || iframeEditor.body;
      target.innerHTML = html;
      dispatchAll(target);
      log("Description iframe editor filled.");
      return;
    }

    const editable = findFirst(["[contenteditable='true'][role='textbox']", "[contenteditable='true']"], (node) => {
      const label = labelTextFor(node);
      return /description|item description/i.test(label) || node.closest("[class*='description' i]");
    });
    if (editable) {
      editable.innerHTML = html;
      dispatchAll(editable);
      log("Description rich text editor filled.");
      return;
    }

    const textarea = findFirst([
      "textarea[name*='description' i]",
      "textarea[aria-label*='description' i]",
      "textarea"
    ]);
    if (textarea) {
      setNativeValue(textarea, html);
      log("Description textarea filled.");
    } else {
      log("Description field not found.");
    }
  }

  function fillCondition() {
    const condition = settings.condition || "New";
    const field = findFieldByLabel("Condition");
    if (!field) {
      log("Condition field not found.");
      return;
    }
    if (field.tagName === "SELECT") {
      selectByText(field, [condition, "New with tags", "New"]);
    } else {
      setNativeValue(field, condition);
    }
    log("Condition filled.");
  }

  function fillPolicies() {
    if (settings.shippingPolicy) {
      fillFieldByLabel("Shipping policy", settings.shippingPolicy);
    }
    if (settings.paymentPolicy) {
      fillFieldByLabel("Payment policy", settings.paymentPolicy);
    }
  }

  function fillItemSpecifics() {
    const specifics = normalizeSpecifics(product.itemSpecifics || []);
    let filled = 0;
    specifics.forEach((specific) => {
      const label = normalizeSpecificName(specific.name);
      if (!label || PROTECTED_SPECIFIC_LABELS.has(label.toLowerCase())) {
        return;
      }
      if (fillFieldByLabel(label, specific.value)) {
        filled += 1;
      } else if (checkListFasterSuggestion(label, specific.value)) {
        filled += 1;
      }
    });
    log(`Item specifics filled/checked: ${filled}.`);
  }

  function fillFieldByLabel(label, value) {
    const field = findFieldByLabel(label);
    if (!field || isProtectedField(field)) {
      return false;
    }

    if (field.tagName === "SELECT") {
      selectByText(field, [value]);
      return true;
    }

    if (field.matches("input[type='checkbox'], input[type='radio']")) {
      if (!field.checked) {
        field.click();
      }
      return true;
    }

    if (field.getAttribute("role") === "combobox" || field.matches("input, textarea")) {
      setNativeValue(field, value);
      const suggestion = findButtonByText([value]);
      if (suggestion && isNear(field, suggestion)) {
        suggestion.click();
      }
      return true;
    }

    if (field.isContentEditable) {
      field.textContent = value;
      dispatchAll(field);
      return true;
    }

    return false;
  }

  function checkListFasterSuggestion(label, value) {
    const terms = [label, value].map((item) => String(item || "").toLowerCase()).filter(Boolean);
    const checkboxes = [...document.querySelectorAll("input[type='checkbox']")].filter(isVisible);
    for (const checkbox of checkboxes) {
      const text = labelTextFor(checkbox).toLowerCase();
      if (terms.every((term) => text.includes(term)) || terms.some((term) => term.length > 3 && text.includes(term))) {
        if (!checkbox.checked) {
          checkbox.click();
        }
        return true;
      }
    }
    return false;
  }

  async function uploadImages() {
    const selectedImages = (product.images || []).filter((image) => image.selected !== false && image.url).slice(0, 12);
    if (!selectedImages.length) {
      log("No selected images to upload.");
      return;
    }

    const files = [];
    for (const [index, image] of selectedImages.entries()) {
      try {
        const file = await imageUrlToFile(image.url, `am-ebay-image-${index + 1}.jpg`);
        files.push(file);
      } catch (error) {
        log(`Image fetch failed: ${image.url}`);
      }
    }

    if (!files.length) {
      log("No image files were prepared.");
      return;
    }

    const fileInput = [...document.querySelectorAll("input[type='file']")].find((input) => !input.disabled);
    if (fileInput) {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      fileInput.files = transfer.files;
      dispatchAll(fileInput);
      log(`Assigned ${files.length} files to eBay photo input.`);
      return;
    }

    const dropTarget = findDropTarget();
    if (dropTarget) {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      ["dragenter", "dragover", "drop"].forEach((type) => {
        dropTarget.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        }));
      });
      log(`Dropped ${files.length} files onto eBay uploader.`);
      return;
    }

    log("No eBay photo input or drag/drop target found.");
  }

  async function imageUrlToFile(url, fallbackName) {
    let response;
    try {
      response = await fetch(url, { credentials: "omit", cache: "force-cache" });
    } catch (error) {
      const proxied = await sendRuntime({ type: "FETCH_IMAGE", url });
      const blob = dataUrlToBlob(proxied.dataUrl);
      return new File([blob], fallbackName, { type: blob.type || proxied.mimeType || "image/jpeg" });
    }

    if (!response.ok) {
      const proxied = await sendRuntime({ type: "FETCH_IMAGE", url });
      const blob = dataUrlToBlob(proxied.dataUrl);
      return new File([blob], fallbackName, { type: blob.type || proxied.mimeType || "image/jpeg" });
    }

    const blob = await response.blob();
    return new File([blob], fileNameFromUrl(url, fallbackName), { type: blob.type || "image/jpeg" });
  }

  function dataUrlToBlob(dataUrl) {
    const [header, base64] = String(dataUrl || "").split(",");
    const mime = (header.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bytes = atob(base64 || "");
    const chunks = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      chunks[index] = bytes.charCodeAt(index);
    }
    return new Blob([chunks], { type: mime });
  }

  function findDropTarget() {
    return [...document.querySelectorAll("[class*='photo' i], [class*='upload' i], [data-testid*='photo' i], [role='button']")]
      .filter(isVisible)
      .find((node) => /photo|upload|drag|drop|image/i.test(textOf(node) || node.getAttribute("aria-label") || ""));
  }

  function debugVariationStatus() {
    const formatSelect = document.querySelector("select[name='format']");
    const section = findVariationSection();
    const editor = findVariationEditorContainer();
    return {
      variationSectionFound: Boolean(section),
      buyItNowActive: Boolean(formatSelect && formatSelect.value === "FixedPrice"),
      formatSelectValue: formatSelect ? formatSelect.value : "",
      formatFixedPriceSelected: Boolean(formatSelect && formatSelect.querySelector("option[value='FixedPrice']:checked")),
      warningVisible: section ? /only available for buy it now|auction/i.test(textOf(section)) : false,
      editorOpened: Boolean(editor),
      iframesFound: document.querySelectorAll("iframe").length,
      dialogsFound: document.querySelectorAll("[role='dialog'], dialog, [class*='drawer' i], [class*='modal' i]").length,
      editorInputs: editor ? editor.querySelectorAll("input, textarea, select, [contenteditable='true']").length : 0,
      editorButtons: editor ? [...editor.querySelectorAll("button, [role='button']")].map(textOf).filter(Boolean).slice(0, 40) : []
    };
  }

  async function debugFields() {
    const frames = findAccessibleFrames();
    const formatSelect = document.querySelector("select[name='format']");
    const visibleFormat = closestByText(document.querySelectorAll(".se-field, fieldset, section, div"), "format");
    const variationStatus = debugVariationStatus();
    const inputs = [...document.querySelectorAll("input, textarea, [contenteditable='true']")]
      .filter(isVisible)
      .slice(0, 200)
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        name: node.getAttribute("name") || "",
        ariaLabel: node.getAttribute("aria-label") || "",
        placeholder: node.getAttribute("placeholder") || "",
        id: node.id || "",
        value: node.isContentEditable ? textOf(node).slice(0, 80) : String(node.value || "").slice(0, 80)
      }));
    const buttons = [...document.querySelectorAll("button, [role='button']")]
      .filter(isVisible)
      .slice(0, 200)
      .map((button) => textOf(button) || button.getAttribute("aria-label") || button.value || "");
    const selects = [...document.querySelectorAll("select")]
      .map((select) => ({
        name: select.name,
        value: select.value,
        options: [...select.options].map((option) => `${option.value}:${option.textContent.trim()}`).slice(0, 20)
      }));
    const fileInputs = [...document.querySelectorAll("input[type='file']")]
      .map((input) => ({
        name: input.name,
        id: input.id,
        accept: input.accept,
        multiple: input.multiple
      }));
    const iframeFields = frames.map((frame, index) => ({
      index,
      url: frame.location,
      inputs: frame.document.querySelectorAll("input, textarea, select, [contenteditable='true']").length
    }));

    return JSON.stringify({
      currentUrl: location.href,
      extensionVersion: VERSION,
      productTitle: product.title || "",
      scrapedPrice: product.price || product.priceText || "",
      imagesCount: (product.images || []).length,
      variationsCount: (product.variations || []).length,
      specsCount: (product.itemSpecifics || []).length,
      formatSelectStatus: {
        exists: Boolean(formatSelect),
        currentValue: formatSelect ? formatSelect.value : "",
        visibleLabel: visibleFormat ? textOf(visibleFormat).slice(0, 120) : "",
        fixedPriceSelected: Boolean(formatSelect && formatSelect.querySelector("option[value='FixedPrice']:checked"))
      },
      variationStatus,
      inputs,
      buttons,
      selects,
      fileInputs,
      iframeCount: document.querySelectorAll("iframe").length,
      accessibleIframeFields: iframeFields
    }, null, 2);
  }

  function findVariationSection() {
    const selectors = [
      ".summary__variations",
      "[_track*='VARIATIONS' i]",
      "[data-testid*='variation' i]",
      "[class*='variation' i]"
    ];
    const direct = selectors.map((selector) => document.querySelector(selector)).find(Boolean);
    if (direct) {
      return direct;
    }
    const heading = [...document.querySelectorAll("h1, h2, h3, legend, button, a")]
      .find((node) => /^variations?$/i.test(textOf(node)));
    return heading ? heading.closest("section, div, fieldset") || heading : null;
  }

  function findVariationEditorContainer() {
    const containers = [
      ...document.querySelectorAll("[role='dialog'], dialog, [class*='drawer' i], [class*='modal' i], [class*='variation' i]")
    ].filter(isVisible);
    return containers
      .filter((node) => /variation|option|sku|price|quantity|done|save|generate/i.test(textOf(node)))
      .sort((a, b) => b.querySelectorAll("input, textarea, select, button, [contenteditable='true']").length -
        a.querySelectorAll("input, textarea, select, button, [contenteditable='true']").length)[0] || null;
  }

  function findFieldByLabel(label) {
    const normalized = normalizeText(label);
    const candidates = [...document.querySelectorAll("input, textarea, select, [contenteditable='true']")]
      .filter(isVisible)
      .filter((field) => !field.disabled);

    return candidates.find((field) => {
      const labelText = normalizeText(labelTextFor(field));
      return Boolean(labelText) && (labelText === normalized || labelText.includes(normalized) || normalized.includes(labelText));
    }) || candidates.find((field) => {
      const attrs = normalizeText([
        field.getAttribute("name"),
        field.getAttribute("aria-label"),
        field.getAttribute("placeholder"),
        field.id
      ].filter(Boolean).join(" "));
      return Boolean(attrs) && attrs.includes(normalized);
    });
  }

  function labelTextFor(field) {
    const parts = [
      field.getAttribute("aria-label"),
      field.getAttribute("placeholder")
    ];
    if (field.id) {
      const label = document.querySelector(`label[for="${cssEscape(field.id)}"]`);
      if (label) {
        parts.push(textOf(label));
      }
    }
    const wrappingLabel = field.closest("label");
    if (wrappingLabel) {
      parts.push(textOf(wrappingLabel));
    }
    const row = field.closest(".se-field, .field, [class*='field' i], [class*='specific' i], tr, li, section, div");
    if (row) {
      parts.push(textOf(row).slice(0, 180));
    }
    return parts.filter(Boolean).join(" ");
  }

  function isProtectedField(field) {
    const label = normalizeText(labelTextFor(field));
    return [...PROTECTED_SPECIFIC_LABELS].some((protectedLabel) => label === protectedLabel || label.includes(protectedLabel));
  }

  function findFirst(selectors, predicate = () => true) {
    for (const selector of selectors) {
      const found = [...document.querySelectorAll(selector)].find((node) => isVisible(node) && predicate(node));
      if (found) {
        return found;
      }
    }
    return null;
  }

  function findButtonByText(terms) {
    const lowerTerms = terms.map((term) => String(term).toLowerCase());
    return [...document.querySelectorAll("button, [role='button'], a")]
      .filter(isVisible)
      .find((button) => {
        const text = `${textOf(button)} ${button.getAttribute("aria-label") || ""} ${button.value || ""}`.toLowerCase();
        return lowerTerms.some((term) => text.includes(term));
      });
  }

  function closestByText(nodes, term) {
    const lower = String(term || "").toLowerCase();
    return [...nodes].filter(isVisible).find((node) => textOf(node).toLowerCase().includes(lower));
  }

  function selectByText(select, values) {
    const lowerValues = values.map((value) => String(value || "").toLowerCase());
    const option = [...select.options].find((item) => {
      const text = `${item.textContent} ${item.value}`.toLowerCase();
      return lowerValues.some((value) => text.includes(value) || value.includes(text.trim()));
    });
    if (option) {
      select.value = option.value;
      option.selected = true;
      dispatchAll(select);
    }
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
    } else {
      element.value = value;
    }
    dispatchAll(element);
  }

  function dispatchAll(element) {
    ["input", "change", "blur"].forEach((type) => {
      element.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }

  function normalizeSpecifics(specifics) {
    return specifics.map((specific) => ({
      name: normalizeSpecificName(specific.name),
      value: String(specific.value || "").trim()
    })).filter((specific) => specific.name && specific.value);
  }

  function normalizeSpecificName(name) {
    const lower = String(name || "").trim().toLowerCase();
    return SPECIFIC_LABEL_MAP.get(lower) || titleCase(name);
  }

  function variantsToTsv(source) {
    const dimensions = variationDimensions(source);
    const header = ["SKU", ...dimensions, "Price", "Quantity", "Image"];
    const rows = (source.variations || [])
      .filter((variation) => variation.selected !== false)
      .map((variation) => [
        variation.sku || "",
        ...dimensions.map((dimension) => (variation.options || {})[dimension] || ""),
        variation.price || source.price || "",
        variation.quantity || source.quantity || "",
        variation.image || ""
      ]);
    return [header, ...rows]
      .map((row) => row.map((cell) => String(cell || "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t"))
      .join("\n");
  }

  function variationDimensions(source) {
    return [...new Set([
      ...(source.variationDimensions || []),
      ...(source.variations || []).flatMap((variation) => Object.keys(variation.options || {}))
    ].map((name) => String(name || "").trim()).filter(Boolean))];
  }

  function looksLikeSellStartPage() {
    return /\/sl\/sell|\/sell/i.test(location.pathname) && !/AddItem|lstng/i.test(location.href);
  }

  function findAccessibleFrames() {
    return [...document.querySelectorAll("iframe")].map((iframe) => {
      try {
        return {
          location: iframe.contentWindow.location.href,
          document: iframe.contentDocument
        };
      } catch (error) {
        return null;
      }
    }).filter(Boolean);
  }

  function isVisible(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isNear(a, b) {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return Math.abs(ar.top - br.top) < 180 && Math.abs(ar.left - br.left) < 600;
  }

  function textOf(node) {
    return node ? String(node.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      .replace(/\bLed\b/g, "LED")
      .replace(/\bRgb\b/g, "RGB");
  }

  function fileNameFromUrl(url, fallback) {
    try {
      const name = new URL(url).pathname.split("/").filter(Boolean).pop();
      return name && /\.[a-z0-9]+$/i.test(name) ? name : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function waitFor(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function copyText(value) {
    await navigator.clipboard.writeText(value || "");
  }

  async function sendRuntime(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.ok === false) {
      throw new Error((response && response.error) || "Extension request failed.");
    }
    return response;
  }

  function ensureVariationBuilder() {
    if (!window.AmEbayVariationWatcher || !window.AmEbayVariationWatcher.buildVariations) {
      throw new Error("Variation watcher script is not loaded.");
    }
    return window.AmEbayVariationWatcher;
  }

  function log(message) {
    const text = typeof message === "string" ? message : JSON.stringify(message, null, 2);
    logs.push(`[${new Date().toLocaleTimeString()}] ${text}`);
    logs = logs.slice(-80);
    renderLogs();
  }

  function renderLogs() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) {
      return;
    }
    const target = panel.querySelector("[data-role='logs']");
    if (target) {
      target.textContent = logs.join("\n");
      target.scrollTop = target.scrollHeight;
    }
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) {
      return CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  window.AmEbayAssistant = {
    VERSION,
    log,
    setBuyItNow,
    debugVariationStatus,
    findVariationSection,
    findVariationEditorContainer,
    variantsToTsv,
    variationDimensions,
    findButtonByText,
    setNativeValue,
    dispatchAll,
    isVisible,
    textOf,
    waitFor
  };
})();
