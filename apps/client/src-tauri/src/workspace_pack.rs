use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{copy, BufReader, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::paths;

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
/// The folder must be one the app may read, the archive a path it may write
/// (the save dialog grants the one the person picked).
#[tauri::command]
pub fn export_workspace_zip(
    app: AppHandle,
    root_path: String,
    zip_path: String,
    attrs_json: String,
) -> Result<(), String> {
    // The checks resolve links; the work uses the paths as they were given,
    // so names and what goes back to the window stay as the person sees them
    // (a resolved Windows path starts with \\?\)
    paths::readable(&app, &root_path)?;
    paths::writable(&app, &zip_path)?;
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(format!("workspace root is not a directory: {root_path}"));
    }

    let folder_name = file_name(&root)?;
    let zip_file_path = PathBuf::from(&zip_path);

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

/// `cover-<hash8>.webp` and `background-<hash8>.webp` only. Strokes, connections and sync stay out.
fn is_pile_image_file(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".webp") else {
        return false;
    };
    let Some((role, hash)) = stem.rsplit_once('-') else {
        return false;
    };
    (role == "cover" || role == "background")
        && hash.len() == 8
        && hash.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn add_pile_images(
    zip: &mut ZipWriter<File>,
    pile_dir: &Path,
    zip_prefix: &str,
    options: &SimpleFileOptions,
) -> Result<(), String> {
    let entries = match fs::read_dir(pile_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = file_name(&path)?;
        if !is_pile_image_file(&name) {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if !file_type.is_file() {
            continue;
        }
        let zip_path = format!("{zip_prefix}/{name}");
        zip.start_file(&zip_path, *options)
            .map_err(|e| e.to_string())?;
        let mut source = File::open(&path).map_err(|e| e.to_string())?;
        copy(&mut source, zip).map_err(|e| e.to_string())?;
    }
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
        let zip_path = format!("{zip_prefix}/{name}");
        if name == PILE_DIR {
            add_pile_images(zip, &path, &zip_path, options)?;
            continue;
        }

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

/// What an archive may hold to be unpacked. A `.pile` comes from anywhere —
/// a download, a message — and a zip of a few kilobytes can declare
/// terabytes. The numbers are far above any folder a person keeps and are
/// checked against the archive's own directory before a byte is written.
struct UnpackLimits {
    entries: usize,
    file_bytes: u64,
    total_bytes: u64,
    /// Deflate cannot pack real files this tightly; only above `ratio_from`
    /// unpacked bytes, so a small folder of very regular text still passes.
    ratio: u64,
    ratio_from: u64,
}

const GIB: u64 = 1024 * 1024 * 1024;
const UNPACK_LIMITS: UnpackLimits = UnpackLimits {
    entries: 200_000,
    file_bytes: 16 * GIB,
    total_bytes: 64 * GIB,
    ratio: 100,
    ratio_from: GIB,
};

fn gib(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / GIB as f64)
}

/// Reads the archive's directory only. Refuses what is over a limit and an
/// archive without `<root>/.pile/attrs.json`, which the import needs right
/// after the unpacking, so neither is found out half-way.
fn check_archive(
    archive: &mut ZipArchive<BufReader<File>>,
    root_name: &str,
    archive_bytes: u64,
    limits: &UnpackLimits,
) -> Result<(), String> {
    if archive.len() > limits.entries {
        return Err(format!(
            "archive holds too many items to import: {} (the limit is {})",
            archive.len(),
            limits.entries
        ));
    }
    let manifest = Path::new(root_name).join(PILE_DIR).join(ATTRS_FILE);
    let mut has_manifest = false;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        if entry.is_dir() {
            continue;
        }
        if entry.size() > limits.file_bytes {
            return Err(format!(
                "archive holds a file too large to import: {} is {} (the limit is {})",
                enclosed.display(),
                gib(entry.size()),
                gib(limits.file_bytes)
            ));
        }
        total = total.saturating_add(entry.size());
        has_manifest |= enclosed == manifest;
    }
    if total > limits.total_bytes {
        return Err(format!(
            "archive is too large to import: {} unpacked (the limit is {})",
            gib(total),
            gib(limits.total_bytes)
        ));
    }
    if total > limits.ratio_from && total / limits.ratio > archive_bytes {
        return Err(format!(
            "archive unpacks to {} from a file of {:.1} MB: packed too tightly to be a real folder, not imported",
            gib(total),
            archive_bytes as f64 / (1024.0 * 1024.0)
        ));
    }
    if !has_manifest {
        return Err(format!(
            "not a Pile Commander archive: {root_name}/{PILE_DIR}/{ATTRS_FILE} is missing"
        ));
    }
    Ok(())
}

/// A new folder next to where the workspace will stand, so the finished
/// tree moves into place by a rename on the same volume. Not a dot-name:
/// the app does not write into dot-folders of the home folder.
fn staging_dir(dest_parent: &Path, root_name: &str) -> Result<PathBuf, String> {
    let stem: String = root_name.chars().take(100).collect();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or(0);
    for name in [
        format!("{stem}.importing"),
        format!("{stem}.importing-{stamp}"),
    ] {
        let dir = dest_parent.join(name);
        match fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err(format!("cannot make a folder to unpack into in {}", dest_parent.display()))
}

fn extract_into(
    archive: &mut ZipArchive<BufReader<File>>,
    staging: &Path,
) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        let out_path = sanitize_extract_path(staging, enclosed.as_path())?;

        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // The directory was checked; the data may still be longer than the
        // directory says. One byte past the declared size is enough to tell.
        let declared = entry.size();
        let mut outfile = File::create(&out_path).map_err(|e| e.to_string())?;
        let written = copy(&mut (&mut entry).take(declared + 1), &mut outfile)
            .map_err(|e| e.to_string())?;
        if written > declared {
            return Err(format!(
                "archive entry is larger than it declares: {}",
                enclosed.display()
            ));
        }
    }
    Ok(())
}

