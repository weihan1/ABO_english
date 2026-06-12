import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";

interface ConfigHelpProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}

export function ConfigHelp({ title, children, defaultExpanded = false }: ConfigHelpProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div
      style={{
        borderRadius: "var(--radius-md)",
        background: "var(--bg-hover)",
        border: "1px solid var(--border-light)",
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <HelpCircle style={{ width: "16px", height: "16px" }} />
          {title}
        </span>
        {expanded ? (
          <ChevronUp style={{ width: "16px", height: "16px" }} />
        ) : (
          <ChevronDown style={{ width: "16px", height: "16px" }} />
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: "0 16px 16px 16px",
            fontSize: "0.8125rem",
            color: "var(--text-secondary)",
            lineHeight: 1.7,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// Predefined cookie acquisition guide components
interface CookieGuideProps {
  platform: "bilibili" | "xiaohongshu" | "zhihu";
  cookieName: string;
}

export function CookieGuide({ platform, cookieName }: CookieGuideProps) {
  const guides = {
    bilibili: {
      steps: [
        "Install the Cookie-Editor extension (search the Chrome/Edge store)",
        "Visit bilibili.com and log in",
        "Click the Cookie-Editor icon",
        "Find the SESSDATA row and copy the Value column",
        "Paste it into the SESSDATA input above",
      ],
      tips: [
        "SESSDATA is an alphanumeric string (about 32-40 characters)",
        "SESSDATA is valid for about 1-2 weeks; re-fetch it after it expires",
        "Never share your SESSDATA with anyone — it is equivalent to your account password",
      ],
    },
    xiaohongshu: {
      steps: [
        "Install the Cookie-Editor extension (search the Chrome/Edge store)",
        "Visit xiaohongshu.com and log in",
        "Click the Cookie-Editor icon",
        "Find the web_session row and copy the Value column",
        "Paste it into the web_session input above",
        "(Optional) Find id_token and paste its Value into the id_token field",
      ],
      tips: [
        "web_session is a 64-character hexadecimal string",
        "web_session example: 040069b05e586b57b240d72e833b4b9cd16a46",
        "id_token is optional; you can leave it empty if you only need browsing",
        "Cookies are valid for about 1-2 weeks; re-fetch after expiry",
        "Never share your cookie with anyone — it is equivalent to your account password",
      ],
    },
    zhihu: {
      steps: [
        "Open a browser, visit zhihu.com, and log in",
        "Press F12 to open developer tools (or right-click → Inspect)",
        "Switch to the Application or Storage tab",
        "In the left menu choose Cookies → https://zhihu.com",
        "Find the z_c0 or _xsrf field in the list",
        "Copy the full value of that cookie",
        "Paste it into the input above",
      ],
      tips: [
        "Zhihu cookies last a long time, but re-fetch if you hit verification",
        "Some features require an extra Authorization token",
        "Never share your cookie with anyone",
      ],
    },
  };

  const guide = guides[platform];

  return (
    <ConfigHelp title={`How to get ${cookieName}?`}>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <strong style={{ color: "var(--text-main)" }}>Steps:</strong>
          <ol style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
            {guide.steps.map((step, idx) => (
              <li key={idx} style={{ marginBottom: "4px" }}>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <div
          style={{
            padding: "12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-warning)10",
            border: "1px solid var(--color-warning)30",
          }}
        >
          <strong style={{ color: "var(--color-warning)" }}>💡 Tips:</strong>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
            {guide.tips.map((tip, idx) => (
              <li key={idx} style={{ marginBottom: "4px" }}>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ConfigHelp>
  );
}
