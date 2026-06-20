(function initEbayAutofill() {
  if (window.__amEbayAutofillLoaded) return;
  window.__amEbayAutofillLoaded = true;

  const state = {
    product: null,
    defaults: {},
    logs: [],
    busy: false,
    stopRequested: false,
    version: ""
  };

  const protectedSpecificLabels = [
    "title",
    "subtitle",
    "sku",
    "custom label",
    "price",
    "quantity",
    "format",
    "shipping policy",
    "payment policy",
    "return policy"
  ];

  createPanel();
  loadProduct().then(() => updatePanelTitle()).catch((error) => log(`Load product failed: ${error.message}`));

  window.__amEbayAssistant = {
    loadProduct,
    log,
    setBuyItNow,
    buildVariations,
    fillCurrentVariationEditor,
    detectVariationEditor,
    buildVariationTsv,
    getProduct: () => state.product,
    requestStop: () => {
      state.stopRequested = true;
      log("Stop requested.");
    }
  };

  async function loadProduct() {
    const [productResponse, infoResponse] = await Promise.all([
      sendMessage({ type: "GET_PRODUCT" }),
      sendMessage({ type: "GET_EXTENSION_INFO" })
    ]);
    if (!productResponse.ok) throw new Error(productResponse.error || "Extension is locked or product is unavailable.");
    state.product = normalizeProduct(productResponse.product || {});
    state.defaults = productResponse.defaults || {};
    state.version = infoResponse.ok ? infoResponse.version : "";
    updatePanelTitle();
    return state.product;
  }

  function normalizeProduct(product) {
    const variationDimensions = (product.variationDimensions || []).map((dimension) => ({
      name: typeof dimension === "string" ? dimension : dimension.name
    })).filter((dimension) => dimension.name);
    return {
      title: product.title || "",
      descriptionHtml: product.descriptionHtml || product.description || "",
      price: product.price || "",
      quantity: Number(product.quantity || 1),
      skuPrefix: product.skuPrefix || "AX",
      condition: product.condition || "New",
      specifications: product.specifications || {},
      images: (product.images || []).map((image) => typeof image === "string" ? { url: image, selected: true } : image).filter((image) => image.url),
      variations: (product.variations || []).map((variation, index) => ({
        selected: variation.selected !== false,
        sku: variation.sku || `${product.skuPrefix || "AX"}-${index + 1}`,
        options: variation.options || {},
        price: variation.price || product.price || "",
        quantity: Number(variation.quantity || product.quantity || 1),
        imageUrl: variation.imageUrl || variation.image || ""
      })),
      variationDimensions
    };
  }

  function createPanel() {
    if (document.getElementById("am-ebay-panel")) return;
    const panel = document.createElement("aside");
    panel.id = "am-ebay-panel";
    panel.innerHTML = `
      <style>
        #am-ebay-panel {
          position: fixed;
          top: 88px;
          right: 16px;
          z-index: 2147483647;
          width: 330px;
          max-height: calc(100vh - 110px);
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px;
          border: 1px solid #d0d5dd;
          border-radius: 14px;
          background: #fff;
          color: #172033;
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.18);
          font: 13px Arial, Helvetica, sans-serif;
        }
        #am-ebay-panel * { box-sizing: border-box; }
        #am-ebay-panel h2 {
          margin: 0;
          font-size: 15px;
          line-height: 1.25;
        }
        #am-ebay-panel .ame-title {
          color: #667085;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #am-ebay-panel .ame-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        #am-ebay-panel button {
          min-height: 32px;
          cursor: pointer;
          border: 0;
          border-radius: 8px;
          background: #1d4ed8;
          color: white;
          padding: 7px 8px;
          font: 700 12px Arial, Helvetica, sans-serif;
        }
        #am-ebay-panel button.secondary {
          background: #eef2ff;
          color: #1e3a8a;
        }
        #am-ebay-panel button.danger {
          background: #fee4e2;
          color: #b42318;
        }
        #am-ebay-panel .ame-log {
          min-height: 140px;
          max-height: 280px;
          overflow: auto;
          padding: 8px;
          border-radius: 8px;
          background: #0f172a;
          color: #dbeafe;
          white-space: pre-wrap;
          font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
      </style>
      <h2>AM eBay Listing Assistant</h2>
      <div id="ame-current-title" class="ame-title">Loading product...</div>
      <div class="ame-grid">
        <button data-action="autoStart">Auto Start</button>
        <button data-action="fillNow">Fill Now</button>
        <button data-action="setBuyItNow">Set Buy It Now</button>
        <button data-action="buildVariations">Build Variations</button>
        <button data-action="uploadImages">Upload Images</button>
        <button data-action="copyTitle" class="secondary">Copy Title</button>
        <button data-action="copyDescription" class="secondary">Copy Description</button>
        <button data-action="copyVariants" class="secondary">Copy Variants</button>
        <button data-action="debugFields" class="secondary">Debug Fields</button>
        <button data-action="stop" class="danger">Stop</button>
      </div>
      <div id="ame-log" class="ame-log" aria-live="polite"></div>
    `;
    panel.addEventListener("click", handlePanelClick);
    document.documentElement.appendChild(panel);
    log("Panel ready. Final List it submit remains manual.");
  }

  async function handlePanelClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "stop") {
      state.stopRequested = true;
      log("Stop requested.");
      return;
    }

    try {
      state.stopRequested = false;
      state.busy = true;
      if (!state.product) await loadProduct();
      if (action === "autoStart") await autoStart();
      if (action === "fillNow") await fillNow();
      if (action === "setBuyItNow") await setBuyItNow();
      if (action === "buildVariations") await buildVariations();
      if (action === "uploadImages") await uploadImages();
      if (action === "copyTitle") await copyToClipboard(state.product.title || "", "Title copied.");
      if (action === "copyDescription") await copyToClipboard(state.product.descriptionHtml || "", "Description copied.");
      if (action === "copyVariants") await copyToClipboard(buildVariationTsv(), "Variants copied as TSV.");
      if (action === "debugFields") await debugFields();
    } catch (error) {
      log(`Error: ${error.message || error}`);
    } finally {
      state.busy = false;
    }
  }

  async function autoStart() {
    await loadProduct();
    log("Auto Start: filling entry title/search flow.");
    const titleFilled = fillFirst([
      "input[name='title']",
      "input[name*='title' i]",
      "input[aria-label*='title' i]",
      "input[placeholder*='title' i]",
      "textarea[name*='title' i]"
    ], state.product.title);
    if (titleFilled) log("Entered title.");

    const searchButton = findButtonByText(/search|start|continue|create listing|list it/i, /final|submit|publish/i);
    if (searchButton) {
      searchButton.click();
      log(`Clicked ${buttonText(searchButton)}.`);
    }

    const withoutMatch = await waitFor(() => findButtonByText(/continue without match|without match|skip match/i), 8000);
    if (withoutMatch) {
      withoutMatch.click();
      log("Clicked Continue without match.");
    } else {
      log("No product match prompt detected.");
    }
  }

  async function fillNow() {
    await loadProduct();
    log("Fill Now started.");
    await setBuyItNow();
    fillTitleAndSku();
    fillPricingAndQuantity();
    fillCondition();
    fillDescription();
    fillItemSpecifics();
    fillPolicies();
    log("Fill Now complete. Review before manual final listing.");
  }

  function fillTitleAndSku() {
    const titleOk = fillFirst([
      "input[name='title']",
      "textarea[name='title']",
      "input[aria-label='Title']",
      "textarea[aria-label='Title']"
    ], state.product.title, { overwrite: true });
    log(titleOk ? "Title filled." : "Title field not found.");

    const sku = state.product.variations.length ? state.product.skuPrefix : `${state.product.skuPrefix || "AX"}-1`;
    const skuOk = fillFirst([
      "input[name='customLabel']",
      "input[name*='customLabel' i]",
      "input[name*='sku' i]",
      "input[aria-label*='custom label' i]",
      "input[placeholder*='custom label' i]"
    ], sku, { overwrite: true });
    log(skuOk ? "Custom label/SKU filled." : "Custom label/SKU field not found.");
  }

  function fillPricingAndQuantity() {
    const priceOk = fillFirst([
      "input[name='price']",
      "input[name*='price' i]",
      "input[aria-label*='price' i]"
    ], cleanMoney(state.product.price), { overwrite: true, onlyVisible: false });
    log(priceOk ? "Buy It Now price filled." : "Price field not found.");

    if (!state.product.variations.length) {
      const quantityOk = fillFirst([
        "input[name='quantity']",
        "input[name*='quantity' i]",
        "input[aria-label*='quantity' i]"
      ], String(state.product.quantity || 1), { overwrite: true, onlyVisible: false });
      log(quantityOk ? "Quantity filled." : "Quantity field not found or variation quantity expected.");
    } else {
      log("Variation product detected; quantity should be filled per variation row.");
    }
  }

  function fillCondition() {
    const condition = state.product.condition || state.defaults.condition || "New";
    if (selectOptionByLabel("condition", condition) || clickControlByLabel(/condition/i, condition)) {
      log(`Condition set to ${condition}.`);
    } else {
      log("Condition control not found.");
    }
  }

  function fillDescription() {
    const html = state.product.descriptionHtml || "";
    if (!html) return;
    const textarea = firstVisible(queryAllDeep("textarea[name*='description' i], textarea[aria-label*='description' i]"));
    if (textarea) {
      setFieldValue(textarea, html);
      log("Description textarea filled.");
      return;
    }

    const editable = firstVisible(queryAllDeep("[contenteditable='true'], [role='textbox']"))
      || findAccessibleIframeEditor();
    if (editable) {
      if (editable.ownerDocument && editable.ownerDocument.body === editable) {
        editable.innerHTML = html;
      } else {
        editable.innerHTML = html;
      }
      editable.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertHTML", data: html }));
      editable.dispatchEvent(new Event("change", { bubbles: true }));
      log("Rich description editor filled.");
      return;
    }

    log("Description editor not found.");
  }

  function fillItemSpecifics() {
    const specs = normalizeSpecifics(state.product.specifications || {});
    let filled = 0;
    Object.entries(specs).forEach(([label, value]) => {
      if (!value || isProtectedSpecific(label)) return;
      if (fillSpecificByLabel(label, value)) filled += 1;
    });
    filled += checkListFasterSuggestions(specs);
    log(`Item specifics filled/checked: ${filled}.`);
  }

  function normalizeSpecifics(specs) {
    const normalized = {};
    const mappings = [
      [/^brand/i, "Brand"],
      [/material/i, "Material"],
      [/features?/i, "Features"],
      [/compatible\s+brand/i, "Compatible Brand"],
      [/compatible\s+model|phone\s+model/i, "Compatible Model"],
      [/colou?r/i, "Colour"],
      [/design|finish/i, "Design/Finish"],
      [/length/i, "Length"],
      [/size/i, "Size"],
      [/^type/i, "Type"],
      [/^model/i, "Model"],
      [/connectivity/i, "Connectivity"],
      [/control\s+style/i, "Control Style"],
      [/lighting\s+technology/i, "Lighting Technology"],
      [/sensor\s+type/i, "Sensor Type"]
    ];
    Object.entries(specs).forEach(([name, value]) => {
      const mapped = mappings.find(([pattern]) => pattern.test(name));
      normalized[mapped ? mapped[1] : cleanText(name)] = cleanText(value);
    });
    return normalized;
  }

  function fillSpecificByLabel(label, value) {
    if (selectOptionByLabel(label, value)) return true;
    if (fillByNearbyLabel(label, value)) return true;
    if (clickControlByLabel(new RegExp(escapeRegExp(label), "i"), value)) return true;
    return false;
  }

  function fillByNearbyLabel(labelText, value) {
    const labels = queryAllDeep("label, div, span, dt, legend").filter((node) => {
      const label = cleanText(node.textContent);
      return label && label.length < 80 && labelMatches(label, labelText);
    });

    for (const label of labels) {
      const field = findFieldNear(label);
      if (field && !isProtectedField(field)) {
        setFieldValue(field, value);
        return true;
      }
    }
    return false;
  }

  function selectOptionByLabel(labelText, value) {
    const selects = queryAllDeep("select").filter((select) => {
      const descriptor = [
        select.name,
        select.id,
        select.getAttribute("aria-label"),
        cleanText(select.closest("div, section, li, tr")?.textContent || "")
      ].join(" ");
      return labelMatches(descriptor, labelText);
    });

    for (const select of selects) {
      if (isProtectedField(select) && !/condition/i.test(labelText)) continue;
      const option = Array.from(select.options).find((candidate) => {
        const optionText = cleanText(candidate.textContent || candidate.label || candidate.value);
        return optionText.toLowerCase() === String(value).toLowerCase()
          || optionText.toLowerCase().includes(String(value).toLowerCase())
          || String(value).toLowerCase().includes(optionText.toLowerCase());
      });
      if (option) {
        select.value = option.value;
        option.selected = true;
        dispatchFieldEvents(select);
        return true;
      }
    }
    return false;
  }

  function clickControlByLabel(labelRegex, value) {
    const valueRegex = new RegExp(escapeRegExp(String(value)), "i");
    const controls = queryAllDeep("button, [role='button'], [role='option'], label").filter((node) => {
      const combined = cleanText(node.textContent || node.getAttribute("aria-label") || "");
      return valueRegex.test(combined) && labelRegex.test(cleanText(node.closest("div, section, li, tr")?.textContent || combined));
    });
    const control = firstVisible(controls);
    if (control) {
      control.click();
      return true;
    }
    return false;
  }

  function checkListFasterSuggestions(specs) {
    let checked = 0;
    const wanted = `${Object.values(specs).join(" ")} ${state.product.title}`.toLowerCase();
    queryAllDeep("input[type='checkbox']").forEach((checkbox) => {
      if (checkbox.checked) return;
      const label = cleanText(checkbox.closest("label, div, li")?.textContent || "");
      if (!label || label.length > 160) return;
      const meaningfulWords = label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
      if (meaningfulWords.some((word) => wanted.includes(word))) {
        checkbox.checked = true;
        dispatchFieldEvents(checkbox);
        checked += 1;
      }
    });
    return checked;
  }

  function fillPolicies() {
    const policies = [
      ["Shipping policy", state.defaults.shippingPolicy],
      ["Payment policy", state.defaults.paymentPolicy]
    ];
    policies.forEach(([label, value]) => {
      if (!value) return;
      if (selectOptionByLabel(label, value) || clickControlByLabel(new RegExp(escapeRegExp(label), "i"), value)) {
        log(`${label} set.`);
      }
    });
  }

  async function setBuyItNow() {
    log("Setting pricing format to Buy It Now / Fixed Price.");
    const select = queryAllDeep("select[name='format']").find(Boolean);
    if (select) {
      const fixedOption = Array.from(select.options).find((option) => option.value === "FixedPrice");
      select.value = "FixedPrice";
      if (fixedOption) fixedOption.selected = true;
      dispatchFieldEvents(select);
      select.dispatchEvent(new Event("blur", { bubbles: true }));
      log(`Format select set to ${select.value}.`);
    } else {
      log("select[name=format] not found.");
    }

    await clickVisibleFormatOption();
    await delay(700);
    const status = getFormatStatus();
    log(`Buy It Now active: ${status.fixedPriceSelected ? "yes" : "no"}; current value: ${status.value || "missing"}.`);
    return status.fixedPriceSelected;
  }

  async function clickVisibleFormatOption() {
    const section = findFormatSection();
    const button = section
      ? firstVisible(Array.from(section.querySelectorAll("button, [role='button']")))
      : findButtonByText(/auction|format|buy it now|fixed price/i);
    if (!button) return false;

    button.click();
    await delay(250);
    const option = findButtonByText(/buy it now|fixed price/i, /optional|duration/i)
      || firstVisible(queryAllDeep("[role='option'], li, button").filter((node) => /buy it now|fixed price/i.test(cleanText(node.textContent))));
    if (option) {
      option.click();
      log("Clicked visible Buy It Now/Fixed Price option.");
      return true;
    }
    return false;
  }

  function findFormatSection() {
    return document.querySelector(".se-field.format")
      || queryAllDeep("div, section, li").find((node) => {
        const label = cleanText(node.textContent);
        return label.length < 300 && /format/i.test(label) && /auction|buy it now|fixed price/i.test(label);
      });
  }

  async function uploadImages() {
    await loadProduct();
    const selectedImages = state.product.images.filter((image) => image.selected !== false).slice(0, 12);
    if (!selectedImages.length) {
      log("No selected images to upload.");
      return false;
    }

    const fileInput = findPhotoFileInput();
    if (!fileInput) {
      log("Photo file input not found; drag/drop fallback will be attempted if drop zone exists.");
    }

    const files = [];
    for (const image of selectedImages) {
      if (state.stopRequested) return false;
      try {
        const file = await remoteImageToFile(image.url, files.length + 1);
        files.push(file);
        log(`Prepared image ${files.length}: ${file.name}`);
      } catch (error) {
        log(`Image fetch failed: ${image.url} (${error.message})`);
      }
    }

    if (!files.length) {
      log("No images could be converted to files.");
      return false;
    }

    const dataTransfer = new DataTransfer();
    files.forEach((file) => dataTransfer.items.add(file));

    if (fileInput) {
      fileInput.files = dataTransfer.files;
      dispatchFieldEvents(fileInput);
      log(`Assigned ${files.length} image files to uploader input.`);
      return true;
    }

    const dropZone = findPhotoDropZone();
    if (dropZone) {
      ["dragenter", "dragover", "drop"].forEach((type) => {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer
        });
        dropZone.dispatchEvent(event);
      });
      log(`Dispatched drop event with ${files.length} image files.`);
      return true;
    }

    log("Image upload fallback unavailable. No download prompt was opened.");
    return false;
  }

  function findPhotoFileInput() {
    const inputs = queryAllDeep("input[type='file']").filter((input) => {
      const descriptor = [
        input.name,
        input.id,
        input.accept,
        input.getAttribute("aria-label"),
        cleanText(input.closest("section, div, li")?.textContent || "")
      ].join(" ");
      return /image|photo|picture|jpg|jpeg|png|file/i.test(descriptor);
    });
    return inputs[0] || queryAllDeep("input[type='file']")[0] || null;
  }

  function findPhotoDropZone() {
    return firstVisible(queryAllDeep("[data-testid*='photo' i], [class*='photo' i], [class*='upload' i], [aria-label*='photo' i], [aria-label*='upload' i]"));
  }

  async function remoteImageToFile(url, index) {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      cache: "force-cache"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const extension = mimeToExtension(blob.type) || extensionFromUrl(url) || "jpg";
    return new File([blob], `am-ebay-image-${index}.${extension}`, {
      type: blob.type || `image/${extension === "jpg" ? "jpeg" : extension}`,
      lastModified: Date.now()
    });
  }

  function mimeToExtension(type) {
    if (/jpeg/i.test(type)) return "jpg";
    if (/png/i.test(type)) return "png";
    if (/webp/i.test(type)) return "webp";
    return "";
  }

  function extensionFromUrl(url) {
    const match = String(url).match(/\.(jpg|jpeg|png|webp)(?:$|\?)/i);
    return match ? match[1].toLowerCase().replace("jpeg", "jpg") : "";
  }

  async function buildVariations() {
    await loadProduct();
    if (!state.product.variations.length) {
      log("No variation rows in product data.");
      return false;
    }

    state.stopRequested = false;
    await setBuyItNow();
    const formatStatus = getFormatStatus();
    if (!formatStatus.fixedPriceSelected) {
      log("Build Variations stopped: FixedPrice format is not active.");
      return false;
    }

    const section = findVariationSection();
    log(`Variation section found: ${section ? "yes" : "no"}.`);
    if (section) clickVariationEntry(section);

    const editor = await waitForVariationEditor(20000);
    if (!editor) {
      log("Variation editor not detected within 20 seconds.");
      logVariationDiagnostics();
      await copyToClipboard(buildVariationTsv(), "Copied variation TSV fallback.");
      log("Watcher mode can continue if you manually open Create/Edit variations.");
      window.dispatchEvent(new CustomEvent("am-ebay-start-variation-watcher"));
      return false;
    }

    log("Variation editor opened.");
    logVariationDiagnostics(editor);
    const directResult = await tryFillVariationEditor(editor);
    if (directResult) {
      log("Variation data inserted. Confirm values in eBay table before clicking Done/Save.");
      return true;
    }

    await copyToClipboard(buildVariationTsv(), "Copied variation TSV fallback.");
    const pasted = await pasteVariationTsv(editor);
    if (pasted) {
      log("Pasted variation TSV into the editor. Confirm generated rows before saving.");
      return true;
    }

    log("Direct variation fill did not complete. TSV is on clipboard for manual paste.");
    return false;
  }

  async function fillCurrentVariationEditor() {
    await loadProduct();
    const editor = detectVariationEditor();
    if (!editor) {
      log("Watcher fill skipped: no variation editor detected.");
      return false;
    }
    log("Watcher detected variation editor. Attempting fill.");
    logVariationDiagnostics(editor);
    const directResult = await tryFillVariationEditor(editor);
    if (directResult) return true;
    await copyToClipboard(buildVariationTsv(), "Copied variation TSV fallback.");
    return pasteVariationTsv(editor);
  }

  function findVariationSection() {
    return document.querySelector(".summary__variations")
      || queryAllDeep("[_track*='VARIATIONS' i], [data-testid*='variation' i], [class*='variation' i]").find((node) => isVisible(node))
      || queryAllDeep("h2, h3, section, div").find((node) => {
        const content = cleanText(node.textContent);
        return content.length < 500 && /variations/i.test(content);
      });
  }

  function clickVariationEntry(section) {
    const edit = Array.from(section.querySelectorAll("button, a, [role='button']")).find((node) => /edit|create|add|variation/i.test(cleanText(node.textContent || node.getAttribute("aria-label"))));
    if (edit) {
      edit.click();
      log(`Clicked variation control: ${buttonText(edit)}.`);
      return;
    }
    section.click();
    log("Clicked variation section.");
  }

  async function waitForVariationEditor(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (state.stopRequested) return null;
      const editor = detectVariationEditor();
      if (editor) return editor;
      await delay(250);
    }
    return null;
  }

  function detectVariationEditor() {
    const contexts = collectEditorContexts();
    return contexts.find((context) => {
      const bodyText = cleanText(context.root.textContent || context.document?.body?.textContent || "");
      const inputCount = context.root.querySelectorAll ? context.root.querySelectorAll("input, textarea, select, [contenteditable='true']").length : 0;
      const buttonCount = context.root.querySelectorAll ? context.root.querySelectorAll("button, [role='button']").length : 0;
      return /variation|option|sku|quantity|price|add value|generate/i.test(bodyText)
        && inputCount > 0
        && buttonCount > 0;
    }) || null;
  }

  function collectEditorContexts() {
    const contexts = [];
    const selectors = [
      "[role='dialog']",
      "[aria-modal='true']",
      "[class*='drawer' i]",
      "[class*='modal' i]",
      "[class*='variation' i]",
      "main",
      "body"
    ];
    queryAllDeep(selectors.join(",")).forEach((root) => {
      if (!isVisible(root)) return;
      contexts.push({
        root,
        document: root.ownerDocument,
        type: root.matches?.("[role='dialog'], [aria-modal='true']") ? "dialog" : "dom"
      });
    });

    Array.from(document.querySelectorAll("iframe")).forEach((iframe) => {
      try {
        const doc = iframe.contentDocument;
        if (doc?.body) contexts.push({ root: doc.body, document: doc, type: "iframe", iframe });
      } catch (error) {
        contexts.push({ root: iframe, document, type: "iframe-blocked", iframe });
      }
    });
    return contexts;
  }

  async function tryFillVariationEditor(editor) {
    const product = state.product;
    const dimensions = product.variationDimensions.length
      ? product.variationDimensions
      : inferDimensions(product.variations);
    log(`Attempting direct variation fill with ${dimensions.length} dimensions and ${product.variations.length} rows.`);

    for (const dimension of dimensions) {
      if (state.stopRequested) return false;
      const values = unique(product.variations.map((row) => row.options[dimension.name]).filter(Boolean));
      if (!values.length) continue;
      await addDimensionValues(editor, dimension.name, values);
    }

    await clickEditorButton(editor, /generate variations|create variations|continue|next/i);
    await delay(1000);
    const tableFilled = await fillVariationTable(editor);
    return tableFilled || editorContainsVariationData(editor);
  }

  async function addDimensionValues(editor, dimensionName, values) {
    const addOptionButton = findEditorButton(editor, /add option|add variation|add detail|create option/i);
    if (addOptionButton) {
      addOptionButton.click();
      await delay(300);
    }

    const inputs = visibleFields(editor.root).filter((field) => /text|search|^$/i.test(field.type || "") || field.isContentEditable);
    const emptyInput = inputs.find((input) => !input.value && !input.textContent);
    if (emptyInput) {
      setFieldValue(emptyInput, dimensionName);
      log(`Entered dimension: ${dimensionName}.`);
    }

    for (const value of values) {
      if (state.stopRequested) return;
      const addValueButton = findEditorButton(editor, /add value|add option value|add/i);
      if (addValueButton) {
        addValueButton.click();
        await delay(150);
      }
      const target = visibleFields(editor.root)
        .filter((field) => /text|search|^$/i.test(field.type || "") || field.isContentEditable)
        .find((field) => !cleanText(field.value || field.textContent));
      if (target) {
        setFieldValue(target, value);
        log(`Entered ${dimensionName}: ${value}.`);
      }
    }
  }

  async function fillVariationTable(editor) {
    const rows = state.product.variations.filter((row) => row.selected !== false);
    const fields = visibleFields(editor.root);
    const skuFields = fields.filter((field) => /sku|custom/i.test(describeField(field)));
    const priceFields = fields.filter((field) => /price/i.test(describeField(field)));
    const qtyFields = fields.filter((field) => /qty|quantity|available/i.test(describeField(field)));
    let filled = 0;

    rows.forEach((row, index) => {
      if (skuFields[index]) {
        setFieldValue(skuFields[index], row.sku);
        filled += 1;
      }
      if (priceFields[index]) {
        setFieldValue(priceFields[index], cleanMoney(row.price));
        filled += 1;
      }
      if (qtyFields[index]) {
        setFieldValue(qtyFields[index], String(row.quantity || 1));
        filled += 1;
      }
    });

    log(`Variation table direct fields filled: ${filled}.`);
    return filled >= Math.min(rows.length, 1);
  }

  async function pasteVariationTsv(editor) {
    const tsv = buildVariationTsv();
    const target = firstVisible([
      ...visibleFields(editor.root),
      ...Array.from(editor.root.querySelectorAll("[contenteditable='true'], td, [role='gridcell']"))
    ]);
    if (!target) {
      log("No paste target found in variation editor.");
      return false;
    }

    target.focus();
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", tsv);
    clipboard.setData("text/tab-separated-values", tsv);
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard
    });
    const accepted = target.dispatchEvent(pasteEvent);
    if (accepted && target.tagName && /input|textarea/i.test(target.tagName)) {
      setFieldValue(target, tsv);
    }
    await delay(500);
    return editorContainsVariationData(editor);
  }

  function editorContainsVariationData(editor) {
    const editorText = cleanText(editor.root.textContent || "");
    const selectedRows = state.product.variations.filter((row) => row.selected !== false);
    const sample = selectedRows.slice(0, 3);
    return sample.some((row) => editorText.includes(row.sku))
      || sample.some((row) => Object.values(row.options || {}).some((value) => value && editorText.includes(value)));
  }

  function buildVariationTsv() {
    const product = state.product || { variations: [], variationDimensions: [] };
    const dimensions = product.variationDimensions.length ? product.variationDimensions : inferDimensions(product.variations);
    const headers = ["SKU", ...dimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image"];
    const rows = product.variations
      .filter((variation) => variation.selected !== false)
      .map((variation) => [
        variation.sku,
        ...dimensions.map((dimension) => variation.options[dimension.name] || ""),
        cleanMoney(variation.price),
        variation.quantity || 1,
        variation.imageUrl || ""
      ]);
    return [headers, ...rows].map((row) => row.join("\t")).join("\n");
  }

  function inferDimensions(variations) {
    const names = [];
    variations.forEach((variation) => {
      Object.keys(variation.options || {}).forEach((name) => {
        if (!names.includes(name)) names.push(name);
      });
    });
    return names.map((name) => ({ name }));
  }

  async function debugFields() {
    await loadProduct();
    const debug = buildDebugSnapshot();
    log(debug);
    await copyToClipboard(debug, "Debug fields copied.");
  }

  function buildDebugSnapshot() {
    const format = getFormatStatus();
    const variationSection = findVariationSection();
    const editor = detectVariationEditor();
    const dialogs = queryAllDeep("[role='dialog'], [aria-modal='true']");
    const iframes = Array.from(document.querySelectorAll("iframe"));
    const inputs = queryAllDeep("input, textarea, [contenteditable='true']").filter(isVisible).slice(0, 160).map((field) => ({
      tag: field.tagName,
      name: field.name || "",
      ariaLabel: field.getAttribute("aria-label") || "",
      placeholder: field.getAttribute("placeholder") || "",
      id: field.id || "",
      value: field.value || cleanText(field.textContent).slice(0, 80)
    }));
    const buttons = queryAllDeep("button, [role='button']").filter(isVisible).slice(0, 160).map(buttonText);
    const selects = queryAllDeep("select").map((select) => ({
      name: select.name || "",
      value: select.value || "",
      selectedText: cleanText(select.selectedOptions?.[0]?.textContent || "")
    }));
    const fileInputs = queryAllDeep("input[type='file']").map((input) => ({
      name: input.name || "",
      id: input.id || "",
      accept: input.accept || "",
      multiple: input.multiple
    }));
    const accessibleIframeFields = [];
    iframes.forEach((iframe, index) => {
      try {
        const doc = iframe.contentDocument;
        accessibleIframeFields.push({
          index,
          accessible: Boolean(doc?.body),
          fields: doc ? Array.from(doc.querySelectorAll("input, textarea, [contenteditable='true']")).length : 0
        });
      } catch (error) {
        accessibleIframeFields.push({ index, accessible: false, fields: 0 });
      }
    });

    return JSON.stringify({
      currentUrl: location.href,
      extensionVersion: state.version,
      productTitle: state.product?.title || "",
      scrapedPrice: state.product?.price || "",
      imagesCount: state.product?.images?.length || 0,
      variationsCount: state.product?.variations?.length || 0,
      specsCount: Object.keys(state.product?.specifications || {}).length,
      formatSelectStatus: format,
      variationSectionStatus: {
        found: Boolean(variationSection),
        text: cleanText(variationSection?.textContent || "").slice(0, 240)
      },
      variationEditorStatus: editor ? describeEditor(editor) : { opened: false },
      dialogsFoundCount: dialogs.length,
      iframesFoundCount: iframes.length,
      inputs,
      buttons,
      selects,
      fileInputs,
      accessibleIframeFields
    }, null, 2);
  }

  function logVariationDiagnostics(editor = detectVariationEditor()) {
    const contexts = collectEditorContexts();
    const diagnostics = {
      variationSectionFound: Boolean(findVariationSection()),
      buyItNowActive: getFormatStatus().fixedPriceSelected,
      formatSelectValue: getFormatStatus().value || "",
      editorOpened: Boolean(editor),
      iframesFoundCount: document.querySelectorAll("iframe").length,
      dialogsFoundCount: queryAllDeep("[role='dialog'], [aria-modal='true']").length,
      editor: editor ? describeEditor(editor) : null,
      contexts: contexts.slice(0, 8).map((context) => describeEditor(context))
    };
    log(JSON.stringify(diagnostics, null, 2));
  }

  function describeEditor(editor) {
    const buttons = Array.from(editor.root.querySelectorAll?.("button, [role='button']") || [])
      .map(buttonText)
      .filter(Boolean)
      .filter((label) => /add|continue|done|save|create|edit|option|value|generate|variation/i.test(label));
    return {
      opened: true,
      type: editor.type,
      inputsInsideEditorCount: editor.root.querySelectorAll?.("input, textarea, select, [contenteditable='true']").length || 0,
      buttonsInsideEditor: buttons.slice(0, 60)
    };
  }

  function getFormatStatus() {
    const select = queryAllDeep("select[name='format']").find(Boolean);
    const visibleLabel = cleanText(findFormatSection()?.textContent || "").slice(0, 120);
    const fixedOption = select ? Array.from(select.options).find((option) => option.value === "FixedPrice") : null;
    return {
      selectNameFormatExists: Boolean(select),
      value: select ? select.value : "",
      visibleLabel,
      fixedPriceSelected: Boolean(select && select.value === "FixedPrice" && (!fixedOption || fixedOption.selected))
    };
  }

  function findEditorButton(editor, includeRegex, excludeRegex) {
    return firstVisible(Array.from(editor.root.querySelectorAll("button, [role='button'], a"))
      .filter((button) => includeRegex.test(buttonText(button)) && !(excludeRegex && excludeRegex.test(buttonText(button)))));
  }

  async function clickEditorButton(editor, includeRegex, excludeRegex) {
    const button = findEditorButton(editor, includeRegex, excludeRegex);
    if (!button) return false;
    button.click();
    log(`Clicked editor button: ${buttonText(button)}.`);
    await delay(500);
    return true;
  }

  function fillFirst(selectors, value, options = {}) {
    const overwrite = options.overwrite !== false;
    const onlyVisible = options.onlyVisible !== false;
    for (const selector of selectors) {
      const candidates = queryAllDeep(selector).filter((field) => !onlyVisible || isVisible(field));
      for (const candidate of candidates) {
        if (!overwrite && candidate.value) continue;
        if (isProtectedField(candidate) && !/title|customLabel|sku|price|quantity/i.test(describeField(candidate))) continue;
        setFieldValue(candidate, value);
        return true;
      }
    }
    return false;
  }

  function setFieldValue(field, value) {
    if (!field) return;
    field.focus?.();
    if (field.isContentEditable) {
      field.textContent = value;
    } else {
      const descriptor = Object.getOwnPropertyDescriptor(field.constructor.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(field, value);
      } else {
        field.value = value;
      }
    }
    dispatchFieldEvents(field);
  }

  function dispatchFieldEvents(field) {
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function visibleFields(root = document) {
    return Array.from(root.querySelectorAll("input:not([type='hidden']), textarea, select, [contenteditable='true']"))
      .filter(isVisible);
  }

  function findFieldNear(label) {
    const forId = label.getAttribute("for");
    if (forId) {
      const byId = label.ownerDocument.getElementById(forId);
      if (byId) return byId;
    }
    return label.querySelector("input, textarea, select, [contenteditable='true']")
      || label.closest("div, section, li, tr")?.querySelector("input:not([type='hidden']), textarea, select, [contenteditable='true']");
  }

  function findAccessibleIframeEditor() {
    for (const iframe of document.querySelectorAll("iframe")) {
      try {
        const body = iframe.contentDocument?.body;
        if (body && (body.isContentEditable || body.querySelector("[contenteditable='true']") || /description|editor/i.test(iframe.name + iframe.id + iframe.title))) {
          return body.querySelector("[contenteditable='true']") || body;
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  function queryAllDeep(selector, root = document) {
    const results = [];
    const visited = new Set();
    const visit = (node) => {
      if (!node || visited.has(node)) return;
      visited.add(node);
      try {
        if (node.querySelectorAll) results.push(...node.querySelectorAll(selector));
      } catch (error) {
        return;
      }
      const all = node.querySelectorAll ? node.querySelectorAll("*") : [];
      Array.from(all).forEach((child) => {
        if (child.shadowRoot) visit(child.shadowRoot);
      });
    };
    visit(root);
    return Array.from(new Set(results));
  }

  function findButtonByText(includeRegex, excludeRegex) {
    return firstVisible(queryAllDeep("button, a, [role='button'], [role='option'], li")
      .filter((node) => {
        const label = buttonText(node);
        return includeRegex.test(label) && !(excludeRegex && excludeRegex.test(label));
      }));
  }

  function buttonText(button) {
    return cleanText(button?.textContent || button?.getAttribute?.("aria-label") || button?.value || "");
  }

  function isProtectedSpecific(label) {
    const normalized = String(label).toLowerCase();
    return protectedSpecificLabels.some((protectedLabel) => normalized.includes(protectedLabel));
  }

  function isProtectedField(field) {
    const descriptor = describeField(field).toLowerCase();
    return /shipping|payment|return|policy/.test(descriptor);
  }

  function describeField(field) {
    return [
      field.tagName,
      field.type,
      field.name,
      field.id,
      field.getAttribute?.("aria-label"),
      field.getAttribute?.("placeholder"),
      cleanText(field.closest?.("label, div, section, li, tr")?.textContent || "").slice(0, 120)
    ].filter(Boolean).join(" ");
  }

  function labelMatches(descriptor, label) {
    const left = cleanText(descriptor).toLowerCase();
    const right = cleanText(label).toLowerCase();
    return left === right || left.includes(right) || right.includes(left);
  }

  function firstVisible(nodes) {
    return Array.from(nodes || []).find(isVisible) || null;
  }

  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) return false;
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== "hidden"
      && style.display !== "none"
      && rect.width >= 0
      && rect.height >= 0
      && style.opacity !== "0";
  }

  async function waitFor(predicate, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = predicate();
      if (result) return result;
      await delay(250);
    }
    return null;
  }

  function cleanMoney(value) {
    const match = String(value || "").match(/[0-9]+(?:[,.][0-9]{1,2})?/);
    return match ? match[0].replace(/,/g, "") : "";
  }

  function unique(values) {
    return Array.from(new Set(values.map(cleanText).filter(Boolean)));
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function copyToClipboard(value, message) {
    await navigator.clipboard.writeText(value || "");
    log(message);
  }

  function updatePanelTitle() {
    const titleEl = document.getElementById("ame-current-title");
    if (!titleEl) return;
    if (!state.product) {
      titleEl.textContent = "No product loaded";
      return;
    }
    titleEl.textContent = state.product.title || "Untitled product";
  }

  function log(message) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${message}`;
    state.logs.push(line);
    state.logs = state.logs.slice(-200);
    const logEl = document.getElementById("ame-log");
    if (logEl) {
      logEl.textContent = state.logs.join("\n");
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "No response from extension." });
      });
    });
  }
})();
