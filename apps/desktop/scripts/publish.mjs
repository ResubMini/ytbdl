#!/usr/bin/env node
/**
 * 发布脚本：构建带签名的更新包 + 生成 latest.json。
 *
 * 用法：node scripts/publish.mjs
 * 产物在 apps/desktop/dist-publish/，手动上传到 Cloudflare R2（update.mp4web.com）：
 *   - mp4WEB_<version>_aarch64.app.tar.gz   （更新包）
 *   - latest.json                            （版本清单）
 *   - mp4WEB_<version>_aarch64.dmg           （可选，给新用户全新安装）
 *
 * 需要：src-tauri/.updater-key（签名私钥，gitignored）。
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..");
const srcTauri = resolve(desktop, "src-tauri");

const conf = JSON.parse(readFileSync(resolve(srcTauri, "tauri.conf.json"), "utf8"));
const version = conf.version;
const productName = conf.productName;

// 读签名私钥
const keyPath = resolve(srcTauri, ".updater-key");
if (!existsSync(keyPath)) {
  console.error(`✗ 找不到签名私钥：${keyPath}`);
  console.error("  先跑：pnpm tauri signer generate --password '' -w src-tauri/.updater-key");
  process.exit(1);
}
const privateKey = readFileSync(keyPath, "utf8").trim();

// 带 key 构建（生成 .app.tar.gz + .sig）
console.log(`[publish] 构建 v${version}（带签名）…`);
execSync("pnpm tauri build", {
  cwd: desktop,
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});

// 定位产物
const macosBundle = resolve(srcTauri, "target/release/bundle/macos");
const dmgBundle = resolve(srcTauri, "target/release/bundle/dmg");
const tarGz = resolve(macosBundle, `${productName}.app.tar.gz`);
const sig = resolve(macosBundle, `${productName}.app.tar.gz.sig`);
if (!existsSync(tarGz) || !existsSync(sig)) {
  console.error(`✗ 没找到更新包：${tarGz}（确认 updater 插件与私钥已配置）`);
  process.exit(1);
}

// 输出目录（版本化命名，方便 CDN 上多版本共存）
const outDir = resolve(desktop, "dist-publish");
mkdirSync(outDir, { recursive: true });
const tarName = `${productName}_${version}_aarch64.app.tar.gz`;
copyFileSync(tarGz, resolve(outDir, tarName));

// 可选：带版本号的 dmg（新用户用）
let dmgName = null;
const dmgSrc = resolve(dmgBundle, `${productName}_${version}_aarch64.dmg`);
if (existsSync(dmgSrc)) {
  dmgName = `${productName}_${version}_aarch64.dmg`;
  copyFileSync(dmgSrc, resolve(outDir, dmgName));
}

// latest.json
const signature = readFileSync(sig, "utf8").trim();
const latest = {
  version,
  notes: `mp4WEB ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature,
      url: `https://update.mp4web.com/${tarName}`,
    },
  },
};
writeFileSync(resolve(outDir, "latest.json"), JSON.stringify(latest, null, 2) + "\n", "utf8");

console.log(`\n✓ 发布产物（v${version}）已生成在 apps/desktop/dist-publish/`);
console.log(`  上传到 Cloudflare R2（绑定 update.mp4web.com 根目录）：`);
console.log(`    • ${tarName}`);
console.log(`    • latest.json`);
if (dmgName) console.log(`    • ${dmgName}  （可选，给新用户）`);
