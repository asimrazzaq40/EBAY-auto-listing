const ownerConfig = {
  accessPassword: "AM-EBAY-2026",
  ebayAuStartUrl: "https://www.ebay.com.au/sl/sell",
  authTtlMs: 8 * 60 * 60 * 1000,
  defaultQuantity: 5,
  defaultMarkupPercent: 0,
  skuPrefix: "AX"
};

const STORAGE_KEYS = {
  product: "amEbayListingAssistant.product",
  auth: "amEbayListingAssistant.auth",
  settings: "amEbayListingAssistant.settings"
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (!existing[STORAGE_KEYS.settings]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: {
        defaultQuantity: ownerConfig.defaultQuantity,
        defaultMarkupPercent: ownerConfig.defaultMarkupPercent,
        skuPrefix: ownerConfig.skuPrefix,
        condition: "New",
        fillSubtitle: false,
        shippingPolicy: "",
        paymentPolicy: ""
      }
    });
  }
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
  switch (message && message.type) {
    case "AUTH_CHECK":
      return { ok: true, unlocked: await isUnlocked() };

    case "AUTH_UNLOCK":
      return unlock(message.password);

    case "AUTH_LOCK":
      await chrome.storage.local.remove(STORAGE_KEYS.auth);
      return { ok: true };

    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };

    case "SAVE_SETTINGS":
      await assertUnlocked();
      await chrome.storage.local.set({
        [STORAGE_KEYS.settings]: {
          ...(await getSettings()),
          ...(message.settings || {})
        }
      });
      return { ok: true, settings: await getSettings() };

    case "SAVE_PRODUCT":
      await assertUnlocked();
      await saveProduct(message.product);
      return { ok: true };

    case "GET_PRODUCT":
      await assertUnlocked();
      return { ok: true, product: await getProduct(), settings: await getSettings() };

    case "OPEN_EDITOR":
      await assertUnlocked();
      await openExtensionPage("pages/editor.html");
      return { ok: true };

    case "SCRAPED_PRODUCT":
      await assertUnlocked();
      await saveProduct(message.product);
      await openExtensionPage("pages/editor.html");
      return { ok: true };

    case "LIST_IT":
      await assertUnlocked();
      await saveProduct(message.product);
      await chrome.tabs.create({ url: ownerConfig.ebayAuStartUrl });
      return { ok: true };

    case "GET_PRODUCT_FOR_CONTENT":
      if (!sender.tab || !isEbayHost(sender.tab.url || "")) {
        throw new Error("Product data is only available to eBay content scripts.");
      }
      return { ok: true, product: await getProduct(), settings: await getSettings() };

    case "FETCH_IMAGE":
      if (!sender.tab || !isEbayHost(sender.tab.url || "")) {
        throw new Error("Image fetch proxy is only available on eBay pages.");
      }
      return fetchImageAsDataUrl(message.url);

    default:
      return { ok: false, error: "Unknown message type." };
  }
}

async function unlock(password) {
  if (password !== ownerConfig.accessPassword) {
    return { ok: true, unlocked: false };
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.auth]: {
      unlockedAt: Date.now()
    }
  });
  return { ok: true, unlocked: true };
}

async function assertUnlocked() {
  if (!(await isUnlocked())) {
    throw new Error("Extension is locked.");
  }
}

async function isUnlocked() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.auth);
  const auth = stored[STORAGE_KEYS.auth];
  if (!auth || !auth.unlockedAt) {
    return false;
  }

  if (Date.now() - auth.unlockedAt > ownerConfig.authTtlMs) {
    await chrome.storage.local.remove(STORAGE_KEYS.auth);
    return false;
  }

  return true;
}

async function saveProduct(product) {
  const normalized = normalizeProduct(product || {});
  await chrome.storage.local.set({
    [STORAGE_KEYS.product]: normalized
  });
}

async function getProduct() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.product);
  return stored[STORAGE_KEYS.product] || null;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    defaultQuantity: ownerConfig.defaultQuantity,
    defaultMarkupPercent: ownerConfig.defaultMarkupPercent,
    skuPrefix: ownerConfig.skuPrefix,
    condition: "New",
    fillSubtitle: false,
    shippingPolicy: "",
    paymentPolicy: "",
    ...(stored[STORAGE_KEYS.settings] || {})
  };
}

