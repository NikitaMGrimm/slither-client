//! Isolated, static menu pose using the existing appearance and drawing primitives.

use crate::{
    menu_preferences::MenuPreferences,
    presentation::{
        AntennaCullBounds, AntennaDrawInput, AntennaState, BodyGeometry, BodyPaintSample,
        BodyPaintView, BodyPaintVisual, CurveInput, EyeLayoutInput, FaceGeometry, MouthFaceLayout,
        PairedSideLayout, PreparedAntenna, PreparedBodyGeometry, SingleEyeLayout, SkinDescriptor,
        StandardEyeLayout, StaticHeadAccessoryGeometry, StaticHeadAccessoryLayout,
        resolve_authored_local_skin, resolve_skin, sample_curve_with_heading,
    },
    state::{Appearance, Direction, Point, Setup},
};

/// Fixed, bounded backing dimensions; CSS may shrink the passive canvas.
pub const PREVIEW_WIDTH: u32 = 320;
/// Fixed preview backing height.
pub const PREVIEW_HEIGHT: u32 = 128;
/// Maximum body samples in this authored menu pose.
pub const MAX_PREVIEW_SAMPLES: usize = 512;
/// Authored pose head, shared with the existing provider's numeric request.
pub const PREVIEW_HEAD: Point = Point { x: 112., y: 0. };

/// Existing native face layouts, without browser source identities.
#[derive(Clone, Debug, PartialEq)]
pub enum PreviewFace {
    /// Ordinary paired eyes and optional represented side-image layout.
    Paired {
        /// Existing eye layout.
        eyes: StandardEyeLayout,
        /// Existing side-image geometry, if selected.
        decoration: Option<[PairedSideLayout; 2]>,
    },
    /// Existing single-image face layout.
    SingleImage(SingleEyeLayout),
    /// Existing mouth-family layout.
    Mouth(MouthFaceLayout),
}

/// Disposable static draw inputs; no world, session, frame clock or assets.
#[derive(Clone, Debug, PartialEq)]
pub struct PreviewPlan {
    /// Normal selection descriptor in the route's actual palette namespace.
    pub descriptor: SkinDescriptor,
    /// Existing sampled geometry for the standard body painter.
    pub geometry: PreparedBodyGeometry,
    /// Existing camera/backing projection.
    pub view: BodyPaintView,
    /// Fully visible, non-boosting preview presentation.
    pub visual: BodyPaintVisual,
    /// Existing selected face geometry projection.
    pub face: PreviewFace,
    /// Existing ordinary antenna plan, in a deterministic static initial pose.
    pub antenna: Option<PreparedAntenna>,
}

/// Expected source outcomes; unexpected capability failures remain errors.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreviewAvailability {
    /// Exact selected sources were planned and submitted.
    Ready,
    /// The existing provider reports a pending source.
    Pending,
    /// The existing provider cannot represent this selection.
    Unsupported,
}

impl PreviewAvailability {
    /// Plain user-facing status. Ready previews need no extra caption.
    pub fn message(self) -> &'static str {
        match self {
            Self::Ready => "",
            Self::Pending => "Preview sources are not ready.",
            Self::Unsupported => "Preview unavailable with the current sources.",
        }
    }
}

/// Menu selection and revision only. All source retention is per draw elsewhere.
#[derive(Clone, Debug)]
pub struct AppearancePreview {
    local: bool,
    skin: u8,
    custom: Vec<u8>,
    revision: u64,
    drawn_revision: Option<u64>,
}

impl AppearancePreview {
    /// Start an isolated preview with no submitted selection.
    pub fn new(local: bool) -> Self {
        Self {
            local,
            skin: 0,
            custom: Vec::new(),
            revision: 0,
            drawn_revision: None,
        }
    }

