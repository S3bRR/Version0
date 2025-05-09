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
									this._view?.webview.postMessage({ command: 'updateStatus', text: 'Authenticated. Please try Sync again.' });
								} else {
									this._view?.webview.postMessage({ command: 'updateStatus', text: 'Authentication failed. Please try Sync again after authenticating.' });
								}
							} catch (authError) {
								this._view?.webview.postMessage({ command: 'updateStatus', text: 'Authentication process failed.' });
							}
							return;
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
			</head>
			<body>
				<h2>VERSION0</h2>
				
				<div class="form-container">
					<div class="inline-form-group">
						<label for="frequency">Frequency (min):</label>
						<input type="number" id="frequency" value="${currentFrequency}" min="1">
						<button id="saveFrequencyBtn">Save</button>
					</div>

					<div class="inline-form-group">
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
					const frequencyInput = document.getElementById('frequency');
					const saveFrequencyBtn = document.getElementById('saveFrequencyBtn');
					const targetRepoInput = document.getElementById('targetRepo');
					const saveTargetRepoBtn = document.getElementById('saveTargetRepoBtn');
					const backupNowBtn = document.getElementById('backupNowBtn');
					const pushCurrentBranchBtn = document.getElementById('pushCurrentBranchBtn');
					
					const createRepoBtn = document.getElementById('createRepoBtn');
					const syncRepoBtn = document.getElementById('syncRepoBtn');
					const branchesContainer = document.getElementById('branchesContainer');
					const statusDiv = document.getElementById('status');

					// Modal elements
					const createRepoModal = document.getElementById('createRepoModal');
					const newRepoNameInput = document.getElementById('newRepoNameInput');
					const confirmCreateRepoBtn = document.getElementById('confirmCreateRepoBtn');
					const cancelCreateRepoBtn = document.getElementById('cancelCreateRepoBtn');
					
					let state = vscode.getState() || {
						frequency: ${currentFrequency},
						targetRepoUrl: "${currentTargetRepoUrl}"
					};
					// Initialize inputs from state if available
					frequencyInput.value = state.frequency;
					targetRepoInput.value = state.targetRepoUrl;

					saveFrequencyBtn.addEventListener('click', () => {
						vscode.postMessage({ command: 'saveFrequency', text: frequencyInput.value });
					});

					saveTargetRepoBtn.addEventListener('click', () => {
						vscode.postMessage({ command: 'saveTargetRepo', text: targetRepoInput.value });
					});

					// Show Create Repo Modal
					createRepoBtn.addEventListener('click', () => {
						newRepoNameInput.value = ''; // Clear previous input
						createRepoModal.style.display = 'flex'; // Show modal
						newRepoNameInput.focus();
					});

					// Confirm Create Repo from Modal
					confirmCreateRepoBtn.addEventListener('click', () => {
						const repoName = newRepoNameInput.value;
						if (repoName && repoName.trim() !== '') {
							vscode.postMessage({ command: 'createRepo', name: repoName.trim() });
							statusDiv.textContent = 'Creating repository...';
							createRepoModal.style.display = 'none'; // Hide modal
						} else {
							statusDiv.textContent = 'Repository name cannot be empty.';
							// Optionally, you could add an error display within the modal
						}
					});

					// Cancel Create Repo from Modal
					cancelCreateRepoBtn.addEventListener('click', () => {
						createRepoModal.style.display = 'none'; // Hide modal
						statusDiv.textContent = 'Create repository cancelled.';
					});

					syncRepoBtn.addEventListener('click', () => {
						vscode.postMessage({ command: 'syncRepo' });
						statusDiv.textContent = 'Syncing...';
					});

					backupNowBtn.addEventListener('click', () => {
						vscode.postMessage({ command: 'backupNow' });
						statusDiv.textContent = 'Starting manual backup...';
					});
					
					pushCurrentBranchBtn.addEventListener('click', () => {
						vscode.postMessage({ command: 'pushCurrentBranch' });
						statusDiv.textContent = 'Pushing current branch...';
					});

					window.addEventListener('message', event => {
						const message = event.data;
						console.log('Received message:', message);
						
						switch (message.command) {
							case 'frequencySaved':
								frequencyInput.value = message.value;
								statusDiv.textContent = 'Frequency saved.';
								state.frequency = message.value;
								vscode.setState(state);
								break;
							case 'targetRepoSaved':
								targetRepoInput.value = message.value;
								statusDiv.textContent = 'Target repository saved.';
								state.targetRepoUrl = message.value;
								vscode.setState(state);
								break;
							case 'repoCreated':
								targetRepoInput.value = message.newUrl;
								statusDiv.textContent = message.message || 'Repository created and target URL updated.';
								state.targetRepoUrl = message.newUrl;
								vscode.setState(state);
								break;
							case 'updateBranches':
								branchesContainer.innerHTML = '';
								if (message.branches && message.branches.length > 0) {
									const ul = document.createElement('ul');
									message.branches.forEach(branch => {
										const li = document.createElement('li');
										li.textContent = branch + ' ';
										
										const restoreButton = document.createElement('button');
										restoreButton.textContent = 'Restore';
										restoreButton.className = 'restore-button';
										restoreButton.onclick = () => {
											statusDiv.textContent = 'Requesting restore for ' + branch + '...';
											vscode.postMessage({ command: 'requestRestore', branchName: branch });
										};
										li.appendChild(restoreButton);
										ul.appendChild(li);
									});
									branchesContainer.appendChild(ul);
									statusDiv.textContent = 'Branches loaded.';
								} else {
									branchesContainer.textContent = 'No backup branches found or target repo not set/accessible.';
								}
								break;
							case 'updateStatus':
								statusDiv.textContent = message.text;
								break;
							case 'updateState':
								if(message.frequency) {
									frequencyInput.value = message.frequency;
									state.frequency = message.frequency;
								}
								if(message.targetRepoUrl) {
									targetRepoInput.value = message.targetRepoUrl;
									state.targetRepoUrl = message.targetRepoUrl;
								}
								vscode.setState(state);
								
								if (targetRepoInput.value) {
									vscode.postMessage({ command: 'getBranches' });
								} else {
									branchesContainer.textContent = 'Set target repository URL to see branches.';
								}
								break;
						}
					});

					if (targetRepoInput.value) {
						vscode.postMessage({ command: 'getBranches' });
					} else {
						statusDiv.textContent = 'Ready. Configure target repository.';
						branchesContainer.textContent = 'Set target repository URL to see branches.';
					}
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