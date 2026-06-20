const $ = (selector) => document.querySelector(selector);

const elements = {
  lockView: $("#lock-view"),
  editorView: $("#editor-view"),
  unlockForm: $("#unlock-form"),
  password: $("#password"),
  unlockButton: $("#unlock-button"),
  lockStatus: $("#lock-status"),
  saveButton: $("#save-button"),
  listButton: $("#list-button"),
  lockButton: $("#lock-button"),
  copyTitleButton: $("#copy-title-button"),
  copyDescriptionButton: $("#copy-description-button"),
  copyVariantsButton: $("#copy-variants-button"),
  exportCsvButton: $("#export-csv-button"),
  importSheetButton: $("#import-sheet-button"),
  importSheetFile: $("#import-sheet-file"),
  applyMarkupButton: $("#apply-markup-button"),
  addSpecificButton: $("#add-specific-button"),
  addVariationButton: $("#add-variation-button"),
  status: $("#status"),
  title: $("#title"),
  skuPrefix: $("#sku-prefix"),
  price: $("#price"),
  quantity: $("#quantity"),
  markup: $("#markup"),
  categoryHints: $("#category-hints"),
  description: $("#description"),
  images: $("#images"),
  specifics: $("#specifics"),
  dimensionEditor: $("#dimension-editor"),
  variationHead: $("#variation-head"),
  variations: $("#variations")
};

let product = null;
let settings = null;

init();

async function init() {
  bindEvents();
  const auth = await sendRuntime({ type: "AUTH_CHECK" });
  setUnlocked(Boolean(auth.unlocked));
  if (auth.unlocked) {
    await loadProduct();
  }
}

function bindEvents() {
  elements.unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await withButton(elements.unlockButton, async () => {
      const response = await sendRuntime({
        type: "AUTH_UNLOCK",
        password: elements.password.value
      });
      if (!response.unlocked) {
        elements.lockStatus.textContent = "Access denied";
        elements.password.select();
        return;
      }
      elements.password.value = "";
      elements.lockStatus.textContent = "";
      setUnlocked(true);
      await loadProduct();
    });
  });

  elements.saveButton.addEventListener("click", async () => {
    await withButton(elements.saveButton, saveFromForm);
  });

  elements.listButton.addEventListener("click", async () => {
    await withButton(elements.listButton, async () => {
      await saveFromForm();
      await sendRuntime({ type: "LIST_IT", product });
      setStatus("eBay AU listing page opened. Use the floating panel to fill fields.");
    });
  });

  elements.lockButton.addEventListener("click", async () => {
    await sendRuntime({ type: "AUTH_LOCK" });
    setUnlocked(false);
  });

  elements.copyTitleButton.addEventListener("click", () => copyText(elements.title.value, "Title copied."));
  elements.copyDescriptionButton.addEventListener("click", () => copyText(elements.description.value, "Description copied."));
  elements.copyVariantsButton.addEventListener("click", async () => {
    await saveFromForm();
    await copyText(variantsToTsv(product), "Variation TSV copied.");
  });
  elements.exportCsvButton.addEventListener("click", async () => {
    await saveFromForm();
    exportCsv(product);
  });
  elements.importSheetButton.addEventListener("click", () => {
    elements.importSheetFile.click();
  });
  elements.importSheetFile.addEventListener("change", async () => {
    const [file] = elements.importSheetFile.files;
    if (!file) {
      return;
    }
    await importSheetFile(file);
    elements.importSheetFile.value = "";
  });
  elements.applyMarkupButton.addEventListener("click", () => applyMarkup());
  elements.addSpecificButton.addEventListener("click", () => {
    product.itemSpecifics.push({ name: "", value: "" });
    renderSpecifics();
  });
  elements.addVariationButton.addEventListener("click", () => {
    const dimensions = getDimensions();
    const options = {};
    dimensions.forEach((dimension) => {
      options[dimension] = "";
    });
    product.variations.push({
      id: `manual-${Date.now()}`,
      selected: true,
      sku: nextSku(),
      options,
      price: elements.price.value,
      quantity: toInteger(elements.quantity.value, 1),
      image: ""
    });
    renderVariations();
  });
}

