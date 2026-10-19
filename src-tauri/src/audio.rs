//! Local playback preferences. A requested bitrate is not proof of the format played.
use librespot_playback::config::{Bitrate, PlayerConfig};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path, time::Duration};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AudioQuality {
    Normal,
    High,
    #[default]
    VeryHigh,
}

impl AudioQuality {
    pub fn player_config(self) -> PlayerConfig {
        PlayerConfig {
            bitrate: match self {
                Self::Normal => Bitrate::Bitrate96,
                Self::High => Bitrate::Bitrate160,
                Self::VeryHigh => Bitrate::Bitrate320,
            },
            position_update_interval: Some(Duration::from_secs(1)),
            ..PlayerConfig::default()
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioPreferences {
    pub quality: AudioQuality,
}

impl AudioPreferences {
    pub fn read(path: &Path) -> io::Result<Self> {
        let file = match fs::File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(e),
        };
        if file.metadata()?.len() > 4096 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "preferences size",
            ));
        }
        serde_json::from_reader(file).map_err(io::Error::other)
    }

    pub fn write(self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
        let result = (|| {
            fs::write(&temp, serde_json::to_vec(&self).map_err(io::Error::other)?)?;
            fs::rename(&temp, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_quality_is_rejected_instead_of_claiming_lossless() {
        for value in ["lossless", "automatic", "320", "hifi"] {
            assert!(serde_json::from_str::<AudioQuality>(&format!("\"{value}\"")).is_err());
        }
        assert_eq!(
            AudioQuality::default().player_config().bitrate,
            Bitrate::Bitrate320
        );
        assert_eq!(
            AudioQuality::Normal.player_config().bitrate,
            Bitrate::Bitrate96
        );
        assert_eq!(
            AudioQuality::High.player_config().bitrate,
            Bitrate::Bitrate160
        );
    }

    #[test]
    fn saved_quality_survives_replacement_and_corruption_is_not_silently_reset() {
        let path =
            std::env::temp_dir().join(format!("spotisloth-audio-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(
            AudioPreferences::read(&path).unwrap(),
            AudioPreferences::default()
        );
        AudioPreferences {
            quality: AudioQuality::High,
        }
        .write(&path)
        .unwrap();
        AudioPreferences {
            quality: AudioQuality::Normal,
        }
        .write(&path)
        .unwrap();
        assert_eq!(
            AudioPreferences::read(&path).unwrap().quality,
            AudioQuality::Normal
        );
        fs::write(&path, b"{broken}").unwrap();
        assert!(AudioPreferences::read(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}
