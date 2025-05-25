const isElectron =
  window.navigator.userAgent.toLowerCase().indexOf("electron/") > -1;
let ipcRenderer;
if (isElectron) {
  try {
    ipcRenderer = require("electron").ipcRenderer;
  } catch (error) {
    console.warn("Failed to load electron modules:", error);
  }
}
const tabs = document.getElementById("tabs");
const editorContainer = document.getElementById("editor-container");
const scriptsList = document.getElementById("scripts");
const searchBox = document.getElementById("searchBox");
const sidebar = document.getElementById("sidebar");
const toast = document.getElementById("toast");
const contextMenu = document.getElementById("contextMenu");
const renameScriptBtn = document.getElementById("renameScript");
const deleteScriptBtn = document.getElementById("deleteScript");
const autoExecuteScriptBtn = document.getElementById("autoExecuteScript");
const autoExecuteCheckbox = document.getElementById("autoExecuteCheckbox");
const fs = require("fs");
const { spawn } = require("child_process");
const path = require("path");
const { console } = require("inspector");
const consoleOutput = document.getElementById("consoleOutput");
const clearConsoleBtn = document.getElementById("clearConsole");
const settingsButton = document.getElementById("settings-button");
const settingsPane = document.getElementById("settingsPane");
const closeSettingsBtn = document.getElementById("closeSettings");
const glowModeSelect = document.getElementById("glowMode");
const resetGlowBtn = document.getElementById("resetGlow");
const resetColorBtn = document.getElementById("resetColor");
const scriptsDirectory = path.join(
  require("os").homedir(),
  "Documents",
  "Tritium",
);
const toggleConsole = document.getElementById("toggleConsole");
const consoleContainer = document.querySelector(".console-container");
const toggleSidebar = document.getElementById("sidebar-toggle-btn");
const copilotBtn = document.getElementById("copilot-button");
const copilotPrompter = document.getElementById("copilot-prompter");
const promptInput = document.getElementById("promptInput");
const generateBtn = document.getElementById("generateBtn");
const cancelBtn = document.getElementById("cancelBtn");
const hydroUpdateBtn = document.getElementById("updateHydrogen");
const workspacesList = document.getElementById("workspaces-list");
const workspaceSidebar = document.getElementById("workspace-sidebar");
const workspaceToggleBtn = document.getElementById("workspace-toggle-btn");
const newWorkspaceBtn = document.getElementById("new-workspace-btn");
const clearWorkspaceBtn = document.getElementById("clear-workspace-btn");

let editors = {};
let savedScripts = [];
let currentTab = null;
let currentContextScript = null;
let updatedLoaded = false;
let updating = false;
let currentSearchId = 0;
let updatedScripts = [];
let consoleExpanded = true;
let sidebarOpen = false;
let workspaces = [];
let currentWorkspace = "default";
let workspaceSidebarOpen = true;

clearWorkspaceBtn.addEventListener("click", () => {
  if (confirm("Are you sure you want to delete all workspaces?")) {
    workspaces = [];
    setLocalStorage("workspaces", workspaces);
    loadWorkspaces();
    showToast("All workspaces deleted");
    if (sidebar.classList.contains("open")) {
      renderSidebar();
    }
  }
});

hydroUpdateBtn.addEventListener("click", async () => {
  settingsPane.classList.add("loading");
  hydroUpdateBtn.innerHTML = "Updating...";
  try {
    updating = true;
    await ipcRenderer.invoke("hydro-update");
    updating = false;
    showToast("Hydrogen updated successfully");
  } catch (error) {
    console.error(error);
    showToast("Error updating Hydrogen", true);
  } finally {
    hydroUpdateBtn.innerHTML = "Update Hydrogen";
  }
});

copilotBtn.addEventListener("click", () => {
  copilotPrompter.classList.toggle("visible");
  if (copilotPrompter.classList.contains("visible")) {
    promptInput.focus();
  }
});

generateBtn.addEventListener("click", async () => {
  const prompt = promptInput.value;
  if (!prompt) {
    showToast("Prompt cannot be empty", true);
    return;
  }

  try {
    copilotPrompter.classList.add("loading");
    generateBtn.innerHTML = "Generating...";
    const response = await fetch("http://tritiumcopilot.vercel.app/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(prompt),
    });

    const data = await response.json();
    console.log(data);
    if (data && data.response) {
      if (data.response.includes("Sorry I cannot help you with that.")) {
        showToast("Please try another prompt", true);
        return;
      }
      const editor = editors[currentTab];
      if (editor) {
        const resp = data.response.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        editor.setValue(resp);
        showToast("Script generated successfully");
        copilotPrompter.classList.remove("visible");
        promptInput.value = "";
      }
    } else {
      showToast("Error generating script", true);
    }
  } catch (error) {
    console.error("Error generating script:", error);
    showToast("Error generating script", true);
  } finally {
    copilotPrompter.classList.remove("loading");
    generateBtn.innerHTML = "Generate";
  }
});

cancelBtn.addEventListener("click", () => {
  copilotPrompter.classList.remove("visible");
});

toggleConsole.addEventListener("click", function () {
  if (!consoleExpanded) {
    consoleContainer.classList.remove("collapsed");
    toggleConsole.style.transition = "transform 0.3s ease";
    toggleConsole.style.transform = "rotate(360deg)";
    toggleConsole.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  } else {
    consoleContainer.classList.remove("collapsed");
    toggleConsole.style.transition = "transform 0.3s ease";
    toggleConsole.style.transform = "rotate(-360deg)";
    consoleContainer.classList.add("collapsed");
    toggleConsole.innerHTML = '<i class="fa-solid fa-chevron-up"></i>';
  }
  consoleExpanded = !consoleExpanded;
});

toggleConsole.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';

toggleSidebar.addEventListener("click", () => {
  renderSidebar();
  if (sidebarOpen) {
    toggleSidebar.style.transition = "transform 0.3s ease";
    toggleSidebar.style.transform = "rotate(360deg)";
    sidebar.classList.remove("open");
    sidebarOpen = false;
  } else {
    toggleSidebar.style.transition = "transform 0.3s ease";
    toggleSidebar.style.transform = "rotate(-360deg)";
    sidebar.classList.add("open");
    sidebarOpen = true;
  }
});

if (!fs.existsSync(scriptsDirectory)) {
  fs.mkdirSync(scriptsDirectory, { recursive: true });
}

function addLog(message, type = "info") {
  if (message.length > 200) {
    message = message.substring(0, 200) + "...";
  }
  const logElement = document.createElement("div");
  logElement.className = `log-${type} log-entry`;
  logElement.textContent = message;
  consoleOutput.appendChild(logElement);
  setTimeout(() => {
    logElement.classList.add("show");
  }, 10);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
clearConsoleBtn.addEventListener("click", () => {
  consoleOutput.innerHTML = "";
});

function startLogWatcher() {
  if (!isElectron || !ipcRenderer) return;
  ipcRenderer.invoke("start-log-watcher").then((result) => {
    if (result && result.success) {
      ipcRenderer.on("log-update", (event, logLine) => {
        let logType = "info";
        if (logLine.includes("ERROR") || logLine.includes("Error")) {
          logType = "error";
        } else if (logLine.includes("WARNING") || logLine.includes("Warning")) {
          logType = "warning";
        } else if (logLine.includes("SUCCESS") || logLine.includes("Success")) {
          logType = "success";
        } else if (logLine.includes("DEBUG") || logLine.includes("Debug")) {
          logType = "debug";
        }
        addLog(logLine, logType);
      });
    }
  });
}

let toastTimeout = null;
function showToast(message, isError = false) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toast.textContent = message;
  toast.className = isError ? "toast error show" : "toast show";
  toastTimeout = setTimeout(() => {
    toast.className = "toast";
    setTimeout(() => {
      toast.textContent = "";
    }, 300);
    toastTimeout = null;
  }, 3000);
}

