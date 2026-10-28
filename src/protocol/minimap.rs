//! Borrowed decoding of the five minimap command families.
//!
//! Frame envelopes and aggregate byte limits belong to the existing ingress.
//! Short grids and bytes beyond the last visited grid are valid.

use std::fmt;

/// Largest effective minimap dimension, including capped advertised sizes.
pub const MAX_MINIMAP_DIMENSION: u16 = 512;

/// Wire minimap family.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinimapFormat {
    /// White alternate-image replacement with single-byte runs.
    UpperU,
    /// Ordered colored layers with extended runs.
    LayeredL,
    /// Alternate-image and independent toggle-plane replacement.
    SnapshotM,
    /// Retained-size toggle update.
    ToggleV,
    /// Forward-traversed, fixed-80 base-image replacement.
    LegacyU,
}

/// Invalid fixed syntax or a reachable extended run without its operand.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MinimapDecodeError {
    /// The first byte is absent or is not a minimap opcode.
    WrongOpcode,
    /// A required size or layer-count header is incomplete.
    TruncatedHeader,
    /// A visited extended-run escape has no operand.
    TruncatedRunOperand,
}

impl fmt::Display for MinimapDecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::WrongOpcode => "expected a minimap opcode",
            Self::TruncatedHeader => "incomplete minimap header",
            Self::TruncatedRunOperand => "incomplete minimap run operand",
        })
    }
}

impl std::error::Error for MinimapDecodeError {}

/// Validated fixed header and borrowed complete command.
///
/// Toggle-V run validation is deferred until the retained dimension is known.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MinimapPacket<'a> {
    command: &'a [u8],
    format: MinimapFormat,
    header_len: usize,
}

impl<'a> MinimapPacket<'a> {
    /// Decoded opcode family.
    pub fn format(self) -> MinimapFormat {
        self.format
    }

    /// Uncapped wire size, absent for V and legacy u.
    pub fn advertised_size(self) -> Option<u16> {
        match self.format {
            MinimapFormat::UpperU | MinimapFormat::SnapshotM => {
                Some(u16::from_be_bytes([self.command[1], self.command[2]]))
            }
            MinimapFormat::LayeredL => Some(u16::from_be_bytes([self.command[2], self.command[3]])),
            MinimapFormat::ToggleV | MinimapFormat::LegacyU => None,
        }
    }

    /// Layer count for L, otherwise one.
    pub fn layer_count(self) -> u8 {
        if self.format == MinimapFormat::LayeredL {
            self.command[1]
        } else {
            1
        }
    }

    /// Exact command including opcode, headers and ignored tail.
    pub fn command(self) -> &'a [u8] {
        self.command
    }

    /// Effective replacement dimension; V uses the retained dimension instead.
    pub fn dimension(self) -> Option<u16> {
        if self.format == MinimapFormat::LegacyU {
            Some(80)
        } else {
            self.advertised_size()
                .map(|size| size.min(MAX_MINIMAP_DIMENSION))
        }
    }

    // Return the number of layers with a reachable payload byte. Validation,
    // painting and frame work accounting share the same run boundaries.
    pub(crate) fn visit_selected(
        self,
        dimension: u16,
        mut selected: impl FnMut(u8, usize),
    ) -> Result<usize, MinimapDecodeError> {
        let cells = usize::from(dimension) * usize::from(dimension);
        let extended = !matches!(self.format, MinimapFormat::UpperU | MinimapFormat::LegacyU);
        let mut tail = self.command[self.header_len..].iter().copied();
        let mut visited_layers = 0;
        for layer in 0..self.layer_count() {
            let mut cursor = 0;
            while cursor < cells {
                let Some(byte) = tail.next() else {
                    return Ok(visited_layers);
                };
                visited_layers = usize::from(layer) + 1;
                if byte < 128 {
                    for mask in [64, 32, 16, 8, 4, 2, 1] {
                        if cursor == cells {
                            break;
                        }
                        if byte & mask != 0 {
                            let index = if self.format == MinimapFormat::LegacyU {
                                cursor
                            } else {
                                cells - 1 - cursor
                            };
                            selected(layer, index);
                        }
                        cursor += 1;
                    }
                } else {
                    let skip = if byte == 255 && extended {
                        126 * usize::from(
                            tail.next().ok_or(MinimapDecodeError::TruncatedRunOperand)?,
                        )
                    } else {
                        usize::from(byte - 128)
                    };
                    cursor = (cursor + skip).min(cells);
                }
            }
        }
        Ok(visited_layers)
    }
}

/// Parse one full bare command without allocating or requiring a full bitmap.
pub fn parse_minimap(command: &[u8]) -> Result<MinimapPacket<'_>, MinimapDecodeError> {
    let (format, header_len) = match command.first() {
        Some(b'U') => (MinimapFormat::UpperU, 3),
        Some(b'L') => (MinimapFormat::LayeredL, 4),
        Some(b'M') => (MinimapFormat::SnapshotM, 3),
        Some(b'V') => (MinimapFormat::ToggleV, 1),
        Some(b'u') => (MinimapFormat::LegacyU, 1),
        _ => return Err(MinimapDecodeError::WrongOpcode),
    };
    if command.len() < header_len {
        return Err(MinimapDecodeError::TruncatedHeader);
    }
    let packet = MinimapPacket {
        command,
        format,
        header_len,
    };
    if let Some(dimension) = packet.dimension() {
        packet.visit_selected(dimension, |_, _| {})?;
    }
    Ok(packet)
}
