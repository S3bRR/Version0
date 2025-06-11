# Version0 - GitHub Backup Extension for VS Code

![Version0 Logo](Version0_image.png)

Version0 is a powerful VS Code extension that automatically creates backup branches on GitHub repositories, making it easier to manage your development workflow with seamless GitHub integration.

## 🚀 Features

### Core Backup Functionality
- **Automated Backup System**: Configurable interval-based backups (default: 9999 minutes)
- **Manual Backup Triggers**: Instant backup on-demand
- **Branch-based Backups**: Each backup creates a unique timestamped branch
- **Restore from Backups**: Easy restoration from any backup branch
- **Session-only Target Repository**: Target repo URL resets each VS Code session for security

### GitHub Integration
- **Smart Authentication**: VS Code OAuth (when available) + Manual GitHub PAT fallback
- **Cross-IDE Compatibility**: Works seamlessly in VS Code, Cursor IDE, and other forks
- **Repository Management**: Create private repositories directly from the extension
- **Branch Management**: View and manage backup branches
- **Repository Access Verification**: Automatic sync and access checks
- **Pull Request Support**: Create and manage pull requests (planned feature)
- **Issue Management**: Create and track issues (planned feature)

### Modern UI/UX
- **VS Code Design System**: Follows VS Code's native design tokens
- **Responsive Interface**: Works seamlessly in the sidebar
- **Real-time Status Updates**: Live feedback on all operations
- **Progress Indicators**: Visual progress for long-running operations
- **Accessibility Features**: Full keyboard navigation and screen reader support

### Developer Experience
- **TypeScript-First**: Comprehensive type safety throughout
- **Service-Oriented Architecture**: Clean separation of concerns
- **Centralized Error Handling**: User-friendly error messages with suggested actions
- **Extensive Logging**: Detailed logging for debugging
- **Webpack Build System**: Optimized production builds

## 📦 Installation

### From VS Code Marketplace (Coming Soon)
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Version0"
4. Click Install

### Manual Installation (VS Code & Cursor IDE)
1. Download the latest `.vsix` file from releases
2. **For VS Code**: Press `Ctrl+Shift+P` and type "Extensions: Install from VSIX"
3. **For Cursor**: Go to Extensions → "..." menu → "Install from VSIX"
4. Select the downloaded `.vsix` file

### From Source
```bash
git clone https://github.com/S3bRR/Version0.git
cd Version0
npm install
npm run package
code --install-extension version0-*.vsix
```

## 🔧 Setup & Configuration

### 1. GitHub Authentication

**VS Code Users:**
- Open the Version0 sidebar panel
- Click "Connect with GitHub"
- Authorize VS Code to access your GitHub account
- The extension will automatically use VS Code's built-in GitHub authentication

**Cursor IDE Users:**
- Open the Version0 sidebar panel
- You'll see a "GitHub Personal Access Token" input field
- Click "How to create a GitHub Personal Access Token" for detailed instructions
- Create a GitHub PAT with `repo` and `read:user` scopes
- Paste the token and click "Save Token"

### 2. Configure Target Repository
- In the Version0 panel, enter your target repository URL
- Format: `https://github.com/username/repository.git`
- Click "Save" to set the target repository
- **Note**: Target repository URL is session-only and will reset when VS Code restarts

### 3. Set Backup Frequency
- Default is set to 9999 minutes (nearly 7 days)
- Adjust the frequency in minutes as needed
- Lower values = more frequent backups
- Set to a very high number to effectively disable automatic backups

## 📖 Usage

### Basic Workflow

1. **Start Backup Service**
   - Open Command Palette (`Ctrl+Shift+P`)
   - Run "Version0: Start GitHub Backup"
   - Or use the sidebar interface

2. **Manual Backup**
   - Click "Backup Now" in the sidebar
   - Or run "Version0: Trigger Manual Backup" from Command Palette
   - Creates a timestamped branch with current workspace state

3. **Repository Sync**
   - Click "Sync" to verify repository access
   - Checks authentication and repository permissions
   - Refreshes available backup branches

4. **Restore from Backup**
   - View available backup branches in the sidebar
   - Click "Restore" next to any branch
   - Confirm the restoration (will overwrite local changes)
   - Optionally reload VS Code window after restoration

### Advanced Features

