//! Authored synthetic bare commands only; no captured packets or reference data.

use std::iter::FusedIterator;

use slither_client::protocol::{
    ElapsedHeader, MAX_FRAME_BYTES, decode_frame,
    hud::{HudPacketError, LeaderboardRows, parse_announcement, parse_leaderboard},
};

fn append_row(packet: &mut Vec<u8>, count: u16, mass: [u8; 3], color: u8, name: &[u8]) {
    packet.extend(count.to_be_bytes());
    packet.extend(mass);
    packet.extend([color, u8::try_from(name.len()).unwrap()]);
    packet.extend(name);
}

#[test]
fn leaderboard_projects_exact_header_rows_and_borrowed_names() {
    let packet = [
        b'l', 2, 0x12, 0x34, 0xab, 0xcd, // Header: local ordinal differs from rank.
        0x01, 0x02, 0, 0, 0, 8, 0, // Blank row, zero mass.
        0xff, 0xff, 0x12, 0x34, 0x56, 255, 7, b'A', b' ', 0, 31, 127, 128, 255, 0, 0, 255, 255,
        255, 9, 1, b'Z', // Full mass, modulo wraps to zero.
    ];
    let before = packet;
    let board = parse_leaderboard(&packet).unwrap();
    assert_eq!(
        (board.local_row(), board.rank(), board.population()),
        (2, 0x1234, 0xabcd)
    );
    assert_eq!(board.row_count(), 3);
    let rows: Vec<_> = board.rows().collect();
    assert_eq!(
        rows.iter().map(|row| row.ordinal()).collect::<Vec<_>>(),
        [1, 2, 3]
    );
    assert_eq!(
        rows.iter().map(|row| row.count()).collect::<Vec<_>>(),
        [258, 65535, 0]
    );
    assert_eq!(rows[0].fractional_mass().to_bits(), 0.0_f64.to_bits());
    assert_eq!(
        rows[1].fractional_mass().to_bits(),
        (1193046.0_f64 / 16777215.0).to_bits()
    );
    assert_eq!(rows[2].fractional_mass().to_bits(), 1.0_f64.to_bits());
    assert_eq!(
        rows.iter().map(|row| row.raw_color()).collect::<Vec<_>>(),
        [8, 255, 9]
    );
    assert_eq!(
        rows.iter()
            .map(|row| row.palette_index())
            .collect::<Vec<_>>(),
        [8, 3, 0]
    );
    assert_eq!(rows[0].name(), b"");
    assert_eq!(rows[1].name(), &[b'A', b' ', 0, 31, 127, 128, 255]);
    assert_eq!(rows[2].name(), b"Z");
    assert_eq!(rows[1].name().as_ptr(), packet[20..].as_ptr());
    assert_eq!(packet, before);
}

#[test]
fn header_only_preserves_zero_extreme_and_unmatched_local_row_values() {
    for packet in [
        [b'l', 0, 0, 0, 0, 0],
        [b'l', 255, 0, 0, 0, 0],
        [b'l', 1, 255, 255, 255, 255],
    ] {
        let board = parse_leaderboard(&packet).unwrap();
        assert_eq!(board.local_row(), packet[1]);
        assert_eq!(board.rank(), u16::from_be_bytes([packet[2], packet[3]]));
        assert_eq!(
            board.population(),
            u16::from_be_bytes([packet[4], packet[5]])
        );
        assert_eq!(board.row_count(), 0);
        assert_eq!(board.rows().next(), None);
        assert_eq!(board.rows().len(), 0);
    }
}

