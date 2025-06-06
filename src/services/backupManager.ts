import * as vscode from 'vscode';
import simpleGit, { SimpleGit, CheckRepoActions } from 'simple-git';
import moment from 'moment';
import { GithubService } from './githubService';
import { ConfigManager } from './configManager';
import * as path from 'path';
import * as fs from 'fs/promises';

export class BackupManager implements vscode.Disposable {
  private githubService: GithubService;
  private configManager: ConfigManager;
  private timer: NodeJS.Timeout | undefined;
  private git: SimpleGit | undefined;
  private workspaceRoot: string | undefined;
  private static readonly BACKUP_REMOTE_NAME = 'version0_backup_target'; // Dedicated remote name

  constructor(githubService: GithubService, configManager: ConfigManager) {
    this.githubService = githubService;
    this.configManager = configManager;
    this.initializeGit().catch(err => {
        console.error("Version0: Failed to initialize Git on construction:", err.message);
        // Non-critical here, as it will be re-attempted before operations
    });
  }

  private async initializeGit(forceReInit = false): Promise<boolean> {
    const currentWorkspaceFolders = vscode.workspace.workspaceFolders;
    const newWorkspaceRoot = currentWorkspaceFolders && currentWorkspaceFolders.length > 0
      ? currentWorkspaceFolders[0].uri.fsPath
      : undefined;

    if (!newWorkspaceRoot) {
      this.git = undefined;
      this.workspaceRoot = undefined;
      console.warn("Version0: No workspace folder open. Git operations disabled.");
      return false;
    }

    // If workspace hasn't changed and git is already initialized (and not forcing re-init), do nothing
    if (this.git && this.workspaceRoot === newWorkspaceRoot && !forceReInit) {
        try {
            // Quick check to see if git instance is still valid
            await this.git.status();
            return true;
        } catch (e) {
            console.warn("Version0: Existing Git instance seems invalid, re-initializing.");
            // Proceed to re-initialize
        }
    }
    
    this.workspaceRoot = newWorkspaceRoot; // Set new root

    try {
      // Validate path existence before passing to simpleGit
      if (!await fs.stat(this.workspaceRoot).then(s => s.isDirectory()).catch(() => false)) {
          console.error(`Version0: Workspace root path does not exist or is not a directory: ${this.workspaceRoot}`);
          this.git = undefined;
          return false;
      }

      this.git = simpleGit(this.workspaceRoot);
      const isRepo = await this.git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
      if (!isRepo) {
        // This case is handled more gracefully in performBackup/pushCurrentState with a prompt to init
        console.warn(`Version0: Workspace '${path.basename(this.workspaceRoot)}' is not a Git repository.`);
        this.git = undefined; // Mark as not usable until initialized
        return false; 
      }
      console.log(`Version0: Git initialized successfully for ${this.workspaceRoot}`);
      return true;
    } catch (error: any) {
      console.error(`Version0: Error initializing simple-git for ${this.workspaceRoot}: ${error.message}`);
      this.git = undefined;
      return false;
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

  private async tryFixGitCorruption(): Promise<boolean> {
    if (!this.git || !this.workspaceRoot) {
      console.log(`Version0: Cannot fix git corruption - git or workspaceRoot not initialized`);
      return false;
    }

    try {
      console.log(`Version0: Attempting to fix potential git index corruption...`);
      
      // Try to remove any voicetype reference from the index
      try {
        await this.git.raw(['rm', '--cached', '-r', '-f', 'voicetype']);
      } catch (e) {
        // Ignore, this is expected to fail if no such path exists
      }
      
      // Try to clean the index more aggressively
      try {
        // Get all files currently tracked by git
        const lsFiles = await this.git.raw(['ls-files']);
        const trackedFiles = lsFiles.split('\n').filter(f => f.trim().length > 0);
        
        // Check if any of these files contain the problematic path
        const problemFiles = trackedFiles.filter(f => f.includes('voicetype'));
        
        if (problemFiles.length > 0) {
          console.log(`Version0: Found ${problemFiles.length} problematic references to 'voicetype' in git index`);
          // Remove them individually
          for (const file of problemFiles) {
            try {
              await this.git.raw(['rm', '--cached', '-f', file]);
              console.log(`Version0: Removed problematic file from index: ${file}`);
            } catch (e) {
              // Continue with the next file
            }
          }
        }
      } catch (e) {
        // Ignore errors from this operation
      }
      
      return true;
    } catch (error: any) {
      console.error(`Version0: Error while trying to fix git corruption: ${error.message}`);
      return false;
    }
  }

  private async performBackup(isManual = false): Promise<void> {
    const didInitialize = await this.initializeGit(true); // Force re-check/re-init

    if (!this.workspaceRoot) {
      throw new Error("Backup failed: No workspace folder open.");
    }
    if (!this.git && didInitialize === false) { // Check if initializeGit explicitly failed or marked not a repo
      const initChoice = await vscode.window.showWarningMessage(
        `Workspace '${path.basename(this.workspaceRoot)}' is not a Git repository. Initialize now?`,
        { modal: true },
        'Initialize Git Repository'
      );
      if (initChoice !== 'Initialize Git Repository') {
        throw new Error("Backup cancelled: Workspace is not a Git repository.");
      }
      try {
        const tempGit = simpleGit(this.workspaceRoot); // Use a temporary instance for init
        await tempGit.init();
        vscode.window.showInformationMessage(`Git repository initialized in ${path.basename(this.workspaceRoot)}.`);
        if (!await this.initializeGit(true)) { // Re-initialize and check again
             throw new Error("Git initialization seemed to succeed, but BackupManager could not confirm. Please check logs.");
        }
      } catch (initError: any) {
        throw new Error(`Git initialization failed: ${initError.message}`);
      }
    }
    
    // At this point, if this.git is still not defined, something is wrong.
    if (!this.git) {
        throw new Error("Backup failed: Git is not available for the current workspace. Check for errors during initialization.");
    }
    const git = this.git; // Use this constant for operations

    // Get target URL for the backup remote
    const targetRepoUrl = this.configManager.getTargetBackupRepoUrl();
    if (!targetRepoUrl) {
      throw new Error("Backup failed: Target backup repository URL is not configured in settings. Please set it first (e.g., by creating a repo).");
    }

    // Ensure GitHub authentication
    if (!await this.githubService.isAuthenticated()) {
      const authenticated = await this.githubService.authenticate();
      if (!authenticated) {
        throw new Error("Backup failed: GitHub authentication required. Please authenticate and try again.");
      }
    }
    
    // Configure the dedicated backup remote
    try {
      const remotes = await git.getRemotes(true);
      let backupRemote = remotes.find(r => r.name === BackupManager.BACKUP_REMOTE_NAME);
      
      if (backupRemote && backupRemote.refs.push !== targetRepoUrl) {
        // Remote exists but points to the wrong URL, update it
        await git.removeRemote(BackupManager.BACKUP_REMOTE_NAME);
        backupRemote = undefined; // Treat as if it doesn't exist to re-add
        console.log(`Version0: Updated '${BackupManager.BACKUP_REMOTE_NAME}' remote to new target URL.`);
      }
      
      if (!backupRemote) {
        await git.addRemote(BackupManager.BACKUP_REMOTE_NAME, targetRepoUrl);
        console.log(`Version0: Added remote '${BackupManager.BACKUP_REMOTE_NAME}' pointing to ${targetRepoUrl}.`);
      }
    } catch (remoteError: any) {
      throw new Error(`Failed to configure backup remote '${BackupManager.BACKUP_REMOTE_NAME}': ${remoteError.message}`);
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
    
    const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss'); // Add seconds for more unique branch names
    let branchName = `v${nextVersion}/${timestamp}`;
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
      console.log(`Version0: [performBackup] Starting backup. Current this.workspaceRoot: ${this.workspaceRoot}`);
      const status = await git.status();
      if (!status.current) {
          // Attempt to checkout a default branch if possible, or fail.
          // Common defaults: main, master. Let's try 'main' then 'master'.
          try {
              console.log("Version0: [performBackup] No current branch, attempting to checkout 'main'.");
              await git.checkout('main');
              vscode.window.showInformationMessage("Version0: Switched to 'main' branch for initial backup.");
          } catch (e) {
              try {
                  console.log("Version0: [performBackup] Checkout 'main' failed, attempting to checkout 'master'.");
                  await git.checkout('master');
                  vscode.window.showInformationMessage("Version0: Switched to 'master' branch for initial backup.");
              } catch (e2) {
                  console.error("Version0: [performBackup] Failed to checkout a default branch (main/master) for a new repository.", e2);
                  throw new Error("Backup failed: Git is in a new repository state and could not create a default branch. Please commit manually once or ensure 'main' or 'master' can be created.");
              }
          }
      }
      
      console.log(`Version0: [performBackup] About to checkout local branch: ${branchName}. Current branch: ${status.current || 'None'}`);
      
      try {
        // Try to create the branch
        await git.checkoutLocalBranch(branchName);
        console.log(`Version0: [performBackup] Successfully checked out new local branch: ${branchName}`);
      } catch (branchError: any) {
        // If branch already exists, try to use it
        if (branchError.message.includes('already exists')) {
          console.log(`Version0: [performBackup] Branch ${branchName} already exists, attempting to switch to it`);
          try {
            // Try to switch to the existing branch
            await git.checkout(branchName);
            console.log(`Version0: [performBackup] Successfully switched to existing branch: ${branchName}`);
          } catch (checkoutError: any) {
            // If we can't switch to it either, try a more unique name by adding a suffix
            const uniqueBranchName = `${branchName}-${Math.floor(Math.random() * 1000)}`;
            console.log(`Version0: [performBackup] Creating alternative branch name: ${uniqueBranchName}`);
            await git.checkoutLocalBranch(uniqueBranchName);
            console.log(`Version0: [performBackup] Successfully created alternative branch: ${uniqueBranchName}`);
            // Update the branch name for the rest of the process
            branchName = uniqueBranchName;
          }
        } else {
          // Some other error occurred
          console.error(`Version0: [performBackup] Error creating branch: ${branchError.message}`);
          throw branchError;
        }
      }
      
      // Validate workspaceRoot one last time and log git context
      if (!this.workspaceRoot || !await fs.stat(this.workspaceRoot).then(s => s.isDirectory()).catch(() => false)) {
          console.error(`Version0: [performBackup] Workspace path is invalid before git add: ${this.workspaceRoot}`);
          throw new Error(`Backup failed: Workspace path is invalid or inaccessible: ${this.workspaceRoot}`);
      }
      const currentGitDir = await git.revparse('--git-dir').catch((err) => `unknown git-dir (${err.message})`);
      const currentTopLevel = await git.revparse('--show-toplevel').catch((err) => `unknown top-level (${err.message})`);
      console.log(`Version0: [performBackup] Pre-add context. WorkspaceRoot: ${this.workspaceRoot}, GitDir: ${currentGitDir}, TopLevel: ${currentTopLevel}`);

      try {
        // Check if there's any corruption in git index related to 'voicetype'
        console.log(`Version0: [performBackup] Checking for problematic references before adding files`);
        
        // Attempt first level of cleanup
        await this.tryFixGitCorruption();

        // Get the status to determine what files to add
        const statusSummary = await git.status();
        
        if (statusSummary.files.length === 0) {
          // Nothing to add, proceed with empty commit
          console.log(`Version0: [performBackup] No modified files found, proceeding with empty commit`);
        } else {
          // Add files individually instead of using '.'
          const filesToAdd = statusSummary.files
            .map(file => file.path)
            .filter(path => !path.includes('voicetype')); // Exclude any paths with 'voicetype'
            
          console.log(`Version0: [performBackup] Adding ${filesToAdd.length} files individually`);
          
          if (filesToAdd.length > 0) {
            // Add files in batches to avoid command line length issues
            const batchSize = 50;
            for (let i = 0; i < filesToAdd.length; i += batchSize) {
              const batch = filesToAdd.slice(i, i + batchSize);
              await git.add(batch);
            }
          }
        }
      } catch (addError: any) {
        console.error(`Version0: [performBackup] Error during file add operation: ${addError.message}`);
        // Attempt to continue with empty commit
      }

      const commitResult = await git.commit(commitMessage, { '--allow-empty': null }); 
      
      // Push to the dedicated backup remote
      await git.push(BackupManager.BACKUP_REMOTE_NAME, branchName, { '--set-upstream': null });

      await git.fetch(BackupManager.BACKUP_REMOTE_NAME); // Fetch from the specific remote

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
    if (!await this.initializeGit(true) || !this.git || !this.workspaceRoot) {
      throw new Error("Restore failed: Git is not available or workspace not found.");
    }
    const git = this.git;
    const targetRepoUrl = this.configManager.getTargetBackupRepoUrl();

    if (!targetRepoUrl) {
        throw new Error("Restore failed: Target backup repository URL is not configured.");
    }
    
    // Ensure backup remote is configured
    try {
        const remotes = await git.getRemotes(true);
        let backupRemote = remotes.find(r => r.name === BackupManager.BACKUP_REMOTE_NAME);
        if (backupRemote && backupRemote.refs.fetch !== targetRepoUrl) { // Check fetch URL for restore
            await git.removeRemote(BackupManager.BACKUP_REMOTE_NAME);
            backupRemote = undefined;
        }
        if (!backupRemote) {
            await git.addRemote(BackupManager.BACKUP_REMOTE_NAME, targetRepoUrl);
        }
        // Fetch the specific branch from the backup remote
        await git.fetch(BackupManager.BACKUP_REMOTE_NAME, branchName);
    } catch (e: any) {
        throw new Error(`Failed to prepare remote for restore: ${e.message}`);
    }


    // Check if the branch exists locally (it might after fetch if named the same, but we want remote one)
    // The format from fetch would be 'refs/remotes/version0_backup_target/vX.Y/timestamp'
    const remoteBranchRef = `refs/remotes/${BackupManager.BACKUP_REMOTE_NAME}/${branchName}`;

    try {
      // stash local changes
      const status = await git.status();
      let stashed = false;
      let stashMsg: string | undefined = undefined; // Declare stashMsg here

      if (!status.isClean()) {
        stashMsg = `Version0_stash_before_restore_${moment().format('YYYYMMDDHHmmss')}`; // Assign here
        await git.stash(['push', '-u', '-m', stashMsg]); 
        stashed = true;
        vscode.window.showInformationMessage(`Local changes stashed as: ${stashMsg}`);
      }

      // Checkout the fetched remote branch into a local branch (can be same name, or a temporary one)
      // Force checkout to overwrite local changes
      await git.checkout(remoteBranchRef, ['-B', branchName, '-f']); // Create/reset local branch 'branchName' to the fetched remote ref, force

      if (stashed) {
        // Try to pop the stash. If conflicts, user needs to resolve.
        try {
          await git.stash(['pop']);
          vscode.window.showInformationMessage(`Previously stashed changes (if any) have been reapplied.`);
        } catch (popError: any) {
          vscode.window.showWarningMessage(`Could not automatically reapply stashed changes due to conflicts. Please resolve them manually. Stash was named: '${stashMsg || 'recently created stash'}'.`);
          // User needs to 'git stash pop' or 'git stash apply' and resolve conflicts
        }
      }
      
      vscode.window.showInformationMessage(`Successfully restored workspace to backup branch '${branchName}'.`);
    } catch (error: any) {
      throw new Error(`Failed to restore from branch '${branchName}': ${error.message}`);
    }
  }

  /**
   * Determine the most recent backup branch available in the target repository.
   */
  private async getLatestBackupBranch(): Promise<string | undefined> {
    const targetRepoUrl = this.configManager.getTargetBackupRepoUrl();
    if (!targetRepoUrl) {
      return undefined;
    }
    const branches = await this.githubService.getBackupBranchesFromTargetUrl(targetRepoUrl);
    if (branches.length === 0) {
      return undefined;
    }
    const parsed = branches
      .map(b => {
        const parts = b.split('/');
        const ts = parts[1];
        const time = moment(ts, 'YYYY-MM-DD_HH-mm-ss', true);
        return { name: b, time: time.isValid() ? time.toDate().getTime() : 0 };
      })
      .filter(b => b.time > 0)
      .sort((a, b) => b.time - a.time);
    return parsed.length > 0 ? parsed[0].name : undefined;
  }

  /**
   * Restore the workspace using the latest available backup branch.
   */
  public async restoreLatestBackup(): Promise<void> {
    const latest = await this.getLatestBackupBranch();
    if (!latest) {
      throw new Error('No backup branches found to restore.');
    }
    await this.restoreFromBackup(latest);
  }

  // --- End Restore Functionality ---

  // --- Push Current State Functionality ---
  public async pushCurrentState(): Promise<{ branchName: string; pullRequestUrl?: string } | void> {
    if (!await this.initializeGit(true) || !this.git || !this.workspaceRoot) {
      throw new Error("Push operation failed: Git is not available or workspace not found.");
    }
    const git = this.git;
    const targetRepoUrl = this.configManager.getTargetBackupRepoUrl();

    if (!targetRepoUrl) {
      vscode.window.showErrorMessage("Push failed: Target backup repository URL is not configured. Please create or set a target repository in Version0 settings.");
      return;
    }

    if (!await this.githubService.isAuthenticated()) {
      const authenticated = await this.githubService.authenticate();
      if (!authenticated) {
        vscode.window.showErrorMessage("Push failed: GitHub authentication required.");
        return;
      }
    }
    
    // Configure the dedicated backup remote (same as in performBackup)
    try {
      const remotes = await git.getRemotes(true);
      let backupRemote = remotes.find(r => r.name === BackupManager.BACKUP_REMOTE_NAME);
      if (backupRemote && backupRemote.refs.push !== targetRepoUrl) {
        await git.removeRemote(BackupManager.BACKUP_REMOTE_NAME);
        backupRemote = undefined;
      }
      if (!backupRemote) {
        await git.addRemote(BackupManager.BACKUP_REMOTE_NAME, targetRepoUrl);
      }
    } catch (remoteError: any) {
      throw new Error(`Failed to configure backup remote '${BackupManager.BACKUP_REMOTE_NAME}' for push: ${remoteError.message}`);
    }

    try {
      const status = await git.status();
      if (!status.current) {
        throw new Error("Could not determine the current branch. Please ensure you are on a branch.");
      }
      const currentBranch = status.current;

      // Optional: Add and commit any uncommitted changes before pushing?
      // For "Push Current Branch", we assume the user wants to push the branch as-is,
      // or they should commit manually first. Let's not auto-commit here.
      // if (!status.isClean()) {
      //   const commitChoice = await vscode.window.showInformationMessage(
      //     "You have uncommitted changes. Commit them before pushing?",
      //     { modal: true }, "Commit and Push", "Push without Committing"
      //   );
      //   if (commitChoice === "Commit and Push") {
      //     await git.add('.');
      //     await git.commit(`Version0: Pushing current state of branch ${currentBranch}`);
      //   } else if (commitChoice !== "Push without Committing") {
      //     return; // Cancelled
      //   }
      // }

      await git.push(BackupManager.BACKUP_REMOTE_NAME, currentBranch, { '--set-upstream': null });
      
      vscode.window.showInformationMessage(`Successfully pushed branch '${currentBranch}' to backup target.`);

      // Construct a potential PR URL - this is a best guess
      const repoInfo = this.parseRepoUrlForPR(targetRepoUrl); // Need to implement or reuse this
      let pullRequestUrl: string | undefined = undefined;
      if (repoInfo) {
        pullRequestUrl = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/new/${currentBranch}`;
      }
      
      return { branchName: currentBranch, pullRequestUrl };

    } catch (error: any) {
      console.error("Version0: Push current state operation failed:", error);
      throw new Error(`Push operation failed: ${error.message}`);
    }
  }
  
  // Helper to parse owner/repo for PR URL (can be simplified if GithubService has a public one)
  private parseRepoUrlForPR(url: string): { owner: string; repo: string } | null {
    try {
      if (url.startsWith('https:')) {
        const urlObj = new URL(url);
        if (urlObj.hostname !== 'github.com') return null;
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) return null;
        const repoName = pathParts[1].endsWith('.git') ? pathParts[1].slice(0, -4) : pathParts[1];
        return { owner: pathParts[0], repo: repoName };
      } else if (url.startsWith('git@')) {
        // git@github.com:owner/repo.git
        const match = url.match(/git@github\.com:([^/]+)\/([^.]+)(\.git)?/);
        if (match && match[1] && match[2]) {
            return { owner: match[1], repo: match[2] };
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /** Dispose resources such as timers */
  public dispose(): void {
    this.stop();
  }

  // Remove old methods
  // public async addRepository(url: string): Promise<void> { ... }
  // private async backupRepository(repository: Repository): Promise<void> { ... }
  // private async cleanupOldBranches(repository: Repository): Promise<void> { ... }
} 