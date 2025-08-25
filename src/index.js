const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  Menu,
} = require("electron");
const sudo = require("sudo-prompt");
const fs = require("fs");
const path = require("path");
const os = require("os");
const fetch = require("node-fetch");
const chokidar = require("chokidar");
const { version: currentVersion } = require("./package.json");
const { nativeTheme } = require("electron");
const { exec } = require("child_process");
const START_PORT = 5553;
const END_PORT = 5563;
const net = require("net");
const zlib = require("zlib");
let mainWindow = null;
let serverPort = null;
let lastError = null;
const localStorage = require("electron-localstorage");
let spotlightWindow = null;
let watcher = null;
let currentLogPath = null;
let filePosition = 0;
let checkLogInterval = null;

function findLatestLogFile() {
  const homedir = require("os").homedir();
  const logDir = path.join(homedir, "Library", "Logs", "Roblox");
  try {
    const files = fs
      .readdirSync(logDir)
      .filter((file) => file.endsWith(".log"))
      .map((file) => ({
        path: path.join(logDir, file),
        mtime: fs.statSync(path.join(logDir, file)).mtime,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  } catch (err) {
    console.error("Error finding log files:", err);
    return null;
  }
}

function switchToNewLogFile(mainWindow) {
  const newLogPath = findLatestLogFile();

  if (!newLogPath) {
    console.log("No log file found");
    return;
  }

  if (newLogPath !== currentLogPath) {
    console.log(`Switching to new log file: ${newLogPath}`);

    filePosition = 0;

    if (watcher) {
      watcher.close();
    }

    currentLogPath = newLogPath;

    try {
      const content = fs.readFileSync(currentLogPath, "utf8");
      const lines = content.split("\n").filter((line) => line.trim() !== "");
      filePosition = content.length;

      lines.forEach((line) => {
        mainWindow.webContents.send("log-update", line);
      });
      mainWindow.webContents.send(
        "log-update",
        "Initial log content restored " + Date.now(),
      );
    } catch (err) {
      console.error("Error reading initial log content:", err);
    }
    watcher = chokidar.watch(currentLogPath, {
      persistent: true,
      ignoreInitial: true,
    });

    watcher.on("change", () => {
      try {
        const stats = fs.statSync(currentLogPath);
        if (stats.size < filePosition) {
          filePosition = 0;
        }

        const stream = fs.createReadStream(currentLogPath, {
          encoding: "utf8",
          start: filePosition,
        });

        let remaining = "";
        stream.on("data", (data) => {
          const lines = (remaining + data).split("\n");
          remaining = lines.pop();

          lines
            .filter((line) => line.trim() !== "")
            .forEach((line) => {
              try {
                mainWindow.webContents.send("log-update", line);
              } catch (err) {
                console.error("Error sending log update to main window:", err);
              }
            });
        });

        stream.on("end", () => {
          filePosition = stats.size;
        });

        stream.on("error", (err) => {
          console.error("Error reading log file:", err);
        });
      } catch (err) {
        console.error("Error handling log change:", err);
      }
    });

    watcher.on("error", (err) => {
      console.error("Log watcher error:", err);
    });
  }
}

function logstart(mainWindow) {
  switchToNewLogFile(mainWindow);

  checkLogInterval = setInterval(() => {
    switchToNewLogFile(mainWindow);
  }, 5000);

  return { success: true, path: currentLogPath };
}

function logend() {
  if (watcher) {
    watcher.close();
  }
  if (checkLogInterval) {
    clearInterval(checkLogInterval);
  }
}

function runMacSploitInstall() {
  return new Promise((resolve, reject) => {
    const sentinel = path.join(os.tmpdir(), "macsploit_install_done");
    try {
      if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    } catch (_) {}

    const applescriptPath = path.join(os.tmpdir(), "macsploit_install.scpt");
    const bashCmd =
      'cd ~ && curl -s "https://git.raptor.fun/main/install.sh" | bash </dev/tty; echo $? > ' +
      JSON.stringify(sentinel);
    const applescript = `tell application "Terminal"\n  activate\n  do script ${JSON.stringify(bashCmd)}\nend tell\n`;
    try {
      fs.writeFileSync(applescriptPath, applescript, "utf8");
    } catch (err) {
      return reject(err);
    }

    exec(`osascript ${JSON.stringify(applescriptPath)}`, (error) => {
      if (error) {
        return reject(error);
      }

      const start = Date.now();
      const maxDurationMs = 1000 * 60 * 30;
      const pollInterval = 4000;
      const interval = setInterval(() => {
        try {
          if (fs.existsSync(sentinel)) {
            clearInterval(interval);
            let exitCode = "1";
            try {
              exitCode = fs.readFileSync(sentinel, "utf8").trim();
              fs.unlinkSync(sentinel);
            } catch (_) {}
            if (exitCode === "0") {
              try {
                dialog.showMessageBox(mainWindow, {
                  type: "info",
                  title: "MacSploit Install Complete",
                  message: "MacSploit installation finished successfully.",
                  buttons: ["OK"],
                });
              } catch (_) {}
            } else {
              dialog.showMessageBox(mainWindow, {
                type: "error",
                title: "MacSploit Install Failed",
                message: `MacSploit installer exited with code ${exitCode}.`,
                buttons: ["OK"],
              });
            }
          } else if (Date.now() - start > maxDurationMs) {
            clearInterval(interval);
            dialog.showMessageBox(mainWindow, {
              type: "warning",
              title: "MacSploit Install Timeout",
              message: "Timed out waiting for MacSploit installer to finish.",
              buttons: ["OK"],
            });
          }
        } catch (e) {}
      }, pollInterval);
      resolve("started");
    });
  });
}

ipcMain.on("invokeAction", function (event, data) {
  console.log("Received IPC message:", data);

  processData(data)
    .then((result) => {
      event.sender.send("actionReply", result);
    })
    .catch((err) => {
      event.sender.send("actionReply", `Error: ${err.message}`);
    });
});

ipcMain.handle("start-log-watcher", async () => {
  return logstart(mainWindow);
});

ipcMain.handle("show-save-dialog", async () => {
  const { dialog } = require("electron");
  return dialog.showSaveDialog({
    title: "Save Script",
    defaultPath: path.join(require("os").homedir(), "Documents", "Tritium"),
    filters: [{ name: "Text Files", extensions: ["txt"] }],
  });
});

ipcMain.handle("ms-update", async () => {
  try {
    const out = await runMacSploitInstall();
    console.log("MacSploit update output:", out);
    return { success: true };
  } catch (err) {
    console.error("MacSploit update failed:", err);
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Update Failed",
      message: `Failed to update MacSploit: ${err.message}`,
      buttons: ["OK"],
    });
    return { success: false, error: err.message };
  }
});

async function checkForUpdates() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/Phantom8015/Tritium/releases/latest",
    );
    if (!response.ok) {
      throw new Error(response.statusText);
    }
    const data = await response.json();
    const latestVersion = data.tag_name.replace("v", "");

    const current = currentVersion.split(".").map(Number);
    const latest = latestVersion.split(".").map(Number);
    const macSploitVersion = await fetch(
      "https://www.raptor.fun/main/version.json",
    );
    const macSploitData = await macSploitVersion.json();
    const msVersion = macSploitData.relVersion;
    if (localStorage.getItem("macSploitVersion")) {
      if (localStorage.getItem("macSploitVersion") !== msVersion) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "MacSploit Update Available",
          message: `A new version of MacSploit (${msVersion}) is available!\nWould you like to update now?`,
          buttons: ["Update", "Later"],
          defaultId: 0,
        });

        if (choice.response === 0) {
          await msUpdate();
        }
      }
    }

    localStorage.setItem("macSploitVersion", msVersion);

    for (let i = 0; i < 3; i++) {
      if (latest[i] > current[i]) {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Update Available",
          message: `A new version of Tritium (${latestVersion}) is available!\nWould you like to update now?`,
          buttons: ["Update", "Later"],
          defaultId: 0,
        });

        if (choice.response === 0) {
          await update();
        }
        break;
      }
    }
  } catch (error) {
    console.error("Error checking for updates:", error);
  }
}

