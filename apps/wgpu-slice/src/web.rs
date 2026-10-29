//! Thin host calls; JS schedules RAF and copies canvas extent/DPR only.
use crate::{
    frame::Frame,
    gpu::{SurfaceHost, instance},
    scene::{Driver, LAST_TICK, Scene},
};
use wasm_bindgen::prelude::*;

/// Same gameplay owner/effect protocol as the native host. No WebSocket or DOM policy in Rust.
#[wasm_bindgen]
pub struct LocalGameplay {
    host: SurfaceHost,
    game: crate::game::LocalGame,
}
fn js_error(e: String) -> JsValue {
    JsValue::from_str(&e)
}
impl LocalGameplay {
    fn checked<T>(
        &mut self,
        f: impl FnOnce(&mut crate::game::LocalGame) -> crate::Result<T>,
    ) -> std::result::Result<T, JsValue> {
        f(&mut self.game).map_err(|e| {
            self.game.fail(&e);
            js_error(e)
        })
    }
    fn pictures(&mut self) -> crate::Result<()> {
        for _ in 0..16 {
            let Some(p) = self.game.take_frame() else {
                return Ok(());
            };
            self.host.renderer.sync_resources(&p.resources)?;
            match self.host.present(&p.frame) {
                Ok(true) => self.game.presented(true)?,
                Ok(false) => {
                    self.game.retry_frame(p)?;
                    return Ok(());
                }
                Err(e) => {
                    self.game.presented(false)?;
                    return Err(e);
                }
            }
        }
        Err("Frame drain budget".into())
    }
}
#[wasm_bindgen]
impl LocalGameplay {
    #[wasm_bindgen(js_name=create)]
    pub async fn create(
        canvas: web_sys::HtmlCanvasElement,
        now_ms: f64,
    ) -> std::result::Result<LocalGameplay, JsValue> {
        let extent = [canvas.width(), canvas.height()];
        let i = instance();
        let surface = i
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        Ok(Self {
            host: SurfaceHost::new(&i, surface, extent)
                .await
                .map_err(js_error)?,
            game: crate::game::LocalGame::new(now_ms).map_err(js_error)?,
        })
    }
    pub fn adapter(&self) -> String {
        format!(
            "{:?}; MSAA{}",
            self.host.renderer.adapter_info, self.host.renderer.sample_count
        )
    }
    pub fn play(
        &mut self,
        endpoint: &str,
        nickname: &str,
        skin: u8,
    ) -> std::result::Result<(), JsValue> {
        self.checked(|g| g.play(endpoint, nickname, skin))
    }
    pub fn stop(&mut self) {
        self.game.stop();
    }
    pub fn fail(&mut self) {
        self.game.fail("Browser host failure");
    }
    pub fn can_play(&self) -> bool {
        self.game.can_play()
    }
    pub fn hud(&self) -> String {
        self.game.hud_text()
    }
    pub fn effect_kind(&self) -> u8 {
        self.game.effect().map_or(0, |e| match e.kind {
            crate::game::EffectKind::Connect(_) => 1,
            crate::game::EffectKind::Send(_) => 2,
            crate::game::EffectKind::Close => 3,
        })
    }
    pub fn effect_id(&self) -> u64 {
        self.game.effect().map_or(0, |e| e.id)
    }
    pub fn effect_generation(&self) -> u32 {
        self.game.effect().map_or(0, |e| e.generation)
    }
    pub fn effect_url(&self) -> String {
        self.game
            .effect()
            .and_then(|e| {
                if let crate::game::EffectKind::Connect(u) = e.kind {
                    Some(u)
                } else {
                    None
                }
            })
            .unwrap_or_default()
    }
    pub fn effect_bytes(&self) -> Vec<u8> {
        self.game
            .effect()
            .and_then(|e| {
                if let crate::game::EffectKind::Send(b) = e.kind {
                    Some(b)
                } else {
                    None
                }
            })
            .unwrap_or_default()
    }
    pub fn acknowledge(&mut self, g: u32, id: u64, ok: bool) -> std::result::Result<(), JsValue> {
        self.checked(|s| s.acknowledge(g, id, ok))
    }
    pub fn opened(&mut self, g: u32) -> std::result::Result<(), JsValue> {
        self.checked(|s| s.opened(g))
    }
    pub fn receive(&mut self, g: u32, b: &[u8], now: f64) -> std::result::Result<(), JsValue> {
        self.checked(|s| s.receive(g, b, now))
    }
    pub fn closed(&mut self, g: u32) {
        self.game.closed(g);
    }
    pub fn key(&mut self, code: &str, down: bool) -> bool {
        self.game.key(code, down)
    }
    pub fn blur(&mut self) {
        self.game.blur();
    }
    pub fn pointer(
        &mut self,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        down: bool,
    ) -> std::result::Result<(), JsValue> {
        self.checked(|g| g.pointer(x, y, w, h, down))
    }
    pub fn mouse_up(&mut self) {
        self.game.mouse_up();
    }
    /// Receive/Setup flush does not advance the gameplay clock.
    pub fn flush(&mut self, width: u32, height: u32, dpr: f64) -> std::result::Result<(), JsValue> {
        let result = (|| {
            self.host.resize([width, height])?;
            self.game.viewport([width, height], dpr)?;
            self.pictures()
        })();
        result.map_err(|e| {
            self.game.fail(&e);
            js_error(e)
        })
    }
    pub fn frame(
        &mut self,
        now: f64,
        width: u32,
        height: u32,
        dpr: f64,
    ) -> std::result::Result<(), JsValue> {
        self.flush(width, height, dpr)?;
        self.checked(|g| g.begin_frame(now, [width, height], dpr))?;
        self.pictures().map_err(|e| {
            self.game.fail(&e);
            js_error(e)
        })
    }
}

