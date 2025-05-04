# Version0 - GitHub Backup Extension

Automatically creates versioned backup branches of your current workspace to a specified GitHub repository.

**Features:**

*   **Automatic Backups:** Periodically backs up your entire workspace.
*   **Manual Backups:** Trigger backups on demand with optional notes.
*   **Local Git Operations:** Uses standard `git` commands locally.
*   **Versioned Branches:** Creates branches like `v1.0/YYYY-MM-DD_HH-mm`, automatically incrementing the version.
*   **Target Repository:** Pushes backups to a single configured remote GitHub repository (using HTTPS or SSH URL).
*   **Restore:** Easily checkout previous backup branches.
*   **Push Current Branch:** Safely commit and push your current working branch, with an option to open a Pull Request URL.
*   **Webview UI:** Configure settings, view backup branches, and trigger actions from the VS Code sidebar.
*   **GitHub Authentication:** Uses VS Code's built-in GitHub authentication.

**Usage:**

1.  Install the extension.
2.  Open the Version0 view in the VS Code activity bar.
3.  Authenticate with GitHub if prompted.
4.  Set the **Target Repo URL** (e.g., `https://github.com/your-username/my-backup-repo.git`) in the view. Ensure this repository exists on GitHub.
5.  Set the desired **Backup Frequency** (in minutes).
6.  Use the buttons to "Backup Now", "Push Current Branch", or refresh/restore from the branch list.

**Configuration:**

*   `version0.targetBackupRepoUrl`: The URL of the GitHub repository for backups.
*   `version0.backupInterval`: Automatic backup interval in minutes (0 disables automatic backups).
*   `version0.enableNotifications`: Show status notifications (default: true).
*   `version0.autoStart`: Start automatic backups when VS Code starts (default: false).

**Requirements:**

*   `git` command-line tool installed and in your system's PATH.
*   A GitHub account.

**License:**

[MIT](LICENSE)

## Features

Version0 automatically creates backup branches on GitHub repositories at specified intervals, providing a safety net for your development work.

- **Automatic Backups**: Create timestamped backup branches at user-defined intervals
- **Backup Notes**: Add descriptive notes with each backup for future reference
- **Flexible Configuration**: Customize backup intervals, branch naming patterns, and more
- **Repository Management**: Easily add, remove, and manage repositories to back up
- **GitHub Integration**: Seamless integration with GitHub repositories
- **Auto-Cleanup**: Optional automatic cleanup of old backup branches

## Requirements

- VS Code 1.60.0 or later
- GitHub account
- Internet connection to communicate with GitHub API

## Installation

1. Download the `.vsix` file from the [releases page](https://github.com/yourusername/version0/releases/latest)
2. Open VS Code
3. Go to Extensions view (Ctrl+Shift+X)
4. Click the "..." menu and select "Install from VSIX..."
5. Select the downloaded `.vsix` file

## Setup

1. After installation, click the Version0 icon in the activity bar or run a Version0 command (e.g., `Version0: Add Repository to Backup`).
2. If prompted by VS Code, authorize the extension to access your GitHub account. This uses VS Code's built-in secure authentication.
3. Use the command `Version0: Add Repository to Backup` to add your first GitHub repository.
4. Configure backup settings via the `Version0: Show Settings` command or the standard VS Code settings UI (search for "Version0").

## Usage

### Adding Repositories

1. Click the Version0 icon in the activity bar
2. Click "Add Repository" in the view
3. Enter the GitHub repository URL (e.g., `https://github.com/owner/repo`)

### Managing Backups

- **Manual Backup**: Right-click on a repository in the Version0 view and select "Backup Now"
- **Automatic Backups**: Once configured, backups will trigger automatically at the specified interval
- **Skip Backup**: When a backup notification appears, click "Skip this time" to postpone until next interval

### Configuration Options

Access settings via the gear icon in the Version0 view:

- **Backup Interval**: Time between automatic backups (default: 30 minutes)
- **Branch Prefix**: Prefix for backup branch names (default: "backup")
- **Maximum Backups**: Maximum number of backup branches to retain (default: 10)
- **Auto-Cleanup**: Enable automatic removal of old backup branches
- **Notifications**: Enable/disable backup notification prompts
- **Auto-Start**: Start backup service automatically on extension activation

## Commands

- **Version0: Start GitHub Backup** - Start the backup service
- **Version0: Add Repository to Backup** - Add a new repository to monitor
- **Version0: Trigger Manual Backup** - Manually trigger a backup for a selected repository
- **Version0: Show Settings** - Open the settings panel
- **Version0: Authenticate with GitHub** - Manually trigger the GitHub authentication flow if needed.

## Security

Version0 uses VS Code's built-in Authentication API to securely handle GitHub access via OAuth. Your credentials are managed by VS Code, not the extension directly.

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Octokit.js](https://github.com/octokit/rest.js/) for GitHub API integration
- [VS Code API](https://code.visualstudio.com/api) for extension development

## Support

If you encounter any issues or have questions, please [file an issue](https://github.com/yourusername/version0/issues). 