function createEditor(tabId, content) {
  const editorWrapper = document.createElement("div");
  editorWrapper.className = "editor-wrapper";
  editorWrapper.id = `editor-${tabId}`;
  editorContainer.appendChild(editorWrapper);
  const luaGlobals = [
    "and",
    "break",
    "do",
    "else",
    "elseif",
    "end",
    "false",
    "for",
    "function",
    "goto",
    "if",
    "in",
    "local",
    "nil",
    "not",
    "or",
    "repeat",
    "return",
    "then",
    "true",
    "until",
    "while",

    "assert",
    "collectgarbage",
    "dofile",
    "error",
    "getmetatable",
    "ipairs",
    "load",
    "loadfile",
    "next",
    "pairs",
    "pcall",
    "print",
    "rawequal",
    "rawget",
    "rawlen",
    "rawset",
    "select",
    "setmetatable",
    "tonumber",
    "tostring",
    "type",
    "xpcall",
    "warn",

    "coroutine",
    "coroutine.create",
    "coroutine.resume",
    "coroutine.running",
    "coroutine.status",
    "coroutine.wrap",
    "coroutine.yield",
    "coroutine.isyieldable",
    "coroutine.close",

    "table",
    "table.concat",
    "table.insert",
    "table.move",
    "table.pack",
    "table.remove",
    "table.sort",
    "table.unpack",
    "table.clear",
    "table.find",
    "table.foreach",
    "table.foreachi",
    "table.getn",
    "table.isfrozen",
    "table.maxn",
    "table.create",

    "string",
    "string.byte",
    "string.char",
    "string.dump",
    "string.find",
    "string.format",
    "string.gmatch",
    "string.gsub",
    "string.len",
    "string.lower",
    "string.match",
    "string.rep",
    "string.reverse",
    "string.sub",
    "string.upper",
    "string.pack",
    "string.packsize",
    "string.unpack",
    "string.split",

    "math",
    "math.abs",
    "math.acos",
    "math.asin",
    "math.atan",
    "math.atan2",
    "math.ceil",
    "math.clamp",
    "math.cos",
    "math.cosh",
    "math.deg",
    "math.exp",
    "math.floor",
    "math.fmod",
    "math.frexp",
    "math.ldexp",
    "math.log",
    "math.log10",
    "math.max",
    "math.min",
    "math.modf",
    "math.pow",
    "math.rad",
    "math.random",
    "math.randomseed",
    "math.round",
    "math.sign",
    "math.sin",
    "math.sinh",
    "math.sqrt",
    "math.tan",
    "math.tanh",
    "math.pi",
    "math.huge",
    "math.noise",

    "io",
    "io.close",
    "io.flush",
    "io.input",
    "io.lines",
    "io.open",
    "io.output",
    "io.popen",
    "io.read",
    "io.stderr",
    "io.stdin",
    "io.stdout",
    "io.tmpfile",
    "io.type",
    "io.write",

    "os",
    "os.clock",
    "os.date",
    "os.difftime",
    "os.execute",
    "os.exit",
    "os.getenv",
    "os.remove",
    "os.rename",
    "os.setlocale",
    "os.time",
    "os.tmpname",

    "debug",
    "debug.debug",
    "debug.gethook",
    "debug.getinfo",
    "debug.getlocal",
    "debug.getmetatable",
    "debug.getregistry",
    "debug.getupvalue",
    "debug.getuservalue",
    "debug.sethook",
    "debug.setlocal",
    "debug.setmetatable",
    "debug.setupvalue",
    "debug.setuservalue",
    "debug.traceback",
    "debug.upvalueid",
    "debug.upvaluejoin",

    "package",
    "package.config",
    "package.cpath",
    "package.loaded",
    "package.loaders",
    "package.loadlib",
    "package.path",
    "package.preload",
    "package.searchers",
    "package.searchpath",

    "utf8",
    "utf8.char",
    "utf8.charpattern",
    "utf8.codepoint",
    "utf8.codes",
    "utf8.len",
    "utf8.offset",

    "bit32",
    "bit32.arshift",
    "bit32.band",
    "bit32.bnot",
    "bit32.bor",
    "bit32.btest",
    "bit32.bxor",
    "bit32.extract",
    "bit32.lrotate",
    "bit32.lshift",
    "bit32.replace",
    "bit32.rrotate",
    "bit32.rshift",

    "typeof",
    "getfenv",
    "setfenv",
    "shared",
    "script",
    "require",
    "spawn",
    "delay",
    "tick",
    "time",
    "UserSettings",
    "settings",
    "game",
    "workspace",
    "shared",
    "script",
    "wait",
    "Delay",
    "ElapsedTime",
    "elapsedTime",
    "require",

    "Vector2",
    "Vector3",
    "Vector2int16",
    "Vector3int16",
    "CFrame",
    "Color3",
    "ColorSequence",
    "NumberRange",
    "NumberSequence",
    "Rect",
    "UDim",
    "UDim2",
    "Faces",
    "Axes",
    "BrickColor",
    "Enum",
    "Instance",
    "TweenInfo",
    "Region3",
    "Region3int16",
    "Ray",
    "Random",
    "RaycastResult",

    "plugin",
    "command",
    "printidentity",
    "settings",
    "stats",
    "testservice",
    "http",
    "HttpService",
    "HttpRbxApiService",
    "ContextActionService",
    "RunService",
    "DataStoreService",
    "MessagingService",
    "CollectionService",
    "ContentProvider",
    "PathfindingService",
    "PhysicsService",
    "ReplicatedStorage",
    "ServerScriptService",
    "ServerStorage",
    "StarterGui",
    "StarterPack",
    "StarterPlayer",
    "Teams",
    "TeleportService",
    "TextService",
    "UserInputService",
    "VirtualInputManager",
    "VoiceChatService",
    "MarketplaceService",
    "GroupService",
    "LocalizationService",
    "NotificationService",
    "BadgeService",
    "GamePassService",
    "DataStoreService",
    "SocialService",
    "PlayerService",
    "Chat",
    "SoundService",
    "Lighting",
    "Workspace",
    "Players",
    "Debris",
    "NetworkClient",
    "NetworkServer",
    "Visit",
    "GuiService",
    "CoreGui",
    "CorePackages",
    "LogService",
    "MemoryStoreService",
    "PolicyService",
    "SessionService",
    "TextChatService",
    "ThirdPartyPurchaseService",
    "VersionControlService",
    "VRService",
  ];

  function luaHint(cm) {
    const cursor = cm.getCursor();
    const token = cm.getTokenAt(cursor);
    const start = token.start;
    const end = cursor.ch;
    const currentWord = token.string;

    const filtered = luaGlobals.filter((kw) => kw.startsWith(currentWord));
    return {
      list: filtered,
      from: CodeMirror.Pos(cursor.line, start),
      to: CodeMirror.Pos(cursor.line, end),
    };
  }

  const editor = CodeMirror(editorWrapper, {
    value: content || "-- New script",
    mode: "lua",
    theme: "material-darker",
    lineNumbers: true,
    indentUnit: 2,
    smartIndent: true,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: false,
    matchBrackets: true,
    autoCloseBrackets: true,
    extraKeys: {
      "Ctrl-Space": function (cm) {
        cm.showHint({ hint: luaHint });
      },
      Tab: function (cm) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const cursorPos = cursor.ch;
        const textBeforeCursor = line.substring(0, cursorPos);
        if (
          textBeforeCursor.trim().length > 0 &&
          !textBeforeCursor.endsWith(" ")
        ) {
          cm.showHint({ hint: luaHint });
        } else {
          cm.replaceSelection("  ", "end");
        }
      },
    },
  });

  editor.setSize("100%", "100%");

  editor.on("keyup", function (cm, event) {
    const allowedKeys = /^[a-zA-Z0-9_\.]$/;
    if (allowedKeys.test(event.key)) {
      cm.showHint({
        hint: luaHint,
        completeSingle: false,
      });
    }
  });

  return editor;
}

function setLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`Error saving ${key}:`, err);
  }
}

function getLocalStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch (err) {
    console.error(`Error loading ${key}:`, err);
    return fallback;
  }
}

function updateTabDisplayName(tab, newName) {
  let displayName = newName;
  if (newName.length >= 10) displayName = newName.substring(0, 5) + "...";
  tab.dataset.name = displayName;
  tab.querySelector("span").textContent = displayName;
}

function updateScriptNameEverywhere(originalName, newName) {
  const scriptIndex = savedScripts.findIndex((s) => s.title === originalName);
  if (scriptIndex !== -1) {
    savedScripts[scriptIndex].title = newName;
    let autoExecScripts = getLocalStorage("autoExecuteScripts", []);
    const autoExecIndex = autoExecScripts.indexOf(originalName);
    if (autoExecIndex !== -1) {
      autoExecScripts[autoExecIndex] = newName;
      setLocalStorage("autoExecuteScripts", autoExecScripts);
    }
    setLocalStorage("savedScripts", savedScripts);
    const filePath = path.join(scriptsDirectory, `${originalName}.txt`);
    const newFilePath = path.join(scriptsDirectory, `${newName}.txt`);
    fs.renameSync(filePath, newFilePath);
    showToast(`Script renamed to "${newName}"`);
    Array.from(tabs.children).forEach((tab) => {
      if (tab.dataset.realTabName === originalName) {
        tab.dataset.realTabName = newName;
        updateTabDisplayName(tab, newName);
      }
    });
  }
}

function loadSavedScripts() {
  savedScripts = [];
  try {
    if (fs.existsSync(scriptsDirectory)) {
      const files = fs.readdirSync(scriptsDirectory);
      files.forEach((file) => {
        if (file.endsWith(".txt")) {
          const filePath = path.join(scriptsDirectory, file);
          const content = fs.readFileSync(filePath, "utf8");
          let scriptName = file.replace(".txt", "").split(".")[0];
          savedScripts.push({ title: scriptName, script: content });
        }
      });
    }
  } catch (err) {
    console.error("Error loading saved scripts:", err);
    addLog("Error loading saved scripts: " + err.message, "error");
  }
}

function persistSavedScripts() {
  setLocalStorage("savedScripts", savedScripts);
}
function loadAutoExecuteScripts() {
  let autoexecuteScriptse = getLocalStorage("autoExecuteScripts", []);
  const autoexecDir = path.join(
    require("os").homedir() + "/Hydrogen",
    "autoexecute",
  );
  if (!fs.existsSync(autoexecDir)) {
    fs.mkdirSync(autoexecDir, { recursive: true });
  }
  let combinedScriptContent = "";
  console.log("Auto execute scripts:", autoexecuteScriptse);
  autoexecuteScriptse.forEach((scriptName) => {
    const script = savedScripts.find((s) => s.title === scriptName);
    console.log(script);
    if (script) {
      combinedScriptContent += script.script + "\n\n";
    }
  });
  const filePath = path.join(autoexecDir, `autoexecute.txt`);
  fs.writeFileSync(filePath, combinedScriptContent);

  return getLocalStorage("autoExecuteScripts", []);
}
function saveAutoExecuteScripts(scripts) {
  setLocalStorage("autoExecuteScripts", scripts);
  loadAutoExecuteScripts();
}
function isAutoExecuteScript(scriptName) {
  return loadAutoExecuteScripts().includes(scriptName);
}
function toggleAutoExecuteScript(scriptName) {
  const autoExecScripts = loadAutoExecuteScripts();
  const index = autoExecScripts.indexOf(scriptName);

  if (index === -1) {
    autoExecScripts.push(scriptName);
  } else {
    autoExecScripts.splice(index, 1);
  }

  saveAutoExecuteScripts(autoExecScripts);
  updateAutoExecuteCheckbox(scriptName);
  renderSidebar();
}
function updateAutoExecuteCheckbox(scriptName) {
  autoExecuteCheckbox.style.display = isAutoExecuteScript(scriptName)
    ? "inline"
    : "none";
}

function showContextMenu(e, scriptName) {
  e.preventDefault();
  currentContextScript = scriptName;
  currentContextWorkspace = null;
  contextMenu.innerHTML = "";
  const renameOption = document.createElement("div");
  renameOption.className = "context-menu-item";
  renameOption.innerHTML = '<i class="fas fa-edit"></i> Rename';
  renameOption.onclick = () => {
    renameScriptBtn.click();
    contextMenu.style.display = "none";
  };

  const deleteOption = document.createElement("div");
  deleteOption.className = "context-menu-item";
  deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete';
  deleteOption.onclick = () => {
    deleteScriptBtn.click();
    contextMenu.style.display = "none";
  };

  const autoExecuteOption = document.createElement("div");
  autoExecuteOption.className = "context-menu-item";
  autoExecuteOption.innerHTML = '<i class="fas fa-bolt"></i>Auto Execute';
  autoExecuteOption.onclick = () => {
    autoExecuteScriptBtn.click();
    contextMenu.style.display = "none";
  };

  contextMenu.appendChild(renameOption);
  contextMenu.appendChild(deleteOption);
  contextMenu.appendChild(autoExecuteOption);

  contextMenu.style.display = "block";
  contextMenu.style.left = `${e.pageX}px`;
  contextMenu.style.top = `${e.pageY}px`;
  updateAutoExecuteCheckbox(scriptName);
}

function showWorkspaceContextMenu(e, workspaceId) {
  e.preventDefault();

  currentContextWorkspace = workspaceId;
  currentContextScript = null;
  contextMenu.innerHTML = "";

  const renameOption = document.createElement("div");
  renameOption.className = "context-menu-item";
  renameOption.innerHTML = '<i class="fas fa-edit"></i> Rename';
  renameOption.onclick = () => {
    renameWorkspace(workspaceId);
    contextMenu.style.display = "none";
  };

  const deleteOption = document.createElement("div");
  deleteOption.className = "context-menu-item";
  deleteOption.innerHTML = '<i class="fas fa-trash"></i> Delete';
  deleteOption.onclick = () => {
    if (workspaces.length > 1) {
      deleteWorkspace(workspaceId);
    } else {
      showToast("Cannot delete the last workspace", true);
    }
    contextMenu.style.display = "none";
  };

  contextMenu.appendChild(renameOption);
  contextMenu.appendChild(deleteOption);

  contextMenu.style.display = "block";
  contextMenu.style.left = `${e.pageX}px`;
  contextMenu.style.top = `${e.pageY}px`;
}

document.addEventListener("click", () => {
  contextMenu.style.display = "none";
  currentContextScript = null;
  currentContextWorkspace = null;
});

