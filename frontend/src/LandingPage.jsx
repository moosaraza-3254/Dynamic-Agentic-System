import { useState, useEffect, useRef } from "react";
import Reveal from "./Reveal";
import ThemeToggle from "./ThemeToggle";

export default function LandingPage({ onLaunch, theme, onToggleTheme }) {
  const [scrolled, setScrolled] = useState(false);
  const [scrollDirection, setScrollDirection] = useState("up");
  const lastScrollY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const currentScrollY = window.scrollY;

      setScrolled(currentScrollY > 24);

      if (currentScrollY <= 24) {
        setScrollDirection("up");
      } else if (currentScrollY > lastScrollY.current) {
        setScrollDirection("down");
      } else if (currentScrollY < lastScrollY.current) {
        setScrollDirection("up");
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div style={{ background: "var(--canvas)", color: "var(--text-primary)", fontFamily: "Inter, sans-serif" }}>
      <Nav
        scrolled={scrolled}
        scrollDirection={scrollDirection}
        onLaunch={onLaunch}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />
      <Hero onLaunch={onLaunch} />
      <HowItWorks />
      <AgentFlow />
      <AgentCards />
      <EvidenceSection />
      <FinalCTA onLaunch={onLaunch} />
      <Footer />
    </div>
  );
}

