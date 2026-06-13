import { useState, useCallback, useEffect } from "react";
import { FolderOpen, Check, AlertCircle, Loader2, ArrowLeft, ArrowRight, BookOpen, Database } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../../../core/api";

interface VaultSetupStepProps {
  onNext: () => void;
  onBack: () => void;
  onVaultPathSet: (vaultPath: string, literaturePath: string) => void;
}

type PathType = "vault" | "literature";

interface PathConfig {
  vault: string;
  literature: string;
}

interface ValidationState {
  vault: { status: "idle" | "validating" | "success" | "error"; message: string };
  literature: { status: "idle" | "validating" | "success" | "error"; message: string };
}

export default function VaultSetupStep({ onNext, onBack, onVaultPathSet }: VaultSetupStepProps) {
  const [paths, setPaths] = useState<PathConfig>({ vault: "", literature: "" });
  const [validation, setValidation] = useState<ValidationState>({
    vault: { status: "idle", message: "" },
    literature: { status: "idle", message: "" },
  });
  const [isSaving, setIsSaving] = useState(false);
  const [useSamePath, setUseSamePath] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadExistingPaths() {
      try {
        const config = await api.get<{ vault_path?: string; literature_path?: string }>("/api/config");
        if (cancelled) return;
        const vault = config.vault_path || "";
        const literature = config.literature_path || vault;
        if (!vault && !literature) return;
        setPaths({ vault, literature });
        setUseSamePath(!config.literature_path || config.literature_path === vault);
        setValidation({
          vault: vault ? { status: "success", message: "Loaded existing Intel Library path" } : { status: "idle", message: "" },
          literature: literature ? { status: "success", message: "Loaded existing Literature Library path" } : { status: "idle", message: "" },
        });
      } catch {
        // The user can still select paths manually if config loading fails.
      }
    }
    void loadExistingPaths();
    return () => {
      cancelled = true;
    };
  }, []);

  const validatePath = useCallback(async (path: string, type: PathType): Promise<boolean> => {
    if (!path) return false;

    setValidation((prev) => ({
      ...prev,
      [type]: { status: "validating", message: "Validating path..." },
    }));

    try {
      const result = await api.post<{ valid: boolean; message?: string }>("/api/config/validate-vault", {
        path,
      });

      if (result.valid) {
        setValidation((prev) => ({
          ...prev,
          [type]: { status: "success", message: "Path validated" },
        }));
        return true;
      } else {
        setValidation((prev) => ({
          ...prev,
          [type]: { status: "error", message: result.message || "Invalid path" },
        }));
        return false;
      }
    } catch (error) {
      setValidation((prev) => ({
        ...prev,
        [type]: { status: "error", message: "Validation failed" },
      }));
      return false;
    }
  }, []);

  const selectFolder = async (type: PathType) => {
    try {
      const title = type === "vault" ? "Choose Intel Library folder" : "Choose Literature Library folder";
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });

      if (selected && typeof selected === "string") {
        const newPaths = { ...paths, [type]: selected };
        setPaths(newPaths);
        await validatePath(selected, type);

        // If using same path, auto-fill literature path
        if (useSamePath && type === "vault") {
          setPaths({ vault: selected, literature: selected });
          setValidation((prev) => ({
            ...prev,
            literature: { status: "success", message: "Synced Intel Library path" },
          }));
        }
      }
    } catch (err) {
      console.error("Failed to open dialog:", err);
    }
  };

  const handleContinue = async () => {
    if (!paths.vault) return;

    // Validate both paths
    const vaultValid = await validatePath(paths.vault, "vault");
    if (!vaultValid) return;

    let literatureValid = true;
    if (!useSamePath && paths.literature) {
      literatureValid = await validatePath(paths.literature, "literature");
      if (!literatureValid) return;
    }

    setIsSaving(true);
    try {
      const literaturePath = useSamePath ? paths.vault : paths.literature || paths.vault;
      await api.post("/api/config", {
        vault_path: paths.vault,
        literature_path: literaturePath,
      });
      onVaultPathSet(paths.vault, literaturePath);
      onNext();
    } catch (error) {
      setValidation((prev) => ({
        ...prev,
        vault: { status: "error", message: "Failed to save configuration" },
      }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkipPathSetup = () => {
    onVaultPathSet("", "");
    onNext();
  };

  const getStatusIcon = (status: ValidationState[PathType]["status"]) => {
    switch (status) {
      case "validating":
        return <Loader2 style={{ width: "20px", height: "20px", animation: "spin 1s linear infinite" }} />;
      case "success":
        return <Check style={{ width: "20px", height: "20px", color: "#22c55e" }} />;
      case "error":
        return <AlertCircle style={{ width: "20px", height: "20px", color: "#ef4444" }} />;
      default:
        return null;
    }
  };

  const PathSelector = ({
    type,
    icon: Icon,
    title,
    description,
    disabled = false,
  }: {
    type: PathType;
    icon: React.ElementType;
    title: string;
    description: string;
    disabled?: boolean;
  }) => {
    const path = paths[type];
    const status = validation[type].status;

    return (
      <div style={{ width: "100%", marginBottom: "16px", opacity: disabled ? 0.6 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
          <Icon style={{ width: "18px", height: "18px", color: "var(--color-primary)" }} />
          <span style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-main)" }}>{title}</span>
        </div>
        <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginBottom: "12px" }}>{description}</p>

        <button
          onClick={() => !disabled && selectFolder(type)}
          disabled={disabled}
          style={{
            width: "100%",
            padding: "16px 20px",
            borderRadius: "var(--radius-lg)",
            background: "var(--bg-card)",
            border: `2px dashed ${path ? "var(--color-primary)" : "var(--border-light)"}`,
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "all 0.3s ease",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "var(--radius-md)",
              background: path ? "linear-gradient(135deg, #A8E6CF, #7DD3C0)" : "var(--bg-hover)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {path ? (
              <Check style={{ width: "20px", height: "20px", color: "white" }} />
            ) : (
              <FolderOpen style={{ width: "20px", height: "20px", color: "var(--text-muted)" }} />
            )}
          </div>
          <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
            <p
              style={{
                fontSize: "0.875rem",
                fontWeight: 600,
                color: path ? "var(--text-main)" : "var(--text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {path || "Click to choose a folder"}
            </p>
          </div>
          {status !== "idle" && !disabled && getStatusIcon(status)}
        </button>

        {validation[type].message && status !== "idle" && !disabled && (
          <div
            style={{
              marginTop: "8px",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              background: status === "error" ? "rgba(239, 68, 68, 0.08)" : "rgba(34, 197, 94, 0.08)",
              border: `1px solid ${status === "error" ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)"}`,
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                fontSize: "0.8125rem",
                color: status === "error" ? "#ef4444" : "#22c55e",
              }}
            >
              {validation[type].message}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100%",
        padding: "48px 32px",
        maxWidth: "640px",
        margin: "0 auto",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: "80px",
          height: "80px",
          borderRadius: "var(--radius-xl)",
          background: "linear-gradient(135deg, #A8D8FF, #7BC8F0)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "24px",
          boxShadow: "0 8px 32px rgba(123, 200, 240, 0.4)",
        }}
      >
        <Database style={{ width: "40px", height: "40px", color: "white" }} />
      </div>

      {/* Title */}
      <h2
        style={{
          fontFamily: "'M PLUS Rounded 1c', sans-serif",
          fontSize: "1.75rem",
          fontWeight: 700,
          color: "var(--text-main)",
          marginBottom: "12px",
          textAlign: "center",
        }}
      >
        Connect your local knowledge base
      </h2>

      <p
        style={{
          fontSize: "1rem",
          color: "var(--text-secondary)",
          marginBottom: "32px",
          textAlign: "center",
          lineHeight: 1.6,
        }}
      >
        ABO writes crawl results as Markdown. For first use we recommend choosing an Obsidian Vault;
        the Literature Library can share the Intel Library path at first and be split out later.
      </p>

      {/* Path Selectors */}
      <div style={{ width: "100%", marginBottom: "24px" }}>
        <PathSelector
          type="vault"
          icon={BookOpen}
          title="Intel Library"
          description="Stores non-paper content: Xiaohongshu, Bilibili, Zhihu, bookmarks, web pages"
        />

        {/* Use same path toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", padding: "0 4px" }}>
          <button
            onClick={() => {
              setUseSamePath(!useSamePath);
              if (!useSamePath) {
                // Sync literature to vault when enabling same path
                setPaths((prev) => ({ ...prev, literature: prev.vault }));
              }
            }}
            style={{
              width: "44px",
              height: "24px",
              borderRadius: "12px",
              background: useSamePath ? "var(--color-primary)" : "var(--border-light)",
              border: "none",
              cursor: "pointer",
              position: "relative",
              transition: "all 0.3s ease",
            }}
          >
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                background: "white",
                position: "absolute",
                top: "2px",
                left: useSamePath ? "22px" : "2px",
                transition: "all 0.3s ease",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              }}
            />
          </button>
          <span style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
            Literature Library uses the same path
          </span>
        </div>

        <PathSelector
          type="literature"
          icon={Database}
          title="Literature Library"
          description="Stores papers and literature: arXiv, Semantic Scholar, Follow Up"
          disabled={useSamePath}
        />
      </div>

      {/* Navigation Buttons */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          width: "100%",
          justifyContent: "center",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "14px 28px",
            borderRadius: "var(--radius-full)",
            background: "var(--bg-hover)",
            border: "1px solid var(--border-light)",
            color: "var(--text-secondary)",
            fontSize: "0.9375rem",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.3s ease",
          }}
        >
          <ArrowLeft style={{ width: "18px", height: "18px" }} />
          Back
        </button>

        <button
          type="button"
          onClick={handleContinue}
          disabled={!paths.vault || validation.vault.status === "error" || isSaving}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "14px 32px",
            borderRadius: "var(--radius-full)",
            background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))",
            border: "none",
            color: "white",
            fontSize: "0.9375rem",
            fontWeight: 700,
            cursor: !paths.vault || validation.vault.status === "error" || isSaving ? "not-allowed" : "pointer",
            opacity: !paths.vault || validation.vault.status === "error" || isSaving ? 0.6 : 1,
            transition: "all 0.3s ease",
            boxShadow: "0 4px 16px rgba(188, 164, 227, 0.3)",
          }}
        >
          {isSaving ? (
            <>
              <Loader2 style={{ width: "18px", height: "18px", animation: "spin 1s linear infinite" }} />
              Saving...
            </>
          ) : (
            <>
              Continue
              <ArrowRight style={{ width: "18px", height: "18px" }} />
            </>
          )}
        </button>
      </div>

      <button
        type="button"
        onClick={handleSkipPathSetup}
        style={{
          marginTop: "14px",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          fontSize: "0.8125rem",
          fontWeight: 700,
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: "4px",
        }}
      >
        Choose libraries later, continue the 10-second setup
      </button>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
