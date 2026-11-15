// The landing page background is the supplied photograph, behind the hero.
// The photograph sits lower than the viewport top so the Moon rises from the
// paper edge and the hero text stays on the dark sky.

export function MoonSky() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-black">
      <div
        className="absolute inset-x-0 top-[32svh] h-[100svh] bg-cover bg-center bg-no-repeat [mask-image:linear-gradient(to_bottom,transparent,black_18%)] xl:top-[16svh]"
        style={{ backgroundImage: "url(/landing/moon.jpg?v=4)" }}
      />
    </div>
  );
}
