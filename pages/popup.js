(async function bootstrapPopup() {
  const lockCard = document.getElementById("lockCard");
  const appCard = document.getElementById("appCard");
  const passwordInput = document.getElementById("passwordInput");
  const unlockButton = document.getElementById("unlockButton");
  const lockStatus = document.getElementById("lockStatus");
  const draftTitle = document.getElementById("draftTitle");
  const appStatus = document.getElementById("appStatus");
  const scrapeButton = document.getElementById("scrapeButton");
  const editorButton = document.getElementById("editorButton");
  const listingButton = document.getElementById("listingButton");
  const logoutButton = document.getElementById("logoutButton");

  function setStatus(target, message, isError = false) {
    target.textContent = message || "";
    target.style.color = isError ? "#fca5a5" : "#93c5fd";
  }

  async function sendMessage(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) {
      throw new Error(response?.error || "Unexpected extension error.");
    }
    return response;
  }

  async function refreshDraftTitle() {
    try {
      const response = await sendMessage("AM_GET_DRAFT");
      const title = response?.draft?.title || "";
      if (title) {
        draftTitle.textContent = title;
        draftTitle.classList.remove("hidden");
      } else {
        draftTitle.classList.add("hidden");
      }
    } catch (error) {
      setStatus(appStatus, error.message, true);
    }
  }

  async function showApp() {
    lockCard.classList.add("hidden");
    appCard.classList.remove("hidden");
    await refreshDraftTitle();
  }

  async function checkAuth() {
    const response = await chrome.runtime.sendMessage({ type: "AM_AUTH_STATUS" });
    if (response?.ok) {
      await showApp();
    }
  }

  unlockButton.addEventListener("click", async () => {
    setStatus(lockStatus, "Checking password...");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "AM_VERIFY_PASSWORD",
        password: passwordInput.value
      });
      if (!response?.ok) {
        throw new Error("Incorrect password.");
      }
      passwordInput.value = "";
      setStatus(lockStatus, "");
      await showApp();
    } catch (error) {
      setStatus(lockStatus, error.message || "Unable to unlock.", true);
    }
  });

  passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      unlockButton.click();
    }
  });

  scrapeButton.addEventListener("click", async () => {
    setStatus(appStatus, "Scraping current product...");
    try {
      const response = await sendMessage("AM_SCRAPE_ACTIVE_PRODUCT");
      await refreshDraftTitle();
      setStatus(
        appStatus,
        [
          "Product scraped successfully.",
          `Title: ${response?.draft?.title || "Untitled product"}`,
          `Images: ${response?.draft?.images?.length || 0}`,
          `Variations: ${response?.draft?.variations?.rows?.length || 0}`
        ].join("\n")
      );
      await sendMessage("AM_OPEN_EDITOR");
      window.close();
    } catch (error) {
      setStatus(appStatus, error.message, true);
    }
  });

  editorButton.addEventListener("click", async () => {
    try {
      await sendMessage("AM_OPEN_EDITOR");
      window.close();
    } catch (error) {
      setStatus(appStatus, error.message, true);
    }
  });

  listingButton.addEventListener("click", async () => {
    setStatus(appStatus, "Opening eBay AU listing...");
    try {
      await sendMessage("AM_OPEN_EBAY_LISTING");
      setStatus(appStatus, "eBay listing page opened.");
      window.close();
    } catch (error) {
      setStatus(appStatus, error.message, true);
    }
  });

  logoutButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "AM_LOGOUT" });
    appCard.classList.add("hidden");
    lockCard.classList.remove("hidden");
    passwordInput.focus();
  });

  await checkAuth();
})();
