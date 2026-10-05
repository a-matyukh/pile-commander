use std::fs::{self, File};
use std::io::{copy, BufReader, Write};
use std::path::{Component, Path, PathBuf};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const PILE_DIR: &str = ".pile";
const ATTRS_FILE: &str = "attrs.json";

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))
}

fn file_name(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("cannot get file name for {}", path.display()))
}

/// Zip a workspace directory and inject `.pile/attrs.json` without writing it to disk.
#[tauri::command]
pub fn export_workspace_zip(
    root_path: String,
    zip_path: String,
    attrs_json: String,
) -> Result<(), String> {
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(format!("workspace root is not a directory: {root_path}"));
    }

    let folder_name = file_name(&root)?;
    let zip_file_path = PathBuf::from(&zip_path);
    if let Some(parent) = zip_file_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }

    let file = File::create(&zip_file_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    add_directory_to_zip(&mut zip, &root, &folder_name, &options)?;

    let attrs_entry = format!("{folder_name}/{PILE_DIR}/{ATTRS_FILE}");
    zip.start_file(attrs_entry, options)
        .map_err(|e| e.to_string())?;
    zip.write_all(attrs_json.as_bytes())
        .map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn add_directory_to_zip(
    zip: &mut ZipWriter<File>,
    dir: &Path,
    zip_prefix: &str,
    options: &SimpleFileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = file_name(&path)?;
        if name == PILE_DIR {
            continue;
        }

        let zip_path = format!("{zip_prefix}/{name}");
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            // Explicit directory entry helps empty folders round-trip.
            let dir_entry = format!("{zip_path}/");
            zip.add_directory(dir_entry, *options)
                .map_err(|e| e.to_string())?;
            add_directory_to_zip(zip, &path, &zip_path, options)?;
        } else if file_type.is_file() {
            zip.start_file(&zip_path, *options)
                .map_err(|e| e.to_string())?;
            let mut source = File::open(&path).map_err(|e| e.to_string())?;
            copy(&mut source, zip).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Unpack a `.pile` (zip) archive into `dest_parent` and return the workspace root path.
#[tauri::command]
pub fn import_workspace_zip(zip_path: String, dest_parent: String) -> Result<String, String> {
    let archive_path = PathBuf::from(&zip_path);
    if !archive_path.is_file() {
        return Err(format!("archive is not a file: {zip_path}"));
    }

    let dest_parent_path = PathBuf::from(&dest_parent);
    if !dest_parent_path.is_dir() {
        return Err(format!(
            "destination parent is not a directory: {dest_parent}"
        ));
    }

    let file = File::open(&archive_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;

    let root_name = archive_root_name(&mut archive)?;
    let extracted_root = dest_parent_path.join(&root_name);
    if extracted_root.exists() {
        return Err(format!(
            "destination already exists: {}",
            extracted_root.display()
        ));
    }

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let out_path = sanitize_extract_path(&dest_parent_path, enclosed.as_path())?;

        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut outfile = File::create(&out_path).map_err(|e| e.to_string())?;
        copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
    }

    if !extracted_root.is_dir() {
        return Err(format!(
            "archive did not produce workspace folder: {}",
            extracted_root.display()
        ));
    }

    path_to_string(&extracted_root)
}

fn archive_root_name(archive: &mut ZipArchive<BufReader<File>>) -> Result<String, String> {
    let mut root: Option<String> = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let mut components = enclosed.as_path().components();
        let Some(Component::Normal(first)) = components.next() else {
            continue;
        };
        let name = first
            .to_str()
            .ok_or_else(|| "archive entry name is not valid UTF-8".to_string())?
            .to_owned();
        match &root {
            None => root = Some(name),
            Some(existing) if existing == &name => {}
            Some(existing) => {
                return Err(format!(
                    "archive has multiple top-level entries: {existing} and {name}"
                ));
            }
        }
    }
    root.ok_or_else(|| "archive is empty".to_string())
}

fn sanitize_extract_path(dest_parent: &Path, enclosed: &Path) -> Result<PathBuf, String> {
    let mut out = dest_parent.to_path_buf();
    for component in enclosed.components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "refusing unsafe archive path: {}",
                    enclosed.display()
                ));
            }
        }
    }
    if !out.starts_with(dest_parent) {
        return Err(format!("refusing path escape: {}", enclosed.display()));
    }
    Ok(out)
}
