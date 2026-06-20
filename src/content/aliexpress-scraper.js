(() => {
  if (window.__amEbayAliExpressScraperLoaded) {
    return;
  }
  window.__amEbayAliExpressScraperLoaded = true;

  const DEFAULT_QUANTITY = 5;
  const SPECIFIC_NAME_MAP = new Map([
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
    ["sensor type", "Sensor Type"]
  ]);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "SCRAPE_ALIEXPRESS_PRODUCT") {
      return false;
    }

    try {
      sendResponse({
        ok: true,
        product: scrapeProduct()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }
    return true;
  });

  function scrapeProduct() {
    const title = cleanTitle(extractTitle());
    const priceInfo = extractPrice();
    const variationGroups = mergeVariationGroups(extractVariationGroups());
    const images = extractImages(variationGroups);
    const itemSpecifics = normalizeSpecifics(extractSpecifications(variationGroups, title));
    const descriptionHtml = extractDescriptionHtml(title, images);
    const variations = buildVariations(variationGroups, priceInfo, title);
    const categoryHints = inferCategoryHints(title, itemSpecifics);

    return {
      sourceUrl: location.href,
      scrapedAt: new Date().toISOString(),
      title,
      descriptionHtml,
      priceText: priceInfo.priceText,
      price: priceInfo.price,
      currency: priceInfo.currency,
      quantity: DEFAULT_QUANTITY,
      skuPrefix: "AX",
      categoryHints,
      itemSpecifics,
      images,
      variationDimensions: variationGroups.map((group) => group.name),
      variations
    };
  }

  function extractTitle() {
    const selectors = [
      "h1",
      "[data-pl='product-title']",
      "[class*='title--wrap'] h1",
      "[class*='product-title']",
      "[class*='ProductTitle']"
    ];

    for (const selector of selectors) {
      const node = firstVisible(selector);
      const text = textOf(node);
      if (text && text.length > 5) {
        return text;
      }
    }

    const og = document.querySelector("meta[property='og:title'], meta[name='og:title']");
    return og ? og.content : document.title;
  }

  function cleanTitle(value) {
    return String(value || "")
      .replace(/\s*[|-]\s*AliExpress.*$/i, "")
      .replace(/\s*-\s*Buy\b.*$/i, "")
      .replace(/\bfree shipping\b/gi, "")
      .replace(/\bchoice\b/gi, "")
      .replace(/\bnew arrival\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 80);
  }

  function extractPrice() {
    const selectors = [
      "[data-pl='product-price']",
      "[class*='price--']",
      "[class*='Price']",
      "[class*='product-price']",
      "[class*='uniform-banner-box-price']"
    ];
    const candidates = [];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (!isVisible(node) || isInsideIgnoredRegion(node)) {
          return;
        }
        const text = textOf(node);
        if (looksLikePrice(text)) {
          candidates.push(text);
        }
      });
    }

    const metaPrice = document.querySelector("meta[property='product:price:amount']");
    if (metaPrice && metaPrice.content) {
      candidates.push(metaPrice.content);
    }

    const priceText = chooseBestPriceText(candidates);
    const numbers = numbersFromText(priceText);
    const price = numbers.length ? Math.min(...numbers) : "";
    return {
      priceText,
      price,
      currency: extractCurrency(priceText)
    };
  }

  function chooseBestPriceText(candidates) {
    const unique = uniqueStrings(candidates)
      .map((text) => text.replace(/\s+/g, " ").trim())
      .filter((text) => text.length <= 120);

    return unique.sort((a, b) => scorePriceText(b) - scorePriceText(a))[0] || "";
  }

  function scorePriceText(text) {
    let score = 0;
    if (/\$|AU|AUD|USD|PKR|Rs|€|£/i.test(text)) score += 4;
    if (/\d/.test(text)) score += 2;
    if (/-|–|to/i.test(text)) score += 1;
    if (/shipping|coupon|discount|off/i.test(text)) score -= 4;
    return score;
  }

  function extractImages(variationGroups) {
    const seen = new Set();
    const images = [];
    const variationUrls = new Set(
      variationGroups.flatMap((group) => group.values.map((value) => value.image).filter(Boolean))
    );

    document.querySelectorAll("img[src], img[data-src], img[srcset]").forEach((img) => {
      if (!isVisible(img) || isInsideIgnoredRegion(img)) {
        return;
      }
      const url = bestImageUrl(img);
      if (!url || !isProductImageUrl(url) || seen.has(url)) {
        return;
      }

      const rect = img.getBoundingClientRect();
      const source = variationUrls.has(url) ? "variation" : "gallery";
      const tooSmall = rect.width < 45 && rect.height < 45 && source !== "variation";
      if (tooSmall) {
        return;
      }

      seen.add(url);
      images.push({
        url,
        alt: img.alt || "",
        selected: true,
        source
      });
    });

    variationUrls.forEach((url) => {
      if (!seen.has(url)) {
        seen.add(url);
        images.push({
          url,
          alt: "Variation image",
          selected: true,
          source: "variation"
        });
      }
    });

    return images.slice(0, 24);
  }

  function bestImageUrl(img) {
    const srcset = img.getAttribute("srcset");
    if (srcset) {
      const best = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
      if (best) {
        return normalizeImageUrl(best);
      }
    }

    return normalizeImageUrl(
      img.getAttribute("data-src") ||
        img.getAttribute("src") ||
        img.getAttribute("data-image-url") ||
        ""
    );
  }

  function isProductImageUrl(url) {
    return /alicdn\.com|aliexpress-media\.com/i.test(url) &&
      !/avatar|review|feedback|store|logo|sprite|icon|banner|loading|transparent/i.test(url);
  }

  function normalizeImageUrl(url) {
    const clean = String(url || "").trim();
    if (!clean || clean.startsWith("data:")) {
      return "";
    }

    const absolute = clean.startsWith("//") ? `https:${clean}` : clean;
    return absolute
      .replace(/\?.*$/, "")
      .replace(/_(\d+)x(\d+)(q\d+)?\.(jpg|jpeg|png|webp)$/i, ".$4")
      .replace(/_(\d+)x(\d+)\.(jpg|jpeg|png|webp)(_.webp)?$/i, ".$3")
      .replace(/\.(jpg|jpeg|png|webp)_(\d+)x(\d+)(q\d+)?\.(jpg|jpeg|png|webp)$/i, ".$1");
  }

  function extractDescriptionHtml(title, images) {
    const selectors = [
      "#product-description",
      "#description",
      "[data-pl='product-description']",
      "[class*='description']",
      "[class*='Description']",
      "[class*='product-overview']",
      "[class*='ProductOverview']"
    ];

    for (const selector of selectors) {
      const node = largestVisibleNode(selector);
      if (!node || isInsideIgnoredRegion(node)) {
        continue;
      }
      const clone = cleanDescriptionNode(node.cloneNode(true));
      const html = sanitizeDescriptionHtml(clone.innerHTML);
      if (html && html.replace(/<[^>]+>/g, "").trim().length > 80) {
        return html;
      }
    }

    const bullets = [
      `<h2>${escapeHtml(title || "Product details")}</h2>`,
      "<p>Please review the imported title, images, item specifics, and variations before publishing.</p>"
    ];

    images.slice(0, 6).forEach((image) => {
      bullets.push(`<p><img src="${escapeAttribute(image.url)}" alt=""></p>`);
    });

    return bullets.join("");
  }

  function cleanDescriptionNode(node) {
    node.querySelectorAll("script, style, iframe, noscript, form, button, nav, footer").forEach((child) => child.remove());
    node.querySelectorAll("*").forEach((child) => {
      const text = textOf(child).toLowerCase();
      const className = String(child.className || "").toLowerCase();
      if (/review|feedback|recommend|related|store|seller|coupon|promo|size chart/i.test(className) ||
          /customer reviews|related products|you may also like|store coupon/i.test(text)) {
        child.remove();
      }
      [...child.attributes].forEach((attribute) => {
        if (!["href", "src", "alt", "title"].includes(attribute.name)) {
          child.removeAttribute(attribute.name);
        }
      });
    });
    return node;
  }

  function sanitizeDescriptionHtml(html) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    wrapper.querySelectorAll("a").forEach((link) => {
      const span = document.createElement("span");
      span.innerHTML = link.innerHTML;
      link.replaceWith(span);
    });
    wrapper.querySelectorAll("img").forEach((img) => {
      const url = normalizeImageUrl(img.getAttribute("src") || "");
      if (!url || !isProductImageUrl(url)) {
        img.remove();
        return;
      }
      img.setAttribute("src", url);
      img.setAttribute("alt", img.getAttribute("alt") || "");
    });
    return wrapper.innerHTML.trim();
  }

  function extractSpecifications(variationGroups, title) {
    const rows = [];
    const containers = [
      ...document.querySelectorAll("[class*='specification'], [class*='Specification'], [data-pl='product-specs'], table, dl")
    ].filter(isVisible);

    containers.forEach((container) => {
      container.querySelectorAll("tr").forEach((row) => {
        const cells = [...row.children].map(textOf).filter(Boolean);
        if (cells.length >= 2) {
          rows.push({ name: cells[0], value: cells.slice(1).join(" ") });
        }
      });

      container.querySelectorAll("dt").forEach((dt) => {
        const dd = dt.nextElementSibling;
        if (dd) {
          rows.push({ name: textOf(dt), value: textOf(dd) });
        }
      });

      container.querySelectorAll("li, [class*='specification--line'], [class*='itemProp']").forEach((item) => {
        const text = textOf(item);
        const split = splitNameValue(text);
        if (split) {
          rows.push(split);
        }
      });
    });

    variationGroups.forEach((group) => {
      if (/compatible model|size|length|colour|color/i.test(group.name)) {
        rows.push({
          name: group.name,
          value: group.values.map((value) => value.value).slice(0, 15).join(", ")
        });
      }
    });

    if (/led|strip light/i.test(title)) {
      rows.push({ name: "Lighting Technology", value: "LED" });
    }
    if (/phone case|case cover|iphone|samsung galaxy/i.test(title)) {
      rows.push({ name: "Type", value: "Fitted Case/Skin" });
    }

    return rows;
  }

  function normalizeSpecifics(rows) {
    const seen = new Map();
    rows.forEach((row) => {
      const rawName = String(row.name || "").replace(/\s*:\s*$/, "").trim();
      const value = String(row.value || "").replace(/\s+/g, " ").trim();
      if (!rawName || !value || rawName.length > 80 || value.length > 250) {
        return;
      }
      const name = SPECIFIC_NAME_MAP.get(rawName.toLowerCase()) || titleCase(rawName);
      if (!seen.has(name)) {
        seen.set(name, { name, value });
      }
    });
    return [...seen.values()];
  }

  function extractVariationGroups() {
    const groups = [];
    const candidateSelectors = [
      "[class*='sku']",
      "[class*='Sku']",
      "[class*='product-property']",
      "[class*='ProductProperty']",
      "[data-sku-col]",
      "[data-pl*='sku']"
    ];

    const containers = uniqueElements(
      candidateSelectors.flatMap((selector) => [...document.querySelectorAll(selector)])
    )
      .filter(isVisible)
      .filter((node) => node.querySelectorAll("button, [role='button'], li, img, span").length >= 2);

    containers.forEach((container) => {
      const name = inferVariationName(container);
      if (!name) {
        return;
      }
      const values = extractOptionValues(container, name);
      if (values.length > 0) {
        groups.push({ name: normalizeVariationName(name, values), values });
      }
    });

    return groups;
  }

  function inferVariationName(container) {
    const labelled = [
      container.getAttribute("aria-label"),
      container.getAttribute("data-title"),
      textOf(container.querySelector("h2, h3, h4, label, [class*='title'], [class*='Title'], [class*='name'], [class*='Name']"))
    ].filter(Boolean);

    for (const label of labelled) {
      const normalized = normalizePotentialDimension(label);
      if (normalized) {
        return normalized;
      }
    }

    const ownText = directText(container);
    const fromOwnText = normalizePotentialDimension(ownText);
    if (fromOwnText) {
      return fromOwnText;
    }

    const fullText = textOf(container).slice(0, 120);
    return normalizePotentialDimension(fullText);
  }

  function normalizePotentialDimension(text) {
    const clean = String(text || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) {
      return "";
    }

    const beforeColon = clean.split(":")[0].trim();
    const lower = beforeColon.toLowerCase();
    const known = [
      "color",
      "colour",
      "size",
      "model",
      "length",
      "plug type",
      "ships from",
      "style",
      "type",
      "material",
      "emitting color"
    ];
    const matched = known.find((name) => lower === name || lower.endsWith(` ${name}`));
    return matched ? titleCase(matched) : "";
  }

  function extractOptionValues(container, dimensionName) {
    const optionNodes = uniqueElements([
      ...container.querySelectorAll("button, [role='button'], li, img, [class*='value'], [class*='Value'], [class*='option'], [class*='Option']")
    ]).filter((node) => {
      if (!isVisible(node) || node === container) {
        return false;
      }
      const disabled = node.matches("[disabled], [aria-disabled='true']") ||
        /disabled|sold|unavailable|disable/i.test(String(node.className || ""));
      return !disabled;
    });

    const values = [];
    const seen = new Set();

    optionNodes.forEach((node) => {
      const value = cleanVariationValue(
        node.getAttribute("title") ||
          node.getAttribute("aria-label") ||
          node.getAttribute("alt") ||
          textOf(node)
      );
      const img = node.matches("img") ? node : node.querySelector("img");
      const image = img ? bestImageUrl(img) : "";

      if (!value || value.length > 80 || seen.has(value.toLowerCase())) {
        if (image && dimensionName && /colou?r|image|style/i.test(dimensionName)) {
          const fallback = `Option ${values.length + 1}`;
          values.push({ value: fallback, image });
          seen.add(fallback.toLowerCase());
        }
        return;
      }

      seen.add(value.toLowerCase());
      values.push({
        value,
        image,
        price: numbersFromText(textOf(node)).slice(-1)[0] || ""
      });
    });

    return values.slice(0, 80);
  }

  function cleanVariationValue(value) {
    return String(value || "")
      .replace(/\s*(selected|choose|select|available|sold out)\s*/gi, " ")
      .replace(/\bShips From\b:?/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function mergeVariationGroups(groups) {
    const byName = new Map();
    groups.forEach((group) => {
      const normalizedName = normalizeVariationName(group.name, group.values);
      if (!normalizedName || group.values.length === 0) {
        return;
      }
      const existing = byName.get(normalizedName) || { name: normalizedName, values: [] };
      const seenValues = new Set(existing.values.map((value) => value.value.toLowerCase()));
      group.values.forEach((value) => {
        if (!seenValues.has(value.value.toLowerCase())) {
          existing.values.push(value);
          seenValues.add(value.value.toLowerCase());
        }
      });
      byName.set(normalizedName, existing);
    });

    return [...byName.values()]
      .filter((group) => group.values.length > 1 || /compatible model|size|length|colour|color/i.test(group.name))
      .slice(0, 3);
  }

  function normalizeVariationName(name, values) {
    const joinedValues = values.map((value) => value.value).join(" ");
    const lower = `${name} ${joinedValues}`.toLowerCase();
    if (/iphone|samsung|galaxy|xiaomi|oppo|huawei|pixel|phone model/.test(lower)) {
      return "Compatible Model";
    }
    if (/\b\d+\s*(m|cm|mm|inch|in)\b|length|strip/i.test(lower)) {
      return /color|colour/i.test(name) && !/\b(red|blue|green|black|white|pink|rgb|warm|cool)\b/i.test(joinedValues)
        ? "Length"
        : titleCase(name);
    }
    if (/colour|color|emitting color/i.test(name)) {
      return "Colour";
    }
    if (/plug/.test(lower)) {
      return "Plug Type";
    }
    if (/ship/.test(lower)) {
      return "Ships From";
    }
    return titleCase(name);
  }

  function buildVariations(groups, priceInfo, title) {
    if (!groups.length) {
      return [];
    }

    const optionRows = cartesian(groups.map((group) => group.values));
    return optionRows.slice(0, 250).map((values, index) => {
      const options = {};
      values.forEach((value, valueIndex) => {
        options[groups[valueIndex].name] = value.value;
      });
      const imageValue = values.find((value) => value.image);
      const optionPrice = values.map((value) => value.price).find(Boolean);
      return {
        id: `ax-${index + 1}`,
        selected: true,
        sku: `${skuPrefixFromTitle(title)}-${index + 1}`,
        options,
        price: optionPrice || priceInfo.price || "",
        priceText: optionPrice ? String(optionPrice) : priceInfo.priceText,
        quantity: DEFAULT_QUANTITY,
        image: imageValue ? imageValue.image : ""
      };
    });
  }

  function cartesian(groups) {
    return groups.reduce(
      (rows, group) => rows.flatMap((row) => group.map((item) => [...row, item])),
      [[]]
    );
  }

  function skuPrefixFromTitle(title) {
    const words = String(title || "")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2)
      .slice(0, 2);
    return words.length ? `AX-${words.join("")}` : "AX";
  }

  function inferCategoryHints(title, specifics) {
    const hints = [];
    const lower = String(title || "").toLowerCase();
    if (/phone case|case cover|iphone|samsung galaxy/.test(lower)) {
      hints.push("Mobile Phone Cases, Covers & Skins");
    }
    if (/led|strip light|rgb/.test(lower)) {
      hints.push("String & Fairy Lights", "LED Strip Lights");
    }
    const type = specifics.find((specific) => specific.name === "Type");
    if (type) {
      hints.push(type.value);
    }
    return uniqueStrings(hints);
  }

  function splitNameValue(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const match = clean.match(/^([^:：]{2,80})[:：]\s*(.{1,250})$/);
    if (!match) {
      return null;
    }
    return {
      name: match[1].trim(),
      value: match[2].trim()
    };
  }

  function firstVisible(selector) {
    return [...document.querySelectorAll(selector)].find(isVisible);
  }

  function largestVisibleNode(selector) {
    return [...document.querySelectorAll(selector)]
      .filter(isVisible)
      .sort((a, b) => textOf(b).length - textOf(a).length)[0];
  }

  function isVisible(node) {
    if (!node || !(node instanceof Element)) {
      return false;
    }
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInsideIgnoredRegion(node) {
    return Boolean(node.closest(
      "[class*='review'], [class*='Review'], [class*='feedback'], [class*='recommend'], [class*='related'], [class*='store'], [class*='seller'], footer, nav"
    ));
  }

  function textOf(node) {
    return node ? String(node.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function directText(node) {
    if (!node) {
      return "";
    }
    return [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function uniqueElements(elements) {
    return [...new Set(elements.filter(Boolean))];
  }

  function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function looksLikePrice(text) {
    return /\d/.test(text) && /(\$|AU|AUD|USD|PKR|Rs|€|£|\d+[.,]\d{2})/i.test(text || "");
  }

  function numbersFromText(text) {
    return [...String(text || "").replace(/,/g, "").matchAll(/\d+(?:\.\d+)?/g)]
      .map((match) => Number(match[0]))
      .filter(Number.isFinite);
  }

  function extractCurrency(text) {
    const match = String(text || "").match(/\b(AU|AUD|USD|PKR|EUR|GBP)\b|\$|€|£|Rs/i);
    return match ? match[0].toUpperCase() : "";
  }

  function titleCase(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
      .replace(/\bLed\b/g, "LED")
      .replace(/\bRgb\b/g, "RGB");
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
})();
