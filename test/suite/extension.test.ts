import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Starting extension tests');

  test('Extension should be present', () => {
    assert.ok(vscode.extensions.getExtension('v0Design.version0'));
  });

  test('Extension should activate', async () => {
    const extension = vscode.extensions.getExtension('v0Design.version0');
    if (!extension) {
      assert.fail('Extension not found');
      return;
    }
    
    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });

  test('Commands should be registered', async () => {
    const commands = await vscode.commands.getCommands();
    
    assert.ok(commands.includes('version0.start'), 'Start command not registered');
    assert.ok(commands.includes('version0.triggerBackup'), 'Trigger backup command not registered');
    assert.ok(commands.includes('version0.restoreLatestBackup'), 'Restore latest command not registered');
  });
}); 