/// Unpacks into a folder of its own next to the destination and moves the
/// finished workspace into place. Whatever fails, nothing of the archive is
/// left behind, so the import can simply be run again.
fn unpack_pile(
    archive_path: &Path,
    dest_parent: &Path,
    limits: &UnpackLimits,
) -> Result<PathBuf, String> {
    let archive_bytes = fs::metadata(archive_path).map_err(|e| e.to_string())?.len();
    let file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;

    let root_name = archive_root_name(&mut archive)?;
    let extracted_root = dest_parent.join(&root_name);
    if extracted_root.exists() {
        return Err(format!(
            "destination already exists: {}",
            extracted_root.display()
        ));
    }
    check_archive(&mut archive, &root_name, archive_bytes, limits)?;

    let staging = staging_dir(dest_parent, &root_name)?;
    let moved = extract_into(&mut archive, &staging).and_then(|()| {
        let staged_root = staging.join(&root_name);
        if !staged_root.is_dir() {
            return Err(format!(
                "archive did not produce workspace folder: {}",
                extracted_root.display()
            ));
        }
        if extracted_root.exists() {
            return Err(format!(
                "destination already exists: {}",
                extracted_root.display()
            ));
        }
        fs::rename(&staged_root, &extracted_root).map_err(|e| e.to_string())
    });
    // empty after a move, the partial tree after a failure
    let _ = fs::remove_dir_all(&staging);
    moved.map(|()| extracted_root)
}

