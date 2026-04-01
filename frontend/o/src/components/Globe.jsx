import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial } from '@react-three/drei';

export function Globe() {
  const sphereRef = useRef(null);

  useFrame((state, delta) => {
    if (sphereRef.current) {
      sphereRef.current.rotation.y += delta * 0.1;
      sphereRef.current.rotation.x += delta * 0.05;
    }
  });

  return (
    <group>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Sphere ref={sphereRef} args={[1, 64, 64]} scale={2}>
        <MeshDistortMaterial
          color="#e879f9"
          attach="material"
          distort={0.4}
          speed={1.5}
          roughness={0.2}
          metalness={0.8}
          wireframe={true}
        />
      </Sphere>
      {Array.from({ length: 20 }).map((_, i) => (
        <Particle key={i} index={i} />
      ))}
    </group>
  );
}

function Particle({ index }) {
  const ref = useRef(null);
  const radius = 2.5;
  const speed = 0.5 + Math.random() * 0.5;
  const offset = Math.random() * Math.PI * 2;
  const yOffset = (Math.random() - 0.5) * 2;
  const timeRef = useRef(0);

  useFrame((state, delta) => {
    if (ref.current) {
      timeRef.current += delta;
      const t = timeRef.current * speed + offset;
      ref.current.position.x = Math.sin(t) * radius;
      ref.current.position.z = Math.cos(t) * radius;
      ref.current.position.y = yOffset + Math.sin(t * 2) * 0.5;
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.05, 16, 16]} />
      <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={2} />
    </mesh>
  );
}
