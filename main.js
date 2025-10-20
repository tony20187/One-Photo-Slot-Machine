const { app, BrowserWindow } = require("electron");
const path = require("path");

let win;

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: true,               // ✅ 保留原生狀態列（三顆系統鈕）
    autoHideMenuBar: true,     // 只藏功能表，不影響標題列
    show: false,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: { contextIsolation: true }
  });

  win.loadFile(path.join(__dirname, "index.html"));

  // ✅ 一開啟自動「最大化」（看起來像全螢幕，但保留原生狀態列）
  win.once("ready-to-show", () => {
    win.show();
    win.maximize();
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