renameScriptBtn.addEventListener("click", () => {
  if (!currentContextScript) return;
  const scriptItem = Array.from(document.querySelectorAll(".script-item")).find(
    (item) => {
      return (
        item.querySelector(".script-title").textContent === currentContextScript
      );
    },
  );
  if (!scriptItem) return;
  const titleElement = scriptItem.querySelector(".script-title");
  const originalName = titleElement.textContent;
  const input = document.createElement("input");
  input.type = "text";
  input.value = originalName;
  titleElement.replaceWith(input);
  input.focus();
  function handleRename() {
    const newName = input.value.trim().split(".")[0];
    if (newName === "Untitled") {
      showToast("Script name cannot be 'Untitled'", true);
      input.focus();
      return;
    }
    if (newName && newName !== originalName) {
      updateScriptNameEverywhere(originalName, newName);
    }
    titleElement.textContent = newName || originalName;
    input.replaceWith(titleElement);
  }
  input.addEventListener("blur", handleRename);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const newName = input.value.trim();
      if (newName === "Untitled") {
        showToast("Script name cannot be 'Untitled'", true);
        input.focus();
        return;
      }
      if (savedScripts.some((s) => s.title === newName)) {
        showToast(`Script "${newName}" already exists`, true);
        input.focus();
        return;
      }
      handleRename();
    } else if (e.key === "Escape") {
      input.value = originalName;
      input.blur();
    }
  });
  contextMenu.style.display = "none";
});
deleteScriptBtn.addEventListener("click", () => {
  if (!currentContextScript) return;
  if (confirm(`Are you sure you want to delete "${currentContextScript}"?`)) {
    const scriptIndex = savedScripts.findIndex(
      (s) => s.title === currentContextScript,
    );
    if (scriptIndex !== -1) {
      if (isAutoExecuteScript(currentContextScript)) {
        toggleAutoExecuteScript(currentContextScript);
      }
      const filePath = path.join(
        scriptsDirectory,
        `${currentContextScript}.txt`,
      );
      try {
        fs.unlinkSync(filePath);
        savedScripts.splice(scriptIndex, 1);
        persistSavedScripts();
        renderSidebar();
        showToast(`Script "${currentContextScript}" deleted`);
        const tabsToClose = Array.from(tabs.children).filter(
          (tab) => tab.dataset.realTabName === currentContextScript,
        );
        tabsToClose.forEach((tab) => {
          if (Array.from(tabs.children).length === 1) {
            createTab();
          }
          closeTab(true, tab.dataset.id);
        });
        showToast(`Script "${currentContextScript}" deleted`);
      } catch (err) {
        showToast(`Error deleting script: ${err.message}`, true);
        console.error("Error deleting script file:", err);
      }
    }
  }
});
autoExecuteScriptBtn.addEventListener("click", () => {
  if (!currentContextScript) return;
  toggleAutoExecuteScript(currentContextScript);

  if (sidebar.classList.contains("open")) {
    renderSidebar();
  }
});

function createTab(name = "Untitled", content = "-- New script") {
  if (tabs.children.length >= 20) {
    showToast("Maximum tabs reached", true);
    return;
  }
  const id = "tab" + Date.now();
  const tab = document.createElement("div");
  tab.className = "tab new-tab";
  tab.draggable = true;
  const tabName = document.createElement("span");
  const realTabName = name;
  if (name.length >= 10) {
    name = name.substring(0, 5) + "...";
  }
  tab.dataset.realTabName = realTabName;
  tabName.innerText = name;
  tab.appendChild(tabName);
  const closeBtn = document.createElement("span");
  closeBtn.className = "close-btn";
  const closeIcon = document.createElement("i");
  closeIcon.className = "fas fa-times";
  closeBtn.appendChild(closeIcon);
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeTab(false, id);
  };
  tab.appendChild(closeBtn);
  tab.dataset.id = id;
  tab.dataset.name = name;

  if (
    realTabName !== "Untitled" &&
    savedScripts.some((s) => s.title === realTabName)
  ) {
    tab.classList.add("saved-tab");
  }

  tabs.appendChild(tab);
  let editor;
  if (editors[id]) {
    editor = editors[id];
    editorWrapper = document.getElementById(`editor-${id}`);
    editorWrapper.style.display = "block";
  } else {
    editor = createEditor(id, content);
    editors[id] = editor;
  }
  switchTab(id);
  tab.addEventListener("click", () => switchTab(id));

  tab.addEventListener("dragstart", handleDragStart);
  tab.addEventListener("dragover", handleDragOver);
  tab.addEventListener("dragend", handleDragEnd);
  tab.addEventListener("drop", handleDrop);
}

let draggedTab = null;
let dragTabPlaceholder = null;
let originalTabRect = null;
let dropTarget = null;

function handleDragStart(e) {
  if (e.target.classList.contains("close-btn")) {
    e.preventDefault();
    return;
  }

  draggedTab = this;
  originalTabRect = draggedTab.getBoundingClientRect();

  const dragImage = this.cloneNode(true);
  dragImage.style.position = "absolute";
  dragImage.style.top = "-1000px";
  document.body.appendChild(dragImage);

  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setDragImage(dragImage, 10, 10);
  e.dataTransfer.setData("application/x-tab", this.dataset.id);

  setTimeout(() => document.body.removeChild(dragImage), 0);

  this.classList.add("dragging");

  dragTabPlaceholder = document.createElement("div");
  dragTabPlaceholder.className = "tab tab-placeholder";
  dragTabPlaceholder.style.width = originalTabRect.width + "px";
  dragTabPlaceholder.style.height = originalTabRect.height + "px";
  dragTabPlaceholder.style.opacity = "0.3";
  dragTabPlaceholder.style.pointerEvents = "none";
}

function handleDragOver(e) {
  if (!draggedTab || this === draggedTab) return;

  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  const tabsContainer = document.getElementById("tabs");
  if (!dragTabPlaceholder.parentElement) {
    tabsContainer.insertBefore(dragTabPlaceholder, draggedTab);
  }

  const tabRect = this.getBoundingClientRect();
  const mouseX = e.clientX;
  let insertBefore = mouseX < (tabRect.left + tabRect.right) / 2;

  if (insertBefore) {
    if (this.previousElementSibling !== dragTabPlaceholder) {
      tabsContainer.insertBefore(dragTabPlaceholder, this);
    }
  } else {
    if (this.nextElementSibling !== dragTabPlaceholder) {
      tabsContainer.insertBefore(dragTabPlaceholder, this.nextElementSibling);
    }
  }

  dropTarget = this;
  this.classList.add("drag-over");
}

function handleDragEnd(e) {
  this.classList.remove("dragging");
  document.querySelectorAll(".drag-over").forEach((tab) => {
    tab.classList.remove("drag-over");
  });

  if (dragTabPlaceholder && dragTabPlaceholder.parentElement) {
    const tabsContainer = document.getElementById("tabs");
    const placeholderPosition = Array.from(tabsContainer.children).indexOf(
      dragTabPlaceholder,
    );

    if (placeholderPosition !== -1) {
      if (dragTabPlaceholder.nextElementSibling) {
        tabsContainer.insertBefore(
          draggedTab,
          dragTabPlaceholder.nextElementSibling,
        );
      } else {
        tabsContainer.appendChild(draggedTab);
      }
    }

    dragTabPlaceholder.parentElement.removeChild(dragTabPlaceholder);
  }

  draggedTab = null;
  dragTabPlaceholder = null;
  dropTarget = null;
}

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  if (!e.dataTransfer.types.includes("application/x-tab")) {
    return;
  }

  this.classList.remove("drag-over");
}

document.addEventListener("DOMContentLoaded", function () {
  const style = document.createElement("style");
  style.innerHTML = `
    .tab-placeholder {
      background: rgba(100, 100, 100, 0.4);
      border: 2px dashed var(--accent-color);
    }
    .tab.dragging {
      opacity: 0.6;
    }
    .tab.drag-over {
      border: 2px solid var(--accent-color);
    }
  `;
  document.head.appendChild(style);
});

document.addEventListener("dragover", function (e) {
  if (!e.target.closest("#tabs")) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "none";
  }
});

document.addEventListener("drop", function (e) {
  e.preventDefault();

  if (
    !e.target.closest("#tabs") &&
    dragTabPlaceholder &&
    dragTabPlaceholder.parentElement
  ) {
    dragTabPlaceholder.parentElement.removeChild(dragTabPlaceholder);
  }
});

document.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    !isNaN(parseInt(e.key)) &&
    parseInt(e.key) > 0
  ) {
    e.preventDefault();
    const tabIndex = parseInt(e.key) - 1;
    const tabsArray = Array.from(tabs.children);
    if (tabIndex < tabsArray.length) {
      const targetTabId = tabsArray[tabIndex].dataset.id;
      switchTab(targetTabId);
    }
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
    e.preventDefault();
    createTab();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
    e.preventDefault();
    closeCurrentTab(false);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    executeCurrentScript();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveCurrentScript();
  }
});