/// Unpack a `.pile` (zip) archive into `dest_parent` and return the workspace root path.
#[tauri::command]
pub fn import_workspace_zip(
    app: AppHandle,
    zip_path: String,
    dest_parent: String,
) -> Result<String, String> {
    paths::readable(&app, &zip_path)?;
    paths::writable(&app, &dest_parent)?;
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

    let extracted_root = unpack_pile(&archive_path, &dest_parent_path, &UNPACK_LIMITS)?;
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

/// One archive being written entry by entry (`pile_zip_*`): a cloud folder
/// has no directory on disk to zip, and a temporary copy of it would have to
/// live in a place the window may write to. The entries go into
/// `<name>.partial` next to the target, which replaces the target only when
/// the archive is complete, so a failed export leaves an older archive of
/// that name as it was.
struct PileZip {
    writer: ZipWriter<File>,
    root: String,
    partial: PathBuf,
    target: PathBuf,
}

type SharedPileZip = Arc<Mutex<Option<PileZip>>>;

#[derive(Default)]
struct PileZipsInner {
    next_id: u32,
    open: HashMap<u32, SharedPileZip>,
}

/// Archives in flight, keyed by the id `pile_zip_begin` hands out.
#[derive(Default)]
pub struct PileZips(Mutex<PileZipsInner>);

impl PileZips {
    fn insert(&self, zip: PileZip) -> u32 {
        let mut inner = self.0.lock().unwrap();
        inner.next_id = inner.next_id.wrapping_add(1);
        let id = inner.next_id;
        inner.open.insert(id, Arc::new(Mutex::new(Some(zip))));
        id
    }

    fn get(&self, id: u32) -> Result<SharedPileZip, String> {
        self.0
            .lock()
            .unwrap()
            .open
            .get(&id)
            .cloned()
            .ok_or_else(|| "unknown archive".to_string())
    }

    fn remove(&self, id: u32) -> Option<SharedPileZip> {
        self.0.lock().unwrap().open.remove(&id)
    }
}

fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated)
}

/// One name of an archive path: no separators, no `.` or `..`.
fn is_entry_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
}

fn entry_path(root: &str, segments: &[String]) -> Result<String, String> {
    if segments.is_empty() || !segments.iter().all(|segment| is_entry_name(segment)) {
        return Err("unsafe archive entry name".to_string());
    }
    Ok(format!("{root}/{}", segments.join("/")))
}

fn partial_path(target: &Path) -> Result<PathBuf, String> {
    let mut name = target
        .file_name()
        .ok_or_else(|| format!("cannot get file name for {}", target.display()))?
        .to_os_string();
    name.push(".partial");
    Ok(target.with_file_name(name))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

fn with_zip<T>(
    zip: &SharedPileZip,
    work: impl FnOnce(&mut PileZip) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = zip.lock().unwrap();
    work(guard.as_mut().ok_or("the archive is closed")?)
}

/// Starts an archive at `zip_path` whose single top folder is `root_name`.
#[tauri::command]
pub fn pile_zip_begin(
    app: AppHandle,
    zips: State<'_, PileZips>,
    zip_path: String,
    root_name: String,
) -> Result<u32, String> {
    if !is_entry_name(&root_name) {
        return Err("unsafe archive root name".to_string());
    }
    paths::writable(&app, &zip_path)?;
    let target = PathBuf::from(&zip_path);
    let partial = partial_path(&target)?;
    let file = File::create(&partial).map_err(|e| e.to_string())?;
    Ok(zips.insert(PileZip {
        writer: ZipWriter::new(file),
        root: root_name,
        partial,
        target,
    }))
}

/// Adds a folder entry, so an empty folder survives the round trip.
#[tauri::command]
pub async fn pile_zip_folder(
    zips: State<'_, PileZips>,
    id: u32,
    segments: Vec<String>,
) -> Result<(), String> {
    let zip = zips.get(id)?;
    blocking(move || {
        with_zip(&zip, |zip| {
            let path = entry_path(&zip.root, &segments)?;
            zip.writer
                .add_directory(format!("{path}/"), zip_options())
                .map_err(|e| e.to_string())
        })
    })
    .await
}

fn header<'a>(request: &'a Request<'_>, name: &str) -> Option<&'a str> {
    request.headers().get(name)?.to_str().ok()
}

/// Adds a file: the bytes are the raw body, `x-pile-zip-id` names the
/// archive and `x-pile-zip-path` is the JSON array of path segments,
/// percent-encoded (a header holds ASCII only).
#[tauri::command]
pub async fn pile_zip_file(zips: State<'_, PileZips>, request: Request<'_>) -> Result<(), String> {
    let id: u32 = header(&request, "x-pile-zip-id")
        .and_then(|value| value.parse().ok())
        .ok_or("missing archive id")?;
    let segments: Vec<String> = header(&request, "x-pile-zip-path")
        .and_then(|value| {
            let decoded: Vec<u8> = percent_decode(value)?;
            serde_json::from_slice(&decoded).ok()
        })
        .ok_or("missing archive entry path")?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err("expected the file bytes".into()),
    };
    let zip = zips.get(id)?;
    blocking(move || {
        with_zip(&zip, |zip| {
            let path = entry_path(&zip.root, &segments)?;
            let options = zip_options().large_file(bytes.len() as u64 >= u32::MAX as u64);
            zip.writer
                .start_file(path, options)
                .map_err(|e| e.to_string())?;
            zip.writer.write_all(&bytes).map_err(|e| e.to_string())
        })
    })
    .await
}

