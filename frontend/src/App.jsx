import { useState } from "react";
import LandingPage from "./LandingPage";
import ChatApp from "./ChatApp";
import useTheme from "./useTheme";
import "./App.css";

// Manages landing -> app as a same-shell transition with a centered
// "Let's go" pop-up in between, instead of a hard swap (which caused a
// white flash) or a plain crossfade. Also owns theme state at the top
// level so both LandingPage and ChatApp can read/toggle it.
export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [view, setView] = useState("landing"); // "landing" | "transitioning" | "app"
  const [popupVisible, setPopupVisible] = useState(false);
  const [appVisible, setAppVisible] = useState(false);

  function handleLaunch() {
    setView("transitioning");
    requestAnimationFrame(() => setPopupVisible(true));

    setTimeout(() => {
      setView("app");
      requestAnimationFrame(() => setAppVisible(true));
    }, 900);

    setTimeout(() => {
      setPopupVisible(false);
    }, 950);
  }

  return (
    <div style={{ background: "var(--canvas)", minHeight: "100vh" }}>
      {view === "landing" && (
        <LandingPage onLaunch={handleLaunch} theme={theme} onToggleTheme={toggleTheme} />
      )}

      {view === "transitioning" && (
        <div style={{ background: "var(--canvas)", minHeight: "100vh" }} />
      )}

      {view === "app" && (
        <div
          style={{
            opacity: appVisible ? 1 : 0,
            transition: "opacity 320ms ease-out",
          }}
        >
          <ChatApp initialSuggestion={null} theme={theme} onToggleTheme={toggleTheme} />
        </div>
      )}

      {(view === "transitioning" || (view === "app" && popupVisible)) && (
        <LaunchPopup visible={popupVisible} />
      )}
    </div>
  );
}

function LaunchPopup({ visible }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: "var(--canvas)",
        opacity: visible ? 1 : 0,
        transition: "opacity 260ms ease-out",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.92)",
          transition: "opacity 320ms ease-out, transform 320ms ease-out",
          textAlign: "center",
        }}
      >
        <div
          className="mx-auto mb-5 w-3 h-3 rounded-full"
          style={{
            background: "var(--accent)",
            boxShadow: "0 0 24px var(--accent-dim)",
            animation: "pulseDot 1.1s ease-in-out infinite",
          }}
        />
        <p
          style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 600,
            fontSize: "1.75rem",
            color: "var(--text-primary)",
          }}
        >
          Let's go <span style={{ color: "var(--accent)" }}>→</span>
        </p>
      </div>

      <style>{`
        @keyframes pulseDot {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}