function switchTab(id) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".editor-wrapper")
    .forEach((e) => e.classList.remove("active"));
  const tab = Array.from(document.querySelectorAll(".tab")).find(
    (t) => t.dataset.id === id,
  );
  if (!tab) return;
  tab.classList.add("active");
  const editorWrapper = document.getElementById(`editor-${id}`);
  if (editorWrapper) {
    editorWrapper.classList.add("active");
    if (editors[id]) {
      setTimeout(() => {
        editors[id].refresh();
        editors[id].focus();
      }, 10);
    }
  }
  currentTab = id;
}

function closeTab(forced, id) {
  const remainingTabIds = Object.keys(editors);
  const tab = Array.from(document.querySelectorAll(".tab")).find(
    (t) => t.dataset.id === id,
  );
  if (remainingTabIds.length === 1 && !forced) {
    return showToast("Cannot close the last tab", true);
  }

  if (tab) {
    const wasActive = tab.classList.contains("active");
    tab.remove();
    const editorWrapper = document.getElementById(`editor-${id}`);
    if (editorWrapper) {
      editorWrapper.remove();
    }
    delete editors[id];
    if (wasActive) {
      const remainingTabIds = Object.keys(editors);
      if (remainingTabIds.length) {
        switchTab(remainingTabIds[0]);
      } else {
        currentTab = null;
      }
    }
  }
}

function closeCurrentTab(forced) {
  if (currentTab) closeTab(forced, currentTab);
}

function saveCurrentScript() {
  if (!currentTab || !editors[currentTab]) {
    showToast("No script selected to save", true);
    return;
  }
  const tab = Array.from(document.querySelectorAll(".tab")).find(
    (t) => t.dataset.id === currentTab,
  );
  if (!tab) return;
  let scriptName = tab.dataset.realTabName;
  console.log(scriptName);
  if (scriptName === "Untitled") {
    openRenameDialog();
    return;
  }
  scriptName = scriptName.split(".")[0];
  saveScriptContent(tab, scriptName);
}

function saveScriptContent(tab, scriptName) {
  if (!scriptName || scriptName === "Untitled") {
    showToast("Script name is required and cannot be 'Untitled'", true);
    return;
  }
  if (!scriptName.endsWith(".txt")) {
    scriptName = scriptName + ".txt";
  }

  const scriptContent = editors[currentTab].getValue();
  const filePath = path.join(scriptsDirectory, scriptName);

  let backupPath = null;
  if (fs.existsSync(filePath)) {
    backupPath = filePath + ".bak";
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (err) {
      showToast("Error creating backup: " + err.message, true);
      return;
    }
  }

  const tempPath = filePath + ".tmp";
  fs.writeFile(tempPath, scriptContent, (err) => {
    if (err) {
      showToast("Error saving script: " + err.message, true);

      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      return;
    }

    try {
      fs.renameSync(tempPath, filePath);

      showToast(
        `Script "${scriptName.replace(".txt", "")}" saved successfully!`,
      );
      closeCurrentTab(true);
      setTimeout(() => {
        createTab(scriptName.replace(".txt", ""), scriptContent);
      }, 100);

      if (sidebar.classList.contains("open") && !searchBox.value) {
        renderSidebar();
      }

      if (backupPath && fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
    } catch (err) {
      showToast("Error finalizing save: " + err.message, true);

      if (backupPath && fs.existsSync(backupPath)) {
        try {
          fs.renameSync(backupPath, filePath);
        } catch (restoreErr) {
          showToast("Error restoring from backup: " + restoreErr.message, true);
        }
      }
    }
  });
}

document.getElementById("copyConsole").onclick = function () {
  const output = document.getElementById("consoleOutput").innerText;
  navigator.clipboard.writeText(output);
  showToast("Console output copied to clipboard");
};

function launchRoblox() {
  spawn("open /Applications/Roblox.app", {
    shell: true,
  });
}

document
  .getElementById("roblox-button")
  .addEventListener("click", launchRoblox);
document
  .getElementById("save-button")
  .addEventListener("click", saveCurrentScript);
document
  .getElementById("exec-button")
  .addEventListener("click", executeCurrentScript);

async function loadupdated() {
  showToast("Loading scripts...");
  try {
    const res = await fetch("https://scriptblox.com/api/script/fetch");
    const res2 = await fetch(
      "https://rscripts.net/api/v2/scripts?page=1&orderBy=date",
    );
    const data = await res.json();
    const data2 = await res2.json();
    let scriptbloxScripts = [];
    let rscriptsScripts = [];
    if (data && data.result && data.result.scripts) {
      scriptbloxScripts = data.result.scripts.map((s) => ({
        ...s,
        __source: "Scriptblox",
      }));
    }
    if (data2 && data2.scripts) {
      rscriptsScripts = data2.scripts.map((s) => ({
        ...s,
        __source: "Rscripts",
      }));
      console.log("Rscripts data:", data2);
    }
    let merged = [];
    let i = 0,
      j = 0;
    while (i < scriptbloxScripts.length || j < rscriptsScripts.length) {
      if (i < scriptbloxScripts.length) merged.push(scriptbloxScripts[i++]);
      if (j < rscriptsScripts.length) merged.push(rscriptsScripts[j++]);
    }
    updatedScripts = merged;
    showToast("Done!");
    if (sidebar.classList.contains("open")) renderSidebar();
  } catch (err) {
    console.error("Error loading scripts:", err);
    const noupdated = document.createElement("div");
    noupdated.className = "script-item";
    noupdated.textContent = "Error loading updated scripts";
    scriptsList.appendChild(noupdated);
  }
}

async function fetchScriptContent(scriptId) {
  try {
    const directUrl = `https://scriptblox.com/raw/${scriptId}`;
    try {
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

    const res = await fetch(`https://scriptblox.com/api/script/${scriptId}`);
    const data = await res.json();

    if (data && data.script) {
      return data.script;
    }

    if (data && data.result) {
      if (data.result.script) return data.result.script;
      if (data.result.content) return data.result.content;
    }

    return `-- Script for ${scriptId} could not be loaded\nloadstring(game:HttpGet("https://rawscripts.net/raw/Infinite-Yield_500"))()`;
  } catch (err) {
    console.error("Error fetching script:", err);
    return `-- Error fetching script: ${err.message}\nloadstring(game:HttpGet("https://rawscripts.net/raw/Infinite-Yield_500"))()`;
  }
}

let searchTimeout;
searchBox.addEventListener("input", (e) => {
  const val = e.target.value;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    if (val.length === 0) {
      renderSidebar();
    } else if (val.length >= 2) {
      searchScripts(val);
    }
  }, 300);
});

