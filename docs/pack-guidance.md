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

### 10.15 勘误与补充（针对 §10）

落地到真实项目前，下面这些点需要按目前 Tauri v2 与 PyInstaller 的实际行为修正：

1. **`rustc --print host-tuple` 需要较新的 Rust。**
   - 该子命令是 Rust 1.85 (2025) 才稳定的别名，旧版本叫 `host-triple` 或没有这个子命令。
   - 通用写法用 `rustc -vV | sed -n 's/^host: //p'`，跨版本都成立。CI 里若 toolchain 不固定，请用这种方式拿 target triple。

2. **`externalBin` 不是唯一可发布路径，对 Python sidecar 反而经常不是最佳选择。**
   - `externalBin` 适合"单个可执行文件 + 极少附带资源"的二进制（典型场景：Go/Rust 编译出来的 sidecar）。
   - PyInstaller `--onedir` 产物是"一个可执行 + 一堆 `.so/.dll/.pyd` + `_internal/` 目录"，整体几十到几百 MB。把整个目录塞进 `externalBin` 路径里不被官方支持；硬塞 `--onefile` 又会带来启动慢、首次解压到 `/tmp` 的副作用，对长驻 FastAPI 服务体验不好。
   - **真正适合 Python sidecar 的两种主流做法：**
     - **(A) Resource 模式**：把 PyInstaller `--onedir` 目录整体作为 `bundle.resources` 打进去，Rust 侧用 `std::process::Command::new(resource_dir.join(...))` 自己 spawn。优点：完全控制启动参数、环境变量、日志重定向、生命周期；缺点：要自己写 spawn 和清理。ABO 当前用的就是这条路（见 `src-tauri/src/lib.rs` 和 `scripts/build_tauri_sidecar.py`）。
     - **(B) externalBin + onefile 模式**：把 sidecar 编成 `--onefile` 单文件，命名带 target triple，让 Tauri shell plugin 管理。优点：声明式、权限模型清楚；缺点：onefile 启动每次都解压、依赖 `--add-data` 的资源在运行时定位要走 `sys._MEIPASS`，对动辄 100MB+ 的 FastAPI/uvicorn 体验差。
   - §10 默认推荐的是 (B)，但本仓库实际跑通的是 (A)，并且对 ABO 这种"后端常驻 + 大量 Python 依赖 + 需要把日志写到 `~/Library/Application Support/...`"的场景，(A) 更稳。下一节 §11 的执行计划完全围绕 (A) 展开。

3. **`shell:allow-spawn` 与 `shell:allow-execute` 的区别。**
   - §10.6 给的 capability 例子是对的，但需要明确：`Command.sidecar(...).spawn()`（前端持续读取 stdout/stderr 的方式）要 `shell:allow-spawn`；`Command.sidecar(...).execute()`（一次性收集输出）要 `shell:allow-execute`。两个权限的 scope 都用 `{name, sidecar: true}` 这种结构。
   - 如果你像 ABO 一样**只在 Rust 侧 spawn**、前端不通过 shell plugin 调 sidecar，那 capability 里 **完全不需要**写 `shell:allow-spawn`，也不需要 `externalBin`。

4. **"`prepareBundledBun` 按 `process.arch` 准备" 这条问题在 ABO 里不存在。**
   - §7.3 说的是 AionUi 的脚本。ABO 没有 bundled-bun，但**同类问题在 ABO 这里换了个形式**：PyInstaller 永远只能打"当前宿主机架构"的 sidecar——在 arm64 Mac 上跑 PyInstaller，出的就是 arm64 二进制。所以 ABO 想做 macOS Intel/Apple Silicon 两个包，必须分别在两台机器（或两个 runner）上跑，不能靠 `cargo tauri build --target x86_64-apple-darwin` 一条命令搞定（那只决定 Rust 侧 target，不影响 sidecar）。这是 §11 计划里反复强调的点。

5. **`--onefile` ≠ "最省事"。**
   - §10.3 写"优先用 `--onefile`，最省事"。对纯 CLI 工具确实是；但对带大量原生扩展（`pdfminer`、`watchdog`、`websockets`、`pdf2image` 这些）的 FastAPI 应用，`--onefile` 每次启动都要解压到临时目录，冷启动 1~3s，并且某些反病毒软件会因临时目录里的可执行文件触发误报。**ABO 选 `--onedir` 是有意为之，不是疏忽。**

