const noop = () => {};

export function setupScenarioDirectoryPicker({
  basePath,
  dialog,
  selectButton,
  cancelButton,
  triggerButton,
  onStatus = noop,
  onSelected = noop
} = {}) {
  const normalizedBase =
    typeof basePath === "string" ? basePath.trim().replace(/\/*$/, "") : "";

  const directoryAccessSupported =
    typeof window.showDirectoryPicker === "function";

  const reminder = normalizedBase
    ? `Ensure the network share is mounted. Expected base path: ${normalizedBase}`
    : "Select a scenario directory. Network shares must be mounted beforehand.";

  const openDialog = () => {
    if (!dialog) return;
    if (!directoryAccessSupported) {
      onStatus(
        "Directory selection is not supported in this browser. Please use a Chromium-based browser."
      );
      return;
    }
    onStatus(reminder);
    try {
      dialog.showModal();
    } catch (err) {
      // Ignore DOMException if already open
      if (!(err instanceof DOMException && err.name === "InvalidStateError")) {
        console.error("Failed to open scenario directory dialog", err);
      }
    }
  };

  const closeDialog = () => {
    try {
      dialog?.close();
    } catch (_) {
      // dialog might not be open — ignore
    }
  };

  const chooseDirectory = async () => {
    if (typeof window.showDirectoryPicker !== "function") {
      onStatus(
        "Directory selection is not supported in this browser. Please use a Chromium-based browser."
      );
      closeDialog();
      return null;
    }

    onStatus(`${reminder} Select a scenario folder to continue.`);

    let handle = null;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        onStatus(
          "Scenario directory selection canceled. Ensure the directory is accessible and try again."
        );
      } else {
        console.error("Failed to select scenario directory", err);
        onStatus(
          "Unable to access the selected directory. Confirm it exists and that you have permission to write there."
        );
      }
      return null;
    }

    if (!handle) return null;

    closeDialog();

    const suggestedPath = normalizedBase
      ? `${normalizedBase}/${handle.name}`
      : handle.name;

    const selection = {
      handle,
      name: handle.name,
      suggestedPath
    };

    onSelected(selection);
    onStatus(`Scenario directory set to "${selection.suggestedPath}".`);
    return handle;
  };

  selectButton?.addEventListener("click", () => {
    void chooseDirectory();
  });

  triggerButton?.addEventListener("click", () => {
    openDialog();
  });

  cancelButton?.addEventListener("click", () => {
    closeDialog();
    onStatus(
      "Scenario directory selection skipped. You can choose one later via the Scenario Dir button."
    );
  });

  dialog?.addEventListener("cancel", evt => {
    evt.preventDefault();
    closeDialog();
    onStatus(
      "Scenario directory selection canceled. Ensure the target directory is accessible and try again."
    );
  });

  return {
    prompt: openDialog,
    chooseDirectory
  };
}
