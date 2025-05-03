// Get VS Code API instance
const vscode = acquireVsCodeApi();

// DOM elements
const frequencyInput = document.getElementById('frequency');
const saveFrequencyButton = document.getElementById('save-frequency');
const repoInput = document.getElementById('target-repo');
const saveRepoButton = document.getElementById('save-target-repo');
const backupNowButton = document.getElementById('backup-now');
const pushCurrentBranchButton = document.getElementById('push-current-branch');
const refreshBranchesButton = document.getElementById('refresh-branches');
const branchList = document.getElementById('branch-list');
const statusDiv = document.getElementById('status');
const authButtonContainer = document.getElementById('auth-button-container');
const authButton = document.getElementById('auth-button');

// --- Event Listeners ---

saveFrequencyButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'saveFrequency', text: frequencyInput.value });
});

saveRepoButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'saveTargetRepo', text: repoInput.value });
});

backupNowButton.addEventListener('click', () => {
    statusDiv.textContent = 'Backup initiated...';
    vscode.postMessage({ command: 'backupNow' });
});

pushCurrentBranchButton.addEventListener('click', () => {
    statusDiv.textContent = 'Committing and pushing current branch...';
    vscode.postMessage({ command: 'pushCurrentBranch' });
});

refreshBranchesButton.addEventListener('click', () => {
    statusDiv.textContent = 'Requesting branch list...';
    branchList.innerHTML = '<li>Fetching...</li>'; // Clear old list
    vscode.postMessage({ command: 'getBranches' });
});

authButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'triggerAuth' });
});

// --- Functions ---

// Function to render branches
function renderBranches(branches) {
    branchList.innerHTML = ''; // Clear existing items
    if (branches && branches.length > 0) {
        // Sort branches, newest first assuming prefix/YYYY-MM-DD... format
        branches.sort().reverse();
        branches.forEach(branchName => {
            const li = document.createElement('li');
            // Display cleaner name, remove prefix like 'backup/' or potential remote like 'origin/backup/'
            const displayBranchName = branchName.replace(/^.*?\/?backup\//, ''); 
            li.textContent = displayBranchName;
            li.dataset.branchName = branchName; // Store full name (needed for restore)
            li.title = `Click to restore from ${branchName}`;
            li.addEventListener('click', () => {
                if (confirm(`Are you sure you want to restore your workspace to the state of branch '${branchName}'? This will overwrite local changes.`)) {
                    statusDiv.textContent = `Initiating restore from ${branchName}...`;
                    vscode.postMessage({ command: 'restoreBackup', branchName: branchName });
                }
            });
            branchList.appendChild(li);
        });
    } else {
        branchList.innerHTML = '<li>No backup branches found or target repo not set.</li>';
    }
}

// --- Message Handling from Extension ---

window.addEventListener('message', event => {
    const message = event.data; // The JSON data our extension sent
    switch (message.command) {
        case 'frequencySaved':
            frequencyInput.value = message.value;
            statusDiv.textContent = 'Frequency saved.';
            break;
        case 'targetRepoSaved':
            repoInput.value = message.value;
            statusDiv.textContent = 'Target repository saved. Refreshing branches...';
            // Don't trigger refresh here, let the extension send updateBranches
            break;
        case 'updateState': // Sent by extension on load or config change
            frequencyInput.value = message.frequency;
            repoInput.value = message.targetRepoUrl || '';
            statusDiv.textContent = "Ready"; // Update status after state is loaded
            authButtonContainer.style.display = 'none'; // Hide auth button initially
            break;
        case 'updateBranches': 
            renderBranches(message.branches);
            statusDiv.textContent = 'Branch list updated.'; // Set status after rendering
            authButtonContainer.style.display = 'none'; // Hide auth button if branches load
            break;
        case 'updateStatus':
            const statusText = message.text;
            statusDiv.textContent = statusText;
            // Show auth button specifically when needed
            if (statusText && statusText.toLowerCase().includes('auth required')) {
                authButtonContainer.style.display = 'block'; 
            } else {
                authButtonContainer.style.display = 'none';
            }
            break;
    }
});

// Optional: Request initial state if not pushed by default
// vscode.postMessage({ command: 'requestInitialState' });

// Request initial branch list on load - REMOVE THIS
// vscode.postMessage({ command: 'getBranches' }); 