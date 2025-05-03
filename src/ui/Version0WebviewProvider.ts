import * as vscode from 'vscode';
import { ConfigManager } from '../services/configManager';
import { BackupManager } from '../services/backupManager';
import { GithubService } from '../services/githubService';

export class Version0WebviewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'version0.webviewView'; // Unique ID for this view type

	private _view?: vscode.WebviewView;
	private _configManager: ConfigManager;
	private _backupManager: BackupManager;
	private _githubService: GithubService;
	private _extensionUri: vscode.Uri;

	constructor(
		private readonly context: vscode.ExtensionContext,
		configManager: ConfigManager,
		backupManager: BackupManager,
		githubService: GithubService
	) {
		this._extensionUri = context.extensionUri;
		this._configManager = configManager;
		this._backupManager = backupManager;
		this._githubService = githubService;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this._extensionUri, 'media') // If we add CSS/JS files
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		// Handle messages from the webview
		webviewView.webview.onDidReceiveMessage(async message => {
			switch (message.command) {
				case 'saveFrequency':
					const frequency = parseInt(message.text, 10);
					if (!isNaN(frequency) && frequency > 0) {
						this._configManager.setBackupInterval(frequency);
						// Optionally send confirmation back to webview
						this._view?.webview.postMessage({ command: 'frequencySaved', value: frequency });
						vscode.window.showInformationMessage(`Backup frequency set to ${frequency} minutes.`);
					} else {
						vscode.window.showErrorMessage('Invalid frequency value.');
					}
					return;
				case 'saveTargetRepo':
					const repoUrl = message.text;
					if (repoUrl && (repoUrl.startsWith('https://') || repoUrl.includes(':'))) {
						await this._configManager.setTargetBackupRepoUrl(repoUrl);
						this._view?.webview.postMessage({ command: 'targetRepoSaved', value: repoUrl });
						vscode.window.showInformationMessage(`Target backup repository set to ${repoUrl}.`);
					} else {
						vscode.window.showErrorMessage('Invalid repository URL format.');
					}
					return;
				case 'backupNow':
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: "Version0: Running manual backup...",
						cancellable: false
					}, async (progress) => {
						try {
							progress.report({ increment: 0, message: "Starting backup..." });
							await this._backupManager.triggerManualBackup();
							progress.report({ increment: 100, message: "Backup successful!" });
							vscode.window.showInformationMessage('Version0: Manual backup completed successfully.');
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Last backup: ${new Date().toLocaleTimeString()}` });
						} catch (error) {
							vscode.window.showErrorMessage(`Version0: Backup failed: ${(error as Error).message}`);
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Backup failed: ${(error as Error).message}` });
						}
					});
					return;
				case 'getBranches':
					await this.refreshBranches();
					return;
				case 'restoreBackup':
					const branchToRestore = message.branchName;
					if (!branchToRestore) return;

					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: `Version0: Restoring from ${branchToRestore}...`,
						cancellable: false
					}, async (progress) => {
						try {
							progress.report({ increment: 0, message: "Starting restore..." });
							await this._backupManager.restoreFromBackup(branchToRestore);
							progress.report({ increment: 100, message: "Restore successful!" });
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Restored from ${branchToRestore} at ${new Date().toLocaleTimeString()}` });
						} catch (error) {
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Restore failed: ${(error as Error).message}` });
						}
					});
					return;
				case 'triggerAuth':
					console.log('Version0: Received triggerAuth message from webview.');
					try {
						await this._githubService.authenticate();
						// Regardless of success/failure, refresh state and branches
						this.updateWebviewState();
					} catch (error) {
						// Error should be displayed by the authenticate() method itself
						console.error("Error during triggered authentication:", error);
						// Still refresh state, maybe status shows error?
						this.updateWebviewState();
					}
					return;
				case 'pushCurrentBranch':
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: "Version0: Pushing current branch...",
						cancellable: false
					}, async (progress) => {
						try {
							progress.report({ increment: 0, message: "Committing changes..." });
							const result = await this._backupManager.pushCurrentState();
							progress.report({ increment: 100, message: "Push successful!" });
							
							let successMessage = 'Version0: Current branch pushed successfully.';
							let actions: {title: string; command: string; arguments?: any[]}[] = [];

							if (result && result.pullRequestUrl) {
								successMessage = `Pushed branch '${result.branchName}'. Create Pull Request?`;
								actions.push({
									title: "Create Pull Request",
									command: 'vscode.open',
									arguments: [vscode.Uri.parse(result.pullRequestUrl)]
								});
							} else if (result) {
								successMessage = `Version0: Branch '${result.branchName}' pushed successfully.`
							}
							
							vscode.window.showInformationMessage(successMessage, ...actions.map(a => a.title))
								.then(selection => {
									const selectedAction = actions.find(a => a.title === selection);
									if (selectedAction) {
										vscode.commands.executeCommand(selectedAction.command, ...(selectedAction.arguments || []));
									}
								});

							this._view?.webview.postMessage({ command: 'updateStatus', text: `Pushed branch at ${new Date().toLocaleTimeString()}` });
							this.refreshBranches();
						} catch (error) {
							vscode.window.showErrorMessage(`Version0: Push failed: ${(error as Error).message}`);
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Push failed: ${(error as Error).message}` });
						}
					});
					return;
			}
		}, undefined, this.context.subscriptions);

		// Send initial state
		this.updateWebviewState();
	}

	// Helper to fetch and send branches
	public async refreshBranches() {
		if (!this._view) return; // Exit if view is not ready

		this._view.webview.postMessage({ command: 'updateStatus', text: 'Fetching branches...' });
		try {
			const targetUrl = this._configManager.getTargetBackupRepoUrl();
			const prefix = this._configManager.getBranchPrefix();
			if (!targetUrl) {
				this._view.webview.postMessage({ command: 'updateBranches', branches: [] });
				this._view.webview.postMessage({ command: 'updateStatus', text: 'Set target repository URL to list branches.' });
				return;
			}

			if (!await this._githubService.isAuthenticated()) {
				this._view.webview.postMessage({ command: 'updateBranches', branches: [] });
				this._view.webview.postMessage({ command: 'updateStatus', text: 'GitHub Auth Required to list branches.' });
				return;
			}
			const branches = await this._githubService.getBackupBranchesFromTargetUrl(targetUrl, prefix);
			this._view.webview.postMessage({ command: 'updateBranches', branches: branches });
			// Don't override status here, let the webview script do it
		} catch (error) {
			this._view.webview.postMessage({ command: 'updateBranches', branches: [] });
			this._view.webview.postMessage({ command: 'updateStatus', text: `Error fetching branches: ${(error as Error).message}` });
		}
	}

	// Helper to send current state to the webview
	public updateWebviewState() {
		if (this._view) {
			this._view.webview.postMessage({
				command: 'updateState',
				frequency: this._configManager.getBackupInterval(),
				targetRepoUrl: this._configManager.getTargetBackupRepoUrl()
			});
		}
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		// Get URI to script on disk, then convert it to a URI webviews can load
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Version0 Settings</title>
				<style>
					body { font-family: sans-serif; padding: 10px; }
					label { display: block; margin-bottom: 5px; }
					input[type="number"], input[type="text"] { width: 80%; padding: 4px; margin-bottom: 10px; }
					button { padding: 5px 10px; margin-left: 5px; cursor: pointer; margin-bottom: 5px; }
					.setting-row { display: flex; align-items: center; margin-bottom: 15px; }
					.setting-row label { white-space: nowrap; }
					.setting-row input { flex-grow: 1; margin-right: 5px; margin-left: 5px; }
					#status { margin-top: 15px; font-style: italic; font-size: 0.9em; }
					#branch-list-container { margin-top: 20px; }
					#branch-list { list-style: none; padding: 0; max-height: 200px; overflow-y: auto; border: 1px solid #ccc; }
					#branch-list li { padding: 5px; border-bottom: 1px solid #eee; cursor: pointer; font-size: 0.9em; }
					#branch-list li:hover { background-color: #f0f0f0; }
					#branch-list li:last-child { border-bottom: none; }
					.section-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
				</style>
			</head>
			<body>
				<h3>Version0 Backup</h3>

				<div class="setting-row">
					<label for="frequency">Frequency (min):</label>
					<input type="number" id="frequency" value="" min="1">
					<button id="save-frequency">Save</button>
				</div>

				<div class="setting-row">
					<label for="target-repo">Target Repo URL:</label>
					<input type="text" id="target-repo" value="" placeholder="e.g., https://github.com/owner/repo.git">
					<button id="save-target-repo">Save</button>
				</div>

				<button id="backup-now">Backup Now</button>
				<button id="push-current-branch" style="margin-left: 15px;">Push Current Branch</button>

				<div id="branch-list-container">
					<div class="section-title">
						<h4>Backup Branches</h4>
						<button id="refresh-branches" title="Refresh Branch List">&#x21bb;</button>
					</div>
					<ul id="branch-list">
						<li>Loading branches...</li>
					</ul>
				</div>

				<div id="status">Loading...</div>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
} 