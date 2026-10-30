//! Native official-site discovery. Downloads are inert, bounded, and never persisted.
use crate::{
    Result,
    game::{LoginProfile, server_endpoint},
    native,
};
use scraper::{Html, Selector};
use slither_client::profile_literals;
use std::{
    collections::BTreeMap,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::Message;
use url::Url;

const PAGE: &str = "https://slither.io/";
const PAGE_LIMIT: usize = 256 * 1024;
const SCRIPT_LIMIT: usize = 1024 * 1024;
const DIRECTORY_LIMIT: usize = 256 * 1024;

pub struct Prepared {
    pub endpoint: String,
    pub profile: LoginProfile,
}

/// One preparation per Play, outside the event loop and before the session deadline starts.
pub struct Preparation {
    receiver: mpsc::Receiver<Result<Prepared>>,
    cancel: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Preparation {
    pub fn start(server: Option<String>) -> Result<Self> {
        let (sender, receiver) = mpsc::sync_channel(1);
        let cancel = Arc::new(AtomicBool::new(false));
        let flag = cancel.clone();
        let worker = thread::Builder::new()
            .name("official-discovery".into())
            .spawn(move || {
                let result = prepare(server.as_deref(), &flag);
                let _ = sender.send(result);
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            receiver,
            cancel,
            worker: Some(worker),
        })
    }
    pub fn poll(&mut self) -> Option<Result<Prepared>> {
        match self.receiver.try_recv() {
            Ok(result) => Some(result),
            Err(mpsc::TryRecvError::Empty) => None,
            Err(mpsc::TryRecvError::Disconnected) => Some(Err("Discovery worker stopped".into())),
        }
    }
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}
impl Drop for Preparation {
    fn drop(&mut self) {
        self.cancel();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::SeqCst) {
        Err("Discovery cancelled".into())
    } else {
        Ok(())
    }
}

struct Inert(Vec<u8>);
impl Drop for Inert {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

fn site_url(url: &Url) -> Result<()> {
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str() != Some("slither.io")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port().is_some()
    {
        return Err("Unexpected official-site URL".into());
    }
    Ok(())
}

/// The site currently redirects HTTPS to HTTP. Keep redirects on the canonical host.
fn fetch(url: &Url, limit: usize, cancel: &AtomicBool) -> Result<(Url, Inert)> {
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut url = url.clone();
    for _ in 0..=3 {
        check_cancel(cancel)?;
        site_url(&url)?;
        let left = deadline
            .checked_duration_since(Instant::now())
            .ok_or("Site request deadline")?;
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .max_redirects(0)
            .http_status_as_error(false)
            .timeout_global(Some(left))
            .build()
            .into();
        let mut response = agent
            .get(url.as_str())
            .header("User-Agent", native::USER_AGENT)
            .call()
            .map_err(|_| "Official site request failed")?;
        check_cancel(cancel)?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or("Official site redirect lacks Location")?;
            url = url
                .join(location)
                .map_err(|_| "Invalid official site redirect")?;
            continue;
        }
        if response.status() != 200 {
            return Err("Official site returned a non-200 response".into());
        }
        let bytes = response
            .body_mut()
            .with_config()
            .limit(limit as u64)
            .read_to_vec()
            .map_err(|_| "Official site body exceeds deadline/size or is incomplete")?;
        let bytes = Inert(bytes);
        check_cancel(cancel)?;
        return Ok((url, bytes));
    }
    Err("Too many official site redirects".into())
}

pub fn client_script(page: &str, page_url: &Url) -> Result<Url> {
    let html = Html::parse_document(page);
    let selector = Selector::parse("script[src]").expect("static selector");
    let mut found = None;
    for element in html.select(&selector) {
        let Some(src) = element.value().attr("src") else {
            continue;
        };
        let Ok(url) = page_url.join(src) else {
            continue;
        };
        if site_url(&url).is_err() {
            continue;
        }
        let Some(version) = url
            .path()
            .strip_prefix("/s/game")
            .and_then(|p| p.strip_suffix(".js"))
        else {
            continue;
        };
        if !version.is_empty()
            && version.bytes().all(|b| b.is_ascii_digit())
            && url.query().is_none()
            && found.replace(url).is_some()
        {
            return Err("Ambiguous official client script".into());
        }
    }
    found.ok_or_else(|| "Official page has no supported client script".into())
}

fn declaration<'a>(source: &'a [u8], name: &[u8], limit: usize) -> Result<&'a [u8]> {
    let mut found = None;
    for (offset, start) in source.windows(3).enumerate().filter(|(_, w)| *w == b"var") {
        let identifier = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$';
        if offset > 0 && identifier(source[offset - 1]) {
            continue;
        }
        let tail = &source[offset + start.len()..];
        if !tail.first().is_some_and(u8::is_ascii_whitespace) {
            continue;
        }
        let tail = tail.trim_ascii_start();
        if !tail.starts_with(name) || tail.get(name.len()).is_some_and(|b| identifier(*b)) {
            continue;
        }
        let span = &source[offset..source.len().min(offset + limit)];
        let end = span
            .iter()
            .position(|b| *b == b';')
            .ok_or("Unsupported profile declaration")?
            + 1;
        // Requiring a unique literal also rejects marker text in comments/strings rather than guessing.
        if found.replace(&span[..end]).is_some() {
            return Err("Ambiguous profile declaration".into());
        }
    }
    found.ok_or_else(|| "Official script has no supported profile declaration".into())
}

