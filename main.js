const isElectron = window.navigator.userAgent.toLowerCase().indexOf('electron/') > -1;
let ipcRenderer;
if (isElectron) {
  try {
    ipcRenderer = require('electron').ipcRenderer;
  } catch (error) {
    console.warn('Failed to load electron modules:', error);
  }
}
const tabs = document.getElementById('tabs');
const editorContainer = document.getElementById('editor-container');
const scriptsList = document.getElementById('scripts');
const searchBox = document.getElementById('searchBox');
const sidebar = document.getElementById('sidebar');
const toast = document.getElementById('toast');
const contextMenu = document.getElementById('contextMenu');
const renameScriptBtn = document.getElementById('renameScript');
const deleteScriptBtn = document.getElementById('deleteScript');
const autoExecuteScriptBtn = document.getElementById('autoExecuteScript');
const autoExecuteCheckbox = document.getElementById('autoExecuteCheckbox');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { console } = require('inspector');
const consoleOutput = document.getElementById('consoleOutput');
const clearConsoleBtn = document.getElementById('clearConsole');
const settingsButton = document.getElementById('settings-button');
const settingsPane = document.getElementById('settingsPane');
const closeSettingsBtn = document.getElementById('closeSettings');
const glowModeSelect = document.getElementById('glowMode');
const resetGlowBtn = document.getElementById('resetGlow');
const resetColorBtn = document.getElementById('resetColor');
let editors = {};
let savedScripts = [];
let currentTab = null;
let currentContextScript = null;
let updatedLoaded = false;
let currentSearchId = 0;
let updatedScripts = [];

const scriptsDirectory = path.join(require('os').homedir(), 'Documents', 'Tritium');


if (!fs.existsSync(scriptsDirectory)) {
    fs.mkdirSync(scriptsDirectory, { recursive: true });
}

