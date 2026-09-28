// 3D profession avatars (curated 24 from the Figma "88 FREE 3D Avatars" set).
// The PNGs in this folder are bundled by Vite; we resolve each to its final
// hashed URL via import.meta.glob so callers just use `avatarUrl(id)`.
const urls = import.meta.glob("./*.png", { eager: true, query: "?url", import: "default" });
const resolve = (file) => urls[`./${file}`];

const MANIFEST = [
  { id: "vet-female-blond-bird", label: "Female Veterinarian · with bird, blond hair", file: "vet-female-blond-bird.png" },
  { id: "vet-male-blond-dog", label: "Male Veterinarian · with dog, blond hair", file: "vet-male-blond-dog.png" },
  { id: "vet-female-brown-cat-br", label: "Female Veterinarian · with cat, brown hair, brown skin", file: "vet-female-brown-cat-br.png" },
  { id: "teacher-female-brown", label: "Female Teacher · brown hair", file: "teacher-female-brown.png" },
  { id: "teacher-male-red", label: "Male Teacher · red hair", file: "teacher-male-red.png" },
  { id: "teacher-male-brown-br", label: "Male Teacher · brown hair, brown skin", file: "teacher-male-brown-br.png" },
  { id: "firefighter-female-blond", label: "Female Firefighter · blond hair", file: "firefighter-female-blond.png" },
  { id: "firefighter-male-blond", label: "Male Firefighter · blond hair", file: "firefighter-male-blond.png" },
  { id: "firefighter-female-brown-br", label: "Female Firefighter · brown hair, brown skin", file: "firefighter-female-brown-br.png" },
  { id: "builder-female-blond", label: "Female Builder · blond hair", file: "builder-female-blond.png" },
  { id: "builder-male-red", label: "Male Builder · red hair", file: "builder-male-red.png" },
  { id: "builder-female-brown-br", label: "Female Builder · brown hair, brown skin", file: "builder-female-brown-br.png" },
  { id: "lawyer-female-brown", label: "Female Lawyer · brown hair", file: "lawyer-female-brown.png" },
  { id: "lawyer-male-brown", label: "Male Lawyer · brown hair", file: "lawyer-male-brown.png" },
  { id: "lawyer-male-brown-br", label: "Male Lawyer · brown hair, brown skin", file: "lawyer-male-brown-br.png" },
  { id: "doctor-female-brown", label: "Female Doctor · brown hair", file: "doctor-female-brown.png" },
  { id: "doctor-male-brown", label: "Male Doctor · brown hair", file: "doctor-male-brown.png" },
  { id: "doctor-male-brown-br", label: "Male Doctor · brown hair, brown skin", file: "doctor-male-brown-br.png" },
  { id: "police-female-brown", label: "Female Police · brown hair", file: "police-female-brown.png" },
  { id: "police-male-blond", label: "Male Police · blond hair", file: "police-male-blond.png" },
  { id: "police-male-brown-br", label: "Male Police · brown hair, brown skin", file: "police-male-brown-br.png" },
  { id: "freelancer-female-red", label: "Female Freelancer · red hair", file: "freelancer-female-red.png" },
  { id: "freelancer-male-blond", label: "Male Freelancer · blond hair", file: "freelancer-male-blond.png" },
  { id: "freelancer-female-brown-br", label: "Female Freelancer · brown hair, brown skin", file: "freelancer-female-brown-br.png" },
];

export const AVATARS = MANIFEST.map((a) => ({ ...a, url: resolve(a.file) }));
const BY_ID = Object.fromEntries(AVATARS.map((a) => [a.id, a]));

// Resolve an avatar id to its bundled image URL (null if unknown/unset).
export function avatarUrl(id) {
  return (id && BY_ID[id]?.url) || null;
}
