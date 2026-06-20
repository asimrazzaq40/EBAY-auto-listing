const ownerConfig = {
  accessPassword: "AM-EBAY-2026",
  defaults: {
    condition: "New",
    quantity: 5,
    skuPrefix: "AX",
    markupPercent: 0,
    ebayRegion: "au",
    subtitleEnabled: false,
    shippingPolicy: "",
    paymentPolicy: ""
  }
};

const EBAY_REGIONS = [
  { code: "au", label: "Australia", domain: "www.ebay.com.au", listingUrl: "https://www.ebay.com.au/sl/sell" },
  { code: "us", label: "United States", domain: "www.ebay.com", listingUrl: "https://www.ebay.com/sl/sell" },
  { code: "uk", label: "United Kingdom", domain: "www.ebay.co.uk", listingUrl: "https://www.ebay.co.uk/sl/sell" },
  { code: "ca", label: "Canada", domain: "www.ebay.ca", listingUrl: "https://www.ebay.ca/sl/sell" },
  { code: "de", label: "Germany", domain: "www.ebay.de", listingUrl: "https://www.ebay.de/sl/sell" },
  { code: "fr", label: "France", domain: "www.ebay.fr", listingUrl: "https://www.ebay.fr/sl/sell" },
  { code: "it", label: "Italy", domain: "www.ebay.it", listingUrl: "https://www.ebay.it/sl/sell" },
  { code: "es", label: "Spain", domain: "www.ebay.es", listingUrl: "https://www.ebay.es/sl/sell" }
];

const STORAGE_KEYS = {
  product: "amEbayProduct",
  editorDraft: "amEbayEditorDraft",
  unlockedUntil: "amEbayUnlockedUntil",
  selectedRegion: "amEbaySelectedRegion"
};

const UNLOCK_DURATION_MS = 8 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEYS.selectedRegion, "amEbayDefaults"], (values) => {
    chrome.storage.local.set({
      amEbayDefaults: { ...ownerConfig.defaults, ...(values.amEbayDefaults || {}) },
      [STORAGE_KEYS.selectedRegion]: values[STORAGE_KEYS.selectedRegion] || ownerConfig.defaults.ebayRegion
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });
  return true;
});

async function handleMessage(message, sender) {
  if (!message || !message.type) {
    return { ok: false, error: "Missing message type." };
  }

  switch (message.type) {
    case "VERIFY_PASSWORD":
      return verifyPassword(message.password);
    case "IS_UNLOCKED":
      return { ok: true, unlocked: await isUnlocked() };
    case "LOCK":
      await chrome.storage.session.remove(STORAGE_KEYS.unlockedUntil);
      return { ok: true };
    case "GET_DEFAULTS":
      await requireUnlocked();
      return getDefaults();
    case "SET_EBAY_REGION":
      await requireUnlocked();
      return setSelectedRegion(message.region);
    case "SCRAPE_CURRENT_PRODUCT":
      await requireUnlocked();
      return scrapeCurrentProduct();
    case "SAVE_PRODUCT":
      await requireUnlocked();
      await saveProduct(message.product);
      return { ok: true };
    case "GET_PRODUCT":
      await requireUnlocked();
      return getStoredProduct();
    case "OPEN_EDITOR":
      await requireUnlocked();
      return openEditor();
    case "OPEN_EBAY_LISTING":
      await requireUnlocked();
      if (message.product) {
        await saveProduct(message.product);
      }
      return openEbayListing(message.region);
    case "GET_EXTENSION_INFO":
      return {
        ok: true,
        version: chrome.runtime.getManifest().version,
        name: chrome.runtime.getManifest().name
      };
    case "FETCH_IMAGE_AS_DATA_URL":
      await requireUnlocked();
      return fetchImageAsDataUrl(message.url);
    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

async function verifyPassword(password) {
  if (password !== ownerConfig.accessPassword) {
    return { ok: true, unlocked: false };
  }

  await chrome.storage.session.set({
    [STORAGE_KEYS.unlockedUntil]: Date.now() + UNLOCK_DURATION_MS
  });

  return { ok: true, unlocked: true };
}

async function isUnlocked() {
  const values = await chrome.storage.session.get(STORAGE_KEYS.unlockedUntil);
  const unlockedUntil = Number(values[STORAGE_KEYS.unlockedUntil] || 0);
  if (unlockedUntil <= Date.now()) {
    await chrome.storage.session.remove(STORAGE_KEYS.unlockedUntil);
    return false;
  }
  return true;
}

async function requireUnlocked() {
  if (!(await isUnlocked())) {
    throw new Error("Extension is locked.");
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) {
    throw new Error("No active tab found.");
  }
  return tabs[0];
}

async function scrapeCurrentProduct() {
  const tab = await getActiveTab();
  if (!tab.url || !/^https:\/\/[^/]*aliexpress\.(com|us)\//i.test(tab.url)) {
    throw new Error("Open an AliExpress product page before scraping.");
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "SCRAPE_ALIEXPRESS_PRODUCT"
    });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "AliExpress scraper did not respond.");
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.product]: response.product });
    return { ok: true, product: response.product };
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/content/aliexpress-scraper.js"]
    });
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "SCRAPE_ALIEXPRESS_PRODUCT"
    });
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : "AliExpress scraper failed after injection.");
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.product]: response.product });
    return { ok: true, product: response.product };
  }
}

