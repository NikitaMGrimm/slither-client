//! Bounded player choices and persistence, without browser or connection state.

use crate::presentation::resolve_skin;

/// Upper bound for our versioned ASCII preference record, before parsing.
pub const MAX_PREFERENCE_BYTES: usize = 600;
/// Complete positive count/palette pairs after the existing eight-byte prefix.
pub const MAX_CUSTOM_RUNS: usize = (255 - 8) / 2;
const STOCK_PALETTES: &[u8] = &[
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41,
];

/// A native menu action; enabled state is projected by the same policy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MenuControl {
    /// Stable action identifier, never a command to connect.
    pub action: &'static str,
    /// Authored native button text.
    pub label: &'static str,
    /// Domain availability, independent of the existing Play admission lock.
    pub enabled: bool,
}

/// Copied projection; custom bytes keep their stock palette namespace.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MenuView {
    /// Existing login nickname domain.
    pub nickname: String,
    /// Selected existing skin identifier.
    pub skin: u8,
    /// Owned wire data, copied independently of the menu state.
    pub custom_skin: Vec<u8>,
    /// Human-facing current selection label.
    pub title: String,
    /// Human-facing stripe selection label, empty for a built-in.
    pub detail: String,
    /// Fixed native button inventory and availability.
    pub controls: Vec<MenuControl>,
}

/// Player preferences. No endpoint, credential, source object or session data.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MenuPreferences {
    local: bool,
    nickname: String,
    skin: u8,
    custom_skin: Vec<u8>,
    stripe: usize,
}

impl MenuPreferences {
    /// Default choice in the selected existing route: skin zero and empty name.
    pub fn new(local: bool) -> Self {
        Self {
            local,
            nickname: String::new(),
            skin: 0,
            custom_skin: Vec::new(),
            stripe: 0,
        }
    }

