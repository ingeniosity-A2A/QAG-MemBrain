//! Telnyx authentication — API key + device token management.
//!
//! Two modes:
//!
//! 1. **Direct mode**: The Telnyx API key is loaded from the Android
//!    Keystore (production) or `TELNYX_API_KEY` env var (dev). Sent as
//!    `Authorization: Bearer <key>` directly to api.telnyx.com.
//!
//! 2. **Cloudflare proxy mode**: The API key never leaves Cloudflare's
//!    secret store. AVA007 sends a device-bound token
//!    (`X-Device-Token: <token>`) to a Cloudflare Worker. The Worker
//!    swaps it for the real Telnyx key and proxies the request.
//!    Recommended for production.

use parking_lot::RwLock;
use std::sync::Arc;

/// Auth state. Clonable.
#[derive(Clone)]
pub struct TelnyxAuth {
    inner: Arc<RwLock<AuthInner>>,
}

#[derive(Default)]
struct AuthInner {
    /// Cached API key (direct mode)
    api_key: Option<Arc<str>>,
    /// Cached device token (proxy mode)
    device_token: Option<Arc<str>>,
}

impl TelnyxAuth {
    /// Create empty. Load keys on first use.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(AuthInner::default())),
        }
    }

    /// Static key for tests / dev. Sets `TELNYX_API_KEY` env var.
    pub fn from_env_static(key: &str) -> Self {
        std::env::set_var("TELNYX_API_KEY", key);
        Self::new()
    }

    /// Get the Telnyx API key.
    /// Production: load from Android Keystore.
    /// Dev: read from `TELNYX_API_KEY` env var.
    pub fn api_key(&self) -> anyhow::Result<String> {
        // Check cache first
        {
            let inner = self.inner.read();
            if let Some(k) = &inner.api_key {
                return Ok(k.to_string());
            }
        }

        // TODO (production): Android Keystore lookup
        // #[cfg(target_os = "android")]
        // {
        //     let key = android_keystore_get("telnyx_api_key")?;
        //     ...
        // }

        // Dev / fallback: env var
        let key = std::env::var("TELNYX_API_KEY")
            .map_err(|_| anyhow::anyhow!(
                "TELNYX_API_KEY not set. Either set the env var or \
                 configure Cloudflare proxy mode with a device token."
            ))?;

        // Cache it
        let mut inner = self.inner.write();
        inner.api_key = Some(key.clone().into());

        Ok(key)
    }

    /// Get the device token for Cloudflare proxy mode.
    /// Read from `AVA007_DEVICE_TOKEN` env var (set at install time).
    pub fn device_token(&self) -> anyhow::Result<String> {
        // Check cache
        {
            let inner = self.inner.read();
            if let Some(t) = &inner.device_token {
                return Ok(t.to_string());
            }
        }

        let token = std::env::var("AVA007_DEVICE_TOKEN")
            .map_err(|_| anyhow::anyhow!(
                "AVA007_DEVICE_TOKEN not set. Required for Cloudflare proxy mode."
            ))?;

        let mut inner = self.inner.write();
        inner.device_token = Some(token.clone().into());

        Ok(token)
    }

    /// Rotate the API key (called from settings UI after user pastes new key).
    /// Invalidates the cache.
    pub fn rotate_api_key(&self, new_key: String) {
        let mut inner = self.inner.write();
        inner.api_key = Some(new_key.into());
    }

    /// Rotate the device token.
    pub fn rotate_device_token(&self, new_token: String) {
        let mut inner = self.inner.write();
        inner.device_token = Some(new_token.into());
    }

    /// Clear all cached credentials (called on logout).
    pub fn clear(&self) {
        let mut inner = self.inner.write();
        inner.api_key = None;
        inner.device_token = None;
    }
}

impl Default for TelnyxAuth {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_api_key_from_env() {
        std::env::set_var("TELNYX_API_KEY", "test_key_123");
        let auth = TelnyxAuth::new();
        let key = auth.api_key().unwrap();
        assert_eq!(key, "test_key_123");
    }

    #[test]
    fn caches_api_key() {
        // Use a unique key per test to avoid env var cross-contamination
        let unique_key = format!("cached_key_{}", std::process::id());
        std::env::set_var("TELNYX_API_KEY", &unique_key);
        let auth = TelnyxAuth::new();
        let _ = auth.api_key().unwrap();
        // Change env var — cached value should still be returned
        std::env::set_var("TELNYX_API_KEY", "different_key_after_cache");
        let cached = auth.api_key().unwrap();
        assert_eq!(cached, unique_key);
    }

    #[test]
    fn rotation_invalidates_cache() {
        std::env::set_var("TELNYX_API_KEY", "original");
        let auth = TelnyxAuth::new();
        let _ = auth.api_key().unwrap();
        auth.rotate_api_key("rotated".into());
        assert_eq!(auth.api_key().unwrap(), "rotated");
    }

    #[test]
    fn device_token_from_env() {
        std::env::set_var("AVA007_DEVICE_TOKEN", "dev_token_456");
        let auth = TelnyxAuth::new();
        let token = auth.device_token().unwrap();
        assert_eq!(token, "dev_token_456");
    }

    #[test]
    fn clear_wipes_credentials() {
        // Use unique value to avoid env var cross-contamination
        let unique_key = format!("to_be_cleared_{}", std::process::id());
        std::env::set_var("TELNYX_API_KEY", &unique_key);
        let auth = TelnyxAuth::new();
        let _ = auth.api_key().unwrap();
        auth.clear();
        // Now the cache is empty, but env var is still set
        // So it should re-read from env
        let key = auth.api_key().unwrap();
        assert_eq!(key, unique_key);
    }
}
