let product = null;
let defaults = {};
let dimensions = [];
let ebayRegions = [];
let selectedRegion = "au";

const lockScreen = document.getElementById("lock-screen");
const editorScreen = document.getElementById("editor-screen");
const lockForm = document.getElementById("lock-form");
const passwordInput = document.getElementById("password");
const lockStatus = document.getElementById("lock-status");
const statusEl = document.getElementById("status");

const fields = {
  title: document.getElementById("title"),
  description: document.getElementById("description"),
  price: document.getElementById("price"),
  quantity: document.getElementById("quantity"),
  skuPrefix: document.getElementById("sku-prefix"),
  categoryHints: document.getElementById("category-hints"),
  region: document.getElementById("region"),
  markupPercent: document.getElementById("markup-percent"),
  condition: document.getElementById("condition")
};

document.getElementById("save-btn").addEventListener("click", saveProduct);
document.getElementById("list-btn").addEventListener("click", listIt);
document.getElementById("apply-markup-btn").addEventListener("click", applyMarkup);
document.getElementById("add-specific-btn").addEventListener("click", () => addSpecificRow("", ""));
document.getElementById("copy-title-btn").addEventListener("click", () => copyText(fields.title.value, "Title copied."));
document.getElementById("copy-description-btn").addEventListener("click", () => copyText(fields.description.value, "Description copied."));
document.getElementById("copy-variants-btn").addEventListener("click", () => copyText(buildVariationTsv(), "Variants copied as TSV."));
document.getElementById("export-csv-btn").addEventListener("click", exportCsv);
fields.region.addEventListener("change", saveSelectedRegion);

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  lockStatus.textContent = "";
  const response = await sendMessage({
    type: "VERIFY_PASSWORD",
    password: passwordInput.value
  });
  if (response.ok && response.unlocked) {
    passwordInput.value = "";
    await showEditor();
    return;
  }
  lockStatus.textContent = "Access denied.";
  passwordInput.select();
});

init();

async function init() {
  const response = await sendMessage({ type: "IS_UNLOCKED" });
  if (response.ok && response.unlocked) {
    await showEditor();
  } else {
    showLock();
  }
}

function showLock() {
  lockScreen.classList.add("active");
  editorScreen.classList.remove("active");
  setTimeout(() => passwordInput.focus(), 50);
}

async function showEditor() {
  lockScreen.classList.remove("active");
  editorScreen.classList.add("active");
  await loadProduct();
}

async function loadProduct() {
  const response = await sendMessage({ type: "GET_PRODUCT" });
  if (!response.ok) {
    setStatus(response.error || "Unable to load product.");
    return;
  }
  defaults = response.defaults || {};
  ebayRegions = response.ebayRegions || [];
  selectedRegion = response.selectedRegion || defaults.ebayRegion || "au";
  product = normalizeProduct(response.product || {});
  renderProduct();
}

function normalizeProduct(raw) {
  const normalized = {
    source: raw.source || "manual",
    sourceUrl: raw.sourceUrl || "",
    scrapedAt: raw.scrapedAt || new Date().toISOString(),
    title: raw.title || "",
    descriptionHtml: raw.descriptionHtml || raw.description || "",
    price: raw.price || "",
    currency: raw.currency || "",
    quantity: Number(raw.quantity || defaults.quantity || 5),
    skuPrefix: raw.skuPrefix || defaults.skuPrefix || "AX",
    ebayRegion: raw.ebayRegion || selectedRegion || defaults.ebayRegion || "au",
    categoryHints: Array.isArray(raw.categoryHints) ? raw.categoryHints : [],
    condition: raw.condition || defaults.condition || "New",
    specifications: raw.specifications || {},
    images: (raw.images || []).map((image, index) => ({
      url: typeof image === "string" ? image : image.url,
      selected: typeof image === "string" ? true : image.selected !== false,
      label: typeof image === "string" ? `Image ${index + 1}` : image.label || `Image ${index + 1}`
    })).filter((image) => image.url),
    variations: (raw.variations || []).map((variation, index) => ({
      selected: variation.selected !== false,
      sku: variation.sku || `${raw.skuPrefix || defaults.skuPrefix || "AX"}-${index + 1}`,
      price: variation.price || raw.price || "",
      quantity: Number(variation.quantity || raw.quantity || defaults.quantity || 5),
      imageUrl: variation.imageUrl || variation.image || "",
      options: variation.options || extractLegacyOptions(variation)
    }))
  };

  dimensions = normalizeDimensions(raw.variationDimensions || inferDimensions(normalized.variations));
  normalized.variationDimensions = dimensions;
  return normalized;
}

