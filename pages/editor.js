(async function bootstrapEditor() {
  const state = {
    draft: null
  };

  const lockCard = document.getElementById("lockCard");
  const editorApp = document.getElementById("editorApp");
  const editorPasswordInput = document.getElementById("editorPasswordInput");
  const editorUnlockButton = document.getElementById("editorUnlockButton");
  const editorLockStatus = document.getElementById("editorLockStatus");
  const editorStatus = document.getElementById("editorStatus");
  const sourcePill = document.getElementById("sourcePill");

  const titleInput = document.getElementById("titleInput");
  const descriptionInput = document.getElementById("descriptionInput");
  const priceInput = document.getElementById("priceInput");
  const quantityInput = document.getElementById("quantityInput");
  const skuInput = document.getElementById("skuInput");
  const skuPrefixInput = document.getElementById("skuPrefixInput");
  const conditionInput = document.getElementById("conditionInput");
  const markupInput = document.getElementById("markupInput");
  const categoryHintsInput = document.getElementById("categoryHintsInput");
  const shippingPolicyInput = document.getElementById("shippingPolicyInput");
  const paymentPolicyInput = document.getElementById("paymentPolicyInput");
  const returnPolicyInput = document.getElementById("returnPolicyInput");

  const specificsContainer = document.getElementById("specificsContainer");
  const imagesContainer = document.getElementById("imagesContainer");
  const dimensionsContainer = document.getElementById("dimensionsContainer");
  const variantsContainer = document.getElementById("variantsContainer");

  function setStatus(message, isError = false) {
    editorStatus.textContent = message || "";
    editorStatus.style.color = isError ? "#fca5a5" : "#93c5fd";
  }

  async function sendMessage(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) {
      throw new Error(response?.error || "Unexpected extension error.");
    }
    return response;
  }

  function parseNumber(value, fallback = "") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function blankDraft() {
    return {
      title: "",
      descriptionHtml: "",
      price: "",
      quantity: 1,
      sku: "",
      skuPrefix: "",
      source: "aliexpress",
      sourceUrl: "",
      categoryHints: [],
      specifics: [],
      images: [],
      variations: {
        dimensions: [],
        rows: [],
        enabled: true
      },
      settings: {
        condition: "New",
        shippingPolicy: "",
        paymentPolicy: "",
        returnPolicy: "",
        markupPercent: 0
      }
    };
  }

  function createDimensionRow(dimension, index) {
    const row = document.createElement("div");
    row.className = "dimension-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = dimension.enabled !== false;
    checkbox.addEventListener("change", () => {
      state.draft.variations.dimensions[index].enabled = checkbox.checked;
    });

    const nameInput = document.createElement("input");
    nameInput.value = dimension.name || "";
    nameInput.placeholder = "Dimension name";
    nameInput.addEventListener("change", () => {
      const previousName = state.draft.variations.dimensions[index].name;
      const nextName = nameInput.value.trim() || `Option ${index + 1}`;
      state.draft.variations.dimensions[index].name = nextName;
      if (previousName !== nextName) {
        for (const rowItem of state.draft.variations.rows) {
          if (Object.prototype.hasOwnProperty.call(rowItem.optionValues, previousName)) {
            rowItem.optionValues[nextName] = rowItem.optionValues[previousName];
            delete rowItem.optionValues[previousName];
          } else if (!Object.prototype.hasOwnProperty.call(rowItem.optionValues, nextName)) {
            rowItem.optionValues[nextName] = "";
          }
        }
        renderVariants();
      }
    });

    const valuesInput = document.createElement("input");
    valuesInput.value = (dimension.values || []).join(", ");
    valuesInput.placeholder = "Value 1, Value 2, Value 3";
    valuesInput.addEventListener("change", () => {
      state.draft.variations.dimensions[index].values = valuesInput.value
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    });

    row.append(checkbox, nameInput, valuesInput);
    return row;
  }

  function createSpecificRow(specific, index) {
    const row = document.createElement("div");
    row.className = "specific-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = specific.enabled !== false;
    checkbox.addEventListener("change", () => {
      state.draft.specifics[index].enabled = checkbox.checked;
    });

    const nameInput = document.createElement("input");
    nameInput.placeholder = "Specific name";
    nameInput.value = specific.name || "";
    nameInput.addEventListener("input", () => {
      state.draft.specifics[index].name = nameInput.value;
    });

    const valueInput = document.createElement("input");
    valueInput.placeholder = "Specific value";
    valueInput.value = specific.value || "";
    valueInput.addEventListener("input", () => {
      state.draft.specifics[index].value = valueInput.value;
    });

    row.append(checkbox, nameInput, valueInput);
    return row;
  }

  function createImageRow(image, index) {
    const row = document.createElement("div");
    row.className = "image-item";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = image.selected !== false;
    checkbox.addEventListener("change", () => {
      state.draft.images[index].selected = checkbox.checked;
    });

    const preview = document.createElement("img");
    preview.src = image.url;
    preview.alt = "Product image";

    const input = document.createElement("input");
    input.value = image.url || "";
    input.placeholder = "https://...";
    input.addEventListener("input", () => {
      state.draft.images[index].url = input.value.trim();
      preview.src = input.value.trim();
    });

    row.append(checkbox, preview, input);
    return row;
  }

  function createVariantRow(rowData, index) {
    const row = document.createElement("div");
    row.className = "variant-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = rowData.selected !== false;
    checkbox.addEventListener("change", () => {
      state.draft.variations.rows[index].selected = checkbox.checked;
    });

    const skuField = document.createElement("input");
    skuField.value = rowData.sku || "";
    skuField.placeholder = "SKU";
    skuField.addEventListener("input", () => {
      state.draft.variations.rows[index].sku = skuField.value;
    });

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "stack";
    const enabledDimensions = state.draft.variations.dimensions.filter((dimension) => dimension.enabled !== false);
    for (const dimension of enabledDimensions) {
      const optionInput = document.createElement("input");
      optionInput.placeholder = dimension.name || "Option";
      optionInput.value = rowData.optionValues?.[dimension.name] || "";
      optionInput.addEventListener("input", () => {
        state.draft.variations.rows[index].optionValues[dimension.name] = optionInput.value;
      });
      optionsWrap.append(optionInput);
    }
    if (!enabledDimensions.length) {
      const note = document.createElement("div");
      note.className = "small";
      note.textContent = "Add at least one enabled dimension.";
      optionsWrap.append(note);
    }

    const priceField = document.createElement("input");
    priceField.type = "number";
    priceField.step = "0.01";
    priceField.min = "0";
    priceField.value = rowData.price === "" ? "" : String(rowData.price);
    priceField.placeholder = "Price";
    priceField.addEventListener("input", () => {
      state.draft.variations.rows[index].price = parseNumber(priceField.value, "");
    });

    const quantityField = document.createElement("input");
    quantityField.type = "number";
    quantityField.step = "1";
    quantityField.min = "0";
    quantityField.value = String(rowData.quantity ?? 1);
    quantityField.placeholder = "Qty";
    quantityField.addEventListener("input", () => {
      state.draft.variations.rows[index].quantity = parseNumber(quantityField.value, 1);
    });

    const imageField = document.createElement("input");
    imageField.value = rowData.imageUrl || "";
    imageField.placeholder = "Variation image URL";
    imageField.addEventListener("input", () => {
      state.draft.variations.rows[index].imageUrl = imageField.value.trim();
    });

    row.append(checkbox, skuField, optionsWrap, priceField, quantityField, imageField);
    return row;
  }

  function renderSpecifics() {
    specificsContainer.innerHTML = "";
    state.draft.specifics.forEach((specific, index) => {
      specificsContainer.append(createSpecificRow(specific, index));
    });
  }

  function renderImages() {
    imagesContainer.innerHTML = "";
    state.draft.images.forEach((image, index) => {
      imagesContainer.append(createImageRow(image, index));
    });
  }

  function renderDimensions() {
    dimensionsContainer.innerHTML = "";
    state.draft.variations.dimensions.forEach((dimension, index) => {
      dimensionsContainer.append(createDimensionRow(dimension, index));
    });
  }

  function renderVariants() {
    variantsContainer.innerHTML = "";
    state.draft.variations.rows.forEach((rowData, index) => {
      variantsContainer.append(createVariantRow(rowData, index));
    });
  }

  function renderForm() {
    const draft = state.draft;
    titleInput.value = draft.title || "";
    descriptionInput.value = draft.descriptionHtml || "";
    priceInput.value = draft.price === "" ? "" : String(draft.price);
    quantityInput.value = String(draft.quantity ?? 1);
    skuInput.value = draft.sku || "";
    skuPrefixInput.value = draft.skuPrefix || "";
    conditionInput.value = draft.settings?.condition || "New";
    markupInput.value = String(draft.settings?.markupPercent ?? 0);
    categoryHintsInput.value = (draft.categoryHints || []).join(", ");
    shippingPolicyInput.value = draft.settings?.shippingPolicy || "";
    paymentPolicyInput.value = draft.settings?.paymentPolicy || "";
    returnPolicyInput.value = draft.settings?.returnPolicy || "";
    sourcePill.textContent = draft.title
      ? `${draft.source || "draft"} · ${draft.images.length} images · ${draft.variations.rows.length} variants`
      : "Draft ready";
    renderSpecifics();
    renderImages();
    renderDimensions();
    renderVariants();
  }

  function collectDraftFromForm() {
    const draft = deepClone(state.draft);
    draft.title = titleInput.value.trim();
    draft.descriptionHtml = descriptionInput.value.trim();
    draft.price = parseNumber(priceInput.value, "");
    draft.quantity = parseNumber(quantityInput.value, 1);
    draft.sku = skuInput.value.trim();
    draft.skuPrefix = skuPrefixInput.value.trim();
    draft.categoryHints = categoryHintsInput.value
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    draft.settings = {
      ...(draft.settings || {}),
      condition: conditionInput.value,
      shippingPolicy: shippingPolicyInput.value.trim(),
      paymentPolicy: paymentPolicyInput.value.trim(),
      returnPolicy: returnPolicyInput.value.trim(),
      markupPercent: parseNumber(markupInput.value, 0)
    };
    draft.specifics = draft.specifics.filter((entry) => entry.name?.trim() || entry.value?.trim());
    draft.images = draft.images.filter((entry) => entry.url?.trim());
    draft.variations.dimensions = draft.variations.dimensions.filter((entry) => entry.name?.trim());
    draft.variations.rows = draft.variations.rows.filter((entry) => {
      const optionValues = entry.optionValues || {};
      return entry.sku?.trim() || Object.values(optionValues).some((value) => String(value || "").trim());
    });
    state.draft = draft;
    return draft;
  }

  function buildVariantTableText(rows, delimiter = "\t") {
    const enabledDimensions = state.draft.variations.dimensions.filter((dimension) => dimension.enabled !== false);
    const headers = ["SKU", ...enabledDimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image"];
    const lines = [headers.join(delimiter)];
    for (const row of rows.filter((entry) => entry.selected !== false)) {
      const cells = [
        row.sku || "",
        ...enabledDimensions.map((dimension) => row.optionValues?.[dimension.name] || ""),
        row.price === "" ? "" : row.price,
        row.quantity ?? "",
        row.imageUrl || ""
      ];
      lines.push(cells.join(delimiter));
    }
    return lines.join("\n");
  }

  async function saveDraft() {
    const draft = collectDraftFromForm();
    const response = await sendMessage("AM_SAVE_DRAFT", { draft });
    state.draft = response.draft || draft;
    renderForm();
    return state.draft;
  }

  async function requireAuth() {
    const status = await chrome.runtime.sendMessage({ type: "AM_AUTH_STATUS" });
    if (!status?.ok) {
      lockCard.classList.remove("hidden");
      editorApp.classList.add("hidden");
      return false;
    }
    lockCard.classList.add("hidden");
    editorApp.classList.remove("hidden");
    return true;
  }

  async function loadDraft() {
    const response = await sendMessage("AM_GET_DRAFT");
    state.draft = response.draft || blankDraft();
    renderForm();
  }

  editorUnlockButton.addEventListener("click", async () => {
    editorLockStatus.textContent = "Checking password...";
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AM_VERIFY_PASSWORD",
        password: editorPasswordInput.value
      });
      if (!response?.ok) {
        throw new Error("Incorrect password.");
      }
      editorPasswordInput.value = "";
      editorLockStatus.textContent = "";
      if (await requireAuth()) {
        await loadDraft();
      }
    } catch (error) {
      editorLockStatus.textContent = error.message;
      editorLockStatus.style.color = "#fca5a5";
    }
  });

  editorPasswordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      editorUnlockButton.click();
    }
  });

  document.getElementById("saveDraftButton").addEventListener("click", async () => {
    setStatus("Saving draft...");
    try {
      await saveDraft();
      setStatus("Draft saved.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("applyMarkupButton").addEventListener("click", async () => {
    try {
      collectDraftFromForm();
      const percent = parseNumber(markupInput.value, 0);
      if (!Number.isFinite(percent)) {
        throw new Error("Markup value is not valid.");
      }
      if (state.draft.price !== "") {
        state.draft.price = Number((Number(state.draft.price) * (1 + percent / 100)).toFixed(2));
      }
      state.draft.variations.rows = state.draft.variations.rows.map((row) => ({
        ...row,
        price: row.price === "" ? "" : Number((Number(row.price) * (1 + percent / 100)).toFixed(2))
      }));
      state.draft.settings.markupPercent = percent;
      renderForm();
      await saveDraft();
      setStatus(`Applied ${percent}% markup to base and variation prices.`);
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("copyTitleButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText(titleInput.value.trim());
    setStatus("Title copied to clipboard.");
  });

  document.getElementById("copyDescriptionButton").addEventListener("click", async () => {
    await navigator.clipboard.writeText(descriptionInput.value.trim());
    setStatus("Description copied to clipboard.");
  });

  document.getElementById("copyVariantsButton").addEventListener("click", async () => {
    collectDraftFromForm();
    const text = buildVariantTableText(state.draft.variations.rows);
    await navigator.clipboard.writeText(text);
    setStatus("Variation table copied to clipboard.");
  });

  document.getElementById("exportCsvButton").addEventListener("click", async () => {
    collectDraftFromForm();
    const csvText = buildVariantTableText(state.draft.variations.rows, ",");
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: "am-ebay-variants.csv",
      saveAs: true
    });
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus("CSV export started.");
  });

  document.getElementById("listItButton").addEventListener("click", async () => {
    setStatus("Saving draft and opening eBay AU listing...");
    try {
      const draft = await saveDraft();
      await sendMessage("AM_SAVE_EBAY_STATE", {
        patch: {
          autoStartArmed: true,
          lastStatus: `Prepared ${draft.title || "draft"}`,
          lastOpenedAt: Date.now()
        }
      });
      await sendMessage("AM_OPEN_EBAY_LISTING");
      setStatus("eBay AU listing flow opened.");
    } catch (error) {
      setStatus(error.message, true);
    }
  });

  document.getElementById("addSpecificButton").addEventListener("click", () => {
    state.draft.specifics.push({ name: "", value: "", enabled: true });
    renderSpecifics();
  });

  document.getElementById("addDimensionButton").addEventListener("click", () => {
    const name = `Option ${state.draft.variations.dimensions.length + 1}`;
    state.draft.variations.dimensions.push({ name, values: [], enabled: true });
    for (const row of state.draft.variations.rows) {
      row.optionValues[name] = row.optionValues[name] || "";
    }
    renderDimensions();
    renderVariants();
  });

  document.getElementById("addVariantButton").addEventListener("click", () => {
    const optionValues = {};
    for (const dimension of state.draft.variations.dimensions) {
      optionValues[dimension.name] = "";
    }
    state.draft.variations.rows.push({
      id: `row-${Date.now()}`,
      sku: "",
      optionValues,
      price: state.draft.price === "" ? "" : state.draft.price,
      quantity: state.draft.quantity ?? 1,
      imageUrl: "",
      selected: true
    });
    renderVariants();
  });

  if (await requireAuth()) {
    await loadDraft();
  }
})();