function setUnlocked(unlocked) {
  elements.lockView.classList.toggle("hidden", unlocked);
  elements.editorView.classList.toggle("hidden", !unlocked);
  if (!unlocked) {
    elements.password.focus();
  }
}

async function loadProduct() {
  const response = await sendRuntime({ type: "GET_PRODUCT" });
  settings = response.settings || {};
  product = response.product || emptyProduct();
  renderForm();
  setStatus(product.title ? "Product loaded." : "No product data yet. Scrape a product from the popup first.");
}

function emptyProduct() {
  return {
    sourceUrl: "",
    scrapedAt: new Date().toISOString(),
    title: "",
    descriptionHtml: "",
    price: "",
    priceText: "",
    currency: "",
    quantity: settings && settings.defaultQuantity ? settings.defaultQuantity : 1,
    skuPrefix: settings && settings.skuPrefix ? settings.skuPrefix : "AX",
    sku: "",
    categoryHints: [],
    itemSpecifics: [],
    images: [],
    variationDimensions: ["Colour", "Size"],
    variations: []
  };
}

function renderForm() {
  elements.title.value = product.title || "";
  elements.skuPrefix.value = product.skuPrefix || (settings && settings.skuPrefix) || "AX";
  elements.price.value = product.price || "";
  elements.quantity.value = product.quantity || 1;
  elements.categoryHints.value = (product.categoryHints || []).join(", ");
  elements.description.value = product.descriptionHtml || "";
  renderImages();
  renderSpecifics();
  renderDimensionEditor();
  renderVariations();
}

function renderImages() {
  elements.images.textContent = "";
  (product.images || []).forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "image-card";
    card.innerHTML = `
      <img src="${escapeAttribute(image.url)}" alt="">
      <label>
        <input type="checkbox" data-image-index="${index}" ${image.selected !== false ? "checked" : ""}>
        Use image ${index + 1}
      </label>
    `;
    card.querySelector("input").addEventListener("change", (event) => {
      product.images[index].selected = event.target.checked;
    });
    elements.images.appendChild(card);
  });
}

function renderSpecifics() {
  elements.specifics.textContent = "";
  (product.itemSpecifics || []).forEach((specific, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input data-specific-name="${index}" value="${escapeAttribute(specific.name || "")}"></td>
      <td><input data-specific-value="${index}" value="${escapeAttribute(specific.value || "")}"></td>
      <td><button class="secondary" type="button" data-remove-specific="${index}">Remove</button></td>
    `;
    row.querySelector(`[data-specific-name="${index}"]`).addEventListener("input", (event) => {
      product.itemSpecifics[index].name = event.target.value;
    });
    row.querySelector(`[data-specific-value="${index}"]`).addEventListener("input", (event) => {
      product.itemSpecifics[index].value = event.target.value;
    });
    row.querySelector(`[data-remove-specific="${index}"]`).addEventListener("click", () => {
      product.itemSpecifics.splice(index, 1);
      renderSpecifics();
    });
    elements.specifics.appendChild(row);
  });
}

function renderDimensionEditor() {
  elements.dimensionEditor.textContent = "";
  getDimensions().forEach((dimension, index) => {
    const label = document.createElement("label");
    label.textContent = `Dimension ${index + 1}`;
    const input = document.createElement("input");
    input.value = dimension;
    input.addEventListener("change", () => renameDimension(dimension, input.value));
    label.appendChild(input);
    elements.dimensionEditor.appendChild(label);
  });
}

function renderVariations() {
  const dimensions = getDimensions();
  elements.variationHead.innerHTML = `
    <tr>
      <th>Use</th>
      <th>SKU</th>
      ${dimensions.map((dimension) => `<th>${escapeHtml(dimension)}</th>`).join("")}
      <th>Price</th>
      <th>Quantity</th>
      <th>Image URL</th>
      <th></th>
    </tr>
  `;
  elements.variations.textContent = "";

  (product.variations || []).forEach((variation, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" data-var-selected="${index}" ${variation.selected !== false ? "checked" : ""}></td>
      <td><input data-var-sku="${index}" value="${escapeAttribute(variation.sku || "")}"></td>
      ${dimensions.map((dimension) => `
        <td><input data-var-option="${index}" data-var-dimension="${escapeAttribute(dimension)}" value="${escapeAttribute((variation.options || {})[dimension] || "")}"></td>
      `).join("")}
      <td><input data-var-price="${index}" value="${escapeAttribute(variation.price || "")}"></td>
      <td><input data-var-quantity="${index}" value="${escapeAttribute(variation.quantity || "")}"></td>
      <td><input data-var-image="${index}" value="${escapeAttribute(variation.image || "")}"></td>
      <td><button class="secondary" type="button" data-remove-var="${index}">Remove</button></td>
    `;
    row.querySelector(`[data-var-selected="${index}"]`).addEventListener("change", (event) => {
      product.variations[index].selected = event.target.checked;
    });
    row.querySelector(`[data-var-sku="${index}"]`).addEventListener("input", (event) => {
      product.variations[index].sku = event.target.value;
    });
    row.querySelectorAll("[data-var-option]").forEach((input) => {
      input.addEventListener("input", (event) => {
        product.variations[index].options = product.variations[index].options || {};
        product.variations[index].options[event.target.dataset.varDimension] = event.target.value;
      });
    });
    row.querySelector(`[data-var-price="${index}"]`).addEventListener("input", (event) => {
      product.variations[index].price = event.target.value;
    });
    row.querySelector(`[data-var-quantity="${index}"]`).addEventListener("input", (event) => {
      product.variations[index].quantity = event.target.value;
    });
    row.querySelector(`[data-var-image="${index}"]`).addEventListener("input", (event) => {
      product.variations[index].image = event.target.value;
    });
    row.querySelector(`[data-remove-var="${index}"]`).addEventListener("click", () => {
      product.variations.splice(index, 1);
      renderVariations();
    });
    elements.variations.appendChild(row);
  });
}

