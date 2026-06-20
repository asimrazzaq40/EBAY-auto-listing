# AM eBay Listing Assistant

Chrome Extension Manifest V3 browser assistant for preparing AliExpress product data and semi-automating eBay AU listing form entry.

This MVP does **not** use the official eBay API. It works as a form-filling assistant in the browser:

- Scrape product data from AliExpress pages.
- Review and edit the listing data in an internal editor.
- Open the eBay AU listing flow.
- Fill listing fields, item specifics, descriptions, photos, and variation data where eBay's page supports it.
- Leave final listing submission manual for safety.

## Safety

The extension must not bypass CAPTCHA, login challenges, anti-bot checks, or final publishing controls. It only helps prepare data and fill forms. The seller must review the listing and manually click eBay's final listing/publish button.

## Loading locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Pin **AM eBay Listing Assistant** from the Chrome extension menu.

The popup and editor are password protected. The owner can edit the internal password in the background service worker config.

## Workflow

1. Open an AliExpress product page.
2. Open the extension popup.
3. Unlock the extension.
4. Click **Scrape Current Product**.
5. Review the internal editor:
   - Title
   - Description HTML
   - Price
   - Quantity
   - SKU prefix
   - Category hints
   - Item specifics
   - Images
   - Variations and dimension names
6. Optionally click **Apply Markup**.
7. Use copy/export tools if needed.
8. Click **List It**.
9. On eBay AU, use the floating panel:
   - **Auto Start**
   - **Fill Now**
   - **Set Buy It Now**
   - **Build Variations**
   - **Upload Images**
   - **Copy Title**
   - **Copy Description**
   - **Copy Variants**
   - **Debug Fields**
10. Review the eBay listing manually and publish only when satisfied.

## Variation handling

Variation creation is intentionally conservative because eBay's listing editor can render as a dynamic drawer, modal, iframe, or shadow-DOM UI.

The **Build Variations** button:

1. Sets the real hidden format field to `FixedPrice`.
2. Logs whether the variation section and editor are detected.
3. Opens the variation editor when possible.
4. Attempts to fill dimension names and option values.
5. Attempts to fill generated table rows with SKU, option values, price, quantity, and image URL.
6. Copies a tab-separated variation table to the clipboard for paste-assisted mode.
7. Stops after a bounded detection attempt rather than hanging.

If eBay changes its UI, use **Debug Fields** and **Copy Variants** to inspect detected fields and paste the TSV manually into eBay's variation grid.

## Image upload

The eBay content script fetches selected AliExpress image URLs, converts each response to a `Blob`, wraps it in a `File`, and assigns the files to eBay's file input via `DataTransfer`. If no file input is available, it attempts drag/drop events against the photo uploader. It does not prompt for image downloads during normal upload.

## Project structure

```text
manifest.json
src/background/service-worker.js
src/content/aliexpress-scraper.js
src/content/ebay-autofill.js
src/content/ebay-variation-watcher.js
pages/popup.html
pages/popup.js
pages/editor.html
pages/editor.js
assets/icon.png
README.md
```

## Notes

- The extension targets AliExpress product pages and eBay AU listing pages.
- Host permissions include AliExpress, eBay, and AliExpress image CDNs.
- Scraping and field filling depend on live page markup and may need selector updates if either site changes.
- Always verify item specifics, policies, prices, quantities, photos, and variations before publishing.
