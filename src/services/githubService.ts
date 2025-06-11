import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';
import { ConfigManager } from './configManager';
import { IGitHubPullRequest, IGitHubIssue, IGitHubLabel } from '../types/interfaces';

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

  // Pull Request Management
  public async getPullRequests(repoUrl: string): Promise<IGitHubPullRequest[]> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        return [];
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      return [];
    }

    const { owner, repo } = repoInfo;
    try {
      const response = await this.octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: 50
      });

      return response.data.map(pr => ({
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        state: pr.state as 'open' | 'closed' | 'merged',
        author: pr.user?.login || 'unknown',
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        url: pr.html_url,
        mergeable: (pr as any).mergeable || false,
        draft: pr.draft || false
      }));
    } catch (error: any) {
      console.error(`Failed to fetch pull requests for ${owner}/${repo}:`, error);
      return [];
    }
  }

  public async createPullRequest(
    repoUrl: string,
    title: string,
    body: string,
    headBranch: string,
    baseBranch = 'main'
  ): Promise<IGitHubPullRequest | null> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        throw new Error('GitHub authentication required');
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      throw new Error('Invalid repository URL');
    }

    const { owner, repo } = repoInfo;
    try {
      const response = await this.octokit.pulls.create({
        owner,
        repo,
        title,
        body,
        head: headBranch,
        base: baseBranch
      });

      return {
        number: response.data.number,
        title: response.data.title,
        body: response.data.body || '',
        state: response.data.state as 'open' | 'closed' | 'merged',
        author: response.data.user?.login || 'unknown',
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
        headBranch: response.data.head.ref,
        baseBranch: response.data.base.ref,
        url: response.data.html_url,
        mergeable: (response.data as any).mergeable || false,
        draft: response.data.draft || false
      };
    } catch (error: any) {
      throw new Error(`Failed to create pull request: ${error.message}`);
    }
  }

  public async mergePullRequest(repoUrl: string, prNumber: number, mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<boolean> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        throw new Error('GitHub authentication required');
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      throw new Error('Invalid repository URL');
    }

    const { owner, repo } = repoInfo;
    try {
      await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: mergeMethod
      });
      return true;
    } catch (error: any) {
      throw new Error(`Failed to merge pull request: ${error.message}`);
    }
  }

  // Issue Management
  public async getIssues(repoUrl: string): Promise<IGitHubIssue[]> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        return [];
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      return [];
    }

    const { owner, repo } = repoInfo;
    try {
      const response = await this.octokit.issues.listForRepo({
        owner,
        repo,
        state: 'open',
        sort: 'updated',
        direction: 'desc',
        per_page: 50,
        filter: 'all'
      });

      return response.data
        .filter(issue => !issue.pull_request) // Filter out pull requests
        .map(issue => ({
          number: issue.number,
          title: issue.title,
          body: issue.body || '',
          state: issue.state as 'open' | 'closed',
          author: issue.user?.login || 'unknown',
          assignees: issue.assignees?.map(assignee => assignee.login) || [],
          labels: issue.labels?.map(label => ({
            name: typeof label === 'string' ? label : label.name || '',
            color: typeof label === 'string' ? '' : label.color || '',
            description: typeof label === 'string' ? '' : label.description || ''
          })) || [],
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          url: issue.html_url
        }));
    } catch (error: any) {
      console.error(`Failed to fetch issues for ${owner}/${repo}:`, error);
      return [];
    }
  }

  public async createIssue(
    repoUrl: string,
    title: string,
    body: string,
    labels: string[] = [],
    assignees: string[] = []
  ): Promise<IGitHubIssue | null> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        throw new Error('GitHub authentication required');
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      throw new Error('Invalid repository URL');
    }

    const { owner, repo } = repoInfo;
    try {
      const response = await this.octokit.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
        assignees
      });

      return {
        number: response.data.number,
        title: response.data.title,
        body: response.data.body || '',
        state: response.data.state as 'open' | 'closed',
        author: response.data.user?.login || 'unknown',
        assignees: response.data.assignees?.map(assignee => assignee.login) || [],
        labels: response.data.labels?.map(label => ({
          name: typeof label === 'string' ? label : label.name || '',
          color: typeof label === 'string' ? '' : label.color || '',
          description: typeof label === 'string' ? '' : label.description || ''
        })) || [],
        createdAt: response.data.created_at,
        updatedAt: response.data.updated_at,
        url: response.data.html_url
      };
    } catch (error: any) {
      throw new Error(`Failed to create issue: ${error.message}`);
    }
  }

  public async closeIssue(repoUrl: string, issueNumber: number): Promise<boolean> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        throw new Error('GitHub authentication required');
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      throw new Error('Invalid repository URL');
    }

    const { owner, repo } = repoInfo;
    try {
      await this.octokit.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        state: 'closed'
      });
      return true;
    } catch (error: any) {
      throw new Error(`Failed to close issue: ${error.message}`);
    }
  }

  // Repository information
  public async getCurrentRepository(): Promise<{ owner: string; repo: string; url: string } | null> {
    // Try to get current repository from workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return null;
    }

    try {
      // Try to get remote origin URL using VS Code's git extension
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        return null;
      }

      await gitExtension.activate();
      const git = gitExtension.exports.getAPI(1);
      
      if (git.repositories.length === 0) {
        return null;
      }

      const repository = git.repositories[0];
      const remotes = repository.state.remotes;
      const origin = remotes.find((remote: any) => remote.name === 'origin');
      
      if (!origin || !origin.fetchUrl) {
        return null;
      }

      const repoInfo = this.parseRepoUrl(origin.fetchUrl);
      if (!repoInfo) {
        return null;
      }

      return {
        owner: repoInfo.owner,
        repo: repoInfo.repo,
        url: origin.fetchUrl
      };
    } catch (error) {
      console.error('Failed to get current repository:', error);
      return null;
    }
  }

  public async getRepositoryLabels(repoUrl: string): Promise<IGitHubLabel[]> {
    if (!this.octokit) {
      await this.initializeOctokit();
      if (!this.octokit) {
        return [];
      }
    }

    const repoInfo = this.parseRepoUrl(repoUrl);
    if (!repoInfo) {
      return [];
    }

    const { owner, repo } = repoInfo;
    try {
      const response = await this.octokit.issues.listLabelsForRepo({
        owner,
        repo,
        per_page: 100
      });

      return response.data.map(label => ({
        name: label.name,
        color: label.color,
        description: label.description || ''
      }));
    } catch (error: any) {
      console.error(`Failed to fetch labels for ${owner}/${repo}:`, error);
      return [];
    }
  }
}