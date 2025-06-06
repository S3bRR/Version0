import * as vscode from 'vscode';
import { GithubService } from './services/githubService';
import { BackupManager } from './services/backupManager';
import { ConfigManager } from './services/configManager';
import { Version0WebviewProvider } from './ui/Version0WebviewProvider';

let backupManager: BackupManager | undefined;
let githubService: GithubService | undefined;
let webviewProvider: Version0WebviewProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize services
  const configManager = new ConfigManager(context);
  githubService = new GithubService(configManager);
  backupManager = new BackupManager(githubService, configManager);
  
  // Initialize new Webview Provider, passing GithubService as well
  webviewProvider = new Version0WebviewProvider(context, configManager, backupManager, githubService);

  // Register the Webview Provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(Version0WebviewProvider.viewType, webviewProvider)
  );
  
  // Register commands
  const startCommand = vscode.commands.registerCommand('version0.start', () => {
    backupManager?.start();
    vscode.window.showInformationMessage('Version0 backup service started');
    webviewProvider?.updateWebviewState();
  });

  const triggerBackupCommand = vscode.commands.registerCommand('version0.triggerBackup', async () => {
    vscode.window.showInformationMessage('Please use the "Backup Now" button in the Version0 sidebar view.');
  });

  const restoreLatestCommand = vscode.commands.registerCommand('version0.restoreLatestBackup', async () => {
    try {
      await backupManager?.restoreLatestBackup();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Version0: ${err.message}`);
    }
  });
  
  // Register disposables
  context.subscriptions.push(
    startCommand,
    triggerBackupCommand,
    restoreLatestCommand,
    githubService
  );
  
  // Auto-start if configured
  if (configManager.getAutoStart()) {
    backupManager?.start();
  }

  // Listen for configuration changes to update the webview
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('version0')) {
            webviewProvider?.updateWebviewState();
            if (e.affectsConfiguration('version0.backupInterval')) {
                backupManager?.restartTimer();
            }
        }
    })
  );
  
  console.log('Version0 GitHub backup extension is now active with Webview UI');
}

export function deactivate() {
  console.log('Version0 GitHub backup extension deactivated');
  backupManager?.stop();
  backupManager = undefined;
  githubService = undefined;
  webviewProvider = undefined;
} 