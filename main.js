const isElectron = window.navigator.userAgent.toLowerCase().indexOf('electron/') > -1;
let ipcRenderer;
let currentPort = null;
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
const consoleOutput = document.getElementById('consoleOutput');
const clearConsoleBtn = document.getElementById('clearConsole');
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

function makeWindowDraggable() {
  if (!isElectron || !ipcRenderer) return;
  const tabsElement = document.getElementById('tabs');
  tabsElement.style.webkitAppRegion = 'drag';
  
  const draggableElements = tabsElement.querySelectorAll('.tab');
  draggableElements.forEach(el => {
    el.style.webkitAppRegion = 'no-drag';
  });
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

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.className = isError ? 'toast error show' : 'toast show';
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

const luaKeywords = ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while', 'print', 'ipairs', 'pairs', 'tonumber', 'tostring', 'type', 'collectgarbage', 'error', 'setmetatable', 'getmetatable', 'require', 'pcall', 'xpcall', 'rawget', 'rawset', 'select', 'assert', 'loadstring', 'dofile', '_G', 'game', 'workspace', 'script', 'math', 'string', 'table', 'coroutine', 'debug', 'os', 'io', 'wait', 'spawn', 'delay', 'tick', 'task', 'Vector3', 'CFrame', 'Color3', 'UDim2', 'loadstring', 'Instance', 'GetService', 'FindFirstChild', 'GetChildren', 'Destroy', 'Clone', 'Parent', 'HttpGet', 'FireServer'];

function createEditor(tabId, content) {
  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'editor-wrapper';
  editorWrapper.id = `editor-${tabId}`;
  editorContainer.appendChild(editorWrapper);
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
        cm.showHint({
          hint: CodeMirror.hint.anyword,
          words: luaKeywords
        });
      },
      "Tab": function(cm) {
        const cursor = cm.getCursor();
        const line = cm.getLine(cursor.line);
        const cursorPos = cursor.ch;
        const textBeforeCursor = line.substring(0, cursorPos);
        if (textBeforeCursor.trim().length > 0 && !textBeforeCursor.endsWith(" ")) {
          cm.showHint({
            hint: CodeMirror.hint.anyword,
            words: luaKeywords
          });
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
        hint: CodeMirror.hint.anyword,
        words: luaKeywords,
        completeSingle: false
      });
    }
  });
  return editor;
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
          let scriptName = file.replace('.txt', '');
          scriptName = scriptName.split('.')[0];
          savedScripts.push({
            title: scriptName,
            script: content
          });
        }
      });
    }
  } catch (err) {
    console.error("Error loading saved scripts:", err);
    addLog("Error loading saved scripts: " + err.message, "error");
  }
}

function persistSavedScripts() {
  try {
    localStorage.setItem('savedScripts', JSON.stringify(savedScripts));
  } catch (err) {
    console.error("Error saving scripts:", err);
  }
}

function loadAutoExecuteScripts() {
  try {
    const autoExecScripts = localStorage.getItem('autoExecuteScripts');
    return autoExecScripts ? JSON.parse(autoExecScripts) : [];
  } catch (err) {
    console.error("Error loading autoexecute scripts:", err);
    return [];
  }
}

function saveAutoExecuteScripts(scripts) {
  try {
    localStorage.setItem('autoExecuteScripts', JSON.stringify(scripts));
  } catch (err) {
    console.error("Error saving autoexecute scripts:", err);
  }
}

