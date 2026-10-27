//! Validated login construction and bounded frame splitting without network I/O.

use std::fmt;

pub mod hud;

/// Maximum frame bytes, including any elapsed header.
pub const MAX_FRAME_BYTES: usize = 1 << 20;
/// Maximum commands in one frame.
pub const MAX_FRAME_COMMANDS: usize = 4096;

/// Validation failures for the prototype protocol boundary.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolError {
    /// Nicknames contain at most 24 printable ASCII bytes.
    Nickname,
    /// Custom skin data contains at most 255 bytes.
    CustomSkin,
    /// No payload was present.
    EmptyFrame,
    /// The frame exceeded the byte bound.
    FrameTooLarge,
    /// An elapsed header was incomplete.
    TruncatedElapsed,
    /// A two-byte packet length was incomplete.
    TruncatedLength,
    /// A packet length was zero or exceeded the remaining frame.
    InvalidLength,
    /// A bundled command had no printable-or-higher command byte.
    InvalidCommand,
    /// The frame exceeded the command count bound.
    TooManyCommands,
    /// The command was not a setup command.
    NotSetup,
    /// Setup ended before the mandatory fields or within an optional field.
    TruncatedSetup,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Nickname => "nickname must contain at most 24 printable ASCII bytes",
            Self::CustomSkin => "custom skin must contain at most 255 bytes",
            Self::EmptyFrame => "frame has no command payload",
            Self::FrameTooLarge => "frame exceeds 1048576 bytes",
            Self::TruncatedElapsed => "frame has a truncated two-byte elapsed header",
            Self::TruncatedLength => "frame has a truncated two-byte command length",
            Self::InvalidLength => "command length is zero or exceeds remaining frame bytes",
            Self::InvalidCommand => "command byte must be at least 32",
            Self::TooManyCommands => "frame exceeds 4096 commands",
            Self::NotSetup => "expected setup command 'a'",
            Self::TruncatedSetup => "setup command has incomplete mandatory or optional fields",
        })
    }
}

impl std::error::Error for ProtocolError {}

/// Construct a login with caller-supplied version and password bytes.
///
/// Empty nicknames are allowed. No official credential or version table is
/// embedded. Custom skin bytes are appended after the two appearance markers.
pub fn encode_login(
    client_version: u16,
    password: &[u8; 20],
    nickname: &str,
    skin: u8,
    custom_skin: Option<&[u8]>,
) -> Result<Vec<u8>, ProtocolError> {
    if nickname.len() > 24 || !nickname.bytes().all(|b| (b' '..=b'~').contains(&b)) {
        return Err(ProtocolError::Nickname);
    }
    let custom_skin = custom_skin.unwrap_or_default();
    if custom_skin.len() > 255 {
        return Err(ProtocolError::CustomSkin);
    }
    let mut bytes = Vec::with_capacity(28 + nickname.len() + custom_skin.len());
    bytes.extend([b's', 30]);
    bytes.extend(client_version.to_be_bytes());
    bytes.extend(password);
    bytes.extend([skin, nickname.len() as u8]);
    bytes.extend(nickname.as_bytes());
    bytes.extend([0, 255]);
    bytes.extend(custom_skin);
    Ok(bytes)
}

/// Explicit connection framing mode; this is never inferred from packet data.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ElapsedHeader {
    /// Header-free mode, requested by the caller's separate negotiation.
    Absent,
    /// A big-endian two-byte elapsed header precedes the payload.
    TwoBytes,
}

/// A structurally validated frame borrowing its complete command slices.
#[derive(Debug, Eq, PartialEq)]
pub struct DecodedFrame<'a> {
    /// Elapsed header, only in the explicitly selected timed mode.
    pub elapsed_ms: Option<u16>,
    /// Complete command bytes, including each command byte.
    pub commands: Vec<&'a [u8]>,
}

/// Validate a complete frame before returning any commands.
///
/// A first payload byte of at least 32 denotes a single bare command. Otherwise
/// bundling uses a two-byte big-endian length when the prefix is below 32, or a
/// one-byte length minus 32 for subsequent short prefixes. Empty commands and
/// malformed trailing records reject the entire frame. Setup field lengths are
/// checked; other command bodies remain opaque, not gameplay-validated.
pub fn decode_frame(
    bytes: &[u8],
    header: ElapsedHeader,
) -> Result<DecodedFrame<'_>, ProtocolError> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }
    let (elapsed_ms, payload) = match header {
        ElapsedHeader::Absent => (None, bytes),
        ElapsedHeader::TwoBytes => {
            let raw = bytes.get(..2).ok_or(ProtocolError::TruncatedElapsed)?;
            (Some(u16::from_be_bytes([raw[0], raw[1]])), &bytes[2..])
        }
    };
    let first = *payload.first().ok_or(ProtocolError::EmptyFrame)?;
    let mut commands = Vec::new();
    if first >= 32 {
        validate_command(payload)?;
        commands.push(payload);
    } else {
        let mut offset = 0;
        while offset < payload.len() {
            if commands.len() == MAX_FRAME_COMMANDS {
                return Err(ProtocolError::TooManyCommands);
            }
            let prefix = payload[offset];
            offset += 1;
            let length = if prefix < 32 {
                let low = *payload.get(offset).ok_or(ProtocolError::TruncatedLength)?;
                offset += 1;
                usize::from(u16::from_be_bytes([prefix, low]))
            } else {
                usize::from(prefix - 32)
            };
            if length == 0 || length > payload.len() - offset {
                return Err(ProtocolError::InvalidLength);
            }
            let command = &payload[offset..offset + length];
            validate_command(command)?;
            commands.push(command);
            offset += length;
        }
    }
    Ok(DecodedFrame {
        elapsed_ms,
        commands,
    })
}

fn validate_command(command: &[u8]) -> Result<(), ProtocolError> {
    if command[0] < 32 {
        return Err(ProtocolError::InvalidCommand);
    }
    if command[0] == b'a' {
        setup_protocol_version(command)?;
    }
    Ok(())
}

/// Return the advertised setup protocol without asserting its compatibility.
///
/// The 25-byte base may be followed by a complete two-byte server ID, three-byte
/// radius, and opaque extensions. This only validates field boundaries.
pub fn setup_protocol_version(command: &[u8]) -> Result<u8, ProtocolError> {
    if command.first() != Some(&b'a') {
        return Err(ProtocolError::NotSetup);
    }
    if command.len() < 25 || matches!(command.len(), 26 | 28 | 29) {
        return Err(ProtocolError::TruncatedSetup);
    }
    // Team mode adds one mandatory team byte after its mode byte.
    if command.len() == 31 && command[30] == 2 {
        return Err(ProtocolError::TruncatedSetup);
    }
    Ok(command[23])
}
