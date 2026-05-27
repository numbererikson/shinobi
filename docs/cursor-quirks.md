# Cursor adapter — quirks log

Cursor is a Visual Studio Code fork, so the Shinobi VS Code extension runs
unchanged. We ship a separate `.vsix` (different display name + publisher
slot) so the listing does not collide on the Cursor extension marketplace
with the VS Code build. The source code is identical — see
`vscode-extension/scripts/build-cursor.js`.

This file collects any Cursor-specific gotchas worth knowing.

## What works the same

- Activity bar container + tree data providers — Cursor renders them
  identically to VS Code.
- StatusBarItem, ThemeIcon, QuickPick, showInformationMessage modals.
- `vscode.env.openExternal()` opens links in the user's default browser.
- Workspace configuration sync — `shinobi.activeProjectId` set in VS Code
  is *not* shared with Cursor (different settings backing store).

## Known quirks

> Add entries here as they surface during real Cursor usage.

- *(none yet — first packaged 2026-05-24)*

## How to package

```sh
cd vscode-extension
npm install
npm run package:cursor
# Produces shinobi-cursor-0.1.0.vsix in the vscode-extension/ directory.
```

Install in Cursor via ⌃⇧P → "Extensions: Install from VSIX...".

## Why not a separate repo?

The diff between the two manifests is ~10 lines and the source code is
100% shared. A separate repo would double the maintenance overhead for
zero functional gain. If Cursor ever forks its extension API in a way
that requires meaningful divergence, split at that point.