async function msUpdate() {
  try {
    const output = await runMacSploitInstall();
    console.log(`MacSploit update output: ${output}`);
  } catch (error) {
    console.error("Update failed:", error);
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Update Failed",
      message: `Failed to update Tritium: ${error.message}`,
      buttons: ["OK"],
    });
  }
}

async function update() {
  try {
    const command =
      "curl -fsSL https://raw.githubusercontent.com/Phantom8015/Tritium/main/install.sh | bash";

    await new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Update error: ${error.message}`);
          dialog.showMessageBox(mainWindow, {
            type: "error",
            title: "Update Failed",
            message: `Failed to update Tritium: ${error.message}`,
            buttons: ["OK"],
          });
          reject(error);
          return;
        }
        console.log(`Update output: ${stdout}`);
        if (stderr) {
          console.error(`Update stderr: ${stderr}`);
        }
        resolve();
      });
    });

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Complete",
      message:
        "Tritium has been updated successfully. The application will now restart.",
      buttons: ["OK"],
    });

    const currentAppPath = app.getPath("exe");
    const appDir = path.dirname(currentAppPath);
    const newAppPath = path.join("/Applications", "Tritium.app");

    const scriptPath = path.join(os.tmpdir(), "tritium_restart.sh");
    const script = `#!/bin/bash
sleep 2

if [[ "${currentAppPath}" != "/Applications/Tritium.app"* ]]; then
  echo "Removing old app at: ${currentAppPath}"
  rm -rf "${appDir}"
fi

if [ -d "${newAppPath}" ]; then
  echo "Starting new Tritium app"
  open "${newAppPath}"
else
  echo "New Tritium app not found at ${newAppPath}"
fi

rm -f "${scriptPath}"
`;

    fs.writeFileSync(scriptPath, script);
    fs.chmodSync(scriptPath, 0o755);

    exec(`nohup "${scriptPath}" > /dev/null 2>&1 &`);

    app.quit();
  } catch (error) {
    console.error("Update failed:", error);
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Update Failed",
      message: `Failed to update Tritium: ${error.message}`,
      buttons: ["OK"],
    });
  }
}

function initializeSpotlight() {
  spotlightWindow = new BrowserWindow({
    width: 600,
    height: 300,
    frame: false,
    backgroundColor: "#00000000",
    vibrancy: "hud",
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  spotlightWindow.loadFile(path.join(__dirname, "spotlight.html"));

  spotlightWindow.on("closed", () => {
    spotlightWindow = null;
  });

  spotlightWindow.on("hide", () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
      }
    } catch (_) {}
  });

  spotlightWindow.on("blur", () => {
    if (
      spotlightWindow &&
      !spotlightWindow.isDestroyed() &&
      spotlightWindow.isVisible()
    ) {
      const devToolsWebContents =
        spotlightWindow.webContents.devToolsWebContents;

      if (!(devToolsWebContents && devToolsWebContents.isFocused())) {
      }
    }
  });
}

function showSpotlight() {
  if (!spotlightWindow || spotlightWindow.isDestroyed()) {
    initializeSpotlight();
  }

  if (spotlightWindow.isVisible()) {
    spotlightWindow.focus();
  } else {
    spotlightWindow.center();
    spotlightWindow.show();
    spotlightWindow.focus();
  }

  spotlightWindow.webContents.send("spotlight-shown");
}

ipcMain.handle("list-scripts", async () => {
  const scriptsDir = path.join(os.homedir(), "Documents", "Tritium");
  try {
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
      return [];
    }
    const files = fs.readdirSync(scriptsDir);
    return files.filter(
      (file) =>
        file.endsWith(".txt") &&
        fs.statSync(path.join(scriptsDir, file)).isFile(),
    );
  } catch (error) {
    console.error("Error listing scripts:", error);
    return [];
  }
});

ipcMain.on("hide-spotlight-window", () => {
  if (
    spotlightWindow &&
    !spotlightWindow.isDestroyed() &&
    spotlightWindow.isVisible()
  ) {
    spotlightWindow.hide();
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (typeof mainWindow.blur === "function") mainWindow.blur();
    }
  } catch (_) {}

  spotlightWindow = null;
});

function applyDarkVibrancy(enableMain, enableSpotlight) {
  try {
    if (enableMain && mainWindow) mainWindow.setVibrancy("hud");
    else if (mainWindow) mainWindow.setVibrancy(null);
    if (enableSpotlight && spotlightWindow) spotlightWindow.setVibrancy("hud");
    else if (spotlightWindow) spotlightWindow.setVibrancy(null);
  } catch (_) {}
}

let _vibrancyEnabledMain = true;
let _vibrancyEnabledSpotlight = true;

ipcMain.on("set-vibrancy", (event, enableVibrancy) => {
  _vibrancyEnabledMain = !!enableVibrancy;
  applyDarkVibrancy(_vibrancyEnabledMain, _vibrancyEnabledSpotlight);
});

ipcMain.on("set-spvibrancy", (event, enableVibrancy) => {
  _vibrancyEnabledSpotlight = !!enableVibrancy;
  applyDarkVibrancy(_vibrancyEnabledMain, _vibrancyEnabledSpotlight);
});

const EXECUTOR_KEY = "executorType";
if (!localStorage.getItem(EXECUTOR_KEY)) {
  localStorage.setItem(EXECUTOR_KEY, "MacSploit");
}

const executorConfigPath = path.join(app.getPath("userData"), "executor.json");

function readExecutorFromFile() {
  try {
    if (fs.existsSync(executorConfigPath)) {
      const raw = fs.readFileSync(executorConfigPath, "utf8");
      const obj = JSON.parse(raw);
      if (obj && obj.executor) return obj.executor;
    }
  } catch (e) {
    console.warn("Failed to read executor config:", e.message);
  }
  return null;
}

function writeExecutorToFile(value) {
  try {
    fs.writeFileSync(
      executorConfigPath,
      JSON.stringify({ executor: value }),
      "utf8",
    );
  } catch (e) {
    console.warn("Failed to write executor config:", e.message);
  }
}

let _executorType =
  readExecutorFromFile() || localStorage.getItem(EXECUTOR_KEY) || "MacSploit";

ipcMain.handle("get-executor", async () => {
  return _executorType || "MacSploit";
});

ipcMain.handle("set-executor", async (event, value) => {
  if (value !== "MacSploit" && value !== "Opiumware" && value !== "Hydrogen") {
    throw new Error("Invalid executor");
  }
  _executorType = value;
  try {
    localStorage.setItem(EXECUTOR_KEY, value);
  } catch (e) {}

  try {
    writeExecutorToFile(value);
  } catch (e) {}
  return { success: true };
});

ipcMain.on("vibrancy-opacity-changed", (event, value) => {
  try {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      spotlightWindow.webContents.send("apply-vibrancy-opacity", value);
    }
  } catch (_) {}
});

ipcMain.on("set-spotlight-size", (event, size) => {
  try {
    if (spotlightWindow && !spotlightWindow.isDestroyed()) {
      const w = parseInt(size && size.width, 10) || 600;
      const h = parseInt(size && size.height, 10) || 300;
      spotlightWindow.setSize(w, h);
      spotlightWindow.center();
    }
  } catch (e) {
    console.error("Failed to set spotlight size:", e);
  }
});

async function ligma(scriptContent) {
  const executor = _executorType || "MacSploit";

  if (executor === "MacSploit") {
    for (let port = START_PORT; port <= END_PORT; port++) {
      try {
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(
            { host: "127.0.0.1", port },
            () => {
              serverPort = port;
              socket.destroy();
              resolve();
            },
          );
          socket.on("error", reject);
          socket.setTimeout(500, () => reject(new Error("Timeout")));
        });
        if (serverPort) break;
      } catch (err) {
        lastError = err.message;
      }
    }

    if (!serverPort) {
      throw new Error(
        `Could not locate TCP server on ports ${START_PORT}-${END_PORT}. Last error: ${lastError}`,
      );
    }

    console.log(`✅ Server found on port ${serverPort}`);
    console.log(scriptContent);
    const header = Buffer.alloc(16, 0);
    header.writeUInt32LE(Buffer.byteLength(scriptContent) + 1, 8);
    net
      .createConnection(serverPort, "127.0.0.1")
      .on("connect", function () {
        this.write(
          Buffer.concat([header, Buffer.from(scriptContent), Buffer.from([0])]),
        );
        this.end();
      })
      .setTimeout(3000);
    return;
  }

  if (executor === "Opiumware") {
    const Ports = [8392, 8393, 8394, 8395, 8396, 8397];
    let ConnectedPort = null;
    let Stream = null;

    for (const P of Ports) {
      try {
        Stream = await new Promise((Resolve, Reject) => {
          const Socket = net.createConnection(
            { host: "127.0.0.1", port: P },
            () => Resolve(Socket),
          );
          Socket.on("error", Reject);
          Socket.setTimeout(1000, () => Reject(new Error("Timeout")));
        });
        console.log(`Successfully connected to Opiumware on port: ${P}`);
        ConnectedPort = P;
        break;
      } catch (Err) {
        console.log(`Failed to connect to port ${P}: ${Err.message}`);
      }
    }

    if (!Stream) throw new Error("Failed to connect on Opiumware ports");

    if (scriptContent !== "NULL") {
      try {
        scriptContent = "OpiumwareScript " + scriptContent;
        await new Promise((Resolve, Reject) => {
          zlib.deflate(
            Buffer.from(scriptContent, "utf8"),
            (Err, Compressed) => {
              if (Err) return Reject(Err);
              Stream.write(Compressed, (WriteErr) => {
                if (WriteErr) return Reject(WriteErr);
                console.log(`Script sent (${Compressed.length} bytes)`);
                Resolve();
              });
            },
          );
        });
      } catch (Err) {
        Stream.destroy();
        throw new Error(`Error sending script: ${Err.message}`);
      }
    }

    Stream.end();
    return `Successfully connected to Opiumware on port: ${ConnectedPort}`;
  }

  if (executor === "Hydrogen") {
    const HYDRO_PORT = 6969;
    const url = `http://127.0.0.1:${HYDRO_PORT}/execute`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: String(scriptContent || ""),
        timeout: 5000,
      });

      const text = await res.text().catch(() => "");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      return { status: "success", port: HYDRO_PORT, response: text };
    } catch (err) {
      throw new Error(`Hydrogen HTTP send failed: ${err.message}`);
    }
  }
}

