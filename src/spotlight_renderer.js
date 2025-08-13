const { ipcRenderer } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const scriptSearchInput = document.getElementById("script-search-bar");
const scriptSuggestionsContainer = document.getElementById(
  "suggestions-container",
);
const executeScriptButton = document.getElementById("execute-button");

const scriptsBaseDirectory = path.join(os.homedir(), "Documents", "Tritium");

function applyAccentColor() {
  try {
    const accentColor = localStorage.getItem("accentColor") || "#7FB4FF";
    document.documentElement.style.setProperty("--accent-color", accentColor);
    const vibrancyEnabled = localStorage.getItem("vibrancyEnabled") === "true";
    ipcRenderer.send("set-spvibrancy", vibrancyEnabled);
  } catch (error) {
    console.error("Error applying accent color:", error);
  }
}

let allAvailableScriptNames = [];
let currentlyDisplayedScriptNames = [];
let selectedSuggestionIndex = -1;

class ScriptItem {
  constructor(title, content, options = {}) {
    this.title = title;
    this.content = content;
    this.game = options.game || "Saved";
    this.type = options.type || "local";
    this.source = options.source || "Local";
    this._id = options._id || null;
    this.rawScript = options.rawScript || null;
  }

  getDisplayText() {
    return this.title;
  }

  getDetailsText() {
    return `${this.game} • ${this.source}`;
  }
}

async function loadAvailableScriptNames() {
  try {
    const filenames = await ipcRenderer.invoke("list-scripts");
    const mappedNames = filenames.map((fileName) =>
      fileName.replace(/\.txt$/, ""),
    );
    const localScripts = [...new Set(mappedNames)].map(
      (name) => new ScriptItem(name, null, { type: "local", source: "Local" }),
    );

    const scriptHub = localStorage.getItem("scriptHub") || "both";

    let remoteScripts = [];

    if (scriptHub === "both") {
      const [scriptbloxScripts, rscriptsScripts] = await Promise.all([
        fetchScriptbloxScripts(),
        fetchRscriptsScripts(),
      ]);

      const maxLength = Math.max(
        scriptbloxScripts.length,
        rscriptsScripts.length,
      );
      const alternatingResults = [];
      for (let i = 0; i < maxLength; i++) {
        if (i < scriptbloxScripts.length)
          alternatingResults.push(scriptbloxScripts[i]);
        if (i < rscriptsScripts.length)
          alternatingResults.push(rscriptsScripts[i]);
      }
      remoteScripts = alternatingResults;
    } else if (scriptHub === "scriptblox") {
      remoteScripts = await fetchScriptbloxScripts();
    } else if (scriptHub === "rscripts") {
      remoteScripts = await fetchRscriptsScripts();
    }

    allAvailableScriptNames = [...localScripts, ...remoteScripts];

    displayInitialScriptSuggestions();
  } catch (error) {
    console.error("Error loading script names:", error);
    allAvailableScriptNames = [];
  }
}

async function fetchScriptbloxScripts() {
  try {
    const res = await fetch("https://scriptblox.com/api/script/fetch");
    const data = await res.json();

    if (data && data.result && data.result.scripts) {
      return data.result.scripts.map((script) => {
        const gameName =
          (script.game && (script.game.name || script.game.title)) ||
          "Unknown Game";
        return new ScriptItem(script.title || "Unnamed Script", null, {
          type: "scriptblox",
          source: "Scriptblox",
          game: gameName,
          _id: script._id,
          rawScript: script.rawScript,
        });
      });
    }
    return [];
  } catch (error) {
    console.error("Error fetching Scriptblox scripts:", error);
    return [];
  }
}

async function fetchRscriptsScripts() {
  try {
    const res = await fetch(
      "https://rscripts.net/api/v2/scripts?page=1&orderBy=date",
    );
    if (!res.ok) {
      console.error("Failed to fetch Rscripts:", res.status, res.statusText);
      return [];
    }
    const data = await res.json();
    if (data && data.scripts) {
      return data.scripts.map((script) => {
        const gameName =
          (script.game && (script.game.name || script.game.title)) ||
          "Unknown Game";
        return new ScriptItem(script.title || "Unnamed Script", null, {
          type: "rscripts",
          source: "Rscripts",
          game: gameName,
          _id: script._id,
          rawScript: script.script,
        });
      });
    }
    return [];
  } catch (error) {
    console.error("Error fetching Rscripts scripts:", error);
    return [];
  }
}

