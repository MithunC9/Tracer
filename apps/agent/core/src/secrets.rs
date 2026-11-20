//! Where the agent keeps its two secrets: the buffer encryption key and the device token.
//!
//! - macOS (real capture): the login Keychain, via the `keyring` crate.
//! - Simulated mode and other platforms: files in `<data-dir>/secrets/`, directory 0700,
//!   files 0600. This protects against other users on the machine, not against the same
//!   user; it is documented as such in the README.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secret store I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("keychain: {0}")]
    Keychain(String),
    #[error("secret {0} is malformed")]
    Malformed(String),
}

pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, SecretError>;
    fn set(&self, name: &str, value: &[u8]) -> Result<(), SecretError>;
    fn delete(&self, name: &str) -> Result<(), SecretError>;
    fn describe(&self) -> String;
}

pub const BUFFER_KEY: &str = "buffer-key";
pub const DEVICE_TOKEN: &str = "device-token";

/// File-backed store with 0600 permissions (0700 directory).
pub struct FileSecretStore {
    dir: PathBuf,
}

impl FileSecretStore {
    pub fn new(dir: impl Into<PathBuf>) -> Result<Self, SecretError> {
        let dir = dir.into();
        fs::create_dir_all(&dir)?;
        restrict(&dir, 0o700)?;
        Ok(FileSecretStore { dir })
    }

    fn path(&self, name: &str) -> PathBuf {
        let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        self.dir.join(safe)
    }
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> std::io::Result<()> {
    // Windows: files under the user's profile inherit a per-user ACL. A real Windows build
    // should use the Credential Manager instead (see README "Adding a platform").
    Ok(())
}

/// Write a file that only the current user can read (created 0600 before any bytes land).
pub fn write_private_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp = path.with_extension("tmp");
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp)?;
        f.write_all(contents)?;
        f.sync_all()?;
    }
    restrict(&tmp, 0o600)?;
    fs::rename(&tmp, path)
}

impl SecretStore for FileSecretStore {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, SecretError> {
        match fs::read(self.path(name)) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
    fn set(&self, name: &str, value: &[u8]) -> Result<(), SecretError> {
        Ok(write_private_file(&self.path(name), value)?)
    }
    fn delete(&self, name: &str) -> Result<(), SecretError> {
        match fs::remove_file(self.path(name)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
    fn describe(&self) -> String {
        format!("file ({}, mode 0600)", self.dir.display())
    }
}

/// macOS login Keychain. Values are hex-encoded into generic-password items under
/// service `ai.tracer.agent`.
#[cfg(target_os = "macos")]
pub struct KeychainSecretStore {
    service: String,
}

#[cfg(target_os = "macos")]
impl KeychainSecretStore {
    pub fn new() -> Self {
        KeychainSecretStore { service: "ai.tracer.agent".into() }
    }
    fn entry(&self, name: &str) -> Result<keyring::Entry, SecretError> {
        keyring::Entry::new(&self.service, name).map_err(|e| SecretError::Keychain(e.to_string()))
    }
}

#[cfg(target_os = "macos")]
impl Default for KeychainSecretStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(target_os = "macos")]
impl SecretStore for KeychainSecretStore {
    fn get(&self, name: &str) -> Result<Option<Vec<u8>>, SecretError> {
        match self.entry(name)?.get_password() {
            Ok(s) => hex::decode(s).map(Some).map_err(|_| SecretError::Malformed(name.into())),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(SecretError::Keychain(e.to_string())),
        }
    }
    fn set(&self, name: &str, value: &[u8]) -> Result<(), SecretError> {
        self.entry(name)?.set_password(&hex::encode(value)).map_err(|e| SecretError::Keychain(e.to_string()))
    }
    fn delete(&self, name: &str) -> Result<(), SecretError> {
        match self.entry(name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(SecretError::Keychain(e.to_string())),
        }
    }
    fn describe(&self) -> String {
        "macOS Keychain".into()
    }
}

/// The platform default: Keychain on macOS unless `simulated`, else files under `data_dir`.
pub fn default_store(data_dir: &Path, simulated: bool) -> Result<Box<dyn SecretStore>, SecretError> {
    #[cfg(target_os = "macos")]
    if !simulated {
        return Ok(Box::new(KeychainSecretStore::new()));
    }
    let _ = simulated;
    Ok(Box::new(FileSecretStore::new(data_dir.join("secrets"))?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_store_roundtrip_and_perms() {
        let dir = tempfile::tempdir().unwrap();
        let s = FileSecretStore::new(dir.path().join("secrets")).unwrap();
        assert_eq!(s.get("x").unwrap(), None);
        s.set("x", b"abc").unwrap();
        assert_eq!(s.get("x").unwrap().as_deref(), Some(&b"abc"[..]));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let m = fs::metadata(dir.path().join("secrets/x")).unwrap().permissions().mode();
            assert_eq!(m & 0o777, 0o600);
            let m = fs::metadata(dir.path().join("secrets")).unwrap().permissions().mode();
            assert_eq!(m & 0o777, 0o700);
        }
        s.delete("x").unwrap();
        s.delete("x").unwrap();
        assert_eq!(s.get("x").unwrap(), None);
    }
}