function processData(data) {
  let code;
  if (
    data &&
    typeof data === "object" &&
    Object.prototype.hasOwnProperty.call(data, "code")
  ) {
    code = data.code;
  } else {
    code = data;
  }

  if (typeof code !== "string") {
    code = String(code ?? "");
  }

  console.log(code);
  return ligma(code).catch((err) => console.log(err));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    resizable: true,
    minWidth: 1290,
    minHeight: 640,
    width: 1450,
    height: 760,

    vibrancy: "hud",
    visualEffectState: "active",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: !app.isPackaged,
    },
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 27, y: 24 },
    icon: __dirname + "./icon.png",
    title: "Tritium",
  });
  mainWindow.setMenuBarVisibility(false);

  try {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "pasteAndMatchStyle" },
          { role: "delete" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  } catch (e) {
    console.warn("Failed to set application menu:", e);
  }

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (
      input.control &&
      input.shift &&
      input.key.toLowerCase() === "arrowleft"
    ) {
      mainWindow.webContents.goBack();
    } else if (
      input.control &&
      input.shift &&
      input.key.toLowerCase() === "arrowright"
    ) {
      mainWindow.webContents.goForward();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.loadFile("./index.html");
    return { action: "deny" };
  });

  mainWindow.loadFile("./index.html");
}

app.whenReady().then(() => {
  try {
    if (nativeTheme.themeSource !== "dark") nativeTheme.themeSource = "dark";
  } catch (_) {}

  createWindow();
  initializeSpotlight();
  checkForUpdates();

  try {
    nativeTheme.on("updated", () => {
      try {
        if (nativeTheme.themeSource !== "dark")
          nativeTheme.themeSource = "dark";
      } catch (_) {}
      applyDarkVibrancy(_vibrancyEnabledMain, _vibrancyEnabledSpotlight);
    });
  } catch (_) {}

  applyDarkVibrancy(_vibrancyEnabledMain, _vibrancyEnabledSpotlight);

  try {
    globalShortcut.register("Option+.", () => {
      showSpotlight();
    });
  } catch (e) {
    console.error('Failed to register global shortcut "Option+.":', e);
  }

  if (process.platform === "darwin") {
    app.dock.setMenu(
      require("electron").Menu.buildFromTemplate([
        {
          label: "New Window",
          click: () => {
            createWindow();
          },
        },
      ]),
    );
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
