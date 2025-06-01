import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { ConfigManager } from './configManager';

export class GithubService implements vscode.Disposable {
  private octokit: Octokit | undefined;
  private configManager: ConfigManager;

  constructor(configManager: ConfigManager) {
    this.configManager = configManager;
    // Initialize Octokit if token exists
    this.initializeOctokit();
  }

  dispose() {
    // No status bar to dispose
  }

  /**
   * Initialize the GitHub client using a stored token
   */
  private async initializeOctokit(): Promise<void> {
    const token = await this.configManager.getGitHubToken();
    if (token) {
      this.octokit = new Octokit({ auth: token });
    } else {
      this.octokit = undefined;
    }
  }

  /**
   * Set the GitHub token and re-initialize Octokit
   */
  async setToken(token: string): Promise<void> {
    await this.configManager.setGitHubToken(token);
    await this.initializeOctokit();
  }

  /**
   * Remove the GitHub token and de-initialize Octokit
   */
  async clearToken(): Promise<void> {
    await this.configManager.setGitHubToken('');
    this.octokit = undefined;
  }

  /**
   * Authenticate with GitHub by checking if a token is set
   * If not, prompt the user to enter a token (handled in UI)
   */
  async authenticate(): Promise<boolean> {
    const token = await this.configManager.getGitHubToken();
    if (!token) {
      vscode.window.showErrorMessage('No GitHub token found. Please set your Personal Access Token in the Version0 sidebar.');
      return false;
    }
    await this.initializeOctokit();
    // Test the token
    try {
      await this.octokit!.users.getAuthenticated();
      return true;
    } catch (error) {
      vscode.window.showErrorMessage('GitHub authentication failed: Invalid or expired token. Please update your token.');
      return false;
    }
  }

  /**
   * Check if authenticated with GitHub (token exists and is valid)
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.configManager.getGitHubToken();
    if (!token) return false;
    if (!this.octokit) await this.initializeOctokit();
    try {
      await this.octokit!.users.getAuthenticated();
      return true;
    } catch {
      return false;
    }
  }

  // Utility to parse owner/repo from URL
  private parseRepoUrl(url: string): { owner: string; repo: string } | null {
    try {
      if (url.startsWith('https:')) {
        const urlObj = new URL(url);
        if (urlObj.hostname !== 'github.com') return null;
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        if (pathParts.length < 2) return null;
        const repoName = pathParts[1].endsWith('.git') ? pathParts[1].slice(0, -4) : pathParts[1];
        return { owner: pathParts[0], repo: repoName };
      } else if (url.startsWith('git@')) {
        const parts = url.split(':');
        if (parts.length !== 2) return null;
        const hostPart = parts[0];
        const pathPart = parts[1];
        if (!hostPart.endsWith('@github.com')) return null;
        const pathParts = pathPart.split('/').filter(Boolean);
        if (pathParts.length < 2) return null;
        const repoName = pathParts[1].endsWith('.git') ? pathParts[1].slice(0, -4) : pathParts[1];
        return { owner: pathParts[0], repo: repoName };
      } else if (url.includes('/') && url.split('/').length === 2 && !url.startsWith('http') && !url.startsWith('git@')) {
        const parts = url.split('/');
        return { owner: parts[0], repo: parts[1].endsWith('.git') ? parts[1].slice(0, -4) : parts[1] };
      }
    } catch (e) {
      console.error(`Error parsing repo URL '${url}':`, e);
      return null;
    }
    return null;
  }

  async getBackupBranchesFromTargetUrl(targetRepoUrl: string): Promise<string[]> {
    const octokit = this.octokit;
    if (!octokit) {
      return [];
    }
    const repoInfo = this.parseRepoUrl(targetRepoUrl);
    if (!repoInfo) {
      return [];
    }
    const { owner, repo } = repoInfo;
    try {
      // Fetch all branches from the remote repository to be presented as potential backup sources.
      const refs = await octokit.paginate(octokit.git.listMatchingRefs, {
        owner,
        repo,
        ref: 'heads/'
      });
      const branchNames = refs.map((ref: { ref: string }) => ref.ref.replace(/^refs\/heads\//, ''));
      return branchNames;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to list version branches for ${owner}/${repo}: ${error.message}`);
      return [];
    }
  }

  public async createPrivateRepository(name: string): Promise<{url?: string, error?: string}> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        return { error: 'GitHub authentication required. Please set your token first.' };
      }
    }
    try {
      const response = await this.octokit.repos.createForAuthenticatedUser({ 
        name, 
        private: true,
        auto_init: true
      });
      return { url: response.data.html_url };
    } catch (error: any) {
      return { error: `Failed to create repository: ${error.message}` };
    }
  }

  public async checkRepositoryAccess(repoUrl: string): Promise<{status: 'success' | 'error', message: string}> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        return { status: 'error', message: 'GitHub authentication required. Please set your token first.' };
      }
    }
    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      return { status: 'error', message: `Invalid Target Repo URL format: ${repoUrl}` };
    }
    const { owner, repo } = repoInfo;
    try {
      await this.octokit.repos.get({ owner, repo });
      return { status: 'success', message: 'Repository accessible.' };
    } catch (error: any) {
      if (error.status === 404) {
        return { status: 'error', message: `Repository not found: ${owner}/${repo}` };
      } else if (error.status === 403 || error.status === 401) {
        return { status: 'error', message: `Access denied to repository: ${owner}/${repo}. Check token permissions.` };
      }
      return { status: 'error', message: `Failed to access repository ${owner}/${repo}: ${error.message}` };
    }
  }
}