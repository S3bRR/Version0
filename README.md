# Version0 - GitHub Backup Extension

Version0 automatically creates versioned backup branches of your current workspace to a specified GitHub repository, providing a safety net for your development work.

## Features

- **Automatic Backups:** Periodically backs up your entire workspace at configurable intervals
- **Manual Backups:** Trigger backups on demand with optional notes
- **Create Private Repo:** Create a new private GitHub repository directly from the extension
- **Sync:** Verify GitHub authentication and repository accessibility
- **Versioned Branches:** Creates timestamped branches like `v1.0/YYYY-MM-DD_HH-mm-ss`, automatically incrementing versions
- **Push Current Branch:** Safely push your current working branch to your target backup repository
- **Restore:** Easily checkout and recover previous backup branches
- **Webview UI:** Configure settings, view backup branches, and trigger actions from the VS Code sidebar
- **GitHub Authentication:** Uses VS Code's built-in GitHub authentication for security

## Requirements

- VS Code 1.60.0 or later
- Git installed and available in your PATH
- GitHub account
- Internet connection for GitHub API access

## Setup

1. Click the Version0 icon in the VS Code activity bar
2. The extension will prompt you to authenticate with GitHub if needed
3. Configure your backup settings in the sidebar view:
   - **Set Backup Frequency:** Enter the interval in minutes (0 disables automatic backups)
   - **Set Target Repository URL:** Enter a GitHub repository URL (e.g., `https://github.com/your-username/backup-repo.git`)
   - **Create Private Repo:** Alternatively, click this button to create a new private repository and set it as your target

## Usage

### Configure Settings

In the Version0 sidebar:
- **Frequency (min):** Set the automatic backup interval (in minutes)
- **Target Repo URL:** Enter the GitHub repository URL where backup branches will be pushed
- **Create Private Repo:** Create a new private GitHub repository and set it as your target
- **Sync:** Verify authentication and repository accessibility

### Backup Operations

- **Backup Now:** Trigger an immediate backup of your workspace
  - Optional: Add notes to the backup when prompted for manual backups
- **Push Current Branch:** Push your active branch to the target repository
- **Restore from Backup:** Select a branch from the backup list to restore your workspace

## Advanced Configuration

Edit your VS Code settings (settings.json) to modify these options:

- `version0.targetBackupRepoUrl`: The URL of the GitHub repository for backups
- `version0.backupInterval`: Automatic backup interval in minutes (0 disables automatic backups)
- `version0.enableNotifications`: Show status notifications (default: true)
- `version0.autoStart`: Start automatic backups when VS Code starts (default: false)

## Commands

- **Version0: Start GitHub Backup** - Start the backup service
- **Version0: Trigger Manual Backup** - Manually trigger a backup
- **Version0: Authenticate with GitHub** - Manually trigger GitHub authentication
- **Version0: Open WebView** - Open the Version0 sidebar view

## Troubleshooting

### Authentication Issues
- If you encounter authentication problems, click the "Sync" button to verify your GitHub credentials
- You may need to reauthenticate using the command `Version0: Authenticate with GitHub`

### Git Repository Issues
- Ensure your workspace is a valid Git repository
- If backups fail with Git errors, try initializing the repository with `git init` followed by at least one commit
- The extension will offer to initialize Git if your workspace is not a repository

### Branch Creation Failures
- If you experience errors about existing branches, wait a few seconds and try again
- The extension automatically handles branch name collisions with unique timestamps

## Security

Version0 uses VS Code's built-in Authentication API to securely handle GitHub access via OAuth. Your credentials are managed by VS Code, not the extension directly.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Octokit.js](https://github.com/octokit/rest.js/) for GitHub API integration
- [VS Code API](https://code.visualstudio.com/api) for extension development

## Support

If you encounter any issues or have questions, please [file an issue](https://github.com/yourusernameS3bRR/version0/issues). 