#[test]
fn more_than_ten_rows_and_maximum_name_are_retained_without_text_policy() {
    let name: Vec<u8> = (0..255).collect();
    let mut packet = vec![b'l', 255, 0, 1, 0, 1];
    for count in 0..13 {
        append_row(
            &mut packet,
            count,
            [0, 0, 1],
            count as u8,
            if count % 2 == 0 { &name } else { b"" },
        );
    }
    let before = packet.clone();
    let board = parse_leaderboard(&packet).unwrap();
    assert_eq!(board.local_row(), 255);
    assert_eq!(board.row_count(), 13);
    for (index, row) in board.rows().enumerate() {
        assert_eq!(row.ordinal(), index + 1);
        assert_eq!(usize::from(row.count()), index);
        assert_eq!(
            row.fractional_mass().to_bits(),
            (1.0_f64 / 16777215.0).to_bits()
        );
        assert_eq!(
            row.name(),
            if index % 2 == 0 { name.as_slice() } else { b"" }
        );
    }
    assert_eq!(packet, before);
}

#[test]
fn iterators_are_independent_clonable_exact_size_and_fused() {
    fn check_traits(_: impl ExactSizeIterator + FusedIterator + Clone) {}

    let mut packet = vec![b'l', 0, 0, 0, 0, 0];
    for count in [50, 9, 50, 0] {
        append_row(&mut packet, count, [0, 0, 0], 0, b"");
    }
    let board = parse_leaderboard(&packet).unwrap();
    let mut rows: LeaderboardRows<'_> = board.rows();
    check_traits(rows.clone());
    assert_eq!(rows.size_hint(), (4, Some(4)));
    assert_eq!(rows.next().unwrap().count(), 50);
    let mut clone = rows.clone();
    assert_eq!(clone.next().unwrap().ordinal(), 2);
    assert_eq!(rows.len(), 3);
    assert_eq!(clone.len(), 2);
    assert_eq!(rows.next().unwrap().count(), 9);
    assert_eq!(
        rows.clone().collect::<Vec<_>>(),
        clone.clone().collect::<Vec<_>>()
    );
    assert_eq!(rows.next().unwrap().ordinal(), 3);
    assert_eq!(rows.next().unwrap().ordinal(), 4);
    assert_eq!(rows.len(), 0);
    assert_eq!(rows.size_hint(), (0, Some(0)));
    assert_eq!(rows.next(), None);
    assert_eq!(rows.next(), None);
    assert_eq!(
        board.rows().collect::<Vec<_>>(),
        board.rows().collect::<Vec<_>>()
    );
    assert_eq!(
        board.rows().map(|row| row.count()).collect::<Vec<_>>(),
        [50, 9, 50, 0]
    );
}

#[test]
fn every_leaderboard_header_and_first_row_truncation_is_rejected() {
    let mut packet = vec![b'l', 1, 0, 7, 0, 23];
    append_row(&mut packet, 1, [1, 2, 3], 4, b"name");
    assert_eq!(parse_leaderboard(&[]), Err(HudPacketError::EmptyCommand));
    for end in 1..6 {
        assert_eq!(
            parse_leaderboard(&packet[..end]),
            Err(HudPacketError::TruncatedPacket),
            "header end {end}"
        );
    }
    assert!(parse_leaderboard(&packet[..6]).is_ok());
    for end in 7..packet.len() {
        assert_eq!(
            parse_leaderboard(&packet[..end]),
            Err(HudPacketError::TruncatedPacket),
            "row end {end}"
        );
    }
    assert_eq!(parse_leaderboard(&packet).unwrap().row_count(), 1);
}

#[test]
fn valid_header_and_earlier_rows_never_escape_a_late_invalid_tail() {
    let mut packet = vec![b'l', 2, 0, 7, 0, 23];
    append_row(&mut packet, 1, [0, 0, 0], 0, b"first");
    append_row(&mut packet, 2, [0, 0, 0], 0, b"");
    let valid_end = packet.len();
    append_row(&mut packet, 3, [0, 0, 0], 0, b"last");
    for end in valid_end + 1..packet.len() {
        assert_eq!(
            parse_leaderboard(&packet[..end]),
            Err(HudPacketError::TruncatedPacket),
            "late end {end}"
        );
    }
    packet.push(0);
    let before = packet.clone();
    assert_eq!(
        parse_leaderboard(&packet),
        Err(HudPacketError::TruncatedPacket)
    );
    assert_eq!(packet, before);
}

