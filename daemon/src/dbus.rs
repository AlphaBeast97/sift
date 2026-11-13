// SPDX-License-Identifier: GPL-3.0-or-later
use std::fmt;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};
use zbus::fdo;
use zbus::object_server::SignalEmitter;

use crate::config::Config;
use crate::index::{EntryKind, Index};
use crate::status::StatusModel;

pub const BUS_NAME: &str = "io.github.alphabeast97.Sift";
pub const OBJECT_PATH: &str = "/io/github/alphabeast97/Sift";
pub const INTERFACE: &str = "io.github.alphabeast97.Sift";

pub enum Command {
    Reindex,
    EnsureFresh,
    Quit(oneshot::Sender<()>),
}

impl fmt::Debug for Command {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Reindex => "Reindex",
            Self::EnsureFresh => "EnsureFresh",
            Self::Quit(_) => "Quit",
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueryError {
    TooLong,
    InvalidLimit,
}

impl fmt::Display for QueryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::TooLong => "query exceeds 128 bytes",
            Self::InvalidLimit => "limit must be between 1 and 50",
        })
    }
}

impl std::error::Error for QueryError {}

pub fn validate_query(text: &str, limit: u32) -> Result<(), QueryError> {
    if text.len() > 128 {
        return Err(QueryError::TooLong);
    }
    if !(1..=50).contains(&limit) {
        return Err(QueryError::InvalidLimit);
    }
    Ok(())
}

pub fn version() -> String {
    format!(
        "{}+{}",
        env!("CARGO_PKG_VERSION"),
        option_env!("SIFT_GIT_HASH").unwrap_or("unknown")
    )
}

pub struct SiftService {
    index: Arc<Index>,
    status: Arc<StatusModel>,
    config: Arc<RwLock<Config>>,
    commands: mpsc::UnboundedSender<Command>,
}

impl SiftService {
    pub fn new(
        index: Arc<Index>,
        status: Arc<StatusModel>,
        config: Arc<RwLock<Config>>,
        commands: mpsc::UnboundedSender<Command>,
    ) -> Self {
        Self {
            index,
            status,
            config,
            commands,
        }
    }
}

#[zbus::interface(name = "io.github.alphabeast97.Sift")]
impl SiftService {
    fn ping(&self) -> String {
        version()
    }

    fn query(&self, text: String, limit: u32) -> fdo::Result<String> {
        validate_query(&text, limit).map_err(|error| fdo::Error::InvalidArgs(error.to_string()))?;

        let text = text.trim();
        if text.is_empty() {
            return Ok(serde_json::json!({"files": []}).to_string());
        }

        let matches = {
            let state = self.index.read();
            crate::query::query(&state.entries, text, limit as usize)
        };

        let files: Vec<_> = matches
            .iter()
            .map(|matched| {
                serde_json::json!({
                    "path": matched.path.to_string_lossy(),
                    "name": matched.name,
                    "kind": match matched.kind {
                        EntryKind::File => "file",
                        EntryKind::Dir => "dir",
                    },
                })
            })
            .collect();

        let mut value = serde_json::json!({"files": files});
        if let Some(calc) = crate::calc::evaluate(text, Duration::from_millis(25)) {
            value["calc"] = serde_json::json!({
                "expression": calc.expression,
                "result": calc.result,
            });
        }

        Ok(value.to_string())
    }

    fn reindex(&self) {
        let _ = self.commands.send(Command::Reindex);
    }

    fn ensure_fresh(&self) {
        let _ = self.commands.send(Command::EnsureFresh);
    }

    async fn quit(&self) -> fdo::Result<()> {
        let (sender, receiver) = oneshot::channel();
        if self.commands.send(Command::Quit(sender)).is_err() {
            return Ok(());
        }

        let _ = tokio::time::timeout(Duration::from_secs(2), receiver).await;
        Ok(())
    }

    #[zbus(property, name = "Status")]
    fn status_json(&self) -> String {
        self.status.to_json()
    }

    #[zbus(signal, name = "StatusChanged")]
    pub async fn emit_status_changed(
        emitter: SignalEmitter<'_>,
        status: String,
    ) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_validation() {
        assert!(validate_query(&"x".repeat(129), 10).is_err());
        assert!(validate_query(&"x".repeat(128), 10).is_ok());
        assert!(validate_query("x", 0).is_err());
        assert!(validate_query("x", 51).is_err());
        assert!(validate_query("x", 10).is_ok());
    }

    #[test]
    fn query_returns_files_and_calculator_json() {
        let index = Arc::new(Index::new(
            vec![crate::index::Entry {
                path: "/home/alice/report.pdf".into(),
                name_lower: "report.pdf".to_owned(),
                kind: EntryKind::File,
            }],
            false,
        ));
        let status = StatusModel::new(vec!["/home/alice".to_owned()]);
        let config = Arc::new(RwLock::new(crate::config::default_config(
            std::path::Path::new("/home/alice"),
        )));
        let (commands, _receiver) = mpsc::unbounded_channel();
        let service = SiftService::new(index, status, config, commands);

        let files: serde_json::Value =
            serde_json::from_str(&service.query("report".to_owned(), 10).unwrap()).unwrap();
        assert_eq!(files["files"][0]["name"], "report.pdf");
        assert_eq!(files["files"][0]["kind"], "file");
        assert!(files.get("calc").is_none());

        let calc: serde_json::Value =
            serde_json::from_str(&service.query("= 3*7".to_owned(), 10).unwrap()).unwrap();
        assert_eq!(calc["files"].as_array().unwrap().len(), 0);
        assert_eq!(calc["calc"]["result"], "21");
    }
}
