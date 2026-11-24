//! The capability files, read as Tauri reads them: every write permission of
//! plugin-fs carries the same deny list, and that list keeps the window out
//! of the places `paths::is_protected` names. The patterns are matched with
//! the glob crate and options Tauri's scope uses.

use std::path::{Path, PathBuf};

use serde_json::Value;

const WRITE_PERMISSIONS: [&str; 6] = [
    "fs:allow-remove",
    "fs:allow-rename",
    "fs:allow-mkdir",
    "fs:allow-write-text-file",
    "fs:allow-write-file",
    "fs:allow-copy-file",
];

fn capability(name: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("capabilities")
        .join(name);
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn permissions(capability: &Value) -> &Vec<Value> {
    capability["permissions"].as_array().unwrap()
}

fn identifier(permission: &Value) -> &str {
    permission
        .as_str()
        .or_else(|| permission["identifier"].as_str())
        .unwrap()
}

fn paths_of(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["path"].as_str().unwrap().to_string())
        .collect()
}

/// The deny list every write permission of the file shares.
fn write_denies(file: &str) -> Vec<String> {
    let capability = capability(file);
    let granted: Vec<&str> = permissions(&capability).iter().map(identifier).collect();
    assert_eq!(granted, WRITE_PERMISSIONS, "{file}");
    let lists: Vec<Vec<String>> = permissions(&capability)
        .iter()
        .map(|permission| paths_of(&permission["deny"]))
        .collect();
    assert!(lists.windows(2).all(|pair| pair[0] == pair[1]), "{file}");
    lists.into_iter().next().unwrap()
}

/// `tauri::scope::fs` options with this app's `requireLiteralLeadingDot: false`.
const MATCH: glob::MatchOptions = glob::MatchOptions {
    case_sensitive: true,
    require_literal_separator: true,
    require_literal_leading_dot: false,
};

fn denied(patterns: &[String], home: &str, documents: &str, path: &str) -> bool {
    patterns.iter().any(|pattern| {
        let pattern = pattern
            .replace("$HOME", home)
            .replace("$DOCUMENT", documents);
        let pattern: PathBuf = Path::new(&pattern).components().collect();
        glob::Pattern::new(&pattern.to_string_lossy())
            .unwrap()
            .matches_path_with(Path::new(path), MATCH)
    })
}

#[test]
fn the_window_cannot_change_files_through_the_default_capability() {
    let default = capability("default.json");
    for permission in permissions(&default) {
        let id = identifier(permission);
        assert!(!WRITE_PERMISSIONS.contains(&id), "{id}");
        // files are opened by `launch::open_path`, which asks first
        assert_ne!(id, "opener:allow-open-path");
        assert!(!id.starts_with("fs:allow-write") && !id.starts_with("fs:write"), "{id}");
    }
}

#[test]
fn macos_writes_stay_out_of_library_and_dot_entries() {
    let patterns = write_denies("home-writes-macos.json");
    let home = "/Users/ann";
    let denied = |path: &str| denied(&patterns, home, "/Users/ann/Documents", path);

    for path in [
        "/Users/ann/Library",
        "/Users/ann/Library/LaunchAgents/evil.plist",
        "/Users/ann/library/LaunchAgents/evil.plist",
        "/Users/ann/LIBRARY/LaunchAgents/evil.plist",
        "/Users/ann/Library/Application Support/com.pile.commander/ai-addresses.json",
        "/Users/ann/.zshrc",
        "/Users/ann/.zprofile",
        "/Users/ann/.bash_profile",
        "/Users/ann/.ssh",
        "/Users/ann/.ssh/authorized_keys",
        "/Users/ann/.config/fish/config.fish",
        "/Users/ann/.Trash/notes.txt",
        "/Users/ann/.p",
        "/Users/ann/.pi",
        "/Users/ann/.pil",
        "/Users/ann/.pilex",
        "/Users/ann/.pile.bak/strokes.json",
        "/Users/ann/.profile",
        "/Users/ann/.python_history",
    ] {
        assert!(denied(path), "{path} must be denied");
    }
    for path in [
        "/Users/ann/.pile",
        "/Users/ann/.pile/strokes.json",
        "/Users/ann/.PILE/strokes.json",
        "/Users/ann/.pile/cover-0a1b2c3d.webp.tmp",
        "/Users/ann/Documents/notes.txt",
        "/Users/ann/Documents/.pile/sync.json",
        "/Users/ann/Documents/.hidden",
        "/Users/ann/Projects/site/.git/config",
        "/Users/ann/Library books/list.txt",
        "/Users/ann/Documents/Library/list.txt",
        "/Users/ann/Pile Commander/Trip/photo.jpg",
    ] {
        assert!(!denied(path), "{path} must stay writable");
    }
}

#[test]
fn linux_writes_stay_out_of_dot_entries() {
    let patterns = write_denies("home-writes-linux.json");
    let denied = |path: &str| denied(&patterns, "/home/ann", "/home/ann/Documents", path);

    assert!(denied("/home/ann/.bashrc"));
    assert!(denied("/home/ann/.config/autostart/evil.desktop"));
    assert!(denied("/home/ann/.local/share/applications/evil.desktop"));
    assert!(!denied("/home/ann/.pile/strokes.json"));
    assert!(!denied("/home/ann/Documents/notes.txt"));
    // not special on Linux
    assert!(!denied("/home/ann/Library/list.txt"));
}

#[test]
fn windows_writes_stay_out_of_appdata_and_powershell_profiles() {
    let patterns = write_denies("home-writes-windows.json");
    // matched as Unix paths here: the patterns have no drive-specific part
    let denied = |path: &str| denied(&patterns, "/Users/ann", "/Users/ann/Documents", path);

    assert!(denied("/Users/ann/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/evil.bat"));
    assert!(denied("/Users/ann/appdata/Local/Microsoft/WindowsApps/python.exe"));
    assert!(denied("/Users/ann/Documents/PowerShell/profile.ps1"));
    assert!(denied("/Users/ann/Documents/windowspowershell/Microsoft.PowerShell_profile.ps1"));
    assert!(denied("/Users/ann/.ssh/authorized_keys"));
    assert!(!denied("/Users/ann/.pile/strokes.json"));
    assert!(!denied("/Users/ann/Documents/notes.txt"));
    assert!(!denied("/Users/ann/Documents/PowerShell scripts/a.ps1"));
}

/// The glob rule and the Rust rule name the same places.
#[cfg(target_os = "macos")]
#[test]
fn the_capability_and_the_commands_agree() {
    let patterns = write_denies("home-writes-macos.json");
    let home = Path::new("/Users/ann");
    for path in [
        "/Users/ann/Library/LaunchAgents/evil.plist",
        "/Users/ann/library/x",
        "/Users/ann/.zshrc",
        "/Users/ann/.ssh/id",
        "/Users/ann/.pile/strokes.json",
        "/Users/ann/.PILE/a",
        "/Users/ann/.pilex",
        "/Users/ann/.pil",
        "/Users/ann/Documents/a.txt",
        "/Users/ann/Documents/.git/config",
        "/Users/ann/Library books/a",
    ] {
        assert_eq!(
            denied(&patterns, "/Users/ann", "/Users/ann/Documents", path),
            crate::paths::is_protected(home, None, Path::new(path)),
            "{path}"
        );
    }
}