#### Creating New Repositories
- Click "Create Private Repo" in the sidebar
- Enter repository name
- Extension creates the repository and sets it as target

#### Branch Management
- View all backup branches in the sidebar
- Branches are named with timestamps for easy identification
- Each backup preserves the complete workspace state

#### Error Handling
- Comprehensive error categorization (Authentication, Network, Git, Configuration, Validation)
- User-friendly error messages with suggested actions
- Automatic retry mechanisms where appropriate

## ⚙️ Configuration Options

Access settings via `File > Preferences > Settings` and search for "Version0":

| Setting | Default | Description |
|---------|---------|-------------|
| `version0.backupInterval` | 9999 | Backup interval in minutes |
| `version0.targetBackupRepoUrl` | "" | Target repository URL (session-only) |
| `version0.enableNotifications` | true | Show backup status notifications |
| `version0.autoStart` | false | Auto-start backup service on activation |

## 🏗️ Architecture

### Service Layer
- **ConfigManager**: Handles all configuration and settings
- **GitHubService**: GitHub API integration with Octokit
- **BackupManager**: Git operations and backup logic
- **ErrorHandler**: Centralized error management

### UI Layer
- **WebviewProvider**: Main interface using VS Code webview API
- **Modern CSS**: Custom properties and VS Code design tokens
- **JavaScript**: Event handling and real-time updates

### Type Safety
- **Comprehensive Interfaces**: Full TypeScript coverage
- **Service Contracts**: Well-defined interfaces for all services
- **Error Types**: Categorized error handling

## 🛠️ Development

### Prerequisites
- Node.js 14.x or higher
- VS Code 1.60.0 or higher
- Git

### Building from Source
```bash
# Clone the repository
git clone https://github.com/S3bRR/Version0.git
cd Version0

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes during development
npm run watch

# Build production package
npm run package

# Run linting
npm run lint
```

### Project Structure
```
Version0/
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── services/             # Business logic services
│   │   ├── backupManager.ts
│   │   ├── configManager.ts
│   │   └── githubService.ts
│   ├── ui/                   # User interface
│   │   └── Version0WebviewProvider.ts
│   ├── utils/                # Utilities
│   │   └── errorHandler.ts
│   └── types/                # TypeScript interfaces
│       └── interfaces.ts
├── media/                    # CSS and static assets
├── resources/                # Icons and resources
├── test/                     # Test files
└── dist/                     # Compiled output
```

### Key Dependencies
- **@octokit/rest**: GitHub API client
- **simple-git**: Git operations
- **moment**: Date/time handling
- **webpack**: Module bundling
- **typescript**: Type safety

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow TypeScript best practices
- Maintain comprehensive error handling
- Update tests for new features
- Follow VS Code extension guidelines
- Ensure accessibility compliance

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Issues & Support

- **Bug Reports**: [GitHub Issues](https://github.com/S3bRR/Version0/issues)
- **Feature Requests**: [GitHub Issues](https://github.com/S3bRR/Version0/issues)
- **Documentation**: [GitHub Wiki](https://github.com/S3bRR/Version0/wiki)

## 🎯 Roadmap

### Current Version (v0.1.5)
- ✅ Automated backup system
- ✅ GitHub authentication integration
- ✅ Repository management
- ✅ Branch-based backups and restoration
- ✅ Modern UI with VS Code design tokens

### Upcoming Features
- 🔄 Pull Request management UI
- 🔄 Issue tracking integration
- 🔄 Conflict resolution tools
- 🔄 Backup scheduling improvements
- 🔄 Team collaboration features

## 📊 Technical Specifications

- **IDE Compatibility**: VS Code 1.60.0+, Cursor IDE, other VS Code forks
- **Authentication**: VS Code OAuth (when available) + Manual GitHub PAT fallback
- **Node.js Compatibility**: 14.x+
- **TypeScript Version**: 4.3.2
- **Bundle Size**: ~800KB (optimized)
- **Memory Usage**: <50MB typical
- **Platform Support**: Windows, macOS, Linux

## 🙏 Acknowledgments

- VS Code team for the excellent extension API
- GitHub for the comprehensive REST API
- The open-source community for inspiration and feedback

---

**Made with ❤️ by v0Design**

For more information, visit our [GitHub repository](https://github.com/S3bRR/Version0). 