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
				case 'createRepo':
					const repoNameToCreate = message.name;
					if (!repoNameToCreate) {
						vscode.window.showErrorMessage('Repository name cannot be empty.');
						this._view?.webview.postMessage({ command: 'updateStatus', text: 'Repository creation failed: Name empty.' });
						return;
					}
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: `Version0: Creating GitHub repository '${repoNameToCreate}'...`,
						cancellable: false
					}, async (progress) => {
						progress.report({ increment: 0, message: "Initiating creation..." });
						const result = await this._githubService.createPrivateRepository(repoNameToCreate);
						if (result.url) {
							progress.report({ increment: 100, message: "Repository created!" });
							await this._configManager.setTargetBackupRepoUrl(result.url);
							vscode.window.showInformationMessage(`Successfully created private repository: ${result.url}`);
							this._view?.webview.postMessage({ command: 'repoCreated', newUrl: result.url, message: `Repository ${repoNameToCreate} created. Target URL updated.` });
							this.refreshBranches(); // Refresh branches as the target repo has changed
						} else {
							vscode.window.showErrorMessage(`Failed to create repository: ${result.error}`);
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Repo creation failed: ${result.error}` });
						}
					});
					return;
				case 'syncRepo':
					vscode.window.withProgress({
						location: vscode.ProgressLocation.Notification,
						title: "Version0: Syncing repository status...",
						cancellable: false
					}, async (progress) => {
						progress.report({ increment: 0, message: "Checking authentication..." });
						const isAuthenticated = await this._githubService.isAuthenticated();
						if (!isAuthenticated) {
							vscode.window.showErrorMessage('GitHub authentication required. Please authenticate first.');
							this._view?.webview.postMessage({ command: 'updateStatus', text: 'Sync failed: GitHub authentication required.' });
							// Attempt to trigger authentication
							try {
								const authSuccess = await this._githubService.authenticate();
								if (authSuccess) {
									this.updateAuthStatus(); // Update global UI auth state
									this._view?.webview.postMessage({ command: 'updateStatus', text: 'Authenticated successfully. Continuing sync...' });
									// Do NOT return, allow to proceed with sync
								} else {
									this._view?.webview.postMessage({ command: 'updateStatus', text: 'Authentication failed. Please try Sync again after authenticating.' });
									return; // Return if auth failed
								}
							} catch (authError) {
								this._view?.webview.postMessage({ command: 'updateStatus', text: 'Authentication process failed.' });
								return; // Return on auth error
							}
							// If authSuccess was true, we fall through here
						}

						progress.report({ increment: 30, message: "Checking target repository URL..." });
						const currentTargetRepoUrl = this._configManager.getTargetBackupRepoUrl();
						if (!currentTargetRepoUrl) {
							vscode.window.showWarningMessage('Target backup repository URL is not set. Please set it first.');
							this._view?.webview.postMessage({ command: 'updateStatus', text: 'Sync failed: Target repository URL is not set.' });
							return;
						}

						progress.report({ increment: 60, message: "Checking repository access..." });
						const accessResult = await this._githubService.checkRepositoryAccess(currentTargetRepoUrl);
						if (accessResult.status === 'success') {
							progress.report({ increment: 100, message: "Sync successful!" });
							vscode.window.showInformationMessage(`Sync successful: ${accessResult.message}`);
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Sync: ${accessResult.message}` });
							this.refreshBranches(); // Good to refresh branches on successful sync
						} else {
							vscode.window.showErrorMessage(`Sync failed: ${accessResult.message}`);
							this._view?.webview.postMessage({ command: 'updateStatus', text: `Sync failed: ${accessResult.message}` });
						}
					});
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
				case 'setGitHubToken':
					if (message.token && message.token.trim() !== '') {
						await this._githubService.setToken(message.token.trim());
						vscode.window.showInformationMessage('GitHub token saved.');
						this.updateAuthStatus();
					} else {
						vscode.window.showErrorMessage('Token cannot be empty.');
					}
					return;
				case 'clearGitHubToken':
					await this._githubService.clearToken();
					vscode.window.showInformationMessage('GitHub token removed.');
					this.updateAuthStatus();
					return;
				case 'githubLogin':
					// Trigger VS Code GitHub authentication session
					try {
						const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
						if (session && this._view) {
							await this._githubService.setToken(session.accessToken);
							vscode.window.showInformationMessage('GitHub authenticated.');
							this.updateAuthStatus();
						}
					} catch (error) {
						vscode.window.showErrorMessage('GitHub login failed.');
					}
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
		this.updateAuthStatus();
	}

	// Helper to fetch and send branches
	public async refreshBranches() {
		if (!this._view) return; // Exit if view is not ready
		console.log('[WebviewProvider] refreshBranches called.');

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

	private async updateAuthStatus() {
		if (!this._view) return;
		const isAuthenticated = await this._githubService.isAuthenticated();
		let status = 'Not connected';
		let user = '';
		if (isAuthenticated) {
			try {
				const octokit = (this._githubService as any).octokit;
				if (octokit) {
					const { data } = await octokit.users.getAuthenticated();
					user = data.login;
					status = 'Connected as ' + user;
				}
			} catch {
				status = 'Connected (user unknown)';
			}
		}
		this._view.webview.postMessage({ command: 'updateAuthStatus', status, user, isAuthenticated });
	}

	private _getHtmlForWebview(webview: vscode.Webview): string {
		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		const nonce = getNonce();
		const currentFrequency = this._configManager.getBackupInterval();
		const currentTargetRepoUrl = this._configManager.getTargetBackupRepoUrl() || '';

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				
				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>Version0 Controls</title>
				<style>
					.form-container {
						display: flex;
						flex-direction: column;
						gap: 1.2em;
					}
					.vertical-form-group {
						display: flex;
						flex-direction: column;
						align-items: stretch;
						margin-bottom: 0.5em;
					}
					.vertical-form-group label {
						margin-bottom: 0.2em;
					}
					.vertical-form-group input {
						margin-bottom: 0.4em;
					}
					.vertical-form-group button {
						align-self: flex-start;
					}
					@media (max-width: 600px) {
						.button-group {
							flex-direction: column;
							gap: 0.5em;
						}
					}
				</style>
			</head>
			<body>
				<h2>VERSION0</h2>
				
				<div class="form-container">
					<div class="vertical-form-group">
						<label for="frequency">Frequency (min):</label>
						<input type="number" id="frequency" value="${currentFrequency}" min="1">
						<button id="saveFrequencyBtn">Save</button>
					</div>

					<div class="vertical-form-group">
						<label for="targetRepo">Target Repo URL:</label>
						<input type="text" id="targetRepo" value="${currentTargetRepoUrl}" placeholder="e.g., https://github.com/user/repo.git">
						<button id="saveTargetRepoBtn">Save</button>
					</div>
					
					<div class="button-group">
						<button id="createRepoBtn">Create Private Repo</button>
						<button id="syncRepoBtn">Sync</button>
					</div>

					<div class="button-group">
						<button id="backupNowBtn">Backup Now</button>
						<button id="pushCurrentBranchBtn">Push Current Branch</button>
					</div>

					<h3>Backup Branches</h3>
					<div id="branchesContainer">Loading branches...</div>
					
					<div id="status">Ready</div>

					<div class="auth-section">
						<h3>GitHub Authentication</h3>
						<div id="github-auth-status">Checking...</div>
						<button id="connect-github-btn">Connect with GitHub</button>
						<div id="device-code-instructions" style="display:none;"></div>
						<div class="auth-help">
							<small>Connect your GitHub account to enable backup.</small>
						</div>
					</div>
				</div>

				<!-- Modal for creating repository -->
				<div id="createRepoModal" class="modal" style="display:none;">
				  <div class="modal-content">
				    <h4>Create New Private Repository</h4>
				    <label for="newRepoNameInput">Repository Name:</label>
				    <input type="text" id="newRepoNameInput" placeholder="my-new-backup-repo">
				    <div class="modal-buttons">
				      <button id="confirmCreateRepoBtn">Create</button>
				      <button id="cancelCreateRepoBtn">Cancel</button>
				    </div>
				  </div>
				</div>

				<script nonce="${nonce}">
					const vscode = acquireVsCodeApi();

					// Declare variables at the top level of the script
					let frequencyInput;
					let saveFrequencyBtn;
					let targetRepoInput;
					let saveTargetRepoBtn;
					let backupNowBtn;
					let pushCurrentBranchBtn;

					let createRepoBtn;
					let syncRepoBtn;
					let branchesContainer;
					let statusDiv;

					let createRepoModal;
					let newRepoNameInput;
					let confirmCreateRepoBtn;
					let cancelCreateRepoBtn;

					let connectBtn;
					let authStatus;
					let deviceCodeInstructions;

					// State object, initialized with current config values
					let state = vscode.getState() || {
						frequency: ${currentFrequency},
						targetRepoUrl: "${currentTargetRepoUrl}"
					};

					// Wait for the DOM to be fully loaded before accessing elements
					document.addEventListener('DOMContentLoaded', () => {
						// Get references to UI elements after DOM is loaded
						frequencyInput = document.getElementById('frequency');
						saveFrequencyBtn = document.getElementById('saveFrequencyBtn');
						targetRepoInput = document.getElementById('targetRepo');
						saveTargetRepoBtn = document.getElementById('saveTargetRepoBtn');
						backupNowBtn = document.getElementById('backupNowBtn');
						pushCurrentBranchBtn = document.getElementById('pushCurrentBranchBtn');

						createRepoBtn = document.getElementById('createRepoBtn');
						syncRepoBtn = document.getElementById('syncRepoBtn');
						branchesContainer = document.getElementById('branchesContainer');
						statusDiv = document.getElementById('status');

						createRepoModal = document.getElementById('createRepoModal');
						newRepoNameInput = document.getElementById('newRepoNameInput');
						confirmCreateRepoBtn = document.getElementById('confirmCreateRepoBtn');
						cancelCreateRepoBtn = document.getElementById('cancelCreateRepoBtn');

						connectBtn = document.getElementById('connect-github-btn');
						authStatus = document.getElementById('github-auth-status');
						deviceCodeInstructions = document.getElementById('device-code-instructions');

						// Initialize inputs from state
						if(frequencyInput) frequencyInput.value = state.frequency;
						if(targetRepoInput) targetRepoInput.value = state.targetRepoUrl;

						// Add event listeners
						if(saveFrequencyBtn) {
							saveFrequencyBtn.addEventListener('click', () => {
								if(frequencyInput) {
									vscode.postMessage({ command: 'saveFrequency', text: frequencyInput.value });
								}
							});
						}

						if(saveTargetRepoBtn) {
							saveTargetRepoBtn.addEventListener('click', () => {
								if(targetRepoInput) {
									vscode.postMessage({ command: 'saveTargetRepo', text: targetRepoInput.value });
								}
							});
						}

						if(createRepoBtn) {
							createRepoBtn.addEventListener('click', () => {
								if(newRepoNameInput) newRepoNameInput.value = '';
								if(createRepoModal) createRepoModal.style.display = 'flex';
								if(newRepoNameInput) newRepoNameInput.focus();
							});
						}

						if(confirmCreateRepoBtn) {
							confirmCreateRepoBtn.addEventListener('click', () => {
								const repoName = newRepoNameInput ? newRepoNameInput.value : '';
								if (repoName && repoName.trim() !== '') {
									vscode.postMessage({ command: 'createRepo', name: repoName.trim() });
									if(statusDiv) statusDiv.textContent = 'Creating repository...';
									if(createRepoModal) createRepoModal.style.display = 'none';
								} else {
									if(statusDiv) statusDiv.textContent = 'Repository name cannot be empty.';
								}
							});
						}

						if(cancelCreateRepoBtn) {
							cancelCreateRepoBtn.addEventListener('click', () => {
								if(createRepoModal) createRepoModal.style.display = 'none';
								if(statusDiv) statusDiv.textContent = 'Create repository cancelled.';
							});
						}

						if(syncRepoBtn) {
							syncRepoBtn.addEventListener('click', () => {
								vscode.postMessage({ command: 'syncRepo' });
								if(statusDiv) statusDiv.textContent = 'Syncing...';
							});
						}

						if(backupNowBtn) {
							backupNowBtn.addEventListener('click', () => {
								vscode.postMessage({ command: 'backupNow' });
								if(statusDiv) statusDiv.textContent = 'Starting manual backup...';
							});
						}

						if(pushCurrentBranchBtn) {
							pushCurrentBranchBtn.addEventListener('click', () => {
								vscode.postMessage({ command: 'pushCurrentBranch' });
								if(statusDiv) statusDiv.textContent = 'Pushing current branch...';
							});
						}

						// GitHub Connect button event listener
						if (connectBtn) {
							connectBtn.addEventListener('click', () => {
								// Trigger GitHub login with VS Code authentication
								vscode.postMessage({ command: 'githubLogin' });
							});
						}

						// Initial branches load if target repo is set
						if (targetRepoInput && targetRepoInput.value) {
							vscode.postMessage({ command: 'getBranches' });
						} else {
							if(statusDiv) statusDiv.textContent = 'Ready. Configure target repository.';
							if(branchesContainer) branchesContainer.textContent = 'Set target repository URL to see branches.';
						}
					});

					// Message event listener from extension backend
					window.addEventListener('message', event => {
						const message = event.data;

						// Handle device code flow messages
						if (message.type === 'github-auth-status') {
							if (connectBtn && authStatus && deviceCodeInstructions) {
								if (message.authenticated) {
									connectBtn.style.display = 'none';
									deviceCodeInstructions.style.display = 'none';
									authStatus.textContent = 'Connected as ' + message.username;
								} else {
									connectBtn.style.display = '';
									deviceCodeInstructions.style.display = 'none';
									authStatus.textContent = 'Not connected to GitHub.';
								}
								if(frequencyInput) frequencyInput.value = message.value;
								if(statusDiv) statusDiv.textContent = 'Frequency saved.';
								state.frequency = message.value;
								vscode.setState(state);
							}
						} else if (message.type === 'targetRepoSaved') {
							if(targetRepoInput) targetRepoInput.value = message.value;
							if(statusDiv) statusDiv.textContent = 'Target repository saved.';
							state.targetRepoUrl = message.value;
							vscode.setState(state);
						} else if (message.type === 'repoCreated') {
							if(targetRepoInput) targetRepoInput.value = message.newUrl;
							if(statusDiv) statusDiv.textContent = message.message || 'Repository created and target URL updated.';
							state.targetRepoUrl = message.newUrl;
							vscode.setState(state);
						} else if (message.type === 'updateBranches') {
							if(branchesContainer) branchesContainer.innerHTML = '';
							if (message.branches && message.branches.length > 0) {
								const ul = document.createElement('ul');
								message.branches.forEach(branch => {
									const li = document.createElement('li');
									li.textContent = branch + ' ';
									const restoreButton = document.createElement('button');
									restoreButton.textContent = 'Restore';
									restoreButton.className = 'restore-button';
									restoreButton.onclick = () => {
										if(statusDiv) statusDiv.textContent = 'Requesting restore for ' + branch + '...';
										vscode.postMessage({ command: 'requestRestore', branchName: branch });
									};
									li.appendChild(restoreButton);
									ul.appendChild(li);
								});
								if(branchesContainer) branchesContainer.appendChild(ul);
								if(statusDiv) statusDiv.textContent = 'Branches loaded.';
							} else {
								if(branchesContainer) branchesContainer.textContent = 'No backup branches found or target repo not set/accessible.';
							}
						} else if (message.command === 'updateStatus') { // Changed from message.type
							if(statusDiv) statusDiv.textContent = message.text;
						} else if (message.type === 'updateState') {
							if(message.frequency) {
								if(frequencyInput) frequencyInput.value = message.frequency;
								if(state) state.frequency = message.frequency;
							}
							if(message.targetRepoUrl) {
								if(targetRepoInput) targetRepoInput.value = message.targetRepoUrl;
								if(state) state.targetRepoUrl = message.targetRepoUrl;
							}
							if(state) vscode.setState(state);
							if (targetRepoInput && targetRepoInput.value) {
								vscode.postMessage({ command: 'getBranches' });
							} else {
								if(branchesContainer) branchesContainer.textContent = 'Set target repository URL to see branches.';
							}
						} else if (message.type === 'github-device-code') {
							if (connectBtn && deviceCodeInstructions && authStatus) {
								connectBtn.style.display = 'none';
								deviceCodeInstructions.style.display = '';
								deviceCodeInstructions.innerHTML = '<p>To connect, visit <a href="' + message.verificationUri + '" target="_blank">' + message.verificationUri + '</a> and enter the code:</p><pre style="font-size:1.2em;">' + message.userCode + '</pre><p>Waiting for authorization...</p>';
								authStatus.textContent = '';
							}
						} else if (message.type === 'github-auth-error') {
							if (deviceCodeInstructions && connectBtn && authStatus) {
								deviceCodeInstructions.style.display = '';
								deviceCodeInstructions.innerHTML = '<p style="color:red;">' + message.error + '</p>';
								connectBtn.style.display = '';
								authStatus.textContent = 'Not connected to GitHub.';
							}
						}

						// Handle authentication status updates
						if (message.command === 'updateAuthStatus') {
							if (authStatus) authStatus.textContent = message.status;
							if (connectBtn) connectBtn.style.display = message.isAuthenticated ? 'none' : '';
							return;
						}
					});
				</script>
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
