import * as vscode from 'vscode';

export class ConfigManager {
  private context: vscode.ExtensionContext;
  private configuration: vscode.WorkspaceConfiguration;

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
    return await this.context.secrets.get('version0.githubToken');
  }
  
  async setGitHubToken(token: string): Promise<void> {
    await this.context.secrets.store('version0.githubToken', token);
  }
  
  // Target Repository Setting
  getTargetBackupRepoUrl(): string | undefined {
    return this.configuration.get<string>('targetBackupRepoUrl') || undefined;
  }

  async setTargetBackupRepoUrl(url: string): Promise<void> {
    await this.configuration.update('targetBackupRepoUrl', url, vscode.ConfigurationTarget.Global);
  }
  
  // Settings getters
  getBackupInterval(): number {
    return this.configuration.get<number>('backupInterval') || 10;
  }
  
  getBranchPrefix(): string {
    return this.configuration.get<string>('branchPrefix') || 'backup';
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
  
  async setBranchPrefix(prefix: string): Promise<void> {
    await this.configuration.update('branchPrefix', prefix, vscode.ConfigurationTarget.Global);
  }
  
  async setEnableNotifications(enable: boolean): Promise<void> {
    await this.configuration.update('enableNotifications', enable, vscode.ConfigurationTarget.Global);
  }
  
  async setAutoStart(enable: boolean): Promise<void> {
    await this.configuration.update('autoStart', enable, vscode.ConfigurationTarget.Global);
  }
} 