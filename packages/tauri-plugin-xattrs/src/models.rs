use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Xattr {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathXattrsEntry {
    pub path: String,
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub xattrs: Vec<Xattr>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderWithChildrenXattrs {
    pub folder: PathXattrsEntry,
    pub children: Vec<PathXattrsEntry>,
}
