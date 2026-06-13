import { useState, useEffect } from "react";
import {
  Search,
  TrendingUp,
  MessageCircle,
  ExternalLink,
  Cookie,
  AlertCircle,
  FileText,
  Video,
  HelpCircle,
  ThumbsUp,
  Clock,
  User,
  Hash,
  Lightbulb,
  Users,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { PageContainer, PageHeader, PageContent, Card, EmptyState, LoadingState } from "../../components/Layout";
import { api } from "../../core/api";
import { isActionEnterKey } from "../../core/keyboard";
import { useToast } from "../../components/Toast";
import { Search as SearchIcon } from "lucide-react";
import { CookieGuide } from "../../components/ConfigHelp";

interface ZhihuContent {
  id: string;
  title: string;
  content: string;
  author: string;
  content_type: 'answer' | 'article' | 'video';
  votes: number;
  comments_count: number;
  url: string;
  published_at: string;
  question_title?: string;
}

interface TrendsAnalysis {
  hot_topics: string[];
  trending_tags: { tag: string; frequency: number }[];
  content_patterns: string[];
  audience_insights: string[];
  engagement_factors: string[];
  summary: string;
}

interface SearchResponse {
  keyword: string;
  total_found: number;
  contents: ZhihuContent[];
}

interface TrendsResponse {
  keyword: string;
  analysis: TrendsAnalysis;
  based_on_contents: number;
}

interface ConfigResponse {
  cookie: string;
  is_configured: boolean;
}

export function ZhihuTool() {
  const [keyword, setKeyword] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cookie, setCookie] = useState("");
  const [isConfigured, setIsConfigured] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isFetchingFromBrowser, setIsFetchingFromBrowser] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [trendsData, setTrendsData] = useState<TrendsResponse | null>(null);
  const [isAnalyzingTrends, setIsAnalyzingTrends] = useState(false);
  const [expandedTrends, setExpandedTrends] = useState(true);
  const toast = useToast();

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await api.get<ConfigResponse>("/api/tools/zhihu/config");
      setCookie(config.cookie || "");
      setIsConfigured(config.is_configured);
    } catch (error) {
      console.error("Failed to load config:", error);
    }
  };

  const handleSearch = async () => {
    if (!keyword.trim()) {
      toast.info("Please enter search keywords");
      return;
    }

    setIsSearching(true);
    setShowTrends(false);
    setTrendsData(null);

    try {
      const response = await api.post<SearchResponse>("/api/tools/zhihu/search", {
        keyword: keyword.trim(),
        limit: 20,
      });
      setSearchResults(response);
      toast.success("Search finished", `Found ${response.total_found} results`);
    } catch (error) {
      toast.error("Search failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      await api.post("/api/tools/zhihu/config", { cookie });
      setIsConfigured(!!cookie);
      setShowConfigModal(false);
      toast.success("Configuration saved");
    } catch (error) {
      toast.error("Failed to save configuration", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleFetchFromBrowser = async () => {
    setIsFetchingFromBrowser(true);
    try {
      const response = await api.post<{ cookie: string }>("/api/tools/zhihu/config/from-browser", {});
      setCookie(response.cookie);
      toast.success("Cookie fetched from browser");
    } catch (error) {
      toast.error("Failed to get cookie", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsFetchingFromBrowser(false);
    }
  };

  const handleAnalyzeTrends = async () => {
    if (!searchResults || searchResults.contents.length === 0) {
      toast.info("No content to analyze");
      return;
    }

    setIsAnalyzingTrends(true);
    try {
      const response = await api.post<TrendsResponse>("/api/tools/zhihu/trends", {
        keyword: searchResults.keyword,
        contents: searchResults.contents,
      });
      setTrendsData(response);
      setShowTrends(true);
      setExpandedTrends(true);
      toast.success("Trends analysis finished");
    } catch (error) {
      toast.error("Analysis failed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsAnalyzingTrends(false);
    }
  };

  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case 'answer':
        return <HelpCircle className="w-4 h-4" />;
      case 'article':
        return <FileText className="w-4 h-4" />;
      case 'video':
        return <Video className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const getContentTypeLabel = (type: string) => {
    switch (type) {
      case 'answer':
        return 'Answer';
      case 'article':
        return 'Article';
      case 'video':
        return 'Video';
      default:
        return 'Content';
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 10000) {
      return (num / 10000).toFixed(1) + 'w';
    }
    return num.toString();
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <PageContainer>
      <PageHeader
        title="Zhihu Tools"
        subtitle="Search Zhihu content, analyze hot topics and trends"
      />

      <PageContent>
        {/* Search Bar */}
        <Card className="mb-6">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (isActionEnterKey(e)) {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="Enter keywords to search Zhihu..."
                className="w-full px-4 py-3 pl-11 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {isSearching ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" />
                  Search
                </>
              )}
            </button>
            <button
              onClick={() => setShowConfigModal(true)}
              className={`px-4 py-3 rounded-lg border transition-colors flex items-center gap-2 ${
                isConfigured
                  ? "bg-emerald-600/20 border-emerald-600/50 text-emerald-400 hover:bg-emerald-600/30"
                  : "bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-700/50"
              }`}
            >
              <Cookie className="w-4 h-4" />
              {isConfigured ? "Configured" : "Configure"}
            </button>
          </div>
        </Card>

        {/* Trends Analysis Section */}
        {searchResults && searchResults.contents.length > 0 && (
          <Card className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-400" />
                Trends analysis
              </h3>
              {!showTrends ? (
                <button
                  onClick={handleAnalyzeTrends}
                  disabled={isAnalyzingTrends}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  {isAnalyzingTrends ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <TrendingUp className="w-4 h-4" />
                      Analyze Trends
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={() => setExpandedTrends(!expandedTrends)}
                  className="text-slate-400 hover:text-slate-300"
                >
                  {expandedTrends ? (
                    <ChevronUp className="w-5 h-5" />
                  ) : (
                    <ChevronDown className="w-5 h-5" />
                  )}
                </button>
              )}
            </div>

            {showTrends && trendsData && expandedTrends && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="p-4 bg-indigo-900/20 border border-indigo-700/30 rounded-lg">
                  <p className="text-slate-300 text-sm leading-relaxed">
                    {trendsData.analysis.summary}
                  </p>
                </div>

                {/* Hot Topics */}
                {trendsData.analysis.hot_topics.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" />
                      Hot topics
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {trendsData.analysis.hot_topics.map((topic, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-amber-500/20 text-amber-300 text-sm rounded-full"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trending Tags */}
                {trendsData.analysis.trending_tags.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <Hash className="w-4 h-4 text-emerald-400" />
                      Hot tags
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {trendsData.analysis.trending_tags.map((item, index) => (
                        <span
                          key={index}
                          className="px-3 py-1 bg-emerald-500/20 text-emerald-300 text-sm rounded-full"
                        >
                          {item.tag} ({item.frequency})
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content Patterns */}
                {trendsData.analysis.content_patterns.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-blue-400" />
                      Content patterns
                    </h4>
                    <ul className="space-y-1">
                      {trendsData.analysis.content_patterns.map((pattern, index) => (
                        <li key={index} className="text-slate-300 text-sm flex items-start gap-2">
                          <span className="text-blue-400 mt-1">•</span>
                          {pattern}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Audience Insights */}
                {trendsData.analysis.audience_insights.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-400" />
                      Audience insights
                    </h4>
                    <ul className="space-y-1">
                      {trendsData.analysis.audience_insights.map((insight, index) => (
                        <li key={index} className="text-slate-300 text-sm flex items-start gap-2">
                          <span className="text-purple-400 mt-1">•</span>
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Engagement Factors */}
                {trendsData.analysis.engagement_factors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-rose-400" />
                      Engagement factors
                    </h4>
                    <ul className="space-y-1">
                      {trendsData.analysis.engagement_factors.map((factor, index) => (
                        <li key={index} className="text-slate-300 text-sm flex items-start gap-2">
                          <span className="text-rose-400 mt-1">•</span>
                          {factor}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="text-xs text-slate-500 pt-2 border-t border-slate-700">
                  Based on analysis of {trendsData.based_on_contents} items
                </div>
              </div>
            )}
          </Card>
        )}

        {/* Search Results */}
        {isSearching ? (
          <LoadingState message="Searching Zhihu..." />
        ) : searchResults ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-200">
                Search results ({searchResults.total_found})
              </h3>
            </div>

            {searchResults.contents.length === 0 ? (
              <EmptyState
                icon={SearchIcon}
                title="No Results Found"
                description="Try searching with different keywords"
              />
            ) : (
              <div className="space-y-4">
                {searchResults.contents.map((content) => (
                  <Card key={content.id} className="hover:border-indigo-500/30 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full flex items-center gap-1 ${
                            content.content_type === 'answer'
                              ? 'bg-blue-500/20 text-blue-300'
                              : content.content_type === 'article'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}>
                            {getContentTypeIcon(content.content_type)}
                            {getContentTypeLabel(content.content_type)}
                          </span>
                          {content.question_title && (
                            <span className="text-slate-400 text-sm truncate">
                              {content.question_title}
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <h4 className="text-lg font-medium text-slate-200 mb-2 line-clamp-2">
                          {content.title}
                        </h4>

                        {/* Content Preview */}
                        <p className="text-slate-400 text-sm line-clamp-3 mb-3">
                          {content.content}
                        </p>

                        {/* Meta Info */}
                        <div className="flex items-center gap-4 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            {content.author}
                          </span>
                          <span className="flex items-center gap-1">
                            <ThumbsUp className="w-4 h-4" />
                            {formatNumber(content.votes)}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-4 h-4" />
                            {formatNumber(content.comments_count)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {formatDate(content.published_at)}
                          </span>
                        </div>
                      </div>

                      {/* External Link */}
                      <a
                        href={content.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-5 h-5" />
                      </a>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={SearchIcon}
            title="Start Searching"
            description="Enter keywords to search Zhihu content"
          />
        )}
      </PageContent>

      {/* Config Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-indigo-500/20 rounded-lg">
                  <Cookie className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-200">Cookie Configuration</h3>
                  <p className="text-sm text-slate-400">Configure a Zhihu cookie for more complete search results</p>
                </div>
              </div>

              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5" />
                  <p className="text-sm text-amber-300">
                    The cookie is stored locally only and used to access the Zhihu API. Never share your cookie.
                  </p>
                </div>
              </div>

              <div className="mb-4">
                <CookieGuide platform="zhihu" cookieName="Cookie" />
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-300">Zhihu Cookie</label>
                  <button
                    onClick={handleFetchFromBrowser}
                    disabled={isFetchingFromBrowser}
                    className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                  >
                    {isFetchingFromBrowser ? (
                      <>
                        <div className="w-3 h-3 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-3 h-3" />
                        Get from browser
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={cookie}
                  onChange={(e) => setCookie(e.target.value)}
                  placeholder="Paste your Zhihu cookie here..."
                  rows={6}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfigModal(false)}
                  className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={isSavingConfig}
                  className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                >
                  {isSavingConfig ? "Saving..." : "Save configuration"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
