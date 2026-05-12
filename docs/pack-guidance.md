# AionUi 跨平台打包开发说明

## 1. 先说结论

这个项目要做到 `Windows / macOS / Linux` 三端打包，不是靠“一台机器一次性全平台出包”，而是靠下面这套组合：

- 一套业务代码：`Electron + React + electron-vite`
- 一套统一打包配置：`electron-builder.yml`
- 一套统一构建入口：`scripts/build-with-builder.js`
- 三类原生构建环境：`Windows runner`、`macOS runner`、`Linux runner`
- 按架构分开出包：`x64`、`arm64`

也就是说，这个仓库的真实方案是：

`同一代码库` + `分平台原生 runner` + `分架构单独产物`

这才是当前项目里真正稳定、可落地的“三端打包开发”方式。

## 2. 这个仓库已经具备哪些基础

从仓库现状看，AionUi 已经不是“还没设计打包”的状态，而是已经具备了完整的跨平台打包骨架：

- `package.json`
  - 开发入口：`bun run start`
  - 打包入口：`dist:mac`、`dist:win`、`dist:linux`
  - 分架构入口：`build-mac:x64`、`build-mac:arm64`、`build-win:x64`、`build-win:arm64`
- `electron-builder.yml`
  - Windows 目标：`nsis`、`zip`
  - macOS 目标：`dmg`、`zip`
  - Linux 目标：`deb`
  - 已配置图标、产物命名、`extraResources`、`asarUnpack`
- `scripts/build-with-builder.js`
  - 负责 `electron-vite build`
  - 负责调用 `electron-builder`
  - 带增量构建、DMG 重试、Windows 本地重试逻辑
- `scripts/rebuildNativeModules.js` + `scripts/afterPack.js`
  - 处理 `better-sqlite3` 这类原生模块的重编译与验证
  - 这是跨平台打包最关键的一层
- `.github/workflows/build-and-release.yml`
  - 已经把构建矩阵拆成：
    - `macos-arm64`
    - `macos-x64`
    - `windows-x64`
    - `windows-arm64`
    - `linux`

所以如果你要对外说明“这个项目为什么能做三端打包”，答案不是抽象概念，而是：

1. 用 Electron 统一桌面应用运行时。
2. 用 `electron-vite` 统一前端与主进程构建。
3. 用 `electron-builder` 统一平台打包。
4. 用原生 runner 解决不同操作系统的签名、依赖、原生模块和安装包格式问题。

## 3. 推荐的打包理解方式

### 3.1 平台维度

这里的“三端”建议明确写成：

- Windows
- macOS
- Linux

### 3.2 架构维度

这里的“x64 等”建议明确写成：

- `x64`
- `arm64`

平台和架构是两层概念，不要混在一起说。比较准确的表述是：

- Windows：`x64`、`arm64`
- macOS：`x64`、`arm64`
- Linux：理论配置支持 `x64`、`arm64`，但当前默认命令还需要补齐

## 4. 这个项目现在应该怎样打包

### 4.1 本地开发

日常开发只需要跑当前平台：

```bash
bun install
bun run start
```

如果想先做构建前检查，可以用：

```bash
just preflight
```

它会检查：

- Node.js
- Bun
- Python
- `node_modules`
- `better-sqlite3`
- Electron 版本

### 4.2 本地打包命令

建议按“单平台、单架构”分别执行，而不是混着打。

| 目标 | 推荐命令 | 产物 |
| --- | --- | --- |
| macOS arm64 | `bun run build-mac:arm64` | `.dmg` + `.zip` |
| macOS x64 | `bun run build-mac:x64` | `.dmg` + `.zip` |
| Windows x64 | `bun run build-win:x64` | `.exe` + `.zip` |
| Windows arm64 | `bun run build-win:arm64` | `.exe` + `.zip` |
| Linux x64 | `bun run dist:linux` | `.deb` |

如果你更习惯 `just`：

- `just build-mac-arm64`
- `just build-mac-x64`
- `just build-win-x64`
- `just build-win-arm64`
- `just build-linux`

