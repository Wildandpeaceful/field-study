(() => {
  "use strict";

  const dialog = document.querySelector("#contourGiphyPicker");
  if (!dialog) return;

  const API_KEY_STORAGE = "field-study-giphy-api-key";
  const SEARCH_LIMIT = 24;
  const keySetup = document.querySelector("#contourGiphyKeySetup");
  const keyForm = document.querySelector("#contourGiphyKeyForm");
  const keyInput = document.querySelector("#contourGiphyKey");
  const searchForm = document.querySelector("#contourGiphySearchForm");
  const searchInput = document.querySelector("#contourGiphySearch");
  const searchButton = searchForm.querySelector("button[type='submit']");
  const results = document.querySelector("#contourGiphyResults");
  const status = document.querySelector("#contourGiphyPickerStatus");
  const selection = document.querySelector("#contourGiphySelection");
  const useButton = document.querySelector("#contourGiphyUse");
  const manageKeyButton = document.querySelector("#contourGiphyManageKey");
  const clearKeyButton = document.querySelector("#contourGiphyClearKey");
  const searchCache = new Map();

  let apiKey = readKey();
  let selectedSticker = null;
  let searching = false;

  function readKey() {
    try {
      return localStorage.getItem(API_KEY_STORAGE) || "";
    } catch (_) {
      return "";
    }
  }

  function saveKey(value) {
    apiKey = String(value || "").trim();
    try {
      localStorage.setItem(API_KEY_STORAGE, apiKey);
    } catch (_) {
      // A private browser session can reject storage; the key still works until reload.
    }
  }

  function previewUrl(sticker) {
    return sticker?.images?.fixed_height_small?.webp
      || sticker?.images?.fixed_height_small?.url
      || sticker?.images?.downsized?.url
      || sticker?.images?.original?.url
      || "";
  }

  function stickerTitle(sticker) {
    return String(sticker?.title || sticker?.slug || "GIPHY Sticker")
      .replace(/\s+GIF(?:\s+by\s+.+)?$/i, "")
      .trim() || "GIPHY Sticker";
  }

  function showKeySetup(show, focus = false) {
    keySetup.hidden = !show;
    dialog.classList.toggle("key-setup-visible", show);
    searchInput.disabled = show || searching;
    searchButton.disabled = show || searching;
    if (show) {
      keyInput.value = apiKey;
      clearKeyButton.hidden = !apiKey;
      status.textContent = apiKey ? "Update or replace the saved key" : "A free GIPHY beta key is required";
      if (focus) requestAnimationFrame(() => keyInput.focus());
    } else if (focus) {
      requestAnimationFrame(() => searchInput.focus());
    }
  }

  function setSelection(sticker) {
    selectedSticker = sticker;
    results.querySelectorAll("[role='option']").forEach((button) => {
      const selected = button.dataset.giphyId === sticker?.id;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });

    const image = selection.querySelector("img");
    const title = selection.querySelector("strong");
    const note = selection.querySelector("small");
    if (sticker) {
      image.src = previewUrl(sticker);
      title.textContent = stickerTitle(sticker);
      note.textContent = `GIPHY STICKER · ${sticker.username ? `BY ${sticker.username.toUpperCase()}` : "TRANSPARENT GIF"}`;
      useButton.disabled = false;
    } else {
      image.src = "/vendor/lucide/icons/sticker.svg";
      title.textContent = "No sticker selected";
      note.textContent = "Choose a transparent animated result";
      useButton.disabled = true;
    }
  }

  function resultButton(sticker) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "giphy-picker-item";
    button.dataset.giphyId = sticker.id;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.title = stickerTitle(sticker);

    const image = document.createElement("img");
    image.src = previewUrl(sticker);
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    const label = document.createElement("span");
    label.textContent = stickerTitle(sticker);
    button.append(image, label);
    button.addEventListener("click", () => setSelection(sticker));
    button.addEventListener("dblclick", () => {
      setSelection(sticker);
      useSelectedSticker();
    });
    return button;
  }

  function renderResults(stickers, query, cached = false) {
    results.replaceChildren();
    setSelection(null);
    if (!stickers.length) {
      const empty = document.createElement("div");
      empty.className = "icon-picker-empty";
      const title = document.createElement("strong");
      title.textContent = "No transparent results";
      const note = document.createElement("span");
      note.textContent = "Try a broader subject, object, or action.";
      empty.append(title, note);
      results.appendChild(empty);
    } else {
      const fragment = document.createDocumentFragment();
      stickers.forEach((sticker) => fragment.appendChild(resultButton(sticker)));
      results.appendChild(fragment);
    }
    status.textContent = `${stickers.length} result${stickers.length === 1 ? "" : "s"} for “${query}”${cached ? " · cached" : " · 1 API call"}`;
  }

  function showSearchError(message) {
    results.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "icon-picker-empty";
    const title = document.createElement("strong");
    title.textContent = "Search unavailable";
    const note = document.createElement("span");
    note.textContent = message;
    empty.append(title, note);
    results.appendChild(empty);
    status.textContent = message;
  }

  async function searchStickers(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized || searching) return;
    if (!apiKey) {
      showKeySetup(true, true);
      return;
    }
    if (searchCache.has(normalized)) {
      renderResults(searchCache.get(normalized), query.trim(), true);
      return;
    }

    searching = true;
    searchInput.disabled = true;
    searchButton.disabled = true;
    searchButton.textContent = "Searching…";
    status.textContent = `Searching transparent Stickers for “${query.trim()}”…`;
    results.setAttribute("aria-busy", "true");
    try {
      const params = new URLSearchParams({
        api_key: apiKey,
        q: query.trim(),
        limit: String(SEARCH_LIMIT),
        offset: "0",
        rating: "g",
        lang: "en",
      });
      const response = await fetch(`https://api.giphy.com/v1/stickers/search?${params}`, {
        mode: "cors",
        credentials: "omit",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.meta?.status >= 400) {
        const reason = payload?.meta?.msg || `GIPHY returned ${response.status}`;
        throw new Error(reason);
      }
      const stickers = Array.isArray(payload.data)
        ? payload.data.filter((sticker) => sticker?.id && previewUrl(sticker))
        : [];
      searchCache.set(normalized, stickers);
      renderResults(stickers, query.trim());
    } catch (error) {
      const unauthorized = /401|403|api key|unauthorized|forbidden/i.test(error.message || "");
      showSearchError(unauthorized
        ? "That API key was not accepted. Check it in the one-time setup."
        : (error.message || "GIPHY could not be reached."));
      if (unauthorized) showKeySetup(true);
    } finally {
      searching = false;
      results.removeAttribute("aria-busy");
      searchButton.textContent = "Search";
      searchInput.disabled = !keySetup.hidden;
      searchButton.disabled = !keySetup.hidden;
    }
  }

  async function useSelectedSticker() {
    if (!selectedSticker || !window.contourLoom?.useGiphySticker) return;
    useButton.disabled = true;
    useButton.classList.add("working");
    useButton.textContent = "Loading Sticker…";
    status.textContent = "Downloading the selected transparent GIF…";
    try {
      await window.contourLoom.useGiphySticker(selectedSticker);
      dialog.close("used");
    } catch (error) {
      status.textContent = error.message || "This GIPHY Sticker could not be used.";
      useButton.disabled = false;
    } finally {
      useButton.classList.remove("working");
      useButton.textContent = "Use as contour";
    }
  }

  function openPicker() {
    if (!dialog.open) dialog.showModal();
    setSelection(null);
    if (!apiKey) showKeySetup(true, true);
    else {
      showKeySetup(false);
      status.textContent = "Search runs only when submitted";
      requestAnimationFrame(() => searchInput.focus());
    }
  }

  function closePicker() {
    if (dialog.open) dialog.close("cancel");
  }

  document.querySelector("#contourOpenGiphyPicker").addEventListener("click", openPicker);
  document.querySelector("#contourGiphyPickerClose").addEventListener("click", closePicker);
  document.querySelector("#contourGiphyPickerCancel").addEventListener("click", closePicker);
  useButton.addEventListener("click", useSelectedSticker);
  manageKeyButton.addEventListener("click", () => showKeySetup(keySetup.hidden, true));
  clearKeyButton.addEventListener("click", () => {
    apiKey = "";
    try {
      localStorage.removeItem(API_KEY_STORAGE);
    } catch (_) {
      // Storage can be unavailable in a private browser session.
    }
    searchCache.clear();
    keyInput.value = "";
    clearKeyButton.hidden = true;
    status.textContent = "Saved key removed from this browser";
    keyInput.focus();
  });
  keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = keyInput.value.trim();
    if (value.length < 8) {
      status.textContent = "Paste the complete API key before saving.";
      keyInput.focus();
      return;
    }
    saveKey(value);
    searchCache.clear();
    showKeySetup(false, true);
    status.textContent = "Key saved locally · enter a search when ready";
  });
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchStickers(searchInput.value);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePicker();
  });
})();