function displayInitialScriptSuggestions() {
  scriptSuggestionsContainer.innerHTML = "";
  selectedSuggestionIndex = -1;
  currentlyDisplayedScriptNames = [];

  if (allAvailableScriptNames.length === 0 && scriptSearchInput.value === "") {
    return;
  }

  const scriptsToShow = allAvailableScriptNames.slice(0, 20);

  scriptsToShow.forEach((scriptItem) => {
    currentlyDisplayedScriptNames.push(scriptItem);

    const suggestionElement = document.createElement("div");
    suggestionElement.classList.add("suggestion-item");

    const titleElement = document.createElement("span");
    titleElement.textContent = scriptItem.getDisplayText();
    suggestionElement.appendChild(titleElement);

    const detailsElement = document.createElement("small");
    detailsElement.textContent = scriptItem.getDetailsText();
    detailsElement.style.display = "block";
    detailsElement.style.opacity = "0.7";
    suggestionElement.appendChild(detailsElement);

    suggestionElement.addEventListener("click", () => {
      scriptSearchInput.value = scriptItem.title;
      scriptSuggestionsContainer.innerHTML = "";
      executeScript(scriptItem);
    });
    scriptSuggestionsContainer.appendChild(suggestionElement);
  });
}

async function fetchScriptContent(scriptItem) {
  try {
    if (scriptItem.type === "local") {
      const fullScriptPath = path.join(
        scriptsBaseDirectory,
        `${scriptItem.title}.txt`,
      );
      if (!fs.existsSync(fullScriptPath)) {
        console.warn(`Script file not found at: ${fullScriptPath}`);
        return null;
      }
      return fs.readFileSync(fullScriptPath, "utf8");
    } else if (scriptItem.type === "scriptblox") {
      if (scriptItem.rawScript) {
        const response = await fetch(scriptItem.rawScript);
        if (response.ok) {
          return await response.text();
        }
      }

      if (scriptItem._id) {
        try {
          const directUrl = `https://scriptblox.com/raw/${scriptItem._id}`;
          const directRes = await fetch(directUrl);
          if (directRes.ok) {
            const content = await directRes.text();
            if (
              content &&
              content.length > 0 &&
              !content.includes("<!DOCTYPE html>")
            ) {
              return content;
            }
          }
        } catch (directErr) {
          console.log("Direct fetch failed:", directErr);
        }

        const res = await fetch(
          `https://scriptblox.com/api/script/${scriptItem._id}`,
        );
        const data = await res.json();

        if (data && data.script) {
          return data.script;
        }

        if (data && data.result) {
          if (data.result.script) return data.result.script;
          if (data.result.content) return data.result.content;
        }
      }
    } else if (scriptItem.type === "rscripts" && scriptItem._id) {
      if (scriptItem.rawScript) {
        return scriptItem.rawScript;
      }

      const res = await fetch(
        `https://rscripts.net/api/v2/script?id=${scriptItem._id}`,
      );
      const data = await res.json();
      if (data && data.script) {
        return data.script;
      }
    }

    return null;
  } catch (error) {
    console.error(
      `Error fetching script content for ${scriptItem.title}:`,
      error,
    );
    return null;
  }
}

async function displayFilteredScriptSuggestions(searchText) {
  scriptSuggestionsContainer.innerHTML = "";
  selectedSuggestionIndex = -1;
  currentlyDisplayedScriptNames = [];

  if (!searchText) {
    displayInitialScriptSuggestions();
    return;
  }

  const lowerSearchText = searchText.toLowerCase();

  let filteredScripts = allAvailableScriptNames.filter(
    (script) =>
      script.title.toLowerCase().includes(lowerSearchText) ||
      script.game.toLowerCase().includes(lowerSearchText),
  );

  if (filteredScripts.length < 5 && searchText.length >= 3) {
    const loadingIndicator = document.createElement("div");
    loadingIndicator.classList.add("suggestion-item");
    scriptSuggestionsContainer.appendChild(loadingIndicator);

    const remoteScripts = await searchRemoteScripts(searchText);

    const existingTitles = new Set(
      filteredScripts.map((s) => s.title.toLowerCase()),
    );
    const uniqueRemoteScripts = remoteScripts.filter(
      (s) => !existingTitles.has(s.title.toLowerCase()),
    );

    filteredScripts = [...filteredScripts, ...uniqueRemoteScripts];

    scriptSuggestionsContainer.innerHTML = "";
  }

  const scriptsToShow = filteredScripts.slice(0, 20);
  currentlyDisplayedScriptNames = scriptsToShow;

  if (scriptsToShow.length === 0) {
    const noResults = document.createElement("div");
    noResults.classList.add("suggestion-item");
    noResults.textContent = "No scripts found";
    scriptSuggestionsContainer.appendChild(noResults);
    return;
  }

  scriptsToShow.forEach((scriptItem) => {
    const suggestionElement = document.createElement("div");
    suggestionElement.classList.add("suggestion-item");

    const titleElement = document.createElement("span");
    titleElement.textContent = scriptItem.getDisplayText();
    suggestionElement.appendChild(titleElement);

    const detailsElement = document.createElement("small");
    detailsElement.textContent = scriptItem.getDetailsText();
    detailsElement.style.display = "block";
    detailsElement.style.opacity = "0.7";
    suggestionElement.appendChild(detailsElement);

    suggestionElement.addEventListener("click", () => {
      scriptSearchInput.value = scriptItem.title;
      scriptSuggestionsContainer.innerHTML = "";
      executeScript(scriptItem);
    });
    scriptSuggestionsContainer.appendChild(suggestionElement);
  });

  if (currentlyDisplayedScriptNames.length > 0) {
    selectedSuggestionIndex = 0;
    highlightCurrentSuggestion(selectedSuggestionIndex);
  }
}

