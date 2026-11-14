"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture } from "@react-three/drei";
import { Suspense } from "react";
import type { Vector3 } from "three";
import { latLonToVector } from "@/lib/moonMath";
import type { Site } from "@/lib/sites";

const MOON_RADIUS = 1;

type Props = {
  sites: Site[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  sunDir: Vector3;
  earthDir: Vector3;
};

export default function MoonScene({ sites, selectedId, onSelect, sunDir, earthDir }: Props) {
  return (
    // Start below the south pole, where all the regions are.
    <Canvas camera={{ position: [0.9, -3.8, 0.9], fov: 40 }}>
      <color attach="background" args={["#05060a"]} />
      <Stars radius={50} depth={20} count={3000} factor={2} fade />

      <directionalLight position={sunDir.clone().multiplyScalar(10)} intensity={3} />
      {/* Faint fill standing in for earthshine. */}
      <ambientLight intensity={0.15} />

      <Suspense fallback={null}>
        <Moon />
      </Suspense>

      {sites.map((site) => (
        <SiteMarker
          key={site.id}
          position={latLonToVector(site.lat, site.lon).multiplyScalar(MOON_RADIUS * 1.003)}
          selected={site.id === selectedId}
          onClick={() => onSelect(site.id)}
        />
      ))}

      <mesh position={earthDir.clone().multiplyScalar(2.2)}>
        <sphereGeometry args={[0.08, 24, 24]} />
        <meshBasicMaterial color="#4a90e2" />
      </mesh>

      <OrbitControls enablePan={false} minDistance={1.3} maxDistance={6} />
    </Canvas>
  );
}

function Moon() {
  // NASA SVS CGI Moon Kit; the LOLA elevation map doubles as a bump map.
  const [color, height] = useTexture([
    "/textures/moon_color_2k.jpg",
    "/textures/moon_height_3ppd.jpg",
  ]);
  return (
    <mesh>
      <sphereGeometry args={[MOON_RADIUS, 128, 64]} />
      <meshStandardMaterial map={color} bumpMap={height} bumpScale={0.02} roughness={1} />
    </mesh>
  );
}

function SiteMarker({
  position,
  selected,
  onClick,
}: {
  position: Vector3;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <mesh
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <sphereGeometry args={[selected ? 0.014 : 0.009, 16, 16]} />
      <meshBasicMaterial color={selected ? "#ffd166" : "#ef476f"} />
    </mesh>
  );
}