6. **macOS Gatekeeper 与 ad-hoc 签名。**
   - §5.3 只提到"未签名包用户会遇到 Gatekeeper 提示"。补一条更准确的说法：在 Apple Silicon 上，**未做任何签名的可执行文件根本不会执行**（macOS 11+ 强制要求至少 ad-hoc 签名）。
   - ABO 当前的 `scripts/build_macos_app.sh` 已经做了 `codesign --force --deep --sign -`（ad-hoc），所以 .app 能在打包机上跑；但**用户从 DMG 拖出后仍会被 quarantine 标记**——这就是脚本里那张"先拖到 Applications 再打开"的纸条存在的原因。要真正消除"右键打开"才能启动的体验，必须 Developer ID + notarization。

---

## 11. ABO 跨平台打包完整执行计划（可自动执行 + 自带测试）

下面这一节是为 ABO 仓库当前现状量身写的可执行计划。任何一个新加入的开发者（或 Claude/Codex 代理）可以**按顺序逐条执行**，最终拿到 macOS arm64 / macOS x64 / Windows x64 / Linux x64 四个平台的可分发安装包，并通过自带的冒烟测试。

### 11.1 现状盘点（先看清楚才动手）

✅ 已具备：

- `scripts/build_tauri_sidecar.py`：用 PyInstaller `--onedir` 把 FastAPI 后端打成 `src-tauri/resources/abo-backend/abo-backend(.exe)`。
- `scripts/build_macos_app.sh`：调 `npm run tauri:build`，做 ad-hoc 签名，生成 .app + .dmg 到 `release/`。
- `src-tauri/tauri.conf.json` 已经把 `resources/abo-backend` 写进 `bundle.resources`。
- `src-tauri/src/lib.rs` 在 release 构建里负责 spawn `abo-backend`、写日志到 `~/Library/Application Support/ABO App/logs/bundled-backend.log`、占用端口 8766、提供端口存活探测和"杀掉残留 bundled backend"逻辑。
- `abo/main.py` 暴露 `GET /api/health`，是天然的健康检查锚点。

❌ 缺失：

- 没有 Linux 打包脚本；`bundle.targets: "all"` 会让 Tauri 试着出 deb/AppImage/rpm，但没有人验证过 `abo-backend` 在 Linux 资源目录下的相对路径是否正确。
- 没有 Windows 打包脚本；Rust 那边 `lsof` / `kill -TERM` 是 Unix-only，需要补 Windows 分支。
- 没有 CI；目前所有打包都靠开发者本机跑。
- 没有任何"打完包以后实际启动一遍、验证 `/api/health` 可达"的自动化测试。**这是这次计划要补的最关键一环。**
- `scripts/build_tauri_sidecar.py` 假设 venv 路径 `.venv-packaging/bin/python` 在 Windows 是 `Scripts/python.exe`——这一条已经处理了，但 PyInstaller `--hidden-import` 列表只在当前业务模块下验证过，新加 Python 依赖时容易漏。

### 11.2 目标与边界

**目标**：执行完本节计划，可以做到：

1. 在 macOS（arm64 或 x64）上跑 `python3 scripts/package.py --target host` → 拿到当前宿主机架构的 .app + .dmg + 通过冒烟测试。
2. 在 Windows / Linux runner 上跑同一条命令 → 拿到对应平台的 .msi / .deb + 通过冒烟测试。
3. 推 tag 后 GitHub Actions 自动 matrix 出全四份产物并上传到 Release。

**边界**：

- 不做 Apple Developer ID 公证（仓库没有证书；CI 里走 ad-hoc，跟当前 `build_macos_app.sh` 行为一致）。要真正消除 Gatekeeper 警告需要单独补 Developer Account 与 secrets，不在本计划范围。
- 不做 Windows 代码签名（同上，没有 EV 证书）。
- 不做 macOS Universal Binary。Apple Silicon / Intel 分别出包，由 runner 决定架构。
- ARM Linux 不打入第一版（GitHub Actions 免费 runner 没有原生 ARM Linux，且 ABO 用户预期是开发者主机环境，arm64 Linux 优先级低）。