async function getStoredProduct() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.product,
    STORAGE_KEYS.editorDraft,
    "amEbayDefaults",
    STORAGE_KEYS.selectedRegion
  ]);
  const product = values[STORAGE_KEYS.editorDraft] || values[STORAGE_KEYS.product] || null;
  const selectedRegion = normalizeRegionCode(product?.ebayRegion || values[STORAGE_KEYS.selectedRegion]);
  return {
    ok: true,
    product,
    defaults: { ...ownerConfig.defaults, ...(values.amEbayDefaults || {}) },
    ebayRegions: EBAY_REGIONS,
    selectedRegion
  };
}

async function saveProduct(product) {
  const selectedRegion = product?.ebayRegion ? normalizeRegionCode(product.ebayRegion) : null;
  const values = { [STORAGE_KEYS.product]: product };
  if (selectedRegion) values[STORAGE_KEYS.selectedRegion] = selectedRegion;
  await chrome.storage.local.set(values);
}

async function openEditor() {
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL("pages/editor.html")
  });
  return { ok: true, tabId: tab.id };
}

async function openEbayListing(regionCode) {
  const values = await chrome.storage.local.get([STORAGE_KEYS.product, STORAGE_KEYS.selectedRegion]);
  const productRegion = values[STORAGE_KEYS.product]?.ebayRegion;
  const selectedRegion = normalizeRegionCode(regionCode || productRegion || values[STORAGE_KEYS.selectedRegion]);
  const region = getRegion(selectedRegion);
  await chrome.storage.local.set({ [STORAGE_KEYS.selectedRegion]: region.code });
  const tab = await chrome.tabs.create({ url: region.listingUrl });
  return { ok: true, tabId: tab.id, region };
}

async function getDefaults() {
  const values = await chrome.storage.local.get([STORAGE_KEYS.selectedRegion, "amEbayDefaults"]);
  const selectedRegion = normalizeRegionCode(values[STORAGE_KEYS.selectedRegion]);
  return {
    ok: true,
    defaults: { ...ownerConfig.defaults, ...(values.amEbayDefaults || {}) },
    ebayRegions: EBAY_REGIONS,
    selectedRegion
  };
}

async function setSelectedRegion(regionCode) {
  const selectedRegion = normalizeRegionCode(regionCode);
  await chrome.storage.local.set({ [STORAGE_KEYS.selectedRegion]: selectedRegion });
  return {
    ok: true,
    selectedRegion,
    region: getRegion(selectedRegion)
  };
}

function getRegion(regionCode) {
  return EBAY_REGIONS.find((region) => region.code === regionCode) || EBAY_REGIONS[0];
}

function normalizeRegionCode(regionCode) {
  const code = String(regionCode || ownerConfig.defaults.ebayRegion).toLowerCase();
  return EBAY_REGIONS.some((region) => region.code === code) ? code : ownerConfig.defaults.ebayRegion;
}

async function fetchImageAsDataUrl(url) {
  if (!/^https:\/\/(ae-pic-a1\.aliexpress-media\.com|ae01\.alicdn\.com|[^/]*\.aliexpress\.(com|us))\//i.test(url || "")) {
    throw new Error("Image host is not allowed.");
  }

  const response = await fetch(url, {
    credentials: "omit",
    cache: "force-cache"
  });
  if (!response.ok) {
    throw new Error(`Image fetch failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return {
    ok: true,
    dataUrl: `data:${contentType};base64,${btoa(binary)}`,
    contentType
  };
}