pub fn profile(source: &[u8]) -> Result<LoginProfile> {
    if source.len() > SCRIPT_LIMIT {
        return Err("Official script size limit".into());
    }
    let client_version = profile_literals::client_version(declaration(
        source,
        b"client_version",
        profile_literals::VERSION_LIMIT,
    )?)
    .map_err(|_| "Unsupported client version literal")?;
    let mut result = LoginProfile {
        client_version,
        ..Default::default()
    };
    profile_literals::password(
        declaration(source, b"cpw", profile_literals::PASSWORD_LIMIT)?,
        &mut result.password,
    )
    .map_err(|_| "Unsupported password literal")?;
    Ok(result)
}

pub fn directory_url(source: &str) -> Result<Url> {
    let mut found = None;
    for (offset, _) in source.match_indices("https://slither.io/i") {
        let tail = &source[offset + "https://slither.io/i".len()..];
        let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 16 || !tail[digits..].starts_with(".txt") {
            continue;
        }
        let url = Url::parse(&source[offset..offset + "https://slither.io/i".len() + digits + 4])
            .map_err(|_| "Invalid directory URL")?;
        if found.as_ref().is_some_and(|previous| previous != &url) {
            return Err("Ambiguous directory URL".into());
        }
        found = Some(url);
    }
    found.ok_or_else(|| "Official script has no supported directory URL".into())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Server {
    pub address: SocketAddr,
    pub population: u16,
    pub cluster: u16,
    pub id: u16,
    pub active: bool,
}
impl Server {
    pub fn endpoint(&self) -> String {
        format!("ws://{}/slither", self.address)
    }
}

pub fn decode_directory(encoded: &[u8]) -> Result<Vec<Server>> {
    let encoded = encoded.trim_ascii();
    if encoded.len() > DIRECTORY_LIMIT
        || encoded.first() != Some(&b'a')
        || encoded.len() <= 1
        || !(encoded.len() - 1).is_multiple_of(56)
    {
        return Err("Invalid directory length/version".into());
    }
    let mut servers = Vec::new();
    for (record_index, chars) in encoded[1..].as_chunks::<56>().0.iter().enumerate() {
        let mut record = [0u8; 28];
        for (index, pair) in chars.as_chunks::<2>().0.iter().enumerate() {
            let mut value = 0;
            for (half, byte) in pair.iter().enumerate() {
                if !byte.is_ascii_lowercase() {
                    return Err("Invalid directory character".into());
                }
                let shift = ((record_index * 56 + index * 2 + half) * 7) % 26;
                let nibble = (usize::from(byte - b'a') + 26 - shift) % 26;
                if nibble > 15 {
                    return Err("Invalid directory nibble".into());
                }
                value = value * 16 + nibble as u8;
            }
            record[index] = value;
        }
        let port = u16::from_be_bytes([record[21], record[22]]);
        if port == 0 {
            return Err("Invalid directory port".into());
        }
        let base = Server {
            address: SocketAddr::new(
                IpAddr::V4(Ipv4Addr::new(record[1], record[2], record[3], record[4])),
                port,
            ),
            population: u16::from_be_bytes([record[23], record[24]]),
            cluster: u16::from(record[25]),
            id: u16::from_be_bytes([record[26], record[27]]),
            active: record[0] <= 26,
        };
        let ipv6 = Ipv6Addr::from(<[u8; 16]>::try_from(&record[5..21]).expect("record span"));
        if !ipv6.is_unspecified() {
            let mut v6 = base.clone();
            v6.address = SocketAddr::new(IpAddr::V6(ipv6), port);
            v6.cluster += 1000;
            servers.push(base);
            servers.push(v6);
        } else {
            servers.push(base);
        }
        if servers.len() > 4096 {
            return Err("Directory server limit".into());
        }
    }
    Ok(servers)
}

/// Fresh selection has no historical exclusions. Tied cluster minima prefer the higher ID.
pub fn select_server(servers: &[Server], pings: &BTreeMap<u16, u32>, unit: f64) -> Result<usize> {
    if servers.is_empty() || !(0.0..1.0).contains(&unit) {
        return Err("Invalid server selection input".into());
    }
    let best = pings
        .iter()
        .min_by_key(|(id, ms)| (**ms, std::cmp::Reverse(**id)));
    if let Some((&cluster, _)) = best {
        let eligible: Vec<_> = servers
            .iter()
            .enumerate()
            .filter(|(_, s)| s.cluster == cluster && s.active)
            .collect();
        let total: u64 = eligible
            .iter()
            .map(|(_, s)| u64::from(s.population) + 5)
            .sum();
        let mut cumulative = 0.0;
        for (position, &(index, server)) in eligible.iter().enumerate() {
            cumulative += (f64::from(server.population) + 5.0) / total as f64;
            if cumulative >= unit || position + 1 == eligible.len() {
                return Ok(index);
            }
        }
    }
    // Original fallback: stable port order, random seed, then reverse scan with population >20.
    let mut order: Vec<_> = (0..servers.len()).collect();
    order.sort_by_key(|i| servers[*i].address.port());
    let mut chosen = order[(unit * order.len() as f64) as usize];
    let ping = |s: &Server| {
        pings
            .get(&s.cluster)
            .copied()
            .unwrap_or(if s.active { 9_999_998 } else { 9_999_999 })
    };
    for index in order.into_iter().rev() {
        if servers[index].population > 20 && ping(&servers[index]) <= ping(&servers[chosen]) {
            chosen = index;
        }
    }
    Ok(chosen)
}

pub fn explicit_endpoint(server: &str) -> Result<String> {
    let endpoint = format!("ws://{server}/slither");
    let url = server_endpoint(&endpoint)?;
    // A port is mandatory even when URL normalization removes the default :80.
    let authority_port = server
        .rsplit_once(':')
        .ok_or("Expected --server host:port")?
        .1;
    if authority_port.is_empty()
        || !authority_port.bytes().all(|b| b.is_ascii_digit())
        || authority_port
            .parse::<u16>()
            .ok()
            .filter(|p| *p > 0)
            .is_none()
        || server.contains('/')
    {
        return Err("Expected --server host:port".into());
    }
    Ok(url.into())
}

fn probe_clusters(servers: &[Server], cancel: &Arc<AtomicBool>) -> BTreeMap<u16, u32> {
    let mut clusters = BTreeMap::<u16, Vec<IpAddr>>::new();
    for server in servers.iter().rev() {
        let addresses = clusters.entry(server.cluster).or_default();
        if !addresses.contains(&server.address.ip()) {
            addresses.push(server.address.ip());
        }
    }
    let targets: Vec<_> = clusters
        .into_iter()
        .rev()
        .map(|(id, addresses)| {
            (
                id,
                addresses[(rand::random::<f64>() * addresses.len() as f64) as usize],
            )
        })
        .collect();
    let started = Instant::now();
    let first_reply = AtomicU64::new(u64::MAX);
    let next = AtomicUsize::new(0);
    let results = Mutex::new(BTreeMap::new());
    let remaining = || {
        let end = first_reply
            .load(Ordering::SeqCst)
            .saturating_add(2667)
            .min(7000);
        Duration::from_millis(end).checked_sub(started.elapsed())
    };
    thread::scope(|scope| {
        for _ in 0..targets.len().min(32) {
            scope.spawn(|| {
                while !cancel.load(Ordering::SeqCst) {
                    let Some(left) = remaining() else { break };
                    let Some(&(id, address)) = targets.get(next.fetch_add(1, Ordering::SeqCst))
                    else {
                        break;
                    };
                    let url = format!("ws://{}/ptc", SocketAddr::new(address, 80));
                    let Ok(mut socket) = native::connect(
                        &url,
                        cancel,
                        Instant::now() + left.min(Duration::from_secs(3)),
                    ) else {
                        continue;
                    };
                    let mut sent = Instant::now();
                    if !send_ping(&mut socket) {
                        continue;
                    }
                    let mut count = 0;
                    while remaining().is_some() && !cancel.load(Ordering::SeqCst) {
                        match socket.read() {
                            Ok(Message::Binary(bytes)) if bytes.as_ref() == [112] => {
                                let ms = (sent.elapsed().as_secs_f64() * 1000.0)
                                    .round()
                                    .min(f64::from(u32::MAX))
                                    as u32;
                                first_reply.fetch_min(
                                    started.elapsed().as_millis() as u64,
                                    Ordering::SeqCst,
                                );
                                results
                                    .lock()
                                    .expect("probe results")
                                    .entry(id)
                                    .and_modify(|old: &mut u32| *old = (*old).min(ms))
                                    .or_insert(ms);
                                count += 1;
                                if count == 3 {
                                    break;
                                }
                                sent = Instant::now();
                                if !send_ping(&mut socket) {
                                    break;
                                }
                            }
                            Ok(Message::Ping(_) | Message::Pong(_)) => {}
                            Err(tungstenite::Error::Io(e))
                                if e.kind() == std::io::ErrorKind::WouldBlock =>
                            {
                                let _ = socket.flush();
                                thread::sleep(Duration::from_millis(5));
                            }
                            _ => break,
                        }
                    }
                    let _ = socket.close(None);
                }
            });
        }
    });
    results.into_inner().expect("probe results")
}

fn send_ping(socket: &mut native::Socket) -> bool {
    // tungstenite owns a WouldBlock write, just as for normal session sends.
    match socket.send(Message::Binary(vec![112].into())) {
        Ok(()) => true,
        Err(tungstenite::Error::Io(e)) if e.kind() == std::io::ErrorKind::WouldBlock => true,
        Err(_) => false,
    }
}

pub fn prepare(server: Option<&str>, cancel: &Arc<AtomicBool>) -> Result<Prepared> {
    prepare_with(server, cancel, fetch, probe_clusters)
}

fn prepare_with(
    server: Option<&str>,
    cancel: &Arc<AtomicBool>,
    mut get: impl FnMut(&Url, usize, &AtomicBool) -> Result<(Url, Inert)>,
    measure: impl FnOnce(&[Server], &Arc<AtomicBool>) -> BTreeMap<u16, u32>,
) -> Result<Prepared> {
    let forced = server.map(explicit_endpoint).transpose()?;
    check_cancel(cancel)?;
    let (page_url, page) = get(&Url::parse(PAGE).expect("constant URL"), PAGE_LIMIT, cancel)?;
    let script_url = client_script(
        std::str::from_utf8(&page.0).map_err(|_| "Invalid page encoding")?,
        &page_url,
    )?;
    drop(page);
    let (_, script) = get(&script_url, SCRIPT_LIMIT, cancel)?;
    let profile = profile(&script.0)?;
    let directory = if forced.is_none() {
        Some(directory_url(
            std::str::from_utf8(&script.0).map_err(|_| "Invalid script encoding")?,
        )?)
    } else {
        None
    };
    drop(script);
    let endpoint = if let Some(endpoint) = forced {
        endpoint
    } else {
        let (_, bytes) = get(
            &directory.expect("automatic directory"),
            DIRECTORY_LIMIT,
            cancel,
        )?;
        let servers = decode_directory(&bytes.0)?;
        drop(bytes);
        let pings = measure(&servers, cancel);
        check_cancel(cancel)?;
        servers[select_server(&servers, &pings, rand::random())?].endpoint()
    };
    check_cancel(cancel)?;
    Ok(Prepared { endpoint, profile })
}

#[cfg(test)]
mod tests {
    use super::*;
    // ORIGINAL SYNTHETIC page/script; no retained reference or acquisition authority.
    const SCRIPT: &[u8] =
        b"var client_version=4242; var cpw=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19];";
    #[test]
    fn automatic_preparation_composes_page_profile_directory_and_selection() {
        let mut calls = Vec::new();
        let prepared = prepare_with(
            None,
            &Arc::new(AtomicBool::new(false)),
            |url, limit, _| {
                calls.push((url.to_string(), limit));
                let bytes = match calls.len() {
                    1 => b"<script src='/s/game999.js'></script>".to_vec(),
                    2 => [SCRIPT, b"getData('https://slither.io/i999.txt',handler);"].concat(),
                    3 => {
                        let mut record = [0u8; 28];
                        record[1..5].copy_from_slice(&[192, 0, 2, 1]);
                        record[21..23].copy_from_slice(&445u16.to_be_bytes());
                        record[24] = 42;
                        record[25] = 9;
                        let mut bytes = vec![b'a'];
                        for (i, nibble) in record.iter().flat_map(|b| [b >> 4, b & 15]).enumerate()
                        {
                            bytes.push(b'a' + ((usize::from(nibble) + i * 7) % 26) as u8);
                        }
                        bytes
                    }
                    _ => panic!("unexpected fetch"),
                };
                Ok((url.clone(), Inert(bytes)))
            },
            |servers, _| {
                assert_eq!(servers.len(), 1);
                assert_eq!(servers[0].cluster, 9);
                BTreeMap::from([(9, 12)])
            },
        )
        .unwrap();
        assert_eq!(prepared.endpoint, "ws://192.0.2.1:445/slither");
        assert_eq!(prepared.profile.client_version, 4242);
        assert_eq!(
            calls,
            [
                (PAGE.to_string(), PAGE_LIMIT),
                ("https://slither.io/s/game999.js".into(), SCRIPT_LIMIT),
                ("https://slither.io/i999.txt".into(), DIRECTORY_LIMIT)
            ]
        );
    }
    #[test]
    fn forced_server_fetches_page_profile_only_and_cancel_prevents_all_requests() {
        let cancel = Arc::new(AtomicBool::new(false));
        let mut calls = Vec::new();
        let prepared = prepare_with(
            Some("127.0.0.1:19491"),
            &cancel,
            |url, limit, _| {
                calls.push((url.to_string(), limit));
                let bytes = if calls.len() == 1 {
                    b"<script src='https://slither.io/s/game999.js'></script>".as_slice()
                } else {
                    SCRIPT
                };
                Ok((url.clone(), Inert(bytes.to_vec())))
            },
            |_, _| panic!("forced server must skip probes"),
        )
        .unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(prepared.endpoint, "ws://127.0.0.1:19491/slither");
        assert_eq!(prepared.profile.client_version, 4242);
        cancel.store(true, Ordering::SeqCst);
        assert!(
            prepare_with(
                None,
                &cancel,
                |_, _, _| panic!("cancelled"),
                |_, _| panic!("cancelled")
            )
            .is_err()
        );
    }
    #[test]
    fn malformed_profile_never_requests_directory_or_probes() {
        let mut calls = 0;
        let result = prepare_with(
            None,
            &Arc::new(AtomicBool::new(false)),
            |url, _, _| {
                calls += 1;
                Ok((
                    url.clone(),
                    Inert(if calls == 1 {
                        b"<script src='/s/game999.js'></script>".to_vec()
                    } else {
                        b"invalid".to_vec()
                    }),
                ))
            },
            |_, _| panic!("invalid profile"),
        );
        assert!(result.is_err());
        assert_eq!(calls, 2);
    }
    #[test]
    fn redirects_remain_canonical_without_credentials_or_alternate_ports() {
        for good in ["http://slither.io/?a", "https://slither.io/s/game999.js"] {
            site_url(&Url::parse(good).unwrap()).unwrap();
        }
        for bad in [
            "https://other.invalid/",
            "https://slither.io.evil.invalid/",
            "http://user@slither.io/",
            "https://slither.io:999/",
            "file:///tmp/script",
        ] {
            assert!(site_url(&Url::parse(bad).unwrap()).is_err());
        }
    }
}
