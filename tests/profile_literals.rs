//! Authored synthetic declarations only; no downloaded source or acquisition.
use slither_client::profile_literals::{self, InvalidLiteral, LiteralStorage};

fn password(values: &str) -> String {
    format!("var syntheticPassword=[{values}];")
}
fn zeros(count: usize) -> String {
    vec!["0"; count].join(",")
}

#[test]
fn exact_decimal_version_and_ascii_identifier_language() {
    for (text, expected) in [
        ("var v=0;", 0),
        ("\tvar $_v9\r\n= 65535 ;\n", 65535),
        ("var a=17;", 17),
    ] {
        assert_eq!(
            profile_literals::client_version(text.as_bytes()),
            Ok(expected)
        );
    }
    let bounded = format!("var {}=1;", "a".repeat(64));
    assert_eq!(profile_literals::client_version(bounded.as_bytes()), Ok(1));
    for value in [
        "65536", "-1", "+1", "1.0", "1e2", "0x10", "0o10", "0b10", "01", "1_0", "123456", "NaN",
        "Infinity", "value", "f()", "\"17\"",
    ] {
        assert_eq!(
            profile_literals::client_version(format!("var v={value};").as_bytes()),
            Err(InvalidLiteral)
        );
    }
    for source in [
        "varv=17;",
        "let v=17;",
        "var v/*x*/=17;",
        "var v=17",
        "var v=17;extra;",
        "var é=17;",
        "var \\u0076=17;",
        "var v=17;\0",
        "var v=17;\u{b}",
        "var 9v=17;",
    ] {
        assert_eq!(
            profile_literals::client_version(source.as_bytes()),
            Err(InvalidLiteral)
        );
    }
    assert_eq!(
        profile_literals::client_version(format!("var {}=1;", "a".repeat(65)).as_bytes()),
        Err(InvalidLiteral)
    );
}

#[test]
fn only_four_whitespace_bytes_are_admitted() {
    for byte in 0..=255u8 {
        let mut declaration = b"var v=17;".to_vec();
        declaration.insert(3, byte);
        assert_eq!(
            profile_literals::client_version(&declaration).is_ok(),
            b" \t\n\r".contains(&byte)
        );
    }
}

#[test]
fn exactly_twenty_password_bytes_and_no_partial_output_on_any_error() {
    let values = (0..19)
        .map(|i| i.to_string())
        .chain(["255".to_owned()])
        .collect::<Vec<_>>()
        .join(" ,\t");
    let source = format!("\rvar $bytes9 = [ {values} ] ;\n");
    let mut output = [7; 20];
    assert_eq!(
        profile_literals::password(source.as_bytes(), &mut output),
        Ok(())
    );
    assert_eq!(&output[..19], &(0..19).collect::<Vec<_>>());
    assert_eq!(output[19], 255);
    for count in [0, 1, 19, 21] {
        output.fill(7);
        assert_eq!(
            profile_literals::password(password(&zeros(count)).as_bytes(), &mut output),
            Err(InvalidLiteral)
        );
        assert_eq!(output, [0; 20]);
    }
    for value in [
        "256", "-1", "+0", "1.5", "1e1", "0x10", "00", "1_0", "1234", "n", "f()", "\"1\"",
    ] {
        for index in [0, 19] {
            let mut values = vec!["0"; 20];
            values[index] = value;
            output.fill(7);
            assert_eq!(
                profile_literals::password(password(&values.join(",")).as_bytes(), &mut output),
                Err(InvalidLiteral)
            );
            assert_eq!(output, [0; 20]);
        }
    }
    for suffix in [",", "];extra", "\0", "/*x*/"] {
        let malformed = format!("var p=[{}{suffix}];", zeros(20));
        output.fill(7);
        assert_eq!(
            profile_literals::password(malformed.as_bytes(), &mut output),
            Err(InvalidLiteral)
        );
        assert_eq!(output, [0; 20]);
    }
}

#[test]
fn span_limits_are_exact_and_input_is_borrowed_unchanged() {
    let mut version = b"var v=1;".to_vec();
    version.resize(128, b' ');
    assert_eq!(profile_literals::client_version(&version), Ok(1));
    version.push(b' ');
    assert_eq!(
        profile_literals::client_version(&version),
        Err(InvalidLiteral)
    );
    let mut source = password(&zeros(20)).into_bytes();
    source.resize(256, b' ');
    let original = source.clone();
    let mut output = [7; 20];
    assert_eq!(profile_literals::password(&source, &mut output), Ok(()));
    assert_eq!(source, original);
    source.push(b' ');
    assert_eq!(
        profile_literals::password(&source, &mut output),
        Err(InvalidLiteral)
    );
    assert_eq!(output, [0; 20]);
}

#[test]
fn scratch_copies_scalar_values_and_rejection_cannot_expose_partial_password() {
    let mut storage = LiteralStorage::default();
    assert_eq!(storage.password_byte(0), -1);
    assert!(!storage.write(384, 1));
    assert!(!storage.write(u32::MAX, 1));
    assert!(!storage.write(0, 256));
    assert!(!storage.write(0, u32::MAX));
    for (i, byte) in b"var v=65535;".iter().enumerate() {
        assert!(storage.write(i as u32, u32::from(*byte)));
    }
    assert_eq!(storage.parse_version(12), 65535);
    let source = password(&vec!["255"; 20].join(","));
    for (i, byte) in source.bytes().enumerate() {
        assert!(storage.write(128 + i as u32, u32::from(byte)));
    }
    assert!(storage.parse_password(source.len() as u32));
    for index in 0..20 {
        assert_eq!(storage.password_byte(index), 255);
    }
    assert_eq!(storage.password_byte(20), -1);
    storage.clear();
    assert_eq!(storage.password_byte(0), -1);
    assert!(!storage.parse_password(257));
    assert_eq!(storage.parse_version(129), -1);
    assert_eq!(profile_literals::PROTOCOL_VERSION, 19);
}