### 11.3 阶段 A：把 sidecar 构建脚本变成"目标平台感知"

`scripts/build_tauri_sidecar.py` 当前已经基本跨平台了，但有两件事需要补：

**A1. 输出 target triple 信息到一个 manifest 文件**，便于后续测试脚本核对自己测的到底是哪个架构的产物，避免"在 arm64 机器上误测了 x64 sidecar"这种事故。

在 `install_sidecar` 函数最后追加：

```python
import json, platform
manifest = {
    "target_arch": platform.machine().lower(),
    "target_os": sys.platform,
    "executable": str(executable.relative_to(TAURI_RESOURCE_DIR)),
    "built_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
}
(TAURI_RESOURCE_DIR / "sidecar.manifest.json").write_text(
    json.dumps(manifest, indent=2), encoding="utf-8"
)
```

**A2. 暴露 `--check-only` 与 `--force`**，让 CI / 测试脚本可以分别"只校验产物是否在""强制重建产物"：

```python
def main() -> None:
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()

    output = TAURI_RESOURCE_DIR
    exe_name = f"{BACKEND_NAME}.exe" if sys.platform == "win32" else BACKEND_NAME

    if args.check_only:
        ok = (output / exe_name).exists()
        print(f"[sidecar-build] check-only: {'present' if ok else 'missing'} -> {output}")
        sys.exit(0 if ok else 1)

    if not args.force and is_sidecar_current(output):
        print(f"[sidecar-build] up to date: {output}")
        return

    ensure_venv()
    install_build_dependencies()
    bundle_dir = build_sidecar()
    install_sidecar(bundle_dir)
```

### 11.4 阶段 B：Rust 侧补全 Windows 与 Linux 分支

当前 `src-tauri/src/lib.rs` 里有几处是 Unix 写死的（`lsof`、`kill -TERM`、`~/Library/Application Support/...`）。Windows / Linux 上要么编不过，要么运行时找不到资源。

新建 `src-tauri/src/backend_supervisor.rs`，把 spawn / stale-cleanup / data-dir 解析三件事拆出来，用 `cfg` 分平台实现。简化版本骨架：

```rust
use std::{path::{Path, PathBuf}, process::Command};

pub fn listening_pids(port: u16) -> Vec<u32> {
    #[cfg(unix)] {
        let out = Command::new("lsof")
            .args(["-ti", &format!("TCP:{port}"), "-sTCP:LISTEN"])
            .output().ok();
        out.map(|o| String::from_utf8_lossy(&o.stdout).lines()
            .filter_map(|l| l.trim().parse().ok()).collect())
            .unwrap_or_default()
    }
    #[cfg(windows)] {
        // netstat -ano | findstr :PORT  → parse PID
        let out = Command::new("cmd")
            .args(["/C", &format!("netstat -ano -p tcp | findstr :{port}")])
            .output().ok();
        out.map(|o| String::from_utf8_lossy(&o.stdout).lines()
            .filter(|l| l.contains("LISTENING"))
            .filter_map(|l| l.split_whitespace().last()?.parse().ok())
            .collect())
            .unwrap_or_default()
    }
}

pub fn kill_pid(pid: u32) {
    #[cfg(unix)] {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
    #[cfg(windows)] {
        let _ = Command::new("taskkill").args(["/F", "/PID", &pid.to_string()]).status();
    }
}

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    #[cfg(target_os = "macos")] {
        let home = app.path().home_dir().map_err(|e| e.to_string())?;
        Ok(home.join("Library/Application Support/ABO App"))
    }
    #[cfg(not(target_os = "macos"))] {
        app.path().app_data_dir().map_err(|e| e.to_string())
    }
}
```

