# AM eBay Listing Assistant

Password-protected Chrome Extension Manifest V3 for semi-automated product listing from AliExpress into the eBay AU listing flow without using the official eBay API.

## What it does

- Scrapes the current AliExpress product page
- Opens an internal review editor before any eBay interaction
- Lets you edit title, description, price, quantity, SKU, category hints, item specifics, images, and variations
- Opens the eBay AU sell flow and helps populate the listing form
- Sets listing format to Buy It Now / Fixed Price
- Uploads product images by converting remote image URLs into `File` objects
- Attempts to build eBay variations via an editor detector plus table/paste-assisted fallback
- Leaves the final eBay publish action manual for safety

## Safety boundaries

This extension is intentionally limited:

- It does **not** bypass CAPTCHA or anti-bot checks
- It does **not** bypass login or account security prompts
- It does **not** force final listing submission
- It does **not** use the eBay API in this MVP

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

## Password lock

The popup and editor are both locked behind a password prompt.

- The password is stored in `src/background/service-worker.js`
- To change it, edit the `accessPassword` variable in that file
- The password is intentionally not displayed in the UI or this README

## Install in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this repository folder

## Basic workflow

1. Open an AliExpress product page
2. Open the extension popup
3. Enter the access password
4. Click **Scrape Current Product**
5. Review and edit the draft in the internal editor
6. Click **List It**
7. On eBay, use the floating assistant panel:
   - **Auto Start**
   - **Fill Now**
   - **Set Buy It Now**
   - **Build Variations**
   - **Upload Images**
   - **Debug Fields**
8. Review the listing manually
9. Click the final eBay list button yourself

## Notes on variations

Variation creation is the most dynamic part of the eBay UI. This extension therefore tries multiple approaches:

1. Force the hidden `select[name="format"]` field to `FixedPrice`
2. Open the variation editor/drawer/dialog
3. Detect inputs/buttons inside the live editor
4. Fill option names and values where possible
5. Generate the eBay variation table
6. Populate SKU, price, quantity, and image fields
7. Fall back to clipboard/paste-assisted variation entry when direct row filling is not available

The floating debug logger is intended to help adapt the variation builder when eBay changes its DOM.
