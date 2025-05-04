import * as vscode from 'vscode';
import simpleGit, { SimpleGit, CheckRepoActions } from 'simple-git';
import moment from 'moment';
import { GithubService } from './githubService';
import { ConfigManager } from './configManager';
import * as path from 'path';
import * as fs from 'fs/promises';

export class BackupManager {
  private githubService: GithubService;
  private configManager: ConfigManager;
  private timer: NodeJS.Timeout | undefined;
  private git: SimpleGit | undefined;
  private workspaceRoot: string | undefined;

  constructor(githubService: GithubService, configManager: ConfigManager) {
    this.githubService = githubService;
    this.configManager = configManager;
    this.initializeGit();
  }

  private async initializeGit(): Promise<void> {
    this.workspaceRoot = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined;

    if (!this.workspaceRoot) {
      this.git = undefined;
      return;
    }

    try {
      this.git = simpleGit(this.workspaceRoot);
      const isRepo = await this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
      if (!isRepo) {
        this.git = undefined;
        this.workspaceRoot = undefined; // Clear root if not a repo
      }
    } catch (error) {
      console.error("Version0: Error initializing simple-git:", error);
      this.git = undefined;
      this.workspaceRoot = undefined;
    }
  }

  public start(): void {
    this.stop(); // Stop any existing timer
    const intervalMinutes = this.configManager.getBackupInterval();
    if (intervalMinutes > 0) {
      this.timer = setInterval(() => {
        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Version0: Running automatic backup..."
        },
          () => this.performBackup(false)
        );
      }, intervalMinutes * 60 * 1000); // Convert minutes to milliseconds
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public restartTimer(): void {
    this.stop();
    this.start();
  }

  public async triggerManualBackup(): Promise<void> {
    await this.performBackup(true);
  }

  private async performBackup(isManual: boolean = false): Promise<void> {
    // Ensure workspace is open
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      throw new Error("Backup failed: No workspace folder open.");
    }
    const currentWorkspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

    // Check/Initialize Git instance for the current workspace
    await this.initializeGit();

    // Check if it's a git repo, prompt to initialize if not
    if (!this.git || !this.workspaceRoot || this.workspaceRoot !== currentWorkspaceRoot) {
      // Need to re-initialize because it wasn't a repo or workspace changed
      this.workspaceRoot = currentWorkspaceRoot; // Set workspace root for potential init
      const initChoice = await vscode.window.showWarningMessage(
        `Workspace '${path.basename(this.workspaceRoot)}' is not a Git repository. Initialize now?`,
        { modal: true },
        'Initialize Git Repository'
      );

      if (initChoice !== 'Initialize Git Repository') {
        throw new Error("Backup cancelled: Workspace is not a Git repository.");
      }

      // User confirmed - Initialize Git
      try {
        const initGit = simpleGit(this.workspaceRoot); // Create temporary instance for init
        await initGit.init();
        vscode.window.showInformationMessage(`Git repository initialized in ${path.basename(this.workspaceRoot)}.`);
        // Now properly initialize the BackupManager's git instance
        await this.initializeGit();
        if (!this.git) { // Double check if init succeeded
          throw new Error("Git initialization failed. Please check terminal output.");
        }
      } catch (initError: any) {
        throw new Error(`Git initialization failed: ${initError.message}`);
      }
    }

    // At this point, this.git should be valid for the workspace root
    const git = this.git;

    // Get target URL early
    const targetRepoUrl = this.configManager.getTargetBackupRepoUrl();

    // Check for remote 'origin' if just initialized (or always?) - let's check always for safety
    try {
      const remotes = await git.getRemotes(true);
      const originRemote = remotes.find(r => r.name === 'origin');

      if (!originRemote) {
        // Origin remote does not exist
        if (!targetRepoUrl) {
          throw new Error("Backup failed: Target backup repository URL is not configured in settings.");
        }

        const addRemoteChoice = await vscode.window.showWarningMessage(
          `Git remote 'origin' not found. Add target URL (${targetRepoUrl}) as origin?`,
          { modal: true },
          'Add Remote Origin'
        );

        if (addRemoteChoice !== 'Add Remote Origin') {
          throw new Error("Backup cancelled: Remote 'origin' configuration required.");
        }

        // User confirmed - Add remote
        try {
          await git.addRemote('origin', targetRepoUrl);
          vscode.window.showInformationMessage(`Added remote 'origin' pointing to ${targetRepoUrl}.`);
        } catch (remoteError: any) {
          throw new Error(`Failed to add remote 'origin': ${remoteError.message}`);
        }
      } else {
        // Origin remote *does* exist here
        // Optional: Verify if existing origin matches target URL?
        if (targetRepoUrl && originRemote.refs.push !== targetRepoUrl) { // No need for originRemote check here, it must exist
          console.warn(`Version0: Existing remote 'origin' (${originRemote.refs.push}) does not match configured target URL (${targetRepoUrl}). Backup will push to 'origin'.`); // Keep important warning
          // We could prompt to update origin here, but let's stick to pushing to origin for now.
        }
      }
    } catch (remoteCheckError: any) {
      throw new Error(`Failed to check Git remotes: ${remoteCheckError.message}`);
    }

