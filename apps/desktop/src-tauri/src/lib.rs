// 桌面外壳核心职责：
// 1. 拉起并守护 sidecar（随机端口 + token）
// 2. 把 {baseUrl, token} 注入前端（initialization_script，React 加载前生效）
// 3. 应用退出时清理 sidecar 子进程

#[cfg(not(debug_assertions))]
use std::fs::{create_dir_all, OpenOptions};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(not(debug_assertions))]
use tauri::Manager;
use tauri::{RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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
    let bin = resolve_resource(resource_dir, "mp4web-sidecar")
        .unwrap_or_else(|| resource_dir.join("mp4web-sidecar"));
    Command::new(bin)
}

/// 跨平台定位打包资源：兼容 root / resources/ 子目录、带不带 .exe。
#[cfg(not(debug_assertions))]
fn resolve_resource(resource_dir: &PathBuf, name: &str) -> Option<PathBuf> {
    let mut candidates = vec![
        resource_dir.join(name),
        resource_dir.join("resources").join(name),
    ];
    if cfg!(windows) {
        candidates.push(resource_dir.join(format!("{name}.exe")));
        candidates.push(resource_dir.join("resources").join(format!("{name}.exe")));
    }
    candidates.into_iter().find(|p| p.exists())
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            // ── 解析资源路径（release 用打包的 sidecar + ffmpeg）──
            #[cfg(not(debug_assertions))]
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
                if let Some(ffmpeg) = resolve_resource(&resource_dir, "ffmpeg") {
                    cmd.env("SIDECAR_FFMPEG", &ffmpeg);
                }
                if let Some(deno) = resolve_resource(&resource_dir, "deno") {
                    cmd.env("SIDECAR_DENO", &deno);
                }
                if let Ok(data_dir) = app.path().app_data_dir() {
                    cmd.env("SIDECAR_DATA_DIR", &data_dir);
                    let _ = create_dir_all(&data_dir);
                    if let Ok(log) = OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(data_dir.join("sidecar.log"))
                    {
                        if let Ok(stderr) = log.try_clone() {
                            cmd.stdout(Stdio::from(log));
                            cmd.stderr(Stdio::from(stderr));
                        }
                    }
                }

                #[cfg(windows)]
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }

            #[cfg(debug_assertions)]
            {
            cmd.stdout(Stdio::inherit());
            cmd.stderr(Stdio::inherit());
            }

            match cmd.spawn() {
                Ok(c) => {
                    *child.lock().unwrap() = Some(c);
                    println!(
                        "[mp4WEB] sidecar 后台启动中：http://127.0.0.1:{}",
                        port
                    );
                }
                Err(e) => {
                    eprintln!("[mp4WEB] 启动 sidecar 失败：{e}");
                }
            }
            // 不在这里 wait_ready：窗口立即打开显示启动画面，
            // 由前端 splash 轮询 health 直到 sidecar 就绪。

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
