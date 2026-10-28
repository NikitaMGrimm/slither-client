use super::*;

#[wasm_bindgen]
impl AnimatedScene {
    /// Commit a complete frame and its presentation actions atomically.
    pub fn apply_frame(&mut self, bytes: &[u8], elapsed_header: bool) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        prepared
            .apply_frame(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
            )
            .map_err(error)?;
        self.commit_client(prepared, self.food_sources.clone())
    }

    /// Install explicit normalized paired eyes once per appearance, before its
    /// first update. Framing and received-state validation precede callbacks.
    /// The synchronous resolver is trusted; its side effects cannot roll back.
    /// Any error preserves the complete model and callback exceptions keep identity.
    pub fn apply_frame_with_eye_geometry(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_eyes: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        prepared
            .apply_frame_with_eye_geometry(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_eyes
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(standard_eyes(&metadata)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_client(prepared, self.food_sources.clone())
    }

    /// Install owned numeric paired-face metadata atomically before any update.
    /// The direct synchronous callback is trusted and owns face-family coverage.
    pub fn apply_frame_with_face_geometry(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_face: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        prepared
            .apply_frame_with_face_geometry(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_face
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(paired_face(&metadata)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_client(prepared, self.food_sources.clone())
    }

    /// Retain complete appearance geometry and food factory inputs in one packet
    /// transaction. Start before packets or after reset; sources remain owned until
    /// their last food disappears. Callback side effects remain caller-owned.
    pub fn apply_frame_with_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_face: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        let mut sources = self.food_sources.clone();
        prepared
            .apply_frame_with_factories(
                bytes,
                if elapsed_header {
                    ElapsedHeader::TwoBytes
                } else {
                    ElapsedHeader::Absent
                },
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_face
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(paired_face(&metadata)?)
                },
                |spawn, zoom| -> Result<_, ResolveError> {
                    if self.prey_sources.len() == 0 {
                        return Ok(sources.resolve(resolve_food, spawn, zoom)?);
                    }
                    let (catalog, snapshots) = registry_allowance(0, self.prey_sources.len())?;
                    Ok(sources.resolve_limited(resolve_food, spawn, zoom, catalog, snapshots)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_client(prepared, sources)
    }

    /// Retain face, food and prey creation inputs in wire order. All packet
    /// validation precedes callbacks; external callback effects cannot roll back.
    pub fn apply_frame_with_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_face: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        let mut prepared = self.client.clone();
        let foods = RefCell::new(self.food_sources.clone());
        let preys = RefCell::new(self.prey_sources.clone());
        prepared
            .apply_frame_with_all_factories(
                bytes,
                elapsed_header_kind(elapsed_header),
                |appearance| -> Result<_, ResolveError> {
                    let metadata = resolve_face
                        .call1(&JsValue::UNDEFINED, &appearance_request(appearance)?.into())?;
                    Ok(paired_face(&metadata)?)
                },
                |spawn, zoom| -> Result<_, ResolveError> {
                    let other = preys
                        .try_borrow()
                        .map_err(|_| error("prey registry already borrowed"))?;
                    let (catalog, snapshots) =
                        registry_allowance(other.entry_count(), other.len())?;
                    Ok(foods
                        .try_borrow_mut()
                        .map_err(|_| error("food registry already borrowed"))?
                        .resolve_limited(resolve_food, spawn, zoom, catalog, snapshots)?)
                },
                |spawn, zoom| -> Result<_, ResolveError> {
                    let other = foods
                        .try_borrow()
                        .map_err(|_| error("food registry already borrowed"))?;
                    if other.entry_count() == 0 && other.len() == 0 {
                        return Ok(preys
                            .try_borrow_mut()
                            .map_err(|_| error("prey registry already borrowed"))?
                            .resolve(resolve_prey, spawn, zoom)?);
                    }
                    let (catalog, snapshots) =
                        registry_allowance(other.entry_count(), other.len())?;
                    Ok(preys
                        .try_borrow_mut()
                        .map_err(|_| error("prey registry already borrowed"))?
                        .resolve_limited(resolve_prey, spawn, zoom, catalog, snapshots)?)
                },
            )
            .map_err(|e| e.0)?;
        self.commit_all(prepared, foods.into_inner(), preys.into_inner())
    }

    /// Retain explicit numeric face and antenna metadata before the first update.
    pub fn apply_frame_with_appearance(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_appearance_factories(bytes, elapsed_header, resolve_appearance, None, None)
    }

    /// Retain explicit appearance metadata and creation-selected food sources.
    pub fn apply_frame_with_appearance_and_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_appearance_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            None,
        )
    }

    /// Retain explicit appearance, food and prey inputs in wire order.
    pub fn apply_frame_with_appearance_and_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_appearance_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            Some(resolve_prey),
        )
    }

    /// Apply retained factories and submit each Setup draw in wire order.
    /// Callback/preflight failures preserve model and sources before any clear.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_food(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Basic {
                detailed: detailed_style,
                face: resolve_draw_face,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Standard-body counterpart of the ordered Setup transaction.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Apply all factories and draw every Setup using basic bodies and retained prey.
    /// Plans share the ingress budgets; source and model commit follows submission.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_food_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Basic {
                detailed: detailed_style,
                face: resolve_draw_face,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Standard-body counterpart including retained prey in every ordered Setup draw.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
        target: HtmlCanvasElement,
        palette_0: HtmlCanvasElement,
        palette_1: HtmlCanvasElement,
        palette_2: HtmlCanvasElement,
        background: HtmlImageElement,
        width: f64,
        height: f64,
        resolve_recipe: &js_sys::Function,
        quality: &DesktopQuality,
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::Standard(resolve_recipe),
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_appearance(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
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
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_appearance(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_appearance_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
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
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Draw with retained appearance metadata and explicit ordered random units.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_appearance_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAntenna {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Retain the selected numeric face family before its first update; no sources are required.
    pub fn apply_frame_with_face_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(bytes, elapsed_header, resolve_appearance, None, None, true)
    }

    /// Select face mode and retain creation-selected food inputs atomically.
    pub fn apply_frame_with_face_presentation_and_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            None,
            true,
        )
    }

    /// Select face mode and retain food and prey creation inputs in wire order.
    pub fn apply_frame_with_face_presentation_and_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_face_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            Some(resolve_prey),
            true,
        )
    }

    /// Submit every Setup draw with tagged faces and shared ingress budgets.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_face_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
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
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Submit ordered standard-body Setup draws with complete tagged face metadata.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_face_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Include retained prey in every ordered tagged-face Setup draw.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_face_presentation_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
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
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Share source and image budgets across standard-body Setup draws with prey.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_face_presentation_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Apply one HUD-enabled transaction and report command-time score observations.
    /// Requires explicitly enabled score tracking; output is deeply frozen before submission.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_face_presentation_and_prey_and_hud(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
        plan: JsValue,
    ) -> Result<JsValue, JsValue> {
        let plan = OwnedHudPlan::parse(&plan)?;
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardFace {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            Some(plan.borrowed()),
        )
        .and_then(ApplyRenderResult::hud)
    }

    /// Retain the selected numeric face family before its first update; no sources are required.
    pub fn apply_frame_with_accessory_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_accessory_factories(bytes, elapsed_header, resolve_appearance, None, None, true)
    }

    /// Select face mode and retain creation-selected food inputs atomically.
    pub fn apply_frame_with_accessory_presentation_and_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_accessory_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            None,
            true,
        )
    }

    /// Select face mode and retain food and prey creation inputs in wire order.
    pub fn apply_frame_with_accessory_presentation_and_all_factories(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
    ) -> Result<(), JsValue> {
        self.apply_accessory_factories(
            bytes,
            elapsed_header,
            resolve_appearance,
            Some(resolve_food),
            Some(resolve_prey),
            true,
        )
    }

    /// Submit every Setup draw with tagged faces and shared ingress budgets.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_accessory_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
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
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Submit ordered standard-body Setup draws with complete tagged face metadata.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_accessory_presentation(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            None,
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAccessory {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Include retained prey in every ordered tagged-face Setup draw.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_with_accessory_presentation_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
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
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Share source and image budgets across standard-body Setup draws with prey.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_accessory_presentation_and_prey(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
    ) -> Result<u32, JsValue> {
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAccessory {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            None,
        )
        .and_then(ApplyRenderResult::legacy)
    }

    /// Apply one HUD-enabled transaction and report command-time score observations.
    /// Requires explicitly enabled score tracking; output is deeply frozen before submission.
    #[allow(clippy::too_many_arguments)]
    pub fn apply_frame_and_render_standard_with_accessory_presentation_and_prey_and_hud(
        &mut self,
        bytes: &[u8],
        elapsed_header: bool,
        resolve_appearance: &js_sys::Function,
        resolve_food: &js_sys::Function,
        resolve_prey: &js_sys::Function,
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
        plan: JsValue,
    ) -> Result<JsValue, JsValue> {
        let plan = OwnedHudPlan::parse(&plan)?;
        self.apply_and_render(
            bytes,
            elapsed_header,
            resolve_appearance,
            resolve_food,
            Some(resolve_prey),
            target,
            [palette_0, palette_1, palette_2],
            background,
            DrawSize::new(width, height)?,
            DrawLane::StandardAccessory {
                recipe: resolve_recipe,
                random: resolve_random,
            },
            quality.applied(),
            Some(plan.borrowed()),
        )
        .and_then(ApplyRenderResult::hud)
    }
}