async function searchRemoteScripts(query) {
  try {
    const scriptHub = localStorage.getItem("scriptHub") || "both";

    if (scriptHub === "both") {
      const [scriptbloxResults, rscriptsResults] = await Promise.all([
        searchScriptbloxScripts(query),
        searchRscriptsScripts(query),
      ]);

      const maxLength = Math.max(
        scriptbloxResults.length,
        rscriptsResults.length,
      );
      const alternatingResults = [];
      for (let i = 0; i < maxLength; i++) {
        if (i < scriptbloxResults.length)
          alternatingResults.push(scriptbloxResults[i]);
        if (i < rscriptsResults.length)
          alternatingResults.push(rscriptsResults[i]);
      }
      return alternatingResults;
    } else if (scriptHub === "scriptblox") {
      return await searchScriptbloxScripts(query);
    } else if (scriptHub === "rscripts") {
      return await searchRscriptsScripts(query);
    }

    return [];
  } catch (error) {
    console.error("Error searching remote scripts:", error);
    return [];
  }
}

async function searchScriptbloxScripts(query) {
  try {
    const searchUrl = `https://scriptblox.com/api/script/search?q=${encodeURIComponent(query)}&`;
    const response = await fetch(searchUrl);
    const data = await response.json();

    if (
      data &&
      data.result &&
      data.result.scripts &&
      data.result.scripts.length > 0
    ) {
      return data.result.scripts.map((script) => {
        const gameName =
          (script.game && (script.game.name || script.game.title)) ||
          "Unknown Game";
        return new ScriptItem(script.title || "Unnamed Script", null, {
          type: "scriptblox",
          source: "Scriptblox",
          game: gameName,
          _id: script._id,
          rawScript: script.rawScript,
        });
      });
    }
    return [];
  } catch (error) {
    console.error("Error searching Scriptblox:", error);
    return [];
  }
}

async function searchRscriptsScripts(query) {
  try {
    const rUrl = `https://rscripts.net/api/v2/scripts?q=${encodeURIComponent(query)}&page=1&orderBy=date`;
    const rRes = await fetch(rUrl);
    if (!rRes.ok) {
      console.error("Failed to search Rscripts:", rRes.status, rRes.statusText);
      return [];
    }
    const rData = await rRes.json();

    if (rData && rData.scripts) {
      return rData.scripts.map((script) => {
        const gameName =
          (script.game && (script.game.name || script.game.title)) ||
          "Unknown Game";
        return new ScriptItem(script.title || "Unnamed Script", null, {
          type: "rscripts",
          source: "Rscripts",
          game: gameName,
          _id: script._id,
          rawScript: script.script,
        });
      });
    }
    return [];
  } catch (error) {
    console.error("Error searching Rscripts:", error);
    return [];
  }
}

