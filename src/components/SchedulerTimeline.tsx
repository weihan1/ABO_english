import { useEffect, useState } from "react";
import { Clock, PlayCircle, PauseCircle } from "lucide-react";
import { api } from "../core/api";

interface SchedulerJob {
  id: string;
  name: string;
  schedule: string;
  next_run: string | null;
  enabled: boolean;
}

export default function SchedulerTimeline() {
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchJobs() {
      try {
        setLoading(true);
        const data = await api.get<{ jobs: SchedulerJob[] }>("/api/scheduler/jobs");
        if (!cancelled) setJobs(data.jobs);
      } catch (e) {
        console.error("Failed to load scheduler jobs:", e);
        if (!cancelled) setError("Failed to load. Please try again later.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchJobs();
    return () => { cancelled = true; };
  }, []);

  async function loadJobs() {
    setError(null);
    try {
      setLoading(true);
      const data = await api.get<{ jobs: SchedulerJob[] }>("/api/scheduler/jobs");
      setJobs(data.jobs);
    } catch (e) {
      console.error("Failed to load scheduler jobs:", e);
      setError("Failed to load. Please try again later.");
    } finally {
      setLoading(false);
    }
  }

  function formatNextRun(iso: string | null): string {
    if (!iso) return "Not scheduled";
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  if (loading) {
    return <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Loading scheduled tasks...</div>;
  }

  if (error) {
    return (
      <div style={{ color: "var(--color-error)", fontSize: "0.875rem" }}>
        {error}
        <button
          type="button"
          onClick={loadJobs}
          className="timeline-refresh-btn"
          style={{
            marginLeft: "12px",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (jobs.length === 0) {
    return <div style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No scheduled tasks</div>;
  }

  return (
    <>

    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {jobs.map((job) => (
        <div
          key={job.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-hover)",
            opacity: job.enabled ? 1 : 0.6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {job.enabled ? (
              <PlayCircle style={{ width: "18px", height: "18px", color: "var(--color-success)" }} />
            ) : (
              <PauseCircle style={{ width: "18px", height: "18px", color: "var(--text-muted)" }} />
            )}
            <div>
              <div style={{ fontSize: "0.9375rem", fontWeight: 500, color: "var(--text-main)" }}>{job.name}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{job.schedule}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
            <Clock style={{ width: "14px", height: "14px" }} />
            {formatNextRun(job.next_run)}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={loadJobs}
        className="timeline-refresh-btn"
        style={{
          alignSelf: "flex-start",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
        }}
      >
        Refresh
      </button>
      <style>{`
        .timeline-refresh-btn:focus-visible {
          outline: 2px solid var(--color-primary);
          outline-offset: 2px;
        }
      `}</style>
    </div>
    </>
  );
}