/// `%XX` escapes back to bytes. None when an escape is cut short or not hex.
fn percent_decode(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value.get(index + 1..index + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    Some(out)
}

/// Writes `.pile/attrs.json`, closes the archive and puts it in place.
#[tauri::command]
pub async fn pile_zip_finish(
    zips: State<'_, PileZips>,
    id: u32,
    attrs_json: String,
) -> Result<(), String> {
    let zip = zips.remove(id).ok_or("unknown archive")?;
    blocking(move || {
        let PileZip {
            mut writer,
            root,
            partial,
            target,
        } = zip.lock().unwrap().take().ok_or("the archive is closed")?;
        let written = (|| {
            writer
                .start_file(format!("{root}/{PILE_DIR}/{ATTRS_FILE}"), zip_options())
                .map_err(|e| e.to_string())?;
            writer
                .write_all(attrs_json.as_bytes())
                .map_err(|e| e.to_string())?;
            writer.finish().map_err(|e| e.to_string())?;
            fs::rename(&partial, &target).map_err(|e| e.to_string())
        })();
        if written.is_err() {
            let _ = fs::remove_file(&partial);
        }
        written
    })
    .await
}

/// Drops an archive the caller gave up on, with what was written so far.
/// Unknown ids are fine.
#[tauri::command]
pub async fn pile_zip_abort(zips: State<'_, PileZips>, id: u32) -> Result<(), String> {
    let Some(zip) = zips.remove(id) else {
        return Ok(());
    };
    blocking(move || {
        if let Some(zip) = zip.lock().unwrap().take() {
            let PileZip {
                writer, partial, ..
            } = zip;
            drop(writer);
            let _ = fs::remove_file(&partial);
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod pile_zip_tests {
    use super::*;
    use std::io::Read;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pile-zip-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn begin(target: &Path, root: &str) -> PileZip {
        let partial = partial_path(target).unwrap();
        PileZip {
            writer: ZipWriter::new(File::create(&partial).unwrap()),
            root: root.to_string(),
            partial,
            target: target.to_path_buf(),
        }
    }

    #[test]
    fn entry_names_cannot_leave_the_root() {
        let ok = |segments: &[&str]| {
            entry_path(
                "Trip",
                &segments.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            )
        };
        assert_eq!(ok(&["Day 1", "notes.md"]).unwrap(), "Trip/Day 1/notes.md");
        assert_eq!(ok(&[".pile", "cover-0a1b2c3d.webp"]).unwrap(), "Trip/.pile/cover-0a1b2c3d.webp");
        assert!(ok(&[]).is_err());
        assert!(ok(&[".."]).is_err());
        assert!(ok(&["a", "..", "b"]).is_err());
        assert!(ok(&["a/b"]).is_err());
        assert!(ok(&["a\\b"]).is_err());
        assert!(ok(&[""]).is_err());
        assert!(!is_entry_name("../Trip"));
        assert!(is_entry_name("Trip"));
    }

    #[test]
    fn the_path_header_is_decoded_as_utf8_json() {
        let decoded = percent_decode("%5B%22%D0%94%D0%B5%D0%BD%D1%8C%201%22%2C%22a.txt%22%5D").unwrap();
        let segments: Vec<String> = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(segments, vec!["День 1".to_string(), "a.txt".to_string()]);
        assert!(percent_decode("%5").is_none());
        assert!(percent_decode("%zz").is_none());
    }

    #[test]
    fn an_archive_written_entry_by_entry_reads_back_and_replaces_the_target_last() {
        let dir = scratch("roundtrip");
        let target = dir.join("Trip.pile");
        fs::write(&target, b"older archive").unwrap();

        let mut zip = begin(&target, "Trip");
        zip.writer
            .add_directory("Trip/Empty/", zip_options())
            .unwrap();
        zip.writer
            .start_file(entry_path("Trip", &["notes.md".to_string()]).unwrap(), zip_options())
            .unwrap();
        zip.writer.write_all(b"hello").unwrap();
        // the older archive stays until the new one is complete
        assert_eq!(fs::read(&target).unwrap(), b"older archive");

        zip.writer
            .start_file(format!("Trip/{PILE_DIR}/{ATTRS_FILE}"), zip_options())
            .unwrap();
        zip.writer.write_all(b"{}").unwrap();
        zip.writer.finish().unwrap();
        fs::rename(&zip.partial, &zip.target).unwrap();

        let mut archive = ZipArchive::new(BufReader::new(File::open(&target).unwrap())).unwrap();
        assert_eq!(archive_root_name(&mut archive).unwrap(), "Trip");
        let mut text = String::new();
        archive
            .by_name("Trip/notes.md")
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(text, "hello");
        assert!(archive.by_name("Trip/Empty/").is_ok());
        assert!(archive.by_name("Trip/.pile/attrs.json").is_ok());
        assert!(!partial_path(&target).unwrap().exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    const MANIFEST: (&str, &[u8]) = ("Trip/.pile/attrs.json", b"{}");

    /// A name ending in `/` is a folder.
    fn write_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let mut writer = ZipWriter::new(File::create(path).unwrap());
        for (name, bytes) in entries {
            if name.ends_with('/') {
                writer.add_directory(*name, zip_options()).unwrap();
            } else {
                writer.start_file(*name, zip_options()).unwrap();
                writer.write_all(bytes).unwrap();
            }
        }
        writer.finish().unwrap();
    }

    /// The archive in one folder, an empty destination in another.
    fn import_case(name: &str, entries: &[(&str, &[u8])]) -> (PathBuf, PathBuf, PathBuf) {
        let dir = scratch(name);
        let archive = dir.join("Trip.pile");
        write_archive(&archive, entries);
        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        (dir, archive, dest)
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    const ROOMY: UnpackLimits = UnpackLimits {
        entries: 100,
        file_bytes: 1_000_000,
        total_bytes: 1_000_000,
        ratio: 100,
        ratio_from: 1_000_000,
    };

    #[test]
    fn an_archive_is_unpacked_beside_the_destination_and_moved_into_place() {
        let (dir, archive, dest) = import_case(
            "unpack",
            &[("Trip/Empty/", b""), ("Trip/Day 1/notes.md", b"hello"), MANIFEST],
        );
        let root = unpack_pile(&archive, &dest, &ROOMY).unwrap();
        assert_eq!(root, dest.join("Trip"));
        assert_eq!(fs::read(root.join("Day 1/notes.md")).unwrap(), b"hello");
        assert!(root.join("Empty").is_dir());
        assert!(root.join(".pile/attrs.json").is_file());
        // nothing of the unpacking is left next to the workspace
        assert_eq!(names_in(&dest), vec!["Trip".to_string()]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_name_that_is_taken_is_left_alone() {
        let (dir, archive, dest) = import_case("taken", &[("Trip/notes.md", b"new"), MANIFEST]);
        fs::create_dir(dest.join("Trip")).unwrap();
        fs::write(dest.join("Trip/notes.md"), b"mine").unwrap();
        let error = unpack_pile(&archive, &dest, &ROOMY).unwrap_err();
        assert!(error.contains("destination already exists"), "{error}");
        assert_eq!(fs::read(dest.join("Trip/notes.md")).unwrap(), b"mine");
        assert_eq!(names_in(&dest), vec!["Trip".to_string()]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_archive_over_a_limit_or_without_its_manifest_writes_nothing() {
        let big = vec![0u8; 100_000];
        let entries: &[(&str, &[u8])] = &[("Trip/a.txt", b"12345"), ("Trip/zeros.bin", &big), MANIFEST];
        let refused = |name: &str, entries: &[(&str, &[u8])], limits: UnpackLimits, words: &str| {
            let (dir, archive, dest) = import_case(name, entries);
            let error = unpack_pile(&archive, &dest, &limits).unwrap_err();
            assert!(error.contains(words), "{name}: {error}");
            assert!(names_in(&dest).is_empty(), "{name}: {:?}", names_in(&dest));
            fs::remove_dir_all(&dir).unwrap();
        };
        refused("count", entries, UnpackLimits { entries: 2, ..ROOMY }, "too many items");
        refused("file", entries, UnpackLimits { file_bytes: 99_999, ..ROOMY }, "a file too large");
        refused("total", entries, UnpackLimits { total_bytes: 100_004, ..ROOMY }, "too large to import");
        // 100 000 zeros deflate to about a hundred bytes
        refused("ratio", entries, UnpackLimits { ratio: 10, ratio_from: 50_000, ..ROOMY }, "packed too tightly");
        refused("manifest", &[("Trip/a.txt", b"12345")], ROOMY, "not a Pile Commander archive");
        // and the same archive passes when nothing is over
        let (dir, archive, dest) = import_case("passes", entries);
        unpack_pile(&archive, &dest, &ROOMY).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failure_half_way_leaves_nothing_and_the_import_can_be_run_again() {
        // `Trip/a` is a file, so `Trip/a/b` cannot be written after it
        let (dir, archive, dest) = import_case(
            "half",
            &[MANIFEST, ("Trip/first.txt", b"written"), ("Trip/a", b"file"), ("Trip/a/b", b"cannot")],
        );
        assert!(unpack_pile(&archive, &dest, &ROOMY).is_err());
        assert!(names_in(&dest).is_empty(), "{:?}", names_in(&dest));

        write_archive(&archive, &[MANIFEST, ("Trip/first.txt", b"written")]);
        unpack_pile(&archive, &dest, &ROOMY).unwrap();
        assert_eq!(names_in(&dest), vec!["Trip".to_string()]);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_entry_longer_than_its_directory_says_is_refused() {
        let dir = scratch("lying");
        let archive = dir.join("Trip.pile");
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let mut writer = ZipWriter::new(File::create(&archive).unwrap());
        writer.start_file(MANIFEST.0, stored).unwrap();
        writer.write_all(MANIFEST.1).unwrap();
        writer.start_file("Trip/long.bin", stored).unwrap();
        writer.write_all(b"five!").unwrap();
        writer.finish().unwrap();
        // the last directory record is long.bin: declare 1 byte where 5 are stored
        let mut bytes = fs::read(&archive).unwrap();
        let record = bytes
            .windows(4)
            .rposition(|window| window == [0x50, 0x4b, 0x01, 0x02])
            .unwrap();
        bytes[record + 24..record + 28].copy_from_slice(&1u32.to_le_bytes());
        fs::write(&archive, bytes).unwrap();

        let dest = dir.join("dest");
        fs::create_dir(&dest).unwrap();
        let error = unpack_pile(&archive, &dest, &ROOMY).unwrap_err();
        assert!(error.contains("larger than it declares"), "{error}");
        assert!(names_in(&dest).is_empty(), "{:?}", names_in(&dest));
        fs::remove_dir_all(&dir).unwrap();
    }
}
