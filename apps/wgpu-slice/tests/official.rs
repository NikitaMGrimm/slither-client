//! ORIGINAL SYNTHETIC directory, script and selection fixtures. No external inputs/network.
#![cfg(not(target_arch = "wasm32"))]
use slither_wgpu_slice::{game::server_endpoint, official::*};
use std::{collections::BTreeMap, net::SocketAddr};
use url::Url;

fn encode(records: &[[u8; 28]]) -> Vec<u8> {
    let mut result = vec![b'a'];
    let mut offset = 0;
    for byte in records.iter().flatten() {
        for nibble in [byte >> 4, byte & 15] {
            result.push(b'a' + (nibble + offset) % 26);
            offset = (offset + 7) % 26;
        }
    }
    result
}
fn record(active: u8, port: u16, population: u16, cluster: u8, id: u16) -> [u8; 28] {
    let mut r = [0; 28];
    r[0] = active;
    r[1..5].copy_from_slice(&[192, 0, 2, 1]);
    r[21..23].copy_from_slice(&port.to_be_bytes());
    r[23..25].copy_from_slice(&population.to_be_bytes());
    r[25] = cluster;
    r[26..28].copy_from_slice(&id.to_be_bytes());
    r
}

#[test]
fn directory_rotates_across_records_and_splits_ipv6_clusters() {
    let a = record(26, 445, 400, 7, 1024);
    let mut b = record(27, 446, 65535, 8, 65534);
    b[5..21].copy_from_slice(
        &"2001:db8::1234"
            .parse::<std::net::Ipv6Addr>()
            .unwrap()
            .octets(),
    );
    let servers = decode_directory(&encode(&[a, b])).unwrap();
    assert_eq!(servers.len(), 3);
    assert_eq!(servers[0].address.to_string(), "192.0.2.1:445");
    assert_eq!(servers[0].population, 400);
    assert_eq!(servers[0].id, 1024);
    assert!(servers[0].active);
    assert!(!servers[1].active);
    assert_eq!(servers[2].cluster, 1008);
    assert_eq!(servers[2].endpoint(), "ws://[2001:db8::1234]:446/slither");
    for bad in [
        vec![],
        vec![b'a'],
        vec![b'b'; 57],
        vec![b'a'; 56],
        vec![0; 57],
        encode(&[record(0, 0, 20, 1, 1)]),
    ] {
        assert!(decode_directory(&bad).is_err());
    }
    let mut invalid_nibble = encode(&[a]);
    invalid_nibble[1] = b'z';
    assert!(decode_directory(&invalid_nibble).is_err());
    assert!(decode_directory(&vec![b'a'; 300_000]).is_err());
}

fn server(cluster: u16, population: u16, active: bool, port: u16) -> Server {
    Server {
        address: SocketAddr::from(([192, 0, 2, 5], port)),
        population,
        cluster,
        id: port,
        active,
    }
}
#[test]
fn fastest_cluster_then_population_plus_five_weights_and_original_fallback() {
    let servers = [
        server(1, 90, true, 448),
        server(2, 5, true, 447),
        server(2, 25, true, 446),
        server(2, 65535, false, 445),
    ];
    let pings = BTreeMap::from([(1, 50), (2, 10)]);
    assert_eq!(select_server(&servers, &pings, 0.0).unwrap(), 1);
    assert_eq!(select_server(&servers, &pings, 0.25).unwrap(), 1);
    assert_eq!(select_server(&servers, &pings, 0.25001).unwrap(), 2);
    assert_eq!(select_server(&servers, &pings, 0.9999).unwrap(), 2);
    assert_eq!(
        select_server(&servers, &BTreeMap::from([(1, 10), (2, 10)]), 0.5).unwrap(),
        2
    );
    assert_eq!(select_server(&servers, &BTreeMap::new(), 0.99).unwrap(), 2);
    assert!(select_server(&[], &pings, 0.0).is_err());
    assert!(select_server(&servers, &pings, 1.0).is_err());
    assert!(select_server(&servers, &pings, f64::NAN).is_err());
    // Even an inactive fallback seed can be replaced by an equally pinged populated record.
    assert_eq!(
        select_server(
            &[server(1, 21, false, 450), server(2, 0, false, 451)],
            &BTreeMap::new(),
            0.99
        )
        .unwrap(),
        0
    );
}

#[test]
fn page_selects_current_external_game_script_without_comment_or_ad_scripts() {
    let base = Url::parse("http://slither.io/?a").unwrap();
    let page = "<!-- <script src='/s/game111.js'></script> --><script src='https://ads.invalid/a.js'></script><script type='text/javascript' src='https://slither.io/s/game999.js'></script>";
    assert_eq!(
        client_script(page, &base).unwrap().as_str(),
        "https://slither.io/s/game999.js"
    );
    assert!(
        client_script(
            "<script src='https://other.invalid/s/game999.js'></script>",
            &base
        )
        .is_err()
    );
    assert!(
        client_script(
            "<script src='/s/game1.js'></script><script src='/s/game2.js'></script>",
            &base
        )
        .is_err()
    );
    assert!(client_script("<script>let x=1;</script>", &base).is_err());
}

#[test]
fn closed_profile_literals_and_dynamic_directory_url_never_evaluate_script() {
    let script = "throw Error('do not execute'); var client_version = 4242; var cpw = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]; getData('https://slither.io/i999.txt', handler);";
    let p = profile(script.as_bytes()).unwrap();
    assert_eq!(p.client_version, 4242);
    assert_eq!(p.password, std::array::from_fn(|i| i as u8));
    assert_eq!(
        directory_url(script).unwrap().as_str(),
        "https://slither.io/i999.txt"
    );
    for bad in [
        script.replace("4242;", "f();"),
        script.replace("18,19]", "18]"),
        script.replace("18,19]", "18,256]"),
        format!("{script} var client_version=4;"),
        script.replace("var cpw", "var cpw_suffix"),
    ] {
        assert!(profile(bad.as_bytes()).is_err());
    }
    assert!(directory_url("https://other.invalid/i999.txt").is_err());
    assert!(directory_url("https://slither.io/i1.txt https://slither.io/i2.txt").is_err());
    assert!(profile(&vec![b' '; 1024 * 1024 + 1]).is_err());
}

#[test]
fn explicit_hosts_and_shared_urls_allow_remote_ipv4_ipv6_and_dns() {
    for host in [
        "192.0.2.1:445",
        "game.example:80",
        "[2001:db8::1]:446",
        "127.0.0.1:19491",
    ] {
        let endpoint = explicit_endpoint(host).unwrap();
        assert!(server_endpoint(&endpoint).is_ok());
    }
    for bad in [
        "game.example",
        "x:0",
        "x:65536",
        "user@host:445",
        "x:445/other",
        "x:445?q=a",
        "x:445#f",
        "x:445\n",
        "ws://x:445",
    ] {
        assert!(explicit_endpoint(bad).is_err(), "{bad:?}");
    }
    for bad in [
        "wss://x:445/slither",
        "ws://x:445/",
        "ws://x/slither?q=a",
        "ws://x/slither#f",
        "ws://u@x/slither",
        "ws://x:0/slither",
    ] {
        assert!(server_endpoint(bad).is_err());
    }
}
