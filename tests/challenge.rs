//! Synthetic programs and literals only; no captured challenge fixtures.

use slither_client::challenge::{ChallengeError, MAX_SOURCE_BYTES, solve_challenge};

// Construct synthetic source from individual grammar tokens. This is a test
// generator, not an embedded decoded challenge or a copied JavaScript snippet.
fn synthetic_tokens(first: &[u8], second: &[u8]) -> Vec<String> {
    let mut tokens = ["var", "a", "="].map(str::to_owned).to_vec();
    let quoted = |bytes: &[u8]| {
        let mut text = String::from('"');
        text.push_str(std::str::from_utf8(bytes).unwrap());
        text.push('"');
        text
    };
    tokens.push(quoted(first));
    tokens.extend([";", "a", "+="].map(str::to_owned));
    tokens.push(quoted(second));
    tokens.extend(
        [
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
        ]
        .map(str::to_owned),
    );
    tokens
}

fn encode(source: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(source.len() * 2);
    let mut key = 23;
    for byte in source {
        for nibble in [byte >> 4, byte & 15] {
            output.push(b'a' + (nibble + key) % 26);
            key = (key + 17) % 26;
        }
    }
    output
}

fn source() -> Vec<String> {
    synthetic_tokens(&[b'A'; 5], &[b'A'; 22])
}

#[test]
fn synthetic_roundtrip_and_case_insensitive_wire_alphabet() {
    let encoded = encode(source().join(" ").as_bytes());
    let expected = b"DHLPTXBFJNRVZDHLPTXBFJNRVZD";
    assert_eq!(solve_challenge(&encoded).unwrap(), expected);
    assert_eq!(
        solve_challenge(&encoded.to_ascii_uppercase()).unwrap(),
        expected
    );
    let lower = synthetic_tokens(&[b'a'; 5], &[b'a'; 22]);
    assert_eq!(
        solve_challenge(&encode(lower.join(" ").as_bytes())).unwrap(),
        expected.to_ascii_lowercase()
    );
}

#[test]
fn punctuation_uses_signed_remainder() {
    let tokens = synthetic_tokens(&[b' '; 5], &[b' '; 22]);
    let reply = solve_challenge(&encode(tokens.join(" ").as_bytes())).unwrap();
    assert_eq!(&reply[..3], b"630");
    assert_eq!(reply.len(), 27);
}

#[test]
fn whitespace_is_tokenized_and_source_bound_is_inclusive() {
    let mut bytes = source().join("\t").into_bytes();
    bytes.resize(MAX_SOURCE_BYTES, b'\n');
    assert_eq!(solve_challenge(&encode(&bytes)).unwrap().len(), 27);
    bytes.push(b' ');
    assert_eq!(solve_challenge(&encode(&bytes)), Err(ChallengeError::Size));
}

#[test]
fn unknown_tokens_and_trailing_programs_reject() {
    for (from, to) in [
        ("var", "let"),
        ("27", "027"),
        ("<", "<="),
        ("idba", "other"),
        ("charCodeAt", "eval"),
        ("++", "--"),
    ] {
        let mut tokens = source();
        let index = tokens.iter().position(|token| token == from).unwrap();
        tokens[index] = to.into();
        assert!(
            solve_challenge(&encode(tokens.join(" ").as_bytes())).is_err(),
            "accepted {from} -> {to}"
        );
    }
    for trailing in [";", "{}", "//", "\0"] {
        let mut bytes = source().join(" ");
        bytes.push_str(trailing);
        assert_eq!(
            solve_challenge(&encode(bytes.as_bytes())),
            Err(ChallengeError::Syntax)
        );
    }
}

#[test]
fn invalid_literals_reject() {
    for first in [
        b"ABCD".as_slice(),
        b"ABCDEF",
        b"AB\"DE",
        b"AB\\DE",
        b"AB\nDE",
        b"AB\x7fDE",
    ] {
        let tokens = synthetic_tokens(first, &[b'A'; 22]);
        assert_eq!(
            solve_challenge(&encode(tokens.join(" ").as_bytes())),
            Err(ChallengeError::Literal)
        );
    }
    let tokens = synthetic_tokens(&[b'A'; 5], &[b'A'; 21]);
    assert_eq!(
        solve_challenge(&encode(tokens.join(" ").as_bytes())),
        Err(ChallengeError::Literal)
    );
}

#[test]
fn invalid_wire_sizes_alphabet_and_nibble_reject() {
    for bytes in [vec![], vec![b'a'], vec![b'a'; 513]] {
        assert_eq!(solve_challenge(&bytes), Err(ChallengeError::Size));
    }
    assert_eq!(solve_challenge(b"@a"), Err(ChallengeError::Alphabet));
    assert_eq!(
        solve_challenge(&[0xff, b'a']),
        Err(ChallengeError::Alphabet)
    );
    assert_eq!(solve_challenge(b"na"), Err(ChallengeError::Nibble));
    let valid = encode(source().join(" ").as_bytes());
    for end in (2..valid.len()).step_by(2) {
        assert!(solve_challenge(&valid[..end]).is_err());
    }
}
