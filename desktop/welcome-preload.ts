// The bridge of the desktop app's welcome window (ADR 0177): the page is the app itself, on an empty canvas kept in memory, and may
// only ask for the choices and give the one taken (src/ui/welcome-screen.ts). Nothing of a workspace, the disk or the system is reached.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("canvastWelcome", {
  choices: () => ipcRenderer.invoke("canvast:welcomeChoices"),
  choose: (choice: string) => ipcRenderer.invoke("canvast:welcomeChoose", String(choice)),
});
