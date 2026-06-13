// src/modules/dashboard/ActivityChart.tsx
import { useMemo } from "react";

interface DailyTrendItem {
  date: string;
  count: number;
}

interface ActivityChartProps {
  data: DailyTrendItem[];
}

export default function ActivityChart({ data }: ActivityChartProps) {
  const { maxValue, chartData, pathD, areaPathD } = useMemo(() => {
    if (data.length === 0) {
      return { maxValue: 1, chartData: [], pathD: "", areaPathD: "" };
    }

    const max = Math.max(...data.map((d) => d.count), 1);
    const chartWidth = 100;
    const chartHeight = 60;

    // Generate points for the line
    const points = data.map((item, index) => {
      const x = (index / (data.length - 1)) * chartWidth;
      const y = chartHeight - (item.count / max) * chartHeight;
      return { x, y, count: item.count, date: item.date };
    });

    // Create smooth line path using simple bezier curves
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx1 = prev.x + (curr.x - prev.x) / 3;
      const cpx2 = prev.x + (2 * (curr.x - prev.x)) / 3;
      pathD += ` C ${cpx1} ${prev.y}, ${cpx2} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    // Create area path (line + bottom corners)
    const areaPathD = `${pathD} L ${points[points.length - 1].x} ${chartHeight} L ${points[0].x} ${chartHeight} Z`;

    return { maxValue: max, chartData: points, pathD, areaPathD };
  }, [data]);

  if (data.length === 0) {
    return (
      <div
        style={{
          height: "200px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
        }}
      >
        <p>No data yet</p>
      </div>
    );
  }

  // Get 5 evenly spaced dates for x-axis labels
  const xAxisLabels = useMemo(() => {
    const labels = [];
    const step = Math.floor((data.length - 1) / 4);
    for (let i = 0; i < 5; i++) {
      const index = Math.min(i * step, data.length - 1);
      const date = data[index].date;
      labels.push(date.slice(5)); // Show MM-DD
    }
    return labels;
  }, [data]);

  return (
    <div style={{ padding: "20px 0" }}>
      {/* Chart Container */}
      <div
        style={{
          position: "relative",
          height: "200px",
          marginBottom: "16px",
        }}
      >
        {/* Y-axis labels */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: "24px",
            width: "30px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontSize: "0.6875rem",
            color: "var(--text-muted)",
            textAlign: "right",
          }}
        >
          <span>{maxValue}</span>
          <span>{Math.round(maxValue / 2)}</span>
          <span>0</span>
        </div>

        {/* Chart Area */}
        <div
          style={{
            position: "absolute",
            left: "40px",
            right: 0,
            top: 0,
            bottom: "24px",
          }}
        >
          <svg
            viewBox="0 0 100 60"
            preserveAspectRatio="none"
            style={{
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            {/* Grid lines */}
            {[0, 30, 60].map((y) => (
              <line
                key={y}
                x1="0"
                y1={y}
                x2="100"
                y2={y}
                stroke="var(--border-light)"
                strokeWidth="0.5"
                strokeDasharray="2,2"
              />
            ))}

            {/* Area fill */}
            <path
              d={areaPathD}
              fill="url(#areaGradient)"
              opacity={0.3}
            />

            {/* Line */}
            <path
              d={pathD}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Gradient definition */}
            <defs>
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.6} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
          </svg>

          {/* Data points */}
          {chartData.map((point, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                left: `${point.x}%`,
                top: `${(point.y / 60) * 100}%`,
                transform: "translate(-50%, -50%)",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "var(--color-primary)",
                border: "2px solid white",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                cursor: "pointer",
              }}
              title={`${point.date}: ${point.count} cards`}
            />
          ))}
        </div>
      </div>

      {/* X-axis labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingLeft: "40px",
          fontSize: "0.6875rem",
          color: "var(--text-muted)",
        }}
      >
        {xAxisLabels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          marginTop: "16px",
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
        }}
      >
        <div
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "2px",
            background: "var(--color-primary)",
          }}
        />
        <span>New cards per day</span>
      </div>
    </div>
  );
}
