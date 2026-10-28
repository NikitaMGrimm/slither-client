use super::*;

#[wasm_bindgen]
impl AnimatedScene {
    /// Submit one retained-food draw at the desired backing size, without update.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_food_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_draw_face: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Basic {
                detailed: detailed_style,
                face: resolve_draw_face,
            },
            quality.applied(),
        )
    }

    /// Standard-body retained-food draw at an explicit desired backing size.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_antenna_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicAntenna {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_antenna_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Submit one draw with explicit retained antenna sources and random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_antenna(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::BasicAntenna {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Submit one draw with explicit retained antenna sources and random units.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_antenna(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw tagged faces at the requested backing size without advancing update clocks.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_face_presentation_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicFace {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw standard bodies and tagged faces at the requested backing size.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_face_presentation_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Preflight native contexts and patterns before resetting the target for tagged faces.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_face_presentation(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::BasicFace {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Preflight a standard-body tagged-face draw before resetting the target.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_face_presentation(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Prepare numeric tagged-face draw feedback; do not also render the same draw.
    pub fn prepare_draw_with_face_presentation(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_face_presentation(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
                |input| antenna_random(resolve_random, input),
            )
            .map_err(|e| e.0)?;
        Ok(())
    }

    /// Draw tagged faces at the requested backing size without advancing update clocks.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_accessory_presentation_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::BasicAccessory {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Draw standard bodies and tagged faces at the requested backing size.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_accessory_presentation_at_size(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_at_size(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAccessory {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Preflight native contexts and patterns before resetting the target for tagged faces.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_accessory_presentation(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_presentation: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::BasicAccessory {
                detailed: detailed_style,
                presentation: resolve_presentation,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Preflight a standard-body tagged-face draw before resetting the target.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard_with_accessory_presentation(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        resolve_random: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawLane::StandardAccessory {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
        )
    }

    /// Prepare numeric tagged-face draw feedback; do not also render the same draw.
    pub fn prepare_draw_with_accessory_presentation(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_accessory_presentation(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
                |input| antenna_random(resolve_random, input),
            )
            .map_err(|e| e.0)?;
        Ok(())
    }

    /// Prepare one numeric draw without rasterization, for deterministic clients.
    /// `render` prepares its own draw; do not call both for the same draw.
    pub fn prepare_draw(&mut self, width: f64, height: f64) -> Result<(), JsValue> {
        self.client
            .prepare_draw(dimensions(width)?, dimensions(height)?)
            .map_err(error)
    }

    /// Numeric-only draw with the same sampling style and eye feedback as `render`.
    pub fn prepare_draw_with_style(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_style(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
            )
            .map_err(error)?;
        Ok(())
    }

    /// Prepare one numeric draw with explicit antenna random units and no Canvas.
    pub fn prepare_draw_with_antenna(
        &mut self,
        width: f64,
        height: f64,
        quality_scale: f64,
        detailed_style: bool,
        resolve_random: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.client
            .prepare_draw_with_antenna(
                dimensions(width)?,
                dimensions(height)?,
                quality_scale,
                detailed_style,
                |input| antenna_random(resolve_random, input),
            )
            .map_err(|e| e.0)?;
        Ok(())
    }

    /// Draw sampled curves with caller-owned stand-in palettes, then standard
    /// paired eyes after each body. Full skin recipes, attachments, special faces
    /// and quality-dependent effects remain separate.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        quality_scale: f64,
        detailed_style: bool,
    ) -> Result<(), JsValue> {
        self.render_basic(
            target,
            [palette_0, palette_1, palette_2],
            background,
            quality_scale,
            detailed_style,
            None,
            None,
        )
    }

    /// Basic stand-in bodies plus complete retained paired faces. The resolver
    /// returns a trusted normalized face-only projection, independent of body readiness.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_face_decorations(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        quality_scale: f64,
        detailed_style: bool,
        resolve_face: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.render_basic(
            target,
            [palette_0, palette_1, palette_2],
            background,
            quality_scale,
            detailed_style,
            Some(resolve_face),
            None,
        )
    }

    /// Basic bodies and complete paired faces with retained two-pass food.
    /// Borrow applied quality without advancing its clock or statistics.
    #[allow(clippy::too_many_arguments)]
    pub fn render_with_food(
        &mut self,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        detailed_style: bool,
        resolve_face: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        if !self.client.food_enabled() {
            return Err(error(
                "retained food factories must be enabled before rendering food",
            ));
        }
        let applied = quality.applied();
        self.render_basic(
            target,
            [palette_0, palette_1, palette_2],
            background,
            applied.quality_scale,
            detailed_style,
            Some(resolve_face),
            Some(applied),
        )
    }

    /// Opt-in standard-body renderer using synchronous trusted normalized
    /// skin-provider snapshots and read-only applied quality. See
    /// `docs/standard-body-renderer.md` for the supported recipe and lifetime.
    /// No quality/update clock advances here. All recipes and commands validate
    /// before Canvas reset; Canvas failures preserve the complete model.
    #[allow(clippy::too_many_arguments)]
    pub fn render_standard(
        &mut self,
        target: HtmlCanvasElement,
        food_0: HtmlCanvasElement,
        food_1: HtmlCanvasElement,
        food_2: HtmlCanvasElement,
        background: HtmlImageElement,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<(), JsValue> {
        self.render_committed(
            target,
            [food_0, food_1, food_2],
            background,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
        )
    }
}
