import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { ConfigManager } from './configManager';

export class GithubService implements vscode.Disposable {
  private octokit: Octokit | undefined;
  private configManager: ConfigManager;
  private authStatusBarItem: vscode.StatusBarItem;
  
  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    
    // Create auth status bar item
    this.authStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.authStatusBarItem.text = '$(key) GitHub Auth';
    this.authStatusBarItem.command = 'version0.authenticateGitHub';
    
    // Register authentication command
    vscode.commands.registerCommand('version0.authenticateGitHub', async () => {
      await this.authenticate();
    });
    
    // Initialize Octokit
    this.initializeOctokit();
  }
  
  dispose() {
    this.authStatusBarItem.dispose();
  }
  
  /**
   * Initialize the GitHub client using VS Code Authentication API
   */
  private async initializeOctokit(): Promise<void> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: false });
      if (session) {
        this.octokit = new Octokit({ auth: session.accessToken });
        this.authStatusBarItem.text = '$(check) GitHub Auth';
        this.authStatusBarItem.tooltip = `Authenticated as ${session.account.label}`;
        this.authStatusBarItem.command = undefined; // Disable command when authenticated
      } else {
        this.octokit = undefined;
        this.authStatusBarItem.text = '$(key) GitHub Auth Required';
        this.authStatusBarItem.tooltip = 'Click to authenticate with GitHub';
        this.authStatusBarItem.command = 'version0.authenticateGitHub'; // Re-enable command
      }
    } catch (error) {
      console.error('Error initializing Octokit during getSession:', error);
      this.octokit = undefined;
      this.authStatusBarItem.text = '$(error) GitHub Auth Error';
      this.authStatusBarItem.tooltip = 'Error during authentication';
      this.authStatusBarItem.command = 'version0.authenticateGitHub';
    }
    this.authStatusBarItem.show();
  }
  
  /**
   * Authenticate with GitHub using VS Code Authentication API
   */
  async authenticate(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
      if (session) {
        this.octokit = new Octokit({ auth: session.accessToken });
        this.authStatusBarItem.text = '$(check) GitHub Auth';
        this.authStatusBarItem.tooltip = `Authenticated as ${session.account.label}`;
        this.authStatusBarItem.command = undefined; // Disable command when authenticated
        this.authStatusBarItem.show();
        vscode.window.showInformationMessage(`Successfully authenticated with GitHub as ${session.account.label}`);
        return true;
      } else {
        // This case should ideally not happen with createIfNone: true, but handle defensively
        vscode.window.showErrorMessage('GitHub authentication failed: Could not get session.');
        this.initializeOctokit(); // Reset status bar
        return false;
      }
    } catch (error) {
      vscode.window.showErrorMessage(`GitHub authentication failed: ${(error as Error).message}`);
      console.error('GitHub Authentication Error:', error);
      this.initializeOctokit(); // Reset status bar
      return false;
    }
  }
  
  /**
   * Check if authenticated with GitHub
   */
  async isAuthenticated(): Promise<boolean> {
    // Check if octokit is already initialized and valid
    if (this.octokit) {
      // Optional: Add a quick check like getting user info to ensure the token is still valid
      try {
        await this.octokit.users.getAuthenticated();
        return true;
      } catch (error) {
        console.warn("Octokit instance exists but authentication check failed. Re-initializing.", error);
        // Token might be invalid, force re-initialization / re-authentication attempt
        await this.initializeOctokit(); 
        return !!this.octokit;
      }
    }

    // If not initialized, try to get session silently
    await this.initializeOctokit();
    return !!this.octokit;
  }
  
  // // Method below might still be useful internally or for status display
  // async getCurrentUser(): Promise<string> {
  //   if (!await this.isAuthenticated()) {
  //     throw new Error('Not authenticated with GitHub');
  //   }
  //   
  //   try {
  //     const { data } = await this.octokit!.users.getAuthenticated();
  //     return data.login;
  //   } catch (error) {
  //     throw new Error(`Failed to get current user: ${(error as Error).message}`);
  //   }
  // }
  
  // Remove methods related to operating on specific remote repos via API,
  // as logic is now local-git focused.
  // async getRepositoryBranches(repository: Repository): Promise<string[]> { ... }
  // async getBranchSha(repository: Repository, branch: string): Promise<string> { ... }
  // async createBranch(repository: Repository, branchName: string, fromBranch: string): Promise<void> { ... }
  // async deleteBranch(repository: Repository, branchName: string): Promise<void> { ... }
  // async getDefaultBranch(repository: Repository): Promise<string> { ... }
  // async testRepositoryAccess(repository: Repository): Promise<boolean> { ... }

  // Utility to parse owner/repo from URL
  private parseRepoUrl(url: string): { owner: string; repo: string } | null {
    try {
      // Handle HTTPS URLs: https://github.com/owner/repo.git or https://github.com/owner/repo
      if (url.startsWith('https:')) {
        const urlObj = new URL(url);
        if (urlObj.hostname !== 'github.com') return null;
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) return null;
        const repoName = pathParts[1].endsWith('.git') ? pathParts[1].slice(0, -4) : pathParts[1];
        return { owner: pathParts[0], repo: repoName };
      }
      // Handle SSH URLs: git@github.com:owner/repo.git
      else if (url.startsWith('git@')) {
        const parts = url.split(':');
        if (parts.length !== 2) return null;
        const hostPart = parts[0];
        const pathPart = parts[1];
        if (!hostPart.endsWith('@github.com')) return null; // Basic check
        const pathParts = pathPart.split('/').filter(Boolean);
        if (pathParts.length < 2) return null;
         const repoName = pathParts[1].endsWith('.git') ? pathParts[1].slice(0, -4) : pathParts[1];
        return { owner: pathParts[0], repo: repoName };
      } 
      // Handle simpler owner/repo format?
      else if (!url.includes('/') && url.split('/').length === 2) {
          const parts = url.split('/');
          return { owner: parts[0], repo: parts[1] };
      }
    } catch (e) {
      console.error(`Error parsing repo URL '${url}':`, e);
      return null;
    }
    return null;
  }

  // TODO: Add method for cleaning up old branches (maybe based on local branches?)

  async getBackupBranchesFromTargetUrl(targetRepoUrl: string): Promise<string[]> {
    const octokit = this.octokit;
    if (!octokit) {
        console.warn("[GithubService] getBackupBranchesFromTargetUrl called when Octokit is not initialized.");
        return [];
    }

    const repoInfo = this.parseRepoUrl(targetRepoUrl);
    if (!repoInfo) {
        console.error(`[GithubService] Could not parse owner/repo from target URL: ${targetRepoUrl}`);
        return [];
    }

    const { owner, repo } = repoInfo;

    try {
      const refs = await octokit.paginate(octokit.git.listMatchingRefs, {
        owner,
        repo,
        ref: 'heads/v' // Fetch only branches starting with 'v'
      });

      // Extract branch names from refs
      const branchNames = refs.map((ref: { ref: string }) => ref.ref.replace(/^refs\/heads\//, ''));
      return branchNames;
    } catch (error: any) {
      console.error(`[GithubService] Error listing version branches for ${owner}/${repo}:`, error);
      vscode.window.showErrorMessage(`Failed to list version branches for ${owner}/${repo}: ${error.message}`);
      return [];
    }
  }
}