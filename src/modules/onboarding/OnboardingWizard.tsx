import { useState, useEffect } from "react";
import { api } from "../../core/api";
import { useStore } from "../../core/store";
import WindowDragHandle from "../../components/WindowDragHandle";
import ProgressIndicator from "./ProgressIndicator";
import WelcomeStep from "./steps/WelcomeStep";
import VaultSetupStep from "./steps/VaultSetupStep";
import QuickConfigStep from "./steps/QuickConfigStep";
import TutorialStep from "./steps/TutorialStep";

interface OnboardingConfig {
  onboarding_completed?: boolean;
  onboarding_step?: number;
  vault_path?: string;
  version?: string;
}

interface OnboardingWizardProps {
  onComplete?: () => void;
}

const TOTAL_STEPS = 4;
const clampStep = (step: number) => Math.min(Math.max(step, 0), TOTAL_STEPS - 1);

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { setConfig, addToast } = useStore();
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [, setVaultPath] = useState("");

  // Load onboarding status on mount
  useEffect(() => {
    loadOnboardingStatus();
  }, []);

  const loadOnboardingStatus = async () => {
    try {
      const config = await api.get<OnboardingConfig>("/api/config");

      // If onboarding is already completed, skip
      if (config.onboarding_completed) {
        if (onComplete) {
          onComplete();
        }
        return;
      }

      // Resume from saved step if exists
      if (config.onboarding_step !== undefined) {
        setCurrentStep(clampStep(Number(config.onboarding_step) || 0));
      }

      if (config.vault_path) {
        setVaultPath(config.vault_path);
      }
    } catch (error) {
      console.error("Failed to load onboarding status:", error);
      addToast({
        kind: "error",
        title: "Failed to load configuration",
        message: "Check whether the backend service is running",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveOnboardingStep = async (step: number) => {
    try {
      await api.post("/api/config", {
        onboarding_step: clampStep(step),
      });
    } catch (error) {
      console.error("Failed to save onboarding step:", error);
    }
  };

  const goToStep = (step: number) => {
    const nextStep = clampStep(step);
    setCurrentStep(nextStep);
    void saveOnboardingStep(nextStep);
  };

  const completeOnboarding = async (options?: { skipped?: boolean }) => {
    try {
      await api.post("/api/config", {
        onboarding_completed: true,
        onboarding_step: TOTAL_STEPS,
      });

      // Refresh config in store
      const config = await api.get<{ vault_path: string; literature_path?: string; version: string }>("/api/config");
      setConfig(config);

      addToast({
        kind: options?.skipped ? "info" : "success",
        title: options?.skipped ? "Onboarding skipped" : "Welcome to ABO!",
        message: options?.skipped ? "You can reopen it anytime in Settings." : "Your research journey is about to begin",
      });

      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      addToast({
        kind: "error",
        title: "Save failed",
        message: "Please try again later",
      });
    }
  };

  const handleNext = () => {
    goToStep(currentStep + 1);
  };

  const handleBack = () => {
    goToStep(currentStep - 1);
  };

  const handleVaultPathSet = (vaultPath: string, _literaturePath?: string) => {
    setVaultPath(vaultPath);
  };

  const handleComplete = () => {
    completeOnboarding();
  };

  const handleSkip = () => {
    completeOnboarding({ skipped: true });
  };

  if (isLoading) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-app)",
          zIndex: 100,
        }}
      >
        <WindowDragHandle />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              border: "3px solid var(--border-light)",
              borderTopColor: "var(--color-primary)",
              animation: "spin 1s linear infinite",
            }}
          />
          <p style={{ fontSize: "0.9375rem", color: "var(--text-muted)" }}>Loading...</p>
        </div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <WelcomeStep onNext={handleNext} />;
      case 1:
        return (
          <VaultSetupStep
            onNext={handleNext}
            onBack={handleBack}
            onVaultPathSet={handleVaultPathSet}
          />
        );
      case 2:
        return <QuickConfigStep onNext={handleNext} onBack={handleBack} />;
      case 3:
        return <TutorialStep onComplete={handleComplete} />;
      default:
        return <WelcomeStep onNext={handleNext} />;
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-app)",
        zIndex: 100,
        fontFamily: "'Nunito', 'M PLUS Rounded 1c', sans-serif",
      }}
    >
      <WindowDragHandle />
      {/* Progress Header */}
      <ProgressIndicator
        currentStep={currentStep}
        totalSteps={TOTAL_STEPS}
        onStepClick={(step) => {
          goToStep(step);
        }}
      />

      <button
        type="button"
        onClick={handleSkip}
        style={{
          position: "absolute",
          top: "18px",
          right: "24px",
          zIndex: 120,
          padding: "9px 14px",
          borderRadius: "999px",
          border: "1px solid var(--border-light)",
          background: "var(--bg-card)",
          color: "var(--text-secondary)",
          fontSize: "0.8125rem",
          fontWeight: 800,
          cursor: "pointer",
          boxShadow: "var(--shadow-soft)",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.borderColor = "var(--color-primary)";
          event.currentTarget.style.color = "var(--color-primary)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.borderColor = "var(--border-light)";
          event.currentTarget.style.color = "var(--text-secondary)";
        }}
      >
        Skip wizard
      </button>

      {/* Step Content */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
        }}
      >
        {/* Background Decoration */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `
              radial-gradient(ellipse 80% 50% at 20% 40%, rgba(188, 164, 227, 0.06) 0%, transparent 50%),
              radial-gradient(ellipse 60% 40% at 80% 60%, rgba(255, 183, 178, 0.04) 0%, transparent 50%)
            `,
          }}
        />

        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
          }}
        >
          {renderStep()}
        </div>
      </div>
    </div>
  );
}
