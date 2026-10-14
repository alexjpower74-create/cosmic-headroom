// Headroom in the COSMIC panel: Claude Code and Codex quotas, reset countdowns and forecasts.
//
// This program only draws. The numbers, and every word shown with them, come from headroom-view.js
// (which runs the same engine as the Headroom GNOME extension); the applet keeps it running and
// reads one JSON line at a time. See ViewModel.js at the top of the repository for a line's shape.

use cosmic::{
    Element, Task, app,
    applet::padded_control,
    cosmic_theme::Spacing,
    iced::{
        self, Alignment, Background, Border, Color, Length, Subscription,
        futures::{SinkExt, Stream, channel::mpsc},
        stream,
        widget::{Column, Row, svg},
        window,
    },
    theme,
    widget::{button, container, divider, icon, space, text},
};
use serde::Deserialize;
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::mpsc as commands,
};

fn main() -> cosmic::iced::Result {
    cosmic::applet::run::<Headroom>(())
}

/// One line from headroom-view.js.
#[derive(Debug, Clone, Default, Deserialize)]
struct View {
    #[serde(default)]
    bar: Vec<BarItem>,
    #[serde(default)]
    providers: Vec<Provider>,
    #[serde(default)]
    footer: String,
    #[serde(default)]
    demo: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct BarItem {
    icon: String,
    text: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Provider {
    name: String,
    icon: String,
    #[serde(default)]
    plan: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    windows: Vec<Quota>,
}

#[derive(Debug, Clone, Deserialize)]
struct Quota {
    title: String,
    value: String,
    /// How much of the meter is filled, 0 to 1; nothing when the reading is unknown.
    fill: Option<f32>,
    #[serde(default)]
    severity: String,
    #[serde(default)]
    dim: bool,
    #[serde(default)]
    reset: String,
    #[serde(default)]
    warning: String,
}

#[derive(Debug, Clone)]
enum Engine {
    /// The engine loop is up; this is how to ask it for a refresh.
    Ready(commands::Sender<()>),
    View(View),
    /// headroom-view.js is not running, and why.
    Down(String),
}

#[derive(Debug, Clone)]
enum Message {
    TogglePopup,
    Closed(window::Id),
    Refresh,
    Engine(Engine),
}

/// What the panel button shows. Kept apart from the latest reading so it can stand still while the
/// popup is open (see `Headroom::settle_panel`).
#[derive(Debug, Clone, Default)]
struct Panel {
    bar: Vec<BarItem>,
    demo: bool,
    down: bool,
}

struct Headroom {
    core: cosmic::app::Core,
    popup: Option<window::Id>,
    view: View,
    panel: Panel,
    down: Option<String>,
    refresh: Option<commands::Sender<()>>,
    data: PathBuf,
}

/// Where build.py's output was installed: headroom-view.js, the shared modules, the icons.
fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("HEADROOM_DATA") {
        return PathBuf::from(dir);
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/share")
        });
    base.join("headroom-cosmic")
}