    fn palettes(&self) -> &'static [u8] {
        if self.local {
            &STOCK_PALETTES[..3]
        } else {
            STOCK_PALETTES
        }
    }

    fn skin_count(&self) -> u8 {
        // The authored stock resolver represents built-ins 0..=65 explicitly;
        // the local host has only its three authored families.
        if self.local { 3 } else { 66 }
    }

    /// Validate a nickname without normalizing it or changing the wire domain.
    pub fn set_nickname(&mut self, nickname: &str) -> Result<(), &'static str> {
        if nickname.len() > 24 || !nickname.bytes().all(|byte| (0x20..=0x7f).contains(&byte)) {
            return Err("Invalid menu nickname");
        }
        self.nickname = nickname.to_owned();
        Ok(())
    }

    /// Validate and copy an owned custom pattern atomically. No palette remapping.
    pub fn select(&mut self, skin: u8, custom: &[u8]) -> Result<(), &'static str> {
        if skin >= self.skin_count() || custom.len() > 255 {
            return Err("Unsupported menu appearance");
        }
        if !custom.is_empty() {
            if custom.len() < 10 || custom[..8] != [0; 8] {
                return Err("Invalid custom pattern prefix");
            }
            let (pairs, tail) = custom[8..].as_chunks::<2>();
            if !tail.is_empty()
                || pairs
                    .iter()
                    .any(|[count, palette]| *count == 0 || !self.palettes().contains(palette))
            {
                return Err("Invalid custom pattern runs");
            }
            let resolved =
                resolve_skin(skin, custom, false).map_err(|_| "Invalid custom pattern")?;
            if !resolved.custom {
                return Err("Empty custom pattern");
            }
        }
        self.skin = skin;
        self.custom_skin = custom.to_vec();
        self.stripe = 0;
        Ok(())
    }

    /// Restore one bounded versioned record; malformed/foreign records reset fully.
    pub fn restore(local: bool, saved: &str) -> Self {
        let default = Self::new(local);
        if saved.len() > MAX_PREFERENCE_BYTES || !saved.is_ascii() {
            return default;
        }
        let mut fields = saved.split(':');
        let (Some("1"), Some(name), Some(skin), Some(custom), None) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            return default;
        };
        let (Some(name), Some(skin), Some(custom)) = (unhex(name), unhex(skin), unhex(custom))
        else {
            return default;
        };
        let [skin] = skin.as_slice() else {
            return default;
        };
        let Ok(name) = String::from_utf8(name) else {
            return default;
        };
        let mut result = default.clone();
        if result.set_nickname(&name).is_err() || result.select(*skin, &custom).is_err() {
            return default;
        }
        result
    }

    /// Canonical ASCII record; only nickname and appearance cross the storage seam.
    pub fn serialize(&self) -> String {
        format!(
            "1:{}:{}:{}",
            hex(self.nickname.as_bytes()),
            hex(&[self.skin]),
            hex(&self.custom_skin)
        )
    }

    /// Reset player choices, retaining the route's supported-family boundary.
    pub fn reset(&mut self) {
        *self = Self::new(self.local);
    }

    /// Apply a named menu action atomically; disabled actions are harmless no-ops.
    pub fn action(&mut self, action: &str) -> Result<(), &'static str> {
        let controls = self.view().controls;
        let Some(control) = controls.iter().find(|control| control.action == action) else {
            return Err("Unknown menu action");
        };
        if !control.enabled {
            return Ok(());
        }
        match action {
            "previous-skin" | "next-skin" => {
                let count = self.skin_count();
                let skin = if action == "next-skin" {
                    (self.skin + 1) % count
                } else {
                    (self.skin + count - 1) % count
                };
                self.select(skin, &[])?;
            }
            "build" => {
                self.custom_skin = vec![0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
                self.stripe = 0;
            }
            "next-stripe" => {
                self.stripe = (self.stripe + 1) % ((self.custom_skin.len() - 8) / 2);
            }
            "previous-color" | "next-color" => {
                let offset = 9 + 2 * self.stripe;
                let palettes = self.palettes();
                let index = palettes
                    .iter()
                    .position(|palette| *palette == self.custom_skin[offset])
                    .expect("validated palette");
                let next = if action == "next-color" {
                    (index + 1) % palettes.len()
                } else {
                    (index + palettes.len() - 1) % palettes.len()
                };
                self.custom_skin[offset] = palettes[next];
            }
            "shorter" => self.custom_skin[8 + 2 * self.stripe] -= 1,
            "longer" => self.custom_skin[8 + 2 * self.stripe] += 1,
            "add-stripe" => {
                let palette = self.custom_skin[9 + 2 * self.stripe];
                self.custom_skin.extend_from_slice(&[1, palette]);
                self.stripe = (self.custom_skin.len() - 8) / 2 - 1;
            }
            "remove-stripe" => {
                self.custom_skin
                    .drain(8 + 2 * self.stripe..10 + 2 * self.stripe);
                self.stripe = 0;
            }
            "reset" => {
                self.skin = 0;
                self.custom_skin.clear();
                self.stripe = 0;
            }
            _ => unreachable!("closed controls"),
        }
        Ok(())
    }

    /// Fresh copied values and native control labels, without browser observations.
    pub fn view(&self) -> MenuView {
        let custom = !self.custom_skin.is_empty();
        let runs = self.custom_skin.len().saturating_sub(8) / 2;
        let length = if custom {
            self.custom_skin[8 + 2 * self.stripe]
        } else {
            0
        };
        let title = if custom {
            "Custom skin".to_owned()
        } else {
            format!("Skin {} of {}", self.skin + 1, self.skin_count())
        };
        let detail = if custom {
            format!(
                "Stripe {} of {} · Color {} · Length {}",
                self.stripe + 1,
                runs,
                self.custom_skin[9 + 2 * self.stripe] + 1,
                length
            )
        } else {
            String::new()
        };
        let controls = [
            ("previous-skin", "Previous skin", true),
            ("next-skin", "Next skin", true),
            ("build", "Build a skin", !custom),
            ("next-stripe", "Next stripe", runs > 1),
            ("previous-color", "Previous color", custom),
            ("next-color", "Next color", custom),
            ("shorter", "Shorter stripe", length > 1),
            ("longer", "Longer stripe", custom && length < 255),
            ("add-stripe", "Add stripe", custom && runs < MAX_CUSTOM_RUNS),
            ("remove-stripe", "Remove stripe", runs > 1),
            ("reset", "Reset appearance", true),
        ]
        .into_iter()
        .map(|(action, label, enabled)| MenuControl {
            action,
            label,
            enabled,
        })
        .collect();
        MenuView {
            nickname: self.nickname.clone(),
            skin: self.skin,
            custom_skin: self.custom_skin.clone(),
            title,
            detail,
            controls,
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn unhex(text: &str) -> Option<Vec<u8>> {
    let (pairs, tail) = text.as_bytes().as_chunks::<2>();
    if !tail.is_empty() {
        return None;
    }
    pairs
        .iter()
        .map(|pair| {
            let digit = |byte| match byte {
                b'0'..=b'9' => Some(byte - b'0'),
                b'a'..=b'f' => Some(byte - b'a' + 10),
                _ => None,
            };
            Some(digit(pair[0])? * 16 + digit(pair[1])?)
        })
        .collect()
}