#[wasm_bindgen]
pub struct GameplaySlice {
    host: SurfaceHost,
    scene: Scene,
    driver: Driver,
    frame: Option<Frame>,
}
#[wasm_bindgen]
impl GameplaySlice {
    /// No Canvas/software fallback. Missing WebGPU is an explicit initialization error.
    #[wasm_bindgen(js_name=create)]
    pub async fn create(
        canvas: web_sys::HtmlCanvasElement,
    ) -> std::result::Result<GameplaySlice, JsValue> {
        let extent = [canvas.width(), canvas.height()];
        let i = instance();
        let surface = i
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let mut host = SurfaceHost::new(&i, surface, extent)
            .await
            .map_err(|e| JsValue::from_str(&e))?;
        let scene = Scene::new().map_err(|e| JsValue::from_str(&e))?;
        for r in &scene.resources {
            host.renderer.upload(r).map_err(|e| JsValue::from_str(&e))?;
        }
        Ok(Self {
            host,
            scene,
            driver: Driver::default(),
            frame: None,
        })
    }
    pub fn adapter(&self) -> String {
        format!("{:?}", self.host.renderer.adapter_info)
    }
    /// Same fixed ticks and packet schedule as the desktop host. No domain math in JS.
    pub fn frame(
        &mut self,
        now_ms: f64,
        width: u32,
        height: u32,
        dpr: f64,
    ) -> std::result::Result<bool, JsValue> {
        let mut run = || -> crate::Result<bool> {
            let extent = [width, height];
            self.host.resize(extent)?;
            if extent.contains(&0) {
                self.driver.pause();
                self.frame = None;
                return Ok(false);
            }
            let due = self.driver.due(now_ms)?;
            for _ in 0..due {
                if self.scene.tick() < LAST_TICK {
                    self.frame = Some(self.scene.next_frame(extent, dpr)?);
                }
            }
            if self
                .frame
                .as_ref()
                .is_none_or(|f| f.extent != extent || f.viewport_scale != dpr)
            {
                self.frame = Some(self.scene.draw_frame(extent, dpr)?);
            }
            if let Some(frame) = &self.frame
                && frame.extent == extent
            {
                return self.host.present(frame);
            }
            Ok(false)
        };
        run().map_err(|e| JsValue::from_str(&e))
    }
    pub fn tick(&self) -> u32 {
        self.scene.tick()
    }
    pub fn pause(&mut self) {
        self.driver.pause();
    }
}