补一句实践建议：

- 当前仓库更适合“本地打当前宿主机架构”
- 如果你是在 `arm64` 机器上打 `x64`，或在 `x64` 机器上打 `arm64`，更建议走 CI 的单架构 job，而不是把本地跨架构构建当成正式发布主路径

### 4.3 CI/CD 的推荐出包方式

正式发布不要依赖开发者本机混打，应该沿用仓库现有思路：

- `macOS runner` 负责 mac 包
- `windows-2022 runner` 负责 Windows 包
- `ubuntu-latest runner` 负责 Linux 包
- 每个 job 只出一个平台/架构组合

这就是当前 `.github/workflows/build-and-release.yml` 已经采用的模式。

## 5. 各平台的关键前置条件

### 5.1 通用前置条件

- Node.js：`>=22 <25`
- Bun：仓库当前默认工具链
- Python 3：原生模块编译需要
- 网络：打包阶段会额外准备运行时资源，不是完全离线

### 5.2 Windows

Windows 打包的核心前置条件是 C++ 工具链和 SDK。

至少要有：

- Visual Studio 2022 Build Tools
- MSBuild
- Windows SDK

仓库里的 CI 还专门为 ARM64 安装了：

- `Microsoft.VisualStudio.Component.VC.Tools.ARM64`
- `Microsoft.VisualStudio.Component.Windows11SDK.22000`

另外，原生模块 `better-sqlite3` 会在打包过程中做重建和验证。

### 5.3 macOS

macOS 打包除了构建，还涉及签名和公证。

当前仓库已经支持：

- `afterSign.js` 做公证
- `entitlements.plist` 控制签名权限
- CI 中临时导入证书

如果没有签名材料，项目也能出未签名包，但：

- 用户首次打开时可能遇到 Gatekeeper 提示
- 这不适合作为正式分发方案

需要关注的环境变量/Secrets 包括：

- `BUILD_CERTIFICATE_BASE64`
- `P12_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `appleId`
- `appleIdPassword`
- `teamId`

### 5.4 Linux

Linux 打包主要是系统依赖完整性问题。仓库 CI 里实际安装了：

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential python3 python3-pip pkg-config libsqlite3-dev \
  fakeroot dpkg-dev rpm libnss3-dev libatk-bridge2.0-dev libdrm2 \
  libxkbcommon-dev libxss1 libatspi2.0-dev libgtk-3-dev \
  libxrandr2 libasound2-dev
```

如果这些依赖不齐，Linux 包很容易卡在 Electron 运行时依赖或原生模块阶段。

## 6. 为什么这个项目能支撑三端打包

真正的关键不是“Electron 能跨平台”，而是这个仓库已经把几个难点都补上了：

### 6.1 原生模块处理

Electron 项目跨平台最常见的问题，是 `better-sqlite3` 这种原生模块和 Electron ABI 不匹配。

这个仓库已经用：

- `scripts/rebuildNativeModules.js`
- `scripts/afterPack.js`

把这件事做成了统一流程，而不是人工处理。

### 6.2 平台目标已经写进配置

`electron-builder.yml` 已经定义好了：

- Windows：`nsis`、`zip`
- macOS：`dmg`、`zip`
- Linux：`deb`

所以平台差异不是散落在脚本里，而是集中在打包配置里。

### 6.3 CI 已经按平台拆分

仓库没有走“单 Job 试图一把梭”的路线，而是直接拆分成构建矩阵。这是正确的做法，因为：

- macOS 要签名/公证
- Windows 依赖 MSVC 和 SDK
- Linux 依赖系统包和 `deb` 产物环境

## 7. 当前现状里的几个限制

这部分建议你在说明里也写出来，因为它们会影响“能做到什么程度”。

### 7.1 这不是严格意义上的单机跨 OS 混打

当前仓库更接近：

- 一套代码
- 三套原生构建环境
- 同一套发布流程

也就是“统一工程，多平台原生出包”，而不是“在一台机器上无差别打完所有系统包”。