function extractLegacyOptions(variation) {
  const options = {};
  Object.entries(variation || {}).forEach(([key, value]) => {
    if (/^(sku|price|quantity|image|imageUrl|selected)$/i.test(key)) return;
    if (value != null && value !== "") options[key] = String(value);
  });
  return options;
}

function inferDimensions(variations) {
  const seen = new Set();
  variations.forEach((variation) => {
    Object.keys(variation.options || {}).forEach((name) => seen.add(name));
  });
  return Array.from(seen).map((name) => ({ name }));
}

function normalizeDimensions(input) {
  const names = [];
  const addName = (name) => {
    const cleaned = cleanName(name);
    if (cleaned && !names.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      names.push(cleaned);
    }
  };
  (input || []).forEach((dimension) => addName(typeof dimension === "string" ? dimension : dimension.name));
  return names.map((name) => ({ name }));
}

function renderProduct() {
  renderRegions();
  fields.title.value = product.title;
  fields.description.value = product.descriptionHtml;
  fields.price.value = product.price;
  fields.quantity.value = product.quantity;
  fields.skuPrefix.value = product.skuPrefix;
  fields.region.value = product.ebayRegion || selectedRegion;
  fields.categoryHints.value = product.categoryHints.join(", ");
  fields.condition.value = product.condition;
  renderImages();
  renderSpecifics();
  renderVariations();
  setStatus("Loaded product data.");
}

function renderRegions() {
  fields.region.textContent = "";
  (ebayRegions.length ? ebayRegions : [{ code: selectedRegion, label: selectedRegion.toUpperCase(), domain: "" }]).forEach((region) => {
    const option = document.createElement("option");
    option.value = region.code;
    option.textContent = region.domain ? `${region.label} (${region.domain})` : region.label;
    fields.region.appendChild(option);
  });
}

function renderImages() {
  const container = document.getElementById("images");
  container.textContent = "";
  product.images.forEach((image, index) => {
    const card = document.createElement("label");
    card.className = "image-card";
    card.innerHTML = `
      <img alt="">
      <span><input type="checkbox"> Use image</span>
    `;
    card.querySelector("img").src = image.url;
    card.querySelector("input").checked = image.selected !== false;
    card.querySelector("input").addEventListener("change", (event) => {
      product.images[index].selected = event.target.checked;
    });
    container.appendChild(card);
  });
}

function renderSpecifics() {
  const tbody = document.getElementById("specifics-body");
  tbody.textContent = "";
  Object.entries(product.specifications || {}).forEach(([name, value]) => addSpecificRow(name, value));
}

