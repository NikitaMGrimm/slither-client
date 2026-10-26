//! A tokenized, closed grammar for the two-literal string-copy challenge family.
//!
//! Unknown programs are rejected; no source is evaluated or interpreted generally.

use std::fmt;

/// Maximum decoded source size accepted by the prototype.
pub const MAX_SOURCE_BYTES: usize = 256;

/// A challenge was outside the supported, bounded grammar.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChallengeError {
    /// Empty, odd-length, or oversized encoded input.
    Size,
    /// The wire encoding contained a non-ASCII letter.
    Alphabet,
    /// A decoded nibble exceeded fifteen.
    Nibble,
    /// A token, expression, or trailing input was unsupported.
    Syntax,
    /// A literal was not unescaped printable ASCII of its required length.
    Literal,
}

impl fmt::Display for ChallengeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Size => "challenge size must be even and within 2..=512 bytes",
            Self::Alphabet => "challenge encoding requires ASCII letters",
            Self::Nibble => "challenge encoding contains a nibble above 15",
            Self::Syntax => "unsupported challenge syntax or trailing tokens",
            Self::Literal => {
                "challenge requires unescaped printable ASCII literals of 5 and 22 bytes"
            }
        })
    }
}

impl std::error::Error for ChallengeError {}

/// Decode a challenge command payload (without its command byte) and solve it.
///
/// Only a declaration, literal append, and the fixed 27-byte copy loop are
/// accepted. Whitespace between tokens is allowed. Literal contents are runtime
/// input, not credentials embedded in the library.
pub fn solve_challenge(encoded: &[u8]) -> Result<Vec<u8>, ChallengeError> {
    if encoded.is_empty()
        || encoded.len() > MAX_SOURCE_BYTES * 2
        || !encoded.len().is_multiple_of(2)
    {
        return Err(ChallengeError::Size);
    }
    let mut source = Vec::with_capacity(encoded.len() / 2);
    let mut key = 23_u8;
    let mut high = 0;
    for (index, &letter) in encoded.iter().enumerate() {
        if !letter.is_ascii_alphabetic() {
            return Err(ChallengeError::Alphabet);
        }
        let nibble = (letter.to_ascii_lowercase() - b'a' + 26 - key) % 26;
        if nibble > 15 {
            return Err(ChallengeError::Nibble);
        }
        if index % 2 == 0 {
            high = nibble << 4;
        } else {
            source.push(high | nibble);
        }
        key = (key + 17) % 26;
    }
    let mut parser = Parser {
        source: &source,
        offset: 0,
    };
    parser.tokens(&["var", "a", "="])?;
    let first = parser.literal(5)?;
    parser.tokens(&[";", "a", "+="])?;
    let second = parser.literal(22)?;
    parser.tokens(&[
        ";",
        "for",
        "(",
        "var",
        "i",
        "=",
        "0",
        ";",
        "i",
        "<",
        "27",
        ";",
        "i",
        "++",
        ")",
        "{",
        "idba",
        "[",
        "i",
        "]",
        "=",
        "a",
        ".",
        "charCodeAt",
        "(",
        "i",
        ")",
        ";",
        "}",
    ])?;
    parser.whitespace();
    if parser.offset != source.len() {
        return Err(ChallengeError::Syntax);
    }

    let mut reply: Vec<_> = first.iter().chain(second).copied().collect();
    let mut rotation = 0_i32;
    for (index, byte) in reply.iter_mut().enumerate() {
        let (base, upper) = if *byte >= b'a' {
            (i32::from(b'a'), i32::from(*byte) - 32)
        } else {
            (i32::from(b'A'), i32::from(*byte))
        };
        let value = upper - i32::from(b'A');
        if index == 0 {
            rotation = 3 + value;
        }
        // JavaScript's remainder preserves the dividend's sign, including when
        // punctuation makes it negative. Euclidean modulo would change replies.
        *byte = ((value + rotation) % 26 + base) as u8;
        rotation += 4 + value;
    }
    Ok(reply)
}

struct Parser<'a> {
    source: &'a [u8],
    offset: usize,
}

impl<'a> Parser<'a> {
    fn whitespace(&mut self) {
        while self
            .source
            .get(self.offset)
            .is_some_and(|c| matches!(c, b' ' | b'\t' | b'\r' | b'\n'))
        {
            self.offset += 1;
        }
    }

    fn tokens(&mut self, expected: &[&str]) -> Result<(), ChallengeError> {
        for &token in expected {
            self.whitespace();
            let start = self.offset;
            let Some(&byte) = self.source.get(start) else {
                return Err(ChallengeError::Syntax);
            };
            if byte.is_ascii_alphabetic() || byte == b'_' {
                self.offset += 1;
                while self
                    .source
                    .get(self.offset)
                    .is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_')
                {
                    self.offset += 1;
                }
            } else if byte.is_ascii_digit() {
                self.offset += 1;
                while self.source.get(self.offset).is_some_and(u8::is_ascii_digit) {
                    self.offset += 1;
                }
            } else if self
                .source
                .get(start..start + 2)
                .is_some_and(|s| s == b"+=" || s == b"++")
            {
                self.offset += 2;
            } else {
                self.offset += 1;
            }
            if &self.source[start..self.offset] != token.as_bytes() {
                return Err(ChallengeError::Syntax);
            }
        }
        Ok(())
    }

    fn literal(&mut self, length: usize) -> Result<&'a [u8], ChallengeError> {
        self.whitespace();
        if self.source.get(self.offset) != Some(&b'"') {
            return Err(ChallengeError::Literal);
        }
        let start = self.offset + 1;
        let end = start + length;
        let literal = self.source.get(start..end).ok_or(ChallengeError::Literal)?;
        if literal
            .iter()
            .any(|c| !(b' '..=b'~').contains(c) || matches!(c, b'"' | b'\\'))
            || self.source.get(end) != Some(&b'"')
        {
            return Err(ChallengeError::Literal);
        }
        self.offset = end + 1;
        Ok(literal)
    }
}
