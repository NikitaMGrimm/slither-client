use super::*;

#[derive(Clone, Copy)]
pub(super) struct DrawSize {
    pub(super) width: u32,
    pub(super) height: u32,
}

impl DrawSize {
    pub(super) fn new(width: f64, height: f64) -> Result<Self, JsValue> {
        Ok(Self {
            width: dimensions(width)?,
            height: dimensions(height)?,
        })
    }
    pub(super) fn entry(target: &HtmlCanvasElement) -> Self {
        Self {
            width: target.width(),
            height: target.height(),
        }
    }
    pub(super) fn half(self) -> Point {
        Point {
            x: f64::from(self.width) / 2.,
            y: f64::from(self.height) / 2.,
        }
    }
    pub(super) fn validate_entry(self, target: &HtmlCanvasElement) -> Result<(), JsValue> {
        if target.width() != self.width || target.height() != self.height {
            return Err(error("target dimensions changed during recipe resolution"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub(super) struct SceneDrawContext {
    pub(super) size: DrawSize,
    pub(super) center: f64,
    pub(super) boundary: Option<f64>,
    pub(super) tile_size: Point,
    pub(super) image_size: Option<[u32; 2]>,
}

impl SceneDrawContext {
    pub(super) fn at_setup(
        client: &AnimatedClient,
        size: DrawSize,
        setup: Option<&Setup>,
        tile: &HtmlImageElement,
        backdrop: Option<&HtmlImageElement>,
    ) -> Self {
        Self {
            size,
            center: setup.map_or(0., |s| s.grid_center),
            boundary: setup.and(client.boundary()).map(|b| b.displayed()),
            tile_size: Point {
                x: f64::from(tile.natural_width()),
                y: f64::from(tile.natural_height()),
            },
            image_size: backdrop.map(|image| [image.natural_width(), image.natural_height()]),
        }
    }
    pub(super) fn committed(
        client: &AnimatedClient,
        size: DrawSize,
        tile: &HtmlImageElement,
        backdrop: Option<&HtmlImageElement>,
    ) -> Self {
        Self::at_setup(
            client,
            size,
            client.received().setup.as_ref(),
            tile,
            backdrop,
        )
    }

    pub(super) fn background(
        self,
        prepared: &mut AnimatedClient,
        quality: QualitySnapshot,
    ) -> Result<BackgroundPlan, JsValue> {
        prepared
            .prepare_background(BackgroundInput {
                width: self.size.width,
                height: self.size.height,
                zoom: prepared.camera().zoom(),
                image_size: self.image_size,
                pattern_available: true,
                quality,
                tile_width: self.tile_size.x,
                tile_height: self.tile_size.y,
            })
            .map_err(error)
    }
}

// Empty Setup draws still reset and repaint the complete desired target.
// Charge those draws independently of geometry before invoking draw resolvers.
pub(super) struct SetupDrawBudget {
    pub(super) remaining_draws: u32,
    pub(super) remaining_pixels: u64,
}

impl Default for SetupDrawBudget {
    fn default() -> Self {
        Self {
            remaining_draws: 64,
            remaining_pixels: 67_108_864,
        }
    }
}

impl SetupDrawBudget {
    pub(super) fn charge(&mut self, size: DrawSize) -> Result<(), JsValue> {
        let draws = self
            .remaining_draws
            .checked_sub(1)
            .ok_or_else(|| error("Setup draw count budget exceeded"))?;
        let area = u64::from(size.width)
            .checked_mul(u64::from(size.height))
            .ok_or_else(|| error("Setup background pixel budget exceeded"))?;
        let pixels = self
            .remaining_pixels
            .checked_sub(area)
            .ok_or_else(|| error("Setup background pixel budget exceeded"))?;
        self.remaining_draws = draws;
        self.remaining_pixels = pixels;
        Ok(())
    }
}

pub(super) struct DrawBudget {
    pub(super) samples: usize,
    pub(super) images: usize,
    pub(super) layouts: usize,
    pub(super) antenna: AntennaDrawBudget,
}
impl Default for DrawBudget {
    fn default() -> Self {
        Self {
            samples: MAX_DRAW_SAMPLES,
            images: MAX_BODY_PAINT_COMMANDS,
            layouts: MAX_DRAW_SAMPLES,
            antenna: AntennaDrawBudget::default(),
        }
    }
}
impl DrawBudget {
    pub(super) fn prepared(&mut self, snakes: &[PreparedAccessorySnake]) -> Result<(), JsValue> {
        self.layouts = self
            .layouts
            .checked_sub(snakes.len())
            .ok_or_else(|| error("scene layout budget exceeded"))?;
        for prepared in snakes {
            let snake = &prepared.snake;
            self.samples = self
                .samples
                .checked_sub(snake.curve.as_ref().map_or(0, |c| c.samples.len()))
                .ok_or_else(|| error("scene sample budget exceeded"))?;
        }
        Ok(())
    }
}

pub(super) fn push<T>(values: &mut Vec<T>, value: T) -> Result<(), JsValue> {
    values
        .try_reserve(1)
        .map_err(|_| error("scene plan allocation failed"))?;
    values.push(value);
    Ok(())
}

fn collect_layouts<T>(values: impl Iterator<Item = Result<T, JsValue>>) -> Result<Vec<T>, JsValue> {
    let mut layouts = Vec::new();
    for value in values {
        push(&mut layouts, value?)?;
    }
    Ok(layouts)
}

#[derive(Clone, Copy)]
pub(super) enum DrawLane<'a> {
    Basic {
        detailed: bool,
        face: &'a js_sys::Function,
    },
    Standard(&'a js_sys::Function),
    BasicAntenna {
        detailed: bool,
        presentation: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    StandardAntenna {
        recipe: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    BasicFace {
        detailed: bool,
        presentation: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    StandardFace {
        recipe: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    BasicAccessory {
        detailed: bool,
        presentation: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
    StandardAccessory {
        recipe: &'a js_sys::Function,
        random: &'a js_sys::Function,
    },
}

impl DrawLane<'_> {
    pub(super) fn with_antenna(self) -> bool {
        matches!(
            self,
            Self::BasicAntenna { .. }
                | Self::StandardAntenna { .. }
                | Self::BasicFace { .. }
                | Self::StandardFace { .. }
                | Self::BasicAccessory { .. }
                | Self::StandardAccessory { .. }
        )
    }

    pub(super) fn with_accessory_presentation(self) -> bool {
        matches!(
            self,
            Self::BasicAccessory { .. } | Self::StandardAccessory { .. }
        )
    }

    pub(super) fn with_face_presentation(self) -> bool {
        matches!(
            self,
            Self::BasicFace { .. }
                | Self::StandardFace { .. }
                | Self::BasicAccessory { .. }
                | Self::StandardAccessory { .. }
        )
    }
}

pub(crate) enum FaceLayout {
    Paired {
        eyes: Option<StandardEyeLayout>,
        decoration: Option<[PairedSideLayout; 2]>,
    },
    SingleImage(SingleEyeLayout),
    Mouth(MouthFaceLayout),
}

pub(super) enum PlannedSnakePaint {
    Basic {
        snakes: Vec<PreparedSnake>,
        layouts: Vec<FaceLayout>,
        faces: Vec<FaceSources>,
        antennas: Vec<Option<AntennaDecoration>>,
        accessories: Vec<Option<AccessorySources>>,
        accessory_layouts: Vec<Option<StaticHeadAccessoryLayout>>,
    },
    Standard {
        draws: Vec<StandardDraw>,
        recipes: Vec<Recipe>,
    },
}
pub(super) struct StandardDraw {
    pub(super) plan: Option<BodyPaintPlan>,
    pub(super) layout: FaceLayout,
    pub(super) root_alpha: f64,
    pub(super) antenna: Option<PreparedAntenna>,
    pub(super) accessory: Option<StaticHeadAccessoryLayout>,
}
pub(super) struct PlannedScene {
    pub(super) context: SceneDrawContext,
    pub(super) background: BackgroundPlan,
    pub(super) camera: Point,
    pub(super) zoom: f64,
    pub(super) food: Option<FoodPaintPlan>,
    pub(super) prey: Option<PreyPaintPlan>,
    pub(super) arena_edge: Option<ArenaEdgePlan>,
    pub(super) nicknames: Vec<NicknameDraw>,
    pub(super) fallback: Vec<Food>,
    pub(super) paint: PlannedSnakePaint,
}

fn submit_nicknames(
    context: &CanvasRenderingContext2d,
    names: &[NicknameDraw],
) -> Result<(), JsValue> {
    if names.is_empty() {
        return Ok(());
    }
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.set_global_composite_operation("source-over")?;
        for name in names {
            context.set_global_alpha(name.alpha);
            context.set_font(&format!("{}px {}", name.font_size, name.font_family));
            context.set_text_align(match name.alignment {
                NicknameAlignment::Center => "center",
            });
            context.set_text_baseline(match name.baseline {
                NicknameBaseline::Middle => "middle",
            });
            let [r, g, b] = name.color;
            context.set_fill_style_str(&format!("#{r:02x}{g:02x}{b:02x}"));
            context.fill_text(&name.text, name.position.x, name.position.y)?;
        }
        Ok(())
    })();
    context.restore();
    result
}

pub(super) fn arena_edge_plan(
    prepared: &AnimatedClient,
    context: SceneDrawContext,
) -> Result<Option<ArenaEdgePlan>, JsValue> {
    context
        .boundary
        .map(|radius| {
            plan_arena_edge(ArenaEdgeInput {
                view: prepared.arena_edge_view(),
                camera: prepared.camera().position(),
                zoom: prepared.camera().zoom(),
                width: context.size.width,
                height: context.size.height,
                radius,
            })
            .map_err(error)
        })
        .transpose()
        .map(Option::flatten)
}

fn submit_arena_edge(
    context: &CanvasRenderingContext2d,
    plan: &ArenaEdgePlan,
) -> Result<(), JsValue> {
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.set_global_composite_operation("source-over")?;
        context.set_global_alpha(0.8);
        context.set_line_width(plan.line_width);
        context.set_fill_style_str("#300000");
        context.set_stroke_style_str("#800000");
        context.begin_path();
        context.move_to(plan.fill[0].x, plan.fill[0].y);
        for point in &plan.fill[1..] {
            context.line_to(point.x, point.y);
        }
        context.close_path();
        context.fill();
        context.begin_path();
        context.move_to(plan.stroke[0].x, plan.stroke[0].y);
        for point in &plan.stroke[1..] {
            context.line_to(point.x, point.y);
        }
        context.stroke();
        Ok(())
    })();
    context.restore();
    result
}

pub(super) fn view(size: DrawSize, camera: Point, zoom: f64) -> BodyPaintView {
    let half = size.half();
    BodyPaintView {
        camera,
        zoom,
        half_width: half.x,
        half_height: half.y,
    }
}

pub(super) fn fallback_food(prepared: &AnimatedClient, needed: bool) -> Result<Vec<Food>, JsValue> {
    let mut foods = Vec::new();
    if needed {
        foods
            .try_reserve(prepared.received().foods.len())
            .map_err(|_| error("scene plan allocation failed"))?;
        foods.extend(prepared.received().foods.values().cloned());
    }
    Ok(foods)
}

pub(super) fn food_plan(
    sources: &FoodSources,
    prepared: &AnimatedClient,
    target: &HtmlCanvasElement,
    view: BodyPaintView,
    quality: BodyPaintQuality,
    budget: &mut DrawBudget,
) -> Result<Option<FoodPaintPlan>, JsValue> {
    if !prepared.food_enabled() {
        return Ok(None);
    }
    sources.validate(target)?;
    let plan = plan_food(FoodPaintInput {
        foods: prepared.foods().foods(),
        view,
        quality,
        bounds: prepared.food_bounds(),
        assets: &sources.assets()?,
        target_handle: None,
        entry_alpha: 1.,
        command_limit: budget.images,
    })
    .map_err(error)?;
    budget.images = budget
        .images
        .checked_sub(plan.early.len())
        .and_then(|n| n.checked_sub(plan.late.len()))
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(Some(plan))
}

fn submit_food(
    sources: &FoodSources,
    context: &CanvasRenderingContext2d,
    commands: &[FoodImageCommand],
) -> Result<(), JsValue> {
    context.save();
    let result = commands
        .iter()
        .try_for_each(|command| sources.submit(context, command));
    context.restore();
    result
}

pub(super) fn prey_plan(
    sources: &PreySources,
    prepared: &AnimatedClient,
    target: &HtmlCanvasElement,
    view: BodyPaintView,
    budget: &mut DrawBudget,
) -> Result<Option<PreyPaintPlan>, JsValue> {
    if !prepared.prey_enabled() {
        return Ok(None);
    }
    sources.validate(target)?;
    let mut eaters = Vec::new();
    for token in prepared.preys().referenced_eaters() {
        if eaters.iter().any(|(prior, _)| *prior == token) {
            continue;
        }
        let snake = prepared
            .snake_object(token)
            .ok_or_else(|| error("missing captured prey eater"))?;
        let metrics = snake.metrics();
        let offset = snake.head_corrections().offset();
        push(
            &mut eaters,
            (
                token,
                PreyEaterPose {
                    head: metrics.raw_head,
                    head_offset: Point {
                        x: offset[0],
                        y: offset[1],
                    },
                    heading: metrics.heading,
                    angle_offset: snake.angle_corrections().offset(),
                },
            ),
        )?;
    }
    let plan = plan_prey(PreyPaintInput {
        preys: prepared.preys().preys(),
        eaters: &eaters,
        view,
        assets: &sources.assets()?,
        target_handle: None,
        early_entry_alpha: 1.,
        late_entry_alpha: 1.,
        command_limit: budget.images,
    })
    .map_err(error)?;
    budget.images = budget
        .images
        .checked_sub(plan.counts.total())
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(Some(plan))
}

fn submit_prey(
    sources: &PreySources,
    context: &CanvasRenderingContext2d,
    commands: &[PreyImageCommand],
) -> Result<(), JsValue> {
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.set_global_composite_operation("lighter")?;
        commands
            .iter()
            .try_for_each(|command| sources.submit(context, command))
    })();
    context.restore();
    result
}

#[allow(clippy::too_many_arguments)]
fn prepare_snakes<F>(
    prepared: &mut AnimatedClient,
    size: DrawSize,
    quality_scale: f64,
    budget: &mut DrawBudget,
    resolve_style: F,
    random: Option<&js_sys::Function>,
    generalized: bool,
    accessory: bool,
) -> Result<Vec<PreparedAccessorySnake>, JsValue>
where
    F: FnMut(usize, bool, &SnakePresentation) -> Result<bool, ResolveError>,
{
    if accessory {
        let random =
            random.ok_or_else(|| error("accessory presentation random resolver required"))?;
        return prepared
            .prepare_draw_resolved_with_accessory_presentation_limited_staged(
                size.width,
                size.height,
                quality_scale,
                budget.samples,
                &mut budget.antenna,
                resolve_style,
                |input| antenna_random(random, input),
            )
            .map_err(|e| e.0);
    }
    let result = if generalized {
        let random = random.ok_or_else(|| error("face presentation random resolver required"))?;
        prepared.prepare_draw_resolved_with_face_presentation_limited_staged(
            size.width,
            size.height,
            quality_scale,
            budget.samples,
            &mut budget.antenna,
            resolve_style,
            |input| antenna_random(random, input),
        )
    } else if let Some(random) = random {
        prepared.prepare_draw_resolved_with_antenna_limited_staged(
            size.width,
            size.height,
            quality_scale,
            budget.samples,
            &mut budget.antenna,
            resolve_style,
            |input| antenna_random(random, input),
        )
    } else {
        prepared.prepare_draw_resolved_limited_staged(
            size.width,
            size.height,
            quality_scale,
            budget.samples,
            resolve_style,
        )
    };
    result
        .map(|snakes| {
            snakes
                .into_iter()
                .map(|snake| PreparedAccessorySnake {
                    snake,
                    accessory: None,
                })
                .collect()
        })
        .map_err(|e| e.0)
}

// Ordinals include culled draw entries; copy only configurations before the
// client is mutably borrowed for its single draw-preparation pass.
fn drawn_antenna_geometry(
    prepared: &AnimatedClient,
) -> Result<Vec<Option<OrdinaryAntennaGeometry>>, JsValue> {
    collect_layouts(
        prepared
            .snake_objects()
            .filter(|(_, _, drawn, _)| *drawn)
            .map(|(token, _, _, _)| Ok(prepared.antenna_geometry(token))),
    )
}

fn plan_accessory(
    prepared: &PreparedAccessorySnake,
    source: Option<&AccessorySources>,
    view: EyeLayoutInput,
) -> Result<Option<StaticHeadAccessoryLayout>, JsValue> {
    match (prepared.accessory, source) {
        (None, None) => Ok(None),
        (Some(geometry), Some(source)) if geometry.same_bits(&source.geometry) => Ok(Some(
            geometry
                .layout(
                    prepared.snake.face_heading,
                    Point {
                        x: source.source_rect.width,
                        y: source.source_rect.height,
                    },
                    prepared.snake.metrics.spawn_progress,
                    view,
                )
                .map_err(error)?,
        )),
        _ => Err(error(
            "planned accessory differs from retained appearance geometry",
        )),
    }
}

fn face_image_count(face: Option<&FaceSources>) -> usize {
    match face {
        Some(FaceSources::Mouth(_)) => 3,
        Some(FaceSources::SingleImage(_))
        | Some(FaceSources::Paired {
            decoration: Some(_),
            ..
        }) => 2,
        _ => 0,
    }
}

fn plan_face(
    snake: &PreparedSnake,
    face: Option<&FaceSources>,
    view: EyeLayoutInput,
) -> Result<FaceLayout, JsValue> {
    match face {
        Some(FaceSources::Mouth(_)) => Ok(FaceLayout::Mouth(
            snake
                .face_geometry
                .mouth()
                .ok_or_else(|| error("mouth face geometry required"))?
                .layout(snake.face_heading, snake.pupil, view)
                .map_err(error)?,
        )),
        Some(FaceSources::SingleImage(_)) => Ok(FaceLayout::SingleImage(
            snake
                .face_geometry
                .single_image()
                .ok_or_else(|| error("single image geometry required"))?
                .layout(snake.face_heading, snake.pupil, view)
                .map_err(error)?,
        )),
        Some(FaceSources::Paired { decoration, .. }) => Ok(FaceLayout::Paired {
            eyes: Some(
                snake
                    .eye_geometry
                    .ok_or_else(|| error("paired geometry required"))?
                    .layout(snake.face_heading, snake.pupil, view)
                    .map_err(error)?,
            ),
            decoration: decoration
                .as_ref()
                .map(|d| d.geometry.layout(snake.face_heading, view).map_err(error))
                .transpose()?,
        }),
        None => Ok(FaceLayout::Paired {
            eyes: None,
            decoration: None,
        }),
    }
}

pub(crate) fn submit_selected_face(
    sources: &BorrowedSources,
    context: &CanvasRenderingContext2d,
    face: Option<&FaceSources>,
    layout: FaceLayout,
    basic: bool,
    accessory: Option<(&AccessorySources, &StaticHeadAccessoryLayout)>,
) -> Result<(), JsValue> {
    match layout {
        FaceLayout::Mouth(layout) => {
            if let Some((source, layout)) = accessory {
                sources.submit_accessory(context, source, layout)?;
            }
            let Some(FaceSources::Mouth(face)) = face else {
                return Err(error("planned mouth face sources missing"));
            };
            sources.submit_mouth_face(context, face, &layout)?;
            context.set_global_alpha(1.);
        }
        FaceLayout::SingleImage(layout) => {
            let Some(FaceSources::SingleImage(face)) = face else {
                return Err(error("planned single image sources missing"));
            };
            sources.submit_single_eye(context, face, &layout)?;
            context.set_global_alpha(1.);
        }
        FaceLayout::Paired { eyes, decoration } => {
            if let Some(layout) = eyes {
                draw_eyes(context, layout)?;
            }
            if let Some((source, layout)) = accessory {
                sources.submit_accessory(context, source, layout)?;
            }
            context.set_global_alpha(1.);
            if basic {
                context.set_global_composite_operation("source-over")?;
            }
            if let Some(layouts) = decoration {
                let Some(FaceSources::Paired {
                    decoration: Some(face),
                    ..
                }) = face
                else {
                    return Err(error("planned paired decoration missing"));
                };
                sources.submit_face(context, face, layouts)?;
            }
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn build_standard(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    resolve_recipe: &js_sys::Function,
    random: Option<&js_sys::Function>,
    generalized: bool,
    accessory: bool,
    applied: QualitySnapshot,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let DrawSize { width, height } = size;
    let mut recipes = Vec::new();
    let retained_accessories = if accessory {
        drawn_accessory_geometry(prepared)
    } else {
        Vec::new()
    };
    let retained = if random.is_some() {
        drawn_antenna_geometry(prepared)?
    } else {
        Vec::new()
    };
    let snakes = prepare_snakes(
        prepared,
        size,
        applied.quality_scale,
        budget,
        |ordinal, own, snake| -> Result<bool, ResolveError> {
            let request = request(ordinal, own, snake)?;
            let recipe = if accessory {
                sources.resolve_with_accessory(
                    resolve_recipe,
                    &request,
                    target,
                    &FacePresentation {
                        face: *snake.active_face_geometry(),
                        antenna: *retained
                            .get(ordinal)
                            .ok_or_else(|| error("missing retained antenna configuration"))?,
                    },
                    retained_accessories
                        .get(ordinal)
                        .ok_or_else(|| error("missing retained accessory configuration"))?
                        .as_ref(),
                    false,
                )?
            } else if generalized {
                sources.resolve_with_face(
                    resolve_recipe,
                    &request,
                    target,
                    &FacePresentation {
                        face: *snake.active_face_geometry(),
                        antenna: *retained
                            .get(ordinal)
                            .ok_or_else(|| error("missing retained antenna configuration"))?,
                    },
                )?
            } else if random.is_some() {
                sources.resolve_with_antenna(
                    resolve_recipe,
                    &request,
                    target,
                    retained
                        .get(ordinal)
                        .ok_or_else(|| error("missing retained antenna configuration"))?
                        .as_ref(),
                )?
            } else {
                sources.resolve(resolve_recipe, &request, target)?
            };
            if !generalized {
                let retained = snake
                    .face_geometry()
                    .ok_or_else(|| error("legacy renderer requires paired face"))?;
                let decoration = match &recipe.face {
                    Some(FaceSources::Paired { eyes, decoration }) => {
                        if !same_eyes(eyes, &retained.eyes) {
                            return Err(error(
                                "recipe eyes differ from retained appearance geometry",
                            )
                            .into());
                        }
                        decoration.as_ref()
                    }
                    None => None,
                    Some(FaceSources::SingleImage(_) | FaceSources::Mouth(_)) => {
                        return Err(error("legacy renderer requires paired face").into());
                    }
                };
                if !same_decoration(decoration, retained.decoration.as_ref()) {
                    return Err(error(
                        "recipe decoration differs from retained appearance geometry",
                    )
                    .into());
                }
            }
            let detailed = recipe.style.detailed_segments;
            push(&mut recipes, recipe)?;
            Ok(detailed)
        },
        random,
        generalized,
        accessory,
    )?;
    if snakes.len() > MAX_RETAINED_SNAKES {
        return Err(error("face command budget exceeded"));
    }
    let camera = prepared.camera().position();
    let zoom = prepared.camera().zoom();
    let viewport_half = Point {
        x: f64::from(width) / 2.,
        y: f64::from(height) / 2.,
    };
    let mut draws = Vec::new();
    budget.prepared(&snakes)?;
    let mut remaining = budget.images;
    // Every ordinary face completes with an unconditional root alpha one,
    // including eye-less and nondecorated faces. Standalone planner callers
    // still control their own entry alpha.
    let entry_alpha = 1.;
    for (prepared_snake, recipe) in snakes.iter().zip(&recipes) {
        let snake = &prepared_snake.snake;
        if snake
            .antenna
            .as_ref()
            .is_some_and(|antenna| antenna.bulb.is_some())
        {
            remaining = remaining
                .checked_sub(1)
                .ok_or_else(|| error("scene image budget exceeded"))?;
        }
        remaining = remaining
            .checked_sub(face_image_count(recipe.face.as_ref()))
            .and_then(|n| n.checked_sub(usize::from(recipe.accessory.is_some())))
            .ok_or_else(|| error("scene image budget exceeded"))?;
        let m = snake.metrics;
        let layout = plan_face(
            snake,
            recipe.face.as_ref(),
            EyeLayoutInput {
                corrected_head: m.corrected_head,
                camera,
                viewport_half,
                scale: m.scale,
                zoom,
                death_progress: m.death_progress,
            },
        )?;
        let accessory = plan_accessory(
            prepared_snake,
            recipe.accessory.as_ref(),
            EyeLayoutInput {
                corrected_head: m.corrected_head,
                camera,
                viewport_half,
                scale: m.scale,
                zoom,
                death_progress: m.death_progress,
            },
        )?;
        let mut root_alpha = entry_alpha;
        let plan = if let Some(geometry) = &snake.body_geometry {
            let palettes = recipe.palettes();
            let maximum_speed = m.maximum_speed;
            let input = BodyPaintInput {
                geometry: geometry.as_paint_geometry(),
                recipe: recipe.borrowed(&palettes),
                assets: &recipe.assets,
                view: BodyPaintView {
                    camera,
                    zoom,
                    half_width: viewport_half.x,
                    half_height: viewport_half.y,
                },
                quality: BodyPaintQuality {
                    high_quality: applied.high_quality,
                    blend: applied.quality_blend,
                },
                visual: BodyPaintVisual {
                    scale: m.scale,
                    spawn: m.spawn_progress,
                    death: m.death_progress,
                    dead: !m.alive,
                    smoothed_speed: m.visual_speed,
                    boost_threshold: m.boost_threshold_speed,
                    cruise_speed: m.cruise_speed,
                    maximum_speed,
                    boost_phase: m.boost_phase,
                },
                entry_alpha,
                command_limit: remaining,
            };
            let body = if let Some(antenna) = &snake.antenna {
                plan_standard_body_with_antenna(input, antenna.barrier_effect)
            } else {
                plan_standard_body(input)
            };
            match body {
                Ok(plan) => {
                    remaining = remaining
                        .checked_sub(plan.commands.len())
                        .ok_or_else(|| error("scene image budget exceeded"))?;
                    let mut opacity = m.spawn_progress * (1. - m.death_progress);
                    opacity *= opacity;
                    let boost = if m.visual_speed > m.boost_threshold_speed {
                        m.spawn_progress
                            * (1. - m.death_progress)
                            * ((m.visual_speed - m.cruise_speed) / (maximum_speed - m.cruise_speed))
                                .clamp(0., 1.)
                    } else {
                        0.
                    };
                    root_alpha = opacity * (1. - boost);
                    Some(plan)
                }
                // Coincident/short stored geometry has no production body.
                // Its independently valid eyes still complete in draw order.
                Err(BodyPaintError::UnsupportedGeometry) => None,
                Err(e) => return Err(error(e)),
            }
        } else {
            None
        };
        push(
            &mut draws,
            StandardDraw {
                plan,
                layout,
                root_alpha,
                antenna: snake.antenna.clone(),
                accessory,
            },
        )?;
    }
    budget.images = remaining;
    Ok(PlannedSnakePaint::Standard { draws, recipes })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_basic(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    quality_scale: f64,
    detailed_style: bool,
    resolve_face: Option<&js_sys::Function>,
    random: Option<&js_sys::Function>,
    generalized: bool,
    accessory: bool,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let DrawSize { width, height } = size;
    let mut faces = Vec::new();
    let mut antennas = Vec::new();
    let mut accessories = Vec::new();
    let retained_accessories = if accessory {
        drawn_accessory_geometry(prepared)
    } else {
        Vec::new()
    };
    let retained = if random.is_some() {
        drawn_antenna_geometry(prepared)?
    } else {
        Vec::new()
    };
    let snakes = prepare_snakes(
        prepared,
        size,
        quality_scale,
        budget,
        |ordinal, own, snake| -> Result<bool, ResolveError> {
            let (face, antenna, selected) = if accessory {
                let mut recipe = sources.resolve_with_accessory(
                    resolve_face.ok_or_else(|| error("presentation resolver required"))?,
                    &request(ordinal, own, snake)?,
                    target,
                    &FacePresentation {
                        face: *snake.active_face_geometry(),
                        antenna: *retained
                            .get(ordinal)
                            .ok_or_else(|| error("missing retained antenna configuration"))?,
                    },
                    retained_accessories
                        .get(ordinal)
                        .ok_or_else(|| error("missing retained accessory configuration"))?
                        .as_ref(),
                    true,
                )?;
                (
                    recipe
                        .face
                        .take()
                        .ok_or_else(|| error("selected face required"))?,
                    recipe.antenna.take(),
                    recipe.accessory.take(),
                )
            } else if generalized {
                let retained = FacePresentation {
                    face: *snake.active_face_geometry(),
                    antenna: *retained
                        .get(ordinal)
                        .ok_or_else(|| error("missing retained antenna configuration"))?,
                };
                let resolved = sources.resolve_generalized_presentation(
                    resolve_face.ok_or_else(|| error("presentation resolver required"))?,
                    &request(ordinal, own, snake)?,
                    &retained,
                    target,
                )?;
                (resolved.face, resolved.antenna, None)
            } else {
                let paired = snake
                    .face_geometry()
                    .ok_or_else(|| error("legacy renderer requires paired face"))?;
                let (decoration, antenna) = if random.is_some() {
                    let retained = AppearancePresentation {
                        face: *paired,
                        antenna: *retained
                            .get(ordinal)
                            .ok_or_else(|| error("missing retained antenna configuration"))?,
                    };
                    let resolved = sources.resolve_presentation(
                        resolve_face.ok_or_else(|| error("presentation resolver required"))?,
                        &request(ordinal, own, snake)?,
                        &retained,
                        target,
                    )?;
                    (resolved.decoration, resolved.antenna)
                } else if let Some(resolve_face) = resolve_face {
                    (
                        sources.resolve_face(
                            resolve_face,
                            &request(ordinal, own, snake)?,
                            paired,
                            target,
                        )?,
                        None,
                    )
                } else {
                    if paired.decoration.is_some() {
                        return Err(
                            error("decorated face requires render_with_face_decorations").into(),
                        );
                    }
                    (None, None)
                };
                (
                    FaceSources::Paired {
                        eyes: paired.eyes,
                        decoration,
                    },
                    antenna,
                    None,
                )
            };
            push(&mut faces, face)?;
            push(&mut antennas, antenna)?;
            push(&mut accessories, selected)?;
            Ok(detailed_style)
        },
        random,
        generalized,
        accessory,
    )?;
    if snakes.len() > MAX_RETAINED_SNAKES {
        return Err(error("face command budget exceeded"));
    }
    let camera = prepared.camera().position();
    let zoom = prepared.camera().zoom();
    let viewport_half = Point {
        x: f64::from(width) / 2.,
        y: f64::from(height) / 2.,
    };
    budget.prepared(&snakes)?;
    // Complete numeric validation before the target's destructive width reset.
    let layouts = collect_layouts(snakes.iter().zip(&faces).map(|(prepared, face)| {
        let snake = &prepared.snake;
        plan_face(
            snake,
            Some(face),
            EyeLayoutInput {
                corrected_head: snake.metrics.corrected_head,
                camera,
                viewport_half,
                scale: snake.metrics.scale,
                zoom,
                death_progress: snake.metrics.death_progress,
            },
        )
    }))?;
    let accessory_layouts =
        collect_layouts(snakes.iter().zip(&accessories).map(|(prepared, source)| {
            let m = prepared.snake.metrics;
            plan_accessory(
                prepared,
                source.as_ref(),
                EyeLayoutInput {
                    corrected_head: m.corrected_head,
                    camera,
                    viewport_half,
                    scale: m.scale,
                    zoom,
                    death_progress: m.death_progress,
                },
            )
        }))?;
    let image_count = snakes
        .iter()
        .try_fold(0_usize, |count, prepared| {
            let snake = &prepared.snake;
            count
                .checked_add(snake.curve.as_ref().map_or(0, |curve| curve.samples.len()))
                .and_then(|count| {
                    count.checked_add(usize::from(
                        snake
                            .antenna
                            .as_ref()
                            .is_some_and(|antenna| antenna.bulb.is_some()),
                    ))
                })
        })
        .and_then(|count| {
            faces.iter().try_fold(count, |count, face| {
                count.checked_add(face_image_count(Some(face)))
            })
        })
        .and_then(|count| count.checked_add(accessories.iter().filter(|s| s.is_some()).count()))
        .ok_or_else(|| error("scene image budget exceeded"))?;
    budget.images = budget
        .images
        .checked_sub(image_count)
        .ok_or_else(|| error("scene image budget exceeded"))?;
    Ok(PlannedSnakePaint::Basic {
        snakes: snakes.into_iter().map(|s| s.snake).collect(),
        layouts,
        faces,
        antennas,
        accessories,
        accessory_layouts,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_paint(
    prepared: &mut AnimatedClient,
    sources: &mut BorrowedSources,
    target: &HtmlCanvasElement,
    size: DrawSize,
    lane: DrawLane<'_>,
    applied: QualitySnapshot,
    budget: &mut DrawBudget,
) -> Result<PlannedSnakePaint, JsValue> {
    let generalized = lane.with_face_presentation();
    let accessory = lane.with_accessory_presentation();
    match lane {
        DrawLane::Basic { detailed, face } => build_basic(
            prepared,
            sources,
            target,
            size,
            applied.quality_scale,
            detailed,
            Some(face),
            None,
            false,
            false,
            budget,
        ),
        DrawLane::Standard(recipe) => build_standard(
            prepared, sources, target, size, recipe, None, false, false, applied, budget,
        ),
        DrawLane::BasicAntenna {
            detailed,
            presentation,
            random,
        }
        | DrawLane::BasicFace {
            detailed,
            presentation,
            random,
        }
        | DrawLane::BasicAccessory {
            detailed,
            presentation,
            random,
        } => build_basic(
            prepared,
            sources,
            target,
            size,
            applied.quality_scale,
            detailed,
            Some(presentation),
            Some(random),
            generalized,
            accessory,
            budget,
        ),
        DrawLane::StandardAntenna { recipe, random }
        | DrawLane::StandardFace { recipe, random }
        | DrawLane::StandardAccessory { recipe, random } => build_standard(
            prepared,
            sources,
            target,
            size,
            recipe,
            Some(random),
            generalized,
            accessory,
            applied,
            budget,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn submit_plans(
    plans: Vec<PlannedScene>,
    target: &HtmlCanvasElement,
    sprites: &[HtmlCanvasElement; 3],
    background: &HtmlImageElement,
    backdrop: Option<&HtmlImageElement>,
    entry: DrawSize,
    sources: &BorrowedSources,
    foods: &FoodSources,
    preys: &PreySources,
) -> Result<(), JsValue> {
    validate_scene_sources(sources, foods, preys, target)?;
    entry.validate_entry(target)?;
    let mut frames = Vec::new();
    frames
        .try_reserve(plans.len())
        .map_err(|_| error("scene preflight allocation failed"))?;
    // Acquire every native context and pattern before the first destructive draw.
    for plan in &plans {
        frames.push(CanvasPreflight::new(
            target,
            sprites,
            background,
            plan.context.size.width,
            plan.context.size.height,
            plan.camera.x - plan.context.center,
            plan.camera.y - plan.context.center,
            plan.zoom,
            backdrop,
            &plan.background,
        )?);
    }
    entry.validate_entry(target)?;
    for (plan, frame) in plans.into_iter().zip(frames) {
        let frame = frame.begin(target, &plan.background, backdrop)?;
        plan.submit(frame, sprites, sources, foods, preys)?;
    }
    Ok(())
}

pub(crate) fn submit_antenna(
    sources: &BorrowedSources,
    context: &CanvasRenderingContext2d,
    decoration: Option<&AntennaDecoration>,
    plan: &PreparedAntenna,
) -> Result<(), JsValue> {
    if plan.strokes.is_empty() {
        return Ok(());
    }
    context.save();
    let result = (|| {
        context.set_transform(1., 0., 0., 1., 0., 0.)?;
        context.translate(plan.center.x, plan.center.y)?;
        context.set_global_composite_operation("source-over")?;
        context.set_line_cap("round");
        context.set_line_join("round");
        let mut current_path = None;
        for stroke in &plan.strokes {
            if current_path != Some(stroke.path) {
                let vertices = match stroke.path {
                    AntennaPath::Outer => &plan.outer_path,
                    AntennaPath::Inner => &plan.inner_path,
                };
                context.begin_path();
                if let Some((first, rest)) = vertices.split_first() {
                    context.move_to(first.x, first.y);
                    for point in rest {
                        context.line_to(point.x, point.y);
                    }
                }
                current_path = Some(stroke.path);
            }
            context.set_global_alpha(stroke.alpha);
            context.set_stroke_style_str(&format!("#{:06x}", stroke.color));
            context.set_line_width(stroke.width);
            context.stroke();
        }
        if let Some(bulb) = &plan.bulb {
            sources.submit_antenna_bulb(
                context,
                decoration.ok_or_else(|| error("planned antenna bulb source missing"))?,
                bulb,
            )?;
        }
        Ok(())
    })();
    context.restore();
    result
}

impl PlannedScene {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn build(
        prepared: &mut AnimatedClient,
        food_sources: &FoodSources,
        prey_sources: &PreySources,
        sources: &mut BorrowedSources,
        target: &HtmlCanvasElement,
        context: SceneDrawContext,
        lane: DrawLane<'_>,
        applied: QualitySnapshot,
        budget: &mut DrawBudget,
    ) -> Result<Self, JsValue> {
        let paint = build_paint(
            prepared,
            sources,
            target,
            context.size,
            lane,
            applied,
            budget,
        )?;
        Self::finish(
            prepared,
            food_sources,
            prey_sources,
            target,
            context,
            paint,
            applied,
            budget,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn finish(
        prepared: &mut AnimatedClient,
        food_sources: &FoodSources,
        prey_sources: &PreySources,
        target: &HtmlCanvasElement,
        context: SceneDrawContext,
        paint: PlannedSnakePaint,
        applied: QualitySnapshot,
        budget: &mut DrawBudget,
    ) -> Result<Self, JsValue> {
        let camera = prepared.camera().position();
        let zoom = prepared.camera().zoom();
        let food = food_plan(
            food_sources,
            prepared,
            target,
            view(context.size, camera, zoom),
            BodyPaintQuality {
                high_quality: applied.high_quality,
                blend: applied.quality_blend,
            },
            budget,
        )?;
        let fallback = fallback_food(prepared, food.is_none())?;
        let prey = prey_plan(
            prey_sources,
            prepared,
            target,
            view(context.size, camera, zoom),
            budget,
        )?;
        Ok(Self {
            context,
            background: context.background(prepared, applied)?,
            camera,
            zoom,
            food,
            prey,
            arena_edge: arena_edge_plan(prepared, context)?,
            nicknames: prepared.nickname_draws().to_vec(),
            fallback,
            paint,
        })
    }

    pub(super) fn submit(
        self,
        frame: CanvasFrame,
        sprites: &[HtmlCanvasElement; 3],
        sources: &BorrowedSources,
        food_sources: &FoodSources,
        prey_sources: &PreySources,
    ) -> Result<(), JsValue> {
        let context = frame.context();
        let camera = self.camera;
        let zoom = self.zoom;
        let viewport_half = self.context.size.half();
        if let Some(plan) = &self.food {
            submit_food(food_sources, context, &plan.early[..plan.outline_barrier])?;
            submit_food(food_sources, context, &plan.early[plan.outline_barrier..])?;
        } else {
            for food in &self.fallback {
                if frame.visible(food.position.x, food.position.y, food.size.max(1.)) {
                    draw_sprite(
                        context,
                        &sprites[usize::from(food.color) % 3],
                        food.position.x,
                        food.position.y,
                        food.size.max(1.),
                    )?;
                }
            }
        }
        if let Some(plan) = &self.prey {
            submit_prey(prey_sources, context, &plan.early)?;
        }
        submit_nicknames(context, &self.nicknames)?;
        match self.paint {
            PlannedSnakePaint::Basic {
                snakes,
                layouts,
                faces,
                antennas,
                accessories,
                accessory_layouts,
            } => {
                // Preserve subtraction-before-scaling for body screen coordinates. The
                // borrowed background/food preview above retains its existing transform.
                for (((((snake, layout), face), antenna), source), accessory_layout) in snakes
                    .into_iter()
                    .zip(layouts)
                    .zip(&faces)
                    .zip(&antennas)
                    .zip(&accessories)
                    .zip(&accessory_layouts)
                {
                    context.set_transform(1., 0., 0., 1., viewport_half.x, viewport_half.y)?;
                    let m = snake.metrics;
                    let opacity = m.spawn_progress * (1. - m.death_progress);
                    context.set_global_alpha(opacity * opacity);
                    if let Some(curve) = snake.curve {
                        for point in curve.samples.iter().rev() {
                            context.save();
                            let result = (|| {
                                context.translate(
                                    (f64::from(point.x) - camera.x) * zoom,
                                    (f64::from(point.y) - camera.y) * zoom,
                                )?;
                                context.rotate(f64::from(point.angle))?;
                                draw_sprite(
                                    context,
                                    &sprites[usize::from(m.skin) % 3],
                                    0.,
                                    0.,
                                    zoom * (29. * m.scale),
                                )?;
                                Ok::<_, JsValue>(())
                            })();
                            context.restore();
                            result?;
                        }
                    }
                    if let Some(plan) = &snake.antenna {
                        submit_antenna(sources, context, antenna.as_ref(), plan)?;
                    }
                    submit_selected_face(
                        sources,
                        context,
                        Some(face),
                        layout,
                        true,
                        source.as_ref().zip(accessory_layout.as_ref()),
                    )?;
                }
            }
            PlannedSnakePaint::Standard { draws, recipes } => {
                for (
                    StandardDraw {
                        plan,
                        layout,
                        root_alpha,
                        antenna,
                        accessory,
                    },
                    recipe,
                ) in draws.into_iter().zip(&recipes)
                {
                    let barrier = plan.as_ref().map_or(0, |p| p.antenna_barrier);
                    if let Some(antenna) = &antenna {
                        if let Some(plan) = &plan {
                            for command in &plan.commands[..barrier] {
                                sources.submit(context, command)?;
                            }
                        }
                        submit_antenna(sources, context, recipe.antenna.as_ref(), antenna)?;
                        if let Some(plan) = &plan {
                            for command in &plan.commands[barrier..] {
                                sources.submit(context, command)?;
                            }
                        }
                    } else if let Some(plan) = &plan {
                        for command in &plan.commands {
                            sources.submit(context, command)?;
                        }
                    }
                    context.set_global_alpha(root_alpha);
                    context.set_global_composite_operation("source-over")?;
                    submit_selected_face(
                        sources,
                        context,
                        recipe.face.as_ref(),
                        layout,
                        false,
                        recipe.accessory.as_ref().zip(accessory.as_ref()),
                    )?;
                }
            }
        }
        if let Some(plan) = &self.food {
            submit_food(food_sources, context, &plan.late)?;
        }
        if let Some(plan) = &self.prey {
            submit_prey(prey_sources, context, &plan.late)?;
        }
        if let Some(plan) = &self.arena_edge {
            submit_arena_edge(context, plan)?;
        }
        Ok(())
    }
}
