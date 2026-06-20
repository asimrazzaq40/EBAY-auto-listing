const accessPassword = "AM-EBAY-2026";

const STORAGE_KEYS = {
  draft: "amDraft",
  settings: "amSettings",
  ebayState: "amEbayState",
  authState: "amAuthState"
};

const DEFAULT_SETTINGS = {
  quantity: 1,
  condition: "New",
  subtitleEnabled: false,
  shippingPolicy: "",
  paymentPolicy: "",
  returnPolicy: "",
  markupPercent: 0,
  priceStrategy: "lowest"
};

const DEFAULT_EBAY_STATE = {
  autoStartArmed: false,
  lastStatus: "",
  lastOpenedAt: 0,
  targetUrl: "https://www.ebay.com.au/sl/sell"
};

function getSessionStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function sessionGet(keys) {
  return getSessionStorageArea().get(keys);
}

async function sessionSet(values) {
  return getSessionStorageArea().set(values);
}

function dedupeStrings(values) {
  const seen = new Set();
  return (values || []).filter((value) => {
    const normalized = String(value || "").trim();
    if (!normalized) {
      return false;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeSpecifics(inputSpecifics = []) {
  const specifics = [];
  for (const entry of inputSpecifics) {
    if (!entry) {
      continue;
    }
    const name = String(entry.name || "").trim();
    const value = String(entry.value || "").trim();
    if (!name || !value) {
      continue;
    }
    specifics.push({
      name,
      value,
      enabled: entry.enabled !== false
    });
  }
  return specifics;
}

function normalizeImages(images = []) {
  return dedupeStrings(
    images
      .map((image) => (typeof image === "string" ? image : image?.url))
      .filter(Boolean)
  ).map((url) => ({ url, selected: true }));
}

function normalizeVariationRows(variations = {}) {
  const rows = Array.isArray(variations.rows) ? variations.rows : [];
  return rows.map((row, index) => ({
    id: row.id || `row-${index + 1}`,
    sku: String(row.sku || "").trim(),
    optionValues: row.optionValues && typeof row.optionValues === "object" ? row.optionValues : {},
    price: Number.isFinite(Number(row.price)) ? Number(row.price) : "",
    quantity: Number.isFinite(Number(row.quantity)) ? Number(row.quantity) : 1,
    imageUrl: row.imageUrl || "",
    selected: row.selected !== false
  }));
}

function buildDraft(input = {}) {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(input.settings || {})
  };

  const categoryHints = Array.isArray(input.categoryHints)
    ? dedupeStrings(input.categoryHints)
    : dedupeStrings(String(input.categoryHints || "").split(","));

  const draft = {
    id: input.id || `draft-${Date.now()}`,
    source: input.source || "aliexpress",
    sourceUrl: input.sourceUrl || "",
    scrapedAt: input.scrapedAt || new Date().toISOString(),
    title: String(input.title || "").trim(),
    descriptionHtml: String(input.descriptionHtml || "").trim(),
    price: Number.isFinite(Number(input.price)) ? Number(input.price) : "",
    currencyText: String(input.currencyText || "").trim(),
    quantity: Number.isFinite(Number(input.quantity)) ? Number(input.quantity) : settings.quantity,
    sku: String(input.sku || "").trim(),
    skuPrefix: String(input.skuPrefix || "").trim(),
    categoryHints,
    specifics: normalizeSpecifics(input.specifics),
    images: normalizeImages(input.images),
    variations: {
      dimensions: Array.isArray(input.variations?.dimensions)
        ? input.variations.dimensions.map((dimension) => ({
            name: String(dimension.name || "").trim(),
            values: dedupeStrings(dimension.values || []),
            enabled: dimension.enabled !== false
          }))
        : [],
      rows: normalizeVariationRows(input.variations),
      enabled: input.variations?.enabled !== false
    },
    settings
  };

  if (!draft.descriptionHtml && draft.specifics.length) {
    const items = draft.specifics
      .slice(0, 10)
      .map((entry) => `<li><strong>${entry.name}:</strong> ${entry.value}</li>`)
      .join("");
    draft.descriptionHtml = `<div><p>${draft.title}</p><ul>${items}</ul></div>`;
  }

  return draft;
}

async function getDraft() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.draft);
  return stored[STORAGE_KEYS.draft] ? buildDraft(stored[STORAGE_KEYS.draft]) : null;
}

async function saveDraft(draft) {
  const normalized = buildDraft(draft);
  await chrome.storage.local.set({ [STORAGE_KEYS.draft]: normalized });
  return normalized;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEYS.settings] || {})
  };
}

