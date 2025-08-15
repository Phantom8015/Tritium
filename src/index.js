const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
} = require("electron");
const sudo = require("sudo-prompt");
const fs = require("fs");
const path = require("path");
const os = require("os");
const fetch = require("node-fetch");
const { version: currentVersion } = require("./package.json");
const { exec } = require("child_process");
const START_PORT = 5553;
const END_PORT = 5563;
const net = require("net");
let mainWindow = null;
let serverPort = null;
let lastError = null;
let localStorage = require("electron-localstorage");
let spotlightWindow = null;

function runMacSploitInstall() {
  return new Promise((resolve, reject) => {
    const sentinel = path.join(os.tmpdir(), "macsploit_install_done");
    try {
      if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    } catch (_) {}

    const applescriptPath = path.join(os.tmpdir(), "macsploit_install.scpt");
    const bashCmd =
      'cd ~ && curl -s "https://git.raptor.fun/user/install.sh" | bash </dev/tty; echo $? > ' +
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
                  message:
                    "MacSploit installation finished successfully.",
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
  const logWatcher = require("./logWatcher.js");
  return logWatcher.start(mainWindow);
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

    await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "MacSploit Update Complete",
      message:
        "MacSploit has been updated successfully. The application will now restart.",
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

  spotlightWindow.on("blur", () => {
    if (
      spotlightWindow &&
      !spotlightWindow.isDestroyed() &&
      spotlightWindow.isVisible()
    ) {
      const devToolsWebContents =
        spotlightWindow.webContents.devToolsWebContents;

      if (!(devToolsWebContents && devToolsWebContents.isFocused())) {
        spotlightWindow.hide();
      }
    }
  });
}
function buildMessage(type, bodyString = "") {
  const bodyBuffer = Buffer.from(bodyString + "\0", "utf8");
  const header = Buffer.alloc(16);
  header.writeUInt8(type, 0);
  header.writeBigUInt64LE(BigInt(bodyBuffer.length), 8);
  return Buffer.concat([header, bodyBuffer]);
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
  spotlightWindow = null;
});

ipcMain.on("set-vibrancy", (event, enableVibrancy) => {
  if (mainWindow) {
    mainWindow.setVibrancy(enableVibrancy ? "under-window" : null);
  }
});

ipcMain.on("set-spvibrancy", (event, enableVibrancy) => {
  if (spotlightWindow) {
    spotlightWindow.setVibrancy(enableVibrancy ? "under-window" : null);
  }
});

async function ligma(scriptContent) {
  for (let port = START_PORT; port <= END_PORT; port++) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
          serverPort = port;
          socket.destroy();
          resolve();
        });
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
      console.log("F12 in Roblox to see script activity.");
    })
    .setTimeout(3000);
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
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      devTools: !app.isPackaged,
    },
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 27, y: 27 },
    icon: __dirname + "./icon.png",
    title: "Tritium",
  });
  mainWindow.setMenuBarVisibility(false);

  try {
    const { Menu } = require("electron");
    const isMac = process.platform === "darwin";
    const template = [
      ...(isMac
        ? [
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
          ]
        : []),
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
  createWindow();
  initializeSpotlight();
  checkForUpdates();

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