async function openExtensionPage(path) {
  await chrome.tabs.create({
    url: chrome.runtime.getURL(path)
  });
}

async function fetchImageAsDataUrl(url) {
  if (!url || !/^https:\/\/(.*\.)?(alicdn|aliexpress-media)\.com\//i.test(url)) {
    throw new Error("Unsupported image host.");
  }

  const response = await fetch(url, { credentials: "omit", cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  return {
    ok: true,
    dataUrl,
    mimeType: blob.type || "image/jpeg"
  };
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
  });
}

function normalizeProduct(product) {
  const settings = {
    sourceUrl: product.sourceUrl || "",
    scrapedAt: product.scrapedAt || new Date().toISOString(),
    title: String(product.title || "").trim(),
    descriptionHtml: String(product.descriptionHtml || ""),
    priceText: String(product.priceText || ""),
    price: normalizeNumber(product.price),
    currency: String(product.currency || ""),
    quantity: normalizeInteger(product.quantity, ownerConfig.defaultQuantity),
    skuPrefix: String(product.skuPrefix || ownerConfig.skuPrefix),
    categoryHints: arrayOfStrings(product.categoryHints),
    itemSpecifics: normalizeSpecifics(product.itemSpecifics),
    images: normalizeImages(product.images),
    variations: normalizeVariations(product.variations),
    variationDimensions: arrayOfStrings(product.variationDimensions),
    sku: String(product.sku || "").trim()
  };

  if (!settings.sku) {
    settings.sku = `${settings.skuPrefix}-${Date.now().toString(36).toUpperCase()}`;
  }

  return settings;
}

function normalizeVariations(variations) {
  return (Array.isArray(variations) ? variations : [])
    .map((variation, index) => {
      const options = {};
      Object.entries(variation.options || {}).forEach(([name, value]) => {
        const cleanName = String(name || "").trim();
        const cleanValue = String(value || "").trim();
        if (cleanName && cleanValue) {
          options[cleanName] = cleanValue;
        }
      });

      return {
        id: String(variation.id || `variation-${index + 1}`),
        selected: variation.selected !== false,
        sku: String(variation.sku || "").trim(),
        options,
        price: normalizeNumber(variation.price),
        priceText: String(variation.priceText || ""),
        quantity: normalizeInteger(variation.quantity, ownerConfig.defaultQuantity),
        image: normalizeImageUrl(variation.image || "")
      };
    })
    .filter((variation) => Object.keys(variation.options).length);
}

function normalizeSpecifics(specifics) {
  const rows = Array.isArray(specifics)
    ? specifics
    : Object.entries(specifics || {}).map(([name, value]) => ({ name, value }));

  const byName = new Map();
  rows.forEach((row) => {
    const name = String(row.name || "").trim();
    const value = String(row.value || "").trim();
    if (!name || !value) {
      return;
    }
    byName.set(name, { name, value });
  });
  return Array.from(byName.values());
}

function normalizeImages(images) {
  const seen = new Set();
  return (Array.isArray(images) ? images : [])
    .map((image) => {
      if (typeof image === "string") {
        return { url: normalizeImageUrl(image), selected: true };
      }
      return {
        url: normalizeImageUrl(image.url || ""),
        alt: String(image.alt || ""),
        selected: image.selected !== false,
        source: String(image.source || "")
      };
    })
    .filter((image) => {
      if (!image.url || seen.has(image.url)) {
        return false;
      }
      seen.add(image.url);
      return true;
    });
}

function arrayOfStrings(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : "";
}

function normalizeInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeImageUrl(url) {
  const clean = String(url || "").trim();
  if (!clean) {
    return "";
  }
  const absolute = clean.startsWith("//") ? `https:${clean}` : clean;
  return absolute
    .replace(/_(\d+)x(\d+)(q\d+)?\.(jpg|jpeg|png|webp)$/i, ".$4")
    .replace(/_(\d+)x(\d+)\.(jpg|jpeg|png|webp)(_.webp)?$/i, ".$3")
    .replace(/\.(jpg|jpeg|png|webp)_(\d+)x(\d+)(q\d+)?\.(jpg|jpeg|png|webp)$/i, ".$1");
}

function isEbayHost(url) {
  try {
    const host = new URL(url).hostname;
    return host.endsWith("ebay.com.au") || host.endsWith("ebay.com");
  } catch (error) {
    return false;
  }
}
