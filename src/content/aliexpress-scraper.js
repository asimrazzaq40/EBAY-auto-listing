(function initAliExpressScraper() {
  if (window.__amEbayAliExpressScraperLoaded) return;
  window.__amEbayAliExpressScraperLoaded = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "SCRAPE_ALIEXPRESS_PRODUCT") return undefined;
    try {
      sendResponse({ ok: true, product: scrapeProduct() });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
    return true;
  });

  function scrapeProduct() {
    const skuData = extractStructuredSkuData();
    const visiblePrice = extractVisiblePrice();
    const variations = buildVariations(skuData, visiblePrice);
    const dimensions = skuData.dimensions.length
      ? skuData.dimensions
      : inferDimensionsFromRows(variations);
    const images = uniqueImages([
      ...extractGalleryImages(),
      ...skuData.dimensions.flatMap((dimension) => dimension.values.map((value) => value.imageUrl).filter(Boolean)),
      ...variations.map((variation) => variation.imageUrl).filter(Boolean)
    ]);
    const specifications = normalizeSpecifications(extractSpecifications());
    const title = cleanTitle(extractTitle());

    return {
      source: "aliexpress",
      sourceUrl: location.href,
      scrapedAt: new Date().toISOString(),
      title,
      price: chooseProductPrice(variations, visiblePrice),
      originalPriceText: visiblePrice.raw,
      currency: visiblePrice.currency,
      quantity: 5,
      skuPrefix: "AX",
      categoryHints: buildCategoryHints(title, specifications),
      descriptionHtml: buildDescriptionHtml(title, specifications),
      specifications,
      images: images.map((url, index) => ({ url, selected: index < 12, label: `Image ${index + 1}` })),
      variationDimensions: dimensions.map((dimension) => ({ name: dimension.name })),
      variations
    };
  }

  function extractTitle() {
    const visibleTitleSelectors = [
      "h1",
      "[data-pl='product-title']",
      ".product-title-text",
      "[class*='ProductTitle']",
      "[class*='product-title']"
    ];
    for (const selector of visibleTitleSelectors) {
      const value = text(document.querySelector(selector));
      if (value && value.length > 8) return value;
    }

    const ogTitle = document.querySelector("meta[property='og:title']")?.content;
    if (ogTitle) return ogTitle;
    return document.title || "";
  }

  function cleanTitle(value) {
    return cleanText(value)
      .replace(/\s*-\s*AliExpress.*$/i, "")
      .replace(/\bfree shipping\b/gi, "")
      .replace(/\bchoice\b/gi, "")
      .replace(/\bofficial store\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 80);
  }

  function extractVisiblePrice() {
    const selectors = [
      "[class*='price']",
      "[data-pl='product-price']",
      ".product-price-current",
      ".uniform-banner-box-price",
      "meta[property='product:price:amount']"
    ];
    const candidates = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        const value = node.tagName === "META" ? node.content : text(node);
        if (value && /(?:AU|AUD|USD|US \$|\$|PKR|GBP|EUR|€|£|\d)/i.test(value)) {
          candidates.push(value);
        }
      });
    }
    const bodyPrice = document.body.innerText.match(/(?:AU|AUD|USD|US \$|\$|PKR|GBP|EUR|€|£)\s*[0-9][0-9,.]*(?:\s*-\s*(?:AU|AUD|USD|US \$|\$|PKR|GBP|EUR|€|£)?\s*[0-9][0-9,.]*)?/i);
    if (bodyPrice) candidates.push(bodyPrice[0]);

    const parsed = candidates
      .map((raw) => ({ raw, ...parsePrice(raw) }))
      .filter((candidate) => Number.isFinite(candidate.value));

    if (!parsed.length) return { raw: "", value: "", currency: "", range: [] };
    parsed.sort((a, b) => scorePriceText(b.raw) - scorePriceText(a.raw));
    return parsed[0];
  }

  function scorePriceText(raw) {
    let score = 0;
    if (/AU|AUD|\$/i.test(raw)) score += 3;
    if (/-/.test(raw)) score += 1;
    if (raw.length < 60) score += 1;
    if (/review|sold|coupon|shipping/i.test(raw)) score -= 4;
    return score;
  }

  function parsePrice(raw) {
    const currencyMatch = String(raw).match(/AU|AUD|USD|US \$|\$|PKR|GBP|EUR|€|£/i);
    const numbers = Array.from(String(raw).matchAll(/[0-9]+(?:[,.][0-9]{1,3})*/g))
      .map((match) => Number(match[0].replace(/,/g, "")))
      .filter(Number.isFinite);
    return {
      value: numbers.length ? Math.min(...numbers) : "",
      currency: currencyMatch ? currencyMatch[0].replace(/\s+/g, " ").trim() : "",
      range: numbers
    };
  }

  function extractGalleryImages() {
    const urls = [];
    const gallerySelectors = [
      "[class*='gallery'] img",
      "[class*='image-view'] img",
      "[class*='slider'] img",
      "[data-pl='product-main-image'] img",
      "meta[property='og:image']"
    ];

    gallerySelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (node.tagName === "META") {
          urls.push(node.content);
          return;
        }
        urls.push(...imageUrlsFromNode(node));
      });
    });

    document.querySelectorAll("[style*='background-image']").forEach((node) => {
      const match = node.getAttribute("style").match(/url\(['"]?([^'")]+)['"]?\)/i);
      if (match) urls.push(match[1]);
    });

    return uniqueImages(urls);
  }

  function imageUrlsFromNode(node) {
    const urls = [];
    ["src", "data-src", "data-lazy-src", "data-spm-anchor-id"].forEach((attr) => {
      const value = node.getAttribute(attr);
      if (value && /^https?:|^\/\//.test(value)) urls.push(value);
    });
    const srcset = node.getAttribute("srcset") || node.getAttribute("data-srcset") || "";
    srcset.split(",").forEach((part) => {
      const url = part.trim().split(/\s+/)[0];
      if (url) urls.push(url);
    });
    return urls;
  }

  function normalizeImageUrl(url) {
    if (!url) return "";
    let normalized = String(url).trim().replace(/^\/\//, "https://");
    normalized = normalized.replace(/_([0-9]+x[0-9]+|[0-9]+x[0-9]+q[0-9]+)\.(jpg|jpeg|png|webp).*$/i, "");
    normalized = normalized.replace(/\.(jpg|jpeg|png|webp)_[^?]+$/i, ".$1");
    normalized = normalized.replace(/\?.*$/, "");
    return normalized;
  }

  function uniqueImages(urls) {
    const seen = new Set();
    const clean = [];
    urls.map(normalizeImageUrl).forEach((url) => {
      if (!url || seen.has(url) || !isUsableProductImage(url)) return;
      seen.add(url);
      clean.push(url);
    });
    return clean.slice(0, 24);
  }

  function isUsableProductImage(url) {
    if (!/^https?:\/\//i.test(url)) return false;
    if (!/\.(jpg|jpeg|png|webp)(?:$|\?)/i.test(url)) return false;
    if (/sprite|icon|logo|avatar|review|feedback|buyer|size.?chart|loading|transparent|blank/i.test(url)) return false;
    if (/\.gif(?:$|\?)/i.test(url)) return false;
    return true;
  }

  function buildDescriptionHtml(title, specifications) {
    const descriptionSelectors = [
      "#product-description",
      ".product-description",
      "[class*='ProductDescription']",
      "[class*='description']",
      "[data-pl='product-description']"
    ];
    let html = "";
    for (const selector of descriptionSelectors) {
      const node = document.querySelector(selector);
      if (!node || text(node).length < 30) continue;
      const clone = node.cloneNode(true);
      clone.querySelectorAll("script, style, iframe, form, button, nav, footer, [class*='review'], [class*='recommend'], [class*='related'], [class*='store']").forEach((child) => child.remove());
      html = cleanDescriptionHtml(clone.innerHTML);
      if (html.length > 60) break;
    }

    if (!html) {
      const meta = document.querySelector("meta[name='description']")?.content || "";
      html = `<p>${escapeHtml(cleanText(meta || title))}</p>`;
    }

    const specsList = Object.entries(specifications || {})
      .slice(0, 20)
      .map(([name, value]) => `<li><strong>${escapeHtml(name)}:</strong> ${escapeHtml(value)}</li>`)
      .join("");
    return [
      `<h2>${escapeHtml(title)}</h2>`,
      html,
      specsList ? `<h3>Specifications</h3><ul>${specsList}</ul>` : ""
    ].filter(Boolean).join("\n");
  }

  function cleanDescriptionHtml(html) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    wrapper.querySelectorAll("*").forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        if (/^(onclick|onload|style|class|id)$/i.test(attribute.name)) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return wrapper.innerHTML
      .replace(/\s{2,}/g, " ")
      .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .trim();
  }

  function extractSpecifications() {
    const specs = {};
    const candidateRoots = [
      ...document.querySelectorAll("[class*='spec'], [class*='Specification'], [data-pl*='spec']")
    ].filter((node) => text(node).length > 20);

    candidateRoots.forEach((root) => {
      root.querySelectorAll("tr").forEach((row) => {
        const cells = Array.from(row.children).map(text).filter(Boolean);
        if (cells.length >= 2) addSpec(specs, cells[0], cells.slice(1).join(" "));
      });

      root.querySelectorAll("li, div").forEach((node) => {
        const parts = text(node).split(/\s*[:：]\s*/);
        if (parts.length === 2 && parts[0].length < 50 && parts[1].length < 180) {
          addSpec(specs, parts[0], parts[1]);
        }
      });
    });

    document.querySelectorAll("script").forEach((script) => {
      const raw = script.textContent || "";
      const props = findJsonValue(raw, ["props", "specsModule", "productPropList"]);
      collectSpecsFromObject(props, specs);
    });

    return specs;
  }

  function addSpec(specs, name, value) {
    const normalizedName = normalizeSpecificName(name);
    const normalizedValue = cleanText(value);
    if (!normalizedName || !normalizedValue) return;
    if (/shipping|coupon|seller|store|review|feedback|warranty/i.test(normalizedName)) return;
    specs[normalizedName] = normalizedValue;
  }

  function normalizeSpecifications(specs) {
    const normalized = {};
    Object.entries(specs).forEach(([name, value]) => {
      addSpec(normalized, name, value);
    });
    return normalized;
  }

  function normalizeSpecificName(name) {
    const cleaned = cleanText(name).replace(/\s+Name$/i, "");
    const map = [
      [/^brand/i, "Brand"],
      [/material/i, "Material"],
      [/features?/i, "Features"],
      [/compatible\s+brand/i, "Compatible Brand"],
      [/compatible\s+model|phone\s+model/i, "Compatible Model"],
      [/colou?r/i, "Colour"],
      [/design|finish/i, "Design/Finish"],
      [/size/i, "Size"],
      [/length/i, "Length"],
      [/connectivity/i, "Connectivity"],
      [/^model/i, "Model"],
      [/^type/i, "Type"],
      [/control\s+style/i, "Control Style"],
      [/lighting\s+technology/i, "Lighting Technology"],
      [/sensor\s+type/i, "Sensor Type"]
    ];
    const match = map.find(([pattern]) => pattern.test(cleaned));
    return match ? match[1] : cleaned;
  }

  function collectSpecsFromObject(value, specs) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectSpecsFromObject(item, specs));
      return;
    }
    if (typeof value !== "object") return;

    const name = value.attrName || value.name || value.propertyName || value.title;
    const specValue = value.attrValue || value.value || value.propertyValue || value.valueName;
    if (name && specValue) addSpec(specs, name, specValue);
    Object.values(value).forEach((child) => {
      if (typeof child === "object") collectSpecsFromObject(child, specs);
    });
  }

  function extractStructuredSkuData() {
    const result = {
      dimensions: [],
      priceRows: []
    };

    document.querySelectorAll("script").forEach((script) => {
      const raw = script.textContent || "";
      if (!/sku|SKU|price/i.test(raw)) return;

      const propertyList = findJsonValue(raw, [
        "skuPropertyList",
        "productSKUPropertyList",
        "skuProperties",
        "skuProperty"
      ]);
      const priceList = findJsonValue(raw, [
        "skuPriceList",
        "skuPrices",
        "skuList",
        "skuInfo"
      ]);

      const dimensions = parseSkuPropertyList(propertyList);
      const priceRows = parseSkuPriceList(priceList);
      if (dimensions.length) result.dimensions = mergeDimensions(result.dimensions, dimensions);
      if (priceRows.length) result.priceRows.push(...priceRows);
    });

    if (!result.dimensions.length) {
      result.dimensions = extractVisibleVariationDimensions();
    }

    return result;
  }

  function findJsonValue(textValue, keys) {
    const textValueString = String(textValue || "");
    for (const key of keys) {
      const keyPatterns = [`"${key}"`, `'${key}'`, key];
      for (const pattern of keyPatterns) {
        const index = textValueString.indexOf(pattern);
        if (index === -1) continue;
        const colonIndex = textValueString.indexOf(":", index + pattern.length);
        if (colonIndex === -1) continue;
        const valueStart = nextNonWhitespace(textValueString, colonIndex + 1);
        if (valueStart === -1 || !/[{\[]/.test(textValueString[valueStart])) continue;
        const valueText = readBalancedJson(textValueString, valueStart);
        if (!valueText) continue;
        try {
          return JSON.parse(valueText);
        } catch (error) {
          const repaired = valueText.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":').replace(/'/g, '"');
          try {
            return JSON.parse(repaired);
          } catch (innerError) {
            continue;
          }
        }
      }
    }
    return null;
  }

  function nextNonWhitespace(value, index) {
    for (let i = index; i < value.length; i += 1) {
      if (!/\s/.test(value[i])) return i;
    }
    return -1;
  }

  function readBalancedJson(value, start) {
    const open = value[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let i = start; i < value.length; i += 1) {
      const char = value[i];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === open) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) return value.slice(start, i + 1);
      }
    }
    return "";
  }

  function parseSkuPropertyList(propertyList) {
    if (!Array.isArray(propertyList)) return [];
    return mergeDimensions([], propertyList.map((property, index) => {
      const rawName = property.skuPropertyName || property.propertyName || property.name || property.title || `Option ${index + 1}`;
      const values = (property.skuPropertyValues || property.values || property.propertyValues || [])
        .map((value) => {
          const name = value.propertyValueDisplayName || value.skuPropertyValueName || value.propertyValueName || value.name || value.value || value.title;
          const id = value.propertyValueId || value.skuPropertyValueId || value.valueId || value.id || value.vid;
          const imageUrl = normalizeImageUrl(value.skuPropertyImagePath || value.propertyValueDefinitionName || value.imageUrl || value.imgUrl || value.picUrl || value.image);
          return {
            id: id == null ? "" : String(id),
            value: cleanVariationValue(name),
            imageUrl
          };
        })
        .filter((value) => value.value);
      const name = normalizeDimensionName(rawName, values.map((value) => value.value));
      return { id: String(property.skuPropertyId || property.propertyId || property.id || index), name, rawName, values };
    }).filter((dimension) => dimension.values.length));
  }

  function parseSkuPriceList(priceList) {
    const rows = [];
    const flattened = Array.isArray(priceList) ? priceList : priceList && typeof priceList === "object" ? Object.values(priceList) : [];
    flattened.forEach((row) => {
      if (!row || typeof row !== "object") return;
      const ids = extractSkuIds(row);
      const price = firstCleanPrice([
        row.salePriceString,
        row.price,
        row.skuPrice,
        row.displayPrice,
        row.skuVal?.actSkuCalPrice,
        row.skuVal?.skuAmount?.value,
        row.skuVal?.skuActivityAmount?.value
      ]);
      const quantity = Number(row.inventory || row.quantity || row.availQuantity || row.skuVal?.availQuantity || 5);
      rows.push({
        ids,
        price,
        quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 5
      });
    });
    return rows.filter((row) => row.ids.length || row.price);
  }

  function extractSkuIds(row) {
    const candidates = [
      row.skuPropIds,
      row.skuPropId,
      row.skuAttr,
      row.skuIdStr,
      row.skuId,
      row.propPath,
      row.pvs
    ].filter(Boolean);
    const ids = [];
    candidates.forEach((candidate) => {
      String(candidate).split(/[;,|:]/).forEach((part) => {
        const cleaned = part.trim();
        if (cleaned) ids.push(cleaned);
      });
    });
    return Array.from(new Set(ids));
  }

  function firstCleanPrice(values) {
    for (const value of values) {
      const parsed = parsePrice(String(value || ""));
      if (Number.isFinite(parsed.value)) return parsed.value.toFixed(2);
    }
    return "";
  }

  function mergeDimensions(existing, incoming) {
    const byName = new Map(existing.map((dimension) => [dimension.name.toLowerCase(), cloneDimension(dimension)]));
    incoming.forEach((dimension) => {
      const key = dimension.name.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, cloneDimension(dimension));
        return;
      }
      const merged = byName.get(key);
      const seenValues = new Set(merged.values.map((value) => value.value.toLowerCase()));
      dimension.values.forEach((value) => {
        if (!seenValues.has(value.value.toLowerCase())) {
          merged.values.push({ ...value });
          seenValues.add(value.value.toLowerCase());
        }
      });
    });
    return Array.from(byName.values());
  }

  function cloneDimension(dimension) {
    return {
      id: dimension.id,
      name: dimension.name,
      rawName: dimension.rawName || dimension.name,
      values: (dimension.values || []).map((value) => ({ ...value }))
    };
  }

  function buildVariations(skuData, visiblePrice) {
    if (!skuData.dimensions.length) return [];
    const valueById = new Map();
    skuData.dimensions.forEach((dimension) => {
      dimension.values.forEach((value) => {
        if (value.id) valueById.set(value.id, { dimension, value });
      });
    });

    const rows = [];
    skuData.priceRows.forEach((priceRow) => {
      const options = {};
      let imageUrl = "";
      priceRow.ids.forEach((id) => {
        const match = valueById.get(id);
        if (!match) return;
        options[match.dimension.name] = match.value.value;
        if (!imageUrl && match.value.imageUrl) imageUrl = match.value.imageUrl;
      });
      if (Object.keys(options).length) {
        rows.push({
          selected: true,
          sku: `AX-${rows.length + 1}`,
          options,
          price: priceRow.price || (visiblePrice.value ? Number(visiblePrice.value).toFixed(2) : ""),
          quantity: priceRow.quantity || 5,
          imageUrl
        });
      }
    });

    if (rows.length) return deDuplicateVariationRows(rows);

    const combinations = crossProduct(skuData.dimensions.map((dimension) => dimension.values.map((value) => ({ dimension, value }))));
    combinations.forEach((combination, index) => {
      const options = {};
      let imageUrl = "";
      combination.forEach(({ dimension, value }) => {
        options[dimension.name] = value.value;
        if (!imageUrl && value.imageUrl) imageUrl = value.imageUrl;
      });
      rows.push({
        selected: true,
        sku: `AX-${index + 1}`,
        options,
        price: visiblePrice.value ? Number(visiblePrice.value).toFixed(2) : "",
        quantity: 5,
        imageUrl
      });
    });
    return rows.slice(0, 250);
  }

  function deDuplicateVariationRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = JSON.stringify(row.options);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function crossProduct(groups) {
    if (!groups.length) return [];
    return groups.reduce((acc, group) => {
      if (!acc.length) return group.map((item) => [item]);
      return acc.flatMap((items) => group.map((item) => [...items, item]));
    }, []);
  }

  function extractVisibleVariationDimensions() {
    const dimensions = [];
    const candidateBlocks = Array.from(document.querySelectorAll("div, section, ul"))
      .filter((node) => {
        const label = text(node).slice(0, 80);
        return /colou?r|size|model|length|plug|ships from|type/i.test(label)
          && node.querySelectorAll("button, li, img, [role='button']").length >= 2
          && node.querySelectorAll("button, li, img, [role='button']").length < 80;
      })
      .slice(0, 8);

    candidateBlocks.forEach((block, blockIndex) => {
      const blockText = text(block);
      const nameMatch = blockText.match(/(colou?r|size|model|length|plug type|ships from|type|style)/i);
      const values = Array.from(block.querySelectorAll("button, li, [role='button'], img"))
        .map((node) => {
          const value = cleanVariationValue(node.getAttribute("title") || node.getAttribute("alt") || text(node));
          const imageUrl = node.tagName === "IMG" ? normalizeImageUrl(node.src || node.getAttribute("data-src")) : "";
          return { id: "", value, imageUrl };
        })
        .filter((value) => value.value && value.value.length < 70);
      const uniqueValues = [];
      const seen = new Set();
      values.forEach((value) => {
        const key = value.value.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          uniqueValues.push(value);
        }
      });
      if (uniqueValues.length >= 2) {
        const rawName = nameMatch ? nameMatch[1] : `Option ${blockIndex + 1}`;
        dimensions.push({
          id: String(blockIndex),
          name: normalizeDimensionName(rawName, uniqueValues.map((value) => value.value)),
          rawName,
          values: uniqueValues
        });
      }
    });

    return mergeDimensions([], dimensions).slice(0, 3);
  }

  function normalizeDimensionName(rawName, values) {
    const name = cleanText(rawName);
    const joinedValues = values.join(" ");
    if (/iphone|samsung|galaxy|xiaomi|redmi|huawei|oppo|vivo|pixel|phone/i.test(`${name} ${joinedValues}`)) {
      return "Compatible Model";
    }
    if (/length|^\d+\s*(m|cm|mm)\b|\b\d+\s*met(er|re)/i.test(`${name} ${joinedValues}`)) {
      return /size/i.test(name) ? "Size" : "Length";
    }
    if (/colou?r/i.test(name)) return "Colour";
    if (/size/i.test(name)) return "Size";
    if (/model/i.test(name)) return "Model";
    if (/plug/i.test(name)) return "Plug Type";
    if (/ships?\s*from/i.test(name)) return "Ships From";
    if (/type/i.test(name)) return "Type";
    return name || "Option";
  }

  function cleanVariationValue(value) {
    return cleanText(value)
      .replace(/\b(select|choose|option)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function inferDimensionsFromRows(rows) {
    const names = new Set();
    rows.forEach((row) => Object.keys(row.options || {}).forEach((name) => names.add(name)));
    return Array.from(names).map((name) => ({ name, values: [] }));
  }

  function chooseProductPrice(variations, visiblePrice) {
    const prices = variations
      .map((variation) => Number(variation.price))
      .filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length) return Math.min(...prices).toFixed(2);
    return Number.isFinite(visiblePrice.value) ? Number(visiblePrice.value).toFixed(2) : "";
  }

  function buildCategoryHints(title, specifications) {
    const hints = [];
    const haystack = `${title} ${Object.values(specifications).join(" ")}`;
    if (/case|cover|iphone|samsung|galaxy/i.test(haystack)) hints.push("Mobile Phone Cases, Covers & Skins");
    if (/led|strip light|rgb/i.test(haystack)) hints.push("LED Strip Lights");
    if (/cable|charger|adapter/i.test(haystack)) hints.push("Mobile Phone Cables & Adapters");
    return hints;
  }

  function text(node) {
    return cleanText(node ? node.textContent || "" : "");
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