然后把 `lib.rs` 里原来直接调 `lsof`/`kill` 的地方换成 `backend_supervisor::listening_pids/kill_pid`。`is_bundled_backend_command` 在 Windows 上也要改：路径片段不再是 `ABO.app/Contents/`，而是 `\ABO\` 或 resource_dir 自身。最稳的做法是直接拿 `current_backend` 的绝对路径去匹配，不要再用平台特有的字符串特征。

把 `is_bundled_backend_command` 整个删掉，统一用 `command_matches_backend_path`：

```rust
#[cfg(not(debug_assertions))]
fn stop_stale_bundled_backends(current_backend: &Path) {
    let target = current_backend.to_string_lossy().to_string();
    for pid in backend_supervisor::listening_pids(BUNDLED_BACKEND_PORT) {
        let command = command_for_pid(pid);
        if !command.contains(&target) { continue; }
        // ... 原来的 kill 逻辑
    }
}
```

这条改动副作用：不再清理"路径已经不存在但还占着 8766 的旧版本 ABO"。补偿做法是在 `launch_backend` 一开头先无差别探测 8766，如果有人占着且 30s 内不放，回退到 8767 并把端口写到 `~/.abo/runtime.json` 给前端读。这一条工程上更长，**第一版可以先不做**，但要在 issue 里登记。

### 11.5 阶段 C：统一打包入口 `scripts/package.py`

新建 `scripts/package.py`，作为所有平台的单一入口。内容：

```python
#!/usr/bin/env python3
"""ABO 跨平台打包统一入口。

用法:
    python3 scripts/package.py --target host        # 当前宿主机
    python3 scripts/package.py --target host --skip-test
    python3 scripts/package.py --target host --bundles dmg,app
"""
from __future__ import annotations
import argparse, os, platform, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def host_triple() -> str:
    out = subprocess.check_output(["rustc", "-vV"], text=True)
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError("cannot determine host triple")

def run(cmd, **kw):
    print(f"[package] $ {' '.join(cmd) if isinstance(cmd, list) else cmd}")
    subprocess.run(cmd, check=True, cwd=ROOT, **kw)

def build_sidecar(force: bool):
    args = [sys.executable, "scripts/build_tauri_sidecar.py"]
    if force: args.append("--force")
    run(args)

def build_tauri(target: str, bundles: str | None):
    cmd = ["npm", "run", "tauri", "--", "build", "--target", target]
    if bundles:
        cmd.extend(["--bundles", bundles])
    run(cmd)

def default_bundles_for(target: str) -> str:
    if "apple-darwin" in target: return "app,dmg"
    if "windows" in target: return "msi,nsis"
    if "linux" in target: return "deb,appimage"
    raise ValueError(target)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--target", default="host",
                   help="rust target triple 或 'host'")
    p.add_argument("--bundles", default=None,
                   help="逗号分隔的 bundle 类型；默认按平台选")
    p.add_argument("--skip-sidecar", action="store_true")
    p.add_argument("--skip-test", action="store_true")
    p.add_argument("--force-sidecar", action="store_true")
    args = p.parse_args()

    target = host_triple() if args.target == "host" else args.target
    bundles = args.bundles or default_bundles_for(target)
    print(f"[package] target={target} bundles={bundles}")

    # 防呆：sidecar 只能打宿主机架构
    host = host_triple()
    if target != host and not args.skip_sidecar:
        print(f"[package] FATAL: sidecar can only be built for host ({host}); "
              f"requested {target}. Run this on a matching runner, or pass --skip-sidecar "
              f"if you know what you're doing.", file=sys.stderr)
        sys.exit(2)

    if not args.skip_sidecar:
        build_sidecar(args.force_sidecar)

    build_tauri(target, bundles)

    if not args.skip_test:
        run([sys.executable, "scripts/test_bundle.py", "--target", target])

if __name__ == "__main__":
    main()
```

### 11.6 阶段 D：冒烟测试 `scripts/test_bundle.py`（这是整个计划的灵魂）

这一步是真正"自带测试"的部分。它的职责：

1. 找到刚才构建出的 `abo-backend` 可执行文件（**不是从源码运行 uvicorn，而是从打包产物里挑出来执行**，这样能验证 PyInstaller 没漏 hidden import、没漏数据文件）。
2. 用一个随机空闲端口启动它，**完全模拟 Tauri release 模式的环境变量**（`ABO_RUNNING_BUNDLED_APP=1`、`ABO_BACKEND_PORT=...`、`ABO_APP_DATA_DIR=<tmpdir>`）。
3. 在最多 30s 内轮询 `GET /api/health`，验证 200 OK + JSON 字段。
4. 再调 `GET /api/modules` 验证模块发现链路。
5. 关掉进程，验证退出码合理（PyInstaller `--onedir` 上 SIGTERM 应该是 0 或 -15）。
6. 如果 `--target` 传了 triple，对照 `sidecar.manifest.json` 校验架构匹配。
7. **额外**：跑一次 `cargo tauri build --target ... --no-bundle` 的轻量验证（不重新打包，只验证 Rust 端编译能过）。

完整脚本：

```python
#!/usr/bin/env python3
"""ABO 打包产物冒烟测试。"""
from __future__ import annotations
import argparse, json, os, platform, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path
from urllib import request, error