function isAutoExecuteScript(scriptName) {
  const autoExecScripts = loadAutoExecuteScripts();
  return autoExecScripts.includes(scriptName);
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
  input.style.width = '100%';
  input.style.background = 'transparent';
  input.style.border = '1px solid #569CD6';
  input.style.color = '#d4d4d4';
  input.style.padding = '2px';
  input.style.fontFamily = 'inherit';
  
  
  titleElement.replaceWith(input);
  input.focus();
  
  function handleRename() {
    const newName = input.value.trim().split('.')[0];
    
    
    if (newName && newName !== originalName) {
      const scriptIndex = savedScripts.findIndex(s => s.title === originalName);
      if (scriptIndex !== -1) {
        savedScripts[scriptIndex].title = newName;
        
        
        const autoExecScripts = loadAutoExecuteScripts();
        const autoExecIndex = autoExecScripts.indexOf(originalName);
        if (autoExecIndex !== -1) {
          autoExecScripts[autoExecIndex] = newName;
          saveAutoExecuteScripts(autoExecScripts);
        }
        
        persistSavedScripts();
        const filePath = path.join(scriptsDirectory, `${originalName}.txt`);
        const newFilePath = path.join(scriptsDirectory, `${newName}.txt`);
        fs.renameSync(filePath, newFilePath);
        
        showToast(`Script renamed to "${newName}"`);
      }
    }
    
    titleElement.textContent = newName || originalName;
    input.replaceWith(titleElement);
    if (tabs.children.length > 0) {
      for (let i = 0; i < tabs.children.length; i++) {
        const tab = tabs.children[i];
        if (tab.dataset.realTabName === originalName) {
          tab.dataset.realTabName = newName;
          let displayName = newName;
          if (newName.length > 15) {
            displayName = newName.substring(0, 10) + '...';
          }
          tab.dataset.name = displayName;
          tab.querySelector('span').textContent = displayName;
        }
      }
    }
  }
  
  input.addEventListener('blur', handleRename);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const newName = input.value.trim();
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
      
      
      const filePath = path.join(scriptsDirectory, `${currentContextScript}`);
      try {
        fs.unlinkSync(filePath);
        savedScripts.splice(scriptIndex, 1);
        persistSavedScripts();
        renderSidebar();
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
    closeTab(id);
  };
  tab.appendChild(closeBtn);
  tab.dataset.id = id;
  tab.dataset.name = name;
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

function closeTab(id) {
    const remainingTabIds = Object.keys(editors);
    const tab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.id === id);
    if (remainingTabIds.length === 1) {
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



function closeCurrentTab() {
  if (currentTab) closeTab(currentTab);
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
    const renameDialog = document.getElementById('renameDialog');
    renameDialog.style.display = 'flex';
    const renameInput = document.getElementById('renameInput');
    renameInput.value = '';
    renameInput.focus();
    return;
  }
  scriptName = scriptName.split('.')[0];
  saveScriptContent(tab, scriptName);
}

function saveScriptContent(tab, scriptName) {
  if (!scriptName) {
    showToast("Script name is required", true);
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
      
      const tabNameElement = tab.querySelector('span');
      if (tabNameElement) {
        tabNameElement.textContent = scriptName.replace('.txt', '');
      }
      
      
      loadSavedScripts();
      
      
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
    closeCurrentTab();
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
document.getElementById('toggleSidebar').addEventListener('click', () => {
  sidebar.classList.toggle('open');
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
  makeWindowDraggable();
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
  savedCategory.textContent = 'Saved Scripts';
  scriptsList.appendChild(savedCategory);
  loadSavedScripts();
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
      const loadingItem = document.createElement('div');
      loadingItem.className = 'script-item';
      loadingItem.textContent = 'Loading updated scripts...';
      scriptsList.appendChild(loadingItem);
      loadupdated();
    }
  }
}

document.getElementById('confirmRename').addEventListener('click', () => {
  const newName = document.getElementById('renameInput').value.trim();
  
  if (!newName) {
    showToast("Script name is required", true);
    return;
  }
  
  if (savedScripts.some(s => s.title === newName)) {
    showToast(`Script "${newName}" already exists`, true);
    return;
  }
  
  const tab = Array.from(document.querySelectorAll('.tab')).find(t => t.dataset.id === currentTab);
  tab.dataset.name = newName;
  tab.dataset.realTabName = newName;
  
  const tabNameElement = tab.querySelector('span');
  if (tabNameElement) {
    tabNameElement.textContent = newName;
  }
  
  saveScriptContent(tab, newName);
  
  document.getElementById('renameDialog').style.display = 'none';
});

document.getElementById('cancelRename').addEventListener('click', () => {
  document.getElementById('renameDialog').style.display = 'none';
});

document.getElementById('renameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('confirmRename').click();
  } else if (e.key === 'Escape') {
    document.getElementById('cancelRename').click();
  }
});


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
  badge.style.marginLeft = '6px';
  badge.style.padding = '2px 6px';
  badge.style.borderRadius = '4px';
  badge.style.fontSize = '11px';
  badge.style.background = '#3B4252'; // nord1
  badge.style.color = '#D8DEE9'; // nord4
  badge.style.display = 'inline-block';
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
  badge.style.margin = '0 8px';
  badge.style.padding = '2px 6px';
  badge.style.borderRadius = '4px';
  badge.style.fontSize = '11px';
  badge.style.background = 'rgba(67,76,94,0.18)'; // nord2
  badge.style.color = '#8FBCBB'; // nord7
  badge.style.cursor = 'pointer';
  badge.style.fontFamily = 'inherit';
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
  el.style.fontSize = '12px';
  el.style.color = '#aaa';
  el.innerText = 'By ' + (user.username || user.name || 'Unknown');
  if (user.verified) {
    el.appendChild(createBadge('✔ Verified', 'script-verified'));
  }
  return el;
}


function createStats(script) {
  const el = document.createElement('div');
  el.className = 'script-stats';
  el.style.fontSize = '11px';
  el.style.color = '#888';
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
