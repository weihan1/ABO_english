export interface GuideItem {
  label: string;
  summary: string;
}

export interface GuideSection {
  title: string;
  subtitle: string;
  items: GuideItem[];
}

export interface WorkflowGuide {
  title: string;
  goal: string;
  entry: string;
  steps: string[];
  result: string;
}

export const corePromises = [
  {
    title: "Reclaim your attention",
    summary: "Crawl valuable info from papers, Xiaohongshu, Bilibili, bookmarks, and follow feeds into Daily Briefing first.",
  },
  {
    title: "Keep the knowledge",
    summary: "Save worthwhile content to the Intel or Literature Library, then generate Wiki pages and long-term threads.",
  },
  {
    title: "Write down the past",
    summary: "Use the assistant, journal, to-dos, and data insights to turn reading into research actions and a reviewable cadence.",
  },
];

export const sidebarSections: GuideSection[] = [
  {
    title: "Main Workspace",
    subtitle: "The everyday research-loop entries.",
    items: [
      { label: "Character Home", summary: "See energy, SAN, today's to-dos, timeline, ability radar, and achievements." },
      { label: "Assistant", summary: "Let the AI assistant advance tasks using Daily Briefing, the Wiki, the Literature Library, and chat context." },
      { label: "Daily Briefing", summary: "All scheduled and manual cards land here first; filter by papers, social, and smart groups." },
      { label: "Data Insights", summary: "View Today, Intelligence Mirror, Wellness Trends, Engagement Depth, Research Focus, and 30-Day Activity." },
      { label: "Intel Library", summary: "Browse saved Xiaohongshu, Bilibili, Zhihu content; supports bubble view, list view, Obsidian/Finder open, and path changes." },
      { label: "Literature Library", summary: "Manage papers and references; supports a separate library path, bubble view, list view, and Obsidian/Finder open." },
      { label: "Wiki", summary: "Generate the Internet Wiki / Literature Wiki from your libraries and review knowledge by pages and mind map." },
      { label: "Journal", summary: "Write daily thoughts and consolidate weekly, monthly, and yearly reviews." },
    ],
  },
  {
    title: "Automation Modules",
    subtitle: "Only run, pause, diagnose, and view results; configuration details belong to the Active Tools.",
    items: [
      { label: "Module Management", summary: "View running modules, pending content, last-7-days views, and new this week; search and filter by all/running/paused/error." },
      { label: "Module Details", summary: "Includes a run overview and history; run now, pause/enable, quick-fix, and run diagnostics." },
      { label: "Visible Modules", summary: "arXiv paper tracking, Semantic Scholar tracking, Xiaohongshu tracking, Bilibili tracking." },
      { label: "TODO Modules", summary: "Xiaoyuzhou, Zhihu, and Folder Monitor are hidden by default; re-enable them via the hidden-modules toggle in Settings." },
    ],
  },
  {
    title: "Active Tools",
    subtitle: "Where you manually search, preview, debug, and configure monitors; scheduled tasks must reuse these flows.",
    items: [
      { label: "Xiaohongshu Tools", summary: "Bookmark album crawls, manual crawls, follow monitors; one-click cookie in the top right; manual saves go to xhs/主动保存, albums to xhs/专辑." },
      { label: "Bilibili Tools", summary: "Post tracking, favorites organizing, follow monitors; one-click cookie in the top right, then save by full feed, smart group, or specific creator." },
      { label: "Paper Tracking", summary: "Follow-up papers, AI papers, tracking monitors; for Follow Up, keyword monitors, and saving to the Literature Library." },
      { label: "arXiv API", summary: "Instantly search and browse arXiv papers; good for ad-hoc lookups, bulk preview, and saving." },
      { label: "Health", summary: "Brings together today's state calibration, reminders, rhythm tracks, habits, weekly reviews, and recovery curves." },
    ],
  },
  {
    title: "Bottom & Global Entries",
    subtitle: "Confirm the infrastructure works and reach global configuration.",
    items: [
      { label: "Library status", summary: "The sidebar bottom shows library connected or configure Intel Library." },
      { label: "Settings", summary: "Configure intel scheduling, social cookies, the AI assistant, appearance, avatar, shortcuts, dev tools, and About info." },
      { label: "Command palette", summary: "Quickly jump between pages and run common actions via shortcuts." },
      { label: "Global search", summary: "Quickly locate cards, pages, and past material in your local content." },
    ],
  },
];

