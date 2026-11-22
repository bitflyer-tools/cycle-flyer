const { spawn } = require('node:child_process');
const { win32: path } = require('node:path');

module.exports = function handleSquirrelStartup(app, { platform, argv, execPath }) {
  if (platform !== 'win32') return false;

  switch (argv[1]) {
    case '--squirrel-install':
    case '--squirrel-updated':
      updateShortcut(app, execPath, '--createShortcut');
      return true;
    case '--squirrel-uninstall':
      updateShortcut(app, execPath, '--removeShortcut');
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
    default:
      return false;
  }
};

function updateShortcut(app, execPath, command) {
  const updater = path.resolve(path.dirname(execPath), '..', 'Update.exe');
  const child = spawn(updater, [`${command}=${path.basename(execPath)}`], { detached: true });
  child.once('error', (error) => console.error('Could not start Squirrel Update.exe:', error));
  child.once('close', () => app.quit());
}
