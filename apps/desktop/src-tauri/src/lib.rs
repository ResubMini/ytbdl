// 桌面外壳核心职责：
// 1. 拉起并守护 sidecar（随机端口 + token）
// 2. 把 {baseUrl, token} 注入前端（initialization_script，React 加载前生效）
// 3. 应用退出时清理 sidecar 子进程

use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("bind free port")
        .local_addr()
        .unwrap()
        .port()
}

fn gen_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // 本地进程间鉴权，非密码学强度；唯一即可
    format!("s{:x}{:x}", nanos, std::process::id())
}

/// dev：用 backend venv 的 python 跑 app 模块。
#[cfg(debug_assertions)]
fn dev_sidecar_command() -> Command {
    // CARGO_MANIFEST_DIR = apps/desktop/src-tauri → ../../backend = apps/backend
    let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../backend");
    let python = backend_dir.join(".venv/bin/python");
    let mut cmd = Command::new(python);
    cmd.current_dir(&backend_dir);
    cmd.args(["-m", "app.main"]);
    cmd
}

/// release：用随包分发的 PyInstaller 二进制（位于 Resources）。
#[cfg(not(debug_assertions))]
fn release_sidecar_command(resource_dir: &PathBuf) -> Command {
    let bin = resource_dir.join("mp4web-sidecar");
    Command::new(bin)
}

fn wait_ready(port: u16) {
    let addr: std::net::SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    eprintln!("[mp4WEB] 警告：sidecar 60s 内未就绪 (port {})", port);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = free_port();
    let token = gen_token();

    let child: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

    let child_for_close = child.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| {
            // ── 解析资源路径（release 用打包的 sidecar + ffmpeg）──
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("resource dir");

            #[cfg(debug_assertions)]
            let mut cmd = dev_sidecar_command();
            #[cfg(not(debug_assertions))]
            let mut cmd = release_sidecar_command(&resource_dir);

            cmd.env("SIDECAR_HOST", "127.0.0.1");
            cmd.env("SIDECAR_PORT", port.to_string());
            cmd.env("SIDECAR_TOKEN", &token);

            // release：指向打包的 ffmpeg + 用户数据目录（可写）
            #[cfg(not(debug_assertions))]
            {
                let ffmpeg = resource_dir.join("ffmpeg");
                if ffmpeg.exists() {
                    cmd.env("SIDECAR_FFMPEG", &ffmpeg);
                }
                if let Ok(data_dir) = app.path().app_data_dir() {
                    cmd.env("SIDECAR_DATA_DIR", &data_dir);
                }
            }
            cmd.stdout(Stdio::inherit());
            cmd.stderr(Stdio::inherit());

            match cmd.spawn() {
                Ok(c) => {
                    *child.lock().unwrap() = Some(c);
                    println!(
                        "[mp4WEB] sidecar 已启动：http://127.0.0.1:{} （等待就绪…）",
                        port
                    );
                }
                Err(e) => {
                    eprintln!("[mp4WEB] 启动 sidecar 失败：{e}");
                }
            }
            wait_ready(port);

            // 注入到前端：在 React 任何代码加载前执行，无竞态
            let init_script = format!(
                "window.__SIDECAR__ = Object.freeze({{ baseUrl: 'http://127.0.0.1:{port}', token: '{token}' }});",
                port = port,
                token = token,
            );

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("mp4WEB")
                .inner_size(1040.0, 720.0)
                .min_inner_size(720.0, 520.0)
                .initialization_script(&init_script)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(mut c) = child_for_close.lock().unwrap().take() {
                    let _ = c.kill();
                    let _ = c.wait();
                    println!("[mp4WEB] sidecar 已停止");
                }
            }
        });
}
