//! Native-only platform transport. No socket exists until an explicit Connect effect.
use crate::{
    Result,
    game::{Effect, EffectKind, server_endpoint},
};
use std::{
    io::{self, ErrorKind, Read, Write},
    net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::{
    Error, Message, WebSocket, client::IntoClientRequest, protocol::WebSocketConfig,
};
pub const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SlitherClient/0.1";
pub const ORIGIN: &str = "http://slither.io";
pub enum Event {
    Opened(u32),
    Binary(u32, Vec<u8>),
    Closed(u32),
    Failed(u32, String),
}
pub(crate) type Socket = WebSocket<Wire>;
/// An absolute handshake deadline bounds slow-drip peers and connector cancellation/join.
pub(crate) struct Wire {
    stream: TcpStream,
    deadline: Option<Instant>,
    cancel: Arc<AtomicBool>,
}
impl Wire {
    fn budget(&self) -> io::Result<()> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err(io::Error::new(ErrorKind::Interrupted, "Connect cancelled"));
        }
        if let Some(deadline) = self.deadline {
            let left = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| io::Error::new(ErrorKind::TimedOut, "Handshake deadline"))?;
            self.stream.set_read_timeout(Some(left))?;
            self.stream.set_write_timeout(Some(left))?;
        }
        Ok(())
    }
    fn ready(&mut self) -> io::Result<()> {
        self.budget()?;
        self.deadline = None;
        self.stream.set_read_timeout(None)?;
        self.stream.set_write_timeout(None)?;
        self.stream.set_nonblocking(true)
    }
}
impl Read for Wire {
    fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
        self.budget()?;
        self.stream.read(b)
    }
}
impl Write for Wire {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        self.budget()?;
        self.stream.write(b)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.budget()?;
        self.stream.flush()
    }
}
struct Connector {
    receiver: mpsc::Receiver<Result<Socket>>,
    cancel: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
#[derive(Default)]
pub struct Transport {
    socket: Option<Socket>,
    connector: Option<Connector>,
    generation: u32,
    pending_bytes: usize,
}
fn would_block(e: &Error) -> bool {
    matches!(e,Error::Io(e)if e.kind()==ErrorKind::WouldBlock)
}

fn addresses(url: &url::Url, deadline: Instant) -> Result<Vec<SocketAddr>> {
    let port = url
        .port_or_known_default()
        .ok_or("Missing WebSocket port")?;
    match url.host().ok_or("Missing WebSocket host")? {
        url::Host::Ipv4(ip) => Ok(vec![SocketAddr::new(ip.into(), port)]),
        url::Host::Ipv6(ip) => Ok(vec![SocketAddr::new(ip.into(), port)]),
        url::Host::Domain(host) => {
            // OS DNS may block; its worker owns no socket and the connector waits at most 1s.
            let host = host.to_owned();
            let (tx, rx) = mpsc::sync_channel(1);
            thread::Builder::new()
                .name("ws-resolve".into())
                .spawn(move || {
                    let result = (host.as_str(), port)
                        .to_socket_addrs()
                        .map(|addresses| addresses.take(8).collect::<Vec<_>>())
                        .map_err(|_| "DNS lookup failed".to_string());
                    let _ = tx.send(result);
                })
                .map_err(|e| e.to_string())?;
            rx.recv_timeout(
                deadline
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_secs(1)),
            )
            .map_err(|_| "DNS deadline".to_string())?
        }
    }
}

pub(crate) fn connect(url: &str, cancel: &Arc<AtomicBool>, deadline: Instant) -> Result<Socket> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid WebSocket URL")?;
    if parsed.scheme() != "ws" {
        return Err("Native transport requires ws://".into());
    }
    let addresses = addresses(&parsed, deadline)?;
    let tcp_deadline = deadline.min(Instant::now() + Duration::from_secs(1));
    let mut stream = None;
    let count = addresses.len();
    for (index, address) in addresses.into_iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("Connect cancelled".into());
        }
        let Some(left) = tcp_deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        // An unreachable IPv6 candidate must leave time for the remaining IPv4 addresses.
        let slice = left / (count - index) as u32;
        if let Ok(connected) = TcpStream::connect_timeout(&address, slice) {
            stream = Some(connected);
            break;
        }
    }
    let stream = stream.ok_or("TCP connect failed/deadline")?;
    stream.set_nodelay(true).map_err(|e| e.to_string())?;
    let mut request = url
        .into_client_request()
        .map_err(|_| "Invalid WebSocket request")?;
    request
        .headers_mut()
        .insert("Origin", ORIGIN.parse().expect("constant header"));
    request
        .headers_mut()
        .insert("User-Agent", USER_AGENT.parse().expect("constant header"));
    let config = WebSocketConfig::default()
        .max_message_size(Some(1 << 20))
        .max_frame_size(Some(1 << 20))
        .write_buffer_size(0)
        .max_write_buffer_size(8192);
    let wire = Wire {
        stream,
        deadline: Some(deadline.min(Instant::now() + Duration::from_secs(2))),
        cancel: cancel.clone(),
    };
    let (mut socket, _) = tungstenite::client::client_with_config(request, wire, Some(config))
        .map_err(|e| e.to_string())?;
    socket.get_mut().ready().map_err(|e| e.to_string())?;
    Ok(socket)
}