    // Check authentication status (important for private repos)
    if (!await this.githubService.isAuthenticated()) {
      // Attempt to authenticate if not already authenticated
      const authenticated = await this.githubService.authenticate();
      if (!authenticated) {
        throw new Error("Backup failed: GitHub authentication required. Please authenticate via the command palette or status bar.");
      }
    }

    // --- Calculate Next Version Branch Name ---
    let nextVersion = '1.0'; // Default starting version
    try {
      // Fetch branches starting with 'v' from the target repo
      // Added explicit check although previous logic should prevent undefined
      if (!targetRepoUrl) {
        throw new Error("Cannot fetch branches: Target repository URL is not defined.");
      }
      const existingBranches = await this.githubService.getBackupBranchesFromTargetUrl(targetRepoUrl);
      
      let maxMajor = 0;
      let maxMinor = -1; // Start minor at -1 to correctly handle v1.0 start

      existingBranches.forEach(branch => {
        // Regex to capture vX.Y from the start of the branch name
        const match = branch.match(/^v(\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1], 10);
          const minor = parseInt(match[2], 10);

          if (major > maxMajor) {
            maxMajor = major;
            maxMinor = minor;
          } else if (major === maxMajor && minor > maxMinor) {
            maxMinor = minor;
          }
        }
      });

