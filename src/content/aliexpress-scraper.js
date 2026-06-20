(() => {
  const SPEC_NAME_MAP = new Map([
    ["brand name", "Brand"],
    ["brand", "Brand"],
    ["material", "Material"],
    ["feature", "Features"],
    ["features", "Features"],
    ["model", "Model"],
    ["compatible brand", "Compatible Brand"],
    ["compatible model", "Compatible Model"],
    ["color", "Colour"],
    ["colour", "Colour"],
    ["size", "Size"],
    ["length", "Length"],
    ["type", "Type"],
    ["design", "Design/Finish"],
    ["finish", "Design/Finish"],
    ["control style", "Control Style"],
    ["lighting technology", "Lighting Technology"],
    ["sensor type", "Sensor Type"],
    ["connectivity", "Connectivity"]
  ]);

  const PHONE_MODEL_PATTERN = /(iphone|samsung|galaxy|redmi|xiaomi|huawei|pixel|oneplus|ipad|oppo|vivo|nokia|motorola|sony)/i;
  const LENGTH_PATTERN = /\b(\d+(?:\.\d+)?)\s*(cm|mm|m|meter|metre|ft|inch|in)\b/i;

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanTitle(title) {
    const cleaned = normalizeWhitespace(title)
      .replace(/\|\s*AliExpress.*$/i, "")
      .replace(/-?\s*AliExpress.*$/i, "")
      .replace(/\bfree shipping\b/gi, "")
      .replace(/\bofficial store\b/gi, "")
      .replace(/\bshop now\b/gi, "")
      .trim();

    const words = cleaned.split(" ");
    const deduped = [];
    for (const word of words) {
      if (!deduped.length || deduped[deduped.length - 1].toLowerCase() !== word.toLowerCase()) {
        deduped.push(word);
      }
    }
    return deduped.join(" ").trim();
  }

  function normalizeSpecificName(name) {
    const key = normalizeWhitespace(name).toLowerCase();
    return SPEC_NAME_MAP.get(key) || normalizeWhitespace(name);
  }

  function normalizeImageUrl(url) {
    if (!url) {
      return "";
    }
    let output = String(url).trim();
    if (output.startsWith("//")) {
      output = `https:${output}`;
    }
    output = output.replace(/(\.jpg|\.jpeg|\.png|\.webp|\.gif)(_.+?)?(?=$|\?)/i, "$1");
    output = output.replace(/\.((\d+)x(\d+))\./i, ".");
    return output;
  }

  function dedupeBy(items, keyFn) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
      const key = keyFn(item);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      output.push(item);
    }
    return output;
  }

  function parseCurrencyText(text) {
    const match = String(text || "").match(/(AU\$|US\$|A\$|USD|AUD|PKR|EUR|GBP|\$)/i);
    return match ? match[1].toUpperCase() : "";
  }

  function parseNumericValues(text) {
    return [...String(text || "").matchAll(/(\d{1,3}(?:[,\s]\d{3})*|\d+)(?:\.(\d{1,2}))?/g)]
      .map((match) => {
        const whole = match[1].replace(/[,\s]/g, "");
        const decimals = match[2] ? `.${match[2]}` : "";
        return Number(`${whole}${decimals}`);
      })
      .filter((value) => Number.isFinite(value));
  }

  function choosePrice(textCandidates) {
    const numericCandidates = [];
    for (const text of textCandidates) {
      const values = parseNumericValues(text);
      for (const value of values) {
        if (value > 0) {
          numericCandidates.push(value);
        }
      }
    }
    if (!numericCandidates.length) {
      return "";
    }
    return Number(Math.min(...numericCandidates).toFixed(2));
  }

  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function extractBalancedJson(text, marker) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }
    const start = text.indexOf("{", markerIndex + marker.length);
    if (start === -1) {
      return null;
    }
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escapeNext) {
          escapeNext = false;
        } else if (character === "\\") {
          escapeNext = true;
        } else if (character === "\"") {
          inString = false;
        }
        continue;
      }

      if (character === "\"") {
        inString = true;
        continue;
      }
      if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, index + 1);
        }
      }
    }
    return null;
  }

  function walk(value, visitor, path = []) {
    if (value === null || value === undefined) {
      return;
    }
    visitor(value, path);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, visitor, path.concat(index)));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => walk(entry, visitor, path.concat(key)));
    }
  }

  function collectScriptObjects() {
    const objects = [];
    const directScripts = document.querySelectorAll('script[type="application/ld+json"], script#__NEXT_DATA__');
    for (const script of directScripts) {
      const parsed = parseJson(script.textContent.trim());
      if (parsed) {
        objects.push(parsed);
      }
    }

    const markers = ["runParams.data", "window.runParams", "__INITIAL_STATE__", "_init_data_", "window.__data"];
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (!text) {
        continue;
      }
      for (const marker of markers) {
        const candidate = extractBalancedJson(text, marker);
        if (!candidate) {
          continue;
        }
        const parsed = parseJson(candidate);
        if (parsed) {
          objects.push(parsed);
        }
      }
    }
    return objects;
  }

  function collectValuesByKeys(objects, keys) {
    const results = [];
    walk(objects, (value, path) => {
      const lastKey = path[path.length - 1];
      if (keys.includes(lastKey)) {
        results.push(value);
      }
    });
    return results;
  }

  function getVisibleTextFromSelectors(selectors) {
    const texts = [];
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const text = normalizeWhitespace(element.textContent || "");
        if (text) {
          texts.push(text);
        }
      }
    }
    return texts;
  }

  function extractTitle(scriptObjects) {
    const visibleTitle =
      document.querySelector("h1")?.textContent ||
      document.querySelector('[data-pl="product-title"]')?.textContent ||
      document.querySelector('[class*="title"] h1')?.textContent;
    const metaTitle = document.querySelector('meta[property="og:title"]')?.content;

    const scriptedTitles = collectValuesByKeys(scriptObjects, ["subject", "title", "productTitle"])
      .filter((value) => typeof value === "string")
      .map(cleanTitle)
      .filter(Boolean);

    return cleanTitle(visibleTitle || metaTitle || scriptedTitles[0] || document.title);
  }

  function extractSpecs(scriptObjects) {
    const specifics = [];

    const rowSelectors = [
      '[class*="spec"] tr',
      '[class*="specification"] tr',
      '[class*="product-prop"] tr',
      'dl[class*="spec"]',
      'div[class*="spec"] li'
    ];

    for (const selector of rowSelectors) {
      for (const row of document.querySelectorAll(selector)) {
        const keyCandidate =
          row.querySelector("th, dt, strong, .attr-name, .key, [class*='title']")?.textContent ||
          row.children?.[0]?.textContent ||
          "";
        const valueCandidate =
          row.querySelector("td, dd, .attr-value, .value, [class*='content']")?.textContent ||
          row.children?.[1]?.textContent ||
          row.textContent ||
          "";
        const name = normalizeSpecificName(keyCandidate.replace(/[:：]$/, ""));
        const value = normalizeWhitespace(valueCandidate.replace(keyCandidate, ""));
        if (name && value) {
          specifics.push({ name, value, enabled: true });
        }
      }
    }

    walk(scriptObjects, (value) => {
      if (!Array.isArray(value)) {
        return;
      }
      for (const entry of value) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const name = entry.attrName || entry.attrTitle || entry.specName || entry.propertyName;
        const valueText =
          entry.attrValue || entry.attrValueName || entry.specValue || entry.propertyValue || entry.value;
        if (name && valueText && typeof valueText !== "object") {
          specifics.push({
            name: normalizeSpecificName(name),
            value: normalizeWhitespace(valueText),
            enabled: true
          });
        }
      }
    });

    return dedupeBy(
      specifics.filter((entry) => entry.name && entry.value),
      (entry) => `${entry.name.toLowerCase()}::${entry.value.toLowerCase()}`
    );
  }

  function stripNoise(element) {
    const clone = element.cloneNode(true);
    const removeSelectors = [
      "script",
      "style",
      "button",
      "video",
      "iframe",
      "[class*='recommend']",
      "[class*='related']",
      "[class*='review']",
      "[class*='store']",
      "[class*='footer']",
      "[class*='banner']",
      "[class*='advert']"
    ];
    for (const selector of removeSelectors) {
      clone.querySelectorAll(selector).forEach((node) => node.remove());
    }
    clone.querySelectorAll("*").forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const keep = ["src", "href", "alt"];
        if (!keep.includes(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return clone;
  }

  function buildFallbackDescription(title, specifics) {
    const bulletHtml = specifics
      .slice(0, 12)
      .map((entry) => `<li><strong>${entry.name}:</strong> ${entry.value}</li>`)
      .join("");
    return `<div><p>${title}</p>${bulletHtml ? `<ul>${bulletHtml}</ul>` : ""}</div>`;
  }

  function extractDescription(scriptObjects, title, specifics) {
    const selectors = [
      "#product-description",
      '[class*="description"]',
      '[class*="detail-desc"]',
      '[data-pl="product-description"]',
      '[class*="product-desc"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (!element) {
        continue;
      }
      const cleaned = stripNoise(element);
      const html = normalizeWhitespace(cleaned.innerHTML.replace(/\s{2,}/g, " "));
      if (html && html.length > 80) {
        return html;
      }
    }

    const richTextCandidates = collectValuesByKeys(scriptObjects, ["description", "productDescription"])
      .filter((value) => typeof value === "string" && value.includes("<"));
    if (richTextCandidates[0]) {
      return richTextCandidates[0];
    }

    return buildFallbackDescription(title, specifics);
  }

  function looksLikeNoiseImage(node) {
    const src = normalizeImageUrl(node.currentSrc || node.src || node.getAttribute("data-src") || "");
    if (!src) {
      return true;
    }
    const surroundingText = normalizeWhitespace(node.closest("div, li, section")?.textContent || "");
    return /review|related|recommend|banner|logo|icon|size chart/i.test(surroundingText);
  }

  function extractImages(scriptObjects) {
    const images = [];
    const gallerySelectors = [
      '[class*="gallery"] img',
      '[class*="image"] img',
      '[class*="slider"] img',
      'img[src*="alicdn.com"]',
      'img[src*="aliexpress-media.com"]'
    ];

    for (const selector of gallerySelectors) {
      for (const image of document.querySelectorAll(selector)) {
        if (looksLikeNoiseImage(image)) {
          continue;
        }
        const candidate = normalizeImageUrl(
          image.currentSrc ||
            image.src ||
            image.getAttribute("src") ||
            image.getAttribute("data-src") ||
            image.getAttribute("image-src")
        );
        if (candidate) {
          images.push({ url: candidate, selected: true });
        }
      }
    }

    const scriptImages = collectValuesByKeys(scriptObjects, [
      "imagePathList",
      "imageURLs",
      "mainImageList",
      "skuPropertyImagePath",
      "skuImage"
    ]);
    for (const value of scriptImages.flat(Infinity)) {
      if (typeof value === "string") {
        images.push({ url: normalizeImageUrl(value), selected: true });
      }
    }

    return dedupeBy(images.filter((entry) => entry.url), (entry) => entry.url.toLowerCase());
  }

  function normalizeDimensionName(name, values, title) {
    const normalized = normalizeWhitespace(name || "Option");
    const lowered = normalized.toLowerCase();
    const sample = (values || []).join(" ");

    if ((lowered.includes("color") || lowered.includes("colour")) && PHONE_MODEL_PATTERN.test(sample)) {
      return "Compatible Model";
    }
    if ((lowered.includes("color") || lowered.includes("colour")) && LENGTH_PATTERN.test(sample)) {
      return "Length";
    }
    if (lowered.includes("size") && LENGTH_PATTERN.test(sample)) {
      return "Length";
    }
    if (lowered.includes("model") || PHONE_MODEL_PATTERN.test(sample) || PHONE_MODEL_PATTERN.test(title)) {
      if (PHONE_MODEL_PATTERN.test(sample) && !/(red|blue|black|white|green|pink|purple|gold|silver)/i.test(sample)) {
        return "Compatible Model";
      }
    }
    if (lowered.includes("plug")) {
      return "Plug Type";
    }
    return normalized
      .replace(/\bcolour\b/i, "Colour")
      .replace(/\bcolor\b/i, "Color");
  }

  function ensureUniqueDimensionNames(dimensions, title) {
    const seen = new Set();
    return dimensions.map((dimension, index) => {
      const baseName = normalizeDimensionName(dimension.name, dimension.values, title) || `Option ${index + 1}`;
      const alternatives = [baseName];
      if (baseName === "Color" && PHONE_MODEL_PATTERN.test((dimension.values || []).join(" "))) {
        alternatives.unshift("Compatible Model");
      }
      if (baseName === "Color" && LENGTH_PATTERN.test((dimension.values || []).join(" "))) {
        alternatives.unshift("Length");
      }
      let finalName = alternatives.find((name) => !seen.has(name)) || baseName;
      if (seen.has(finalName)) {
        let counter = 2;
        while (seen.has(`${baseName} ${counter}`)) {
          counter += 1;
        }
        finalName = `${baseName} ${counter}`;
      }
      seen.add(finalName);
      return { ...dimension, name: finalName };
    });
  }

  function parseSkuAttributes(rawSkuAttr, propertyMap) {
    const optionValues = {};
    const attributeText = String(rawSkuAttr || "");
    for (const token of attributeText.split("#")) {
      const [propertyId, valueId] = token.split(":");
      if (!propertyId || !valueId) {
        continue;
      }
      const property = propertyMap[propertyId];
      const propertyValue = property?.values?.[valueId];
      if (property && propertyValue) {
        optionValues[property.name] = propertyValue.name;
      }
    }
    return optionValues;
  }

  function extractVariations(scriptObjects, basePrice, baseQuantity, title) {
    const dimensions = [];
    const rows = [];

    walk(scriptObjects, (value) => {
      if (!value || typeof value !== "object") {
        return;
      }
      const propertyList =
        value.productSKUPropertyList ||
        value.skuPropertyList ||
        value.productSkuPropertyList ||
        value.productSKUProps;
      const priceList = value.skuPriceList || value.skuPriceJson || value.skuList || value.skuPriceArray;
      if (!Array.isArray(propertyList) || !Array.isArray(priceList)) {
        return;
      }

      const propertyMap = {};
      for (const property of propertyList) {
        const propertyId = String(
          property.skuPropertyId || property.propertyId || property.id || property.attrId || property.pid || ""
        );
        const rawValues =
          property.skuPropertyValues || property.values || property.propertyValues || property.valueList || [];
        const values = dedupeBy(
          rawValues
            .map((entry) => ({
              id: String(
                entry.propertyValueIdLong ||
                  entry.propertyValueId ||
                  entry.id ||
                  entry.valueId ||
                  entry.vid ||
                  ""
              ),
              name: normalizeWhitespace(
                entry.propertyValueDisplayName ||
                  entry.propertyValueDefinitionName ||
                  entry.skuPropertyValue ||
                  entry.name ||
                  entry.value ||
                  entry.attrValue ||
                  ""
              ),
              imageUrl: normalizeImageUrl(entry.skuPropertyImagePath || entry.imageUrl || entry.image || "")
            }))
            .filter((entry) => entry.id && entry.name),
          (entry) => `${entry.id}::${entry.name.toLowerCase()}`
        );

        const dimension = {
          id: propertyId,
          name: property.skuPropertyName || property.attrName || property.name || "Option",
          values: values.map((entry) => entry.name),
          enabled: true
        };
        dimensions.push(dimension);
        propertyMap[propertyId] = {
          ...dimension,
          values: Object.fromEntries(values.map((entry) => [entry.id, entry]))
        };
      }

      for (const priceEntry of priceList) {
        const optionValues = parseSkuAttributes(priceEntry.skuAttr || priceEntry.skuPropIds, propertyMap);
        if (!Object.keys(optionValues).length && typeof priceEntry.skuPropertiesName === "string") {
          for (const part of priceEntry.skuPropertiesName.split(";")) {
            const [rawName, rawValue] = part.split(":");
            if (rawName && rawValue) {
              optionValues[normalizeWhitespace(rawName)] = normalizeWhitespace(rawValue);
            }
          }
        }

        const amountCandidate =
          priceEntry.skuVal?.skuActivityAmount?.value ||
          priceEntry.skuVal?.skuCalPrice ||
          priceEntry.skuVal?.skuAmount?.value ||
          priceEntry.skuAmount?.value ||
          priceEntry.price ||
          basePrice;

        const quantityCandidate =
          priceEntry.skuVal?.availQuantity ||
          priceEntry.availQuantity ||
          priceEntry.inventory ||
          priceEntry.stock ||
          baseQuantity;

        const imageUrl =
          normalizeImageUrl(priceEntry.imageUrl || priceEntry.skuImage || "") ||
          Object.values(optionValues)
            .map((valueName) =>
              Object.values(propertyMap)
                .flatMap((property) => Object.values(property.values))
                .find((entry) => entry.name === valueName)?.imageUrl
            )
            .find(Boolean) ||
          "";

        rows.push({
          id: priceEntry.skuIdStr || priceEntry.skuId || priceEntry.offerId || `sku-${rows.length + 1}`,
          sku: String(priceEntry.skuIdStr || priceEntry.skuId || priceEntry.skuCode || "").trim(),
          optionValues,
          price: Number.isFinite(Number(amountCandidate)) ? Number(amountCandidate) : basePrice,
          quantity: Number.isFinite(Number(quantityCandidate)) ? Number(quantityCandidate) : baseQuantity,
          imageUrl,
          selected: true
        });
      }
    });

    if (!rows.length) {
      const domGroups = [];
      document.querySelectorAll('[class*="sku"] [class*="item"], [class*="sku"] [class*="property"]').forEach((node) => {
        const label =
          node.querySelector("[class*='title'], [class*='name'], strong")?.textContent ||
          node.getAttribute("data-attr-name") ||
          "";
        const values = [...node.querySelectorAll("img[alt], button, li, span")]
          .map((entry) => normalizeWhitespace(entry.getAttribute("alt") || entry.textContent || ""))
          .filter(Boolean);
        if (label && values.length) {
          domGroups.push({ name: label.replace(/[:：]$/, ""), values, enabled: true });
        }
      });
      dimensions.push(...domGroups);
    }

    const uniqueDimensions = ensureUniqueDimensionNames(
      dedupeBy(dimensions, (entry) => `${entry.name.toLowerCase()}::${(entry.values || []).join("|").toLowerCase()}`),
      title
    );

    for (const row of rows) {
      const normalizedOptions = {};
      for (const dimension of uniqueDimensions) {
        normalizedOptions[dimension.name] =
          row.optionValues[dimension.name] ||
          row.optionValues[normalizeDimensionName(dimension.name, dimension.values, title)] ||
          row.optionValues[dimension.id] ||
          "";
      }
      row.optionValues = normalizedOptions;
    }

    return {
      dimensions: uniqueDimensions.map(({ name, values, enabled }) => ({ name, values, enabled })),
      rows: dedupeBy(
        rows.filter((entry) => Object.values(entry.optionValues || {}).some(Boolean)),
        (entry) => JSON.stringify(entry.optionValues)
      )
    };
  }

  function extractPrice(scriptObjects) {
    const visibleCandidates = getVisibleTextFromSelectors([
      '[class*="price"]',
      '[data-pl="product-price"]',
      'meta[property="product:price:amount"]'
    ]);
    const scriptedCandidates = collectValuesByKeys(scriptObjects, [
      "formatedActivityPrice",
      "formatedPrice",
      "activityAmount",
      "minActivityAmount",
      "minAmount",
      "maxAmount",
      "salePrice"
    ]).flatMap((value) => (typeof value === "object" ? Object.values(value) : value));
    const metaAmount = document.querySelector('meta[property="product:price:amount"]')?.content;
    const allTextCandidates = [...visibleCandidates, ...scriptedCandidates, metaAmount].filter(Boolean);
    const price = choosePrice(allTextCandidates);
    const currencyText =
      parseCurrencyText(allTextCandidates.join(" ")) ||
      document.querySelector('meta[property="product:price:currency"]')?.content ||
      "";
    return { price, currencyText };
  }

  function buildCategoryHints(title, specifics) {
    const hints = [];
    const titleTokens = cleanTitle(title)
      .split(/[\s,/]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 3)
      .slice(0, 6);
    hints.push(...titleTokens);
    for (const entry of specifics) {
      if (["Brand", "Type", "Material", "Compatible Model"].includes(entry.name)) {
        hints.push(entry.value);
      }
    }
    return dedupeBy(hints, (value) => value.toLowerCase()).slice(0, 8);
  }

  function scrapeProduct() {
    const scriptObjects = collectScriptObjects();
    const title = extractTitle(scriptObjects);
    const { price, currencyText } = extractPrice(scriptObjects);
    const specifics = extractSpecs(scriptObjects);
    const descriptionHtml = extractDescription(scriptObjects, title, specifics);
    const images = extractImages(scriptObjects);
    const variations = extractVariations(scriptObjects, price || "", 1, title);
    const categoryHints = buildCategoryHints(title, specifics);

    return {
      source: "aliexpress",
      sourceUrl: location.href,
      scrapedAt: new Date().toISOString(),
      title,
      descriptionHtml,
      price,
      currencyText,
      quantity: 1,
      sku: "",
      skuPrefix: "",
      categoryHints,
      specifics,
      images,
      variations
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "AM_SCRAPE_CURRENT_PRODUCT") {
      return false;
    }

    try {
      const product = scrapeProduct();
      sendResponse({ ok: true, product });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
    return true;
  });
})();
