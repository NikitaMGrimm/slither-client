//! Closed decimal declarations only; no evaluation, acquisition or source authority.

/// Maximum admitted version-declaration span, in bytes.
pub const VERSION_LIMIT: usize = 128;
/// Maximum admitted password-declaration span, in bytes.
pub const PASSWORD_LIMIT: usize = 256;
/// The supported profile protocol, unchanged from the existing literal policy.
pub const PROTOCOL_VERSION: u8 = 19;

/// A declaration does not match the closed literal grammar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidLiteral;

struct Cursor<'a> {
    source: &'a [u8],
    offset: usize,
}

fn initial(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$'
}

impl<'a> Cursor<'a> {
    fn new(source: &'a [u8]) -> Self {
        Self { source, offset: 0 }
    }

    fn ws(&mut self, required: bool) -> Result<(), InvalidLiteral> {
        let before = self.offset;
        while self
            .source
            .get(self.offset)
            .is_some_and(|b| matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
        {
            self.offset += 1;
        }
        if required && before == self.offset {
            return Err(InvalidLiteral);
        }
        Ok(())
    }

    fn token(&mut self, token: &[u8]) -> Result<(), InvalidLiteral> {
        for byte in token {
            if self.source.get(self.offset) != Some(byte) {
                return Err(InvalidLiteral);
            }
            self.offset += 1;
        }
        Ok(())
    }

    fn identifier(&mut self) -> Result<(), InvalidLiteral> {
        if !self.source.get(self.offset).copied().is_some_and(initial) {
            return Err(InvalidLiteral);
        }
        let mut count = 0;
        while self
            .source
            .get(self.offset)
            .copied()
            .is_some_and(|b| initial(b) || b.is_ascii_digit())
        {
            count += 1;
            if count > 64 {
                return Err(InvalidLiteral);
            }
            self.offset += 1;
        }
        Ok(())
    }

    fn decimal(&mut self, digits: usize, maximum: u32) -> Result<u32, InvalidLiteral> {
        if !self.source.get(self.offset).is_some_and(u8::is_ascii_digit) {
            return Err(InvalidLiteral);
        }
        let zero = self.source[self.offset] == b'0';
        let mut count = 0;
        let mut value = 0;
        while let Some(byte) = self.source.get(self.offset).filter(|b| b.is_ascii_digit()) {
            count += 1;
            if count > digits || (zero && count > 1) {
                return Err(InvalidLiteral);
            }
            value = value * 10 + u32::from(*byte - b'0');
            self.offset += 1;
            if value > maximum {
                return Err(InvalidLiteral);
            }
        }
        Ok(value)
    }

    fn begin(&mut self) -> Result<(), InvalidLiteral> {
        self.ws(false)?;
        self.token(b"var")?;
        self.ws(true)?;
        self.identifier()?;
        self.ws(false)?;
        self.token(b"=")?;
        self.ws(false)
    }

    fn end(&mut self) -> Result<(), InvalidLiteral> {
        self.ws(false)?;
        self.token(b";")?;
        self.ws(false)?;
        if self.offset != self.source.len() {
            return Err(InvalidLiteral);
        }
        Ok(())
    }
}

/// Parse the bounded version declaration without allocating or copying its source.
pub fn client_version(source: &[u8]) -> Result<u16, InvalidLiteral> {
    if source.is_empty() || source.len() > VERSION_LIMIT {
        return Err(InvalidLiteral);
    }
    let mut cursor = Cursor::new(source);
    cursor.begin()?;
    let version = cursor.decimal(5, 65535)?;
    cursor.end()?;
    Ok(version as u16)
}

/// Parse exactly twenty decimal bytes, clearing caller-owned output on rejection.
pub fn password(source: &[u8], output: &mut [u8; 20]) -> Result<(), InvalidLiteral> {
    let result = (|| {
        if source.is_empty() || source.len() > PASSWORD_LIMIT {
            return Err(InvalidLiteral);
        }
        let mut cursor = Cursor::new(source);
        cursor.begin()?;
        cursor.token(b"[")?;
        cursor.ws(false)?;
        for (index, byte) in output.iter_mut().enumerate() {
            if index != 0 {
                cursor.token(b",")?;
                cursor.ws(false)?;
            }
            *byte = cursor.decimal(3, 255)? as u8;
            cursor.ws(false)?;
        }
        cursor.token(b"]")?;
        cursor.end()
    })();
    if result.is_err() {
        clear(output);
    }
    result
}

fn clear(bytes: &mut [u8]) {
    // Explicitly write owned storage; this does not promise erasure of compiler/register copies.
    std::hint::black_box(&mut *bytes).fill(0);
    std::hint::black_box(bytes);
}

/// Bounded scratch ownership for the scalar copied Wasm seam, with no host callbacks.
/// Callers must explicitly clear before freeing; Drop also clears retained storage.
pub struct LiteralStorage {
    input: [u8; VERSION_LIMIT + PASSWORD_LIMIT],
    output: [u8; 20],
    ready: bool,
}

impl Default for LiteralStorage {
    fn default() -> Self {
        Self {
            input: [0; VERSION_LIMIT + PASSWORD_LIMIT],
            output: [0; 20],
            ready: false,
        }
    }
}

impl LiteralStorage {
    /// Copy one admitted byte; rejected indices and numeric values never truncate.
    pub fn write(&mut self, index: u32, value: u32) -> bool {
        let Some(byte) = self.input.get_mut(index as usize) else {
            return false;
        };
        let Ok(value) = u8::try_from(value) else {
            return false;
        };
        *byte = value;
        true
    }

    /// Parse version first and clear its entire input region before returning.
    pub fn parse_version(&mut self, length: u32) -> i32 {
        let result = if length <= VERSION_LIMIT as u32 {
            client_version(&self.input[..length as usize])
                .map(i32::from)
                .unwrap_or(-1)
        } else {
            -1
        };
        clear(&mut self.input[..VERSION_LIMIT]);
        result
    }

    /// Parse password after version admission and clear its entire input region.
    pub fn parse_password(&mut self, length: u32) -> bool {
        clear(&mut self.output);
        self.ready = length <= PASSWORD_LIMIT as u32
            && password(
                &self.input[VERSION_LIMIT..VERSION_LIMIT + length as usize],
                &mut self.output,
            )
            .is_ok();
        clear(&mut self.input[VERSION_LIMIT..]);
        self.ready
    }

    /// Copy one output byte only after complete password syntax admission.
    pub fn password_byte(&self, index: u32) -> i32 {
        if !self.ready {
            return -1;
        }
        self.output
            .get(index as usize)
            .copied()
            .map(i32::from)
            .unwrap_or(-1)
    }

    /// Clear all owned input/output bytes while the allocation is still alive.
    pub fn clear(&mut self) {
        clear(&mut self.input);
        clear(&mut self.output);
        self.ready = false;
    }
}

impl Drop for LiteralStorage {
    fn drop(&mut self) {
        self.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_storage_is_explicitly_zeroed_before_release() {
        let mut storage = LiteralStorage::default();
        storage.input.fill(211);
        storage.output.fill(173);
        storage.ready = true;
        storage.clear();
        assert!(storage.input.iter().all(|b| *b == 0));
        assert_eq!(storage.output, [0; 20]);
        assert!(!storage.ready);
        storage.input.fill(33);
        assert_eq!(storage.parse_version(0), -1);
        assert!(storage.input[..VERSION_LIMIT].iter().all(|b| *b == 0));
        assert!(!storage.parse_password(0));
        assert!(storage.input.iter().all(|b| *b == 0));
        assert_eq!(storage.output, [0; 20]);
    }
}