### 7.2 Linux 的 `arm64` 默认入口还没补齐

`electron-builder.yml` 里 Linux 写了：

```yaml
arch: [x64, arm64]
```

但当前默认脚本：

- `dist:linux`
- `build-deb`

实际走的是：

```bash
node scripts/build-with-builder.js auto --linux
```

`build-with-builder.js` 在 `auto --linux` 模式下会取第一个架构，因此现状更接近“默认只打 Linux x64”。

如果要把 Linux `arm64` 真正补全，建议新增显式脚本，例如：

```bash
node scripts/build-with-builder.js arm64 --linux --arm64
```

并在 `package.json` 里补上类似：

- `build-linux:x64`
- `build-linux:arm64`

### 7.3 本地跨架构出包不适合作为正式发布主路径

仓库里有：

```bash
bun run build-mac
```

它会传 `--arm64 --x64`，但当前更稳妥的发布方式仍然是“单架构单 job”。即使不是一次混打，而只是本地在宿主机上跨架构出包，也要谨慎。

原因有两个：

- `prepareBundledBun.js` 现在按 `process.arch` 准备 `bundled-bun`
- `prepareAionrs.js` 只有在显式传入目标架构环境变量时，才不会退回宿主机架构

因此：

- 同一台 `arm64` 机器打 `x64` 包时
- 或同一台机器一次混打多个架构时
- 附带资源可能不是严格按目标架构分别准备

这不一定会导致包直接失败，但不适合作为“正式发布一定正确”的主策略。

### 7.4 Windows CI 目前是“失败可继续”

当前 reusable workflow 里，Windows 打包步骤失败后会记录 `result=failure`，但不会立刻把整个 workflow 打断。

这意味着：

- CI 里已经接入 Windows 打包
- 但发布判断仍然更依赖最终是否真的上传出了 Windows 产物

如果后续要把 Windows 发布稳定性提升到“强约束”，建议让 Windows 构建失败直接阻断 release。

## 8. 如果要把这套方案讲成“可复制的方法论”

可以直接总结成下面这句话：

> AionUi 之所以能做 Windows、macOS、Linux 三端打包，不是因为 Electron 天然万能，而是因为项目把构建、打包、原生模块重编译、签名公证、平台依赖和 CI 矩阵都补齐了。

如果要迁移到别的桌面项目，也建议按同样思路落地：

1. 用 Electron 统一运行时。
2. 用 `electron-builder` 集中定义平台目标。
3. 把原生模块重建做成脚本，而不是手工步骤。
4. 按平台/架构拆分 CI job。
5. 正式发布坚持“单平台、单架构、单产物”。

## 9. 对 AionUi 当前最值得补的两项

如果你想把这份说明写得更落地，可以把下面两项作为后续改进建议：

1. 补齐 Linux `x64/arm64` 的显式 npm scripts，避免 `auto --linux` 只落到第一个架构。
2. 让 `prepareBundledBun.js` 像 `prepareAionrs.js` 一样支持目标架构环境变量，避免多架构构建时附带运行时资源跟着宿主机架构走。

---

一句话总结：AionUi 当前已经具备“三端打包开发”的主体能力，但它的稳定路径是 `同一代码库 + 原生平台 runner + 单架构单 job 出包`，而不是单机混打一切平台。

## 10. 补充版本：Tauri 壳 + Rust + Python sidecar

这一版不是针对 AionUi 现有仓库，而是给你自己的 `Tauri 壳 + Rust + Python sidecar` 架构做的参考。

这里最重要的结论先说清楚：

- Tauri 本身负责桌面壳、窗口、Rust 主进程和平台打包
- Python 侧车不能按“源码脚本 + 用户本机 Python”思路发包
- 真正可发布的做法是：先把 Python sidecar 编译成各平台独立可执行文件，再让 Tauri 通过 `externalBin` 一起打进去

换句话说，这类架构能不能打包成功，关键不在 Tauri，而在：

