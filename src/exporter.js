const NO_OP = () => {};

function titleize(key = "") {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

function normalizeManouverTypes(map) {
  if (!map || typeof map !== "object") return [];
  return Object.keys(map).map(key => {
    const entry = map[key];
    if (entry && typeof entry === "object") {
      const rawTitle = typeof entry.title === "string" ? entry.title : "";
      const title = rawTitle.trim().length ? rawTitle.trim() : titleize(key);
      const description =
        typeof entry.description === "string" ? entry.description : "";
      return { key, title, description };
    }
    if (typeof entry === "string") {
      return { key, title: titleize(key), description: entry };
    }
    return { key, title: titleize(key), description: "" };
  });
}

function updateSelectionState(container, confirmBtn, selectedKey) {
  if (!container) return;
  const radios = container.querySelectorAll('input[name="manouverOption"]');
  let found = false;
  radios.forEach(radio => {
    const matched = selectedKey && radio.value === selectedKey;
    radio.checked = matched;
    radio.closest(".manouver-option")?.classList.toggle("selected", matched);
    if (matched) found = true;
  });
  if (confirmBtn) confirmBtn.disabled = !found;
  return found;
}

function buildOptionElements({
  container,
  options,
  confirmBtn,
  onSelect,
  initialKey
}) {
  if (!container) return;
  container.innerHTML = "";
  options.forEach(({ key, title, description }) => {
    const label = document.createElement("label");
    label.className = "manouver-option";
    label.dataset.key = key;

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "manouverOption";
    radio.value = key;

    const details = document.createElement("div");
    details.className = "manouver-details";

    const titleEl = document.createElement("div");
    titleEl.className = "manouver-title";
    titleEl.textContent = title;
    details.append(titleEl);

    if (description) {
      const descEl = document.createElement("div");
      descEl.className = "manouver-desc";
      descEl.textContent = description;
      details.append(descEl);
    }

    radio.addEventListener("change", () => {
      onSelect(radio.value);
    });

    label.append(radio, details);
    container.append(label);
  });

  const hasInitial = updateSelectionState(container, confirmBtn, initialKey);
  if (!hasInitial && confirmBtn) {
    confirmBtn.disabled = true;
  }
}

function downloadJson(payload, filename) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function createExporter({
  manouverTypes,
  dialog,
  form,
  optionsContainer,
  cancelButton,
  confirmButton,
  beforePrompt,
  exportButton,
  onCollectData,
  onStatus = NO_OP
} = {}) {
  const options = normalizeManouverTypes(manouverTypes);
  let optionsBuilt = false;
  let lastSelectedKey = options[0]?.key ?? null;
  let keyNavAttached = false;
  let dialogClosing = false;
  let exportInFlight = false;

  const ensureOptions = () => {
    if (optionsBuilt || !optionsContainer) return;
    buildOptionElements({
      container: optionsContainer,
      options,
      confirmBtn: confirmButton,
      onSelect: key => {
        lastSelectedKey = key;
        updateSelectionState(optionsContainer, confirmButton, key);
      },
      initialKey: lastSelectedKey
    });
    optionsBuilt = true;
  };

  const getOptionRadios = () => {
    if (!optionsContainer) return [];
    return Array.from(
      optionsContainer.querySelectorAll('input[name="manouverOption"]')
    );
  };

  const moveSelection = (delta) => {
    const radios = getOptionRadios();
    if (!radios.length) return null;
    let idx = radios.findIndex(radio => radio.checked);
    if (idx === -1) {
      idx = delta > 0 ? 0 : radios.length - 1;
    } else {
      const len = radios.length;
      idx = (idx + delta + len) % len;
    }
    const next = radios[idx];
    if (next) {
      next.checked = true;
      lastSelectedKey = next.value;
      updateSelectionState(optionsContainer, confirmButton, next.value);
    }
    return next;
  };

  const confirmSelection = () => {
    if (!optionsContainer || !dialog?.open || dialogClosing) return false;
    const selected = optionsContainer.querySelector(
      'input[name="manouverOption"]:checked'
    );
    if (!selected) return false;
    dialogClosing = true;
    dialog.returnValue = selected.value;
    dialog.close(selected.value);
    return true;
  };

  const handleKeydown = (evt) => {
    if (!dialog?.open) return;
    const target = evt.target;
    const withinDialog =
      target === document.body || target === dialog || dialog.contains(target);
    if (!withinDialog) return;

    const key = evt.key;
    if (key === "ArrowDown" || key === "ArrowRight") {
      const changed = moveSelection(1);
      if (changed) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
      }
    } else if (key === "ArrowUp" || key === "ArrowLeft") {
      const changed = moveSelection(-1);
      if (changed) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
      }
    } else if (key === "Enter") {
      const accepted = confirmSelection();
      if (accepted) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
      }
    } else if (key.toLowerCase?.() === "e") {
      const accepted = confirmSelection();
      if (accepted) {
        evt.preventDefault();
        evt.stopImmediatePropagation();
      }
    }
  };

  const enableKeyNav = () => {
    if (keyNavAttached) return;
    document.addEventListener("keydown", handleKeydown, true);
    keyNavAttached = true;
  };

  const disableKeyNav = () => {
    if (!keyNavAttached) return;
    document.removeEventListener("keydown", handleKeydown, true);
    keyNavAttached = false;
  };

  const promptManouver = async () => {
    if (!dialog || !optionsContainer || options.length === 0) {
      return null;
    }

    ensureOptions();
    updateSelectionState(optionsContainer, confirmButton, lastSelectedKey);
    dialog.returnValue = "";

    return new Promise(resolve => {
      const handleClose = () => {
        dialog.removeEventListener("close", handleClose);
        disableKeyNav();
        dialogClosing = false;
        const value = dialog.returnValue;
        if (value) {
          lastSelectedKey = value;
          resolve(value);
        } else {
          resolve(null);
        }
      };

      dialog.addEventListener("close", handleClose, { once: true });

      try {
        dialog.showModal();
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (active && dialog.contains(active)) {
            active.blur?.();
          }
        });
        enableKeyNav();
      } catch (err) {
        console.error("Failed to open manouver selection dialog", err);
        dialog.removeEventListener("close", handleClose);
        disableKeyNav();
        dialogClosing = false;
        resolve(null);
      }
    });
  };

  confirmButton?.addEventListener("click", evt => {
    evt.preventDefault?.();
    confirmSelection();
  });

  cancelButton?.addEventListener("click", () => {
    dialog?.close("");
  });

  dialog?.addEventListener("cancel", evt => {
    evt.preventDefault();
    dialog.close("");
  });

  const exportAll = async () => {
    if (exportInFlight) return;
    exportInFlight = true;
    try {
      if (!onCollectData) return;
      const snapshot = await onCollectData();
      if (!snapshot) return;

      if (beforePrompt) {
        try {
          const proceed = await beforePrompt(snapshot);
          if (proceed === true) {
            // continue
          } else if (proceed === false) {
            onStatus("Export canceled.");
            return;
          } else {
            return;
          }
        } catch (err) {
          console.error("Pre-export check failed", err);
          onStatus("Export canceled.");
          return;
        }
      }

      let manouverKey = null;
      if (options.length > 0) {
        manouverKey = await promptManouver();
        if (!manouverKey) {
          onStatus("Export canceled.");
          return;
        }
      }

      const payload = { ...snapshot.payload };
      if (manouverKey) {
        payload.manouver_type = manouverKey;
      }

      const filename =
        typeof snapshot.filename === "string" && snapshot.filename.length
          ? snapshot.filename
          : "export.json";

      downloadJson(payload, filename);
    } catch (err) {
      console.error("Export failed", err);
      onStatus("Export failed.");
    } finally {
      exportInFlight = false;
    }
  };

  exportButton?.addEventListener("click", evt => {
    evt?.preventDefault?.();
    void exportAll();
  });

  return { exportAll };
}
