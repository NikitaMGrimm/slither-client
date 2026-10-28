//! Authored synthetic minimap commands; no reference inputs or network.

#[path = "../src/protocol/minimap.rs"]
mod minimap;

use minimap::{MinimapDecodeError as Error, MinimapFormat as Format, parse_minimap};

fn cells(command: &[u8]) -> Vec<(u8, usize)> {
    let packet = parse_minimap(command).unwrap();
    let mut cells = Vec::new();
    packet
        .visit_selected(packet.dimension().unwrap(), |layer, index| {
            cells.push((layer, index));
        })
        .unwrap();
    cells
}

#[test]
fn all_headers_accessors_and_big_endian_sizes() {
    for (bytes, format, advertised, dimension, layers) in [
        (&b"U\x01\x02"[..], Format::UpperU, Some(258), Some(258), 1),
        (&b"L\x03\x00\x03"[..], Format::LayeredL, Some(3), Some(3), 3),
        (&b"M\x00\x00"[..], Format::SnapshotM, Some(0), Some(0), 1),
        (&b"V"[..], Format::ToggleV, None, None, 1),
        (&b"u"[..], Format::LegacyU, None, Some(80), 1),
    ] {
        let packet = parse_minimap(bytes).unwrap();
        assert_eq!(packet.command().as_ptr(), bytes.as_ptr());
        assert_eq!(packet.command(), bytes);
        assert_eq!(packet.format(), format);
        assert_eq!(packet.advertised_size(), advertised);
        assert_eq!(packet.dimension(), dimension);
        assert_eq!(packet.layer_count(), layers);
    }
    for advertised in [512_u16, 513, u16::MAX] {
        let [hi, lo] = advertised.to_be_bytes();
        assert_eq!(
            parse_minimap(&[b'M', hi, lo]).unwrap().dimension(),
            Some(512)
        );
    }
}

#[test]
fn missing_fixed_headers_and_wrong_opcodes_are_rejected() {
    for bytes in [&b""[..], &b"m"[..], &b"a"[..]] {
        assert_eq!(parse_minimap(bytes), Err(Error::WrongOpcode));
    }
    for bytes in [
        &b"U"[..],
        &b"U\x01"[..],
        &b"L"[..],
        &b"L\x00"[..],
        &b"L\x00\x01"[..],
        &b"M\x00"[..],
    ] {
        assert_eq!(parse_minimap(bytes), Err(Error::TruncatedHeader));
    }
}

#[test]
fn reverse_and_forward_literals_cross_rows_without_padding() {
    assert_eq!(cells(&[b'M', 0, 2, 64]), [(0, 3)]);
    assert_eq!(cells(&[b'M', 0, 3, 1]), [(0, 2)]);
    assert_eq!(
        cells(&[b'M', 0, 3, 127, 127]),
        (0..9).rev().map(|i| (0, i)).collect::<Vec<_>>()
    );
    assert_eq!(cells(&[b'u', 64, 1]), [(0, 0), (0, 13)]);
    assert!(cells(&[b'M', 0, 2, 1]).is_empty());
}

#[test]
fn upper_and_legacy_255_do_not_consume_an_operand() {
    assert_eq!(cells(&[b'U', 0, 12, 255, 64]), [(0, 16)]);
    assert_eq!(cells(&[b'u', 255, 64]), [(0, 127)]);
    assert_eq!(cells(&[b'M', 0, 12, 255, 1, 64]), [(0, 17)]);
    assert_eq!(cells(&[b'M', 0, 2, 128, 255, 0, 64]), [(0, 3)]);
}

#[test]
fn layered_grids_discard_residual_bits_and_saturated_runs() {
    assert_eq!(cells(&[b'L', 2, 0, 1, 127, 64]), [(0, 0), (1, 0)]);
    assert_eq!(cells(&[b'L', 2, 0, 2, 255, 255, 64]), [(1, 3)]);
    assert_eq!(cells(&[b'L', 3, 0, 1, 64]), [(0, 0)]);
    assert!(cells(&[b'L', 0, 0, 2, 255]).is_empty());
}

#[test]
fn only_reachable_extended_operands_are_required() {
    for bytes in [&b"M\x00\x02\xff"[..], &b"L\x01\x00\x02\xff"[..]] {
        assert_eq!(parse_minimap(bytes), Err(Error::TruncatedRunOperand));
    }
    for bytes in [
        &b"M\x00\x00\xff"[..],
        &b"M\x00\x02\x7f\xff"[..],
        &b"M\x00\x02\xff\xff\xff"[..],
        &b"L\x00\x00\x02\xff"[..],
    ] {
        assert!(parse_minimap(bytes).is_ok());
    }
    let packet = parse_minimap(&[b'V', 255]).unwrap();
    assert_eq!(
        packet.visit_selected(2, |_, _| {}),
        Err(Error::TruncatedRunOperand)
    );
    assert!(packet.visit_selected(0, |_, _| {}).is_ok());
}

#[test]
fn empty_short_and_maximum_layer_payloads_are_bounded() {
    assert!(cells(&[b'L', 255, 2, 0]).is_empty());
    assert_eq!(cells(&[b'M', 2, 0, 64]), [(0, 512 * 512 - 1)]);
    assert!(cells(&[b'M', 0, 2, 255, 255]).is_empty());
    let mut saturated = vec![b'L', 255, 2, 0];
    for _ in 0..255 {
        for _ in 0..9 {
            saturated.extend([255, 255]);
        }
    }
    saturated.push(255); // Ignored after all 255 saturated grids.
    assert!(cells(&saturated).is_empty());
}