async function searchScripts(query) {
  if (!query || query.length < 2) return;
  const thisSearchId = ++currentSearchId;
  scriptsList.innerHTML = "";
  let foundInSaved = false;
  const lowerQuery = query.toLowerCase();

  const searchingIndicator = document.createElement("div");
  searchingIndicator.className = "sidebar-category";
  searchingIndicator.textContent = "Searching...";
  scriptsList.appendChild(searchingIndicator);
  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (thisSearchId !== currentSearchId) return;

    const searchUrl = `https://scriptblox.com/api/script/search?q=${encodeURIComponent(query)}&`;
    const response = await fetch(searchUrl);
    const data = await response.json();
    let scriptbloxResults = [];
    if (
      data &&
      data.result &&
      data.result.scripts &&
      data.result.scripts.length > 0
    ) {
      scriptbloxResults = data.result.scripts;
    }

    const rUrl = `https://rscripts.net/api/v2/scripts?q=${encodeURIComponent(query)}&page=1&orderBy=date`;
    const rRes = await fetch(rUrl);
    const rData = await rRes.json();
    let rscriptsResults = [];
    if (rData && rData.scripts && rData.scripts.length > 0) {
      rscriptsResults = rData.scripts;
    }
    scriptsList.innerHTML = "";
    scriptsList.appendChild(searchingIndicator);

    let maxLen = Math.max(scriptbloxResults.length, rscriptsResults.length);
    savedScripts.forEach((script) => {
      if (
        script.title.toLowerCase().includes(lowerQuery) ||
        (script.script && script.script.toLowerCase().includes(lowerQuery))
      ) {
        foundInSaved = true;
        const item = document.createElement("div");
        item.className = "script-item saved-script";
        const content = document.createElement("div");
        content.className = "script-content";
        const title = document.createElement("div");
        title.className = "script-title";
        title.textContent = script.title;
        content.appendChild(title);
        item.appendChild(content);
        item.onclick = () => createTab(script.title, script.script);
        item.oncontextmenu = (e) => showContextMenu(e, script.title);
        scriptsList.appendChild(item);
        maxLen++;
      }
    });
    for (let i = 0; i < maxLen; i++) {
      if (i < scriptbloxResults.length) {
        const item = await renderScriptItem(scriptbloxResults[i], "Scriptblox");
        scriptsList.appendChild(item);
      }
      if (i < rscriptsResults.length) {
        const item = await renderScriptItem(rscriptsResults[i], "Rscripts");
        scriptsList.appendChild(item);
      }
    }
    searchingIndicator.textContent = `Results (${maxLen})`;
  } catch (err) {
    if (thisSearchId === currentSearchId) {
      console.error("Error searching scripts:", err);
      searchingIndicator.textContent = "Results (Error)";
      const errorItem = document.createElement("div");
      errorItem.className = "script-item";
      errorItem.textContent = `Error searching: ${err.message}`;
      scriptsList.appendChild(errorItem);
    }
  }
}

window.onload = function () {
  console.log("Saved scripts:", savedScripts);
  loadSavedScripts();
  startLogWatcher();
  startFileWatcher();
  workspaceSidebar.classList.add("open");
  loadAutoExecuteScripts();
  updatedLoaded = false;
  loadWorkspaces();
  switchWorkspace(workspaces[0].id);
  createTab(
    "startup",
    'loadstring(game:HttpGet("https://rawscripts.net/raw/Infinite-Yield_500"))()',
  );
  const tabsToDelete = Array.from(tabs.children).filter(
    (tab) => tab.dataset.realTabName !== "startup",
  );
  tabsToDelete.forEach((tab) => {
    closeTab(true, tab.dataset.id);
  });
  showToast("Ready");
  const newTabBtn = document.getElementById("new-tab-btn");
  if (newTabBtn) {
    newTabBtn.addEventListener("click", () => createTab());
  }
};

async function renderSidebar() {
  scriptsList.innerHTML = "";
  const savedCategory = document.createElement("div");
  savedCategory.className = "sidebar-category";
  savedCategory.textContent = "Saved scripts";
  scriptsList.appendChild(savedCategory);
  if (savedScripts.length === 0) {
    const noScripts = document.createElement("div");
    noScripts.className = "script-item";
    noScripts.textContent = "No saved scripts";
    scriptsList.appendChild(noScripts);
  } else {
    savedScripts.forEach((script) => {
      const item = document.createElement("div");
      item.className = "script-item saved-script";
      const content = document.createElement("div");
      content.className = "script-content";
      const title = document.createElement("div");
      title.className = "script-title";
      title.textContent = script.title;
      content.appendChild(title);
      item.appendChild(content);
      item.onclick = () => createTab(script.title, script.script);
      item.oncontextmenu = (e) => showContextMenu(e, script.title);
      if (isAutoExecuteScript(script.title)) {
        const indicator = document.createElement("span");
        indicator.className = "autoexecute-indicator";
        indicator.innerHTML = "⚡";
        content.appendChild(indicator);
      }
      scriptsList.appendChild(item);
    });
  }
  const updatedCategory = document.createElement("div");
  updatedCategory.className = "sidebar-category";
  updatedCategory.textContent = "Recently updated scripts";
  scriptsList.appendChild(updatedCategory);
  if (!updatedLoaded) {
    loadupdated();
    updatedLoaded = true;
  } else {
    if (updatedScripts.length > 0) {
      for (const script of updatedScripts) {
        const item = await renderScriptItem(
          script,
          script.__source ||
            (script._id && script.rawScript ? "Rscripts" : "Scriptblox"),
        );
        scriptsList.appendChild(item);
      }
    } else {
      loadupdated();
    }
  }
}

function getSettings() {
  return {
    glowMode: localStorage.getItem("glowMode") || "default",
    accentColor: localStorage.getItem("accentColor") || "#7FB4FF",
  };
}

function applySettings() {
  const { glowMode, accentColor } = getSettings();
  document.body.classList.remove("glow-default", "glow-old", "glow-high");
  document.body.classList.add("glow-" + glowMode);
  document.documentElement.style.setProperty("--accent-color", accentColor);
  glowModeSelect.value = glowMode;
}

function saveSettings() {
  localStorage.setItem("glowMode", glowModeSelect.value);
  applySettings();
}

glowModeSelect.addEventListener("change", saveSettings);

resetGlowBtn.addEventListener("click", () => {
  glowModeSelect.value = "default";
  saveSettings();
});
resetColorBtn.addEventListener("click", () => {
  localStorage.setItem("accentColor", "#7FB4FF");
  accentColorInput.value = "7FB4FF";
  updateAccentColorPreview("7FB4FF");
  applySettings();
});

settingsButton.addEventListener("click", () => {
  settingsPane.style.display = "";
  settingsPane.classList.remove("closing");
  settingsPane.classList.add("open");
  applySettings();
});
closeSettingsBtn.addEventListener("click", () => {
  settingsPane.classList.remove("open");
  settingsPane.classList.add("closing");
  setTimeout(() => {
    settingsPane.classList.remove("closing");
    settingsPane.style.display = "none";
  }, 350);
});
settingsPane.addEventListener("click", (e) => {
  if (e.target === settingsPane) {
    settingsPane.classList.remove("open");
    settingsPane.classList.add("closing");
    setTimeout(() => {
      settingsPane.classList.remove("closing");
      settingsPane.style.display = "none";
    }, 350);
  }
});

document.addEventListener("DOMContentLoaded", applySettings);
window.addEventListener("load", applySettings);

const accentColorPaletteBtn = document.getElementById("accentColorPalette");
if (accentColorPaletteBtn) {
  function showPaletteBtnOpen() {
    accentColorPaletteBtn.classList.add("open");
    if (accentColorPaletteBtn._openTimeout)
      clearTimeout(accentColorPaletteBtn._openTimeout);
    accentColorPaletteBtn._openTimeout = setTimeout(() => {
      accentColorPaletteBtn.classList.remove("open");
      accentColorPaletteBtn._openTimeout = null;
    }, 1500);
  }
  accentColorPaletteBtn.addEventListener("mousedown", function () {
    showPaletteBtnOpen();
  });
}

function openRenameDialog() {
  const renameDialog = document.getElementById("renameDialog");
  renameDialog.style.display = "";
  renameDialog.classList.remove("closing");
  renameDialog.classList.add("open");
  const renameInput = document.getElementById("renameInput");
  renameInput.value = "";
  renameInput.focus();
}

function closeRenameDialog() {
  const renameDialog = document.getElementById("renameDialog");
  renameDialog.classList.remove("open");
  renameDialog.classList.add("closing");
  setTimeout(() => {
    renameDialog.classList.remove("closing");
    renameDialog.style.display = "none";
  }, 350);
}

let fsWatcher = null;

