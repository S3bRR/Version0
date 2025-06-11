import * as vscode from 'vscode';

export enum ErrorType {
  AUTHENTICATION = 'authentication',
  NETWORK = 'network',
  GIT = 'git',
  CONFIGURATION = 'configuration',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown'
}

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  context?: string;
  action?: string;
  recoverable: boolean;
}

export class Version0Error extends Error {
  public readonly errorInfo: ErrorInfo;

  constructor(errorInfo: ErrorInfo) {
    super(errorInfo.message);
    this.name = 'Version0Error';
    this.errorInfo = errorInfo;
  }
}

export class ErrorHandler {
  private static instance: ErrorHandler;

  private constructor() {}

  public static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  public handleError(error: unknown, context?: string): ErrorInfo {
    const errorInfo = this.analyzeError(error, context);
    this.reportError(errorInfo);
    return errorInfo;
  }

  private analyzeError(error: unknown, context?: string): ErrorInfo {
    if (error instanceof Version0Error) {
      return error.errorInfo;
    }

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      
      // Authentication errors
      if (message.includes('authentication') || 
          message.includes('unauthorized') || 
          message.includes('token') ||
          message.includes('401') ||
          message.includes('403')) {
        return {
          type: ErrorType.AUTHENTICATION,
          message: 'GitHub authentication required. Please check your token.',
          context,
          action: 'Please authenticate with GitHub or update your token.',
          recoverable: true
        };
      }

      // Network errors
      if (message.includes('network') || 
          message.includes('fetch') || 
          message.includes('connection') ||
          message.includes('timeout') ||
          message.includes('enotfound') ||
          message.includes('econnreset')) {
        return {
          type: ErrorType.NETWORK,
          message: 'Network connection failed. Please check your internet connection.',
          context,
          action: 'Check your internet connection and try again.',
          recoverable: true
        };
      }

      // Git errors
      if (message.includes('git') || 
          message.includes('repository') || 
          message.includes('branch') ||
          message.includes('commit') ||
          message.includes('merge')) {
        return {
          type: ErrorType.GIT,
          message: `Git operation failed: ${error.message}`,
          context,
          action: 'Check your git repository status and try again.',
          recoverable: true
        };
      }

      // Configuration errors
      if (message.includes('configuration') || 
          message.includes('settings') || 
          message.includes('url') ||
          message.includes('invalid')) {
        return {
          type: ErrorType.CONFIGURATION,
          message: `Configuration error: ${error.message}`,
          context,
          action: 'Please check your extension settings.',
          recoverable: true
        };
      }

      // Validation errors
      if (message.includes('validation') || 
          message.includes('required') || 
          message.includes('empty') ||
          message.includes('format')) {
        return {
          type: ErrorType.VALIDATION,
          message: `Validation error: ${error.message}`,
          context,
          action: 'Please check your input and try again.',
          recoverable: true
        };
      }

      // Unknown error
      return {
        type: ErrorType.UNKNOWN,
        message: error.message || 'An unknown error occurred',
        context,
        action: 'Please try again or check the logs for more details.',
        recoverable: false
      };
    }

    // Non-Error objects
    return {
      type: ErrorType.UNKNOWN,
      message: typeof error === 'string' ? error : 'An unknown error occurred',
      context,
      action: 'Please try again or check the logs for more details.',
      recoverable: false
    };
  }

  private reportError(errorInfo: ErrorInfo): void {
    const contextMessage = errorInfo.context ? ` (${errorInfo.context})` : '';
    const fullMessage = `Version0: ${errorInfo.message}${contextMessage}`;
    
    console.error(`[Version0 Error] ${errorInfo.type}: ${errorInfo.message}`, {
      context: errorInfo.context,
      recoverable: errorInfo.recoverable,
      action: errorInfo.action
    });

    // Show appropriate user notification based on error type
    switch (errorInfo.type) {
      case ErrorType.AUTHENTICATION:
        vscode.window.showErrorMessage(
          fullMessage,
          'Authenticate',
          'Settings'
        ).then(selection => {
          if (selection === 'Authenticate') {
            vscode.commands.executeCommand('version0.authenticateGitHub');
          } else if (selection === 'Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:v0Design.version0');
          }
        });
        break;

      case ErrorType.NETWORK:
        vscode.window.showWarningMessage(
          fullMessage,
          'Retry'
        ).then(selection => {
          if (selection === 'Retry') {
            // Could implement retry logic here
          }
        });
        break;

      case ErrorType.CONFIGURATION:
        vscode.window.showErrorMessage(
          fullMessage,
          'Open Settings'
        ).then(selection => {
          if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:v0Design.version0');
          }
        });
        break;

      case ErrorType.VALIDATION:
        vscode.window.showWarningMessage(fullMessage);
        break;

      case ErrorType.GIT:
        vscode.window.showErrorMessage(
          fullMessage,
          'Show Output'
        ).then(selection => {
          if (selection === 'Show Output') {
            vscode.commands.executeCommand('workbench.action.output.toggleOutput');
          }
        });
        break;

      default:
        if (errorInfo.recoverable) {
          vscode.window.showWarningMessage(fullMessage);
        } else {
          vscode.window.showErrorMessage(fullMessage);
        }
    }
  }

  public createError(type: ErrorType, message: string, context?: string, recoverable = true): Version0Error {
    return new Version0Error({
      type,
      message,
      context,
      recoverable
    });
  }

  public async withProgress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      async (progress) => {
        try {
          return await task(progress);
        } catch (error) {
          this.handleError(error, title);
          throw error;
        }
      }
    );
  }

  public async withErrorBoundary<T>(
    operation: () => Promise<T>,
    context?: string,
    defaultValue?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.handleError(error, context);
      return defaultValue;
    }
  }
}