async function executeScript(scriptItem) {
  try {
    if (!scriptItem) {
      console.warn("No script provided to execute.");
      return;
    }

    if (!scriptItem.content) {
      console.log(`Fetching content for script: ${scriptItem.title}`);
      scriptItem.content = await fetchScriptContent(scriptItem);
    }

    if (!scriptItem.content) {
      ipcRenderer.send("hide-spotlight-window");
      console.warn(`No content found for script: ${scriptItem.title}`);
      return;
    }

    ipcRenderer.send("invokeAction", scriptItem.content);

    scriptSearchInput.value = "";
    scriptSuggestionsContainer.innerHTML = "";
    currentlyDisplayedScriptNames = [];

    ipcRenderer.send("hide-spotlight-window");

    loadAvailableScriptNames();
  } catch (error) {
    console.error(`Error executing script ${scriptItem.title}:`, error);
  }
}

function highlightCurrentSuggestion(suggestionIndex) {
  const suggestionElements =
    scriptSuggestionsContainer.getElementsByClassName("suggestion-item");
  for (let i = 0; i < suggestionElements.length; i++) {
    suggestionElements[i].classList.remove("selected");
  }
  if (suggestionIndex >= 0 && suggestionIndex < suggestionElements.length) {
    suggestionElements[suggestionIndex].classList.add("selected");
    suggestionElements[suggestionIndex].scrollIntoView({ block: "nearest" });
  }
}

scriptSearchInput.addEventListener("input", (event) => {
  displayFilteredScriptSuggestions(event.target.value);
});

scriptSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (
      selectedSuggestionIndex !== -1 &&
      currentlyDisplayedScriptNames[selectedSuggestionIndex]
    ) {
      const selectedItem =
        currentlyDisplayedScriptNames[selectedSuggestionIndex];
      scriptSearchInput.value = selectedItem.title;
      executeScript(selectedItem);
    } else if (scriptSearchInput.value.trim() !== "") {
      const typedScriptName = scriptSearchInput.value.trim();

      const matchedScript = allAvailableScriptNames.find(
        (script) =>
          script.title.toLowerCase() === typedScriptName.toLowerCase(),
      );

      if (matchedScript) {
        executeScript(matchedScript);
      } else if (currentlyDisplayedScriptNames.length > 0) {
        executeScript(currentlyDisplayedScriptNames[0]);
      } else {
        const scriptItem = new ScriptItem(typedScriptName, null, {
          type: "local",
          source: "Local",
        });
        executeScript(scriptItem);
      }
    }

    scriptSuggestionsContainer.innerHTML = "";
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    if (currentlyDisplayedScriptNames.length > 0) {
      selectedSuggestionIndex =
        (selectedSuggestionIndex + 1) % currentlyDisplayedScriptNames.length;
      highlightCurrentSuggestion(selectedSuggestionIndex);
    }
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (currentlyDisplayedScriptNames.length > 0) {
      selectedSuggestionIndex =
        (selectedSuggestionIndex - 1 + currentlyDisplayedScriptNames.length) %
        currentlyDisplayedScriptNames.length;
      highlightCurrentSuggestion(selectedSuggestionIndex);
    }
  } else if (event.key === "Escape") {
    ipcRenderer.send("hide-spotlight-window");
  }
});

executeScriptButton.addEventListener("click", () => {
  if (
    selectedSuggestionIndex !== -1 &&
    currentlyDisplayedScriptNames[selectedSuggestionIndex]
  ) {
    const selectedItem = currentlyDisplayedScriptNames[selectedSuggestionIndex];
    scriptSearchInput.value = selectedItem.title;
    executeScript(selectedItem);
  } else if (scriptSearchInput.value.trim() !== "") {
    const typedScriptName = scriptSearchInput.value.trim();

    const matchedScript = allAvailableScriptNames.find(
      (script) => script.title.toLowerCase() === typedScriptName.toLowerCase(),
    );

    if (matchedScript) {
      executeScript(matchedScript);
    } else if (currentlyDisplayedScriptNames.length > 0) {
      executeScript(currentlyDisplayedScriptNames[0]);
    } else {
      const scriptItem = new ScriptItem(typedScriptName, null, {
        type: "local",
        source: "Local",
      });
      executeScript(scriptItem);
    }
  }

  ipcRenderer.send("hide-spotlight-window");
});

ipcRenderer.on("spotlight-shown", () => {
  scriptSearchInput.value = "";
  scriptSuggestionsContainer.innerHTML = "";
  currentlyDisplayedScriptNames = [];
  selectedSuggestionIndex = -1;
  loadAvailableScriptNames();
  scriptSearchInput.focus();

  applyAccentColor();
});

window.addEventListener("storage", function (e) {
  if (e.key === "scriptHub") {
    loadAvailableScriptNames();
  }
});

loadAvailableScriptNames();
scriptSearchInput.focus();

applyAccentColor();
