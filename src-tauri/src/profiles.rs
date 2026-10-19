//! Public profile metadata only; identifiers remain distinct from display names.
use librespot_core::session::Session;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, OnceCell, Semaphore};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UserProfile {
    pub display_name: String,
    pub image: String,
}

pub fn parse_profile(value: &Value, username: &str) -> Option<UserProfile> {
    let name = value.get("name")?.as_str()?.trim();
    if name.is_empty() || name == username || name.len() > 512 {
        return None;
    }
    let image = value
        .get("image_url")
        .and_then(Value::as_str)
        .and_then(|s| reqwest::Url::parse(s).ok())
        .filter(|url| {
            url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        })
        .map(|url| url.to_string())
        .unwrap_or_default();
    Some(UserProfile {
        display_name: name.into(),
        image,
    })
}

struct CachedProfile {
    fetched: Instant,
    profile: Option<UserProfile>,
}
impl CachedProfile {
    fn fresh(&self) -> bool {
        self.fetched.elapsed() < Duration::from_secs(if self.profile.is_some() { 600 } else { 60 })
    }
}

pub struct Profiles {
    entries: Mutex<HashMap<(String, String), Arc<OnceCell<CachedProfile>>>>,
    requests: Semaphore,
}
impl Profiles {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            requests: Semaphore::new(3),
        }
    }
    pub async fn clear(&self) {
        self.entries.lock().await.clear();
    }
    pub async fn get(&self, session: &Session, username: &str) -> Option<UserProfile> {
        if username.is_empty() || username.len() > 256 || username.chars().any(char::is_control) {
            return None;
        }
        let key = (session.username(), username.to_owned());
        let cell = {
            let mut entries = self.entries.lock().await;
            entries.retain(|_, cell| cell.get().is_none_or(CachedProfile::fresh));
            if !entries.contains_key(&key) && entries.len() >= 256 {
                if let Some(oldest) = entries
                    .iter()
                    .min_by_key(|(_, cell)| cell.get().map(|v| v.fetched))
                    .map(|(key, _)| key.clone())
                {
                    entries.remove(&oldest);
                }
            }
            entries.entry(key).or_default().clone()
        };
        // Concurrent account and library reads for the same owner share one request.
        let cached = cell
            .get_or_init(|| async {
                let profile = async {
                    let _slot = self.requests.acquire().await.ok()?;
                    let mut url = reqwest::Url::parse("https://profile.invalid/").ok()?;
                    url.path_segments_mut().ok()?.push(username);
                    let encoded = url.path().strip_prefix('/')?;
                    let bytes = session
                        .spclient()
                        .get_user_profile(encoded, Some(0), Some(0))
                        .await
                        .ok()?;
                    let value: Value = serde_json::from_slice(&bytes).ok()?;
                    parse_profile(&value, username)
                };
                CachedProfile {
                    fetched: Instant::now(),
                    profile: tokio::time::timeout(Duration::from_secs(6), profile)
                        .await
                        .ok()
                        .flatten(),
                }
            })
            .await;
        cached.profile.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn profile_uses_public_name_and_only_https_photos() {
        let profile = parse_profile(&json!({"name":"  Alice  ","image_url":"https://i.scdn.co/image/example","email":"private","username":"internal-id"}), "internal-id").unwrap();
        assert_eq!(profile.display_name, "Alice");
        assert_eq!(profile.image, "https://i.scdn.co/image/example");
        let serialized = serde_json::to_string(&profile).unwrap();
        assert!(!serialized.contains("private"));
        assert!(!serialized.contains("internal-id"));
        for image in [
            "javascript:alert(1)",
            "http://example.com/photo",
            "https://secret@example.com/photo",
        ] {
            assert!(
                parse_profile(&json!({"name":"Alice","image_url":image}), "id")
                    .unwrap()
                    .image
                    .is_empty()
            );
        }
    }
    #[test]
    fn unavailable_names_never_fall_back_to_the_identifier() {
        for value in [json!({}), json!({"name":""}), json!({"name":"internal-id"})] {
            assert!(parse_profile(&value, "internal-id").is_none());
        }
        assert!(
            parse_profile(&json!({"name":"Alice"}), "internal-id")
                .unwrap()
                .image
                .is_empty()
        );
    }
}
