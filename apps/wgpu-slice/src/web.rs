//! Thin host calls; JS schedules RAF and copies canvas extent/DPR only.
use crate::{
    frame::Frame,
    gpu::{SurfaceHost, instance},
    scene::{Driver, LAST_TICK, Scene},
};
use wasm_bindgen::prelude::*;

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