function Nav({ scrolled, onLaunch, theme, onToggleTheme, scrollDirection }) {
  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 px-8 py-4 flex items-center justify-between transition-all duration-300 ${scrollDirection === "down" && scrolled
          ? "-translate-y-full"
          : "translate-y-0"
        }`}
      style={{
        background: scrolled ? "rgba(10,14,20,0.85)" : "transparent",
        backdropFilter: scrolled ? "blur(10px)" : "none",
        borderBottom: scrolled ? "1px solid var(--border-quiet)" : "1px solid transparent",
      }}
    >
      <span className="text-lg" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
        Nexus
      </span>
      <div className="flex items-center gap-6">
        <a href="#how-it-works" className="text-sm hidden sm:inline transition-colors" style={{ color: "var(--text-secondary)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}>How it works</a>
        <a
          href="#agents"
          className="text-sm hidden sm:inline transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
        >
          Agents
        </a>
        <a
          href="#evidence"
          className="text-sm hidden sm:inline transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
        >
          Evidence
        </a>
        <ThemeToggle
          theme={theme}
          onToggle={onToggleTheme}
        />
        <button
          onClick={onLaunch}
          className="text-sm rounded-md px-3 py-1.5 transition-colors"
          style={{ border: "1px solid var(--border-quiet)" }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-quiet)")}
        >
          Launch system →
        </button>
      </div>
    </nav>
  );
}

function Hero({ onLaunch }) {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-8 pt-20 pb-10 text-center overflow-hidden">
      <div
        className="absolute left-1/2 top-24 -translate-x-1/2 w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, var(--accent-dim) 0%, transparent 70%)", filter: "blur(20px)" }}
      />

      <Reveal>
        <p
          className="text-sm tracking-[0.25em] mb-6"
          style={{ color: "var(--accent)", fontFamily: "'JetBrains Mono', monospace" }}
        >
          DYNAMIC AGENTIC INTELLIGENCE
        </p>
      </Reveal>

      <Reveal delay={60}>
        <IntelligenceCore />
      </Reveal>

      <Reveal delay={140}>
        <h1
          className="mt-10 leading-[1.1] max-w-4xl mx-auto"
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "clamp(2rem, 4.2vw, 3.5rem)",
            letterSpacing: "-0.02em",
          }}
        >
          Where intelligent agents{" "}
          <span style={{ color: "var(--accent)" }}>connect, reason, and answer.</span>
        </h1>
      </Reveal>

      <Reveal delay={220}>
        <p className="mt-6 text-lg max-w-xl mx-auto" style={{ color: "var(--text-secondary)" }}>
          Nexus connects your documents, databases, and specialized agents into
          one system — every answer traced back to real evidence.
        </p>
      </Reveal>

      <Reveal delay={300}>
        <div className="mt-9 flex items-center justify-center gap-5">
          <button
            onClick={onLaunch}
            className="text-sm font-medium rounded-lg px-6 py-3 transition-all hover:-translate-y-0.5"
            style={{ background: "var(--accent)", color: "#fff" }}
            onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 8px 28px var(--accent-dim)")}
            onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
          >
            Launch Nexus →
          </button>
          <a href="#agents" className="text-sm transition-colors" style={{ color: "var(--text-tertiary)" }}>
            See the agents
          </a>
        </div>
      </Reveal>
    </section>
  );
}

function IntelligenceCore() {
  const nodes = [
    { label: "LEGAL", x: 30, y: 55 },
    { label: "FINANCE", x: 70, y: 55 },
    { label: "DOCUMENTS", x: 22, y: 130 },
    { label: "DATABASE", x: 78, y: 130 },
  ];
  const center = { x: 50, y: 90 };

  return (
    <div className="relative mx-auto" style={{ width: "32rem", height: "26rem" }}>
      <svg viewBox="0 0 100 180" className="w-full h-full">
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Connection lines, center to each node */}
        {nodes.map((n, i) => (
          <line
            key={`line-${i}`}
            x1={center.x}
            y1={center.y}
            x2={n.x}
            y2={n.y}
            stroke="var(--border-quiet)"
            strokeWidth="0.5"
          />
        ))}

        {/* Traveling particles, one per connection, staggered */}
        {nodes.map((n, i) => (
          <circle key={`particle-${i}`} r="1.1" fill="var(--accent)">
            <animateMotion
              dur={`${2.4 + i * 0.3}s`}
              repeatCount="indefinite"
              path={`M${center.x},${center.y} L${n.x},${n.y}`}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              dur={`${2.4 + i * 0.3}s`}
              repeatCount="indefinite"
            />
          </circle>
        ))}

        {/* Outer node dots + labels */}
        {nodes.map((n, i) => (
          <g key={`node-${i}`}>
            <circle cx={n.x} cy={n.y} r="2.2" fill="var(--surface-1)" stroke="var(--accent)" strokeWidth="0.4" />
            <text
              x={n.x}
              y={n.y + 6}
              textAnchor="middle"
              fontSize="4.2"
              fill="var(--text-tertiary)"
              fontFamily="'JetBrains Mono', monospace"
              letterSpacing="0.05em"
            >
              {n.label}
            </text>
          </g>
        ))}

        {/* Central glowing core */}
        <circle cx={center.x} cy={center.y} r="16" fill="url(#coreGlow)" />
        <circle cx={center.x} cy={center.y} r="6" fill="var(--surface-2)" stroke="var(--accent)" strokeWidth="0.6" className="animate-pulse" />
        <circle cx={center.x} cy={center.y} r="2.4" fill="var(--accent)" />
      </svg>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    ["Upload", "Add your documents or datasets. They're indexed automatically."],
    ["Ask", "Ask a question in plain language."],
    ["Retrieve and reason", "Nexus finds the relevant evidence and reasons over it."],
    ["Get a grounded answer", "Every claim is traceable back to its exact source."],
  ];

  return (
    <section id="how-it-works" className="px-8 py-24 max-w-4xl mx-auto">
      <Reveal>
        <h2 className="text-2xl mb-12 text-center" style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
          How it works
        </h2>
      </Reveal>
      <div className="space-y-8">
        {steps.map(([title, desc], i) => (
          <Reveal key={title} delay={i * 90}>
            <div className="flex items-start gap-5">
              <span className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm" style={{ border: "1px solid var(--accent)", color: "var(--accent)" }}>
                {i + 1}
              </span>
              <div>
                <p className="text-base" style={{ color: "var(--text-primary)" }}>{title}</p>
                <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{desc}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function AgentFlow() {
  const steps = ["Query", "Agent Router", "Legal · Financial · Research", "Knowledge Sources", "Evidence", "Answer"];
  return (
    <section className="px-8 py-20 max-w-4xl mx-auto">
      <Reveal>
        <div
          className="rounded-2xl p-8"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)" }}
        >
          <p
            className="text-xs mb-6 text-center tracking-widest"
            style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}
          >
            HOW A QUESTION MOVES THROUGH THE SYSTEM
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-3">
                <span
                  className="text-xs sm:text-sm px-3 py-1.5 rounded-full text-center"
                  style={{
                    border: "1px solid var(--accent)",
                    color: "var(--accent)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {s}
                </span>
                {i < steps.length - 1 && (
                  <span className="hidden sm:inline" style={{ color: "var(--border-quiet)" }}>→</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function AgentCards() {
  const agents = [
    { name: "Legal Agent", desc: "Contracts · Regulations · Legal Documents", color: "var(--accent)" },
    { name: "Financial Agent", desc: "Reports · Metrics · Structured Financial Data", color: "var(--financial)" },
    { name: "General Agent", desc: "Cross-document analysis · Synthesis", color: "var(--text-tertiary)" },
  ];

  return (
    <section id="agents" className="px-8 py-20 max-w-5xl mx-auto">
      <Reveal>
        <h2
          className="text-3xl mb-10 text-center"
          style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}
        >
          One system. Different ways of thinking.
        </h2>
      </Reveal>
      <div className="grid sm:grid-cols-3 gap-5">
        {agents.map((a, i) => (
          <Reveal key={a.name} delay={i * 100}>
            <AgentCard {...a} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function AgentCard({ name, desc, color }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="rounded-xl p-6 transition-all cursor-default"
      style={{
        background: "var(--surface-1)",
        border: `1px solid ${hover ? color : "var(--border-quiet)"}`,
        transform: hover ? "translateY(-4px)" : "translateY(0)",
      }}
    >
      <div className="w-2.5 h-2.5 rounded-full mb-4" style={{ background: color, boxShadow: hover ? `0 0 12px ${color}` : "none" }} />
      <p className="text-base mb-1" style={{ color: "var(--text-primary)" }}>{name}</p>
      <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>{desc}</p>
      <span className="text-xs" style={{ color, fontFamily: "'JetBrains Mono', monospace" }}>
        ● READY
      </span>
    </div>
  );
}

function EvidenceSection() {
  return (
    <section id="evidence" className="px-8 py-20 max-w-5xl mx-auto">
      <Reveal>
        <h2
          className="text-3xl mb-3 text-center"
          style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}
        >
          Don't just get an answer. See where it came from.
        </h2>
        <p className="text-center text-sm mb-12" style={{ color: "var(--text-secondary)" }}>
          Every claim traces back to its exact page and source.
        </p>
      </Reveal>

      <Reveal delay={100}>
        <div
          className="rounded-2xl overflow-hidden grid sm:grid-cols-2"
          style={{ background: "var(--surface-1)", border: "1px solid var(--border-quiet)" }}
        >
          <div className="p-6" style={{ borderRight: "1px solid var(--border-quiet)" }}>
            <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
              legal_sample.pdf · page 2
            </p>
            <div
              className="rounded-lg p-4 text-xs leading-relaxed"
              style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
            >
              ...if Confidential Information shall reach a third party, or
              become public,{" "}
              <span style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>
                all liability will be on the Party that is responsible
              </span>
              ...
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
              <span className="text-xs" style={{ color: "var(--text-tertiary)", fontFamily: "'JetBrains Mono', monospace" }}>
                From documents · p.2
              </span>
            </div>
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              If confidential information is disclosed to a third party,
              liability falls on the party responsible for the disclosure.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function FinalCTA({ onLaunch }) {
  return (
    <section className="relative px-8 py-28 text-center overflow-hidden">
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse, var(--accent-dim) 0%, transparent 70%)", filter: "blur(30px)" }}
      />
      <Reveal>
        <h2
          className="text-3xl sm:text-4xl mb-4"
          style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}
        >
          Give every question access to the right intelligence.
        </h2>
        <p className="mb-8 text-sm" style={{ color: "var(--text-secondary)" }}>
          No setup required — start chatting in seconds.
        </p>
        <button
          onClick={onLaunch}
          className="text-sm font-medium rounded-lg px-6 py-3 transition-all hover:-translate-y-0.5"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          Launch Nexus →
        </button>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="px-8 py-8 flex items-center justify-between text-xs"
      style={{ borderTop: "1px solid var(--border-quiet)", color: "var(--text-tertiary)" }}
    >
      <span style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Nexus</span>
      <span>All Rights Reserved.</span>
    </footer>
  );
}