ROOT = Path(__file__).resolve().parents[1]
SIDECAR_DIR = ROOT / "src-tauri" / "resources" / "abo-backend"
BACKEND_NAME = "abo-backend.exe" if sys.platform == "win32" else "abo-backend"

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

def http_get(url: str, timeout: float = 2.0):
    try:
        with request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except (error.URLError, error.HTTPError, ConnectionError, TimeoutError, socket.timeout):
        return None, None

def wait_health(port: int, timeout: float = 30.0) -> dict:
    deadline = time.time() + timeout
    last_err = "no response"
    while time.time() < deadline:
        status, body = http_get(f"http://127.0.0.1:{port}/api/health")
        if status == 200 and isinstance(body, dict):
            return body
        last_err = f"status={status}"
        time.sleep(0.5)
    raise TimeoutError(f"backend did not become healthy within {timeout}s: {last_err}")

def check_manifest(expected_target: str | None):
    manifest_path = SIDECAR_DIR / "sidecar.manifest.json"
    if not manifest_path.exists():
        print("[test] WARN: sidecar.manifest.json missing; skipping arch check")
        return
    m = json.loads(manifest_path.read_text())
    print(f"[test] sidecar manifest: {m}")
    if expected_target:
        host_arch = platform.machine().lower()
        manifest_arch = m.get("target_arch", "")
        # 粗匹配：arm64/aarch64 互通；x86_64/amd64 互通
        normalize = lambda a: {"aarch64": "arm64", "amd64": "x86_64", "x64": "x86_64"}.get(a, a)
        if normalize(manifest_arch) != normalize(host_arch):
            raise SystemExit(f"[test] arch mismatch: manifest={manifest_arch} host={host_arch}")

def smoke_test(expected_target: str | None) -> int:
    exe = SIDECAR_DIR / BACKEND_NAME
    if not exe.exists():
        print(f"[test] FATAL: backend exe not found at {exe}", file=sys.stderr)
        return 2

    check_manifest(expected_target)

    port = free_port()
    with tempfile.TemporaryDirectory(prefix="abo-smoketest-") as td:
        env = os.environ.copy()
        env.update({
            "ABO_RUNNING_BUNDLED_APP": "1",
            "ABO_BACKEND_HOST": "127.0.0.1",
            "ABO_BACKEND_PORT": str(port),
            "ABO_APP_DATA_DIR": td,
            "ABO_DISABLE_LEGACY_MIGRATION": "1",
            "ABO_BUNDLED_IDLE_EXIT_SECONDS": "300",
        })
        print(f"[test] launching {exe} on port {port}, data_dir={td}")
        log_path = Path(td) / "backend.log"
        with open(log_path, "w") as logf:
            proc = subprocess.Popen(
                [str(exe)], env=env, stdout=logf, stderr=subprocess.STDOUT,
                cwd=td,
            )
        try:
            health = wait_health(port, timeout=45.0)
            print(f"[test] /api/health OK: {health}")
            # 验证模块发现链路
            status, modules = http_get(f"http://127.0.0.1:{port}/api/modules", timeout=5.0)
            assert status == 200, f"/api/modules status={status}"
            assert isinstance(modules, (list, dict)), f"unexpected modules payload: {type(modules)}"
            print(f"[test] /api/modules OK: {len(modules) if hasattr(modules, '__len__') else '?'} entries")
        except Exception as e:
            print(f"[test] FAILED: {e}", file=sys.stderr)
            print("---- backend log ----", file=sys.stderr)
            try:
                print(log_path.read_text(), file=sys.stderr)
            except Exception:
                pass
            return 1
        finally:
            if sys.platform == "win32":
                proc.terminate()
            else:
                proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
            print(f"[test] backend exited rc={proc.returncode}")
    return 0

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--target", default=None)
    args = p.parse_args()
    sys.exit(smoke_test(args.target))

