// main.js
const { app, BrowserWindow, screen, ipcMain, Tray, Menu } = require("electron");
const path = require("path");

let tray = null;

function createWindow() {
  // Pega as dimensões da tela principal
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 80, // Largura do personagem (aprox 26 * 3)
    height: 130, // Altura do personagem (aprox 43 * 3)
    transparent: true, // Deixa a janela transparente
    frame: false, // Remove a barra de título, menu, etc.
    alwaysOnTop: true, // Mantém a janela sempre na frente
    hasShadow: false, // Remove sombra que pode causar artefatos visuais
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
      offscreen: false,
      enableWebSQL: false,
      webgl: false, // Desabilita WebGL que pode causar problemas de rendering
    },
    // Faz com que a janela não apareça na barra de tarefas do Windows
    skipTaskbar: true,
  });

  // Desabilita aceleração de hardware que pode causar clipping
  win.webContents.session.clearCache();

  // Define background color como transparente
  win.setBackgroundColor("#00000000");

  // GARANTE QUE FIQUE ACIMA DA BARRA DE TAREFAS
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Re-aplica alwaysOnTop periodicamente para evitar que a taskbar cubra
  setInterval(() => {
    win.setAlwaysOnTop(true, "screen-saver");
  }, 2000);

  // Re-aplica ao perder foco
  win.on("blur", () => {
    win.setAlwaysOnTop(true, "screen-saver");
  });

  // Carrega o nosso HTML
  win.loadFile("index.html");

  // Posiciona o personagem inicialmente no canto inferior direito, acima da barra de tarefas
  const characterHeight = 100;
  win.setPosition(width - 100, height - characterHeight);

  // Cria o ícone no system tray
  const iconPath = path.join(__dirname, "assets", "susie_icon.png");
  tray = new Tray(iconPath);

  // Menu de contexto do tray
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Susie Desktop",
      enabled: false,
    },
    {
      type: "separator",
    },
    {
      label: "Terminate Susie :(",
      click: () => {
        app.quit();
      },
    },
    {
      label: "About",
      click: () => {
        const { dialog } = require("electron");
        dialog.showMessageBox(win, {
          type: "info",
          title: "About",
          message: "Feito por Jordão Quirino\nPara meu amor, Leli <3.",
          buttons: ["Close"],
        });
      },
    },
  ]);

  tray.setToolTip("Susie - Desktop Friend");
  tray.setContextMenu(contextMenu);

  // --- IPC handlers para o renderer pedir informações/operar na janela ---
  ipcMain.handle("get-screen-info", () => {
    return screen.getPrimaryDisplay();
  });

  ipcMain.handle("get-window-position", () => {
    return win.getPosition();
  });

  ipcMain.on("set-window-position", (event, x, y) => {
    // Garante valores inteiros para evitar subpixel rendering
    const intX = Math.round(x);
    const intY = Math.round(y);
    // Usa setPosition para melhor performance (evita overhead de resize do setBounds)
    win.setPosition(intX, intY, false);
  });

  ipcMain.on("set-window-size", (event, width, height) => {
    const intWidth = Math.round(width);
    const intHeight = Math.round(height);
    const [x, y] = win.getPosition();
    win.setBounds({ x, y, width: intWidth, height: intHeight }, false);
  });

  ipcMain.handle("get-window-bounds", () => {
    return win.getBounds();
  });
}

app.disableHardwareAcceleration();
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