impl Transport {
    pub fn execute(&mut self, e: &Effect) -> Result<()> {
        match &e.kind {
            EffectKind::Connect(url) => {
                if self.socket.is_some() || self.connector.is_some() {
                    return Err("Transport already owned".into());
                }
                server_endpoint(url)?;
                let url = url.clone();
                let (tx, receiver) = mpsc::sync_channel(1);
                let cancel = Arc::new(AtomicBool::new(false));
                let flag = cancel.clone();
                let worker = thread::Builder::new()
                    .name("ws-connect".into())
                    .spawn(move || {
                        let result = connect(&url, &flag, Instant::now() + Duration::from_secs(3));
                        let _ = tx.send(result);
                    })
                    .map_err(|e| e.to_string())?;
                self.generation = e.generation;
                self.connector = Some(Connector {
                    receiver,
                    cancel,
                    thread: Some(worker),
                });
                Ok(())
            }
            EffectKind::Send(bytes) => {
                if e.generation != self.generation || self.pending_bytes > 4096 {
                    return Err("Stale/full native send queue".into());
                }
                let socket = self.socket.as_mut().ok_or("Socket is not open")?;
                // tungstenite retains a WouldBlock write; never enqueue the same message again.
                match socket.write(Message::Binary(bytes.clone().into())) {
                    Ok(()) => {}
                    Err(error) if would_block(&error) => {}
                    Err(error) => return Err(error.to_string()),
                }
                self.pending_bytes += bytes.len();
                match socket.flush() {
                    Ok(()) => self.pending_bytes = 0,
                    Err(error) if would_block(&error) => {}
                    Err(error) => return Err(error.to_string()),
                }
                Ok(())
            }
            EffectKind::Close => {
                self.close();
                Ok(())
            }
        }
    }
    pub fn poll(&mut self) -> Vec<Event> {
        let mut events = Vec::new();
        if let Some(c) = &self.connector {
            match c.receiver.try_recv() {
                Ok(result) => {
                    let mut c = self.connector.take().expect("connector");
                    if let Some(t) = c.thread.take() {
                        let _ = t.join();
                    }
                    match result {
                        Ok(socket) => {
                            self.socket = Some(socket);
                            events.push(Event::Opened(self.generation));
                        }
                        Err(e) => events.push(Event::Failed(self.generation, e)),
                    }
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    self.connector.take();
                    events.push(Event::Failed(self.generation, "Connector stopped".into()));
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
        }
        if let Some(socket) = &mut self.socket {
            match socket.flush() {
                Ok(()) => self.pending_bytes = 0,
                Err(e) if would_block(&e) => {}
                Err(e) => {
                    let error = e.to_string();
                    self.socket.take();
                    self.pending_bytes = 0;
                    events.push(Event::Failed(self.generation, error));
                    return events;
                }
            }
            for _ in 0..64 {
                match socket.read() {
                    Ok(Message::Binary(bytes)) => {
                        events.push(Event::Binary(self.generation, bytes.to_vec()))
                    }
                    Ok(Message::Close(_)) => {
                        events.push(Event::Closed(self.generation));
                        break;
                    }
                    Ok(Message::Ping(_) | Message::Pong(_)) => {}
                    Ok(_) => {
                        events.push(Event::Failed(
                            self.generation,
                            "Binary protocol message required".into(),
                        ));
                        break;
                    }
                    Err(e) if would_block(&e) => break,
                    Err(Error::ConnectionClosed | Error::AlreadyClosed) => {
                        events.push(Event::Closed(self.generation));
                        break;
                    }
                    Err(e) => {
                        events.push(Event::Failed(self.generation, e.to_string()));
                        break;
                    }
                }
            }
        }
        if events
            .iter()
            .any(|e| matches!(e, Event::Closed(_) | Event::Failed(_, _)))
        {
            self.socket.take();
            self.pending_bytes = 0;
        }
        events
    }
    pub fn close(&mut self) {
        if let Some(mut c) = self.connector.take() {
            c.cancel.store(true, Ordering::SeqCst);
            if let Some(t) = c.thread.take() {
                let _ = t.join();
            }
        }
        if let Some(mut s) = self.socket.take() {
            let _ = s.close(None);
            let _ = s.flush();
            let _ = s.get_ref().stream.shutdown(Shutdown::Both);
        }
        self.pending_bytes = 0;
    }
}
impl Drop for Transport {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    #[test]
    #[allow(
        clippy::result_large_err,
        reason = "tungstenite fixes the server callback error type"
    )]
    fn loopback_double_observes_browser_upgrade_headers_and_hostname_resolution() {
        // ORIGINAL SYNTHETIC peer; no official network or game data.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let peer = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(3);
            let stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == ErrorKind::WouldBlock && Instant::now() < deadline => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    other => panic!("Synthetic peer accept: {other:?}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut socket = tungstenite::accept_hdr(
                stream,
                |request: &tungstenite::handshake::server::Request, response| {
                    assert_eq!(request.uri().path(), "/slither");
                    assert_eq!(request.headers()["origin"], ORIGIN);
                    assert_eq!(request.headers()["user-agent"], USER_AGENT);
                    assert_eq!(request.headers()["host"], format!("localhost:{port}"));
                    assert_eq!(request.headers()["sec-websocket-version"], "13");
                    assert!(request.headers().contains_key("sec-websocket-key"));
                    assert_eq!(request.headers()["upgrade"], "websocket");
                    Ok(response)
                },
            )
            .unwrap();
            socket.send(Message::Binary(vec![42, 43].into())).unwrap();
        });
        let mut socket = connect(
            &format!("ws://localhost:{port}/slither"),
            &Arc::new(AtomicBool::new(false)),
            Instant::now() + Duration::from_secs(3),
        )
        .unwrap();
        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            match socket.read() {
                Ok(Message::Binary(bytes)) => {
                    assert_eq!(bytes.as_ref(), [42, 43]);
                    break;
                }
                Err(error) if would_block(&error) && Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(5))
                }
                other => panic!("Synthetic reply: {other:?}"),
            }
        }
        peer.join().unwrap();
    }
}