      if (maxMinor !== -1) { // Found existing versions
        nextVersion = `${maxMajor}.${maxMinor + 1}`;
      } // Otherwise, stick with default v1.0
      
    } catch (branchError: any) {
      // Log the error but proceed with default v1.0 - maybe notify user?
      console.error("Version0: Error fetching or parsing existing branches, starting with v1.0:", branchError); 
      vscode.window.showWarningMessage("Could not determine next version number from existing branches. Starting with v1.0.");
    }
    
    const timestamp = moment().format('YYYY-MM-DD_HH-mm'); // Use HH-mm for 24h format
    const branchName = `v${nextVersion}/${timestamp}`;
    let commitMessage = `Version0 Backup: v${nextVersion} - ${timestamp}`;

    // Prompt for notes only if it's a manual backup
    if (isManual) {
      const backupNote = await vscode.window.showInputBox({
        prompt: "Enter optional notes for this backup",
        placeHolder: "e.g., Refactored login component"
      });
      if (backupNote) {
        commitMessage += ` - ${backupNote}`;
      }
    }

    try {
      // 1. Create new branch from current HEAD
      await git.checkoutLocalBranch(branchName);

      // 2. Add all changes
      await git.add('.');

      // 3. Commit changes
      const commitResult = await git.commit(commitMessage);
      if (commitResult.commit.length === 0) {
        // Optional: delete the branch locally if nothing was committed?
        // await git.checkout('-'); // switch back? Be careful with state
        // await git.deleteLocalBranch(branchName, true);
        // For now, let's proceed and push the empty commit branch as a timestamp marker
      }

      // 4. Push the new branch to origin
      await git.push('origin', branchName, { '--set-upstream': null }); // Use object for options

      // 6. Fetch origin to update local refs and potentially help VS Code UI recognize the push
      await git.fetch('origin');

      if (this.configManager.getEnableNotifications()) {
        vscode.window.showInformationMessage(`Version0: Backup successful. Branch '${branchName}' pushed.`);
      }

    } catch (error: any) {
      console.error("Version0: Git operation failed:", error);
      if (this.configManager.getEnableNotifications()) {
        vscode.window.showErrorMessage(`Version0: Backup failed: ${error.message}`);
      }
      // Attempt to clean up the created branch if push failed?
      // This is complex due to potential states (commit failed, add failed etc)
      // Best to leave the local branch for manual inspection for now.
      throw new Error(`Git operation failed: ${error.message}`); // Re-throw for progress handler
    }
  }

  // --- Restore Functionality --- (To be implemented fully)
  public async restoreFromBackup(branchName: string): Promise<void> {
    await this.initializeGit();
    if (!this.git || !this.workspaceRoot) {
      throw new Error("Restore failed: Not inside a Git repository or no workspace open.");
    }

    const targetRepoUrl = this.configManager.getTargetBackupRepoUrl(); // Needed for fetch?
    if (!targetRepoUrl) {
      throw new Error("Restore failed: Target backup repository URL is not configured.");
    }

    // Check auth for fetch
    if (!await this.githubService.isAuthenticated()) {
      const authenticated = await this.githubService.authenticate();
      if (!authenticated) {
        throw new Error("Restore failed: GitHub authentication required to fetch branches.");
      }
    }

    // Branch name likely includes prefix, e.g., "backup/YYYY..."
    const fullBranchName = branchName.startsWith('refs/heads/') ? branchName : `refs/heads/${branchName}`;
    const shortBranchName = fullBranchName.replace('refs/heads/', '');

    const confirmation = await vscode.window.showWarningMessage(
      `Restore workspace to backup branch '${shortBranchName}'? This will overwrite local changes.`,
      { modal: true },
      'Restore'
    );

    if (confirmation !== 'Restore') {
      vscode.window.showInformationMessage('Restore operation cancelled.');
      return;
    }

    console.log(`Version0: Starting restore from branch ${shortBranchName}`);
    const git = this.git;
    const gitignorePath = path.join(this.workspaceRoot, '.gitignore');
    let originalGitignoreContent: string | undefined;

    try {
      // 1. Save current .gitignore
      try {
        originalGitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      } catch (readError: any) {
        if (readError.code === 'ENOENT') {
          console.log("Version0: No .gitignore file found in workspace root. Nothing to preserve.");
        } else {
          throw new Error(`Failed to read existing .gitignore: ${readError.message}`);
        }
      }

      // 2. Fetch the specific branch from origin
      await git.fetch('origin', shortBranchName);

      // 3. Checkout the branch
      await git.checkout(shortBranchName);

      // 4. Restore .gitignore if it was saved
      if (originalGitignoreContent !== undefined) {
        await fs.writeFile(gitignorePath, originalGitignoreContent, 'utf-8');
      }

      vscode.window.showInformationMessage(`Version0: Successfully restored workspace to backup branch '${shortBranchName}'.`);

    } catch (error: any) {
      console.error("Version0: Restore operation failed:", error);
      vscode.window.showErrorMessage(`Version0: Restore failed: ${error.message}`);
      // Attempt to switch back? Risky.
      throw new Error(`Restore operation failed: ${error.message}`);
    }
  }

  // --- End Restore Functionality ---

  // --- Push Current State Functionality ---
  public async pushCurrentState(): Promise<{ branchName: string; pullRequestUrl?: string } | void> {
    await this.initializeGit();
    if (!this.git || !this.workspaceRoot) {
        throw new Error("Push failed: Not inside a Git repository or no workspace open.");
    }

    // Check auth status (needed for push)
    if (!await this.githubService.isAuthenticated()) {
        const authenticated = await this.githubService.authenticate();
        if (!authenticated) {
            throw new Error("Push failed: GitHub authentication required.");
        }
    }

    const git = this.git;
    const commitMessage = `Version0: Push current state - ${moment().format('YYYY-MM-DD HH:mm:ss')}`;

    try {
        // 1. Get current branch
        const branchSummary = await git.branchLocal();
        const currentBranch = branchSummary.current;
        if (!currentBranch) {
            throw new Error("Could not determine the current branch.");
        }

        // 2. Add all changes (respects .gitignore)
        await git.add('.');

        // 3. Commit changes
        try {
            const commitResult = await git.commit(commitMessage);
            if (commitResult.commit) {
            } else {
                // If no changes, we can still try to push the existing branch state
            }
        } catch (commitError: any) {
            // Handle potential "nothing to commit" error gracefully if needed,
            // but usually simple-git doesn't throw for that, it returns an empty commit.
            // Rethrow other commit errors.
            console.error("Commit failed:", commitError);
            throw new Error(`Commit failed: ${commitError.message}`);
        }

        // 4. Push the current branch to origin
        await git.push('origin', currentBranch);

        if (this.configManager.getEnableNotifications()) {
            // We show a more detailed message from the Webview provider now
        }

        // Construct PR URL if needed
        let pullRequestUrl: string | undefined = undefined;
        const targetRepoUrl = this.configManager.getTargetBackupRepoUrl(); // Get target repo URL again
        
        if (targetRepoUrl && currentBranch !== 'main' && currentBranch !== 'master') {
            // Basic parsing - assumes HTTPS URL format for simplicity
            const match = targetRepoUrl.match(/github\.com[\/|:]([\w-]+)\/([\w-]+?)(\.git)?$/i);
            if (match && match[1] && match[2]) {
                const owner = match[1];
                const repo = match[2];
                // Assuming base is 'main'. Could be made configurable.
                pullRequestUrl = `https://github.com/${owner}/${repo}/compare/main...${encodeURIComponent(currentBranch)}?expand=1`;
            } else {
                console.warn(`Version0: Could not parse owner/repo from target URL '${targetRepoUrl}' to generate PR link.`);
            }
        }

        // Return result object
        return {
            branchName: currentBranch,
            pullRequestUrl: pullRequestUrl
        };

    } catch (error: any) {
        console.error("Version0: Push current state operation failed:", error);
        if (this.configManager.getEnableNotifications()) {
            vscode.window.showErrorMessage(`Version0: Push failed: ${error.message}`);
        }
        throw new Error(`Push operation failed: ${error.message}`); // Re-throw for progress handler
    }
  }
  // --- End Push Current State ---

  // Remove old methods
  // public async addRepository(url: string): Promise<void> { ... }
  // private async backupRepository(repository: Repository): Promise<void> { ... }
  // private async cleanupOldBranches(repository: Repository): Promise<void> { ... }
} 