function startFileWatcher() {
  if (fsWatcher) {
    fsWatcher.close();
  }

  try {
    fsWatcher = fs.watch(
      scriptsDirectory,
      { persistent: true },
      (eventType, filename) => {
        if (filename && (filename.endsWith(".txt") || eventType === "rename")) {
          console.log(`File ${filename} ${eventType}`);
          loadSavedScripts();
          if (sidebar.classList.contains("open")) {
            renderSidebar();
          }
        }
      },
    );
    console.log("File watcher started for scripts directory");
  } catch (err) {
    console.error("Error starting file watcher:", err);
  }
}

function createBadge(text, className) {
  const badge = document.createElement("span");
  badge.className = className + " script-badge";
  badge.innerText = text;
  return badge;
}

function getScriptImage(script, source) {
  let img =
    script.image ||
    script.gameLogo ||
    (script.game && (script.game.imageUrl || script.game.imgurl));
  if (img && source === "Scriptblox" && img.startsWith("/images")) {
    return "https://scriptblox.com" + img;
  }
  return img;
}

function createDiscordBadge(url) {
  const badge = document.createElement("span");
  badge.className = "script-discord";
  badge.innerText = "Discord";
  badge.onclick = (e) => {
    e.stopPropagation();
    if (window && window.process && window.process.type === "renderer") {
      try {
        require("electron").shell.openExternal(url);
      } catch (err) {
        window.open(url, "_blank");
      }
    } else {
      window.open(url, "_blank");
    }
  };
  return badge;
}

function createGameNamePlain(name) {
  const el = document.createElement("div");
  el.className = "script-game";
  el.innerText = name;
  return el;
}

function createAuthor(user) {
  if (!user) return null;
  const el = document.createElement("div");
  el.className = "script-author";
  el.innerText = "By " + (user.username || user.name || "Unknown");
  if (user.verified) {
    el.appendChild(createBadge("✔ Verified", "script-verified"));
  }
  return el;
}

function createStats(script) {
  const el = document.createElement("div");
  el.className = "script-stats";
  let stats = [];
  if (typeof script.views === "number") stats.push(`👁️ ${script.views}`);
  if (typeof script.likes === "number") stats.push(`👍 ${script.likes}`);
  if (typeof script.dislikes === "number") stats.push(`👎 ${script.dislikes}`);
  if (stats.length) el.innerText = stats.join("   ");
  return el;
}

async function renderScriptItem(script, source) {
  if (
    source === "Rscripts" &&
    script._id &&
    (!script.description || !script.user || !script.game)
  ) {
    try {
      const res = await fetch(
        `https://rscripts.net/api/v2/script?id=${script._id}`,
      );
      const data = await res.json();
      if (data && data.script && data.script[0]) {
        script = { ...script, ...data.script[0] };
      }
    } catch (e) {}
  }

  if (
    source === "Scriptblox" &&
    script._id &&
    (!script.description || !script.owner || !script.game)
  ) {
    try {
      const res = await fetch(
        `https://scriptblox.com/api/script/${script._id}`,
      );
      const data = await res.json();
      if (data && data.result && data.result.script) {
        script = { ...script, ...data.result.script };
      }
    } catch (e) {}
  }
  const item = document.createElement("div");
  item.className = "script-item searched-script";

  let bg = getScriptImage(script, source);
  if (bg) item.style.backgroundImage = `url('${bg}')`;

  const content = document.createElement("div");
  content.className = "script-content";

  const title = document.createElement("div");
  title.className = "script-title";
  title.innerText = script.title || "Unnamed Script";
  content.appendChild(title);

  const sourceDiv = document.createElement("div");
  sourceDiv.className = "script-source";
  sourceDiv.innerText = "Source: " + (source || script.__source || "Unknown");
  content.appendChild(sourceDiv);

  let gameName = (script.game && (script.game.name || script.game.title)) || "";
  if (gameName) content.appendChild(createGameNamePlain(gameName));

  if (script.description) {
    const desc = document.createElement("div");
    desc.className = "script-description";
    desc.innerText = script.description;
    content.appendChild(desc);
  }

  if (script.user || script.owner) {
    const author = createAuthor(script.user || script.owner);
    if (author) content.appendChild(author);
  }

  const meta = document.createElement("div");
  meta.className = "script-meta";
  if (script.keySystem || script.key)
    meta.appendChild(createBadge("Key Required", "script-key"));

  if (source === "Rscripts") {
    let discordUrl =
      script.discord ||
      (script.user && script.user.socials && script.user.socials.discordServer);
    if (discordUrl) {
      const discordBadge = createDiscordBadge(discordUrl);
      meta.appendChild(discordBadge);
    }
  }
  if (script.mobileReady)
    meta.appendChild(createBadge("Mobile", "script-mobile"));
  if (script.paid) meta.appendChild(createBadge("Paid", "script-paid"));
  content.appendChild(meta);

  const stats = createStats(script);
  if (stats && stats.innerText) content.appendChild(stats);
  item.appendChild(content);

  item.onclick = () => {
    if (script.script) {
      createTab(script.title, script.script);
    } else if (script.rawScript) {
      fetch(script.rawScript)
        .then((res) => res.text())
        .then((text) => createTab(script.title, text))
        .catch(() => createTab(script.title, "-- Error loading script"));
    } else if (script._id) {
      const loadingIndicator = document.createElement("div");
      loadingIndicator.className = "loading-indicator";
      loadingIndicator.textContent = "Loading...";
      item.appendChild(loadingIndicator);
      fetchScriptContent(script._id)
        .then((content) => {
          if (item.querySelector(".loading-indicator")) {
            item.querySelector(".loading-indicator").remove();
          }
          if (content) {
            createTab(script.title, content);
          } else {
            showToast("Couldn't load script content", true);
          }
        })
        .catch((err) => {
          if (item.querySelector(".loading-indicator")) {
            item.querySelector(".loading-indicator").remove();
          }
          showToast("Error: " + err.message, true);
        });
    } else {
      showToast("Script content not available", true);
    }
  };
  return item;
}

async function executeCurrentScript() {
  if (!currentTab || !editors[currentTab]) {
    showToast("No script selected", true);
    return;
  }
  const code = editors[currentTab].getValue();
  showToast("Executing...");
  console.log("Executing:", code);
  if (isElectron && ipcRenderer) {
    try {
      if (updating) {
        showToast("Cannot execute while updating", true);
        return;
      }
      ipcRenderer.send("invokeAction", { code });
      ipcRenderer.once("actionReply", (event, result) => {
        console.log("Result:", result);
        if (result.startsWith("Error:")) {
          showToast("Failed", true);
          showToast(result, true);
        } else {
          showToast("Success");
        }
      });
    } catch (err) {
      console.error("Failed to send to Electron:", err);
      showToast("Error: " + err.message, true);
      showToast("Error", true);
    }
  } else {
    showToast("Executing: " + code.substring(0, 30) + "...");
    setTimeout(() => {
      showToast("Success");
    }, 500);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const closeColorPickerBtn = document.getElementById("closeColorPicker");
  if (closeColorPickerBtn && accentColorInput) {
    closeColorPickerBtn.addEventListener("click", () => {
      accentColorInput.blur();
      accentColorInput.style.display = "none";
      setTimeout(() => {
        accentColorInput.style.display = "";
      }, 200);
    });
  }
});

const accentColorInput = document.getElementById("accentColorInput");
const accentColorPreview = document.getElementById("accentColorPreview");

function isValidHex(hex) {
  return /^#?([0-9A-Fa-f]{6})$/.test(hex);
}

function normalizeHex(hex) {
  hex = hex.trim();
  if (!hex.startsWith("#")) {
    hex = "#" + hex;
  }
  return hex;
}

function updateAccentColorPreview(hex) {
  accentColorPreview.style.background = isValidHex(hex)
    ? normalizeHex(hex)
    : "#7FB4FF";
}