if __name__ == "__main__":
    main()
```

**为什么这个测试是充分的**：

- 它直接跑打包产物里的 `abo-backend(.exe)`，不走源码——只要 PyInstaller 漏了 hidden import 或数据文件，第 1 步 spawn 后 `/api/health` 就拿不到 200。
- 它用 `ABO_RUNNING_BUNDLED_APP=1` + 临时数据目录，跟 Tauri release 路径下 Rust spawn 时给的环境严格对齐（见 `lib.rs` 第 235-244 行）。
- 它顺手验了 `/api/modules`，这个端点会触发 `abo/runtime/discovery.py` 加载所有默认模块——也就是说，如果哪个 default module 的 import 链有问题，测试也会挂。
- 在 CI matrix 里每个 runner 各跑一遍，等价于"每个平台都验过这个具体的二进制可以原地启动"。

### 11.7 阶段 E：Linux 与 Windows 平台脚本

**Linux**（`scripts/build_linux_app.sh`）：

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 系统依赖（GitHub Actions ubuntu-22.04 / 24.04 通用）
if command -v apt-get >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
    librsvg2-dev patchelf libgtk-3-dev build-essential \
    python3-dev python3-venv pkg-config file
fi

cd "$ROOT"
python3 scripts/package.py --target host --bundles deb,appimage
echo "Linux artifacts under: src-tauri/target/release/bundle/"
```

**Windows**（`scripts/build_windows_app.ps1`）：

```powershell
$ErrorActionPreference = "Stop"
$ROOT = Resolve-Path "$PSScriptRoot\.."
Set-Location $ROOT

# 假设 runner 已经装好 VS Build Tools 2022（windows-latest 默认就有）
# 假设 Python 3.12+ 已在 PATH

python scripts\package.py --target host --bundles msi,nsis
Write-Host "Windows artifacts under: src-tauri\target\release\bundle\"
```

注意 `tauri.conf.json` 里 `bundle.targets` 当前是 `"all"`。这会让 Tauri 在每个平台尝试出所有可能的格式，CI 上会失败（macOS 上没人能出 deb）。把它改成：

```json
"targets": ["app", "dmg", "msi", "nsis", "deb", "appimage"]
```

然后由 `cargo tauri build --bundles xxx` 在命令行筛。tauri-bundler 会自动只生成当前平台支持的那些。

### 11.8 阶段 F：GitHub Actions matrix

新建 `.github/workflows/build.yml`：

```yaml
name: Build & Test Cross-Platform

on:
  push:
    tags: ["v*"]
  workflow_dispatch:
  pull_request:
    paths:
      - "abo/**"
      - "src-tauri/**"
      - "scripts/build_tauri_sidecar.py"
      - "scripts/package.py"
      - "scripts/test_bundle.py"
      - ".github/workflows/build.yml"

jobs:
  build:
    name: ${{ matrix.label }}
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - label: macos-arm64
            os: macos-14
            target: aarch64-apple-darwin
            bundles: app,dmg
          - label: macos-x64
            os: macos-13
            target: x86_64-apple-darwin
            bundles: app,dmg
          - label: windows-x64
            os: windows-latest
            target: x86_64-pc-windows-msvc
            bundles: msi,nsis
          - label: linux-x64
            os: ubuntu-22.04
            target: x86_64-unknown-linux-gnu
            bundles: deb,appimage

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: "20" }

      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Linux system deps
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libssl-dev \
            libayatana-appindicator3-dev librsvg2-dev patchelf \
            libgtk-3-dev build-essential python3-dev pkg-config file

      - name: Install JS deps
        run: npm ci

      - name: Build sidecar + Tauri + smoke test
        shell: bash
        run: python scripts/package.py --target ${{ matrix.target }} --bundles ${{ matrix.bundles }}

      - name: Collect artifacts
        if: always()
        run: |
          mkdir -p dist-ci
          find src-tauri/target/${{ matrix.target }}/release/bundle -maxdepth 3 \
            \( -name "*.dmg" -o -name "*.app" -o -name "*.msi" -o -name "*.exe" \
               -o -name "*.deb" -o -name "*.AppImage" \) -exec cp -R {} dist-ci/ \;
        shell: bash

      - uses: actions/upload-artifact@v4
        with:
          name: abo-${{ matrix.label }}
          path: dist-ci/
          if-no-files-found: error

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with: { path: ./artifacts }
      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
```

