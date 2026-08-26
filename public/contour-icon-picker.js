(() => {
  "use strict";

  const dialog = document.querySelector("#contourIconPicker");
  if (!dialog) return;

  const searchInput = document.querySelector("#contourIconSearch");
  const results = document.querySelector("#contourIconResults");
  const status = document.querySelector("#contourIconPickerStatus");
  const moreButton = document.querySelector("#contourIconMore");
  const useButton = document.querySelector("#contourIconUse");
  const selection = document.querySelector("#contourIconSelection");
  const PAGE_SIZE = 120;

  let manifest = null;
  let filteredIcons = [];
  let visibleCount = PAGE_SIZE;
  let selectedIcon = null;
  let loadPromise = null;
  let searchTimer = null;

  const normalize = (value) => String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  function prepareIcon(icon) {
    return {
      ...icon,
      searchIndex: normalize([icon.name, icon.label, ...(icon.tags || [])].join(" ")),
    };
  }

  async function loadManifest() {
    if (manifest) return manifest;
    if (loadPromise) return loadPromise;
    loadPromise = fetch("/vendor/lucide/manifest.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Icon library returned ${response.status}`);
        return response.json();
      })
      .then((data) => {
        manifest = { ...data, icons: data.icons.map(prepareIcon) };
        return manifest;
      })
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
    return loadPromise;
  }

  function iconUrl(icon) {
    return `/vendor/lucide/${icon.file}`;
  }

  function setSelection(icon, focusUseButton = false) {
    selectedIcon = icon;
    results.querySelectorAll("[role='option']").forEach((button) => {
      const selected = button.dataset.iconName === icon?.name;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-selected", String(selected));
    });

    const image = selection.querySelector("img");
    const title = selection.querySelector("strong");
    const note = selection.querySelector("small");
    if (icon) {
      image.src = iconUrl(icon);
      title.textContent = icon.label;
      note.textContent = `${icon.name}.svg · local Lucide shape`;
      useButton.disabled = false;
      if (focusUseButton) useButton.focus();
    } else {
      image.src = "/vendor/lucide/icons/shapes.svg";
      title.textContent = "No icon selected";
      note.textContent = "Choose a shape from the library";
      useButton.disabled = true;
    }
  }

  function resultButton(icon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-picker-item";
    button.dataset.iconName = icon.name;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(selectedIcon?.name === icon.name));
    button.title = icon.label;

    const image = document.createElement("img");
    image.src = iconUrl(icon);
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    const label = document.createElement("span");
    label.textContent = icon.label;
    button.append(image, label);
    if (selectedIcon?.name === icon.name) button.classList.add("selected");
    button.addEventListener("click", () => setSelection(icon));
    button.addEventListener("dblclick", () => {
      setSelection(icon);
      useSelectedIcon();
    });
    return button;
  }

  function renderResults() {
    results.replaceChildren();
    const visible = filteredIcons.slice(0, visibleCount);
    const fragment = document.createDocumentFragment();
    visible.forEach((icon) => fragment.appendChild(resultButton(icon)));
    results.appendChild(fragment);

    if (!filteredIcons.length) {
      const empty = document.createElement("div");
      empty.className = "icon-picker-empty";
      empty.innerHTML = "<strong>No matching shapes</strong><span>Try a broader term such as arrow, flower, frame, person, or abstract.</span>";
      results.appendChild(empty);
    }

    const total = filteredIcons.length;
    const shown = Math.min(visibleCount, total);
    status.textContent = total === manifest.icons.length
      ? `${total.toLocaleString()} local icons · showing ${shown.toLocaleString()}`
      : `${total.toLocaleString()} match${total === 1 ? "" : "es"} · showing ${shown.toLocaleString()}`;
    moreButton.hidden = shown >= total;
    if (!moreButton.hidden) moreButton.textContent = `Show ${Math.min(PAGE_SIZE, total - shown)} more icons`;
  }

  function applySearch() {
    if (!manifest) return;
    const terms = normalize(searchInput.value).split(" ").filter(Boolean);
    filteredIcons = terms.length
      ? manifest.icons.filter((icon) => terms.every((term) => icon.searchIndex.includes(term)))
      : manifest.icons.slice();
    visibleCount = PAGE_SIZE;
    renderResults();
  }

  async function openPicker() {
    if (!dialog.open) dialog.showModal();
    dialog.classList.add("loading");
    status.textContent = "Loading local library…";
    results.setAttribute("aria-busy", "true");
    try {
      await loadManifest();
      const current = window.contourLoom?.getCurrentLucideIcon?.();
      selectedIcon = current ? manifest.icons.find((icon) => icon.name === current.name) || null : null;
      searchInput.value = "";
      filteredIcons = manifest.icons.slice();
      visibleCount = PAGE_SIZE;
      renderResults();
      setSelection(selectedIcon);
      requestAnimationFrame(() => searchInput.focus());
    } catch (error) {
      status.textContent = "The local icon library could not be loaded.";
      results.innerHTML = `<div class="icon-picker-empty"><strong>Library unavailable</strong><span>${error.message}</span></div>`;
      moreButton.hidden = true;
    } finally {
      dialog.classList.remove("loading");
      results.removeAttribute("aria-busy");
    }
  }

  function closePicker() {
    if (dialog.open) dialog.close("cancel");
  }

  async function useSelectedIcon() {
    if (!selectedIcon || !window.contourLoom?.useLucideIcon) return;
    useButton.disabled = true;
    useButton.classList.add("working");
    useButton.textContent = "Building contour…";
    try {
      await window.contourLoom.useLucideIcon(selectedIcon);
      dialog.close("used");
    } catch (error) {
      status.textContent = error.message || "This icon could not be used.";
      useButton.disabled = false;
    } finally {
      useButton.classList.remove("working");
      useButton.textContent = "Use as contour";
    }
  }

  document.querySelector("#contourOpenIconPicker").addEventListener("click", openPicker);
  document.querySelector("#contourIconPickerClose").addEventListener("click", closePicker);
  document.querySelector("#contourIconPickerCancel").addEventListener("click", closePicker);
  useButton.addEventListener("click", useSelectedIcon);
  moreButton.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    renderResults();
  });
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(applySearch, 90);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePicker();
  });
  dialog.addEventListener("close", () => {
    window.clearTimeout(searchTimer);
  });
})();
