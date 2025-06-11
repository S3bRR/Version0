import * as vscode from 'vscode';

// Configuration interfaces
export interface IVersion0Config {
  backupInterval: number;
  targetBackupRepoUrl?: string;
  enableNotifications: boolean;
  autoStart: boolean;
}

// GitHub interfaces
export interface IGitHubRepository {
  owner: string;
  repo: string;
  url: string;
  private: boolean;
}

export interface IGitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface IGitHubPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  createdAt: string;
  updatedAt: string;
  headBranch: string;
  baseBranch: string;
  url: string;
  mergeable: boolean | null;
  draft: boolean;
}

export interface IGitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  author: string;
  assignees: string[];
  labels: IGitHubLabel[];
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface IGitHubLabel {
  name: string;
  color: string;
  description?: string;
}

// Service interfaces
export interface IConfigManager {
  getGitHubToken(): Promise<string | undefined>;
  setGitHubToken(token: string): Promise<void>;
  getTargetBackupRepoUrl(): string | undefined;
  setTargetBackupRepoUrl(url: string): Promise<void>;
  getBackupInterval(): number;
  setBackupInterval(interval: number): Promise<void>;
  getEnableNotifications(): boolean;
  setEnableNotifications(enable: boolean): Promise<void>;
  getAutoStart(): boolean;
  setAutoStart(enable: boolean): Promise<void>;
}

export interface IGitHubService {
  authenticate(): Promise<boolean>;
  isAuthenticated(): Promise<boolean>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  getBackupBranchesFromTargetUrl(targetRepoUrl: string): Promise<string[]>;
  createPrivateRepository(name: string): Promise<{url?: string, error?: string}>;
  checkRepositoryAccess(repoUrl: string): Promise<{status: 'success' | 'error', message: string}>;
  getPullRequests(repoUrl: string): Promise<IGitHubPullRequest[]>;
  createPullRequest(repoUrl: string, title: string, body: string, headBranch: string, baseBranch: string): Promise<IGitHubPullRequest>;
  getIssues(repoUrl: string): Promise<IGitHubIssue[]>;
  createIssue(repoUrl: string, title: string, body: string): Promise<IGitHubIssue>;
}

export interface IBackupManager {
  start(): void;
  stop(): void;
  restartTimer(): void;
  triggerManualBackup(): Promise<void>;
  restoreFromBackup(branchName: string): Promise<void>;
  restoreLatestBackup(): Promise<void>;
  pushCurrentState(): Promise<{ branchName: string; pullRequestUrl?: string } | void>;
}

// Webview message interfaces
export interface IWebviewMessage {
  command: string;
  [key: string]: any;
}

export interface IWebviewResponse {
  command: string;
  success: boolean;
  data?: any;
  error?: string;
}

// UI State interfaces
export interface IUIState {
  isAuthenticated: boolean;
  hasTargetRepo: boolean;
  backupInterval: number;
  enableNotifications: boolean;
  autoStart: boolean;
  branches: string[];
  pullRequests: IGitHubPullRequest[];
  issues: IGitHubIssue[];
  loading: boolean;
  error?: string;
}

// Progress reporting
export interface IProgressReporter {
  report(progress: { increment?: number; message?: string }): void;
}

// Git operation results
export interface IBackupResult {
  success: boolean;
  branchName?: string;
  error?: string;
  timestamp: string;
}

export interface IRestoreResult {
  success: boolean;
  branchName?: string;
  error?: string;
  hasConflicts: boolean;
}