    /// Reuse the chooser's exact admission and own its bytes before queueing work.
    pub fn select(&mut self, skin: u8, custom: &[u8]) -> Result<u64, &'static str> {
        let mut menu = MenuPreferences::new(self.local);
        menu.select(skin, custom)?;
        if self.revision == 0 || self.skin != skin || self.custom != custom {
            let revision = self
                .revision
                .checked_add(1)
                .ok_or("Preview revision exhausted")?;
            self.skin = skin;
            self.custom = custom.to_vec();
            self.revision = revision;
        }
        Ok(self.revision)
    }

    /// Current native selection ticket; browser jobs only carry this copied token.
    pub fn revision(&self) -> u64 {
        self.revision
    }

    /// Requested wire skin, without source mapping.
    pub fn skin(&self) -> u8 {
        self.skin
    }

    /// Borrow the owned selection bytes, without exposing a mutable alias.
    pub fn custom(&self) -> &[u8] {
        &self.custom
    }

    /// Stock menu previews represent the player's existing selection, never a wire ID.
    pub fn own_accessory_context(&self) -> bool {
        !self.local
    }

    /// Project an admitted draw-local accessory through the existing static layout.
    /// The adapter supplies its exact explicit or Rust-forward-projected geometry.
    pub fn accessory_layout(
        &self,
        plan: &PreviewPlan,
        geometry: StaticHeadAccessoryGeometry,
        source_extent: Point,
    ) -> Result<StaticHeadAccessoryLayout, &'static str> {
        if !self.own_accessory_context()
            || matches!(plan.descriptor.face, FaceGeometry::SingleImage(_))
        {
            return Err("Static accessory unsupported for this preview");
        }
        geometry
            .layout(
                0.,
                source_extent,
                plan.visual.spawn,
                EyeLayoutInput {
                    corrected_head: PREVIEW_HEAD,
                    camera: plan.view.camera,
                    viewport_half: Point {
                        x: plan.view.half_width,
                        y: plan.view.half_height,
                    },
                    scale: plan.visual.scale,
                    zoom: plan.view.zoom,
                    death_progress: plan.visual.death,
                },
            )
            .map_err(|_| "Invalid preview accessory layout")
    }

    /// Stale or already submitted jobs do not read sources or paint again.
    pub fn needs_draw(&self, revision: u64) -> bool {
        revision != 0 && revision == self.revision && self.drawn_revision != Some(revision)
    }

    /// Commit only after complete native Canvas submission and source validation.
    pub fn mark_drawn(&mut self, revision: u64) -> Result<(), &'static str> {
        if revision == 0 || revision != self.revision {
            return Err("Stale preview selection");
        }
        self.drawn_revision = Some(revision);
        Ok(())
    }

    /// Reuse the route's resolver; preview never substitutes authored colors for stock.
    pub fn descriptor(&self, no_segment_rotation: bool) -> Result<SkinDescriptor, &'static str> {
        if self.local {
            resolve_authored_local_skin(self.skin, &self.custom)
        } else {
            resolve_skin(self.skin, &self.custom, no_segment_rotation)
        }
        .map_err(|_| "Invalid preview appearance")
    }

    /// Build one authored menu pose through the existing curve/body/face/antenna math.
    /// It does not receive packets, advance gameplay, consume randomness or animate.
    pub fn plan(&self, no_segment_rotation: bool) -> Result<PreviewPlan, &'static str> {
        if self.revision == 0 {
            return Err("Preview selection required");
        }
        let descriptor = self.descriptor(no_segment_rotation)?;
        let head = PREVIEW_HEAD;
        // Authored display pose only. The identity fields are never published as
        // a game appearance or used to choose a source; BodyGeometry consumes anchors.
        let appearance = Appearance {
            id: 0,
            skin: self.skin,
            name: String::new(),
            custom_skin: self.custom.clone(),
            cosmetic: 0,
            absolute_head: head,
            absolute_body: (1..=28)
                .map(|index| Point {
                    x: head.x - f64::from(index) * 9.,
                    y: crate::math::sin(f64::from(index) * 0.2) * 12.,
                })
                .collect(),
            anchor_direction: None,
            heading: 0.,
            wanted_heading: 0.,
            speed_per_32ms: 0.,
            fam: 0.,
            wire_direction: Direction::None,
        };
        let setup = Setup {
            protocol: 19,
            grid_center: 1000.,
            radius: 900.,
            sector_size: 100,
            sector_count: 20,
            max_segments: 200,
            body_spacing: 9.,
            body_contraction: 0.,
            spangdv: 4.,
            nsp1: 4.,
            nsp2: 0.5,
            nsp3: 12.,
            mamu: 0.03,
            mamu2: 0.02,
            server_number: None,
            game_mode: None,
            team: None,
        };
        let body = BodyGeometry::from_appearance(&appearance, &setup)
            .map_err(|_| "Invalid preview pose")?;
        let curve = sample_curve_with_heading(
            CurveInput {
                corrected_head: head,
                head_fraction: 0.,
                body: body.points(),
                displayed_length: 27.4,
                segment_length: 9.,
                point_spacing: 6.,
                target_point_spacing: 6.,
                quality_scale: 1.,
                detailed_style: descriptor.body_style.detailed_segments,
            },
            0.,
        )
        .map_err(|_| "Invalid preview curve")?;
        if !(2..=MAX_PREVIEW_SAMPLES).contains(&curve.samples.len()) {
            return Err("Preview sample budget exceeded");
        }
        let geometry = PreparedBodyGeometry {
            distance_cursor_seed: curve
                .distance_cursor_seed()
                .ok_or("Preview tangent required")?,
            samples: curve
                .samples
                .iter()
                .enumerate()
                .map(|(ordinal, sample)| BodyPaintSample {
                    ordinal,
                    x: sample.x,
                    y: sample.y,
                    tangent: sample.angle,
                    flag: 2,
                })
                .collect(),
        };
        let view = BodyPaintView {
            camera: Point { x: -8., y: 0. },
            zoom: 1.,
            half_width: 160.,
            half_height: 64.,
        };
        let eye_view = EyeLayoutInput {
            corrected_head: head,
            camera: view.camera,
            viewport_half: Point {
                x: view.half_width,
                y: view.half_height,
            },
            scale: 1.,
            zoom: view.zoom,
            death_progress: 0.,
        };
        let face = match descriptor.face {
            FaceGeometry::Paired(face) => PreviewFace::Paired {
                eyes: face
                    .eyes
                    .layout(0., Point::default(), eye_view)
                    .map_err(|_| "Invalid preview eyes")?,
                decoration: face
                    .decoration
                    .map(|geometry| geometry.layout(0., eye_view))
                    .transpose()
                    .map_err(|_| "Invalid preview side images")?,
            },
            FaceGeometry::SingleImage(geometry) => PreviewFace::SingleImage(
                geometry
                    .layout(0., Point::default(), eye_view)
                    .map_err(|_| "Invalid preview image eye")?,
            ),
            FaceGeometry::Mouth(geometry) => PreviewFace::Mouth(
                geometry
                    .layout(0., Point::default(), eye_view)
                    .map_err(|_| "Invalid preview mouth")?,
            ),
        };
        let antenna = descriptor
            .antenna
            .map(|antenna| {
                let state = AntennaState::from_appearance(antenna.geometry, head)
                    .map_err(|_| "Invalid preview antenna")?;
                let request = state
                    .prepare_draw(AntennaDrawInput {
                        raw_heading: 0.,
                        corrected_head: head,
                        scale: 1.,
                        spawn: 1.,
                        death: 0.,
                        active_curve_count: geometry.samples.len(),
                        whole_snake_visible: true,
                        view,
                        bounds: Some(
                            AntennaCullBounds::from_view(view)
                                .map_err(|_| "Invalid preview bounds")?,
                        ),
                    })
                    .map_err(|_| "Invalid preview antenna input")?;
                let pairs = vec![[0.5; 2]; request.random_pair_count()];
                request
                    .finish(&pairs)
                    .map(|(_, plan)| plan)
                    .map_err(|_| "Invalid preview antenna pose")
            })
            .transpose()?;
        Ok(PreviewPlan {
            descriptor,
            geometry,
            view,
            face,
            antenna,
            visual: BodyPaintVisual {
                scale: 1.,
                spawn: 1.,
                death: 0.,
                dead: false,
                smoothed_speed: 0.,
                boost_threshold: 1.,
                cruise_speed: 0.,
                maximum_speed: 1.,
                boost_phase: 0.,
            },
        })
    }
}