### 11.9 阶段 G：执行顺序与验证清单

按顺序做下面这串动作，每一步都必须等上一步绿了再走：

| # | 动作 | 命令 | 通过判据 |
|---|------|------|----------|
| 1 | 给 sidecar 脚本加 `--check-only/--force` + manifest | 改 `scripts/build_tauri_sidecar.py` | `python3 scripts/build_tauri_sidecar.py --force` 成功且 `src-tauri/resources/abo-backend/sidecar.manifest.json` 存在 |
| 2 | 拆分 `backend_supervisor.rs`，Rust 全部交叉编译过 | `cargo check --target aarch64-apple-darwin && cargo check --target x86_64-pc-windows-msvc --features ""`（后者需 mingw 或在 Windows runner 上） | 本地至少宿主机 target 编译过 |
| 3 | 写 `scripts/package.py` 与 `scripts/test_bundle.py` | 见 §11.5 / §11.6 | `python3 scripts/package.py --target host --bundles app,dmg` 在本机出 .app + .dmg 并通过冒烟测试 |
| 4 | 调整 `tauri.conf.json` 的 `bundle.targets` | 见 §11.7 | macOS 上 `cargo tauri build --bundles dmg` 不再尝试出 deb |
| 5 | 加 Linux / Windows 平台脚本 | 见 §11.7 | 在对应平台上人工或临时 runner 跑一次能出包 |
| 6 | 加 `.github/workflows/build.yml` | 见 §11.8 | 推一次 `workflow_dispatch`，四个 job 全绿 |
| 7 | 推 `v0.x.y` tag 验证 release job | `git tag v0.x.y && git push origin v0.x.y` | GitHub Releases 页面出现 4 个平台的安装包 |

### 11.10 失败模式与排查指南（先写在这里，省得到时候慌）

| 症状 | 最可能原因 | 排查动作 |
|------|------------|----------|
| `scripts/test_bundle.py` 在 `/api/health` 超时 | PyInstaller 漏了某个 hidden import | 看 `backend.log`，找 `ModuleNotFoundError`；在 `build_tauri_sidecar.py` 的 `--hidden-import` 列表里补 |
| Windows runner 上 sidecar exe 启动后立刻退出 | 路径里有空格 / Defender 拦截 / 缺 VC++ Redistributable | 本地用 `Procmon` 看 spawn 失败原因；如果是 Defender，把构建目录排除 |
| Linux deb 装好后启动闪退 | WebKit2GTK 版本不匹配（22.04 vs 24.04） | 用 ubuntu-22.04 runner 出包，向后兼容更好；目标用户必须 ≥22.04 |
| macOS 用户首次打开报"已损坏" | DMG 没做 ad-hoc 签名 / quarantine flag | 确认 `build_macos_app.sh` 那段 `xattr -cr` 和 `codesign --force --deep --sign -` 跑过；DMG 内 .app 也要单独签 |
| `cargo tauri build` 报 "resource not found: resources/abo-backend" | 阶段 A 没执行 / sidecar 没生成 | 先单独跑 `python3 scripts/build_tauri_sidecar.py --check-only` 确认产物在位 |
| CI 上 sidecar 构建慢（每次 5+ 分钟） | 没缓存 PyInstaller venv | 给 `.venv-packaging` 加 `actions/cache`，key 用 `requirements.txt` 的 hash |

### 11.11 一句话总结这一节

ABO 的跨平台打包路径是：**每个平台的 runner 上，先用 PyInstaller `--onedir` 把 FastAPI 后端打成"当前架构的可执行目录"放进 `src-tauri/resources/`，再让 Tauri 把它当资源打进安装包，最后用一个不依赖源码、只跑产物里那个二进制的冒烟测试证明这个安装包真的能启动**——CI matrix 把这一套在 4 个 (OS × arch) 上各跑一遍，全绿即可发布。

