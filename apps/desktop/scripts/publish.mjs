#!/usr/bin/env node
/**
 * 发布脚本：构建带签名的更新包 + 生成 latest.json。
 * 自动识别当前平台（mac arm64 / windows x86_64）。
 *
 * 用法：node scripts/publish.mjs
 * 产物在 apps/desktop/dist-publish/，手动上传到 Cloudflare R2（update.mp4web.com）。
 *   - latest.json 会「合并」已有条目（mac 跑补 darwin，win 跑补 windows）。
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const srcTauri = resolve(desktop, "src-tauri");
const outDir = resolve(desktop, "dist-publish");
mkdirSync(outDir, { recursive: true });

const conf = JSON.parse(readFileSync(resolve(srcTauri, "tauri.conf.json"), "utf8"));
const version = conf.version;
const productName = conf.productName;

// 平台信息
const platform = process.platform; // darwin | win32
const isMac = platform === "darwin";
const platformKey = isMac ? "darwin-aarch64" : "windows-x86_64";
const archTag = isMac ? "aarch64" : "x64";

// 私钥
const keyPath = resolve(srcTauri, ".updater-key");
if (!existsSync(keyPath)) {
  console.error(`✗ 找不到签名私钥：${keyPath}`);
  console.error("  先跑：pnpm tauri signer generate --password '' -w src-tauri/.updater-key");
  process.exit(1);
}
const privateKey = readFileSync(keyPath, "utf8").trim();

// 带 key 构建
console.log(`[publish] 构建 v${version}（${platformKey}，带签名）…`);
execSync("pnpm tauri build", {
  cwd: desktop,
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});

// 定位 updater 产物（mac: .app.tar.gz+.sig；win: nsis -setup.exe+.sig）
const bundleRoot = resolve(srcTauri, "target/release/bundle");
let updateArtifactName; // 产物文件名（含版本）
let updateArtifactPath; // 源文件绝对路径
let sigPath;
let dmgName = null;

if (isMac) {
  const macosBundle = resolve(bundleRoot, "macos");
  updateArtifactPath = resolve(macosBundle, `${productName}.app.tar.gz`);
  sigPath = `${updateArtifactPath}.sig`;
  updateArtifactName = `${productName}_${version}_${archTag}.app.tar.gz`;
  const dmgSrc = resolve(bundleRoot, "dmg", `${productName}_${version}_${archTag}.dmg`);
  if (existsSync(dmgSrc)) {
    dmgName = `${productName}_${version}_${archTag}.dmg`;
    copyFileSync(dmgSrc, resolve(outDir, dmgName));
  }
} else {
  // Windows：找 nsis 产物 -setup.exe + .sig
  const nsisBundle = resolve(bundleRoot, "nsis");
  const files = existsSync(nsisBundle) ? readdirSync(nsisBundle) : [];
  const setup = files.find((f) => f.endsWith("-setup.exe"));
  if (!setup) {
    console.error("✗ 没找到 Windows nsis setup.exe（确认 updater 已配置 + 用 nsis target）");
    process.exit(1);
  }
  updateArtifactPath = resolve(nsisBundle, setup);
  sigPath = `${updateArtifactPath}.sig`;
  updateArtifactName = `${productName}_${version}_${archTag}-setup.exe`;
}

if (!existsSync(updateArtifactPath) || !existsSync(sigPath)) {
  console.error(`✗ 没找到更新包或签名：${updateArtifactPath}`);
  process.exit(1);
}

// 拷贝版本化产物
copyFileSync(updateArtifactPath, resolve(outDir, updateArtifactName));

// latest.json：合并已有条目（同一份 latest.json 服务多平台）
const latestPath = resolve(outDir, "latest.json");
let latest = {};
if (existsSync(latestPath)) {
  try {
    latest = JSON.parse(readFileSync(latestPath, "utf8"));
  } catch {
    /* 忽略，重建 */
  }
}
const signature = readFileSync(sigPath, "utf8").trim();
latest.version = version;
latest.notes = latest.notes || `mp4WEB ${version}`;
latest.pub_date = new Date().toISOString();
latest.platforms = latest.platforms || {};
latest.platforms[platformKey] = {
  signature,
  url: `https://update.mp4web.com/${updateArtifactName}`,
};
writeFileSync(latestPath, JSON.stringify(latest, null, 2) + "\n", "utf8");

console.log(`\n✓ 发布产物（v${version} / ${platformKey}）已生成在 apps/desktop/dist-publish/`);
console.log(`  上传到 Cloudflare R2（update.mp4web.com 根目录）：`);
console.log(`    • ${updateArtifactName}`);
console.log(`    • latest.json`);
if (dmgName) console.log(`    • ${dmgName}  （mac 新用户用）`);