function renameDimension(oldName, newName) {
  const clean = newName.trim();
  if (!clean || clean === oldName) {
    renderDimensionEditor();
    return;
  }

  product.variationDimensions = getDimensions().map((dimension) => dimension === oldName ? clean : dimension);
  product.variations.forEach((variation) => {
    variation.options = variation.options || {};
    if (Object.prototype.hasOwnProperty.call(variation.options, oldName)) {
      variation.options[clean] = variation.options[oldName];
      delete variation.options[oldName];
    }
  });
  renderDimensionEditor();
  renderVariations();
}

async function saveFromForm() {
  product.title = elements.title.value.trim();
  product.skuPrefix = elements.skuPrefix.value.trim() || "AX";
  product.price = toNumberOrString(elements.price.value);
  product.quantity = toInteger(elements.quantity.value, 1);
  product.categoryHints = elements.categoryHints.value.split(",").map((item) => item.trim()).filter(Boolean);
  product.descriptionHtml = elements.description.value;
  product.variationDimensions = getDimensions();

  await sendRuntime({ type: "SAVE_PRODUCT", product });
  setStatus("Saved.");
}

function applyMarkup() {
  const percent = Number(elements.markup.value);
  if (!Number.isFinite(percent)) {
    setStatus("Enter a valid markup percentage.");
    return;
  }

  const multiplier = 1 + percent / 100;
  const newPrice = roundMoney(toNumber(elements.price.value) * multiplier);
  if (newPrice) {
    elements.price.value = newPrice;
    product.price = newPrice;
  }

  product.variations.forEach((variation) => {
    const next = roundMoney(toNumber(variation.price) * multiplier);
    if (next) {
      variation.price = next;
    }
  });
  renderVariations();
  setStatus("Markup applied. Review prices before listing.");
}

function getDimensions() {
  const fromProduct = product && product.variationDimensions ? product.variationDimensions : [];
  const fromRows = product && product.variations
    ? product.variations.flatMap((variation) => Object.keys(variation.options || {}))
    : [];
  return [...new Set([...fromProduct, ...fromRows].map((name) => String(name || "").trim()).filter(Boolean))];
}

function nextSku() {
  return `${elements.skuPrefix.value || "AX"}-${(product.variations || []).length + 1}`;
}

function variantsToTsv(source) {
  const dimensions = getDimensions();
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
  return [header, ...rows].map((row) => row.map(tsvCell).join("\t")).join("\n");
}

function exportCsv(source) {
  const dimensions = getDimensions();
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
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileName(source.title || "variations")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Variation CSV exported.");
}

