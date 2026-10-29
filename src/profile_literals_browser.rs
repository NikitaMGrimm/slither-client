//! Scalar copied boundary: no generated slice allocations or borrowed JS source.

use crate::profile_literals::LiteralStorage;
use wasm_bindgen::prelude::*;

/// Explicitly owned literal scratch allocation; clear before free on every path.
#[wasm_bindgen]
pub struct ProfileLiteralParser {
    storage: LiteralStorage,
}

#[wasm_bindgen]
impl ProfileLiteralParser {
    /// Allocate zeroed scratch only; no source, browser or acquisition authority.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            storage: LiteralStorage::default(),
        }
    }

    /// Copy one byte at a bounded scratch offset.
    pub fn write(&mut self, index: u32, value: u32) -> bool {
        self.storage.write(index, value)
    }

    /// Return an admitted u16 version or the fixed rejection sentinel -1.
    pub fn parse_version(&mut self, length: u32) -> i32 {
        self.storage.parse_version(length)
    }

    /// Admit exactly twenty password bytes, with no partial copied output.
    pub fn parse_password(&mut self, length: u32) -> bool {
        self.storage.parse_password(length)
    }

    /// Copy one fully admitted password byte or the fixed rejection sentinel -1.
    pub fn password_byte(&self, index: u32) -> i32 {
        self.storage.password_byte(index)
    }

    /// Copy the unchanged supported protocol; this does not negotiate a connection.
    pub fn protocol_version(&self) -> u8 {
        crate::profile_literals::PROTOCOL_VERSION
    }

    /// Zero the live owned allocation before the generated free method releases it.
    pub fn clear(&mut self) {
        self.storage.clear();
    }
}

impl Default for ProfileLiteralParser {
    fn default() -> Self {
        Self::new()
    }
}