1. Python sidecar 是否先变成目标平台可执行文件。
2. sidecar 是否按 Tauri 要求命名成 `-$TARGET_TRIPLE` 形式。
3. 额外模型、配置、模板、动态库是否显式放进 `resources` 或平台 bundle 配置。

### 10.1 最推荐的整体方案

建议你把这套架构理解成四层：

- 前端：React/Vue/Svelte 等
- Tauri 壳：窗口、菜单、系统集成
- Rust：本地命令、文件系统、进程调度、sidecar 管理
- Python sidecar：算法、推理、数据处理、已有 Python 生态能力

发布时的正确流程是：

1. 先构建前端静态资源。
2. 再构建 Rust/Tauri 主程序。
3. 同时为当前目标平台构建 Python sidecar 可执行文件。
4. 把该 sidecar 放到 `src-tauri/binaries/`。
5. 通过 `tauri.conf.json > bundle > externalBin` 声明。
6. 最后执行 `tauri build` 生成安装包。

### 10.2 推荐目录结构

```text
your-app/
├── src/                       # 前端
├── python-sidecar/            # Python 业务
│   ├── main.py
│   ├── requirements.txt
│   └── assets/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── commands.rs
│   ├── binaries/              # 放 sidecar 可执行文件
│   ├── capabilities/
│   │   └── default.json
│   └── tauri.conf.json
├── scripts/
│   ├── build-sidecar.sh
│   └── build-sidecar.ps1
└── package.json
```

### 10.3 为什么 Python sidecar 不能直接带 `.py`

如果你把 sidecar 直接写成：

- `python main.py`
- 或者 Rust/Tauri 里去调用系统 `python`

那最终安装包会有这些问题：

- 用户机器未必装 Python
- 用户机器 Python 版本未必匹配
- GUI 应用在 macOS / Linux 下通常不继承你的 shell `PATH`
- 依赖包、动态库、模型路径会变得非常脆弱

所以真正可发布的方案是：

- 用 `PyInstaller`、`Nuitka` 或同类工具
- 为每个目标平台分别产出自包含可执行文件

其中最省事的实践建议是：

- 优先用单文件模式，例如 `PyInstaller --onefile`
- 如果你必须用目录模式 `onedir`，就要额外处理依赖目录和资源目录的打包，不要假设 Tauri 会自动把 sidecar 目录完整复制进去

这一条是工程建议，不是 Tauri 官方强制要求，但对 `Python sidecar` 来说通常最稳。

### 10.4 Tauri 侧的核心配置

`src-tauri/tauri.conf.json` 里至少要有：

```json
{
  "bundle": {
    "externalBin": [
      "binaries/py-sidecar"
    ],
    "resources": [
      "resources/**"
    ]
  }
}
```

这里的关键不是这行配置本身，而是文件命名必须对上目标 triple。

如果你写的是：

```json
"externalBin": ["binaries/py-sidecar"]
```

那么实际文件要长这样：

- Windows x64: `src-tauri/binaries/py-sidecar-x86_64-pc-windows-msvc.exe`
- Windows arm64: `src-tauri/binaries/py-sidecar-aarch64-pc-windows-msvc.exe`
- macOS x64: `src-tauri/binaries/py-sidecar-x86_64-apple-darwin`
- macOS arm64: `src-tauri/binaries/py-sidecar-aarch64-apple-darwin`
- Linux x64: `src-tauri/binaries/py-sidecar-x86_64-unknown-linux-gnu`
- Linux arm64: `src-tauri/binaries/py-sidecar-aarch64-unknown-linux-gnu`

目标 triple 可以用下面命令查看：

```bash
rustc --print host-tuple
```

### 10.5 sidecar 启动方式

前提是你已经初始化 `shell plugin`：

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![start_sidecar])
    .run(tauri::generate_context!())?;
```

如果你从 Rust 侧启动 sidecar，推荐这样做：

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn start_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    let command = app
        .shell()
        .sidecar("py-sidecar")
        .map_err(|e| e.to_string())?;

    let (_rx, _child) = command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}
```

