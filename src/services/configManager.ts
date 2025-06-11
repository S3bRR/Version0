import * as vscode from 'vscode';

export class ConfigManager {
  private context: vscode.ExtensionContext;
  private configuration: vscode.WorkspaceConfiguration;
  private sessionTargetRepoUrl: string | undefined = undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.configuration = vscode.workspace.getConfiguration('version0');
    
    // Listen for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('version0')) {
          this.configuration = vscode.workspace.getConfiguration('version0');
        }
      })
    );
  }
  
  // GitHub Token management
  async getGitHubToken(): Promise<string | undefined> {
    const token = await this.context.secrets.get('version0.githubToken');
    if (!token || token.trim() === '') return undefined;
    return token;
  }
  
  async setGitHubToken(token: string): Promise<void> {
    await this.context.secrets.store('version0.githubToken', token);
  }
  
  // Target Repository Setting (Session-only)
  getTargetBackupRepoUrl(): string | undefined {
    return this.sessionTargetRepoUrl;
  }

  async setTargetBackupRepoUrl(url: string): Promise<void> {
    // Store only in session, not in persistent configuration
    this.sessionTargetRepoUrl = url;
  }
  
  // Settings getters
  getBackupInterval(): number {
    return this.configuration.get<number>('backupInterval') || 9999;
  }
  
  getEnableNotifications(): boolean {
    return this.configuration.get<boolean>('enableNotifications') || true;
  }
  
  getAutoStart(): boolean {
    return this.configuration.get<boolean>('autoStart') || false;
  }
  
  // Settings setters
  async setBackupInterval(interval: number): Promise<void> {
    await this.configuration.update('backupInterval', interval, vscode.ConfigurationTarget.Global);
  }
  
  async setEnableNotifications(enable: boolean): Promise<void> {
    await this.configuration.update('enableNotifications', enable, vscode.ConfigurationTarget.Global);
  }
  
  async setAutoStart(enable: boolean): Promise<void> {
    await this.configuration.update('autoStart', enable, vscode.ConfigurationTarget.Global);
  }
} 