async function importSheetFile(file) {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    const parsed = JSON.parse(text);
    product = normalizeImportedProduct(Array.isArray(parsed) ? rowsToProduct(parsed) : parsed);
  } else {
    product = normalizeImportedProduct(rowsToProduct(parseCsv(text)));
  }
  renderForm();
  await saveFromForm();
  setStatus("Imported sheet data. Review all fields before listing.");
}

function rowsToProduct(rows) {
  const first = rows[0] || {};
  const dimensions = Object.keys(first).filter((key) => {
    const normalized = key.toLowerCase();
    return !["title", "description", "descriptionhtml", "price", "quantity", "sku", "skuprefix", "image", "images", "category", "categoryhints"].includes(normalized);
  });

  const imported = {
    ...product,
    title: first.title || first.Title || product.title || "",
    descriptionHtml: first.descriptionHtml || first.DescriptionHtml || first.description || first.Description || product.descriptionHtml || "",
    price: first.price || first.Price || product.price || "",
    quantity: first.quantity || first.Quantity || product.quantity || 1,
    skuPrefix: first.skuPrefix || first.SkuPrefix || product.skuPrefix || "AX",
    sku: first.sku || first.SKU || product.sku || "",
    categoryHints: splitList(first.categoryHints || first.CategoryHints || first.category || first.Category || product.categoryHints || []),
    images: mergeImportedImages(product.images || [], splitList(first.images || first.Images || first.image || first.Image || [])),
    itemSpecifics: product.itemSpecifics || [],
    variationDimensions: dimensions,
    variations: []
  };

  imported.variations = rows.map((row, index) => {
    const options = {};
    dimensions.forEach((dimension) => {
      options[dimension] = row[dimension] || "";
    });
    return {
      id: `sheet-${index + 1}`,
      selected: true,
      sku: row.sku || row.SKU || `${imported.skuPrefix || "AX"}-${index + 1}`,
      options,
      price: row.price || row.Price || imported.price,
      quantity: row.quantity || row.Quantity || imported.quantity,
      image: row.image || row.Image || ""
    };
  }).filter((variation) => Object.values(variation.options).some(Boolean));

  return imported;
}

function normalizeImportedProduct(source) {
  return {
    ...emptyProduct(),
    ...product,
    ...source,
    categoryHints: splitList(source.categoryHints || []),
    itemSpecifics: Array.isArray(source.itemSpecifics) ? source.itemSpecifics : [],
    images: Array.isArray(source.images) ? source.images.map((image) => typeof image === "string" ? { url: image, selected: true } : image) : [],
    variations: Array.isArray(source.variations) ? source.variations : []
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);

  const [headers = [], ...records] = rows.filter((entry) => entry.some((value) => String(value).trim()));
  return records.map((record) => {
    const object = {};
    headers.forEach((header, index) => {
      object[String(header || "").trim()] = String(record[index] || "").trim();
    });
    return object;
  });
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return String(value || "").split(/[;|,]/).map((item) => item.trim()).filter(Boolean);
}

function mergeImportedImages(existing, urls) {
  const seen = new Set();
  return [
    ...existing,
    ...urls.map((url) => ({ url, selected: true, source: "sheet" }))
  ].filter((image) => {
    if (!image.url || seen.has(image.url)) {
      return false;
    }
    seen.add(image.url);
    return true;
  });
}

async function copyText(value, successMessage) {
  await navigator.clipboard.writeText(value || "");
  setStatus(successMessage);
}

function tsvCell(value) {
  return String(value || "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function csvCell(value) {
  const clean = String(value || "");
  return /[",\n]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}

function sanitizeFileName(value) {
  return String(value || "export").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
}

function toNumber(value) {
  const number = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function toNumberOrString(value) {
  const number = toNumber(value);
  return number || String(value || "").trim();
}

function toInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function roundMoney(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return Math.round(value * 100) / 100;
}

function setStatus(message) {
  elements.status.textContent = message || "";
}

async function withButton(button, task) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Working...";
  try {
    await task();
  } catch (error) {
    setStatus(error && error.message ? error.message : String(error));
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

async function sendRuntime(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) {
    throw new Error((response && response.error) || "Extension request failed.");
  }
  return response;
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
