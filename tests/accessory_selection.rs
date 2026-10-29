//! Authored synthetic ready-accessory policy cases; no artwork or host runtime.
use slither_client::presentation::{stock_accessory_forward, stock_accessory_id};

#[test]
fn persisted_selection_is_bounded_and_never_uses_wire_cosmetics() {
    assert_eq!(stock_accessory_id(None, 0).unwrap(), None);
    assert_eq!(stock_accessory_id(Some("-1"), 0).unwrap(), None);
    assert_eq!(stock_accessory_id(Some("0"), 32).unwrap(), Some(0));
    assert_eq!(stock_accessory_id(Some("31"), 32).unwrap(), Some(31));
    for value in ["", "-2", "-0", "+1", "01", " 1", "1.0", "32", "4294967296"] {
        assert!(stock_accessory_id(Some(value), 32).is_err(), "{value}");
    }
    assert!(stock_accessory_id(Some("0"), 0).is_err());
    assert!(stock_accessory_id(Some("0"), 4097).is_err());
}

#[test]
fn forward_reuses_face_policy_and_custom_suppression() {
    assert_eq!(stock_accessory_forward(0, &[]).unwrap(), 6.);
    assert_eq!(stock_accessory_forward(41, &[]).unwrap(), 34.);
    assert_eq!(stock_accessory_forward(40, &[]).unwrap(), 6.);
    assert!(stock_accessory_forward(27, &[]).is_err());
    let custom = [0, 0, 0, 0, 0, 0, 0, 0, 2, 1];
    for skin in [27, 40, 41] {
        assert_eq!(stock_accessory_forward(skin, &custom).unwrap(), 6.);
    }
    assert!(stock_accessory_forward(0, &[0; 256]).is_err());
    assert_eq!(stock_accessory_forward(41, &[0; 8]).unwrap(), 34.);
}
