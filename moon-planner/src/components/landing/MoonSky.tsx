// The landing page background is the supplied photograph, full viewport.

export function MoonSky() {
  return (
    <div
      aria-hidden="true"
      className="landing-moon pointer-events-none fixed inset-0 -z-10 bg-black bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url(/landing/moon.jpg?v=4)" }}
    />
  );
}
