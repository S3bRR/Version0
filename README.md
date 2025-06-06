# Version0 – GitHub Backup Extension for VS Code

![Version0 Logo](Version0_image.png)

> Automatically create time-stamped backup branches of your current workspace in a GitHub repository.

---

## Features

- **Automatic Backups** – Periodically backup your entire workspace at a configurable interval.
- **Manual Backups** – Trigger a backup on demand with one click.
- **Create Private Repo** – Create a new private GitHub repository directly from the sidebar.
- **Sync** – Verify GitHub authentication and repository access before backing up.
- **Versioned Branches** – Branch names follow `v1.0/YYYY-MM-DD_HH-mm-ss`, automatically incrementing version numbers.
- **Push Current Branch** – Push your current working branch as a backup branch.
- **Restore** – Checkout and restore from any available backup branch.
- **Restore Latest** – Quickly restore the most recent backup branch.
- **Webview UI** – Configure settings, view branches, and trigger actions in a modern sidebar.
- **GitHub Authentication** – Seamlessly uses VS Code's built-in GitHub authentication flow.

## Requirements

- VS Code **1.60** or later
- **Git** installed and available in your PATH
- A **GitHub** account with repo permissions
- Internet access for GitHub API calls

## Installation

### From the Marketplace

1. Open the **Extensions** view in VS Code (`⇧⌘X` / `Ctrl+Shift+X`).
2. Search for **Version0** by `v0design` and click **Install**.
3. Reload or restart VS Code if prompted.

### From a VSIX Package

```bash
npm install -g vsce            # if you don't already have vsce installed
vsce package                   # Builds version0-<version>.vsix
code --install-extension version0-<version>.vsix
```

## Usage

1. Click the **Version0** icon in the Activity Bar to open the sidebar.
2. **Connect with GitHub**: Click the button and complete the VS Code GitHub authentication prompt.
3. **Configure**:
   - **Frequency** – Enter a backup interval in minutes and click **Save**.
   - **Target Repo** – Paste an existing GitHub repo URL or click **Create Private Repo**.
4. Use buttons to:
   - **Sync** – Confirm your token and repo access.
   - **Backup Now** – Trigger an immediate backup.
   - **Push Current Branch** – Push the current branch to your backup repo.
5. **Backup Branches**: View a list of generated branches, and click **Restore** next to any branch to recover your workspace.

## Commands

You can also run these commands via the **Command Palette** (`⇧⌘P` / `Ctrl+Shift+P`):

- `Version0: Start` – Begin the automatic backup timer.
- `Version0: Trigger Backup` – Show a reminder to use the **Backup Now** button.
- `Version0: Restore Latest Backup` – Restore your workspace from the most recent backup branch.

## Configuration

Settings are available in **Settings** (`⌘,` / `Ctrl+,`) under **Extensions › Version0**:

- **version0.backupInterval** (number) – Backup interval in minutes.
- **version0.autoStart** (boolean) – Automatically start backups when VS Code launches.

## Contributing

Contributions are welcome! Please fork the repo, make your changes, and open a pull request.

1. Clone the repository: `git clone https://github.com/YourUser/Version0.git`
2. Install dependencies: `npm install`
3. Develop, test, and lint: `npm run vscode:prepublish && npm test`
4. Submit your pull request.

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [Octokit.js](https://github.com/octokit/rest.js/) for GitHub API integration
- [VS Code API](https://code.visualstudio.com/api) for extension development

## Support

If you encounter any issues or have questions, please [file an issue](https://github.com/yourusernameS3bRR/version0/issues). 