#[test]
fn announcement_projects_exact_count_mass_and_raw_borrowed_content() {
    let packet = [
        b'm', 0x12, 0x34, 0x56, 0x65, 0x43, 0x21, 7, b'A', b' ', 0, 31, 127, 128, 255, b'<', b'&',
        b' ', b' ', 255, 0, b'l',
    ];
    let before = packet;
    let announcement = parse_announcement(&packet).unwrap();
    assert_eq!(announcement.count(), 0x123456);
    assert_eq!(
        announcement.fractional_mass().to_bits(),
        (6636321.0_f64 / 16777215.0).to_bits()
    );
    assert_eq!(announcement.name(), &[b'A', b' ', 0, 31, 127, 128, 255]);
    assert_eq!(
        announcement.message(),
        &[b'<', b'&', b' ', b' ', 255, 0, b'l']
    );
    assert_eq!(announcement.name().as_ptr(), packet[8..].as_ptr());
    assert_eq!(announcement.message().as_ptr(), packet[15..].as_ptr());
    assert_eq!(packet, before);
}

#[test]
fn announcement_accepts_all_empty_name_message_combinations_and_mass_endpoints() {
    for name in [b"".as_slice(), b"name"] {
        for message in [b"".as_slice(), b"message"] {
            for value in [0, 255] {
                let mut packet = vec![
                    b'm',
                    value,
                    value,
                    value,
                    value,
                    value,
                    value,
                    name.len() as u8,
                ];
                packet.extend(name);
                packet.extend(message);
                let view = parse_announcement(&packet).unwrap();
                assert_eq!(view.count(), if value == 0 { 0 } else { 16777215 });
                assert_eq!(
                    view.fractional_mass().to_bits(),
                    if value == 0 { 0.0_f64 } else { 1.0_f64 }.to_bits()
                );
                assert_eq!(view.name(), name);
                assert_eq!(view.message(), message);
            }
        }
    }
}

#[test]
fn inbound_announcement_has_no_editor_name_or_message_caps() {
    let name: Vec<u8> = (0..255).collect();
    let message: Vec<u8> = (0..=255).cycle().take(512).collect();
    let mut packet = vec![b'm', 0, 0, 0, 0, 0, 0, 255];
    packet.extend(&name);
    packet.extend(&message);
    let before = packet.clone();
    let view = parse_announcement(&packet).unwrap();
    assert_eq!(view.count(), 0);
    assert_eq!(view.name(), name);
    assert_eq!(view.message(), message);
    assert_eq!(packet, before);
}

#[test]
fn every_announcement_required_prefix_and_name_truncation_is_rejected() {
    let packet = [b'm', 1, 2, 3, 4, 5, 6, 4, b'n', b'a', b'm', b'e'];
    assert_eq!(parse_announcement(&[]), Err(HudPacketError::EmptyCommand));
    for end in 1..packet.len() {
        assert_eq!(
            parse_announcement(&packet[..end]),
            Err(HudPacketError::TruncatedPacket),
            "end {end}"
        );
    }
    assert!(parse_announcement(&packet).unwrap().message().is_empty());
}

#[test]
fn every_declared_name_length_requires_its_complete_bytes() {
    for length in 0..=255 {
        let mut leaderboard = vec![b'l', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, length];
        let mut announcement = vec![b'm', 0, 0, 0, 0, 0, 0, length];
        leaderboard.extend(std::iter::repeat_n(255, usize::from(length)));
        announcement.extend(std::iter::repeat_n(255, usize::from(length)));
        for available in 0..usize::from(length) {
            assert_eq!(
                parse_leaderboard(&leaderboard[..13 + available]),
                Err(HudPacketError::TruncatedPacket)
            );
            assert_eq!(
                parse_announcement(&announcement[..8 + available]),
                Err(HudPacketError::TruncatedPacket)
            );
        }
        assert_eq!(
            parse_leaderboard(&leaderboard)
                .unwrap()
                .rows()
                .next()
                .unwrap()
                .name()
                .len(),
            usize::from(length)
        );
        assert_eq!(
            parse_announcement(&announcement).unwrap().name().len(),
            usize::from(length)
        );
    }
}

