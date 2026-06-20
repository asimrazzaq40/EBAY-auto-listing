const ownerConfig = {
  accessPassword: "AM-EBAY-2026",
  ebayListingUrl: "https://www.ebay.com.au/sl/sell",
  defaults: {
    condition: "New",
    quantity: 5,
    skuPrefix: "AX",
    markupPercent: 0,
    subtitleEnabled: false,
    shippingPolicy: "",
    paymentPolicy: ""
  }
};

const STORAGE_KEYS = {
  product: "amEbayProduct",
  editorDraft: "amEbayEditorDraft",
  unlockedUntil: "amEbayUnlockedUntil"
};

const UNLOCK_DURATION_MS = 8 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    amEbayDefaults: ownerConfig.defaults
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
      return { ok: true, defaults: ownerConfig.defaults };
    case "SCRAPE_CURRENT_PRODUCT":
      await requireUnlocked();
      return scrapeCurrentProduct();
    case "SAVE_PRODUCT":
      await requireUnlocked();
      await chrome.storage.local.set({ [STORAGE_KEYS.product]: message.product });
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
        await chrome.storage.local.set({ [STORAGE_KEYS.product]: message.product });
      }
      return openEbayListing();
    case "GET_EXTENSION_INFO":
      return {
        ok: true,
        version: chrome.runtime.getManifest().version,
        name: chrome.runtime.getManifest().name
      };
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
    "amEbayDefaults"
  ]);
  const product = values[STORAGE_KEYS.editorDraft] || values[STORAGE_KEYS.product] || null;
  return {
    ok: true,
    product,
    defaults: values.amEbayDefaults || ownerConfig.defaults
  };
}

async function openEditor() {
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL("pages/editor.html")
  });
  return { ok: true, tabId: tab.id };
}

async function openEbayListing() {
  const tab = await chrome.tabs.create({ url: ownerConfig.ebayListingUrl });
  return { ok: true, tabId: tab.id };
}
