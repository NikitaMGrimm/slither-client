//! Synthetic protocol layouts only; no official login or frame payloads.

use slither_client::protocol::{
    ElapsedHeader::{Absent, TwoBytes},
    MAX_FRAME_BYTES, MAX_FRAME_COMMANDS, ProtocolError, decode_frame, encode_login,
    setup_protocol_version,
};

fn setup(length: usize) -> Vec<u8> {
    let mut bytes = vec![0; length];
    bytes[0] = b'a';
    if length > 23 {
        bytes[23] = 173;
    }
    bytes
}

#[test]
fn login_layout_preserves_runtime_inputs() {
    let password = std::array::from_fn(|index| index as u8);
    let packet = encode_login(0x1234, &password, "Synthetic", 7, Some(&[5, 9])).unwrap();
    assert_eq!(&packet[..4], &[b's', 30, 0x12, 0x34]);
    assert_eq!(&packet[4..24], &password);
    assert_eq!(&packet[24..26], &[7, 9]);
    assert_eq!(&packet[26..35], b"Synthetic");
    assert_eq!(&packet[35..], &[0, 255, 5, 9]);
    let empty = encode_login(0, &[0; 20], "", 0, None).unwrap();
    assert_eq!(empty.len(), 28);
    assert_eq!(&empty[24..], &[0, 0, 0, 255]);
}

#[test]
fn login_boundaries_and_printable_ascii() {
    assert_eq!(
        encode_login(u16::MAX, &[255; 20], &"~".repeat(24), 255, Some(&[0; 255]))
            .unwrap()
            .len(),
        307
    );
    for nickname in [
        "x".repeat(25),
        "\n".into(),
        "\x7f".into(),
        "é".into(),
        "🦀".into(),
    ] {
        assert_eq!(
            encode_login(0, &[0; 20], &nickname, 0, None),
            Err(ProtocolError::Nickname)
        );
    }
    assert_eq!(
        encode_login(0, &[0; 20], " ", 0, Some(&[0; 256])),
        Err(ProtocolError::CustomSkin)
    );
}

#[test]
fn bare_frames_and_explicit_elapsed_modes() {
    let bytes = [b'6', 1, 2, 3];
    let frame = decode_frame(&bytes, Absent).unwrap();
    assert_eq!(frame.elapsed_ms, None);
    assert_eq!(frame.commands, [&bytes[..]]);
    let timed = [0x12, 0x34, b'p'];
    let frame = decode_frame(&timed, TwoBytes).unwrap();
    assert_eq!(frame.elapsed_ms, Some(0x1234));
    assert_eq!(frame.commands, [b"p"]);
    assert!(decode_frame(&timed, Absent).is_err());
    // At the first position, a high byte denotes a bare command, not a length.
    assert_eq!(
        decode_frame(&[33, b'p'], Absent).unwrap().commands,
        [&[33, b'p']]
    );
}

#[test]
fn bundled_short_and_long_lengths_preserve_whole_commands() {
    let bytes = [0, 2, b'6', 99, 33, b'p', 0, 2, b'z', 42];
    assert_eq!(
        decode_frame(&bytes, Absent).unwrap().commands,
        [&[b'6', 99][..], b"p", &[b'z', 42]]
    );
    let mut long = vec![31, 255];
    long.extend(vec![b'z'; 8191]);
    long.extend([255]); // subsequent one-byte prefix: 223-byte command
    long.extend(vec![b'z'; 223]);
    let frame = decode_frame(&long, Absent).unwrap();
    assert_eq!(
        frame.commands.iter().map(|p| p.len()).collect::<Vec<_>>(),
        [8191, 223]
    );
}

#[test]
fn malformed_frame_tail_rejects_all_commands() {
    for (tail, error) in [
        (vec![0], ProtocolError::TruncatedLength),
        (vec![0, 0], ProtocolError::InvalidLength),
        (vec![32], ProtocolError::InvalidLength),
        (vec![0, 2, b'p'], ProtocolError::InvalidLength),
        (vec![0, 1, 1], ProtocolError::InvalidCommand),
        (vec![0, 1, b'a'], ProtocolError::TruncatedSetup),
    ] {
        let mut bytes = vec![0, 1, b'p'];
        bytes.extend(tail);
        assert_eq!(decode_frame(&bytes, Absent), Err(error));
    }
    assert_eq!(decode_frame(&[], Absent), Err(ProtocolError::EmptyFrame));
    assert_eq!(
        decode_frame(&[0], TwoBytes),
        Err(ProtocolError::TruncatedElapsed)
    );
    assert_eq!(
        decode_frame(&[0, 0], TwoBytes),
        Err(ProtocolError::EmptyFrame)
    );
}

#[test]
fn frame_byte_and_command_bounds() {
    assert_eq!(
        decode_frame(&vec![b'z'; MAX_FRAME_BYTES], Absent)
            .unwrap()
            .commands[0]
            .len(),
        MAX_FRAME_BYTES
    );
    assert_eq!(
        decode_frame(&vec![b'z'; MAX_FRAME_BYTES + 1], Absent),
        Err(ProtocolError::FrameTooLarge)
    );
    let mut bytes = [0, 1, b'p'].repeat(MAX_FRAME_COMMANDS);
    assert_eq!(
        decode_frame(&bytes, Absent).unwrap().commands.len(),
        MAX_FRAME_COMMANDS
    );
    bytes.extend([0, 1, b'p']);
    assert_eq!(
        decode_frame(&bytes, Absent),
        Err(ProtocolError::TooManyCommands)
    );
}

#[test]
fn setup_reports_advertised_version_without_compatibility_claim() {
    for length in [25, 27, 30, 31, 32, 40] {
        let bytes = setup(length);
        assert_eq!(setup_protocol_version(&bytes), Ok(173));
        assert_eq!(decode_frame(&bytes, Absent).unwrap().commands, [&bytes]);
    }
    for length in [1, 23, 24, 26, 28, 29] {
        assert_eq!(
            setup_protocol_version(&setup(length)),
            Err(ProtocolError::TruncatedSetup)
        );
    }
    let mut team = setup(31);
    team[30] = 2;
    assert_eq!(
        setup_protocol_version(&team),
        Err(ProtocolError::TruncatedSetup)
    );
    team.push(9);
    assert_eq!(setup_protocol_version(&team), Ok(173));
    assert_eq!(setup_protocol_version(b"p"), Err(ProtocolError::NotSetup));
}
