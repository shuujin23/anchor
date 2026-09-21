import { contextBridge, ipcRenderer } from 'electron';
const commands = new Set(['status','setup','unlock','lock','activity','credentials','credential','saveCredential','deleteCredential','copySecret','generatePassword','reminders','saveReminder','reminderAction','deleteReminder','history','settings','saveSettings','testWindows','testDiscord','exportBackup','importBackup','pickBackupFolder','saveAutomaticBackup','automaticBackupNow']);
contextBridge.exposeInMainWorld('anchor',{
  call:async (command: string,arg?: unknown) => {
    if (!commands.has(command)) throw new Error('Perintah tidak dikenal.');
    const result = await ipcRenderer.invoke('anchor',command,arg);
    if (!result.ok) throw new Error(result.error); return result.data;
  },
  onLock:(callback: () => void) => { const listener = () => callback(); ipcRenderer.on('vault-locked',listener); return () => ipcRenderer.removeListener('vault-locked',listener); }
});
