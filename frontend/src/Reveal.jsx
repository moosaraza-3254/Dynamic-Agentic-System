import { useEffect, useRef, useState } from "react";

// Fades + slides an element in once it scrolls into view. Used throughout
// the landing page for the "subtle entrance animations, under 400ms,
// staggered slightly" requirement — without pulling in an animation library.
export default function Reveal({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(16px)",
        transition: `opacity 380ms ease-out ${delay}ms, transform 380ms ease-out ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}