这里要注意一个细节：

- Rust 侧 `sidecar("py-sidecar")` 传的是逻辑名
- 不是 `binaries/py-sidecar`

如果你从前端 JavaScript 启动，则通常要写成和 `externalBin` 一致的值：

```ts
import { Command } from '@tauri-apps/plugin-shell';

const command = Command.sidecar('binaries/py-sidecar');
await command.execute();
```

### 10.6 Tauri 权限别漏配

如果你要从前端用 `plugin-shell` 启动 sidecar，还要在 `src-tauri/capabilities/default.json` 里显式允许。

例如：

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        {
          "name": "binaries/py-sidecar",
          "sidecar": true
        }
      ]
    }
  ]
}
```

如果你用的是 `execute()`，就把权限改成 `shell:allow-execute`，或者两者都配。

### 10.7 Python sidecar 的推荐构建方法

这里给你一个最实用的思路，不和具体业务绑定。

假设你的 sidecar 入口是：

```text
python-sidecar/main.py
```

可以先本地构建单文件：

```bash
pyinstaller python-sidecar/main.py --name py-sidecar --onefile
```

然后把产物重命名并移动到 `src-tauri/binaries/`。

以 macOS / Linux 为例：

```bash
TARGET=$(rustc --print host-tuple)
mv dist/py-sidecar src-tauri/binaries/py-sidecar-$TARGET
```

Windows PowerShell 类似：

```powershell
$TARGET = rustc --print host-tuple
Move-Item dist/py-sidecar.exe src-tauri/binaries/py-sidecar-$TARGET.exe
```

如果你 sidecar 还依赖：

- 模型文件
- `yaml/json` 配置
- `ffmpeg` / `dll` / `dylib` / `so`
- Prompt 模板
- 词典或静态资源

建议优先分两类处理：

1. 能内嵌进 sidecar 的，尽量内嵌。
2. 不能内嵌的，通过 `bundle.resources` 显式打包。

### 10.8 sidecar 资源怎么带进去

如果 Python sidecar 还要读额外文件，不要依赖开发环境相对路径。

推荐做法是把它们放进 Tauri `resources`：

```json
{
  "bundle": {
    "externalBin": ["binaries/py-sidecar"],
    "resources": {
      "../python-sidecar/assets/": "py-assets/"
    }
  }
}
```

然后在 Rust 或前端里解析资源路径，再传给 sidecar。

如果走 Rust：

```rust
use tauri::path::BaseDirectory;

let asset_dir = app
    .path()
    .resolve("py-assets", BaseDirectory::Resource)
    .map_err(|e| e.to_string())?;
```

这里的思路是：

- 由 Tauri 负责找打包后的真实资源目录
- Python 不自己猜测安装位置

### 10.9 你的 Tauri 真正该怎么打包

日常开发：

```bash
cargo tauri dev
```

正式构建：

```bash
cargo tauri build
```

如果你想拆开“编译”和“打包”两步：

```bash
cargo tauri build --no-bundle
cargo tauri bundle
```

按平台 / 架构单独构建时，建议显式传 `--target`。

例如：

```bash
# Windows x64
cargo tauri build --target x86_64-pc-windows-msvc

# Windows arm64
cargo tauri build --target aarch64-pc-windows-msvc

# macOS Apple Silicon
cargo tauri build --target aarch64-apple-darwin

# macOS Intel
cargo tauri build --target x86_64-apple-darwin

# Linux x64
cargo tauri build --target x86_64-unknown-linux-gnu

# Linux arm64
cargo tauri build --target aarch64-unknown-linux-gnu
```

如果你要限制 bundle 格式，也可以显式写：

```bash
# macOS
cargo tauri build --target aarch64-apple-darwin --bundles app,dmg

# Windows
cargo tauri build --target x86_64-pc-windows-msvc --bundles nsis