function addSpecificRow(name, value) {
  const tbody = document.getElementById("specifics-body");
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="specific-name"></td>
    <td><input class="specific-value"></td>
    <td><button class="danger" type="button">Remove</button></td>
  `;
  row.querySelector(".specific-name").value = name;
  row.querySelector(".specific-value").value = value;
  row.querySelector("button").addEventListener("click", () => row.remove());
  tbody.appendChild(row);
}

function renderVariations() {
  renderDimensionControls();
  const thead = document.getElementById("variations-head");
  const tbody = document.getElementById("variations-body");
  thead.textContent = "";
  tbody.textContent = "";

  const headRow = document.createElement("tr");
  ["Use", "SKU", ...dimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image URL"].forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  product.variations.forEach((variation, rowIndex) => {
    const row = document.createElement("tr");
    row.appendChild(cellWithInput("checkbox", variation.selected !== false, (value) => {
      product.variations[rowIndex].selected = value;
    }));
    row.appendChild(cellWithInput("text", variation.sku, (value) => {
      product.variations[rowIndex].sku = value;
    }));
    dimensions.forEach((dimension) => {
      row.appendChild(cellWithInput("text", variation.options[dimension.name] || "", (value) => {
        product.variations[rowIndex].options[dimension.name] = value;
      }));
    });
    row.appendChild(cellWithInput("text", variation.price, (value) => {
      product.variations[rowIndex].price = value;
    }));
    row.appendChild(cellWithInput("number", variation.quantity, (value) => {
      product.variations[rowIndex].quantity = Number(value || 0);
    }));
    row.appendChild(cellWithInput("text", variation.imageUrl || "", (value) => {
      product.variations[rowIndex].imageUrl = value;
    }));
    tbody.appendChild(row);
  });
}

function renderDimensionControls() {
  const container = document.getElementById("dimension-actions");
  container.textContent = "";
  dimensions.forEach((dimension, index) => {
    const label = document.createElement("label");
    label.style.maxWidth = "260px";
    label.textContent = `Dimension ${index + 1}`;
    const input = document.createElement("input");
    input.value = dimension.name;
    input.addEventListener("change", () => renameDimension(index, input.value));
    label.appendChild(input);
    container.appendChild(label);
  });
}

function renameDimension(index, nextName) {
  const oldName = dimensions[index].name;
  const newName = cleanName(nextName);
  if (!newName || oldName === newName) return;
  dimensions[index].name = newName;
  product.variations.forEach((variation) => {
    variation.options[newName] = variation.options[oldName] || "";
    delete variation.options[oldName];
  });
  renderVariations();
}

function cellWithInput(type, value, onChange) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = type;
  if (type === "checkbox") {
    input.checked = Boolean(value);
    input.addEventListener("change", () => onChange(input.checked));
  } else {
    input.value = value == null ? "" : value;
    input.addEventListener("input", () => onChange(input.value));
  }
  td.appendChild(input);
  return td;
}

async function saveProduct() {
  product = collectProduct();
  const response = await sendMessage({ type: "SAVE_PRODUCT", product });
  setStatus(response.ok ? "Saved product data." : response.error || "Save failed.");
  return response;
}

function collectProduct() {
  const specifics = {};
  document.querySelectorAll("#specifics-body tr").forEach((row) => {
    const name = cleanName(row.querySelector(".specific-name").value);
    const value = row.querySelector(".specific-value").value.trim();
    if (name && value) specifics[name] = value;
  });

  product.title = fields.title.value.trim();
  product.descriptionHtml = fields.description.value;
  product.price = fields.price.value.trim();
  product.quantity = Number(fields.quantity.value || 0);
  product.skuPrefix = fields.skuPrefix.value.trim() || "AX";
  product.ebayRegion = fields.region.value || selectedRegion || "au";
  product.categoryHints = fields.categoryHints.value.split(",").map((hint) => hint.trim()).filter(Boolean);
  product.condition = fields.condition.value;
  product.specifications = specifics;
  product.variationDimensions = dimensions;

  product.variations.forEach((variation, index) => {
    if (!variation.sku) variation.sku = `${product.skuPrefix}-${index + 1}`;
  });

  return product;
}

function applyMarkup() {
  const percent = Number(fields.markupPercent.value || 0);
  const multiplier = 1 + percent / 100;
  const current = Number(String(fields.price.value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(current) || current <= 0) {
    setStatus("Enter a numeric price before applying markup.");
    return;
  }
  fields.price.value = (current * multiplier).toFixed(2);
  product.variations.forEach((variation) => {
    const price = Number(String(variation.price).replace(/[^0-9.]/g, ""));
    if (Number.isFinite(price) && price > 0) {
      variation.price = (price * multiplier).toFixed(2);
    }
  });
  renderVariations();
  setStatus("Markup applied. Review prices before listing.");
}

async function listIt() {
  await saveProduct();
  const response = await sendMessage({
    type: "OPEN_EBAY_LISTING",
    product,
    region: product.ebayRegion
  });
  setStatus(response.ok ? `Opened eBay ${response.region.label} listing page.` : response.error || "Could not open eBay.");
}

async function saveSelectedRegion() {
  selectedRegion = fields.region.value;
  if (product) product.ebayRegion = selectedRegion;
  const response = await sendMessage({
    type: "SET_EBAY_REGION",
    region: selectedRegion
  });
  setStatus(response.ok ? `Region set to ${response.region.label}.` : response.error || "Could not save region.");
}

function buildVariationTsv() {
  const current = collectProduct();
  const headers = ["SKU", ...dimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image"];
  const rows = current.variations
    .filter((variation) => variation.selected !== false)
    .map((variation) => [
      variation.sku,
      ...dimensions.map((dimension) => variation.options[dimension.name] || ""),
      variation.price,
      variation.quantity,
      variation.imageUrl || ""
    ]);
  return [headers, ...rows].map((row) => row.join("\t")).join("\n");
}

async function exportCsv() {
  const csv = buildCsv();
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(fields.title.value || "am-ebay-variations")}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("CSV exported.");
}

function buildCsv() {
  const current = collectProduct();
  const headers = ["SKU", ...dimensions.map((dimension) => dimension.name), "Price", "Quantity", "Image"];
  const rows = current.variations
    .filter((variation) => variation.selected !== false)
    .map((variation) => [
      variation.sku,
      ...dimensions.map((dimension) => variation.options[dimension.name] || ""),
      variation.price,
      variation.quantity,
      variation.imageUrl || ""
    ]);
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value) {
  const text = String(value == null ? "" : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function copyText(text, message) {
  await navigator.clipboard.writeText(text || "");
  setStatus(message);
}

function cleanName(name) {
  return String(name || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "am-ebay-export";
}

function setStatus(message) {
  statusEl.textContent = message || "";
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
