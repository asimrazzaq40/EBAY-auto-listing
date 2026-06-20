const lockScreen = document.getElementById("lock-screen");
const toolsScreen = document.getElementById("tools-screen");
const lockForm = document.getElementById("lock-form");
const passwordInput = document.getElementById("password");
const lockStatus = document.getElementById("lock-status");
const statusEl = document.getElementById("status");
const productTitleEl = document.getElementById("product-title");
const productSummaryEl = document.getElementById("product-summary");
const regionSelect = document.getElementById("region-select");

document.getElementById("scrape-btn").addEventListener("click", scrapeProduct);
document.getElementById("editor-btn").addEventListener("click", openEditor);
document.getElementById("list-btn").addEventListener("click", listIt);
document.getElementById("lock-btn").addEventListener("click", lock);
regionSelect.addEventListener("change", saveRegion);

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  lockStatus.textContent = "";
  const response = await sendMessage({
    type: "VERIFY_PASSWORD",
    password: passwordInput.value
  });

  if (response.ok && response.unlocked) {
    passwordInput.value = "";
    await showTools();
    return;
  }

  lockStatus.textContent = "Access denied.";
  passwordInput.select();
});

init();

async function init() {
  const response = await sendMessage({ type: "IS_UNLOCKED" });
  if (response.ok && response.unlocked) {
    await showTools();
  } else {
    showLock();
  }
}

function showLock() {
  lockScreen.classList.add("active");
  toolsScreen.classList.remove("active");
  setTimeout(() => passwordInput.focus(), 50);
}

async function showTools() {
  lockScreen.classList.remove("active");
  toolsScreen.classList.add("active");
  await refreshProductSummary();
}

async function refreshProductSummary() {
  const response = await sendMessage({ type: "GET_PRODUCT" });
  renderRegions(response.ebayRegions || [], response.selectedRegion);
  if (!response.ok || !response.product) {
    productTitleEl.textContent = "No product loaded";
    productSummaryEl.textContent = "Open an AliExpress product page and scrape it.";
    return;
  }

  const product = response.product;
  productTitleEl.textContent = product.title || "Untitled product";
  productSummaryEl.textContent = [
    `${(product.images || []).length} images`,
    `${(product.variations || []).length} variations`,
    `${Object.keys(product.specifications || {}).length} specs`,
    `region: ${selectedRegionLabel(response.ebayRegions || [], response.selectedRegion)}`
  ].join(" | ");
}

function renderRegions(regions, selectedRegion) {
  if (!regions.length) return;
  const current = regionSelect.value || selectedRegion;
  regionSelect.textContent = "";
  regions.forEach((region) => {
    const option = document.createElement("option");
    option.value = region.code;
    option.textContent = `${region.label} (${region.domain})`;
    regionSelect.appendChild(option);
  });
  regionSelect.value = selectedRegion || current || regions[0].code;
}

function selectedRegionLabel(regions, selectedRegion) {
  const region = regions.find((candidate) => candidate.code === selectedRegion);
  return region ? region.label : selectedRegion || "default";
}

async function saveRegion() {
  const response = await sendMessage({
    type: "SET_EBAY_REGION",
    region: regionSelect.value
  });
  if (response.ok) {
    setStatus(`Region set to ${response.region.label}.`);
  } else {
    setStatus(response.error || "Could not save region.");
  }
}

async function scrapeProduct() {
  setStatus("Scraping current AliExpress product...");
  const response = await sendMessage({ type: "SCRAPE_CURRENT_PRODUCT" });
  if (!response.ok) {
    setStatus(response.error || "Scrape failed.");
    return;
  }
  await refreshProductSummary();
  setStatus("Scraped product data. Opening editor...");
  await openEditor();
}

async function openEditor() {
  const response = await sendMessage({ type: "OPEN_EDITOR" });
  setStatus(response.ok ? "Editor opened." : response.error || "Could not open editor.");
}

async function listIt() {
  const productResponse = await sendMessage({ type: "GET_PRODUCT" });
  if (!productResponse.ok || !productResponse.product) {
    setStatus("No product loaded. Scrape or edit a product first.");
    return;
  }
  const response = await sendMessage({
    type: "OPEN_EBAY_LISTING",
    product: {
      ...productResponse.product,
      ebayRegion: regionSelect.value
    },
    region: regionSelect.value
  });
  setStatus(response.ok ? `Opened eBay ${response.region.label} listing page.` : response.error || "Could not open eBay.");
}

async function lock() {
  await sendMessage({ type: "LOCK" });
  setStatus("");
  showLock();
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