export const nestedSidebarSections: GuideSection[] = [
  {
    title: "Wiki Sub-Sidebar",
    subtitle: "Appears after entering the Internet Wiki or Literature Wiki.",
    items: [
      { label: "Back to knowledge base", summary: "Return to the Wiki home to reselect the Internet Wiki or Literature Wiki." },
      { label: "Find pages or keywords", summary: "Search page titles and keywords in the current Wiki." },
      { label: "Overview", summary: "View the current Wiki's overview and generation status." },
      { label: "Internet Wiki categories", summary: "Folder VKI, entity pages, concept pages." },
      { label: "Literature Wiki categories", summary: "Folder VKI, paper pages, topic pages." },
    ],
  },
  {
    title: "Settings Sidebar",
    subtitle: "The Settings page is organized into three tabs.",
    items: [
      { label: "General", summary: "Intel scheduling, one-click cookie, monitor terms, Daily Briefing preferences, AI assistant, appearance, avatar, shortcuts." },
      { label: "Dev Tools", summary: "Feed stream testing and crawl metadata ledger, for debugging scheduled tasks and crawl results." },
      { label: "About", summary: "View ABO's basic info and tech stack." },
    ],
  },
  {
    title: "Assistant Workspace",
    subtitle: "Not a traditional sidebar, but it routes tasks during onboarding.",
    items: [
      { label: "Common assistants", summary: "Write paper research, Wiki maintenance, and intel-advancing flows into the chat." },
      { label: "Recent conversations", summary: "Return to existing task context instead of re-explaining the background each time." },
      { label: "Conversation flow", summary: "Keep entering specific instructions, stop the current reply, or keep a draft." },
      { label: "Context overview", summary: "Check whether Daily Briefing, knowledge-base status, and data insights are ready to feed into the chat." },
    ],
  },
];

export const configurationFlow = [
  {
    title: "1. Choose two libraries",
    body: "The Intel Library holds social, bookmark, web, and journal material; the Literature Library holds papers. For first use, share one Obsidian Vault and split them later.",
  },
  {
    title: "2. Connect accounts",
    body: "Bilibili and Xiaohongshu use browser cookies. One-click config reuses the Active Tools' cookie logic, tests it automatically, and writes it to ABO's global config.",
  },
  {
    title: "3. Configure academic & AI",
    body: "arXiv needs no API key; Semantic Scholar can be left blank to use the built-in fallback or use your own key. The background agent defaults to Codex; Claude Code compatibility is off by default and can be enabled in Settings.",
  },
  {
    title: "4. Set up Daily Briefing",
    body: "Pushes at 09:00 by default. Papers, Xiaoyuzhou, and Zhihu run at that time; Xiaohongshu and Bilibili pre-fetch 30 minutes earlier so the Feed is ready on time.",
  },
  {
    title: "5. Try the Active Tools first",
    body: "Don't rely on scheduled tasks at first. Run the Xiaohongshu/Bilibili/Paper Tracking tool pages once, confirm preview and save results, then enable long-term monitoring.",
  },
];

