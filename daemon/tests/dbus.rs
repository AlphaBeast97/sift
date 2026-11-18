// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use zbus::{Connection, Proxy};

const BUS_NAME: &str = "io.github.alphabeast97.Sift";
const OBJECT_PATH: &str = "/io/github/alphabeast97/Sift";
const INTERFACE: &str = "io.github.alphabeast97.Sift";

// Tests that use the shared session bus would fight over the daemon name.
static SHARED_BUS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct Daemon(Child);

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn_daemon(config: &Path, cache: &Path, extra: &[&str]) -> Daemon {
    let child = Command::new(env!("CARGO_BIN_EXE_siftd"))
        .arg("--config")
        .arg(config)
        .arg("--cache")
        .arg(cache)
        .args(extra)
        .stdin(Stdio::null())
        .spawn()
        .expect("spawn siftd");
    Daemon(child)
}

async fn wait_for_proxy() -> Proxy<'static> {
    wait_for_proxy_on(&Connection::session().await.unwrap()).await
}

async fn wait_for_proxy_on(connection: &Connection) -> Proxy<'static> {
    // CacheProperties::No: the test polls Status while it changes.
    let proxy = zbus::proxy::Builder::<Proxy<'static>>::new(connection)
        .destination(BUS_NAME)
        .path(OBJECT_PATH)
        .interface(INTERFACE)
        .cache_properties(zbus::proxy::CacheProperties::No)
        .build()
        .await
        .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);

    loop {
        if proxy.call::<_, _, String>("Ping", &()).await.is_ok() {
            return proxy;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "daemon did not appear on the bus"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_for_status(proxy: &Proxy<'_>, needle: &str) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

    loop {
        if let Ok(status) = proxy.get_property::<String>("Status").await
            && status.contains(needle)
        {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "status never contained {needle}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn wait_for_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;

    loop {
        if child.try_wait().unwrap().is_some() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[tokio::test]
async fn cold_start_query_reindex_quit_and_second_instance() {
    let _shared = SHARED_BUS.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    std::fs::create_dir_all(home.join("docs")).unwrap();
    std::fs::write(home.join("docs/report.pdf"), b"x").unwrap();
    let config = tmp.path().join("config.toml");
    std::fs::write(&config, format!("roots = [\"{}\"]\n", home.display())).unwrap();
    let cache = tmp.path().join("cache.bin");

    let mut child = spawn_daemon(&config, &cache, &["--scan-delay-ms", "1000"]);
    let proxy = wait_for_proxy().await;
    wait_for_status(&proxy, "\"state\":\"indexing\"").await;

    let ping: String = proxy.call("Ping", &()).await.unwrap();
    assert!(ping.starts_with("0.1.0"));

    let config_json: String = proxy.get_property("Config").await.unwrap();
    assert!(config_json.contains("\"max_entries\":250000"));

    let cold: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
    assert!(
        cold.contains("\"files\":[]"),
        "cold start answers without a cache"
    );

    let invalid = proxy
        .call::<_, _, String>("Query", &("x".repeat(129), 10u32))
        .await;
    assert!(invalid.is_err(), "over-long queries are rejected");
    let bad_limit = proxy.call::<_, _, String>("Query", &("report", 0u32)).await;
    assert!(bad_limit.is_err(), "limit 0 is rejected");

    wait_for_status(&proxy, "\"state\":\"ready\"").await;
    let warm: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
    assert!(warm.contains("report.pdf"));
    assert!(cache.exists(), "ready scan writes the cache");
    let json: serde_json::Value = serde_json::from_str(&warm).unwrap();
    assert!(json["files"].is_array(), "files is an array");
    assert!(json.get("calc").is_none(), "calc is omitted when absent");
    let _: () = proxy.call("EnsureFresh", &()).await.unwrap();

    let mut second = spawn_daemon(&config, &cache, &[]);
    assert!(
        wait_for_exit(&mut second.0, Duration::from_secs(2)).await,
        "second instance exits when the bus name is taken"
    );

    std::fs::write(&config, "roots = []\n").unwrap();
    let _: () = proxy.call("Reindex", &()).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let reply: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
        if reply.contains("\"files\":[]") {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "reindex never emptied the index"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _: () = proxy.call("Quit", &()).await.unwrap();
    assert!(
        wait_for_exit(&mut child.0, Duration::from_secs(2)).await,
        "Quit exits"
    );
}

#[tokio::test]
async fn reindex_during_a_scan_runs_after_it() {
    let _shared = SHARED_BUS.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    std::fs::create_dir_all(home.join("docs")).unwrap();
    std::fs::write(home.join("docs/report.pdf"), b"x").unwrap();
    let config = tmp.path().join("config.toml");
    std::fs::write(&config, "roots = []\n").unwrap();
    let cache = tmp.path().join("cache.bin");

    let mut child = spawn_daemon(&config, &cache, &["--scan-delay-ms", "1500"]);
    let proxy = wait_for_proxy().await;
    wait_for_status(&proxy, "\"state\":\"indexing\"").await;

    // Point the config at real data and ask for a reindex while the startup
    // scan is still running: it must run after that scan, not be dropped.
    std::fs::write(&config, format!("roots = [\"{}\"]\n", home.display())).unwrap();
    let _: () = proxy.call("Reindex", &()).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    loop {
        let reply: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
        if reply.contains("report.pdf") {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the queued reindex never indexed the report"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _: () = proxy.call("Quit", &()).await.unwrap();
    assert!(
        wait_for_exit(&mut child.0, Duration::from_secs(2)).await,
        "Quit exits after the queued reindex"
    );
}

#[tokio::test]
async fn warm_cache_answers_while_a_rebuild_scans() {
    let _shared = SHARED_BUS.lock().await;
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    std::fs::create_dir_all(home.join("docs")).unwrap();
    std::fs::write(home.join("docs/report.pdf"), b"x").unwrap();
    let config = tmp.path().join("config.toml");
    std::fs::write(&config, format!("roots = [\"{}\"]\n", home.display())).unwrap();
    let cache = tmp.path().join("cache.bin");

    let mut first = spawn_daemon(&config, &cache, &[]);
    let proxy = wait_for_proxy().await;
    wait_for_status(&proxy, "\"state\":\"ready\"").await;
    let _: () = proxy.call("Quit", &()).await.unwrap();
    assert!(wait_for_exit(&mut first.0, Duration::from_secs(2)).await);

    let mut second = spawn_daemon(&config, &cache, &["--scan-delay-ms", "1000"]);
    let proxy = wait_for_proxy().await;
    wait_for_status(&proxy, "\"state\":\"indexing\"").await;
    let warm: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
    assert!(
        warm.contains("report.pdf"),
        "the cached snapshot answers while the rebuild scans"
    );

    let _: () = proxy.call("Quit", &()).await.unwrap();
    assert!(wait_for_exit(&mut second.0, Duration::from_secs(2)).await);
}

#[tokio::test]
async fn daemon_exits_when_its_session_bus_closes() {
    let tmp = tempfile::tempdir().unwrap();
    let config = tmp.path().join("config.toml");
    std::fs::write(&config, "roots = []\n").unwrap();
    let cache = tmp.path().join("cache.bin");

    let output = Command::new("dbus-daemon")
        .args(["--session", "--fork", "--print-address=1", "--print-pid=1"])
        .output()
        .expect("start dbus-daemon");
    assert!(output.status.success(), "dbus-daemon failed");

    let stdout = String::from_utf8(output.stdout).unwrap();
    let mut lines = stdout.lines();
    let address = lines.next().expect("bus address").trim().to_owned();
    let bus_pid = lines.next().expect("bus pid").trim().to_owned();

    let mut daemon = Daemon(
        Command::new(env!("CARGO_BIN_EXE_siftd"))
            .arg("--config")
            .arg(&config)
            .arg("--cache")
            .arg(&cache)
            .env("DBUS_SESSION_BUS_ADDRESS", &address)
            .stdin(Stdio::null())
            .spawn()
            .expect("spawn siftd"),
    );

    let connection = zbus::connection::Builder::address(address.as_str())
        .build()
        .await
        .unwrap();
    let _proxy = wait_for_proxy_on(&connection).await;

    // Tear down only this private bus; the shared test bus stays up.
    let _ = Command::new("kill").arg(&bus_pid).status();
    assert!(
        wait_for_exit(&mut daemon.0, Duration::from_secs(3)).await,
        "daemon exits when its session bus closes"
    );
}