function addLog(message, type = 'info') {
  if (message.length > 200) {
    message = message.substring(0, 200) + '...';
  }
  const logElement = document.createElement('div');
  logElement.className = `log-${type} log-entry`;
  logElement.textContent = message;
  consoleOutput.appendChild(logElement);
  setTimeout(() => {
    logElement.classList.add('show');
  }, 10);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
clearConsoleBtn.addEventListener('click', () => {
  consoleOutput.innerHTML = '';
});

function startLogWatcher() {
  if (!isElectron || !ipcRenderer) return;
  ipcRenderer.invoke('start-log-watcher').then((result) => {
    if (result && result.success) {
      ipcRenderer.on('log-update', (event, logLine) => {
        let logType = 'info';
        if (logLine.includes('ERROR') || logLine.includes('Error')) {
          logType = 'error';
        } else if (logLine.includes('WARNING') || logLine.includes('Warning')) {
          logType = 'warning';
        } else if (logLine.includes('SUCCESS') || logLine.includes('Success')) {
          logType = 'success';
        } else if (logLine.includes('DEBUG') || logLine.includes('Debug')) {
          logType = 'debug';
        }
        addLog(logLine, logType);
      });
    }
  });
}

function JoinWatcher() {
  if (!isElectron || !ipcRenderer) return null;
  ipcRenderer.invoke('start-log-watcher').then((result) => {
    if (result && result.success) {
      ipcRenderer.on('game-join-detected', () => {
        autoexec();
      });
    } else {
      console.error(result.error);
    }
  }).catch((err) => {
    console.error(err);
  });
}

let toastTimeout = null;
function showToast(message, isError = false) {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  toast.textContent = message;
  toast.className = isError ? 'toast error show' : 'toast show';
  toastTimeout = setTimeout(() => {
    toast.className = 'toast';
    setTimeout(() => {
      toast.textContent = '';
    }, 300);
    toastTimeout = null;
  }, 3000);
}

function createEditor(tabId, content) {
  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'editor-wrapper';
  editorWrapper.id = `editor-${tabId}`;
  editorContainer.appendChild(editorWrapper);
  const luaGlobals = [
    
    "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
    "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return",
    "then", "true", "until", "while",
    
    
    "assert", "collectgarbage", "dofile", "error", "getmetatable", "ipairs",
    "load", "loadfile", "next", "pairs", "pcall", "print", "rawequal",
    "rawget", "rawlen", "rawset", "select", "setmetatable", "tonumber",
    "tostring", "type", "xpcall", "warn",
    
    
    "coroutine", "coroutine.create", "coroutine.resume", "coroutine.running",
    "coroutine.status", "coroutine.wrap", "coroutine.yield", "coroutine.isyieldable",
    "coroutine.close",
    
    
    "table", "table.concat", "table.insert", "table.move", "table.pack",
    "table.remove", "table.sort", "table.unpack", "table.clear", "table.find",
    "table.foreach", "table.foreachi", "table.getn", "table.isfrozen",
    "table.maxn", "table.create",
    
    
    "string", "string.byte", "string.char", "string.dump", "string.find",
    "string.format", "string.gmatch", "string.gsub", "string.len", "string.lower",
    "string.match", "string.rep", "string.reverse", "string.sub", "string.upper",
    "string.pack", "string.packsize", "string.unpack", "string.split",
    
    
    "math", "math.abs", "math.acos", "math.asin", "math.atan", "math.atan2",
    "math.ceil", "math.clamp", "math.cos", "math.cosh", "math.deg", "math.exp",
    "math.floor", "math.fmod", "math.frexp", "math.ldexp", "math.log", "math.log10",
    "math.max", "math.min", "math.modf", "math.pow", "math.rad", "math.random",
    "math.randomseed", "math.round", "math.sign", "math.sin", "math.sinh", "math.sqrt",
    "math.tan", "math.tanh", "math.pi", "math.huge", "math.noise",
    
    
    "io", "io.close", "io.flush", "io.input", "io.lines", "io.open", "io.output",
    "io.popen", "io.read", "io.stderr", "io.stdin", "io.stdout", "io.tmpfile",
    "io.type", "io.write",
    
    
    "os", "os.clock", "os.date", "os.difftime", "os.execute", "os.exit", "os.getenv",
    "os.remove", "os.rename", "os.setlocale", "os.time", "os.tmpname",
    
    
    "debug", "debug.debug", "debug.gethook", "debug.getinfo", "debug.getlocal",
    "debug.getmetatable", "debug.getregistry", "debug.getupvalue", "debug.getuservalue",
    "debug.sethook", "debug.setlocal", "debug.setmetatable", "debug.setupvalue",
    "debug.setuservalue", "debug.traceback", "debug.upvalueid", "debug.upvaluejoin",
    
    
    "package", "package.config", "package.cpath", "package.loaded", "package.loaders",
    "package.loadlib", "package.path", "package.preload", "package.searchers",
    "package.searchpath",
    
    
    "utf8", "utf8.char", "utf8.charpattern", "utf8.codepoint", "utf8.codes",
    "utf8.len", "utf8.offset",
    
    
    "bit32", "bit32.arshift", "bit32.band", "bit32.bnot", "bit32.bor", "bit32.btest",
    "bit32.bxor", "bit32.extract", "bit32.lrotate", "bit32.lshift", "bit32.replace",
    "bit32.rrotate", "bit32.rshift",
    
    
    "typeof", "getfenv", "setfenv", "shared", "script", "require", "spawn", "delay",
    "tick", "time", "UserSettings", "settings", "game", "workspace", "shared",
    "script", "wait", "Delay", "ElapsedTime", "elapsedTime", "require",
    
    
    "Vector2", "Vector3", "Vector2int16", "Vector3int16", "CFrame", "Color3",
    "ColorSequence", "NumberRange", "NumberSequence", "Rect", "UDim", "UDim2",
    "Faces", "Axes", "BrickColor", "Enum", "Instance", "TweenInfo", "Region3",
    "Region3int16", "Ray", "Random", "RaycastResult",
    
    
    "plugin", "command", "printidentity", "settings", "stats", "testservice",
    "http", "HttpService", "HttpRbxApiService", "ContextActionService",
    "RunService", "DataStoreService", "MessagingService", "CollectionService",
    "ContentProvider", "PathfindingService", "PhysicsService", "ReplicatedStorage",
    "ServerScriptService", "ServerStorage", "StarterGui", "StarterPack",
    "StarterPlayer", "Teams", "TeleportService", "TextService", "UserInputService",
    "VirtualInputManager", "VoiceChatService", "MarketplaceService", "GroupService",
    "LocalizationService", "NotificationService", "BadgeService", "GamePassService",
    "DataStoreService", "SocialService", "PlayerService", "Chat", "SoundService",
    "Lighting", "Workspace", "Players", "Debris", "NetworkClient", "NetworkServer",
    "Visit", "GuiService", "CoreGui", "CorePackages", "LogService", "MemoryStoreService",
    "PolicyService", "SessionService", "TextChatService", "ThirdPartyPurchaseService",
    "VersionControlService", "VRService"
  ];
  function luaHint(cm) {
    const cursor = cm.getCursor();
    const token = cm.getTokenAt(cursor);
    const start = token.start;
    const end = cursor.ch;
    const currentWord = token.string;
  
    const filtered = luaGlobals.filter(kw => kw.startsWith(currentWord));
    return {
      list: filtered,
      from: CodeMirror.Pos(cursor.line, start),
      to: CodeMirror.Pos(cursor.line, end)
    };
  }
  
  const editor = CodeMirror(editorWrapper, {
    value: content || '-- New script',
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
      "Ctrl-Space": function(cm) {
        cm.showHint({ hint: luaHint });
      },
      "Tab": function(cm) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const cursorPos = cursor.ch;
        const textBeforeCursor = line.substring(0, cursorPos);
        if (textBeforeCursor.trim().length > 0 && !textBeforeCursor.endsWith(" ")) {
          cm.showHint({ hint: luaHint });
        } else {
          cm.replaceSelection("  ", "end");
        }
      }
    }
  });
  
  editor.setSize("100%", "100%");
  
  editor.on("keyup", function(cm, event) {
    const allowedKeys = /^[a-zA-Z0-9_\.]$/;
    if (allowedKeys.test(event.key)) {
      cm.showHint({
        hint: luaHint,
        completeSingle: false
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
  if (newName.length > 15) displayName = newName.substring(0, 10) + '...';
  tab.dataset.name = displayName;
  tab.querySelector('span').textContent = displayName;
}

function updateScriptNameEverywhere(originalName, newName) {
  const scriptIndex = savedScripts.findIndex(s => s.title === originalName);
  if (scriptIndex !== -1) {
    savedScripts[scriptIndex].title = newName;
    let autoExecScripts = getLocalStorage('autoExecuteScripts', []);
    const autoExecIndex = autoExecScripts.indexOf(originalName);
    if (autoExecIndex !== -1) {
      autoExecScripts[autoExecIndex] = newName;
      setLocalStorage('autoExecuteScripts', autoExecScripts);
    }
    setLocalStorage('savedScripts', savedScripts);
    const filePath = path.join(scriptsDirectory, `${originalName}.txt`);
    const newFilePath = path.join(scriptsDirectory, `${newName}.txt`);
    fs.renameSync(filePath, newFilePath);
    showToast(`Script renamed to "${newName}"`);
    Array.from(tabs.children).forEach(tab => {
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
      files.forEach(file => {
        if (file.endsWith('.txt')) {
          const filePath = path.join(scriptsDirectory, file);
          const content = fs.readFileSync(filePath, 'utf8');
          let scriptName = file.replace('.txt', '').split('.')[0];
          savedScripts.push({ title: scriptName, script: content });
        }
      });
    }
  } catch (err) {
    console.error("Error loading saved scripts:", err);
    addLog("Error loading saved scripts: " + err.message, "error");
  }
}

function persistSavedScripts() { setLocalStorage('savedScripts', savedScripts); }
function loadAutoExecuteScripts() { return getLocalStorage('autoExecuteScripts', []); }
function saveAutoExecuteScripts(scripts) { setLocalStorage('autoExecuteScripts', scripts); }
function isAutoExecuteScript(scriptName) { return loadAutoExecuteScripts().includes(scriptName); }
function toggleAutoExecuteScript(scriptName) {
  const autoExecScripts = loadAutoExecuteScripts();
  const index = autoExecScripts.indexOf(scriptName);
  if (index === -1) autoExecScripts.push(scriptName);
  else autoExecScripts.splice(index, 1);
  saveAutoExecuteScripts(autoExecScripts);
  updateAutoExecuteCheckbox(scriptName);
  renderSidebar();
}
function updateAutoExecuteCheckbox(scriptName) {
  autoExecuteCheckbox.style.display = isAutoExecuteScript(scriptName) ? 'inline' : 'none';
}

function showContextMenu(e, scriptName) {
  e.preventDefault();
  currentContextScript = scriptName;
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${e.pageX}px`;
  contextMenu.style.top = `${e.pageY}px`;
  updateAutoExecuteCheckbox(scriptName);
}

document.addEventListener('click', () => {
  contextMenu.style.display = 'none';
});

renameScriptBtn.addEventListener('click', () => {
  if (!currentContextScript) return;
  const scriptItem = Array.from(document.querySelectorAll('.script-item')).find(item => {
    return item.querySelector('.script-title').textContent === currentContextScript;
  });
  if (!scriptItem) return;
  const titleElement = scriptItem.querySelector('.script-title');
  const originalName = titleElement.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = originalName;
  input.className = 'rename-input';
  titleElement.replaceWith(input);
  input.focus();
  function handleRename() {
    const newName = input.value.trim().split('.')[0];
    if (newName === 'Untitled') {
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
  input.addEventListener('blur', handleRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const newName = input.value.trim();
      if (newName === 'Untitled') {
        showToast("Script name cannot be 'Untitled'", true);
        input.focus();
        return;
      }
      if (savedScripts.some(s => s.title === newName)) {
        showToast(`Script "${newName}" already exists`, true);
        input.focus();
        return;
      }
      handleRename();
    } else if (e.key === 'Escape') {
      input.value = originalName;
      input.blur();
    }
  });
  contextMenu.style.display = 'none';
});
deleteScriptBtn.addEventListener('click', () => {
  if (!currentContextScript) return;
  if (confirm(`Are you sure you want to delete "${currentContextScript}"?`)) {
    const scriptIndex = savedScripts.findIndex(s => s.title === currentContextScript);
    if (scriptIndex !== -1) {
      if (isAutoExecuteScript(currentContextScript)) {
        toggleAutoExecuteScript(currentContextScript);
      }
      const filePath = path.join(scriptsDirectory, `${currentContextScript}.txt`);
      try {
        fs.unlinkSync(filePath);
        savedScripts.splice(scriptIndex, 1);
        persistSavedScripts();
        renderSidebar();
        showToast(`Script "${currentContextScript}" deleted`);
        const tabsToClose = Array.from(tabs.children).filter(tab => tab.dataset.realTabName === currentContextScript);
        tabsToClose.forEach(tab => {
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
autoExecuteScriptBtn.addEventListener('click', () => {
  if (!currentContextScript) return;
  toggleAutoExecuteScript(currentContextScript);
  
  if (sidebar.classList.contains('open')) {
    renderSidebar();
  }
});

function createTab(name = "Untitled", content = "-- New script") {
  if (tabs.children.length >= 7) {
    showToast("Maximum tabs reached", true);
    return;
  }
  const id = "tab" + Date.now();
  const tab = document.createElement('div');
  tab.className = 'tab new-tab'; 
  const tabName = document.createElement('span');
  const realTabName = name;
  if (name.length > 15) {
    name = name.substring(0, 10) + '...';
  }
  tab.dataset.realTabName = realTabName;
  tabName.innerText = name;
  tab.appendChild(tabName);
  const closeBtn = document.createElement('span');
  closeBtn.className = 'close-btn';
  closeBtn.innerHTML = '&times;';
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeTab(false, id);
  };
  tab.appendChild(closeBtn);
  tab.dataset.id = id;
  tab.dataset.name = name;

  if (realTabName !== 'Untitled' && savedScripts.some(s => s.title === realTabName)) {
    tab.classList.add('saved-tab');
  }

  tabs.appendChild(tab);
  const editor = createEditor(id, content);
  editors[id] = editor;
  switchTab(id);
  tab.addEventListener('click', () => switchTab(id));
}

function switchTab(id) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.editor-wrapper').forEach(e => e.classList.remove('active'));
  const tab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.id === id);
  if (!tab) return;
  tab.classList.add('active');
  const editorWrapper = document.getElementById(`editor-${id}`);
  if (editorWrapper) {
    editorWrapper.classList.add('active');
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
    const tab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.id === id);
    if (remainingTabIds.length === 1 && !forced) {
      return showToast("Cannot close the last tab", true);
    }

    if (tab) {
        const wasActive = tab.classList.contains('active');
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
  const tab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.id === currentTab);
  if (!tab) return;
  let scriptName = tab.dataset.realTabName;
  console.log(scriptName);
  if (scriptName === "Untitled") {
    openRenameDialog();
    return;
  }
  scriptName = scriptName.split('.')[0];
  saveScriptContent(tab, scriptName);
  
}

function saveScriptContent(tab, scriptName) {
  if (!scriptName || scriptName === 'Untitled') {
    showToast("Script name is required and cannot be 'Untitled'", true);
    return;
  }
  if (!scriptName.endsWith('.txt')) {
    scriptName = scriptName + '.txt';
  }

  const scriptContent = editors[currentTab].getValue();
  const filePath = path.join(scriptsDirectory, scriptName);

  
  let backupPath = null;
  if (fs.existsSync(filePath)) {
    backupPath = filePath + '.bak';
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (err) {
      showToast("Error creating backup: " + err.message, true);
      return;
    }
  }

  
  const tempPath = filePath + '.tmp';
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
      
      
      showToast(`Script "${scriptName.replace('.txt', '')}" saved successfully!`);
      closeCurrentTab(true);
      setTimeout(() => {
        createTab(scriptName.replace('.txt', ''), scriptContent);
      }, 100);

      
      
      if (sidebar.classList.contains('open') && !searchBox.value) {
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

document.getElementById('copyConsole').onclick = function() {
  const output = document.getElementById('consoleOutput').innerText;
  navigator.clipboard.writeText(output);
  showToast("Console output copied to clipboard");
};

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
    e.preventDefault();
    createTab();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
    e.preventDefault();
    closeCurrentTab(false);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    executeCurrentScript();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveCurrentScript();
  }
});

function launchRoblox() {
  spawn('open /Applications/Roblox.app', {
    shell: true
  });
}

document.getElementById('roblox-button').addEventListener('click', launchRoblox);
document.getElementById('save-button').addEventListener('click', saveCurrentScript);
document.getElementById('exec-button').addEventListener('click', executeCurrentScript);

async function loadupdated() {
  showToast("Loading updated scripts...");
  try {
    const res = await fetch('https://scriptblox.com/api/script/fetch');
    const res2 = await fetch('https://rscripts.net/api/v2/scripts?page=1&orderBy=date');
    const data = await res.json();
    const data2 = await res2.json();
    let scriptbloxScripts = [];
    let rscriptsScripts = [];
    if (data && data.result && data.result.scripts) {
      scriptbloxScripts = data.result.scripts.map(s => ({...s, __source: 'Scriptblox'}));
    }
    if (data2 && data2.scripts) {
      rscriptsScripts = data2.scripts.map(s => ({...s, __source: 'Rscripts'}));
      console.log("Rscripts data:", data2);
    }
    let merged = [];
    let i = 0, j = 0;
    while (i < scriptbloxScripts.length || j < rscriptsScripts.length) {
      if (i < scriptbloxScripts.length) merged.push(scriptbloxScripts[i++]);
      if (j < rscriptsScripts.length) merged.push(rscriptsScripts[j++]);
    }
    updatedScripts = merged;
    showToast("Ready");
    if (sidebar.classList.contains('open')) renderSidebar();
  } catch (err) {
    console.error("Error loading updated scripts:", err);
    const noupdated = document.createElement('div');
    noupdated.className = 'script-item';
    noupdated.textContent = 'Error loading updated scripts';
    scriptsList.appendChild(noupdated);
    showToast("Ready");
  }
}


async function fetchScriptContent(scriptId) {
  try {
    
    const directUrl = `https://scriptblox.com/raw/${scriptId}`;
    try {
      const directRes = await fetch(directUrl);
      if (directRes.ok) {
        const content = await directRes.text();
        if (content && content.length > 0 && !content.includes('<!DOCTYPE html>')) {
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
    console.error("Error fetching script content:", err);
    return `-- Error fetching script: ${err.message}\nloadstring(game:HttpGet("https://rawscripts.net/raw/Infinite-Yield_500"))()`;
  }
}

searchBox.addEventListener('input', (e) => {
  const val = e.target.value;
  if (val.length === 0) {
    renderSidebar();
  } else if (val.length >= 2) {
    searchScripts(val);
  }
});

async function searchScripts(query) {
  if (!query || query.length < 2) return;
  const thisSearchId = ++currentSearchId;
  scriptsList.innerHTML = '';
  const searchHeader = document.createElement('div');
  searchHeader.className = 'sidebar-category';
  searchHeader.textContent = `Search Results: "${query}"`;
  scriptsList.appendChild(searchHeader);
  let foundInSaved = false;
  const lowerQuery = query.toLowerCase();
  savedScripts.forEach(script => {
    if (script.title.toLowerCase().includes(lowerQuery) || (script.script && script.script.toLowerCase().includes(lowerQuery))) {
      foundInSaved = true;
      const item = document.createElement('div');
      item.className = 'script-item saved-script';
      const content = document.createElement('div');
      content.className = 'script-content';
      const title = document.createElement('div');
      title.className = 'script-title';
      title.textContent = script.title;
      content.appendChild(title);
      item.appendChild(content);
      item.onclick = () => createTab(script.title, script.script);
      item.oncontextmenu = (e) => showContextMenu(e, script.title);
      scriptsList.appendChild(item);
    }
  });
  if (!foundInSaved) {
    const noResults = document.createElement('div');
    noResults.className = 'script-item';
    noResults.textContent = 'No matching scripts found in your saved scripts';
    scriptsList.appendChild(noResults);
  }
  const searchingIndicator = document.createElement('div');
  searchingIndicator.className = 'sidebar-category';
  searchingIndicator.textContent = 'Searching Online...';
  scriptsList.appendChild(searchingIndicator);
  try {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (thisSearchId !== currentSearchId) return;
    
    const searchUrl = `https://scriptblox.com/api/script/search?q=${encodeURIComponent(query)}&`;
    const response = await fetch(searchUrl);
    const data = await response.json();
    let scriptbloxResults = [];
    if (data && data.result && data.result.scripts && data.result.scripts.length > 0) {
      scriptbloxResults = data.result.scripts;
    }
    
    const rUrl = `https://rscripts.net/api/v2/scripts?q=${encodeURIComponent(query)}&page=1&orderBy=date`;
    const rRes = await fetch(rUrl);
    const rData = await rRes.json();
    let rscriptsResults = [];
    if (rData && rData.scripts && rData.scripts.length > 0) {
      rscriptsResults = rData.scripts;
    }
    
    let maxLen = Math.max(scriptbloxResults.length, rscriptsResults.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < scriptbloxResults.length) {
        const item = await renderScriptItem(scriptbloxResults[i], 'Scriptblox');
        scriptsList.appendChild(item);
      }
      if (i < rscriptsResults.length) {
        const item = await renderScriptItem(rscriptsResults[i], 'Rscripts');
        scriptsList.appendChild(item);
      }
    }
  } catch (err) {
    if (thisSearchId === currentSearchId) {
      console.error('Error searching scripts:', err);
      searchingIndicator.textContent = 'Online Results (Error)';
      const errorItem = document.createElement('div');
      errorItem.className = 'script-item';
      errorItem.textContent = `Error searching: ${err.message}`;
      scriptsList.appendChild(errorItem);
    }
  }
}

window.onload = function() {
  console.log("Auto-execute scripts:", loadAutoExecuteScripts());
  console.log("Saved scripts:", savedScripts);
  loadSavedScripts();
  startLogWatcher();
  startFileWatcher();
  sidebar.classList.add('open');
  updatedLoaded = false;
  renderSidebar();
  if (isElectron) {
    const logWorker = JoinWatcher();
    window.addEventListener('beforeunload', () => {
      if (logWorker) logWorker.terminate();
      if (fsWatcher) fsWatcher.close();
    });
  }
  createTab('startup', 'loadstring(game:HttpGet("https://rawscripts.net/raw/Infinite-Yield_500"))()');
  showToast("Ready");
  const newTabBtn = document.getElementById('new-tab-btn');
  if (newTabBtn) {
    newTabBtn.addEventListener('click', () => createTab());
  }
};

function autoexec() {
  let autoExecScripts = loadAutoExecuteScripts();

  if (autoExecScripts.length > 0) {
    autoExecScripts.forEach(scriptName => {
      const script = savedScripts.find(s => s.title === scriptName);
      const code = script ? script.script : `-- Script "${scriptName}" not found`;
      console.log(code)
      showToast("Executing...");
      console.log("Executing:", code);
      if (isElectron && ipcRenderer) {
        try {
          ipcRenderer.send('invokeAction', code);
          ipcRenderer.once('actionReply', (event, result) => {
            console.log("Result:", result);
            if (result.startsWith('Error:')) {
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
      }
    });
  }
}

async function renderSidebar() {
  scriptsList.innerHTML = '';
  const savedCategory = document.createElement('div');
  savedCategory.className = 'sidebar-category';
  savedCategory.textContent = 'Saved scripts';
  scriptsList.appendChild(savedCategory);
  if (savedScripts.length === 0) {
    const noScripts = document.createElement('div');
    noScripts.className = 'script-item';
    noScripts.textContent = 'No saved scripts';
    scriptsList.appendChild(noScripts);
  } else {
    savedScripts.forEach(script => {
      const item = document.createElement('div');
      item.className = 'script-item saved-script';
      const content = document.createElement('div');
      content.className = 'script-content';
      const title = document.createElement('div');
      title.className = 'script-title';
      title.textContent = script.title;
      content.appendChild(title);
      item.appendChild(content);
      item.onclick = () => createTab(script.title, script.script);
      item.oncontextmenu = (e) => showContextMenu(e, script.title);
      if (isAutoExecuteScript(script.title)) {
        const indicator = document.createElement('span');
        indicator.className = 'autoexecute-indicator';
        indicator.innerHTML = '⚡';
        content.appendChild(indicator);
      }
      scriptsList.appendChild(item);
    });
  }
  const updatedCategory = document.createElement('div');
  updatedCategory.className = 'sidebar-category';
  updatedCategory.textContent = 'Recently updated scripts';
  scriptsList.appendChild(updatedCategory);
  if (!updatedLoaded) {
    loadupdated();
    updatedLoaded = true;
  } else {
    if (updatedScripts.length > 0) {
      for (const script of updatedScripts) {
        const item = await renderScriptItem(script, script.__source || (script._id && script.rawScript ? 'Rscripts' : 'Scriptblox'));
        scriptsList.appendChild(item);
      }
    } else {
      loadupdated();
    }
  }
}

function getSettings() {
  return {
    glowMode: localStorage.getItem('glowMode') || 'default',
    accentColor: localStorage.getItem('accentColor') || '#7FB4FF',
  };
}

function applySettings() {
  const { glowMode, accentColor } = getSettings();
  document.body.classList.remove('glow-none', 'glow-default', 'glow-high');
  document.body.classList.add('glow-' + glowMode);
  document.documentElement.style.setProperty('--accent-color', accentColor);
  glowModeSelect.value = glowMode;
}

function saveSettings() {
  localStorage.setItem('glowMode', glowModeSelect.value);
  applySettings();
}

glowModeSelect.addEventListener('change', saveSettings);

resetGlowBtn.addEventListener('click', () => {
  glowModeSelect.value = 'default';
  saveSettings();
});
resetColorBtn.addEventListener('click', () => {
  localStorage.setItem('accentColor', '#7FB4FF');
  accentColorInput.value = '7FB4FF';
  updateAccentColorPreview('7FB4FF');
  applySettings();
});

settingsButton.addEventListener('click', () => {
  settingsPane.style.display = '';
  settingsPane.classList.remove('closing');
  settingsPane.classList.add('open');
  applySettings();
});
closeSettingsBtn.addEventListener('click', () => {
  settingsPane.classList.remove('open');
  settingsPane.classList.add('closing');
  setTimeout(() => {
    settingsPane.classList.remove('closing');
    settingsPane.style.display = 'none';
  }, 350);
});
settingsPane.addEventListener('click', (e) => {
  if (e.target === settingsPane) {
    settingsPane.classList.remove('open');
    settingsPane.classList.add('closing');
    setTimeout(() => {
      settingsPane.classList.remove('closing');
      settingsPane.style.display = 'none';
    }, 350);
  }
});

document.addEventListener('DOMContentLoaded', applySettings);
window.addEventListener('load', applySettings);


const accentColorPaletteBtn = document.getElementById('accentColorPalette');
if (accentColorPaletteBtn) {
  function showPaletteBtnOpen() {
    accentColorPaletteBtn.classList.add('open');
    if (accentColorPaletteBtn._openTimeout) clearTimeout(accentColorPaletteBtn._openTimeout);
    accentColorPaletteBtn._openTimeout = setTimeout(() => {
      accentColorPaletteBtn.classList.remove('open');
      accentColorPaletteBtn._openTimeout = null;
    }, 1500);
  }
  accentColorPaletteBtn.addEventListener('mousedown', function() {
    showPaletteBtnOpen();
  });
}


function openRenameDialog() {
  const renameDialog = document.getElementById('renameDialog');
  renameDialog.style.display = '';
  renameDialog.classList.remove('closing');
  renameDialog.classList.add('open');
  const renameInput = document.getElementById('renameInput');
  renameInput.value = '';
  renameInput.focus();
}

function closeRenameDialog() {
  const renameDialog = document.getElementById('renameDialog');
  renameDialog.classList.remove('open');
  renameDialog.classList.add('closing');
  setTimeout(() => {
    renameDialog.classList.remove('closing');
    renameDialog.style.display = 'none';
  }, 350);
}

let fsWatcher = null;

function startFileWatcher() {
  if (fsWatcher) {
    fsWatcher.close();
  }
  
  try {
    fsWatcher = fs.watch(scriptsDirectory, { persistent: true }, (eventType, filename) => {
      if (filename && (filename.endsWith('.txt') || eventType === 'rename')) {
        console.log(`File ${filename} ${eventType}`);
        loadSavedScripts();
        if (sidebar.classList.contains('open')) {
          renderSidebar();
        }
      }
    });
    console.log("File watcher started for scripts directory");
  } catch (err) {
    console.error("Error starting file watcher:", err);
  }
}


function createBadge(text, className) {
  const badge = document.createElement('span');
  badge.className = className + ' script-badge';
  badge.innerText = text;
  return badge;
}


function getScriptImage(script, source) {
  let img = script.image || script.gameLogo || (script.game && (script.game.imageUrl || script.game.imgurl));
  if (img && source === 'Scriptblox' && img.startsWith('/images')) {
    return 'https://scriptblox.com' + img;
  }
  return img;
}


function createDiscordBadge(url) {
  const badge = document.createElement('span');
  badge.className = 'script-discord';
  badge.innerText = 'Discord';
  badge.onclick = (e) => {
    e.stopPropagation();
    if (window && window.process && window.process.type === 'renderer') {
      try {
        require('electron').shell.openExternal(url);
      } catch (err) {
        window.open(url, '_blank');
      }
    } else {
      window.open(url, '_blank');
    }
  };
  return badge;
}


function createGameNamePlain(name) {
  const el = document.createElement('div');
  el.className = 'script-game';
  el.innerText = name;
  return el;
}


function createAuthor(user) {
  if (!user) return null;
  const el = document.createElement('div');
  el.className = 'script-author';
  el.innerText = 'By ' + (user.username || user.name || 'Unknown');
  if (user.verified) {
    el.appendChild(createBadge('✔ Verified', 'script-verified'));
  }
  return el;
}


function createStats(script) {
  const el = document.createElement('div');
  el.className = 'script-stats';
  let stats = [];
  if (typeof script.views === 'number') stats.push(`👁️ ${script.views}`);
  if (typeof script.likes === 'number') stats.push(`👍 ${script.likes}`);
  if (typeof script.dislikes === 'number') stats.push(`👎 ${script.dislikes}`);
  if (stats.length) el.innerText = stats.join('   ');
  return el;
}


async function renderScriptItem(script, source) {
  
  if (source === 'Rscripts' && script._id && (!script.description || !script.user || !script.game)) {
    try {
      const res = await fetch(`https://rscripts.net/api/v2/script?id=${script._id}`);
      const data = await res.json();
      if (data && data.script && data.script[0]) {
        script = { ...script, ...data.script[0] };
      }
    } catch (e) {}
  }
  
  if (source === 'Scriptblox' && script._id && (!script.description || !script.owner || !script.game)) {
    try {
      const res = await fetch(`https://scriptblox.com/api/script/${script._id}`);
      const data = await res.json();
      if (data && data.result && data.result.script) {
        script = { ...script, ...data.result.script };
      }
    } catch (e) {}
  }
  const item = document.createElement('div');
  item.className = 'script-item searched-script';
  
  let bg = getScriptImage(script, source);
  if (bg) item.style.backgroundImage = `url('${bg}')`;
  
  const content = document.createElement('div');
  content.className = 'script-content';
  
  const title = document.createElement('div');
  title.className = 'script-title';
  title.innerText = script.title || 'Unnamed Script';
  content.appendChild(title);
  
  const sourceDiv = document.createElement('div');
  sourceDiv.className = 'script-source';
  sourceDiv.innerText = 'Source: ' + (source || script.__source || 'Unknown');
  content.appendChild(sourceDiv);
  
  let gameName = (script.game && (script.game.name || script.game.title)) || '';
  if (gameName) content.appendChild(createGameNamePlain(gameName));
  
  if (script.description) {
    const desc = document.createElement('div');
    desc.className = 'script-description';
    desc.innerText = script.description;
    content.appendChild(desc);
  }
  
  if (script.user || script.owner) {
    const author = createAuthor(script.user || script.owner);
    if (author) content.appendChild(author);
  }
  
  const meta = document.createElement('div');
  meta.className = 'script-meta';
  if (script.keySystem || script.key) meta.appendChild(createBadge('Key Required', 'script-key'));
  
  if (source === 'Rscripts') {
    let discordUrl = script.discord || (script.user && script.user.socials && script.user.socials.discordServer);
    if (discordUrl) {
      const discordBadge = createDiscordBadge(discordUrl);
      meta.appendChild(discordBadge);
    }
  }
  if (script.mobileReady) meta.appendChild(createBadge('Mobile', 'script-mobile'));
  if (script.paid) meta.appendChild(createBadge('Paid', 'script-paid'));
  content.appendChild(meta);
  
  const stats = createStats(script);
  if (stats && stats.innerText) content.appendChild(stats);
  item.appendChild(content);
  
  item.onclick = () => {
    if (script.script) {
      createTab(script.title, script.script);
    } else if (script.rawScript) {
      fetch(script.rawScript)
        .then(res => res.text())
        .then(text => createTab(script.title, text))
        .catch(() => createTab(script.title, '-- Error loading script'));
    } else if (script._id) {
      const loadingIndicator = document.createElement('div');
      loadingIndicator.className = 'loading-indicator';
      loadingIndicator.textContent = 'Loading...';
      item.appendChild(loadingIndicator);
      fetchScriptContent(script._id)
        .then(content => {
          if (item.querySelector('.loading-indicator')) {
            item.querySelector('.loading-indicator').remove();
          }
          if (content) {
            createTab(script.title, content);
          } else {
            showToast("Couldn't load script content", true);
          }
        })
        .catch(err => {
          if (item.querySelector('.loading-indicator')) {
            item.querySelector('.loading-indicator').remove();
          }
          showToast('Error: ' + err.message, true);
        });
    } else {
      showToast('Script content not available', true);
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
      ipcRenderer.send('invokeAction', { code });
      ipcRenderer.once('actionReply', (event, result) => {
        console.log("Result:", result);
        if (result.startsWith('Error:')) {
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

window.addEventListener('DOMContentLoaded', () => {
  const closeColorPickerBtn = document.getElementById('closeColorPicker');
  if (closeColorPickerBtn && accentColorInput) {
    closeColorPickerBtn.addEventListener('click', () => {
      accentColorInput.blur();
      accentColorInput.style.display = 'none';
      setTimeout(() => {
        accentColorInput.style.display = '';
      }, 200);
    });
  }
});

const accentColorInput = document.getElementById('accentColorInput');
const accentColorPreview = document.getElementById('accentColorPreview');

function isValidHex(hex) {
  return /^#?([0-9A-Fa-f]{6})$/.test(hex);
}

function normalizeHex(hex) {
  hex = hex.trim();
  if (!hex.startsWith('#')) {
    hex = '#' + hex;
  }
  return hex;
}

function updateAccentColorPreview(hex) {
  accentColorPreview.style.background = isValidHex(hex) ? normalizeHex(hex) : '#7FB4FF';
}

function handleAccentColorInput() {
  const hex = accentColorInput.value.trim();
  if (isValidHex(hex)) {
    const normalized = normalizeHex(hex);
    updateAccentColorPreview(normalized);
    localStorage.setItem('accentColor', normalized);
    applySettings();
  } else {
    updateAccentColorPreview(hex);
  }
}

if (accentColorInput && accentColorPreview) {
  accentColorInput.addEventListener('input', handleAccentColorInput);
  settingsButton.addEventListener('click', () => {
    const current = (localStorage.getItem('accentColor') || '#7FB4FF').replace(/^#/, '');
    accentColorInput.value = current;
    updateAccentColorPreview(current);
  });
}

document.getElementById('cancelRename').addEventListener('click', () => {
  closeRenameDialog();
});

document.getElementById('confirmRename').addEventListener('click', () => {
  const renameInput = document.getElementById('renameInput');
  const newName = renameInput.value.trim().split('.')[0];
  if (!newName) {
    showToast('Script name is required', true);
    renameInput.focus();
    return;
  }
  if (savedScripts.some(s => s.title === newName)) {
    showToast(`Script "${newName}" already exists`, true);
    renameInput.focus();
    return;
  }
  const tab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.id === currentTab);
  if (!tab) {
    showToast('No script selected to save', true);
    return;
  }
  saveScriptContent(tab, newName);
  closeRenameDialog();
});
