// SPDX-License-Identifier: GPL-3.0-or-later
use std::sync::{Arc, RwLock};

use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Status {
    pub state: String,
    pub indexed: usize,
    pub roots: Vec<String>,
    pub truncated: bool,
    pub watcher: String,
    pub last_reconcile: u64,
}

pub struct StatusModel {
    status: RwLock<Status>,
    sender: broadcast::Sender<String>,
}

impl StatusModel {
    pub fn new(roots: Vec<String>) -> Arc<Self> {
        let (sender, _) = broadcast::channel(16);
        Arc::new(Self {
            status: RwLock::new(Status {
                state: "starting".to_owned(),
                indexed: 0,
                roots,
                truncated: false,
                watcher: "ok".to_owned(),
                last_reconcile: 0,
            }),
            sender,
        })
    }

    pub fn snapshot(&self) -> Status {
        self.status.read().unwrap().clone()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.snapshot()).expect("status serializes")
    }

    pub fn update(&self, update: impl FnOnce(&mut Status)) -> bool {
        let mut status = self.status.write().unwrap();
        let before = serde_json::to_string(&*status).expect("status serializes");
        update(&mut status);
        let after = serde_json::to_string(&*status).expect("status serializes");

        if before == after {
            return false;
        }

        let _ = self.sender.send(after);
        true
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.sender.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_json_shape() {
        let model = StatusModel::new(vec!["/home/alice".to_owned()]);
        let json: serde_json::Value = serde_json::from_str(&model.to_json()).unwrap();

        assert_eq!(json["state"], "starting");
        assert_eq!(json["indexed"], 0);
        assert_eq!(json["roots"][0], "/home/alice");
        assert_eq!(json["truncated"], false);
        assert_eq!(json["watcher"], "ok");
        assert_eq!(json["last_reconcile"], 0);
    }

    #[test]
    fn update_reports_change() {
        let model = StatusModel::new(Vec::new());
        assert!(model.update(|status| status.state = "indexing".to_owned()));
        assert!(!model.update(|status| status.state = "indexing".to_owned()));
    }
}
