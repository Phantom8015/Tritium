const fs = require("fs");
const path = require("path");
const chokidar = require("chokidar");

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

function start(mainWindow) {
  switchToNewLogFile(mainWindow);

  checkLogInterval = setInterval(() => {
    switchToNewLogFile(mainWindow);
  }, 5000);

  return { success: true, path: currentLogPath };
}

function stop() {
  if (watcher) {
    watcher.close();
  }
  if (checkLogInterval) {
    clearInterval(checkLogInterval);
  }
}

module.exports = { start, stop };