function handleAccentColorInput() {
  const hex = accentColorInput.value.trim();
  if (isValidHex(hex)) {
    const normalized = normalizeHex(hex);
    updateAccentColorPreview(normalized);
    localStorage.setItem("accentColor", normalized);
    applySettings();
  } else {
    updateAccentColorPreview(hex);
  }
}

if (accentColorInput && accentColorPreview) {
  accentColorInput.addEventListener("input", handleAccentColorInput);
  settingsButton.addEventListener("click", () => {
    const current = (localStorage.getItem("accentColor") || "#7FB4FF").replace(
      /^#/,
      "",
    );
    accentColorInput.value = current;
    updateAccentColorPreview(current);
  });
}

document.getElementById("cancelRename").addEventListener("click", () => {
  closeRenameDialog();
});

document.getElementById("confirmRename").addEventListener("click", () => {
  const renameInput = document.getElementById("renameInput");
  const newName = renameInput.value.trim().split(".")[0];
  if (!newName) {
    showToast("Script name is required", true);
    renameInput.focus();
    return;
  }
  if (savedScripts.some((s) => s.title === newName)) {
    showToast(`Script "${newName}" already exists`, true);
    renameInput.focus();
    return;
  }
  const tab = Array.from(document.querySelectorAll(".tab")).find(
    (t) => t.dataset.id === currentTab,
  );
  if (!tab) {
    showToast("No script selected to save", true);
    return;
  }
  saveScriptContent(tab, newName);
  closeRenameDialog();
});

function loadWorkspaces() {
  workspaces = getLocalStorage("workspaces", [
    { id: "default", name: "Default", tabs: [] },
  ]);

  if (workspaces.length === 0) {
    workspaces = [{ id: "default", name: "Default", tabs: [] }];
  }

  currentWorkspace = getLocalStorage("currentWorkspace", "default");
  renderWorkspacesSidebar();
}

function saveWorkspaces() {
  setLocalStorage("workspaces", workspaces);
}

function renderWorkspacesSidebar() {
  if (!workspacesList) return;

  workspacesList.innerHTML = "";
  workspaces.forEach((workspace) => {
    const item = document.createElement("div");
    item.className = `workspace-item ${
      workspace.id === currentWorkspace ? "active" : ""
    } saved-script`;

    const name = document.createElement("span");
    name.textContent = workspace.name;
    item.appendChild(name);

    item.onclick = () => switchWorkspace(workspace.id);
    item.oncontextmenu = (e) => showWorkspaceContextMenu(e, workspace.id);

    workspacesList.appendChild(item);
  });
}

function createNewWorkspace() {
  if (workspaces.length >= 10) {
    showToast("Maximum workspaces reached (10)", true);
    return;
  }

  const id = "workspace_" + Date.now();
  const name = "Workspace " + (workspaces.length + 1);

  workspaces.push({
    id: id,
    name: name,
    tabs: [],
  });

  saveWorkspaces();
  renderWorkspacesSidebar();
  switchWorkspace(id);
}

function switchWorkspace(workspaceId) {
  saveCurrentWorkspaceTabs();

  currentWorkspace = workspaceId;
  saveWorkspaces();

  loadWorkspaceTabs();
  renderWorkspacesSidebar();
}

function saveCurrentWorkspaceTabs() {
  const currentWorkspaceObj = workspaces.find((w) => w.id === currentWorkspace);
  if (!currentWorkspaceObj) return;

  const tabsData = Array.from(tabs.children).map((tab) => {
    const tabId = tab.dataset.id;
    const editor = editors[tabId];
    return {
      id: tabId,
      name: tab.dataset.realTabName,
      content: editor ? editor.getValue() : "",
    };
  });

  currentWorkspaceObj.tabs = tabsData;
  saveWorkspaces();
}

function loadWorkspaceTabs() {
  Array.from(tabs.children).forEach((tab) => {
    closeTab(true, tab.dataset.id);
  });

  const workspace = workspaces.find((w) => w.id === currentWorkspace);
  if (!workspace) return;

  if (workspace.tabs.length > 0) {
    workspace.tabs.forEach((tabData) => {
      createTab(tabData.name, tabData.content);
    });
  } else {
    createTab();
  }
}

function renameWorkspace(workspaceId) {
  const workspaceItem = Array.from(
    document.querySelectorAll(".workspace-item"),
  ).find((item) => {
    return (
      item.querySelector("span").textContent ===
      workspaces.find((w) => w.id === workspaceId).name
    );
  });

  if (!workspaceItem) return;

  const titleElement = workspaceItem.querySelector("span");
  const originalName = titleElement.textContent;

  const input = document.createElement("input");
  input.type = "text";
  input.value = originalName;
  input.className = "rename-input";
  titleElement.replaceWith(input);
  input.focus();

  function handleRename() {
    const newName = input.value.trim();
    if (newName && newName !== originalName) {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        workspace.name = newName;
        saveWorkspaces();
        renderWorkspacesSidebar();
      }
    }
    titleElement.textContent = newName || originalName;
    input.replaceWith(titleElement);
  }

  input.addEventListener("blur", handleRename);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleRename();
    } else if (e.key === "Escape") {
      input.value = originalName;
      input.blur();
    }
  });
}

function deleteWorkspace(workspaceId) {
  if (workspaces.length <= 1) {
    showToast("Cannot delete the last workspace", true);
    return;
  }

  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  if (
    confirm(`Are you sure you want to delete workspace "${workspace.name}"?`)
  ) {
    const index = workspaces.findIndex((w) => w.id === workspaceId);
    if (index !== -1) {
      workspaces.splice(index, 1);

      if (workspaceId === currentWorkspace) {
        currentWorkspace = workspaces[0].id;
        loadWorkspaceTabs();
      }

      saveWorkspaces();
      renderWorkspacesSidebar();
    }
  }
}

workspaceToggleBtn.addEventListener("click", () => {
  workspaceSidebarOpen = !workspaceSidebarOpen;

  if (workspaceSidebarOpen) {
    workspaceSidebar.classList.add("open");
    workspaceToggleBtn.classList.add("active");
  } else {
    workspaceSidebar.classList.remove("open");
    workspaceToggleBtn.classList.remove("active");
  }
});

newWorkspaceBtn.addEventListener("click", createNewWorkspace);

window.addEventListener("load", () => {
  loadWorkspaces();
});

window.addEventListener("beforeunload", () => {
  saveCurrentWorkspaceTabs();
});

function addWorkspaceSidebar() {
  const container = document.querySelector(".container");
  if (!container) return;

  if (!document.getElementById("workspace-toggle-btn")) {
    const toggleBtn = document.getElementById("workspace-toggle-btn");
    toggleBtn.addEventListener("click", () => {
      workspaceSidebarOpen = !workspaceSidebarOpen;

      if (workspaceSidebarOpen) {
        workspaceSidebar.classList.add("open");
        toggleBtn.style.transform = "rotate(-360deg)";
        document.querySelector(".main-content").style.marginLeft = "200px";
      } else {
        workspaceSidebar.classList.remove("open");
        toggleBtn.style.transform = "rotate(360deg)";
        document.querySelector(".main-content").style.marginLeft = "0";
      }
    });

    document
      .getElementById("new-workspace-btn")
      .addEventListener("click", createNewWorkspace);
  }
}

function restructureDOM() {
  const body = document.body;
  const container = document.querySelector(".container");
  if (!container) return;

  const mainContent = document.createElement("div");
  mainContent.className = "main-content";

  Array.from(container.children).forEach((child) => {
    if (
      !child.classList.contains("sidebar") &&
      !child.classList.contains("workspace-sidebar")
    ) {
      mainContent.appendChild(child);
    }
  });

  container.appendChild(mainContent);
}

window.addEventListener("DOMContentLoaded", () => {
  restructureDOM();
  addWorkspaceSidebar();
});

window.addEventListener("beforeunload", () => {
  localStorage.removeItem("workspaces");
});
