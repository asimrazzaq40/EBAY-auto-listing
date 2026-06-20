const $ = (selector) => document.querySelector(selector);

const elements = {
  lockView: $("#lock-view"),
  toolsView: $("#tools-view"),
  unlockForm: $("#unlock-form"),
  password: $("#password"),
  unlockButton: $("#unlock-button"),
  lockStatus: $("#lock-status"),
  scrapeButton: $("#scrape-button"),
  openEditorButton: $("#open-editor-button"),
  listButton: $("#list-button"),
  lockButton: $("#lock-button"),
  status: $("#status"),
  productSummary: $("#product-summary"),
  productTitle: $("#product-title"),
  productMeta: $("#product-meta")
};

let currentProduct = null;

init();

async function init() {
  bindEvents();
  const auth = await sendRuntime({ type: "AUTH_CHECK" });
  setUnlocked(Boolean(auth.unlocked));
  if (auth.unlocked) {
    await refreshProduct();
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
      await refreshProduct();
    });
  });

  elements.scrapeButton.addEventListener("click", async () => {
    await withButton(elements.scrapeButton, scrapeCurrentProduct);
  });

  elements.openEditorButton.addEventListener("click", async () => {
    await withButton(elements.openEditorButton, async () => {
      await sendRuntime({ type: "OPEN_EDITOR" });
      setStatus("Editor opened.");
    });
  });

  elements.listButton.addEventListener("click", async () => {
    await withButton(elements.listButton, async () => {
      const response = await sendRuntime({ type: "GET_PRODUCT" });
      if (!response.product) {
        setStatus("No product data yet. Scrape or import a product first.");
        return;
      }
      await sendRuntime({ type: "LIST_IT", product: response.product });
      setStatus("eBay AU listing page opened. Use the floating panel to fill fields.");
    });
  });

  elements.lockButton.addEventListener("click", async () => {
    await sendRuntime({ type: "AUTH_LOCK" });
    setUnlocked(false);
  });
}

function setUnlocked(unlocked) {
  elements.lockView.classList.toggle("hidden", unlocked);
  elements.toolsView.classList.toggle("hidden", !unlocked);
  if (!unlocked) {
    elements.password.focus();
  }
}

async function refreshProduct() {
  try {
    const response = await sendRuntime({ type: "GET_PRODUCT" });
    currentProduct = response.product;
    renderProductSummary();
  } catch (error) {
    setStatus(error.message);
  }
}

function renderProductSummary() {
  if (!currentProduct) {
    elements.productSummary.classList.add("hidden");
    return;
  }

  elements.productSummary.classList.remove("hidden");
  elements.productTitle.textContent = currentProduct.title || "Untitled product";
  elements.productMeta.textContent = [
    currentProduct.price ? `Price: ${currentProduct.price}` : "",
    `${(currentProduct.images || []).length} images`,
    `${(currentProduct.variations || []).length} variations`
  ].filter(Boolean).join(" | ");
}

async function scrapeCurrentProduct() {
  setStatus("Scraping current AliExpress tab...");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    setStatus("No active tab found.");
    return;
  }

  if (!/https:\/\/.*\.aliexpress\.(com|us)\//i.test(tab.url || "")) {
    setStatus("Open an AliExpress product page before scraping.");
    return;
  }

  let scrapeResponse;
  try {
    scrapeResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "SCRAPE_ALIEXPRESS_PRODUCT"
    });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/aliexpress-scraper.js"]
    });
    scrapeResponse = await chrome.tabs.sendMessage(tab.id, {
      type: "SCRAPE_ALIEXPRESS_PRODUCT"
    });
  }

  if (!scrapeResponse || !scrapeResponse.ok) {
    throw new Error((scrapeResponse && scrapeResponse.error) || "Unable to scrape this page.");
  }

  await sendRuntime({
    type: "SCRAPED_PRODUCT",
    product: scrapeResponse.product
  });
  currentProduct = scrapeResponse.product;
  renderProductSummary();
  setStatus("Product scraped and editor opened.");
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

function setStatus(message) {
  elements.status.textContent = message || "";
}

async function sendRuntime(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || response.ok === false) {
    throw new Error((response && response.error) || "Extension request failed.");
  }
  return response;
}
