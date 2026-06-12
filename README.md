# ABO (Abu) - Another Brain Odyssey

> **"You explore the world; Abu remembers what matters."** 🌍⚔️👑 **Turn your scattered inputs into a local, continuous, accumulating second brain.**

**ABO (Abu)** is your personal guide 🗺️ to "Earth Online," and an odyssey for your "second brain" 👣.

It is not just a web scraper, nor a simple tool that copies content into a note-taking app. ABO is dedicated to transforming your scattered inputs into a local, continuous, reviewable personal information system **(All in one, All in Obsidian)**.

In this era, what we lack least is information — what we lack most is consolidation. What Abu wants to do is connect the papers you track every day, the bookmarks gathering dust, and your current state of mind, so they are no longer scattered fragments, **but truly become personal assets you can revisit, reuse, and build upon — while the Abu assistant systematically maintains and organizes everything for you, completely freeing your hands.**

 [⬇️ Download for macOS (Apple Silicon)](https://github.com/hyuanChen/ABO/releases/download/v0.1.0/ABO_0.1.0_aarch64.dmg)

> On first launch, macOS will warn `Apple could not verify "ABO" is free of malware` because we haven't paid for an Apple Developer ID. You need to allow it manually: right-click `ABO.app` -> `Open`, or go to "System Settings -> Privacy & Security" and allow it there before opening.



![intro](./docs/intro.png)

## Fun Life Visualizations...

Once your inputs are collected and organized, Abu can build some fascinating life visualizations from your local data...

1. `Interest Migration Map`
   Based on Xiaohongshu bookmarks, Bilibili favorites, follow feeds, and paper topics imported across different time periods, it draws how your interests migrated from one theme to another — reflecting shifts in your state of mind through data, e.g., perhaps from lifestyle content to literature.

2. `Current Breakthrough Keywords`
   Combining recent bookmarks, journal keywords, task status, and mood records, it identifies which problems, emotions, or themes currently surround you, and which recent new inputs might help you "break out of your comfort zone." It analyzes your current state and recommends growth experiments that match what you're itching to try right now.

3. `Periodic Attention Map`
   It maps the themes that recur within a week, a month, or a quarter, so you can observe whether your attention is driven by short-term trends or is deepening in cycles around a few long-term core themes.

4. `Data-Driven Independent Research`
   Through targeted tracking of keywords and key papers, it automates topic curation and builds a wiki with a complete narrative thread.

5. `Inspiration Resonance Moments`
   It identifies moments when different sources point to the same topic at around the same time — e.g., a paper, a Bilibili video, and a few Xiaohongshu bookmarks all nudging you toward the same question. These resonance points are often the most worth consolidating into the Wiki.

6. `Personal Theme Universe`
   From long-term accumulated data, it generates your theme network: which themes are central stars, which are merely passing interest meteors, which are moving from the periphery toward the core, and what you truly understand — turning everything you've consumed into your own knowledge base.

7. `State Profile`
   Use more accurate data to articulate your growth, instead of relying on gut feeling — are you getting a little closer each day to the person you want to become?

And many more interesting things like these will gradually emerge with further use and feedback...


## What ABO Does

For many people the problem isn't "no input" — it's that input is too scattered:

- Bookmarks keep piling up, but you rarely revisit them and lack systematic organization.
- You've downloaded plenty of papers, but remember too few of them.
- Every day brings tasks, moods, energy, and health fluctuations, yet long-term patterns are hard to see.
- Your Obsidian or local note vault has material, but lacks ongoing maintenance and reuse.

ABO's goal is to pull these scattered inputs back to your local machine, so that through filtering, saving, categorizing, wiki-fication, and assistant analysis, they gradually become your own research assets, attention assets, and growth trajectory.

## Core Features and Data Flow

ABO's features are not a set of isolated pages, but a single data flow from input to consolidation to reuse.

```text
External inputs -> Active tools -> Module management -> Daily Briefing -> Intel Library / Literature Library / Journal -> Wiki -> Assistant / Data Insights / Character Home
```

The three main chains can be understood as:

```text
Attention chain: platform inputs -> Daily Briefing -> Intel Library / Wiki -> long-term attention profile
Research chain:  paper discovery -> Daily Briefing -> Literature Library / Wiki -> assistant-generated judgments & ideas
Growth chain:    personal records -> Journal / Data Insights -> Character Home -> next-step suggestions
```

## Three Typical Usage Paths

```text
Intel path:  aggregated bookmarks / follow feeds / keywords -> Daily Briefing -> Intel Library -> Internet Wiki -> long-term preference review
Paper path:  arXiv / Follow Up -> Daily Briefing -> Literature Library -> Literature Wiki -> assistant distills ideas
Growth path: tasks / journal / state records -> Data Insights -> Character Home -> periodic review -> next-step planning
```

## Suggestions for First-Time Use

When using ABO for the first time, you don't need to configure everything at once. We recommend starting with one small but complete chain:

1. Pick a local directory for your intel library and literature library — ideally an Obsidian Vault you're willing to use long-term.
2. Connect your Xiaohongshu or Bilibili cookie first, and manually import a small amount of bookmarks or follow-feed content.
3. Filter the cards in Daily Briefing and save a few pieces of genuinely valuable content.
4. Go to the Intel Library and confirm the content has been written to your local disk.
5. Then try generating or updating a Wiki page.
6. Finally, let the assistant summarize, compare, or plan next steps based on these local materials.

If you mainly do research, start with paper tracking: use arXiv search or Follow Up to track and save a few papers first, then move into the Literature Library and Literature Wiki.

## One-Sentence Summary

Our slogan is: **"You explore the world; Abu remembers what matters."**

In this age of information overload, join Abu in maintaining your own personal base camp~

If you're ready to build your own personal stronghold of the mind, just download the app and get started 🚀;

If you want the full feature set and development philosophy, read the [Complete ABO Guide](docs/abo-user-guide.md).

## Abu's Self-Introduction

<p align="center">
  <img src="./docs/treasure.png" alt="ABO intel chapter self-introduction" width="32.7%" />
  <img src="./docs/growth.png" alt="ABO growth chapter self-introduction" width="35%" />
  <img src="./docs/paper.png" alt="ABO paper chapter self-introduction" width="31.3%" />
</p>
<p align="center">
  <img src="./docs/base.png" alt="Abu character design" width="48%" />
  <img src="./docs/meme/16x.png" alt="Abu expressions and states" width="48%" />
</p>




## Setup and Configuration

Install these two dependencies, [Obsidian](https://obsidian.md/) and [Codex](https://chatgpt.com/codex/):

```bash
brew install --cask obsidian
brew install --cask codex

codex login
```

- `Obsidian`: used to create or open a local Vault; later you'll point ABO's intel library and literature library at this directory.
- `Codex`: powers the assistant capabilities; after installing, run `codex login` once.

### Xiaohongshu Setup

One-click Xiaohongshu test:

```bash
bash scripts/xhs/open_browser_with_extension.sh
```

This launches a standalone browser profile and loads the Xiaohongshu bridge extension under `extension/`. On first use, just log in to Xiaohongshu inside this browser instance.

If the one-click test doesn't work, load the extension manually:

```text
./extension
```

Using Chrome / Edge as an example (the developer uses Edge):

1. Open the browser's extension management page.
2. Enable "Developer mode".
3. Choose "Load unpacked".
4. Select the `extension` directory in this repository.
5. Log in to Xiaohongshu in the same browser, then go back to ABO to configure the cookie or run the Xiaohongshu tools.

## Development and Debugging

If you just want to understand what ABO does, you can stop reading here. Below are minimal notes for those who want to continue developing and debugging locally.

### Environment

Recommended local setup:

- `Python 3.11+`
- `Node.js 20+`
- `Rust` and a `Tauri` development environment
- `Edge` or `Chrome` logged in to Xiaohongshu
- A local directory for long-term content accumulation, ideally an `Obsidian Vault`

### Install Dependencies

```bash
npm install
python3 -m pip install -r requirements.txt
```

### Launch the Desktop App

The recommended way is to start the Tauri development environment directly:

```bash
npm run tauri:fresh-dev
```

This command cleans up old ports and brings up the frontend, backend, and desktop shell.

If you need to debug the frontend and backend separately, run them individually:

```bash
python3 -m abo.main
npm run dev
```

Default development servers:

```text
Backend:  http://127.0.0.1:8765
Frontend: http://localhost:1420
```

### Debugging the Xiaohongshu Browser Bridge

For debugging the more stable Xiaohongshu browser pipeline, use:

```bash
bash scripts/xhs/open_browser_with_extension.sh
```

This launches a standalone browser profile and loads the Xiaohongshu bridge extension under `extension/`. On first use, just log in to Xiaohongshu inside this browser instance.

### macOS Packaging

Build a distributable macOS app:

```bash
npm run build:mac-app
```

Build a macOS release and update the Homebrew Cask metadata at the same time:

```bash
npm run build:mac-release
```

Build artifacts will appear at:

```text
release/ABO.app
release/ABO_<version>_<arch>.dmg
```

By default this repository produces an Apple Silicon artifact like `ABO_0.1.0_aarch64.dmg`.

#### Homebrew

The current implementation can already generate a `Homebrew Cask`, but for end users to actually install via `brew install`, two external conditions must be met:

1. A tag `v<version>` must exist in GitHub Releases, with the matching asset `ABO_<version>_<arch>.dmg` uploaded
2. `Casks/abo.rb` must live in a repository users can `brew tap`

In other words, `npm run build:mac-release` already solves the "generate cask metadata" step, but does not yet automate the "publish release assets" and "provide a standard tap repository" steps.

Also, the current `scripts/update_homebrew_cask.py` only generates one cask for the current build architecture at a time, writing `depends_on arch:`. This is sufficient for single-architecture releases; if we later want to support both Intel and Apple Silicon, it would be best to switch to Homebrew's officially recommended `arch arm:/intel:` + dual `sha256` / dual download URL format.

#### Future Maintenance

When releasing a new version, follow this order:

1. Update `version` in `src-tauri/tauri.conf.json`
2. Run `npm run build:mac-release`
3. Check `release/ABO.app`, `release/ABO_<version>_<arch>.dmg`, and `Casks/abo.rb`
4. Create a `v<version>` release on GitHub and upload the corresponding DMG
5. Commit the version bump, README, and `Casks/abo.rb` in this repository
6. If you use a standalone tap repository, sync the same `Casks/abo.rb` over to it

Two maintenance details:

- The download URL in `Casks/abo.rb` is auto-generated from the current repository's `origin` remote; if you later host release assets in a different repository, run `python3 scripts/update_homebrew_cask.py --repo-slug owner/repo`
- The most stable Homebrew approach is to maintain a dedicated tap repository, e.g. `hyuanChen/homebrew-abo`; that way users can simply use the standard `brew tap hyuanChen/abo`

#### Installing and Updating via Brew

If you don't want to create a dedicated tap repository for now, you can keep `Casks/abo.rb` under `Casks/` in this repository's root, and have users specify the custom tap URL manually:

```bash
brew tap hyuanChen/abo https://github.com/hyuanChen/ABO
brew install --cask hyuanChen/abo/abo
brew update
brew upgrade --cask hyuanChen/abo/abo
```

This approach works, but it is less standard than a dedicated `homebrew-abo` tap and relies more on the README explaining it clearly.

(Not yet implemented) The recommended approach is to set up a dedicated tap repository, e.g. `hyuanChen/homebrew-abo`, and put `Casks/abo.rb` there. That gives users the simplest commands:

```bash
brew tap hyuanChen/abo
brew install --cask abo
brew update
brew upgrade --cask abo
```

To uninstall:

```bash
brew uninstall --cask abo
brew uninstall --cask --zap abo
```

## License

This project is licensed under the Apache-2.0 License.