export const coreUsageWorkflows: WorkflowGuide[] = [
  {
    title: "Configure the basics",
    goal: "Let ABO know where content is saved, which background agent to use, and when to crawl each day.",
    entry: "Onboarding wizard or Settings -> General",
    steps: [
      "Choose the Intel Library path: Xiaohongshu, Bilibili, bookmarks, web pages, and journal are saved here.",
      "Choose the Literature Library path: arXiv, Semantic Scholar, and Follow Up papers are saved here; it can share the Intel Library at first.",
      "Connect Xiaohongshu and Bilibili cookies: click one-click config and confirm the browser is logged in to each platform.",
      "Set the default background agent: only Codex is enabled by default; Claude Code compatibility is off and can be enabled in Settings when needed.",
      "Set the Daily Briefing time: 09:00 by default, with Xiaohongshu and Bilibili pre-fetching 30 minutes earlier.",
    ],
    result: "The sidebar bottom shows the library connected; cookie status shows connected; Daily Briefing scheduling can run.",
  },
  {
    title: "Manually crawl for data",
    goal: "Do a manual test run to confirm login state, filters, preview results, and save paths are all correct.",
    entry: "Sidebar -> Active Tools",
    steps: [
      "Xiaohongshu: open Xiaohongshu Tools, configure the cookie, then run bookmark album crawls, manual crawls, or the follow monitor workbench.",
      "Bilibili: open Bilibili Tools, configure the cookie, then run post tracking, favorites organizing, or specific-creator previews.",
      "Papers: open Paper Tracking or the arXiv API and search by keyword, category, paper title, or arXiv ID.",
      "Preview results: check card quality, source, author, time, abstract, and save button first — don't bulk-save right away.",
      "Save a sample: save a few results first, then check the file structure in the Intel or Literature Library.",
    ],
    result: "Data appears as cards and can be saved to the Intel or Literature Library; this is also the standard test before debugging scheduled tasks.",
  },
  {
    title: "Set up tracking monitors",
    goal: "Turn a one-off search into a daily auto-updating intel source.",
    entry: "Tracking monitors in Active Tools / Paper Tracking",
    steps: [
      "Xiaohongshu: configure keyword scans, follow-feed scans, pinned bloggers, and bloggers' latest posts; low-frequency small batches are more stable.",
      "Bilibili: configure persistent keywords, smart groups, or pinned creators; import from the follow feed or smart groups first.",
      "Papers: configure an arXiv keyword monitor, or a Semantic Scholar Follow Up monitor.",
      "Set counts and time windows: control items per crawl, day range, sort order, and whether keyword filtering is on.",
      "After saving, return to Module Management: confirm the module is enabled, and run it once or run diagnostics if needed.",
    ],
    result: "At the scheduled time, new content enters Daily Briefing as a long-term keyword-search subscription.",
  },
  {
    title: "Save & maintain",
    goal: "Consolidate worthwhile content from Feed cards into a searchable, reviewable local knowledge base.",
    entry: "Daily Briefing, Intel Library, Literature Library, Wiki",
    steps: [
      "In Daily Briefing, narrow the scope first: all intel, paper tracking, social follows, Xiaohongshu, Bilibili, or a specific keyword or author.",
      "Judge each card: save, mark read, skip, open the original, or hand it to the assistant for analysis.",
      "Social and bookmarks go to the Intel Library; papers go to the Literature Library; check the folder in each library afterward.",
      "Maintain content via the libraries: bubble view for structure, list view to locate files, and Obsidian or Finder when needed.",
      "Generate the Wiki: use the Internet Wiki for entities and topics, and the Literature Wiki for papers, methods, and research threads.",
    ],
    result: "Content no longer piles up in the Feed — it becomes local Markdown, Wiki pages, and long-term context you can keep analyzing.",
  },
  {
    title: "Using the assistant",
    goal: "Let the assistant build on your local intel and knowledge base instead of generic chatting.",
    entry: "Sidebar -> Assistant",
    steps: [
      "Check the context overview first: confirm Daily Briefing, knowledge-base status, and data insights are ready.",
      "Pick a common assistant: paper research, Wiki maintenance, and intel-advancing tasks generate better prompts automatically.",
      "Hand specific material to the assistant: reference Daily Briefing, a Wiki page, a paper, a path, or a recent conversation.",
      "Demand clear output: have the assistant produce next experiments, reading lists, Wiki page drafts, research ideas, or to-dos.",
      "Keep continuous context: continue from a recent conversation instead of re-explaining the background each time.",
    ],
    result: "The assistant becomes a research engine: turning captured content into judgments, structure, plans, and next actions.",
  },
];

export const dailyWorkflow = [
  "Open Daily Briefing and narrow the scope with filters like all intel, paper tracking, and social follows.",
  "Save, mark read, skip, or follow up on cards worth keeping.",
  "Papers to the Literature Library; social and bookmarks to the Intel Library.",
  "Open Wiki to generate or update the Internet/Literature Wiki, turning scattered material into a page network.",
  "Return to the assistant or journal to turn today's leads into next experiments, reading lists, or reviews.",
];

export const guideDocumentPath = "docs/abo-user-guide.md";
