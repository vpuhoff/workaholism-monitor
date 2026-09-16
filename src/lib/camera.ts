import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { Settings } from "./storage";
export class Camera {
  private stream?: MediaStream;
  private model?: FaceLandmarker;
  private timer?: number;
  private stopped = false;
  private lastFrame = -1;
  private lastFresh = performance.now();
  constructor(private video: HTMLVideoElement) {}
  async start(
    settings: Settings,
    onFrame: (face: boolean, points: NormalizedLandmark[]) => void,
    onError: (message: string) => void,
  ) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Камера доступна только через HTTPS или localhost. Откройте приложение по защищённому адресу.",
      );
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 15 },
      },
      audio: false,
    });
    if (this.stopped) {
      this.stop();
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    const files = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    if (this.stopped) return;
    this.model = await FaceLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: "/mediapipe/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: settings.detection,
      minFacePresenceConfidence: settings.presence,
      minTrackingConfidence: settings.tracking,
    });
    if (this.stopped) {
      this.stop();
      return;
    }
    this.lastFresh = performance.now();
    this.stream.getVideoTracks()[0].onended = () => {
      if (!this.stopped)
        onError(
          "Камера отключилась. Проверьте подключение и запустите мониторинг снова.",
        );
    };
    this.timer = window.setInterval(() => {
      if (document.hidden || this.stopped) return;
      try {
        if (
          this.video.readyState >= 2 &&
          this.video.currentTime !== this.lastFrame
        ) {
          this.lastFrame = this.video.currentTime;
          this.lastFresh = performance.now();
          const result = this.model!.detectForVideo(
            this.video,
            performance.now(),
          );
          onFrame(
            result.faceLandmarks.length > 0,
            result.faceLandmarks[0] || [],
          );
        } else if (performance.now() - this.lastFresh > 5000)
          onError(
            "Видеопоток приостановлен. Проверьте камеру и начните снова.",
          );
      } catch {
        onError(
          "Не удалось обработать изображение с камеры. Попробуйте начать снова.",
        );
      }
    }, 1000 / settings.fps);
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.model?.close();
    this.model = undefined;
    this.video.srcObject = null;
  }
}
export function cameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError")
      return "Нет доступа к камере. Нажмите значок разрешений рядом с адресом сайта, разрешите камеру и попробуйте снова.";
    if (error.name === "NotFoundError")
      return "Камера не найдена. Подключите веб-камеру и попробуйте снова.";
    if (error.name === "NotReadableError")
      return "Камера занята другим приложением. Закройте его и попробуйте снова.";
  }
  return error instanceof Error
    ? error.message
    : "Не удалось запустить камеру. Проверьте подключение и попробуйте снова.";
}
