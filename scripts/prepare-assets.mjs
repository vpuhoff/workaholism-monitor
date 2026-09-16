import { cp, mkdir, stat, writeFile } from "node:fs/promises";
await mkdir("public/mediapipe", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe/wasm", {
  recursive: true,
});
const model = "public/mediapipe/face_landmarker.task";
try {
  await stat(model);
} catch {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  );
  if (!response.ok) throw new Error(`Model download: ${response.status}`);
  await writeFile(model, Buffer.from(await response.arrayBuffer()));
}