# Linux
cargo tauri build --target x86_64-unknown-linux-gnu --bundles deb,appimage
```

### 10.10 对这类架构最重要的发布建议

`Tauri + Python sidecar` 和普通纯 Rust Tauri 最大的区别，是 sidecar 本身也必须按平台单独构建。

所以正式发布时，最稳妥的策略是：

- Windows runner：先编 Python sidecar，再编 Tauri Windows 包
- macOS runner：先编 Python sidecar，再编 Tauri macOS 包
- Linux runner：先编 Python sidecar，再编 Tauri Linux 包

不要把方案理解成：

- 一台机器打完所有平台
- 一个 Python 可执行文件跨平台复用

这两种理解在这类架构里基本都不成立。

### 10.11 推荐的 CI 思路

建议 CI matrix 至少拆成：

| Job | 目标 | 说明 |
| --- | --- | --- |
| `windows-x64` | `x86_64-pc-windows-msvc` | Python sidecar 和 Tauri 一起在 Windows 上构建 |
| `windows-arm64` | `aarch64-pc-windows-msvc` | 如需 ARM64，再单独出包 |
| `macos-arm64` | `aarch64-apple-darwin` | Apple Silicon 原生包 |
| `macos-x64` | `x86_64-apple-darwin` | Intel Mac 包 |
| `linux-x64` | `x86_64-unknown-linux-gnu` | `deb` / `AppImage` |
| `linux-arm64` | `aarch64-unknown-linux-gnu` | ARM Linux 包，最好用 ARM runner |

每个 job 里做三件事：

1. 安装前端、Rust、Python 依赖。
2. 构建并重命名 sidecar 到 `src-tauri/binaries/`。
3. 执行 `cargo tauri build --target ...`。

### 10.12 几个非常容易踩的坑

#### 坑 1：只把 `.py` 放进安装包

这通常意味着：

- 用户端要有 Python
- 路径和依赖不稳定
- 最终包不是真正“可安装即运行”

#### 坑 2：sidecar 文件名不带 target triple

Tauri 会按目标平台查找对应命名的 sidecar。

如果命名不对，构建时就会找不到。

#### 坑 3：把 sidecar 当成跨平台二进制

Python sidecar 实际上和 Rust 主程序一样，也要：

- Windows 编 Windows
- macOS 编 macOS
- Linux 编 Linux

#### 坑 4：sidecar 依赖额外资源，但没放进 `resources`

开发环境能跑，不等于安装包能跑。

只要 sidecar 依赖：

- 模型
- 配置
- 模板
- 外部动态库

都应该显式纳入打包策略。

#### 坑 5：macOS / Linux 下依赖 PATH

Tauri 官方文档特别提醒过，GUI 应用在 macOS / Linux 下不继承 shell dotfiles 里的 `PATH`。

所以：

- 不要依赖 `python`
- 不要依赖“我终端里能找到，GUI 就能找到”

#### 坑 6：Linux 在太新的基础镜像上构建

如果你出 `AppImage` 或 Linux 包，`glibc` 兼容性会直接影响最终能跑的机器范围。

比较稳的策略是：

- 用较旧的 Linux 基线构建
- 或直接用 GitHub Actions / Docker 控制构建环境

### 10.13 对你的架构最简洁的一句话建议

如果你的目标是“让 Tauri 壳 + Rust + Python sidecar 能稳定打包发布”，那最稳的工程路线就是：

> 把 Python sidecar 先编译成各平台自包含可执行文件，按 Tauri `externalBin` 规则命名，再让每个平台 runner 单独执行 `cargo tauri build`。

### 10.14 这一节对应的官方参考

这一节主要基于 Tauri v2 官方文档整理，关键点分别来自：

- Sidecar / `externalBin`：
  - https://tauri.app/develop/sidecar/
- Resources：
  - https://v2.tauri.app/develop/resources/
- Build / Bundle / CLI：
  - https://v2.tauri.app/distribute/
  - https://v2.tauri.app/reference/cli/
- macOS app bundle：
  - https://v2.tauri.app/distribute/macos-application-bundle/
- Linux AppImage 兼容性说明：
  - https://v2.tauri.app/distribute/appimage/