#[test]
fn wrong_opcodes_and_frame_envelopes_are_not_inferred() {
    for opcode in 0..=255 {
        let mut packet = [0; 8];
        packet[0] = opcode;
        if opcode != b'l' {
            assert_eq!(parse_leaderboard(&packet), Err(HudPacketError::WrongOpcode));
        }
        if opcode != b'm' {
            assert_eq!(
                parse_announcement(&packet),
                Err(HudPacketError::WrongOpcode)
            );
        }
    }
    for packet in [
        &[0, 0, b'l', 0, 0, 0, 0, 0][..], // Elapsed header.
        &[0, 6, b'l', 0, 0, 0, 0, 0][..], // Bundle length.
    ] {
        assert_eq!(parse_leaderboard(packet), Err(HudPacketError::WrongOpcode));
        assert_eq!(parse_announcement(packet), Err(HudPacketError::WrongOpcode));
    }
    assert_eq!(parse_leaderboard(b"m"), Err(HudPacketError::WrongOpcode));
    assert_eq!(parse_announcement(b"l"), Err(HudPacketError::WrongOpcode));
}

#[test]
fn oversized_commands_fail_before_body_validation_even_for_wrong_opcode() {
    let mut packet = vec![0; MAX_FRAME_BYTES + 1];
    for opcode in [0, b'l', b'm'] {
        packet[0] = opcode;
        assert_eq!(
            parse_leaderboard(&packet),
            Err(HudPacketError::CommandTooLarge)
        );
        assert_eq!(
            parse_announcement(&packet),
            Err(HudPacketError::CommandTooLarge)
        );
    }
}

#[test]
fn frame_byte_bound_is_inclusive_and_only_bounds_inbound_message() {
    let mut packet = vec![255; MAX_FRAME_BYTES];
    packet[..8].copy_from_slice(&[b'm', 255, 255, 255, 255, 255, 255, 0]);
    let view = parse_announcement(&packet).unwrap();
    assert_eq!(view.count(), 16777215);
    assert!(view.name().is_empty());
    assert_eq!(view.message().len(), MAX_FRAME_BYTES - 8);
    assert!(view.message().iter().all(|byte| *byte == 255));
    assert_eq!(view.message().as_ptr(), packet[8..].as_ptr());
}

#[test]
fn maximum_row_count_is_derived_from_byte_bound_without_narrowing_ordinals() {
    let mut packet = vec![0; MAX_FRAME_BYTES];
    packet[0] = b'l';
    let count = (MAX_FRAME_BYTES - 6) / 7;
    let extra_name_bytes = (MAX_FRAME_BYTES - 6) % 7;
    packet[6 + (count - 1) * 7 + 6] = extra_name_bytes as u8;
    let board = parse_leaderboard(&packet).unwrap();
    assert_eq!(board.row_count(), count);
    assert_eq!(board.rows().len(), count);
    let mut seen = 0;
    for row in board.rows() {
        seen += 1;
        assert_eq!(row.ordinal(), seen);
        assert_eq!(row.count(), 0);
        assert_eq!(
            row.name().len(),
            if seen == count { extra_name_bytes } else { 0 }
        );
    }
    assert_eq!(seen, count);
}

#[test]
fn legacy_frame_decoder_keeps_hud_bodies_opaque() {
    for command in [b"l".as_slice(), b"m".as_slice()] {
        let decoded = decode_frame(command, ElapsedHeader::Absent).unwrap();
        assert_eq!(decoded.commands, [command]);
        assert_eq!(decoded.elapsed_ms, None);
    }
    assert_eq!(
        parse_leaderboard(b"l"),
        Err(HudPacketError::TruncatedPacket)
    );
    assert_eq!(
        parse_announcement(b"m"),
        Err(HudPacketError::TruncatedPacket)
    );
}
