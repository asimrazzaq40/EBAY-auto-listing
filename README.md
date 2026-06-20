# AM eBay Listing Assistant

Chrome Extension Manifest V3 assistant for semi-automated product listing from AliExpress product pages to regional eBay listing forms.

This MVP does **not** use the official eBay API. It works as a browser form-filling assistant that helps scrape/import product data, review listing data, open the selected regional eBay selling page, upload images, fill listing fields, and assist with variation creation. The final eBay listing submission remains manual.

## Safety boundaries

- The extension does not bypass CAPTCHA, login security, anti-bot checks, or account verification.
- The extension does not click the final publish/list submit button.
- Users must review the listing and manually submit it on eBay.
- Image upload is attempted through browser `File` objects and eBay's uploader. Download prompts are not used unless a future manual fallback is intentionally added.

## Password lock

The popup and editor require an access password before tools are shown.

The password is configured by the owner in `src/background/service-worker.js`. It is intentionally not displayed in the popup, editor, or this README.

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

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Pin **AM eBay Listing Assistant** from the extensions menu.

## Core workflow

1. Open an AliExpress product page.
2. Open the extension popup.
3. Enter the access password.
4. Click **Scrape Current Product**.
5. Choose the eBay region in the popup or editor.
6. Review and edit listing data in the editor:
   - Title
   - Description
   - Price
   - Quantity
   - SKU prefix
   - eBay region
   - Category hints
   - Item specifics
   - Product images
   - Variations
7. Click **List It**.
8. On the selected eBay region, use the floating assistant panel:
   - **Auto Start**
   - **Fill Now**
   - **Set Buy It Now**
   - **Build Variations**
   - **Upload Images**
   - **Copy Title**
   - **Copy Description**
   - **Copy Variants**
   - **Debug Fields**
9. Review the eBay listing manually and submit only when satisfied.

## Supported eBay regions

The listing destination can be selected from the popup or editor:

- Australia
- United States
- United Kingdom
- Canada
- Germany
- France
- Italy
- Spain

## eBay variation support

The extension first ensures the real hidden pricing format field is set to fixed price:

```js
select[name="format"].value = "FixedPrice"
```

It dispatches `input`, `change`, and `blur` events and also attempts to update the visible eBay listbox when needed.

Variation creation uses layered strategies:

1. Detect the variation section and open Create/Edit variations.
2. Detect the editor in the main DOM, a dialog, a drawer, an accessible iframe, or open shadow DOM.
3. Fill dimensions and values first.
4. Generate/create variation rows where supported.
5. Fill SKU, price, and quantity fields in the variation table.
6. If direct DOM filling is unreliable, copy a TSV table and attempt paste-assisted filling.
7. If the editor is not open yet, watcher mode logs diagnostics and fills when the user opens the editor manually.

The **Build Variations** flow has a 20 second detection timeout and logs:

- Variation section found
- Buy It Now active
- `select[name=format]` value
- Editor opened
- Iframe count
- Dialog count
- Inputs inside editor
- Relevant editor buttons

## AliExpress scraping

The scraper extracts:

- Product title
- Displayed original price
- Main gallery images
- Variation images
- Clean description HTML
- Specifications as item specifics
- Variation dimensions
- Variation values
- SKU combinations where structured SKU data is present
- Variation price, quantity, SKU, and image URL

The scraper uses structured AliExpress page data when available and falls back to visible DOM heuristics.

## Notes and limitations

- eBay's listing UI changes frequently. Use **Debug Fields** when a field or variation editor is not detected.
- Variation editors may use dynamic drawers, modals, iframes, or shadow DOM. The watcher mode is included for those cases.
- The generated variation TSV can be pasted manually into compatible eBay bulk tables if automatic row filling fails.
- Cross-origin image fetches depend on Chrome extension host permissions and the image CDN response.