/// Keeps headroom-view.js running and passes on each line it prints. If it stops, says so and
/// starts it again after a pause. The engine itself stops when its stdin closes, so it never
/// outlives the applet.
fn engine(data: PathBuf) -> impl Stream<Item = Engine> {
    stream::channel(8, async move |mut output: mpsc::Sender<Engine>| {
        let (ask, mut asked) = commands::channel::<()>(4);
        let _ = output.send(Engine::Ready(ask)).await;
        loop {
            let spawned = Command::new("gjs")
                .arg("-m")
                .arg(data.join("headroom-view.js"))
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn();
            match spawned {
                Err(why) => {
                    let _ = output
                        .send(Engine::Down(format!("Could not start the usage reader: {why}")))
                        .await;
                }
                Ok(mut child) => {
                    let mut stdin = child.stdin.take();
                    let Some(stdout) = child.stdout.take() else {
                        continue;
                    };
                    let mut lines = BufReader::new(stdout).lines();
                    loop {
                        tokio::select! {
                            line = lines.next_line() => match line {
                                Ok(Some(line)) => {
                                    if let Ok(view) = serde_json::from_str::<View>(&line) {
                                        let _ = output.send(Engine::View(view)).await;
                                    }
                                }
                                _ => break,
                            },
                            Some(()) = asked.recv() => {
                                if let Some(stdin) = stdin.as_mut() {
                                    let _ = stdin.write_all(b"refresh\n").await;
                                    let _ = stdin.flush().await;
                                }
                            }
                        }
                    }
                    let _ = child.kill().await;
                    let _ = output
                        .send(Engine::Down("The usage reader stopped. Starting it again…".into()))
                        .await;
                }
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    })
}

/// The colour text has on the panel and in the popup.
fn ink(theme: &cosmic::Theme) -> Color {
    theme.cosmic().background(theme.transparent).on.into()
}

fn block(colour: Color) -> container::Style {
    container::Style {
        background: Some(Background::Color(colour)),
        border: Border {
            radius: 3.0.into(),
            ..Default::default()
        },
        ..Default::default()
    }
}

impl Headroom {
    /// Brings the panel button up to date, unless the popup is open.
    ///
    /// New numbers can change the button's width. If the button changes size under the pointer
    /// while its own popup is open, the panel takes that for the pointer moving on to another
    /// applet and opens that applet's menu instead (seen 2026-10-12: the power menu opened by
    /// itself). So the button holds what it showed when the popup opened; the popup itself always
    /// shows the latest reading, and the button catches up the moment the popup closes.
    fn settle_panel(&mut self) {
        if self.popup.is_none() {
            self.panel = Panel {
                bar: self.view.bar.clone(),
                demo: self.view.demo,
                down: self.down.is_some(),
            };
        }
    }

    /// A provider's mark, in the text colour.
    fn mark<'a>(&self, file: &str, size: u16) -> Element<'a, Message> {
        let path = self.data.join("assets").join(file.replace(".svg", "-symbolic.svg"));
        icon::icon(icon::from_path(path))
            .size(size)
            .class(theme::Svg::custom(|theme| svg::Style {
                color: Some(ink(theme)),
            }))
            .into()
    }

    /// The quota meter: a track with the filled share in the reading's colour. The same colours as
    /// the GNOME popup: red when critical, amber as a warning, otherwise the text colour (fainter
    /// when the reading is old).
    fn meter<'a>(quota: &Quota) -> Element<'a, Message> {
        const WHOLE: u16 = 1000;
        let filled = quota
            .fill
            .map_or(0, |f| (f.clamp(0.0, 1.0) * f32::from(WHOLE)).round() as u16);
        let critical = quota.severity == "critical";
        let warning = quota.severity == "warning";
        let dim = quota.dim;

        let mut bar = Row::new().width(Length::Fill).height(Length::Fixed(6.0));
        if filled > 0 {
            bar = bar.push(
                container(space::horizontal())
                    .width(Length::FillPortion(filled))
                    .height(Length::Fill)
                    .class(theme::Container::custom(move |theme| {
                        block(if critical {
                            Color::from_rgb(0.9, 0.24, 0.2)
                        } else if warning {
                            Color::from_rgb(0.77, 0.6, 0.09)
                        } else {
                            ink(theme).scale_alpha(if dim { 0.4 } else { 0.85 })
                        })
                    })),
            );
        }
        if filled < WHOLE {
            bar = bar.push(space::horizontal().width(Length::FillPortion(WHOLE - filled)));
        }
        container(bar)
            .width(Length::Fill)
            .class(theme::Container::custom(|theme| block(ink(theme).scale_alpha(0.16))))
            .into()
    }
}

impl cosmic::Application for Headroom {
    type Executor = cosmic::SingleThreadExecutor;
    type Flags = ();
    type Message = Message;
    const APP_ID: &'static str = "io.github.alexjpower74_create.Headroom";

    fn core(&self) -> &cosmic::app::Core {
        &self.core
    }

    fn core_mut(&mut self) -> &mut cosmic::app::Core {
        &mut self.core
    }

    fn init(core: cosmic::app::Core, _flags: ()) -> (Self, app::Task<Message>) {
        (
            Self {
                core,
                popup: None,
                view: View::default(),
                panel: Panel::default(),
                down: None,
                refresh: None,
                data: data_dir(),
            },
            Task::none(),
        )
    }

    fn on_close_requested(&self, id: window::Id) -> Option<Message> {
        Some(Message::Closed(id))
    }

    fn update(&mut self, message: Message) -> app::Task<Message> {
        match message {
            Message::TogglePopup => {
                if let Some(open) = self.popup.take() {
                    self.settle_panel();
                    return cosmic::surface::surface_task(cosmic::surface::action::destroy_popup(
                        open,
                    ));
                }
                return cosmic::surface::surface_task(cosmic::surface::action::app_popup(
                    |_| Default::default(),
                    |app: &mut Headroom| {
                        let id = window::Id::unique();
                        app.popup = Some(id);
                        app.core.applet.get_popup_settings(
                            app.core.main_window_id().unwrap(),
                            id,
                            None,
                            None,
                            None,
                        )
                    },
                    None,
                ));
            }
            Message::Closed(id) => {
                if self.popup == Some(id) {
                    self.popup = None;
                    self.settle_panel();
                }
            }
            Message::Refresh => {
                if let Some(ask) = &self.refresh {
                    let _ = ask.try_send(());
                }
            }
            Message::Engine(Engine::Ready(ask)) => self.refresh = Some(ask),
            Message::Engine(Engine::View(view)) => {
                self.view = view;
                self.down = None;
                self.settle_panel();
            }
            Message::Engine(Engine::Down(why)) => {
                self.down = Some(why);
                self.settle_panel();
            }
        }
        Task::none()
    }

    /// What sits in the panel: each provider's mark and its numbers.
    fn view(&self) -> Element<'_, Message> {
        let applet = &self.core.applet;
        let (_, height) = applet.suggested_size(true);
        let (pad_along, pad_across) = applet.suggested_padding(true);

        let mut content = Row::new().spacing(6).align_y(Alignment::Center);
        if self.panel.down {
            content = content.push(applet.text("Headroom !"));
        } else if self.panel.bar.is_empty() {
            content = content.push(applet.text("Headroom"));
        } else {
            for item in &self.panel.bar {
                content = content
                    .push(self.mark(&item.icon, height))
                    .push(applet.text(item.text.as_str()));
            }
            if self.panel.demo {
                content = content.push(applet.text("DEMO"));
            }
        }
        // Holds the button at the panel's height whatever the text's own height is.
        content = content.push(container(
            space::vertical().height(Length::Fixed(f32::from(height + 2 * pad_across))),
        ));

        let button = button::custom(content)
            .padding([0, pad_along])
            .on_press_down(Message::TogglePopup)
            .class(theme::Button::AppletIcon);
        applet.autosize_window(button).into()
    }

    /// The popup: every quota window with its meter, reset countdown and forecast.
    fn view_window(&self, id: window::Id) -> Element<'_, Message> {
        if self.popup != Some(id) {
            return text::body("").into();
        }
        let Spacing {
            space_xxs,
            space_xs,
            space_s,
            ..
        } = theme::active().cosmic().spacing;

        let mut content = Column::new().padding([8, 0]);
        if let Some(why) = &self.down {
            content = content.push(padded_control(text::body(why.as_str())));
        }
        for provider in &self.view.providers {
            let mut section = Column::new().spacing(space_xs).push(
                Row::new()
                    .spacing(space_xs)
                    .align_y(Alignment::Center)
                    .push(self.mark(&provider.icon, 18))
                    .push(text::heading(provider.name.as_str()))
                    .push(space::horizontal().width(Length::Fill))
                    .push(text::caption(provider.plan.as_str())),
            );
            if !provider.status.is_empty() {
                section = section.push(text::caption(provider.status.as_str()));
            }
            for quota in &provider.windows {
                section = section.push(
                    Column::new()
                        .spacing(space_xxs)
                        .push(
                            Row::new()
                                .align_y(Alignment::Center)
                                .push(text::body(quota.title.as_str()))
                                .push(space::horizontal().width(Length::Fill))
                                .push(text::caption(quota.warning.as_str())),
                        )
                        .push(Self::meter(quota))
                        .push(
                            Row::new()
                                .align_y(Alignment::Center)
                                .push(text::caption(quota.reset.as_str()))
                                .push(space::horizontal().width(Length::Fill))
                                .push(text::body(quota.value.as_str())),
                        ),
                );
            }
            content = content.push(padded_control(section));
        }
        if self.view.providers.is_empty() && self.down.is_none() {
            content = content.push(padded_control(text::body("No provider is turned on.")));
        }

        content = content
            .push(padded_control(divider::horizontal::default()).padding([space_xxs, space_s]))
            .push(padded_control(
                Row::new()
                    .align_y(Alignment::Center)
                    .push(
                        Column::new()
                            .push(text::heading("Headroom"))
                            .push(text::caption(self.view.footer.as_str())),
                    )
                    .push(space::horizontal().width(Length::Fill))
                    .push(
                        button::icon(icon::from_name("view-refresh-symbolic"))
                            .on_press(Message::Refresh),
                    ),
            ));

        self.core.applet.popup_container(content).into()
    }

    fn subscription(&self) -> Subscription<Message> {
        Subscription::run_with(self.data.clone(), |data| engine(data.clone())).map(Message::Engine)
    }

    fn style(&self) -> Option<iced::theme::Style> {
        Some(cosmic::applet::style())
    }
}
