const kitFile = document.getElementById("kitFile");
const importButton = document.getElementById("importKit");
const fillButton = document.getElementById("fillPage");
const forgetButton = document.getElementById("forgetKit");
const status = document.getElementById("status");

function showStatus(message) {
  status.textContent = message;
}

function validKit(kit) {
  return (
    kit &&
    Array.isArray(kit.profile) &&
    kit.profile.some(
      (item) =>
        typeof item?.label === "string" &&
        typeof item?.value === "string" &&
        item.value.trim(),
    ) &&
    Array.isArray(kit.answers)
  );
}

async function loadKit() {
  try {
    const { applyKit } = await chrome.storage.local.get("applyKit");
    const ready = validKit(applyKit);
    fillButton.disabled = !ready;
    forgetButton.hidden = !ready;
    showStatus(ready ? "Apply Kit is ready." : "Import your Apply Kit to begin.");
  } catch (error) {
    showStatus(`Could not read the saved Apply Kit: ${error.message}`);
  }
}

importButton.addEventListener("click", () => kitFile.click());

kitFile.addEventListener("change", async () => {
  const file = kitFile.files?.[0];
  if (!file) return;

  try {
    const kit = JSON.parse(await file.text());
    if (!validKit(kit)) {
      throw new Error("The file must contain profile and answers lists.");
    }

    const applyKit = {
      profile: kit.profile
        .filter(
          (item) =>
            typeof item?.label === "string" &&
            typeof item?.value === "string",
        )
        .map(({ label, value }) => ({ label, value })),
      answers: kit.answers
        .filter(
          (item) =>
            typeof item?.label === "string" &&
            typeof item?.value === "string",
        )
        .map(({ label, value }) => ({ label, value })),
    };
    await chrome.storage.local.set({ applyKit });
    await loadKit();
  } catch (error) {
    showStatus(`Could not import Apply Kit: ${error.message}`);
  } finally {
    kitFile.value = "";
  }
});

forgetButton.addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove("applyKit");
    await loadKit();
  } catch (error) {
    showStatus(`Could not remove the saved Apply Kit: ${error.message}`);
  }
});

fillButton.addEventListener("click", async () => {
  fillButton.disabled = true;
  try {
    const [{ applyKit }] = await Promise.all([
      chrome.storage.local.get("applyKit"),
    ]);
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) {
      throw new Error("Open an application page in this tab first.");
    }

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillApplicationFields,
      args: [applyKit],
    });
    const result = injection?.result;
    if (!result) {
      throw new Error("The page did not return a fill result.");
    }

    showStatus(
      result.filled
        ? `Filled ${result.filled} field${result.filled === 1 ? "" : "s"}. Review them, finish unmatched fields, and upload your resume manually.`
        : "No confidently matched empty fields found. Fill the form and upload your resume manually.",
    );
  } catch (error) {
    showStatus(`Could not fill this page: ${error.message}`);
  } finally {
    fillButton.disabled = false;
  }
});

loadKit();