async function saveSettings(settings) {
  const merged = {
    ...(await getSettings()),
    ...(settings || {})
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: merged });
  return merged;
}

async function getEbayState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.ebayState);
  return {
    ...DEFAULT_EBAY_STATE,
    ...(stored[STORAGE_KEYS.ebayState] || {})
  };
}

async function saveEbayState(patch) {
  const nextState = {
    ...(await getEbayState()),
    ...(patch || {})
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.ebayState]: nextState });
  return nextState;
}

async function isUnlocked() {
  const stored = await sessionGet(STORAGE_KEYS.authState);
  return Boolean(stored?.[STORAGE_KEYS.authState]?.unlocked);
}

async function setUnlocked(unlocked) {
  await sessionSet({
    [STORAGE_KEYS.authState]: {
      unlocked: Boolean(unlocked),
      updatedAt: Date.now()
    }
  });
}

async function openEditorPage() {
  const url = chrome.runtime.getURL("pages/editor.html");
  return chrome.tabs.create({ url });
}

async function openEbayListingPage() {
  const draft = await getDraft();
  const ebayState = await saveEbayState({
    autoStartArmed: true,
    lastOpenedAt: Date.now(),
    lastStatus: draft?.title ? `Prepared ${draft.title}` : "Prepared draft"
  });
  return chrome.tabs.create({ url: ebayState.targetUrl });
}

async function sendMessageToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab available.");
  }
  return chrome.tabs.sendMessage(tab.id, message);
}

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await saveSettings(settings);
  await saveEbayState(DEFAULT_EBAY_STATE);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "AM_VERIFY_PASSWORD": {
        const provided = String(message.password || "");
        const ok = provided === accessPassword;
        if (ok) {
          await setUnlocked(true);
        }
        sendResponse({ ok });
        return;
      }
      case "AM_AUTH_STATUS": {
        sendResponse({ ok: await isUnlocked() });
        return;
      }
      case "AM_LOGOUT": {
        await setUnlocked(false);
        sendResponse({ ok: true });
        return;
      }
      case "AM_GET_DRAFT": {
        sendResponse({ ok: true, draft: await getDraft() });
        return;
      }
      case "AM_SAVE_DRAFT": {
        const saved = await saveDraft(message.draft || {});
        sendResponse({ ok: true, draft: saved });
        return;
      }
      case "AM_GET_SETTINGS": {
        sendResponse({ ok: true, settings: await getSettings() });
        return;
      }
      case "AM_SAVE_SETTINGS": {
        sendResponse({ ok: true, settings: await saveSettings(message.settings || {}) });
        return;
      }
      case "AM_GET_EBAY_STATE": {
        sendResponse({ ok: true, ebayState: await getEbayState() });
        return;
      }
      case "AM_SAVE_EBAY_STATE": {
        sendResponse({ ok: true, ebayState: await saveEbayState(message.patch || {}) });
        return;
      }
      case "AM_OPEN_EDITOR": {
        const tab = await openEditorPage();
        sendResponse({ ok: true, tabId: tab.id });
        return;
      }
      case "AM_OPEN_EBAY_LISTING": {
        const tab = await openEbayListingPage();
        sendResponse({ ok: true, tabId: tab.id });
        return;
      }
      case "AM_SCRAPE_ACTIVE_PRODUCT": {
        const payload = await sendMessageToActiveTab({ type: "AM_SCRAPE_CURRENT_PRODUCT" });
        const mergedDraft = await saveDraft({
          ...(await getDraft()),
          ...(payload?.product || {})
        });
        sendResponse({ ok: true, draft: mergedDraft });
        return;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message type." });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });

  return true;
});
