//! Native-only platform transport. No socket exists until an explicit Connect effect.
use crate::{
    Result,
    game::{Effect, EffectKind, loopback_endpoint},
};
use std::{
    io::{self, ErrorKind, Read, Write},
    net::{Ipv4Addr, Shutdown, SocketAddr, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::{Error, Message, WebSocket, protocol::WebSocketConfig};
pub enum Event {
    Opened(u32),
    Binary(u32, Vec<u8>),
    Closed(u32),
    Failed(u32, String),
}
type Socket = WebSocket<Wire>;
/// An absolute handshake deadline bounds slow-drip peers and connector cancellation/join.
struct Wire {
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
impl Transport {
    pub fn execute(&mut self, e: &Effect) -> Result<()> {
        match &e.kind {
            EffectKind::Connect(url) => {
                if self.socket.is_some() || self.connector.is_some() {
                    return Err("Transport already owned".into());
                }
                let port = loopback_endpoint(url)?;
                let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
                let url = url.clone();
                let (tx, receiver) = mpsc::sync_channel(1);
                let cancel = Arc::new(AtomicBool::new(false));
                let flag = cancel.clone();
                let worker = thread::Builder::new()
                    .name("local-ws-connect".into())
                    .spawn(move || {
                        let result = (|| -> Result<Socket> {
                            if flag.load(Ordering::SeqCst) {
                                return Err("Connect cancelled".into());
                            }
                            let stream =
                                TcpStream::connect_timeout(&address, Duration::from_secs(1))
                                    .map_err(|e| e.to_string())?;
                            stream.set_nodelay(true).map_err(|e| e.to_string())?;
                            if flag.load(Ordering::SeqCst) {
                                return Err("Connect cancelled".into());
                            }
                            let config = WebSocketConfig::default()
                                .max_message_size(Some(1 << 20))
                                .max_frame_size(Some(1 << 20))
                                .write_buffer_size(0)
                                .max_write_buffer_size(8192);
                            let wire = Wire {
                                stream,
                                deadline: Some(Instant::now() + Duration::from_secs(2)),
                                cancel: flag.clone(),
                            };
                            let (mut socket, _) = tungstenite::client::client_with_config(
                                url.as_str(),
                                wire,
                                Some(config),
                            )
                            .map_err(|e| e.to_string())?;
                            socket.get_mut().ready().map_err(|e| e.to_string())?;
                            if flag.load(Ordering::SeqCst) {
                                return Err("Connect cancelled".into());
                            }
                            Ok(socket)
                        })();
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
