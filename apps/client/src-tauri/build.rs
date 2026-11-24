use std::path::Path;

/// `PILE_STORAGE_URLS` reaches the Rust side at compile time
/// (`option_env!` in src/presigned_put.rs). CI sets it in the environment
/// (release.yml). A local build takes it from `apps/client/.env`, the file
/// the `VITE_` variables already live in, so `bun run dev:desktop` and
/// `bun run build:desktop` need nothing exported by hand. A value in the
/// environment wins over the file.
fn storage_urls_from_dotenv() {
    println!("cargo:rerun-if-env-changed=PILE_STORAGE_URLS");
    let dotenv = Path::new("../.env");
    if dotenv.exists() {
        println!("cargo:rerun-if-changed=../.env");
    }
    if std::env::var("PILE_STORAGE_URLS").is_ok_and(|value| !value.trim().is_empty()) {
        return;
    }
    let Ok(text) = std::fs::read_to_string(dotenv) else {
        return;
    };
    for line in text.lines() {
        let Some(value) = line.trim().strip_prefix("PILE_STORAGE_URLS=") else {
            continue;
        };
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if !value.is_empty() {
            println!("cargo:rustc-env=PILE_STORAGE_URLS={value}");
        }
        return;
    }
}

fn main() {
    storage_urls_from_dotenv();
    tauri_build::build()
}
