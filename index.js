const { app, BrowserWindow, ipcMain } = require('electron');
const START_PORT = 6969;
const END_PORT = 7069;
let serverPort = null;
let lastError = '';
let port = null;
let mainWindow = null;

ipcMain.handle('start-log-watcher', async () => {
  const logWatcher = require('./logWatcher.js')
  return logWatcher.start(mainWindow)
})

ipcMain.handle('show-save-dialog', async () => {
  const { dialog } = require('electron');
  return dialog.showSaveDialog({
    title: 'Save Script',
    defaultPath: path.join(require('os').homedir(), 'Documents', 'Tritium'),
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
});

async function ligma(scriptContent) {
  try {
    for (port = START_PORT; port <= END_PORT; port++) {
      const url = `http://127.0.0.1:${port}/secret`
      try {
        const res = await fetch(url, {
          method: 'GET'
        });
        if (res.ok) {
          const text = await res.text();
          if (text === '0xdeadbeef') {
            serverPort = port;
            console.log(`✅ Server found on port ${port}`);
            break;
          }
        }
      } catch (e) {
        lastError = e.message;
      }
    }
    
    if (!serverPort) {
      throw new Error(`Could not locate HTTP server on ports ${START_PORT}-${END_PORT}. Last error: ${lastError}`);
    }
    
    const postUrl = `http://127.0.0.1:${port}/execute`
    console.log(`Sending script to ${postUrl}`);
    console.log(`Script content: ${scriptContent}`);
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain'
      },
      body: scriptContent
    });
    
    if (response.ok) {
      const resultText = await response.text();
      console.log(`✅ Script submitted successfully: ${resultText}`);
      return resultText;
    } else {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
  }
  catch (error) {
    console.error(error);

    throw error;
  }
}

function processData(data) {
  const code = typeof data === 'object' && data.code ? data.code : data;
  return ligma(code).catch(err => `Error: ${err.message}`);
}


function createWindow() {
  mainWindow = new BrowserWindow({
    resizable: true,
    minWidth: 1290,
    minHeight: 640,
    width: 1450,
    height: 760,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,  
    },
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 27, y: 27 },
    icon: __dirname + './icon.png',
    title: "Tritium",
  });

  
  mainWindow.setMenuBarVisibility(false);
  
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'arrowleft') {
      mainWindow.webContents.goBack();
    } else if (input.control && input.shift && input.key.toLowerCase() === 'arrowright') {
      mainWindow.webContents.goForward();
    }
  });
  
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.loadFile('./index.html');
    return { action: 'deny' };
  });
  
  
  ipcMain.on('invokeAction', function(event, data) {
    console.log("Received IPC message:", data);
    
    processData(data).then(result => {
      event.sender.send('actionReply', result);
    }).catch(err => {
      event.sender.send('actionReply', `Error: ${err.message}`);
    });
  });
  
  mainWindow.loadFile('./index.html');
}

app.whenReady().then(createWindow);