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
						this.refreshBranches();
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
							this.refreshBranches();
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
				case 'requestRestore': // New case to handle confirmation
					const branchToRequestRestore = message.branchName;
					if (!branchToRequestRestore) return;

					// Show VS Code native confirmation
					const confirmation = await vscode.window.showWarningMessage(
						`Restore workspace to backup branch '${branchToRequestRestore}'? This will overwrite local changes and requires a workspace reload.`,
						{ modal: true }, // Make it modal
						'Restore' // Confirmation button text
					);

					if (confirmation === 'Restore') {
						// User confirmed, proceed with restore
						vscode.window.withProgress({
							location: vscode.ProgressLocation.Notification,
							title: `Version0: Restoring from ${branchToRequestRestore}...`,
							cancellable: false
						}, async (progress) => {
							try {
								progress.report({ increment: 0, message: "Starting restore..." });
								await this._backupManager.restoreFromBackup(branchToRequestRestore);
								progress.report({ increment: 100, message: "Restore successful!" });
								// It's often good practice to reload the window after a restore
								// to ensure all file states and UI elements are updated correctly.
								vscode.window.showInformationMessage(`Restored from ${branchToRequestRestore}. Reload window to see changes?`, "Reload Window")
									.then(selection => {
										if (selection === "Reload Window") {
											vscode.commands.executeCommand('workbench.action.reloadWindow');
										}
									});
								this._view?.webview.postMessage({ command: 'updateStatus', text: `Restored from ${branchToRequestRestore} at ${new Date().toLocaleTimeString()}` });
							} catch (error) {
								this._view?.webview.postMessage({ command: 'updateStatus', text: `Restore failed: ${(error as Error).message}` });
								// Keep the error message from BackupManager being shown too
							}
						});
					} else {
						// User cancelled
						this._view?.webview.postMessage({ command: 'updateStatus', text: 'Restore cancelled.' });
					}
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
			if (!targetUrl) {
				this._view.webview.postMessage({ command: 'updateBranches', branches: [] });
				this._view.webview.postMessage({ command: 'updateStatus', text: 'Set target repository URL to list branches.' });
				return;
			}

			const isAuthenticated = await this._githubService.isAuthenticated();
			if (!isAuthenticated) {
				this._view.webview.postMessage({ command: 'updateBranches', branches: [] });
				this._view.webview.postMessage({ command: 'updateStatus', text: 'GitHub Auth Required to list branches.' });
				return;
			}
			const branches = await this._githubService.getBackupBranchesFromTargetUrl(targetUrl);

			this._view.webview.postMessage({ command: 'updateBranches', branches: branches });
			// Don't override status here, let the webview script do it
		} catch (error) {
			console.error('[WebviewProvider] Error refreshing branches:', error);
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

		// Get URI for toolkit
		const toolkitUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/webview-ui-toolkit', 'dist', 'toolkit.js')); // Assuming installed
		// OR Use CDN - Simpler for now if toolkit not bundled
		// const toolkitUri = "https://unpkg.com/@vscode/webview-ui-toolkit@latest"; // Requires network

		// Use a nonce to only allow specific scripts to be run
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!-- Use a content security policy to only allow loading specific resources -->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				
				<!-- If installed via npm:
				<script type="module" nonce="${nonce}" src="${toolkitUri}"></script> 
				-->
				 <!-- Using CDN requires adjusting CSP script-src if needed -->
				 <script type="module" nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/@vscode/webview-ui-toolkit@1/dist/toolkit.min.js"></script>

				<title>Version0 Backup</title>
				<style>
					/* Basic Reset & Body */
					body {
						font-family: var(--vscode-font-family);
						color: var(--vscode-foreground);
						background-color: var(--vscode-sideBar-background);
						padding: 10px 15px;
						box-sizing: border-box;
					}
					h3, h4 {
						color: var(--vscode-sideBar-titleForeground);
						margin-top: 10px;
						margin-bottom: 8px;
					}
					/* Layout */
					.container {
						display: flex;
						flex-direction: column;
						gap: 15px; /* Space between sections */
					}
					.setting-row {
						display: flex;
						align-items: center;
						gap: 8px; /* Space within a row */
						margin-bottom: 8px;
					}
					.setting-row label {
						white-space: nowrap;
						font-size: var(--vscode-font-size);
					}
					 /* Make text field take available space */
					vscode-text-field {
						flex-grow: 1;
					}
					 /* Buttons */
					.button-group {
						display: flex;
						gap: 8px;
						margin-top: 5px;
					}
					vscode-button {
						/* Default button styling is usually fine */
						min-width: 60px; /* Prevent tiny save buttons */
					}
					 vscode-button[appearance="secondary"] {
						 /* Style secondary buttons if needed */
					 }
					#auth-button-container {
						 margin-top: 10px;
					 }
					/* Branch List */
					#branch-list-container {
						margin-top: 10px;
					}
					.section-title {
						display: flex;
						justify-content: space-between;
						align-items: center;
						margin-bottom: 5px;
						border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
						padding-bottom: 4px;
					}
					.section-title h4 {
						 margin: 0;
					 }
					#refresh-branches {
						/* Style refresh as an icon button if possible or smaller */
						min-width: auto;
						padding: 2px 6px;
					}
					#branch-list {
						list-style: none;
						padding: 5px;
						margin: 0;
						max-height: 200px;
						overflow-y: auto;
						border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder));
						border-radius: var(--input-corner-radius, 3px); 
						background: var(--vscode-input-background);
					}
					#branch-list li {
						padding: 6px 8px;
						border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
						cursor: pointer;
						font-size: var(--vscode-font-size);
						color: var(--vscode-foreground);
						overflow: hidden;
						text-overflow: ellipsis;
						white-space: nowrap;
					}
					#branch-list li:hover {
						background-color: var(--vscode-list-hoverBackground);
						color: var(--vscode-list-hoverForeground);
					}
					#branch-list li:last-child {
						border-bottom: none;
					}
					/* Status Area */
					#status {
						margin-top: 15px;
						font-style: italic;
						font-size: calc(var(--vscode-font-size) * 0.9);
						color: var(--vscode-descriptionForeground);
					}
				</style>
			</head>
			<body>
				<div class="container">
					<div class="setting-row">
						<label for="frequency">Frequency (min):</label>
						<vscode-text-field type="number" id="frequency" value="" min="1"></vscode-text-field>
						<vscode-button appearance="secondary" id="save-frequency">Save</vscode-button>
					</div>

					<div class="setting-row">
						<label for="target-repo">Target Repo URL:</label>
						<vscode-text-field id="target-repo" value="" placeholder="e.g., https://github.com/owner/repo.git"></vscode-text-field>
						<vscode-button appearance="secondary" id="save-target-repo">Save</vscode-button>
					</div>

					<div class="button-group">
						<vscode-button id="backup-now">Backup Now</vscode-button>
						<vscode-button id="push-current-branch">Push Current Branch</vscode-button>
					</div>

					<div id="branch-list-container">
						<div class="section-title">
							<h4>Backup Branches</h4>
							<vscode-button appearance="icon" id="refresh-branches" title="Refresh Branch List">
								<span class="codicon codicon-refresh"></span> <!-- Requires CSP adjustment for codicon font -->
							</vscode-button>
						</div>
						<ul id="branch-list">
							<li>Loading branches...</li>
						</ul>
					</div>

					<div id="auth-button-container" style="display: none;">
						<vscode-button appearance="primary" id="auth-button">Authenticate with GitHub</vscode-button>
					</div>

					<div id="status">Loading...</div>
				</div>

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